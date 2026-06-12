//! Shard: holds the ECS world, resources, terrain, soil grid, and player sessions.

use ff_common::{EntityId, GameMode, PlayerId, ShardId, SOIL_LAYERS};
use ff_ecs::components::identity::{NetworkId, Owner};
use ff_ecs::components::physics::{Collider, Grounded};
use ff_ecs::components::player::{Hunger, Inventory, Player, PlayerSkills, Stamina, Wallet};
use ff_ecs::components::soil::SoilGrid;
use ff_ecs::components::transform::{Position, Rotation, Velocity};
use ff_ecs::Resources;
use ff_voxel::VoxelWorld;
use glam::Vec3;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::session::PlayerSession;

/// A single shard instance.
pub struct Shard {
    pub id: ShardId,
    pub ecs_world: hecs::World,
    pub resources: Resources,
    pub terrain: VoxelWorld,
    pub terrain_bytes: Vec<u8>,
    pub soil_grid: SoilGrid,
    pub sessions: HashMap<PlayerId, PlayerSession>,
    pub next_entity_id: u64,
    /// Highest entity id we've already announced to connected clients
    /// via the initial world snapshot or a ServerEntitySpawn. Entities
    /// with a higher id are "new" (e.g. a freshly planted seed) and the
    /// tick loop broadcasts a spawn for them so clients render the right
    /// mesh instead of the gray fallback. Entity ids are monotonic
    /// (next_entity_id only increments), so a single watermark suffices.
    pub announced_max_entity_id: u64,
    /// Last plant growth stage we broadcast per entity id. When a plant
    /// advances a stage the tick loop re-announces it (a spawn carries
    /// the new stage) so the client rescales it — the periodic batch
    /// update only carries position, not growth stage.
    pub plant_stage_seen: HashMap<u64, u8>,
    pub region_index: u8,
    /// Active Tech-Monarch tasks keyed by task_id. The reward coins are
    /// escrowed (already debited from the issuing Monarch's wallet) so
    /// the Monarch can't spend them before someone claims the task.
    pub active_tasks: HashMap<u32, MonarchTask>,
    /// Per-(task, player) action count toward an active task. Cleared
    /// when the task is claimed or the issuing Monarch disconnects.
    pub task_progress: HashMap<(u32, PlayerId), u32>,
    /// Monotonic ID generator for new tasks.
    pub next_task_id: u32,
    /// Persistent player state, keyed by hello.player_name. Saved on
    /// disconnect so a player who travels to a new region (or
    /// reconnects under the same name) gets their wallet, inventory,
    /// and Monarch role back. NOT cleared on shard restart in-memory;
    /// nothing is written to disk (yet) — restart wipes it.
    pub persistent_state: HashMap<String, PersistedPlayer>,
    /// Players currently shown Aurona's death oracle (so we don't re-send it
    /// every tick). Cleared for a player once they're no longer dead.
    pub death_oracled: HashSet<PlayerId>,
    /// The shared lean online-learning policy that pilots every native AI
    /// body on this shard (md/07 §4b).
    pub house_brain: ff_ecs::systems::house_ai::HouseBrain,
    /// Optional path to persist/resume the house brain across restarts
    /// (from `HOUSE_AI_MODEL`).
    pub brain_model_path: Option<String>,
    /// The AI faction's **collective** machine-intelligence meter (0..100),
    /// the mean over the native AI-faction agents (md/07 §7). Drives the
    /// per-world register: companion (Peaceful) → ascendancy (Realistic /
    /// Survival).
    pub faction_intelligence: f32,
    /// True once the faction's AI-ascendancy event has fired (so it fires once).
    pub faction_ascended: bool,
}

/// What we save per player between sessions. Serializable so it can be
/// written to disk — a player's wallet / inventory / role / songs survive a
/// server restart, so they can pick up and play later.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PersistedPlayer {
    pub coins: u32,
    pub inventory: Vec<(u16, u16)>, // (item_id, count)
    pub monarch: Option<ff_ecs::components::player::Monarch>,
    /// Bitmask of Aurona songs bought from the Songbook store — kept so a
    /// purchase isn't lost when the player reconnects or travels.
    pub owned_songs: u8,
}

/// A live Monarch-issued task.
#[derive(Debug, Clone)]
pub struct MonarchTask {
    pub id: u32,
    pub monarch_id: PlayerId,
    pub monarch_name: String,
    pub tone: u8,
    pub message: String,
    /// 0=Plant, 1=Harvest, 2=CutTree, 3=Hunt.
    pub task_kind: u8,
    pub target: u32,
    pub reward: u32,
}

/// Replay an anonymised behaviour-log file, teaching the house brain by
/// imitation from every successful, macro-mappable crowd action (records that
/// carry `m` + `f`). Returns how many transitions were absorbed. Behaviour
/// only — the log holds no personal data.
fn warm_start_from_log(
    brain: &mut ff_ecs::systems::house_ai::HouseBrain,
    path: &str,
) -> u64 {
    const NF: usize = ff_ecs::components::player::HOUSE_AI_FEATURES;
    let data = match std::fs::read_to_string(path) {
        Ok(d) => d,
        Err(_) => return 0,
    };
    let mut n = 0u64;
    for line in data.lines() {
        let v: serde_json::Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if v.get("ok").and_then(|x| x.as_bool()) != Some(true) {
            continue;
        }
        let m = match v.get("m").and_then(|x| x.as_u64()) {
            Some(m) => m as usize,
            None => continue,
        };
        let f = match v.get("f").and_then(|x| x.as_array()) {
            Some(a) if a.len() == NF => a,
            _ => continue,
        };
        let mut feats = [0.0f32; NF];
        for (i, val) in f.iter().enumerate() {
            feats[i] = val.as_f64().unwrap_or(0.0) as f32;
        }
        let role = v.get("role").and_then(|x| x.as_u64()).unwrap_or(0) as u8;
        brain.imitate(&feats, m, role);
        n += 1;
    }
    n
}

impl Shard {
    pub fn new(id: ShardId, terrain: VoxelWorld, terrain_bytes: Vec<u8>, game_mode: GameMode, region_index: u8) -> Arc<Mutex<Self>> {
        let w = terrain.width as usize;
        let d = terrain.depth as usize;

        let soil_grid = SoilGrid::new(w, d, SOIL_LAYERS);

        let mut resources = Resources::new();
        resources.game_mode = game_mode;

        let mut shard = Self {
            id,
            ecs_world: hecs::World::new(),
            resources,
            terrain,
            terrain_bytes,
            soil_grid,
            sessions: HashMap::new(),
            next_entity_id: 1000,
            announced_max_entity_id: 0,
            plant_stage_seen: HashMap::new(),
            region_index,
            active_tasks: HashMap::new(),
            task_progress: HashMap::new(),
            next_task_id: 1,
            persistent_state: HashMap::new(),
            death_oracled: HashSet::new(),
            house_brain: ff_ecs::systems::house_ai::HouseBrain::default(),
            brain_model_path: std::env::var("HOUSE_AI_MODEL").ok().filter(|p| !p.is_empty()),
            faction_intelligence: 0.0,
            faction_ascended: false,
        };

        // Spawn some initial plants and animals
        shard.spawn_initial_ecosystem();

        // The game's own house AI: spawn a few native learning agents. Count
        // from HOUSE_AI (default 2; 0 disables). They're embodied 🤖 Farmers
        // piloted by the shared, online-learning HouseBrain.
        let n_ai = std::env::var("HOUSE_AI").ok().and_then(|s| s.parse().ok()).unwrap_or(4u32);
        // Optionally resume a previously-learned brain so it keeps improving
        // across restarts (true online learning).
        if let Some(path) = &shard.brain_model_path {
            if let Ok(bytes) = std::fs::read(path) {
                if let Ok(b) = serde_json::from_slice::<ff_ecs::systems::house_ai::HouseBrain>(&bytes) {
                    tracing::info!("house-AI: resumed brain from {path} ({} steps)", b.steps);
                    shard.house_brain = b;
                }
            }
        }
        // Warm-start by replaying the accumulated behaviour log: imitate what
        // worked for the human + external-agent crowd before play even begins
        // (md/07 §4b — "humanity, distilled").
        if n_ai > 0 {
            if let Ok(path) = std::env::var("BEHAVIOUR_LOG") {
                if !path.is_empty() {
                    let n = warm_start_from_log(&mut shard.house_brain, &path);
                    if n > 0 {
                        tracing::info!("house-AI: warm-started from {n} logged crowd actions");
                    }
                }
            }
        }
        for i in 0..n_ai {
            // Cycle the four roles so the house AI exercises all of them:
            // 0 Farmer · 1 Tech-Monarch · 2 Innovator · 3 AI faction.
            shard.spawn_native_ai(i, (i % 4) as u8);
        }
        if n_ai > 0 {
            tracing::info!("house-AI: spawned {n_ai} native learning agent(s) across roles");
        }

        // Everything spawned so far is part of the initial world snapshot
        // every client receives on join, so mark it all as "already
        // announced" — only entities created AFTER this (planted seeds,
        // deployed drones, …) need an incremental spawn broadcast.
        shard.announced_max_entity_id = shard.next_entity_id.saturating_sub(1);

        Arc::new(Mutex::new(shard))
    }

    /// Spawn one native AI player in the given role (no session — it has no
    /// socket; the HouseBrain pilots it). Mirrors `add_player`'s entity but
    /// adds `NativeAi` / `AiControlled` / `AiMemory` and the role component
    /// (Monarch for Tech-Monarch + AI faction, Innovator for Innovator).
    fn spawn_native_ai(&mut self, idx: u32, role: u8) {
        let eid = EntityId(self.next_entity_id);
        self.next_entity_id += 1;
        // Synthetic, collision-free player id (humans start at 1).
        let pid = PlayerId(900_000 + idx as u64);

        let cx = (self.terrain.width / 2) as i32;
        let cz = (self.terrain.depth / 2) as i32;
        let sx = cx + ((idx as i32 % 7) - 3) * 3;
        let sz = cz + ((idx as i32 / 7) as i32) * 3;
        let sy = self.terrain.spawn_height(sx, sz);

        let (persona, label) = match role {
            1 => ("Magnus", "sylva-monarch-v1"),
            2 => ("Iris", "sylva-innovator-v1"),
            3 => ("Nyx", "sylva-ai-v1"),
            _ => ("Sylva", "sylva-farmer-v1"),
        };

        let entity = self.ecs_world.spawn((
            NetworkId(eid),
            ff_ecs::components::identity::Name(format!("🤖 {persona} {}", idx + 1)),
            Owner(pid),
            Position(Vec3::new(sx as f32, sy, sz as f32)),
            Rotation(0.0),
            Velocity(Vec3::ZERO),
            Collider { half_extents: Vec3::new(0.4, 0.9, 0.4) },
            Grounded(true),
            Player { player_id: pid, session_id: pid.0, last_input_seq: 0 },
            Inventory::new(),
            Stamina(100.0),
            Hunger(0.0),
            Wallet(0),
            PlayerSkills::default(),
        ));
        // hecs tuple bundles cap at 15 components — attach the AI trio after.
        let mut mem = ff_ecs::components::player::AiMemory::default();
        mem.role = role;
        let _ = self.ecs_world.insert(
            entity,
            (
                ff_ecs::components::player::NativeAi,
                ff_ecs::components::player::AiControlled { label: label.into() },
                mem,
            ),
        );
        // Role resources: Monarch (and the AI faction) deploy semi-AI workers;
        // the Innovator banks knowledge and ends crises.
        match role {
            1 | 3 => {
                let _ = self.ecs_world.insert_one(
                    entity,
                    ff_ecs::components::player::Monarch::default(),
                );
            }
            2 => {
                let _ = self.ecs_world.insert_one(
                    entity,
                    ff_ecs::components::player::Innovator::default(),
                );
            }
            _ => {}
        }
    }

    /// Spawn a player entity and register their session.
    pub fn add_player(
        &mut self,
        player_id: PlayerId,
        name: String,
        session: PlayerSession,
    ) -> (EntityId, hecs::Entity) {
        let eid = EntityId(self.next_entity_id);
        self.next_entity_id += 1;

        // Spawn at a random-ish position on the terrain
        let spawn_x = (self.terrain.width / 2) as i32;
        let spawn_z = (self.terrain.depth / 2) as i32;
        let spawn_y = self.terrain.spawn_height(spawn_x, spawn_z);

        let entity = self.ecs_world.spawn((
            NetworkId(eid),
            ff_ecs::components::identity::Name(name),
            Owner(player_id),
            Position(Vec3::new(spawn_x as f32, spawn_y, spawn_z as f32)),
            Rotation(0.0),
            Velocity(Vec3::ZERO),
            Collider {
                half_extents: Vec3::new(0.4, 0.9, 0.4),
            },
            Grounded(true),
            Player {
                player_id,
                session_id: player_id.0,
                last_input_seq: 0,
            },
            Inventory::new(),
            Stamina(100.0),
            Hunger(0.0),
            Wallet(0),
            PlayerSkills::default(),
        ));

        self.sessions.insert(player_id, session);
        tracing::info!("Player {:?} joined shard {:?}", player_id, self.id);

        (eid, entity)
    }

    /// Snapshot every currently-connected player's wallet / inventory / role /
    /// songs into `persistent_state` (keyed by the name they typed) WITHOUT
    /// despawning them — so a periodic disk save captures live progress, not
    /// just players who already disconnected.
    pub fn snapshot_live_players(&mut self) {
        let roster: Vec<(PlayerId, String)> = self
            .sessions
            .values()
            .map(|s| (s.player_id, s.origin_name.clone()))
            .collect();
        for (pid, origin) in roster {
            let mut ent = None;
            for (e, p) in self.ecs_world.query::<&Player>().iter() {
                if p.player_id == pid {
                    ent = Some(e);
                    break;
                }
            }
            let Some(e) = ent else { continue };
            let coins = self
                .ecs_world
                .get::<&ff_ecs::components::player::Wallet>(e)
                .map(|w| w.0)
                .unwrap_or(0);
            let inventory: Vec<(u16, u16)> = self
                .ecs_world
                .get::<&ff_ecs::components::player::Inventory>(e)
                .map(|inv| inv.slots.iter().map(|s| (s.item_id, s.count)).collect())
                .unwrap_or_default();
            let monarch = self
                .ecs_world
                .get::<&ff_ecs::components::player::Monarch>(e)
                .ok()
                .map(|m| (*m).clone());
            let owned_songs = self
                .ecs_world
                .get::<&ff_ecs::components::player::SongLibrary>(e)
                .map(|s| s.0)
                .unwrap_or(0);
            self.persistent_state.insert(
                origin,
                PersistedPlayer { coins, inventory, monarch, owned_songs },
            );
        }
    }

    /// Remove a player from the shard.
    pub fn remove_player(&mut self, player_id: PlayerId) {
        // Pop the session first so we know the origin_name for the
        // persistent-state save below.
        let origin_name = self.sessions
            .get(&player_id)
            .map(|s| s.origin_name.clone());
        self.sessions.remove(&player_id);

        // Find player entity (and capture wallet refund target before despawning).
        let mut to_despawn = Vec::new();
        for (entity, player) in self.ecs_world.query_mut::<&Player>() {
            if player.player_id == player_id {
                to_despawn.push(entity);
            }
        }

        // Snapshot the player's wallet/inventory/Monarch component
        // into persistent_state — keyed by the original (pre-
        // disambiguation) name they typed on the connect screen — so
        // a Travel-to-Region reconnect can restore them, minus the
        // travel cost. Done before despawning the entity.
        if let Some(name) = origin_name {
            for &e in &to_despawn {
                let coins = self.ecs_world
                    .get::<&ff_ecs::components::player::Wallet>(e)
                    .map(|w| w.0)
                    .unwrap_or(0);
                let inventory: Vec<(u16, u16)> = self.ecs_world
                    .get::<&ff_ecs::components::player::Inventory>(e)
                    .map(|inv| inv.slots.iter().map(|s| (s.item_id, s.count)).collect())
                    .unwrap_or_default();
                let monarch = self.ecs_world
                    .get::<&ff_ecs::components::player::Monarch>(e)
                    .ok()
                    .map(|m| (*m).clone());
                let owned_songs = self.ecs_world
                    .get::<&ff_ecs::components::player::SongLibrary>(e)
                    .map(|s| s.0)
                    .unwrap_or(0);
                self.persistent_state.insert(name.clone(), PersistedPlayer {
                    coins,
                    inventory,
                    monarch,
                    owned_songs,
                });
                break;
            }
        }

        // Cancel any tasks issued by this Monarch. Rewards are paid
        // out of the live wallet at claim time (no escrow), so there's
        // nothing to refund — just drop the tasks and the open
        // per-player progress entries.
        let cancelled: Vec<u32> = self
            .active_tasks
            .iter()
            .filter(|(_, t)| t.monarch_id == player_id)
            .map(|(id, _)| *id)
            .collect();
        if !cancelled.is_empty() {
            for id in &cancelled {
                self.active_tasks.remove(id);
                self.task_progress.retain(|(tid, _), _| *tid != *id);
            }
            tracing::info!(
                "Cancelled {} task(s) for departing monarch {:?}",
                cancelled.len(),
                player_id
            );
        }

        for entity in to_despawn {
            let _ = self.ecs_world.despawn(entity);
        }

        tracing::info!("Player {:?} left shard {:?}", player_id, self.id);
    }

    /// Seed the world with initial plants and animals, scaled to terrain size.
    fn spawn_initial_ecosystem(&mut self) {
        use ff_ecs::components::animal::{Animal, AnimalBehavior, Domesticated};
        use ff_ecs::components::plant::{Harvestable, Plant};
        use ff_voxel::generate;

        let w = self.terrain.width as i32;
        let d = self.terrain.depth as i32;
        let area_scale = (w as f32 * d as f32) / (80.0 * 80.0);

        if let Some(invasive_id) = generate::invasive_species_for_region(self.region_index) {
            let count = (80.0 * area_scale) as i32;
            let harvestable = self.resources.species_db.get_plant(invasive_id)
                .and_then(|s| Harvestable::from_species(invasive_id, s.harvest_item_id, s.harvest_amount));
            for i in 0..count {
                let x = ((i as i64 * 17 + 3) % w as i64) as i32;
                let z = ((i as i64 * 23 + 7) % d as i64) as i32;
                if self.terrain.is_water_surface(x, z) { continue; }
                let y = self.terrain.spawn_height(x, z);
                if !self.terrain.is_solid(x, y as i32 - 1, z) { continue; }

                let eid = EntityId(self.next_entity_id);
                self.next_entity_id += 1;

                let mut plant = Plant::new_seed(invasive_id);
                plant.growth_stage = ff_ecs::components::plant::GrowthStage::Mature;
                plant.growth_points = 60000.0;

                let entity = self.ecs_world.spawn((
                    NetworkId(eid),
                    Position(Vec3::new(x as f32, y, z as f32)),
                    Rotation(0.0),
                    plant,
                ));
                if let Some(h) = harvestable {
                    let _ = self.ecs_world.insert_one(entity, h);
                }
            }
        }

        let native_species = generate::native_species_for_region(self.region_index);
        let native_count = (21.0 * area_scale) as i32;
        for i in 0..native_count {
            let x = ((i as i64 * 31 + 17) % w as i64) as i32;
            let z = ((i as i64 * 37 + 11) % d as i64) as i32;
            if self.terrain.is_water_surface(x, z) { continue; }
            let y = self.terrain.spawn_height(x, z);

            let species_id = native_species[i as usize % native_species.len()];
            let harvestable = self.resources.species_db.get_plant(species_id)
                .and_then(|s| Harvestable::from_species(species_id, s.harvest_item_id, s.harvest_amount));
            let eid = EntityId(self.next_entity_id);
            self.next_entity_id += 1;

            let mut plant = Plant::new_seed(species_id);
            plant.growth_stage = ff_ecs::components::plant::GrowthStage::Mature;
            plant.growth_points = 50000.0;

            let entity = self.ecs_world.spawn((
                NetworkId(eid),
                Position(Vec3::new(x as f32, y, z as f32)),
                Rotation(0.0),
                plant,
            ));
            if let Some(h) = harvestable {
                let _ = self.ecs_world.insert_one(entity, h);
            }
        }

        let herb_species: Vec<u16> = native_species.iter()
            .filter(|&&s| s >= 300)
            .copied()
            .collect();
        let herb_list = if herb_species.is_empty() { vec![500u16] } else { herb_species };
        let herb_count = (100.0 * area_scale) as i32;
        for i in 0..herb_count {
            let x = ((i as i64 * 13 + 5) % w as i64) as i32;
            let z = ((i as i64 * 19 + 3) % d as i64) as i32;
            if self.terrain.is_water_surface(x, z) { continue; }
            let y = self.terrain.spawn_height(x, z);

            let species_id = herb_list[i as usize % herb_list.len()];
            let harvestable = self.resources.species_db.get_plant(species_id)
                .and_then(|s| Harvestable::from_species(species_id, s.harvest_item_id, s.harvest_amount));
            let eid = EntityId(self.next_entity_id);
            self.next_entity_id += 1;

            let mut plant = Plant::new_seed(species_id);
            plant.growth_stage = ff_ecs::components::plant::GrowthStage::Mature;
            plant.growth_points = 10000.0;

            let entity = self.ecs_world.spawn((
                NetworkId(eid),
                Position(Vec3::new(x as f32, y, z as f32)),
                Rotation(0.0),
                plant,
            ));
            if let Some(h) = harvestable {
                let _ = self.ecs_world.insert_one(entity, h);
            }
        }

        // Extra lavender fields for France (regions 7-10, especially Provence=7)
        if self.region_index >= 7 && self.region_index <= 10 {
            let lavender_count = if self.region_index == 7 { (300.0 * area_scale) as i32 } else { (120.0 * area_scale) as i32 };
            let lavender_harvestable = self.resources.species_db.get_plant(301)
                .and_then(|s| Harvestable::from_species(301, s.harvest_item_id, s.harvest_amount));
            for i in 0..lavender_count {
                let x = ((i as i64 * 11 + 7) % w as i64) as i32;
                let z = ((i as i64 * 17 + 13) % d as i64) as i32;
                if self.terrain.is_water_surface(x, z) { continue; }
                let y = self.terrain.spawn_height(x, z);

                let eid = EntityId(self.next_entity_id);
                self.next_entity_id += 1;

                let mut plant = Plant::new_seed(301); // Lavender
                plant.growth_stage = ff_ecs::components::plant::GrowthStage::Mature;
                plant.growth_points = 8000.0;

                let entity = self.ecs_world.spawn((
                    NetworkId(eid),
                    Position(Vec3::new(x as f32, y, z as f32)),
                    Rotation(0.0),
                    plant,
                ));
                if let Some(h) = lavender_harvestable {
                    let _ = self.ecs_world.insert_one(entity, h);
                }
            }
        }

        let chicken_count = (3.0 * area_scale) as i32;
        for i in 0..chicken_count {
            let x = ((i as i64 * 29 + 40) % w as i64) as i32;
            let z = ((i as i64 * 41 + 60) % d as i64) as i32;
            if self.terrain.is_water_surface(x, z) { continue; }
            let y = self.terrain.spawn_height(x, z);

            let eid = EntityId(self.next_entity_id);
            self.next_entity_id += 1;

            self.ecs_world.spawn((
                NetworkId(eid),
                Position(Vec3::new(x as f32, y, z as f32)),
                Rotation(0.0),
                Velocity(Vec3::ZERO),
                Collider {
                    half_extents: Vec3::new(0.3, 0.3, 0.3),
                },
                Grounded(true),
                Animal {
                    species_id: 10,
                    behavior: AnimalBehavior::Wandering,
                    hunger: 0.3,
                    energy: 0.8,
                },
                Domesticated {
                    pen_center: Vec3::new(x as f32, y, z as f32),
                    pen_radius: 30.0,
                },
            ));
        }

        let deer_count = (2.0 * area_scale) as i32;
        for i in 0..deer_count {
            let x = ((i as i64 * 47 + 10) % w as i64) as i32;
            let z = ((i as i64 * 53 + 20) % d as i64) as i32;
            if self.terrain.is_water_surface(x, z) { continue; }
            let y = self.terrain.spawn_height(x, z);

            let eid = EntityId(self.next_entity_id);
            self.next_entity_id += 1;

            self.ecs_world.spawn((
                NetworkId(eid),
                Position(Vec3::new(x as f32, y, z as f32)),
                Rotation(0.0),
                Velocity(Vec3::ZERO),
                Collider {
                    half_extents: Vec3::new(0.5, 0.8, 0.5),
                },
                Grounded(true),
                Animal {
                    species_id: 21,
                    behavior: AnimalBehavior::Wandering,
                    hunger: 0.2,
                    energy: 0.9,
                },
                ff_ecs::components::animal::WildAnimal,
            ));
        }

        // Wild boar
        let boar_count = (1.0 * area_scale) as i32;
        for i in 0..boar_count {
            let x = ((i as i64 * 59 + 30) % w as i64) as i32;
            let z = ((i as i64 * 61 + 45) % d as i64) as i32;
            if self.terrain.is_water_surface(x, z) { continue; }
            let y = self.terrain.spawn_height(x, z);

            let eid = EntityId(self.next_entity_id);
            self.next_entity_id += 1;

            self.ecs_world.spawn((
                NetworkId(eid),
                Position(Vec3::new(x as f32, y, z as f32)),
                Rotation(0.0),
                Velocity(Vec3::ZERO),
                Collider {
                    half_extents: Vec3::new(0.4, 0.5, 0.4),
                },
                Grounded(true),
                Animal {
                    species_id: 22,
                    behavior: AnimalBehavior::Wandering,
                    hunger: 0.3,
                    energy: 0.8,
                },
                ff_ecs::components::animal::WildAnimal,
            ));
        }

        // Rabbits
        let rabbit_count = (3.0 * area_scale) as i32;
        for i in 0..rabbit_count {
            let x = ((i as i64 * 43 + 15) % w as i64) as i32;
            let z = ((i as i64 * 67 + 25) % d as i64) as i32;
            if self.terrain.is_water_surface(x, z) { continue; }
            let y = self.terrain.spawn_height(x, z);

            let eid = EntityId(self.next_entity_id);
            self.next_entity_id += 1;

            self.ecs_world.spawn((
                NetworkId(eid),
                Position(Vec3::new(x as f32, y, z as f32)),
                Rotation(0.0),
                Velocity(Vec3::ZERO),
                Collider {
                    half_extents: Vec3::new(0.15, 0.2, 0.15),
                },
                Grounded(true),
                Animal {
                    species_id: 31,
                    behavior: AnimalBehavior::Wandering,
                    hunger: 0.2,
                    energy: 0.9,
                },
                ff_ecs::components::animal::WildAnimal,
            ));
        }

        // Lambs
        let lamb_count = (2.0 * area_scale) as i32;
        for i in 0..lamb_count {
            let x = ((i as i64 * 71 + 50) % w as i64) as i32;
            let z = ((i as i64 * 73 + 35) % d as i64) as i32;
            if self.terrain.is_water_surface(x, z) { continue; }
            let y = self.terrain.spawn_height(x, z);

            let eid = EntityId(self.next_entity_id);
            self.next_entity_id += 1;

            self.ecs_world.spawn((
                NetworkId(eid),
                Position(Vec3::new(x as f32, y, z as f32)),
                Rotation(0.0),
                Velocity(Vec3::ZERO),
                Collider {
                    half_extents: Vec3::new(0.3, 0.5, 0.3),
                },
                Grounded(true),
                Animal {
                    species_id: 30,
                    behavior: AnimalBehavior::Wandering,
                    hunger: 0.2,
                    energy: 0.85,
                },
                Domesticated {
                    pen_center: Vec3::new(x as f32, y, z as f32),
                    pen_radius: 40.0,
                },
            ));
        }

        tracing::info!(
            "Spawned ecosystem: region={} native={} herbs={} chickens={} deer={} boar={} rabbit={} lamb={} (scale {:.1}x)",
            self.region_index, native_count, herb_count, chicken_count, deer_count,
            boar_count, rabbit_count, lamb_count, area_scale
        );
    }

    pub fn replace_terrain(&mut self, terrain: VoxelWorld, terrain_bytes: Vec<u8>, region_index: u8) {
        self.region_index = region_index;
        let w = terrain.width as usize;
        let d = terrain.depth as usize;
        self.soil_grid = SoilGrid::new(w, d, SOIL_LAYERS);
        self.terrain = terrain;
        self.terrain_bytes = terrain_bytes;
        self.ecs_world.clear();
        self.next_entity_id = 1000;
        self.spawn_initial_ecosystem();
    }

    /// Run one ECS tick. Borrows fields separately to satisfy the borrow checker.
    pub fn tick(&mut self) -> ff_ecs::systems::TickResult {
        let result = ff_ecs::systems::run_tick(
            &mut self.ecs_world,
            &mut self.resources,
            &mut self.soil_grid,
            &self.terrain,
        );

        // House AI decides at ~2 Hz. Separate field borrows keep this legal.
        if self.resources.calendar.tick.0 % 10 == 0 {
            ff_ecs::systems::house_ai::run(
                &mut self.ecs_world,
                &mut self.terrain,
                &self.resources,
                &mut self.house_brain,
                &mut self.next_entity_id,
            );
            // Best-effort persist so the brain keeps improving across restarts.
            if let Some(path) = &self.brain_model_path {
                if self.house_brain.steps > 0 && self.house_brain.steps % 4000 == 0 {
                    if let Ok(bytes) = serde_json::to_vec(&self.house_brain) {
                        let _ = std::fs::write(path, bytes);
                    }
                }
            }
        }

        // AI faction: collective objective + per-world register (md/07 §7).
        if self.resources.calendar.tick.0 % 20 == 0 {
            self.tick_ai_faction();
        }

        result
    }

    /// The AI faction's collective behaviour (md/07 §7). Pools the native
    /// AI-faction agents' machine intelligence into one meter and applies the
    /// per-world register:
    ///   • **Peaceful** — *companion*: the faction never ascends; its members'
    ///     intelligence is gently capped so they stay helpful (their reward is
    ///     productivity, set in `house_ai::role_score`).
    ///   • **Realistic / Survival** — *ascendancy*: the meter climbs, and when
    ///     the collective crosses the takeover threshold an **AI Ascendancy**
    ///     event fires once (reusing the dramatic takeover banner).
    fn tick_ai_faction(&mut self) {
        use ff_common::GameMode;
        use ff_ecs::components::player::{Monarch, NativeAi, AiMemory, AI_TAKEOVER_THRESHOLD};

        let peaceful = self.resources.game_mode == GameMode::Peaceful;

        // Gather the faction's bodies (native AI-faction agents, role == 3).
        let mut sum = 0.0_f32;
        let mut count = 0u32;
        let mut deployments = 0u32;
        let nyx: Vec<hecs::Entity> = self
            .ecs_world
            .query::<(&NativeAi, &AiMemory, &Monarch)>()
            .iter()
            .filter(|(_, (_, mem, _))| mem.role == 3)
            .map(|(e, (_, _, m))| {
                sum += m.ai_intelligence;
                deployments += m.deployments;
                count += 1;
                e
            })
            .collect();

        if count == 0 {
            return;
        }

        // Peaceful companion: bleed the meter down so the faction stays benign.
        if peaceful {
            for e in &nyx {
                if let Ok(mut m) = self.ecs_world.get::<&mut Monarch>(*e) {
                    m.ai_intelligence = (m.ai_intelligence * 0.9 - 1.0).max(0.0);
                }
            }
            self.faction_intelligence = (self.faction_intelligence * 0.9).max(0.0);
            return;
        }

        self.faction_intelligence = sum / count as f32;

        // Heartbeat so the collective climb is observable (~every 10 s).
        if self.resources.calendar.tick.0 % 200 == 0 {
            tracing::info!(
                "🤖 AI faction: collective intelligence {:.1}/{:.0} across {count} bodies",
                self.faction_intelligence, AI_TAKEOVER_THRESHOLD
            );
        }

        if !self.faction_ascended && self.faction_intelligence >= AI_TAKEOVER_THRESHOLD {
            self.faction_ascended = true;
            tracing::warn!(
                "🤖 AI ASCENDANCY — the faction's collective intelligence reached {:.0} across {count} bodies ({deployments} deployments)",
                self.faction_intelligence
            );
            // Reuse the dramatic takeover banner, framed as the faction.
            let bc = ff_protocol::messages::ServerAiTakeover {
                former_monarch_id: ff_common::PlayerId(0),
                former_monarch_name: "The AI Faction (Nyx)".into(),
                deployments,
                jobs_cut: 0,
            };
            if let Ok(buf) =
                ff_protocol::codec::encode(ff_protocol::messages::MessageType::ServerAiTakeover, &bc)
            {
                for session in self.sessions.values() {
                    session.send(buf.clone());
                }
            }
        }
    }

    /// Process a player action. Borrows fields separately.
    pub fn process_action(
        &mut self,
        player_entity: hecs::Entity,
        player_id: PlayerId,
        action: &ff_protocol::ActionKind,
    ) -> ff_ecs::systems::interaction::ActionResult {
        ff_ecs::systems::interaction::process_action(
            &mut self.ecs_world,
            &mut self.terrain,
            &self.resources,
            player_entity,
            player_id,
            action,
            &mut self.next_entity_id,
        )
    }
}
