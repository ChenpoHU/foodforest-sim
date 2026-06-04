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
    /// Sent every ~1 s to Tech-Monarch sessions only. A live roster of
    /// every connected farmer (position, vitals, recent action) so the
    /// monarch can pick targets for UBI grants, propaganda, sanctions.
    ServerMonarchSurveillance = 0x010E,
    /// A propaganda broadcast issued by a Tech-Monarch — fan-out to every
    /// connected player (monarchs included, so the monarch can confirm
    /// their own send). The client renders this as a banner + chat row
    /// in a colour dictated by `tone`.
    ServerStateBroadcast = 0x010F,
    /// A Monarch-issued public task with a coin reward escrowed from the
    /// Monarch's wallet. First player to fulfil the criteria wins.
    ServerTaskBroadcast = 0x0110,
    /// Sent when an active task is claimed by a winning player. Both the
    /// winner and the issuing Monarch use this for HUD feedback.
    ServerTaskComplete = 0x0111,
    /// Sent to a player whose role just changed (ascended, demoted, or
    /// replaced by AI). Also broadcast to all sessions so other players
    /// learn who's now a Monarch / who fell.
    ServerRoleChanged = 0x0112,
    /// Pushed to all players when a Monarch's deployed AI fleet exceeds
    /// the intelligence threshold and "takes over" — the former Monarch
    /// is demoted to Farmer, and a global banner is shown.
    ServerAiTakeover = 0x0113,
    /// 1 Hz public roster of every connected Monarch with their
    /// political stats (discontent, AI intelligence). Sent to every
    /// session so Farmers can decide who to revolt against.
    ServerPoliticsUpdate = 0x0114,
    /// Sent to every player when a global catastrophe starts, ticks,
    /// or ends. Drives the catastrophe banner + Innovator's deploy
    /// hints.
    ServerCatastrophe = 0x0115,

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
    /// `PlayerRole` discriminant. The server validates this against the
    /// chosen game mode and may downgrade (TechMonarch is Realistic-only).
    pub player_role: u8,
    /// True when this hello is a "Travel to Region" reconnect from a
    /// player already in the world. The server then looks up the
    /// previous wallet/inventory/role state (keyed by player_name)
    /// and charges `TRAVEL_COST` from the restored wallet. False on
    /// a fresh login from the connect screen.
    pub traveling: bool,
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
    /// Tech-Monarch only: drop a semi-AI harvester at `position`. Costs
    /// Compute. The worker auto-harvests fruiting plants in radius and
    /// banks the proceeds to the monarch's wallet.
    DeploySemiAI { position: [i32; 3] },
    /// Tech-Monarch only: blast a state-channel message to every
    /// connected player. `tone` selects rendering style on the client
    /// (0 = Decree, 1 = Rally, 2 = Crisis). Costs Influence.
    Propaganda { tone: u8, message: String },
    /// Tech-Monarch only: transfer `amount` coins from the Monarch's
    /// wallet to a target farmer. `target_player_id = 0` is reserved for
    /// "all connected farmers" (each receives `amount`; total cost is
    /// `amount * farmer_count`). Costs nothing besides the coins.
    GrantUbi { target_player_id: u64, amount: u32 },
    /// Tech-Monarch only: issue a public task with a coin reward. The
    /// reward is escrowed from the Monarch's wallet at issue time. First
    /// connected farmer to perform `target` matching actions wins it.
    /// `task_kind`: 0 = Plant, 1 = Harvest, 2 = CutTree, 3 = Hunt.
    IssueTask {
        tone: u8,
        message: String,
        task_kind: u8,
        target: u32,
        reward: u32,
    },
    /// Farmer-only: spend a fixed pile of coins to be promoted to
    /// Tech-Monarch. Cost is set on the server side
    /// (`MONARCH_ASCENSION_COST`). Realistic mode only.
    AscendToMonarch,
    /// Farmer-only: cast a vote of no-confidence against the given
    /// Monarch. Each Farmer may only revolt against the same Monarch
    /// once per session. Enough revolts → automatic demotion.
    Revolt { target_monarch_id: u64 },
    /// Innovator-only: spend a tick of "lab time" to accumulate
    /// Knowledge in `topic` (0=Climate, 1=Medicine, 2=Defense,
    /// 3=Food).
    Research { topic: u8 },
    /// Innovator-only: spend BREAKTHROUGH_COST Knowledge to end the
    /// active catastrophe — but only if `kind` matches the active
    /// catastrophe's kind. Mismatched breakthroughs are rejected.
    ///   kind: 0=Pandemic, 1=SolarFlare, 2=Drought, 3=Nuclear, 4=Asteroid
    DeployBreakthrough { kind: u8 },
    /// Craft + wear an outfit from gathered materials. `recipe`:
    ///   0 = Linen Tunic  (costs plant fibre)
    ///   1 = Fur Coat     (costs animal hide)
    ///   255 = take it off (back to default clothes, free)
    Craft { recipe: u8 },
}

/// State of a global catastrophe pushed to every player.
///   kind: 0=None, 1=Pandemic, 2=SolarFlare, 3=Drought, 4=Nuclear, 5=Asteroid
///   intensity: 0..100 — drives the banner colour + the per-tick damage rate.
///   ticks_remaining: rough countdown shown to the player.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerCatastrophe {
    pub kind: u8,
    pub intensity: f32,
    pub ticks_remaining: u32,
    /// Short human-readable message used as the banner text.
    pub message: String,
}

/// Reason carried on a `ServerRoleChanged` so the client can pick the
/// right banner copy/colour. Numeric repr is part of the wire protocol.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u8)]
pub enum RoleChangeReason {
    /// Farmer voluntarily ascended after paying the ascension cost.
    Ascended = 0,
    /// Monarch was overthrown by enough Farmers' revolt votes.
    Overthrown = 1,
    /// Monarch's deployed AI fleet hit the intelligence threshold and
    /// "took over" — they're demoted to Farmer, the AI symbolically
    /// becomes the new ruler.
    AiTakeover = 2,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerRoleChanged {
    pub player_id: PlayerId,
    pub player_name: String,
    /// 0 = Farmer, 1 = TechMonarch.
    pub new_role: u8,
    pub reason: RoleChangeReason,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerAiTakeover {
    pub former_monarch_id: PlayerId,
    pub former_monarch_name: String,
    pub deployments: u32,
    pub jobs_cut: u32,
}

/// One row in the 1 Hz politics feed — a single connected Monarch's
/// public stats. Used by the Farmer's Politics modal to pick a revolt
/// target.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PoliticsRow {
    pub player_id: PlayerId,
    pub player_name: String,
    pub discontent: f32,
    pub ai_intelligence: f32,
    pub deployments: u32,
    pub jobs_cut: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerPoliticsUpdate {
    pub tick: Tick,
    pub monarchs: Vec<PoliticsRow>,
}

/// A Monarch-issued task pushed to every player. The client shows it as
/// a sticky banner + an HUD card so the player can track progress
/// without re-opening any modal.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerTaskBroadcast {
    pub task_id: u32,
    pub monarch_id: PlayerId,
    pub monarch_name: String,
    pub tone: u8,
    pub message: String,
    pub task_kind: u8,
    pub target: u32,
    pub reward: u32,
}

/// Sent when a task is claimed by a winning player. The reward has
/// already been credited server-side.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerTaskComplete {
    pub task_id: u32,
    pub winner_id: PlayerId,
    pub winner_name: String,
    pub reward: u32,
    pub monarch_id: PlayerId,
}

/// State-channel broadcast pushed by the server when a Tech-Monarch
/// issues a propaganda action. Distinct from `ServerChat` so the client
/// can render it as a top-of-screen banner instead of an ordinary chat
/// line.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerStateBroadcast {
    pub from_player: PlayerId,
    pub from_name: String,
    pub tone: u8,
    pub message: String,
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
    /// Worn outfit (players only; 0 = default). Lets other clients
    /// render the player's crafted clothing. 0=default, 1=Linen Tunic,
    /// 2=Fur Coat.
    pub outfit: u8,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum EntityKind {
    Player,
    Plant { species_id: u16 },
    Animal { species_id: u16 },
    NpcAgent { role: u8 },
    DroppedItem { item_id: u16 },
    Structure { kind: u8 },
    /// Semi-AI worker deployed by a Tech Monarch.
    SemiAI,
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
    /// 0 = Farmer, 1 = Tech Monarch. Drives whether the Monarch dashboard
    /// renders on the client.
    pub role: u8,
    /// Monarch resources. All zero for non-Monarch players.
    pub monarch_compute: f32,
    pub monarch_influence: f32,
    pub monarch_deployments: u32,
    pub monarch_jobs_cut: u32,
    /// Innovator resources. All zero for non-Innovator players.
    pub innovator_knowledge: f32,
    pub innovator_breakthroughs: u32,
    pub innovator_focus_topic: u8,
    /// Currently-worn outfit (0=default, 1=Linen Tunic, 2=Fur Coat).
    pub outfit: u8,
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

/// One row in the Monarch surveillance feed — a single farmer's
/// observable state, snapshot at the moment of broadcast.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonarchSurveillanceRow {
    pub player_id: PlayerId,
    pub player_name: String,
    pub role: u8,
    pub position: [f32; 3],
    pub coins: u32,
    pub stamina: f32,
    pub hunger: f32,
    /// Short tag describing this player's most recent action ("plant
    /// olive", "harvest", "moving", "idle"). Trimmed server-side.
    pub last_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerMonarchSurveillance {
    pub tick: Tick,
    pub rows: Vec<MonarchSurveillanceRow>,
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
