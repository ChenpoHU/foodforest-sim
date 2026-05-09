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

            // Run all ECS systems
            shard.tick();

            // Broadcast entity updates every NET_SEND_INTERVAL ticks
            if tick_count % NET_SEND_INTERVAL as u64 == 0 {
                broadcast_updates(&shard);
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
fn broadcast_updates(shard: &Shard) {
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
}
