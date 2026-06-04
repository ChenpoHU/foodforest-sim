//! Behaviour log — the anonymised, in-game-only action/outcome stream that
//! fuels the game's own *house* learning AI (see `md/07-master-design.md` §4b
//! and `md/08-agent-api.md`).
//!
//! Design constraints this honours:
//!   • **Behaviour only, never personal data.** Each record is a pseudonymous
//!     token + role + action + outcome. The token is a non-reversible hash of
//!     the (already non-PII) session player id, stable only within a run.
//!   • **Never blocks the tick.** Records are pushed onto a bounded, lock-free
//!     `SyncSender` with `try_send` (dropped on overflow) and written to disk
//!     by a dedicated OS thread — no file I/O ever happens under the shard lock.
//!   • **Opt-in.** Disabled unless the `BEHAVIOUR_LOG` env var names a file.

use std::sync::OnceLock;
use std::sync::mpsc::{self, SyncSender};

static TX: OnceLock<SyncSender<String>> = OnceLock::new();

/// Call once at startup. If `BEHAVIOUR_LOG=<path>` is set, spawns a background
/// writer thread and enables logging; otherwise this is a no-op forever.
pub fn init() {
    let path = match std::env::var("BEHAVIOUR_LOG") {
        Ok(p) if !p.is_empty() => p,
        _ => return,
    };
    let (tx, rx) = mpsc::sync_channel::<String>(8192);
    if TX.set(tx).is_err() {
        return;
    }
    std::thread::Builder::new()
        .name("behaviour-log".into())
        .spawn(move || {
            use std::io::Write;
            let mut file = match std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&path)
            {
                Ok(f) => f,
                Err(e) => {
                    tracing::warn!("behaviour log: cannot open {path}: {e}");
                    return;
                }
            };
            tracing::info!("Behaviour log → {path} (house-AI training data)");
            while let Ok(line) = rx.recv() {
                let _ = writeln!(file, "{line}");
            }
        })
        .ok();
}

/// Append one behaviour record. Cheap + non-blocking; a no-op when logging is
/// disabled, and silently dropped (rather than stalling) if the writer is
/// momentarily behind.
pub fn record_action(
    tick: u64,
    player_id: u64,
    is_ai: bool,
    role: u8,
    action: &str,
    args: serde_json::Value,
    ok: bool,
) {
    let Some(tx) = TX.get() else { return };
    let line = serde_json::json!({
        "t": tick,
        "actor": anon(player_id),
        "ctl": if is_ai { "ai" } else { "human" },
        "role": role,
        "act": action,
        "args": args,
        "ok": ok,
    })
    .to_string();
    let _ = tx.try_send(line);
}

/// Stable, non-reversible pseudonym for a player within this process run.
/// FNV-1a over the session id (itself a per-run counter, not PII) → short hex.
fn anon(player_id: u64) -> String {
    let mut h: u64 = 0xcbf29ce4_84222325;
    for b in player_id.to_le_bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("p{:08x}", h & 0xffff_ffff)
}
