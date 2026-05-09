use ff_common::EntityId;
use serde::{Deserialize, Serialize};

/// Unique identifier for network replication.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct NetworkId(pub EntityId);

/// Human-readable name (player name, species name, NPC name).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Name(pub String);

/// Ownership: which player placed / owns this entity.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Owner(pub ff_common::PlayerId);
