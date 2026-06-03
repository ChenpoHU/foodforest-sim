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

/// Build and broadcast entity position updates to all connected players.
fn broadcast_updates(shard: &mut Shard) {
    let tick = shard.resources.calendar.tick;

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
        let role = if shard
            .ecs_world
            .get::<&ff_ecs::components::player::Monarch>(entity)
            .is_ok()
        {
            1
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
        });
        break;
    }

    if let Some(state) = payload {
        if let Ok(buf) = encode(MessageType::ServerPlayerState, &state) {
            session.send(buf);
        }
    }
}
