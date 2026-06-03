//! Player session: holds the WebSocket sender and per-player state.

use ff_common::{EntityId, PlayerId};
use tokio::sync::mpsc;

/// A connected player's server-side session.
#[derive(Debug)]
pub struct PlayerSession {
    pub player_id: PlayerId,
    pub entity_id: EntityId,
    pub player_name: String,
    /// The exact name the player typed on the connect screen, BEFORE
    /// server-side disambiguation (e.g. when two "Farmer"s are online
    /// at once and one is renamed to "Farmer #2"). Used as the key
    /// for persistent state (wallet, inventory, role) so a traveling
    /// player can pick up where they left off.
    pub origin_name: String,
    /// Channel to send binary messages to this player's WebSocket.
    pub sender: mpsc::UnboundedSender<Vec<u8>>,
    /// Last input sequence number acknowledged.
    pub last_acked_seq: u32,
    /// Short human-readable tag describing this player's most recent
    /// activity ("plant olive", "harvest", "moving", "idle"). Surfaces in
    /// the Tech-Monarch surveillance feed.
    pub last_action: String,
}

impl PlayerSession {
    pub fn new(
        player_id: PlayerId,
        entity_id: EntityId,
        player_name: String,
        origin_name: String,
        sender: mpsc::UnboundedSender<Vec<u8>>,
    ) -> Self {
        Self {
            player_id,
            entity_id,
            player_name,
            origin_name,
            sender,
            last_acked_seq: 0,
            last_action: "joined".into(),
        }
    }

    /// Send a raw binary message to this player.
    pub fn send(&self, data: Vec<u8>) -> bool {
        self.sender.send(data).is_ok()
    }
}
