//! ff-ecs: Entity-Component-System core for the Food Forest simulation.
//!
//! Uses `hecs` for the ECS world. Systems are plain functions called
//! in a deterministic order by the server's tick loop.

pub mod components;
pub mod resources;
pub mod systems;

use ff_common::GameMode;
use resources::{GameCalendar, SpeciesBrains, SpeciesDb, Weather};

/// Discrete kinds of "global catastrophe" the simulation can be in.
/// Numeric repr matches the wire protocol on `ServerCatastrophe.kind`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum CatastropheKind {
    /// No catastrophe currently active.
    None = 0,
    Pandemic = 1,
    SolarFlare = 2,
    Drought = 3,
    Nuclear = 4,
    Asteroid = 5,
}

impl CatastropheKind {
    pub fn from_u8(v: u8) -> Self {
        match v {
            1 => Self::Pandemic,
            2 => Self::SolarFlare,
            3 => Self::Drought,
            4 => Self::Nuclear,
            5 => Self::Asteroid,
            _ => Self::None,
        }
    }
    /// Player-facing description shown in the banner.
    pub fn banner_message(self, intensity: f32) -> String {
        let i = intensity as i32;
        match self {
            Self::None       => String::new(),
            Self::Pandemic   => format!("Pandemic outbreak ({i}%) — livestock falling ill"),
            Self::SolarFlare => format!("Solar flare incoming ({i}%) — drones at risk"),
            Self::Drought    => format!("Severe drought ({i}%) — soil moisture collapsing"),
            Self::Nuclear    => format!("Nuclear fallout ({i}%) — contamination spreading"),
            Self::Asteroid   => format!("Asteroid impact ({i}%) — global shockwave damage"),
        }
    }
}

/// Active global catastrophe state. Lives on `Resources` so any
/// system can see / mutate it. `kind == None` means no active event.
#[derive(Debug, Clone, Copy)]
pub struct Catastrophe {
    pub kind: CatastropheKind,
    /// 0..100. Damage rate scales with this. Grows during the event,
    /// drops to 0 when an Innovator deploys a matching breakthrough.
    pub intensity: f32,
    /// Ticks since the catastrophe started.
    pub ticks_elapsed: u32,
    /// Total duration before the event naturally ends.
    pub duration_ticks: u32,
    /// Tick at which we last broadcast a state update to clients.
    /// Used to throttle ServerCatastrophe to ~1 Hz.
    pub last_broadcast_tick: u64,
    /// Set to `true` when the kind/intensity changed this tick. The
    /// server's catastrophe tick wrapper reads + clears this to know
    /// whether to push an update message right away.
    pub dirty: bool,
}

impl Default for Catastrophe {
    fn default() -> Self {
        Self {
            kind: CatastropheKind::None,
            intensity: 0.0,
            ticks_elapsed: 0,
            duration_ticks: 0,
            last_broadcast_tick: 0,
            dirty: false,
        }
    }
}

/// All global resources available to systems during a tick.
pub struct Resources {
    pub calendar: GameCalendar,
    pub weather: Weather,
    pub species_db: SpeciesDb,
    pub game_mode: GameMode,
    /// Per-world Q-learning brains for animal movement. Each species owns
    /// one shared table that all individuals of that species learn into.
    /// Knowledge does NOT cross world boundaries — each shard starts naive.
    pub species_brains: SpeciesBrains,
    /// Current global catastrophe (or None).
    pub catastrophe: Catastrophe,
}

impl Resources {
    pub fn new() -> Self {
        Self {
            calendar: GameCalendar::new(),
            weather: Weather::default(),
            species_db: SpeciesDb::new_default(),
            game_mode: GameMode::Realistic,
            species_brains: SpeciesBrains::new(),
            catastrophe: Catastrophe::default(),
        }
    }
}

impl Default for Resources {
    fn default() -> Self {
        Self::new()
    }
}
