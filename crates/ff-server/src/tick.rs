//! Fixed-timestep game loop: runs ECS systems, builds entity updates, broadcasts.

use crate::shard::Shard;
use ff_common::{EntityId, Tick, TICK_DT, TICK_RATE, NET_SEND_INTERVAL};
use ff_ecs::components::identity::NetworkId;
use ff_ecs::components::transform::Position;
use ff_protocol::codec::encode;
use ff_protocol::messages::*;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;
use tracing::{info, warn};

/// Run the fixed-timestep tick loop at TICK_RATE Hz.
pub async fn run_tick_loop(shard: Arc<Mutex<Shard>>) {
    let tick_duration = Duration::from_secs_f32(TICK_DT);
    let mut tick_count: u64 = 0;
    let mut last_stats = Instant::now();

    info!("Tick loop started at {} Hz", TICK_RATE);

    loop {
        let tick_start = Instant::now();

        {
            let mut shard = shard.lock().await;

            let tick_result = shard.tick();

            for msg in &tick_result.messages {
                let chat = ServerChat {
                    sender: ff_common::PlayerId(0),
                    sender_name: "[World]".into(),
                    message: msg.text.clone(),
                };
                if let Ok(buf) = encode(MessageType::ServerChat, &chat) {
                    for session in shard.sessions.values() {
                        session.send(buf.clone());
                    }
                }
            }

            for eid in &tick_result.despawned {
                let despawn = ServerEntityDespawn { entity_id: *eid };
                if let Ok(buf) = encode(MessageType::ServerEntityDespawn, &despawn) {
                    for session in shard.sessions.values() {
                        session.send(buf.clone());
                    }
                }
            }

            // Aurona's Fate Oracle: catch any Farmer who just died and sing
            // them their fate (offering the brain-chip escape).
            check_fate_oracle(&mut shard);

            if tick_count % NET_SEND_INTERVAL as u64 == 0 {
                broadcast_updates(&mut shard);
            }
        }

        tick_count += 1;

        // Stats logging every 10 seconds
        if last_stats.elapsed() > Duration::from_secs(10) {
            let shard = shard.lock().await;
            let tick_ms = tick_start.elapsed().as_secs_f64() * 1000.0;
            info!(
                "Shard {:?}: tick {} | {:.1}ms/tick | {} players | {} entities",
                shard.id,
                tick_count,
                tick_ms,
                shard.sessions.len(),
                shard.ecs_world.len(),
            );
            last_stats = Instant::now();
        }

        // Sleep for remaining tick time
        let elapsed = tick_start.elapsed();
        if elapsed < tick_duration {
            tokio::time::sleep(tick_duration - elapsed).await;
        } else {
            // Tick took too long — skip sleep (server is overloaded)
            warn!(
                "Tick overrun: {:.1}ms (budget: {:.1}ms)",
                elapsed.as_secs_f64() * 1000.0,
                tick_duration.as_secs_f64() * 1000.0,
            );
        }
    }
}

/// Build a full `EntitySnapshot` (kind + state + transform) for one
/// entity. Shared by the initial world-state build and the incremental
/// new-entity spawn broadcast so both produce identical metadata.
fn build_entity_snapshot(
    world: &hecs::World,
    e: hecs::Entity,
    entity_id: EntityId,
) -> EntitySnapshot {
    let pos = world
        .get::<&Position>(e)
        .map(|p| [p.0.x, p.0.y, p.0.z])
        .unwrap_or([0.0, 0.0, 0.0]);
    let rot = world
        .get::<&ff_ecs::components::transform::Rotation>(e)
        .map(|r| r.0)
        .unwrap_or(0.0);

    let kind = if let Ok(plant) = world.get::<&ff_ecs::components::plant::Plant>(e) {
        EntityKind::Plant { species_id: plant.species_id }
    } else if let Ok(animal) = world.get::<&ff_ecs::components::animal::Animal>(e) {
        EntityKind::Animal { species_id: animal.species_id }
    } else if let Ok(structure) = world.get::<&ff_ecs::components::identity::Structure>(e) {
        EntityKind::Structure { kind: structure.kind }
    } else if world.get::<&ff_ecs::components::ai_agent::SemiAIWorker>(e).is_ok() {
        EntityKind::SemiAI
    } else {
        EntityKind::Player
    };

    let state = if let Ok(plant) = world.get::<&ff_ecs::components::plant::Plant>(e) {
        EntityState::PlantGrowth { stage: plant.growth_stage as u8, health: plant.health }
    } else if let Ok(animal) = world.get::<&ff_ecs::components::animal::Animal>(e) {
        EntityState::AnimalBehavior { behavior: 0, hunger: animal.hunger }
    } else {
        EntityState::Active
    };

    let outfit = world
        .get::<&ff_ecs::components::player::Outfit>(e)
        .map(|o| o.0)
        .unwrap_or(0);

    EntitySnapshot { entity_id, kind, position: pos, rotation: rot, state, outfit }
}

/// Build and broadcast entity position updates to all connected players.
fn broadcast_updates(shard: &mut Shard) {
    let tick = shard.resources.calendar.tick;

    // ── Announce NEW entities ────────────────────────────────────────
    // Any entity whose id exceeds the watermark was created after the
    // last broadcast (a planted seed, a deployed drone, a newly joined
    // player, …). Send a ServerEntitySpawn for each so clients render
    // the correct mesh instead of the gray fallback sphere. Without
    // this, the periodic batch update only carries positions and the
    // client never learns the entity's kind.
    {
        let mut new_spawns: Vec<(u64, EntitySnapshot)> = Vec::new();
        for (e, net_id) in shard
            .ecs_world
            .query::<&NetworkId>()
            .iter()
        {
            if net_id.0 .0 > shard.announced_max_entity_id {
                new_spawns.push((net_id.0 .0, build_entity_snapshot(&shard.ecs_world, e, net_id.0)));
            }
        }
        if !new_spawns.is_empty() {
            let mut max_id = shard.announced_max_entity_id;
            for (id, snap) in new_spawns {
                if id > max_id { max_id = id; }
                let spawn = ServerEntitySpawn { entity: snap };
                if let Ok(buf) = encode(MessageType::ServerEntitySpawn, &spawn) {
                    for session in shard.sessions.values() {
                        session.send(buf.clone());
                    }
                }
            }
            shard.announced_max_entity_id = max_id;
        }
    }

    // ── Re-announce plants that changed growth stage ─────────────────
    // ~2 Hz. A plant advancing from Seed→…→Fruiting needs the client to
    // rescale its mesh + reveal fruit, but the batch update carries no
    // stage. We re-send a spawn (which carries the stage) only for
    // plants whose stage actually changed since we last saw it. New
    // plants are recorded silently the first time (the client already
    // learned them via the spawn broadcast above or the world state).
    if tick.0 % 10 == 0 {
        let mut snapshot: Vec<(u64, u8, hecs::Entity, EntityId)> = Vec::new();
        for (e, (net_id, plant)) in shard
            .ecs_world
            .query::<(&NetworkId, &ff_ecs::components::plant::Plant)>()
            .iter()
        {
            snapshot.push((net_id.0 .0, plant.growth_stage as u8, e, net_id.0));
        }
        let mut changed: Vec<(hecs::Entity, EntityId)> = Vec::new();
        for (id, stage, e, eid) in snapshot {
            match shard.plant_stage_seen.get(&id) {
                Some(&seen) if seen == stage => {}
                Some(_) => {
                    shard.plant_stage_seen.insert(id, stage);
                    changed.push((e, eid));
                }
                None => {
                    // First time we track this plant — record without a
                    // resend (client already knows its current stage).
                    shard.plant_stage_seen.insert(id, stage);
                }
            }
        }
        for (e, eid) in changed {
            let snap = build_entity_snapshot(&shard.ecs_world, e, eid);
            let spawn = ServerEntitySpawn { entity: snap };
            if let Ok(buf) = encode(MessageType::ServerEntitySpawn, &spawn) {
                for session in shard.sessions.values() {
                    session.send(buf.clone());
                }
            }
        }
    }

    // Collect entity updates
    let mut updates = Vec::new();
    for (_entity, (net_id, pos)) in shard
        .ecs_world
        .query::<(&NetworkId, &Position)>()
        .iter()
    {
        let rot = shard
            .ecs_world
            .get::<&ff_ecs::components::transform::Rotation>(_entity)
            .map(|r| r.0)
            .unwrap_or(0.0);

        let grounded = shard
            .ecs_world
            .get::<&ff_ecs::components::physics::Grounded>(_entity)
            .map(|g| g.0)
            .unwrap_or(false);

        let mut flags: u8 = 0;
        if grounded {
            flags |= 1;
        }

        if let Ok(felling) = shard.ecs_world.get::<&ff_ecs::components::plant::TreeFelling>(_entity) {
            use ff_ecs::components::plant::FellingPhase;
            match felling.phase {
                FellingPhase::Cutting => flags |= 0x04,
                FellingPhase::Falling => flags |= 0x08,
                FellingPhase::Collapsed => flags |= 0x10,
            }
        }

        if shard.ecs_world.get::<&ff_ecs::components::plant::Crushed>(_entity).is_ok()
            || shard.ecs_world.get::<&ff_ecs::components::player::Dead>(_entity).is_ok()
        {
            flags |= 0x20;
        }

        if shard.ecs_world.get::<&ff_ecs::components::plant::Burning>(_entity).is_ok() {
            flags |= 0x40;
        }

        // Chipped — a Tech-Monarch's asset (Aurona Oracle). 0x80 marks the
        // avatar so everyone sees who's owned, and Innovators can de-chip them.
        if shard.ecs_world.get::<&ff_ecs::components::player::MonarchAsset>(_entity).is_ok() {
            flags |= 0x80;
        }

        updates.push(ServerEntityUpdate {
            entity_id: net_id.0,
            position: [pos.0.x, pos.0.y, pos.0.z],
            rotation: rot,
            state_flags: flags,
        });
    }

    let batch = ServerBatchUpdate { tick, updates };

    if let Ok(buf) = encode(MessageType::ServerBatchUpdate, &batch) {
        for session in shard.sessions.values() {
            session.send(buf.clone());
        }
    }

    // Push per-player state (inventory, stamina, hunger, coins) every 10
    // ticks (~0.5 s) as a steady heartbeat. Action handlers in ws.rs also
    // call `send_player_state` directly so the player sees their stack
    // update the same instant their Harvest/Eat/Sell succeeds.
    if tick.0 % 10 == 0 {
        ensure_wallets(shard);
        let player_ids: Vec<ff_common::PlayerId> = shard.sessions.keys().copied().collect();
        for pid in player_ids {
            send_player_state(shard, pid);
        }
    }

    // Tech-Monarch surveillance feed: 1 Hz roster of every connected
    // farmer's observable state. Skipped entirely when no monarch is
    // online, which is the common case.
    if tick.0 % 20 == 0 {
        broadcast_surveillance(shard);
    }

    // 1 Hz politics broadcast — public roster of every Monarch with
    // their discontent + AI-intelligence meters, so Farmers can pick
    // revolt targets. Also runs the threshold checks that auto-demote
    // monarchs (overthrow / AI takeover) — those need to fire
    // server-side without waiting for a player action.
    if tick.0 % 20 == 0 {
        check_political_thresholds(shard);
        broadcast_politics(shard);
        // Innovators slowly accrue Knowledge passively (their "lab"
        // ticking away) so the role isn't pure button-mashing — they
        // can roam, study the ecosystem, and watch for catastrophes.
        // Field-study (clicking living things) is still the fast path.
        for (_e, inv) in shard
            .ecs_world
            .query::<&mut ff_ecs::components::player::Innovator>()
            .iter()
        {
            inv.knowledge = (inv.knowledge + 1.0)
                .min(ff_ecs::components::player::KNOWLEDGE_CAP);
        }
    }

    // World Board — refresh every parallel Earth's stats for all players
    // ~every 5 s so the dashboard stays live (population shifts as players
    // join / leave / leap between Earths).
    if tick.0 % 100 == 0 {
        broadcast_world_board(shard);
    }

    // Persist all players to disk every ~30 s so progress survives a crash,
    // not just a graceful disconnect — "play later" should mean it.
    if tick.0 % 600 == 0 && tick.0 > 0 {
        shard.snapshot_live_players();
        if let Err(e) = crate::persistence::save_players(
            &crate::persistence::players_path(),
            &shard.persistent_state,
        ) {
            tracing::warn!("Periodic player save failed: {e}");
        }
    }

    // Catastrophe broadcast — push the current state to everyone
    // either every second OR whenever the catastrophe just changed
    // (start / end / intensity flip).
    let cat = shard.resources.catastrophe;
    let dirty = cat.dirty;
    let periodic = tick.0 % 20 == 0;
    if dirty || periodic {
        shard.resources.catastrophe.dirty = false;
        shard.resources.catastrophe.last_broadcast_tick = tick.0;
        let kind_u8 = cat.kind as u8;
        let intensity = cat.intensity;
        let ticks_remaining = cat.duration_ticks.saturating_sub(cat.ticks_elapsed);
        let msg = ff_protocol::messages::ServerCatastrophe {
            kind: kind_u8,
            intensity,
            ticks_remaining,
            message: cat.kind.banner_message(intensity),
        };
        if let Ok(buf) = encode(MessageType::ServerCatastrophe, &msg) {
            for session in shard.sessions.values() {
                session.send(buf.clone());
            }
        }
    }
}

/// Walk every connected Monarch and trigger demotion when one crosses
/// the discontent or AI-intelligence threshold. Used by the tick loop;
/// safe to call when no monarchs are online (it just returns fast).
fn check_political_thresholds(shard: &mut Shard) {
    use ff_ecs::components::player::{
        AI_TAKEOVER_THRESHOLD, DISCONTENT_DEMOTION_THRESHOLD,
    };
    // Snapshot decisions so we don't mutate the ECS world while iterating it.
    struct Outcome {
        entity: hecs::Entity,
        player_id: ff_common::PlayerId,
        reason: ff_protocol::messages::RoleChangeReason,
        deployments: u32,
        jobs_cut: u32,
    }
    let mut outcomes: Vec<Outcome> = Vec::new();
    for (entity, (player, monarch)) in shard
        .ecs_world
        .query::<(
            &ff_ecs::components::player::Player,
            &ff_ecs::components::player::Monarch,
        )>()
        .iter()
    {
        // Native AI agents (Magnus the Monarch, Nyx the AI faction) are not
        // human monarchs to overthrow — their arc is the faction system
        // (`Shard::tick_ai_faction`), not this human-politics demotion.
        if shard
            .ecs_world
            .get::<&ff_ecs::components::player::NativeAi>(entity)
            .is_ok()
        {
            continue;
        }
        // AI takeover wins ties (it's the more dramatic outcome).
        if monarch.ai_intelligence >= AI_TAKEOVER_THRESHOLD {
            outcomes.push(Outcome {
                entity,
                player_id: player.player_id,
                reason: ff_protocol::messages::RoleChangeReason::AiTakeover,
                deployments: monarch.deployments,
                jobs_cut: monarch.jobs_cut,
            });
        } else if monarch.discontent >= DISCONTENT_DEMOTION_THRESHOLD {
            outcomes.push(Outcome {
                entity,
                player_id: player.player_id,
                reason: ff_protocol::messages::RoleChangeReason::Overthrown,
                deployments: monarch.deployments,
                jobs_cut: monarch.jobs_cut,
            });
        }
    }
    for o in outcomes {
        // Remove the Monarch component → demotes to Farmer.
        let _ = shard
            .ecs_world
            .remove_one::<ff_ecs::components::player::Monarch>(o.entity);
        // Cancel any tasks they had issued (no escrow to refund).
        let cancelled: Vec<u32> = shard
            .active_tasks
            .iter()
            .filter(|(_, t)| t.monarch_id == o.player_id)
            .map(|(id, _)| *id)
            .collect();
        for id in &cancelled {
            shard.active_tasks.remove(id);
            shard
                .task_progress
                .retain(|(tid, _), _| *tid != *id);
        }
        let player_name = shard
            .sessions
            .get(&o.player_id)
            .map(|s| s.player_name.clone())
            .unwrap_or_else(|| "?".into());
        // ServerRoleChanged → tells everyone, including the demoted
        // player whose client flips their toolbar back to Farmer.
        let change = ff_protocol::messages::ServerRoleChanged {
            player_id: o.player_id,
            player_name: player_name.clone(),
            new_role: 0,
            reason: o.reason,
        };
        if let Ok(buf) = encode(MessageType::ServerRoleChanged, &change) {
            for session in shard.sessions.values() {
                session.send(buf.clone());
            }
        }
        // For AI takeover specifically, also send the dramatic banner.
        if o.reason == ff_protocol::messages::RoleChangeReason::AiTakeover {
            let bc = ff_protocol::messages::ServerAiTakeover {
                former_monarch_id: o.player_id,
                former_monarch_name: player_name,
                deployments: o.deployments,
                jobs_cut: o.jobs_cut,
            };
            if let Ok(buf) = encode(MessageType::ServerAiTakeover, &bc) {
                for session in shard.sessions.values() {
                    session.send(buf.clone());
                }
            }
        }
        // Refresh the now-Farmer's HUD so coins/role flip instantly.
        send_player_state(shard, o.player_id);
    }
}

/// Build the public politics roster and push it to every session at 1 Hz.
fn broadcast_politics(shard: &mut Shard) {
    let mut monarchs: Vec<ff_protocol::messages::PoliticsRow> = Vec::new();
    for (_e, (player, monarch)) in shard
        .ecs_world
        .query::<(
            &ff_ecs::components::player::Player,
            &ff_ecs::components::player::Monarch,
        )>()
        .iter()
    {
        // Only surface Monarchs whose session is actually connected —
        // dangling components from a crashed flow would otherwise
        // pollute the list.
        if !shard.sessions.contains_key(&player.player_id) {
            continue;
        }
        let name = shard
            .sessions
            .get(&player.player_id)
            .map(|s| s.player_name.clone())
            .unwrap_or_default();
        monarchs.push(ff_protocol::messages::PoliticsRow {
            player_id: player.player_id,
            player_name: name,
            discontent: monarch.discontent,
            ai_intelligence: monarch.ai_intelligence,
            deployments: monarch.deployments,
            jobs_cut: monarch.jobs_cut,
            welfare: monarch.welfare,
        });
    }
    let msg = ff_protocol::messages::ServerPoliticsUpdate {
        tick: shard.resources.calendar.tick,
        monarchs,
    };
    if let Ok(buf) = encode(MessageType::ServerPoliticsUpdate, &msg) {
        for session in shard.sessions.values() {
            session.send(buf.clone());
        }
    }
}

/// The catalog of worlds on the World Board. `realm_id 0` is **Base Earth** —
/// the all-AI simulation of the real, current planet (spinning off AI versions
/// of real figures: Elon Musk, Peter Thiel, …). It is **not playable**: it only
/// simulates reality, the "before" that everything else forks from. Every other
/// entry is a **fork of Base Earth** — a fresh timeline of the same planet that
/// players settle and shape. Forks carry NO authored stats: their vital signs
/// **emerge from what players do there** (see `live_metrics`). Fields:
/// `(realm_id, name, is_origin, playable, notable_figures)`.
const EARTH_CATALOG: &[(u32, &str, bool, bool, &[&str])] = &[
    (0, "Base Earth", true, false,
        &["Elon Musk", "Peter Thiel", "Sam Altman", "Mark Zuckerberg", "Jensen Huang", "Sundar Pichai"]),
    (1, "Terra Nova", false, true, &[]),
    (2, "Gaia Prime", false, true, &[]),
    (3, "New Eden",   false, true, &[]),
    (4, "Arcadia",    false, true, &[]),
    (5, "Verdant",    false, true, &[]),
    (6, "Elysium",    false, true, &[]),
    (7, "Concord",    false, true, &[]),
];

// Base Earth — the simulation of reality: teeming, AI-ascendant, biosphere
// strained, humans losing ground. The cautionary "before".
const BASE_POP: u64 = 8_100_000_000;
const BASE_HEALTH: u8 = 30;
const BASE_CIV: u8 = 6; // Synthetic
const BASE_AI: u8 = 85;
const BASE_COEX: u8 = 22;

// A fresh, unsettled fork of Base Earth — a blank timeline waiting for its
// first settlers. Recovering wilderness, no civilisation or AI yet. Once
// players arrive its numbers come from `live_metrics`, not these.
const FORK_HEALTH: u8 = 64;
const FORK_CIV: u8 = 0;
const FORK_AI: u8 = 6;
const FORK_COEX: u8 = 58;

/// A fork is flagged "crowded" past this many live settlers — the nudge to spin
/// up a new parallel fork.
const CROWD_THRESHOLD: u64 = 50;

/// The realm a fresh player defaults to — the first *playable* fork (Base Earth
/// is observe-only, so it's skipped).
pub fn default_playable_realm() -> u32 {
    EARTH_CATALOG.iter().find(|e| e.3).map(|e| e.0).unwrap_or(1)
}

/// Whether `realm` is a world players may actually live in. Base Earth is not.
/// Realms beyond the static catalog are assumed playable (forward-compat with
/// dynamically-spawned forks).
pub fn is_realm_playable(realm: u32) -> bool {
    match EARTH_CATALOG.iter().find(|e| e.0 == realm) {
        Some(e) => e.3,
        None => true,
    }
}

/// A world's vital signs, computed live from the simulation.
struct LiveMetrics {
    health: u8,
    civ_stage: u8,
    ai_status: u8,
    coexistence: u8,
}

/// Read a world's vital signs straight out of the ECS — they **emerge from what
/// players have done**, they aren't authored. Heal the land and biosphere rises;
/// build and settle and civilisation rises; let a Monarch + machines dominate
/// and AI rises; the **coexistence** index (the game's goal) rewards a living
/// world where humans *and* AI both make it without one crushing the other.
fn live_metrics(shard: &Shard) -> LiveMetrics {
    use ff_ecs::components::{ai_agent, animal, identity, plant, player};
    let w = &shard.ecs_world;

    // Biosphere — living vegetation + wildlife, hurt by active fires.
    let mut plants_alive = 0i32;
    let mut burning = 0i32;
    for (_e, (_p, crushed, burn)) in w
        .query::<(
            &plant::Plant,
            Option<&plant::Crushed>,
            Option<&plant::Burning>,
        )>()
        .iter()
    {
        if crushed.is_none() {
            plants_alive += 1;
        }
        if burn.is_some() {
            burning += 1;
        }
    }
    let animals = w.query::<&animal::Animal>().iter().count() as i32;
    let health = ((plants_alive + animals * 2) / 2 - burning * 4).clamp(3, 100) as u8;

    // Civilisation — people, what they've built, accumulated wealth.
    let mut players = 0u32;
    let mut wealth = 0u32;
    for (_e, (_p, wallet)) in w
        .query::<(&player::Player, Option<&player::Wallet>)>()
        .iter()
    {
        players += 1;
        if let Some(wal) = wallet {
            wealth = wealth.saturating_add(wal.0);
        }
    }
    let structures = w.query::<&identity::Structure>().iter().count() as u32;
    let civ_score = players * 6 + structures * 2 + wealth / 200;
    let civ_stage = match civ_score {
        0 => 0,
        1..=8 => 1,
        9..=25 => 2,
        26..=60 => 3,
        61..=120 => 4,
        121..=240 => 5,
        _ => 6,
    };

    // AI ascendancy — strongest machine intelligence + its reach (workers,
    // chipped humans, AI-piloted players).
    let mut max_ai = 0.0f32;
    let mut total_welfare = 0.0f32;
    for (_e, m) in w.query::<&player::Monarch>().iter() {
        if m.ai_intelligence > max_ai {
            max_ai = m.ai_intelligence;
        }
        total_welfare += m.welfare;
    }
    let workers = w.query::<&ai_agent::SemiAIWorker>().iter().count() as i32;
    let chipped = w.query::<&player::MonarchAsset>().iter().count() as u32;
    let ai_players = w.query::<&player::AiControlled>().iter().count() as u32;
    let ai_status =
        (max_ai as i32 + workers * 4 + chipped as i32 * 8 + ai_players as i32 * 6).clamp(0, 100) as u8;

    // Coexistence — the GOAL: do humans AND AI both survive here? High when the
    // biosphere lives, humans are present and un-chipped, and AI is present but
    // not domineering. This is the number the whole game tries to maximise.
    let humans = players.saturating_sub(ai_players);
    let human_freedom = if humans == 0 {
        0
    } else {
        let chipped_ratio = (chipped as f32 / humans as f32).min(1.0);
        (100.0 * (1.0 - chipped_ratio)) as i32
    };
    let ai_balance = (100 - (ai_status as i32 - 45).abs() * 3 / 2).clamp(0, 100);

    // Economic security — does automation free people or displace them? Each AI
    // worker displaces human labour; the Monarchs' welfare (shared UBI gains)
    // cushions it. No automation → fully secure; heavy automation with no
    // sharing → people are dispossessed.
    let pressure = (workers as f32 / humans.max(1) as f32).min(1.5);
    let displacement = (pressure * 60.0).min(90.0);
    let cushion = total_welfare.min(displacement);
    let economic_security = (100.0 - displacement + cushion).clamp(10.0, 100.0) as i32;

    let coexistence =
        ((health as i32 + human_freedom + ai_balance + economic_security) / 4).clamp(0, 100) as u8;

    LiveMetrics { health, civ_stage, ai_status, coexistence }
}

/// Assemble the World Board: Base Earth (fixed reality) plus its forks, whose
/// vital signs **emerge from live play** once they have settlers.
pub fn build_world_board(shard: &Shard) -> ff_protocol::messages::ServerWorldBoard {
    use std::collections::HashMap;

    // Live souls per realm, from the connected sessions.
    let mut live_total: HashMap<u32, u64> = HashMap::new();
    let mut live_ai: HashMap<u32, u64> = HashMap::new();
    for s in shard.sessions.values() {
        *live_total.entry(s.realm_id).or_insert(0) += 1;
        if s.is_ai {
            *live_ai.entry(s.realm_id).or_insert(0) += 1;
        }
    }
    // The lived-in world's emergent vital signs (one shared sim in this
    // process; applied to whichever fork actually has settlers).
    let live = live_metrics(shard);

    let earths = EARTH_CATALOG
        .iter()
        .map(|&(realm_id, name, is_origin, playable, notable)| {
            let lt = *live_total.get(&realm_id).unwrap_or(&0);
            let la = *live_ai.get(&realm_id).unwrap_or(&0);
            let (population, ai_players, health, civ_stage, ai_status, coexistence) = if is_origin {
                // Base Earth — the fixed simulation of reality.
                (BASE_POP, BASE_POP, BASE_HEALTH, BASE_CIV, BASE_AI, BASE_COEX)
            } else if lt > 0 {
                // A settled fork: its vital signs are whatever its players made.
                (lt, la, live.health, live.civ_stage, live.ai_status, live.coexistence)
            } else {
                // A fresh, unsettled fork — a blank timeline of Base Earth.
                (0, 0, FORK_HEALTH, FORK_CIV, FORK_AI, FORK_COEX)
            };
            ff_protocol::messages::EarthMeta {
                realm_id,
                name: name.to_string(),
                population,
                ai_players,
                health,
                civ_stage,
                ai_status,
                coexistence,
                is_origin,
                crowded: lt > CROWD_THRESHOLD,
                playable,
                notable: notable.iter().map(|s| s.to_string()).collect(),
            }
        })
        .collect();

    ff_protocol::messages::ServerWorldBoard { earths }
}

/// Push the World Board to every connected player.
fn broadcast_world_board(shard: &mut Shard) {
    let board = build_world_board(shard);
    if let Ok(buf) = encode(MessageType::ServerWorldBoard, &board) {
        for session in shard.sessions.values() {
            session.send(buf.clone());
        }
    }
}

/// Build the Monarch surveillance roster and push it to every connected
/// Tech-Monarch session. No-op when no monarch is online.
fn broadcast_surveillance(shard: &mut Shard) {
    // Find which sessions belong to Monarchs (their player entity carries
    // the Monarch component).
    let mut monarch_player_ids: Vec<ff_common::PlayerId> = Vec::new();
    for (_e, (player, _m)) in shard.ecs_world.query::<(
        &ff_ecs::components::player::Player,
        &ff_ecs::components::player::Monarch,
    )>().iter() {
        if shard.sessions.contains_key(&player.player_id) {
            monarch_player_ids.push(player.player_id);
        }
    }
    if monarch_player_ids.is_empty() {
        return;
    }

    // Build a row per connected player (farmer or monarch — monarchs see
    // themselves in the roster too, so they can verify the feed is live).
    let connected: Vec<(ff_common::PlayerId, String)> = shard
        .sessions
        .iter()
        .map(|(pid, s)| (*pid, s.player_name.clone()))
        .collect();

    let mut rows = Vec::with_capacity(connected.len());
    for (pid, name) in connected {
        // Find the player's entity + components.
        let mut found_entity: Option<hecs::Entity> = None;
        for (entity, player) in shard
            .ecs_world
            .query::<&ff_ecs::components::player::Player>()
            .iter()
        {
            if player.player_id == pid {
                found_entity = Some(entity);
                break;
            }
        }
        let Some(entity) = found_entity else { continue };

        let position = shard
            .ecs_world
            .get::<&ff_ecs::components::transform::Position>(entity)
            .map(|p| [p.0.x, p.0.y, p.0.z])
            .unwrap_or([0.0, 0.0, 0.0]);
        let coins = shard
            .ecs_world
            .get::<&ff_ecs::components::player::Wallet>(entity)
            .map(|w| w.0)
            .unwrap_or(0);
        let stamina = shard
            .ecs_world
            .get::<&ff_ecs::components::player::Stamina>(entity)
            .map(|s| s.0)
            .unwrap_or(0.0);
        let hunger = shard
            .ecs_world
            .get::<&ff_ecs::components::player::Hunger>(entity)
            .map(|h| h.0)
            .unwrap_or(0.0);
        // Role: 0 Farmer, 1 Monarch, 2 Innovator — so the Monarch's
        // surveillance roster distinguishes Innovators (whom they may
        // want to fund) from ordinary farmers.
        let role = if shard
            .ecs_world
            .get::<&ff_ecs::components::player::Monarch>(entity)
            .is_ok()
        {
            1
        } else if shard
            .ecs_world
            .get::<&ff_ecs::components::player::Innovator>(entity)
            .is_ok()
        {
            2
        } else {
            0
        };
        let last_action = shard
            .sessions
            .get(&pid)
            .map(|s| s.last_action.clone())
            .unwrap_or_default();

        rows.push(MonarchSurveillanceRow {
            player_id: pid,
            player_name: name,
            role,
            position,
            coins,
            stamina,
            hunger,
            last_action,
        });
    }

    let msg = ServerMonarchSurveillance {
        tick: shard.resources.calendar.tick,
        rows,
    };
    let Ok(buf) = encode(MessageType::ServerMonarchSurveillance, &msg) else { return };
    for pid in monarch_player_ids {
        if let Some(session) = shard.sessions.get(&pid) {
            session.send(buf.clone());
        }
    }
}

/// Make sure every player entity has a `Wallet` component. Idempotent;
/// missing wallets are inserted as `Wallet(0)`.
pub fn ensure_wallets(shard: &mut Shard) {
    let needs: Vec<hecs::Entity> = shard
        .ecs_world
        .query::<&ff_ecs::components::player::Player>()
        .iter()
        .filter(|(e, _)| {
            shard
                .ecs_world
                .get::<&ff_ecs::components::player::Wallet>(*e)
                .is_err()
        })
        .map(|(e, _)| e)
        .collect();
    for e in needs {
        let _ = shard
            .ecs_world
            .insert_one(e, ff_ecs::components::player::Wallet(0));
    }
}

/// Build and send a fresh `ServerPlayerState` for a single player. Safe
/// to call after any action that mutates inventory / hunger / wallet —
/// the client modal will reflect the change on the next render.
/// Aurona's Fate Oracle: when a Farmer dies (outside Peaceful), sing them the
/// elegy and offer the brain-chip escape. Tracks who's been shown the oracle so
/// it isn't re-sent every tick, and clears the flag once they're alive again.
fn check_fate_oracle(shard: &mut Shard) {
    use ff_ecs::components::player::{Dead, Innovator, Monarch, MonarchAsset, Player};

    // Peaceful keeps its no-casualties promise — no death, no oracle.
    if shard.resources.game_mode == ff_common::GameMode::Peaceful {
        return;
    }

    // Is there a Monarch to own a chipped Farmer? Grab a name for flavour.
    let monarch_name: Option<String> = {
        let mut nm = None;
        for (e, _m) in shard.ecs_world.query::<&Monarch>().iter() {
            if let Ok(pl) = shard.ecs_world.get::<&Player>(e) {
                nm = shard.sessions.get(&pl.player_id).map(|s| s.player_name.clone());
                if nm.is_some() {
                    break;
                }
            }
        }
        nm
    };
    let offer_chip = monarch_name.is_some();
    let monarch_name = monarch_name.unwrap_or_default();

    // Newly-dead Farmers → oracle; revived players → clear the flag.
    let mut to_oracle: Vec<ff_common::PlayerId> = Vec::new();
    let mut revived: Vec<ff_common::PlayerId> = Vec::new();
    for (e, pl) in shard.ecs_world.query::<&Player>().iter() {
        let dead = shard.ecs_world.get::<&Dead>(e).is_ok();
        let known = shard.death_oracled.contains(&pl.player_id);
        if dead && !known {
            // Only Farmers get the Farmer fate (not Monarch / Innovator), and
            // not someone already chipped.
            let is_monarch = shard.ecs_world.get::<&Monarch>(e).is_ok();
            let is_innov = shard.ecs_world.get::<&Innovator>(e).is_ok();
            let already_chipped = shard.ecs_world.get::<&MonarchAsset>(e).is_ok();
            if !is_monarch && !is_innov && !already_chipped {
                to_oracle.push(pl.player_id);
            }
        } else if !dead && known {
            revived.push(pl.player_id);
        }
    }

    for pid in revived {
        shard.death_oracled.remove(&pid);
    }
    for pid in to_oracle {
        shard.death_oracled.insert(pid);
        let oracle = ServerOracle {
            kind: 0,    // a Farmer's death
            song_id: 0, // Strawberry — sweet but deadly
            offer_chip,
            monarch_name: monarch_name.clone(),
        };
        if let Ok(buf) = encode(MessageType::ServerOracle, &oracle) {
            if let Some(s) = shard.sessions.get(&pid) {
                s.send(buf);
            }
        }
    }
}

pub fn send_player_state(shard: &mut Shard, player_id: ff_common::PlayerId) {
    ensure_wallets(shard);
    let Some(session) = shard.sessions.get(&player_id) else { return };

    let mut payload: Option<ServerPlayerState> = None;
    for (entity, (player, stamina, hunger, inv)) in shard
        .ecs_world
        .query::<(
            &ff_ecs::components::player::Player,
            &ff_ecs::components::player::Stamina,
            &ff_ecs::components::player::Hunger,
            &ff_ecs::components::player::Inventory,
        )>()
        .iter()
    {
        if player.player_id != player_id { continue; }
        let coins = shard
            .ecs_world
            .get::<&ff_ecs::components::player::Wallet>(entity)
            .map(|w| w.0)
            .unwrap_or(0);
        // If the player has a Monarch component, they're a Tech Monarch.
        // Otherwise they're a Farmer with zero monarch resources.
        // Snapshot the Monarch component (which now contains a Vec and
        // can't be Copy'd) into a small plain tuple. The borrow is
        // released before we touch the player state builder.
        let monarch_snap = shard
            .ecs_world
            .get::<&ff_ecs::components::player::Monarch>(entity)
            .ok()
            .map(|m| (m.compute, m.influence, m.deployments, m.jobs_cut));
        let innovator_snap = shard
            .ecs_world
            .get::<&ff_ecs::components::player::Innovator>(entity)
            .ok()
            .map(|i| (i.knowledge, i.breakthroughs, i.focus_topic));
        // Role precedence: Innovator > Monarch > Farmer. Role discriminants
        // 0=Farmer, 1=TechMonarch, 2=Innovator.
        let (role, m_compute, m_influence, m_deployments, m_jobs_cut) =
            if let Some((c, i, d, j)) = monarch_snap {
                (1u8, c, i, d, j)
            } else {
                (0u8, 0.0, 0.0, 0u32, 0u32)
            };
        let (role, inv_knowledge, inv_breakthroughs, inv_focus) = match innovator_snap {
            Some((k, b, t)) => (2u8, k, b, t),
            None => (role, 0.0, 0u32, 0u8),
        };
        let outfit = shard
            .ecs_world
            .get::<&ff_ecs::components::player::Outfit>(entity)
            .map(|o| o.0)
            .unwrap_or(0);
        let owned_songs = shard
            .ecs_world
            .get::<&ff_ecs::components::player::SongLibrary>(entity)
            .map(|s| s.0)
            .unwrap_or(0);
        let chipped = if shard
            .ecs_world
            .get::<&ff_ecs::components::player::MonarchAsset>(entity)
            .is_ok()
        {
            1
        } else {
            0
        };
        payload = Some(ServerPlayerState {
            stamina: stamina.0,
            hunger: hunger.0,
            inventory: inv.slots.iter().map(|s| ItemStackMsg {
                item_id: s.item_id,
                count: s.count,
            }).collect(),
            coins,
            last_acked_seq: player.last_input_seq,
            role,
            monarch_compute: m_compute,
            monarch_influence: m_influence,
            monarch_deployments: m_deployments,
            monarch_jobs_cut: m_jobs_cut,
            innovator_knowledge: inv_knowledge,
            innovator_breakthroughs: inv_breakthroughs,
            innovator_focus_topic: inv_focus,
            outfit,
            owned_songs,
            chipped,
        });
        break;
    }

    if let Some(state) = payload {
        if let Ok(buf) = encode(MessageType::ServerPlayerState, &state) {
            session.send(buf);
        }
    }
}
