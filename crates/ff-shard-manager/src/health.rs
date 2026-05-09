//! Health check loop: monitors shard servers.

use crate::registry::ShardRegistry;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;
use tracing::info;

/// Run periodic health checks on registered shards.
pub async fn health_check_loop(registry: Arc<Mutex<ShardRegistry>>) {
    let mut interval = tokio::time::interval(Duration::from_secs(5));

    loop {
        interval.tick().await;

        let reg = registry.lock().await;
        let total = reg.shards.len();
        let healthy = reg.shards.values().filter(|s| s.healthy).count();
        let players: u32 = reg.shards.values().map(|s| s.current_players).sum();

        info!(
            "Health: {healthy}/{total} shards healthy, {players} total players"
        );
    }
}
