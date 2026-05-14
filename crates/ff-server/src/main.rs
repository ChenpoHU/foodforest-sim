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

    info!("Starting Food Forest server — shard {shard_id} on {addr}");

    let game_mode = std::env::var("GAME_MODE")
        .ok()
        .and_then(|s| s.parse::<u8>().ok())
        .map(ff_common::GameMode::from)
        .unwrap_or(ff_common::GameMode::Survival);

    info!("Game mode: {:?}", game_mode);

    let region_index: u8 = std::env::var("REGION")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    let plot_seed: u32 = std::env::var("PLOT_SEED")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(42);

    let terrain = ff_voxel::generate::generate_terrain(region_index, plot_seed);
    let terrain_bytes = terrain.to_bytes();
    info!(
        "Terrain generated: {}x{}x{} region={} plot_seed={}",
        terrain.width, terrain.height, terrain.depth, region_index, plot_seed
    );

    let shard = shard::Shard::new(ff_common::ShardId(shard_id), terrain, terrain_bytes, game_mode, region_index);

    net::ws::run_server(addr, shard).await;
}
