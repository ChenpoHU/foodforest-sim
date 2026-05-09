//! Load balancer: assigns players to the least-loaded shard.

use crate::registry::ShardRegistry;
use ff_protocol::messages::ShardAssignment;

/// Assign a player to the best available shard.
pub fn assign_shard(registry: &ShardRegistry, player_name: &str) -> Option<ShardAssignment> {
    let shard = registry.least_loaded()?;

    let token = format!("tok_{player_name}_{}", shard.shard_id.0);

    Some(ShardAssignment {
        shard_id: shard.shard_id,
        address: shard.address.clone(),
        token,
    })
}
