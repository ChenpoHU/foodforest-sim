//! ff-tools: Development tools and diagnostics.
//!
//! Usage:
//!   ff-tools info           — Print build info and constants
//!   ff-tools stress <N>     — Spawn N simulated clients (TODO)

use ff_common::*;

fn main() {
    let args: Vec<String> = std::env::args().collect();

    match args.get(1).map(|s| s.as_str()) {
        Some("info") | None => {
            println!("=== Food Forest Simulation — Build Info ===");
            println!("Tick rate:          {} Hz", TICK_RATE);
            println!("Tick dt:            {} s", TICK_DT);
            println!("Net send interval:  {} ticks ({} Hz)", NET_SEND_INTERVAL, TICK_RATE / NET_SEND_INTERVAL);
            println!("Max players/shard:  {}", MAX_PLAYERS_PER_SHARD);
            println!("Chunk size:         {}x{}", CHUNK_SIZE, CHUNK_SIZE);
            println!("Max height:         {} voxels", MAX_HEIGHT);
            println!("AOI radius:         {} voxels", AOI_RADIUS);
            println!("Soil layers:        {}", SOIL_LAYERS);
        }
        Some("stress") => {
            let n: usize = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(10);
            println!("Stress test with {n} simulated clients (not yet implemented)");
        }
        Some(cmd) => {
            eprintln!("Unknown command: {cmd}");
            eprintln!("Usage: ff-tools [info|stress <N>]");
            std::process::exit(1);
        }
    }
}
