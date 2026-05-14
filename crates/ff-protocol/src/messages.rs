//! All network message types exchanged between client, server, and shard manager.

use ff_common::{EntityId, PlayerId, ShardId, Tick};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u16)]
pub enum MessageType {
    // Client -> Server
    ClientHello = 0x0001,
    ClientInput = 0x0002,
    ClientAction = 0x0003,
    ClientChat = 0x0004,
    ClientPing = 0x0005,

    // Server -> Client
    ServerWelcome = 0x0101,
    ServerWorldState = 0x0102,
    ServerEntitySpawn = 0x0103,
    ServerEntityDespawn = 0x0104,
    ServerEntityUpdate = 0x0105,
    ServerPlayerState = 0x0106,
    ServerSoilUpdate = 0x0107,
    ServerWeather = 0x0108,
    ServerCalendar = 0x0109,
    ServerChat = 0x010A,
    ServerPong = 0x010B,
    ServerActionResult = 0x010C,
    ServerBatchUpdate = 0x010D,

    // Shard Manager <-> Server
    ShardRegister = 0x0201,
    ShardPlayerTransfer = 0x0202,
    ShardHealthReport = 0x0203,
    ShardAssignment = 0x0204,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientHello {
    pub player_name: String,
    pub token: String,
    pub protocol_version: u16,
    pub game_mode: u8,
    pub region_index: u8,
    pub plot_seed: u32,
}

/// Sent every tick (50ms) with the player's movement input.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientInput {
    /// Sequence number for server reconciliation.
    pub seq: u32,
    /// Client's predicted tick.
    pub tick: Tick,
    /// Normalized XZ movement direction.
    pub move_dir: [f32; 2],
    /// Camera yaw in radians.
    pub yaw: f32,
    /// Jump requested.
    pub jump: bool,
    /// Sprint held.
    pub sprint: bool,
}

/// Discrete player action (plant, harvest, dig, etc.).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientAction {
    pub seq: u32,
    pub action: ActionKind,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ActionKind {
    PlantSeed { species_id: u16, position: [i32; 3] },
    Harvest { entity_id: EntityId },
    Dig { position: [i32; 3] },
    Water { position: [i32; 3], radius: u8 },
    BuildSwale { position: [i32; 3], direction: u8 },
    BuildHugelBed { position: [i32; 3] },
    AddMulch { position: [i32; 3] },
    FeedAnimal { entity_id: EntityId, item_id: u16 },
    TradeNpc {
        npc_id: EntityId,
        offer_item: u16,
        offer_count: u16,
    },
    PickUp { entity_id: EntityId },
    CutTree { entity_id: EntityId },
    Inspect { entity_id: EntityId },
    HuntAnimal { entity_id: EntityId },
    BuildHochsitz { position: [i32; 3] },
    /// Consume one of `item_id` from the player's inventory to reduce hunger.
    EatItem { item_id: u16 },
    /// Sell `count` of `item_id` from inventory for FoFo Coin.
    SellItem { item_id: u16, count: u16 },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientChat {
    pub message: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct ClientPing {
    pub client_time_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerWelcome {
    pub your_entity_id: EntityId,
    pub your_player_id: PlayerId,
    pub shard_id: ShardId,
    pub tick: Tick,
    pub tick_rate: u32,
}

/// Full world snapshot sent on initial join.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerWorldState {
    pub tick: Tick,
    pub calendar: GameCalendarMsg,
    pub weather: WeatherMsg,
    pub entities: Vec<EntitySnapshot>,
    /// Terrain is sent as raw voxel bytes (same format as voxels.bin).
    pub terrain_bytes: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntitySnapshot {
    pub entity_id: EntityId,
    pub kind: EntityKind,
    pub position: [f32; 3],
    pub rotation: f32,
    pub state: EntityState,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum EntityKind {
    Player,
    Plant { species_id: u16 },
    Animal { species_id: u16 },
    NpcAgent { role: u8 },
    DroppedItem { item_id: u16 },
    Structure { kind: u8 },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum EntityState {
    /// Generic alive entity.
    Active,
    /// Plant-specific state.
    PlantGrowth {
        stage: u8,
        health: f32,
    },
    /// Animal-specific state.
    AnimalBehavior {
        behavior: u8,
        hunger: f32,
    },
    /// Player-specific visible state.
    PlayerVisible {
        held_item: Option<u16>,
        animation: u8,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerEntitySpawn {
    pub entity: EntitySnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerEntityDespawn {
    pub entity_id: EntityId,
}

/// Compact position + state delta for a single entity.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerEntityUpdate {
    pub entity_id: EntityId,
    pub position: [f32; 3],
    pub rotation: f32,
    /// Bitfield: bit 0 = grounded, bit 1 = moving, bit 2 = sprinting.
    pub state_flags: u8,
}

/// Batched entity updates (sent at NET_SEND_INTERVAL).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerBatchUpdate {
    pub tick: Tick,
    pub updates: Vec<ServerEntityUpdate>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerPlayerState {
    pub stamina: f32,
    pub hunger: f32,
    pub inventory: Vec<ItemStackMsg>,
    /// FoFo Coin balance — earned by selling harvested produce or hunted game.
    pub coins: u32,
    pub last_acked_seq: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ItemStackMsg {
    pub item_id: u16,
    pub count: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerSoilUpdate {
    pub chunk_x: i32,
    pub chunk_z: i32,
    /// Flattened soil data for the chunk.
    pub soil_data: Vec<SoilBlockMsg>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct SoilBlockMsg {
    pub nitrogen: f32,
    pub phosphorus: f32,
    pub potassium: f32,
    pub organic_matter: f32,
    pub moisture: f32,
    pub ph: f32,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct WeatherMsg {
    pub temperature: f32,
    pub rainfall: f32,
    pub wind_speed: f32,
    pub cloud_cover: f32,
    pub sunlight: f32,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct GameCalendarMsg {
    pub tick: Tick,
    pub day: u32,
    pub season: u8, // 0=Spring, 1=Summer, 2=Autumn, 3=Winter
    pub year: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerChat {
    pub sender: PlayerId,
    pub sender_name: String,
    pub message: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct ServerPong {
    pub client_time_ms: u64,
    pub server_time_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerActionResult {
    pub seq: u32,
    pub success: bool,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShardRegister {
    pub shard_id: ShardId,
    pub address: String,
    pub max_players: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShardPlayerTransfer {
    pub player_id: PlayerId,
    pub from_shard: ShardId,
    pub to_shard: ShardId,
    pub token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShardHealthReport {
    pub shard_id: ShardId,
    pub player_count: u32,
    pub tick_time_ms: f32,
    pub memory_mb: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShardAssignment {
    pub shard_id: ShardId,
    pub address: String,
    pub token: String,
}
