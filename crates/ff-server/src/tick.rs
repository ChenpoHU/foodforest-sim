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
        payload = Some(ServerPlayerState {
            stamina: stamina.0,
            hunger: hunger.0,
            inventory: inv.slots.iter().map(|s| ItemStackMsg {
                item_id: s.item_id,
                count: s.count,
            }).collect(),
            coins,
            last_acked_seq: player.last_input_seq,
        });
        break;
    }

    if let Some(state) = payload {
        if let Ok(buf) = encode(MessageType::ServerPlayerState, &state) {
            session.send(buf);
        }
    }
}
