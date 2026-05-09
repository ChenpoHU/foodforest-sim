//! Shard registry: tracks all running shard servers.

use ff_common::ShardId;
use std::collections::HashMap;

#[derive(Debug, Clone)]
pub struct ShardInfo {
    pub shard_id: ShardId,
    pub address: String,
    pub max_players: u32,
    pub current_players: u32,
    pub healthy: bool,
    pub last_health_report_ms: u64,
}

pub struct ShardRegistry {
    pub shards: HashMap<ShardId, ShardInfo>,
}

impl ShardRegistry {
    pub fn new() -> Self {
        Self {
            shards: HashMap::new(),
        }
    }

    pub fn register(&mut self, shard_id: ShardId, address: String, max_players: u32) {
        self.shards.insert(
            shard_id,
            ShardInfo {
                shard_id,
                address,
                max_players,
                current_players: 0,
                healthy: true,
                last_health_report_ms: 0,
            },
        );
        tracing::info!("Registered shard {:?}", shard_id);
    }

    /// Find the least-loaded healthy shard.
    pub fn least_loaded(&self) -> Option<&ShardInfo> {
        self.shards
            .values()
            .filter(|s| s.healthy && s.current_players < s.max_players)
            .min_by_key(|s| s.current_players)
    }
}
