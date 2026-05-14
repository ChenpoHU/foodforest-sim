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
            _ => Self::Air,
        }
    }
}
