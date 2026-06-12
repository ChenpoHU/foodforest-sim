//! World persistence: snapshot save/load.
//! Serializes the terrain and soil grid to disk periodically.

use crate::shard::PersistedPlayer;
use std::collections::HashMap;
use std::path::Path;
use tracing::{error, info};

/// Default file the player save lives in (override with the `PLAYERS_FILE`
/// env var). Pure JSON so it's easy to inspect / hand-edit.
pub const PLAYERS_FILE_DEFAULT: &str = "players.json";

/// Where the player save lives — `PLAYERS_FILE` env or the default.
pub fn players_path() -> std::path::PathBuf {
    std::env::var("PLAYERS_FILE")
        .unwrap_or_else(|_| PLAYERS_FILE_DEFAULT.into())
        .into()
}

/// Save every player's persisted state (wallet · inventory · role · songs) to
/// disk so they can resume in a later session or after a server restart.
/// Writes to a temp file then renames, so a crash mid-write can't corrupt the
/// existing save.
pub fn save_players(path: &Path, players: &HashMap<String, PersistedPlayer>) -> std::io::Result<()> {
    let json = serde_json::to_vec_pretty(players)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, &json)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

/// Load persisted player state from disk. Returns an empty map on first run
/// (no file yet) or if the save is unreadable — never fails the boot.
pub fn load_players(path: &Path) -> HashMap<String, PersistedPlayer> {
    match std::fs::read(path) {
        Ok(bytes) => match serde_json::from_slice::<HashMap<String, PersistedPlayer>>(&bytes) {
            Ok(map) => {
                info!("Loaded {} saved player(s) from {}", map.len(), path.display());
                map
            }
            Err(e) => {
                error!("Player save at {} is unreadable ({e}); starting fresh", path.display());
                HashMap::new()
            }
        },
        Err(_) => HashMap::new(), // no save yet — first run
    }
}

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
