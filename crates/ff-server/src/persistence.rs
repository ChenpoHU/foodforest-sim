//! World persistence: snapshot save/load.
//! Serializes the terrain and soil grid to disk periodically.

use std::path::Path;
use tracing::{error, info};

/// Save terrain bytes to disk.
pub fn save_terrain(path: &Path, terrain_bytes: &[u8]) -> std::io::Result<()> {
    std::fs::write(path, terrain_bytes)?;
    info!("Terrain saved to {}", path.display());
    Ok(())
}

/// Load terrain bytes from disk.
pub fn load_terrain(path: &Path) -> std::io::Result<Vec<u8>> {
    let bytes = std::fs::read(path)?;
    info!("Terrain loaded from {} ({} bytes)", path.display(), bytes.len());
    Ok(bytes)
}

/// Periodic snapshot task — called from the tick loop.
pub async fn snapshot_loop(
    _shard_id: u32,
    _save_dir: std::path::PathBuf,
    _interval_secs: u64,
) {
    // TODO: implement periodic world snapshots
    // For now this is a placeholder.
    info!("Persistence snapshot loop started (not yet implemented)");
}
