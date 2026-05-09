//! Food Forest Simulation — Game Server
//!
//! Runs one shard instance: accepts WebSocket connections, runs the ECS tick
//! loop at 20 Hz, and broadcasts entity updates to connected players.

mod auth;
mod net;
mod persistence;
mod session;
mod shard;
mod tick;

use std::net::SocketAddr;
use tracing::{info, Level};

#[tokio::main]
async fn main() {
    // Initialize logging
    tracing_subscriber::fmt()
        .with_max_level(Level::INFO)
        .init();

    let addr: SocketAddr = std::env::var("LISTEN_ADDR")
        .unwrap_or_else(|_| "0.0.0.0:9000".into())
        .parse()
        .expect("Invalid LISTEN_ADDR");

    let shard_id = std::env::var("SHARD_ID")
        .unwrap_or_else(|_| "1".into())
        .parse::<u32>()
        .expect("Invalid SHARD_ID");

    let terrain_path = std::env::var("TERRAIN_PATH")
        .unwrap_or_else(|_| "voxel_data/central_portugal/voxels.bin".into());

    info!("Starting Food Forest server — shard {shard_id} on {addr}");
    info!("Loading terrain from {terrain_path}");

    // Load terrain
    let terrain_bytes = std::fs::read(&terrain_path).expect("Failed to read terrain file");
    let terrain = ff_voxel::VoxelWorld::from_bytes(&terrain_bytes);
    info!(
        "Terrain loaded: {}x{}x{} ({} voxels)",
        terrain.width,
        terrain.height,
        terrain.depth,
        terrain.data.len()
    );

    // Create shard
    let shard = shard::Shard::new(ff_common::ShardId(shard_id), terrain, terrain_bytes);

    // Start the server
    net::ws::run_server(addr, shard).await;
}
