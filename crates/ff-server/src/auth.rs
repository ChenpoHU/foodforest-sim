//! Simple token-based authentication.
//! In production, this would validate against the shard manager's token store.

/// Validate a connection token. Returns true if valid.
/// For now, accepts any non-empty token.
pub fn validate_token(token: &str) -> bool {
    !token.is_empty()
}

/// Generate a simple session token for a player.
pub fn generate_token(player_name: &str) -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis();
    format!("tok_{player_name}_{ts}")
}
