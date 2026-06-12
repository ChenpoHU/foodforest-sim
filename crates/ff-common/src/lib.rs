//! ff-common: Shared types, identifiers, and constants for the Food Forest simulation.

use serde::{Deserialize, Serialize};

/// Globally unique entity identifier (shard-local allocation).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct EntityId(pub u64);

/// Shard identifier assigned by the shard manager.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ShardId(pub u32);

/// Player account identifier.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct PlayerId(pub u64);

/// Monotonically increasing server tick counter.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct Tick(pub u64);

/// Integer voxel coordinate (used for terrain / soil lookups).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct VoxelPos {
    pub x: i32,
    pub y: i32,
    pub z: i32,
}

/// Chunk coordinate (16x16 voxel columns).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ChunkPos {
    pub cx: i32,
    pub cz: i32,
}

impl VoxelPos {
    pub fn to_chunk(self) -> ChunkPos {
        ChunkPos {
            cx: self.x.div_euclid(CHUNK_SIZE as i32),
            cz: self.z.div_euclid(CHUNK_SIZE as i32),
        }
    }
}

/// Server simulation tick rate (ticks per second).
pub const TICK_RATE: u32 = 20;

/// Duration of one tick in seconds.
pub const TICK_DT: f32 = 1.0 / TICK_RATE as f32;

/// Network send rate — entity updates sent every N ticks.
pub const NET_SEND_INTERVAL: u32 = 2; // 10 Hz

/// Maximum players per shard instance.
pub const MAX_PLAYERS_PER_SHARD: u32 = 500;

/// Coin cost charged when a player travels to a different region.
/// Server enforces this; client previews it in the Travel modal and
/// disables the Travel button when the wallet can't cover the trip.
pub const TRAVEL_COST: u32 = 25;

/// Coin cost charged for a **cross-Earth hop** — jumping to a *parallel
/// world* (a different `realm_id`). Far pricier than region travel: an
/// Earth is shared with everyone on it, so leaving your population for a
/// fresh one is a deliberate, earned move ("pay enough FoFo Coin"). The
/// server enforces it; the client previews it and greys the Hop button
/// when the wallet is short. Tuned below the Monarch ascension price.
pub const WORLD_HOP_COST: u32 = 200;

/// Voxels per chunk side (horizontal).
pub const CHUNK_SIZE: u32 = 16;

/// Maximum world height in voxels.
pub const MAX_HEIGHT: u32 = 128;

/// Area-of-interest radius in voxels (entities beyond this are not sent).
pub const AOI_RADIUS: f32 = 200.0;

/// Soil depth layers per column.
pub const SOIL_LAYERS: usize = 4;

/// Wildfire deadline in Survival mode (ticks). 15 minutes at 20 Hz = 18000 ticks.
pub const WILDFIRE_DEADLINE_TICKS: u64 = 700;//18_000;

/// Game mode. The numeric repr is part of the wire protocol — do not renumber.
/// - `Peaceful` (0): no felling physics, no hunting, relaxed pace.
/// - `Realistic` (1): full felling physics, hunting allowed, but no learning AI.
/// - `Survival` (2): wildfire deadline + learning AI animals that adapt to the player.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[repr(u8)]
pub enum GameMode {
    Peaceful = 0,
    Realistic = 1,
    Survival = 2,
}

impl From<u8> for GameMode {
    fn from(v: u8) -> Self {
        match v {
            0 => Self::Peaceful,
            1 => Self::Realistic,
            2 => Self::Survival,
            _ => Self::Realistic,
        }
    }
}

/// Which kind of citizen the player is roleplaying.
/// - `Farmer` (default): hands-on food-forest worker. Plants, harvests, hunts, sells.
/// - `TechMonarch`: tech-oligarch role only unlockable in `Realistic` mode. Doesn't
///   farm directly; deploys semi-AI workers that automate harvesting, accruing
///   Compute and Influence resources used to issue further "decisions."
/// - `Innovator`: distributed-human-brain counterweight to the monolithic AI.
///   Unlockable in Realistic + Survival. Accumulates Knowledge in a chosen
///   research Topic (climate, medicine, defense, food). Spends Knowledge on
///   Breakthroughs that resolve active global catastrophes (pandemic, solar
///   flare, drought, nuclear contamination, asteroid impact) — things the
///   AI Monarch can't simply automate away because each crisis needs a
///   different specialised insight.
/// The numeric repr is part of the wire protocol — do not renumber.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[repr(u8)]
pub enum PlayerRole {
    Farmer = 0,
    TechMonarch = 1,
    Innovator = 2,
    /// The AI faction — a human (or agent) playing as the machine intelligence:
    /// deploys automation and pursues collective intelligence. Shares the
    /// Monarch's automation mechanics; distinguished by intent + faction.
    Ai = 3,
}

impl From<u8> for PlayerRole {
    fn from(v: u8) -> Self {
        match v {
            1 => Self::TechMonarch,
            2 => Self::Innovator,
            3 => Self::Ai,
            _ => Self::Farmer,
        }
    }
}

impl PlayerRole {
    /// Every role is now playable in every world — the world sets the
    /// *difficulty* (how hard the economy, catastrophes and AI press on
    /// you), not which roles exist. Farmer, Tech-Monarch, and Innovator
    /// (human- or AI-controlled) can all join Peaceful, Realistic, and
    /// Survival; their supporting systems run in all three, scaled per
    /// world. Kept as a method so existing call sites need not change.
    pub fn validate_for_mode(self, _mode: GameMode) -> Self {
        self
    }
}

/// Material IDs stored in the voxel grid.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u8)]
pub enum VoxelMaterial {
    Air = 0,
    Stone = 1,
    Soil = 2,
    Grass = 3,
    Water = 4,
    Sand = 5,
    Clay = 6,
    Mulch = 7,
    Swale = 8,         // player-built water retention
    HugelBed = 9,      // raised bed with buried wood
    Canopy = 10,
    Snow = 11,
    Ice = 12,
    Ocean = 13,
    Gravel = 14,
    RedSoil = 15,
    Lake = 16,         // inland water — flooded hollows (Jiuzhaigou-style)
}

impl From<u8> for VoxelMaterial {
    fn from(v: u8) -> Self {
        match v {
            0 => Self::Air,
            1 => Self::Stone,
            2 => Self::Soil,
            3 => Self::Grass,
            4 => Self::Water,
            5 => Self::Sand,
            6 => Self::Clay,
            7 => Self::Mulch,
            8 => Self::Swale,
            9 => Self::HugelBed,
            10 => Self::Canopy,
            11 => Self::Snow,
            12 => Self::Ice,
            13 => Self::Ocean,
            14 => Self::Gravel,
            15 => Self::RedSoil,
            16 => Self::Lake,
            _ => Self::Air,
        }
    }
}
