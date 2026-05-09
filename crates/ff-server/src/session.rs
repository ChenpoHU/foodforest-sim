//! Player session: holds the WebSocket sender and per-player state.

use ff_common::{EntityId, PlayerId};
use tokio::sync::mpsc;

/// A connected player's server-side session.
#[derive(Debug)]
pub struct PlayerSession {
    pub player_id: PlayerId,
    pub entity_id: EntityId,
    pub player_name: String,
    /// Channel to send binary messages to this player's WebSocket.
    pub sender: mpsc::UnboundedSender<Vec<u8>>,
    /// Last input sequence number acknowledged.
    pub last_acked_seq: u32,
}

impl PlayerSession {
    pub fn new(
        player_id: PlayerId,
        entity_id: EntityId,
        player_name: String,
        sender: mpsc::UnboundedSender<Vec<u8>>,
    ) -> Self {
        Self {
            player_id,
            entity_id,
            player_name,
            sender,
            last_acked_seq: 0,
        }
    }

    /// Send a raw binary message to this player.
    pub fn send(&self, data: Vec<u8>) -> bool {
        self.sender.send(data).is_ok()
    }
}
