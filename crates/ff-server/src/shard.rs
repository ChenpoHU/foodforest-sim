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
use std::collections::HashMap;
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
    pub region_index: u8,
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
            region_index,
        };

        // Spawn some initial plants and animals
        shard.spawn_initial_ecosystem();

        Arc::new(Mutex::new(shard))
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

    /// Remove a player from the shard.
    pub fn remove_player(&mut self, player_id: PlayerId) {
        self.sessions.remove(&player_id);

        // Find and despawn the player entity
        let mut to_despawn = Vec::new();
        for (entity, player) in self.ecs_world.query_mut::<&Player>() {
            if player.player_id == player_id {
                to_despawn.push(entity);
            }
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
        ff_ecs::systems::run_tick(
            &mut self.ecs_world,
            &mut self.resources,
            &mut self.soil_grid,
            &self.terrain,
        )
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
