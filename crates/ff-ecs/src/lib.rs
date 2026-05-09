//! ff-ecs: Entity-Component-System core for the Food Forest simulation.
//!
//! Uses `hecs` for the ECS world. Systems are plain functions called
//! in a deterministic order by the server's tick loop.

pub mod components;
pub mod resources;
pub mod systems;

use ff_common::GameMode;
use resources::{GameCalendar, SpeciesDb, Weather};

/// All global resources available to systems during a tick.
pub struct Resources {
    pub calendar: GameCalendar,
    pub weather: Weather,
    pub species_db: SpeciesDb,
    pub game_mode: GameMode,
}

impl Resources {
    pub fn new() -> Self {
        Self {
            calendar: GameCalendar::new(),
            weather: Weather::default(),
            species_db: SpeciesDb::new_default(),
            game_mode: GameMode::Survival,
        }
    }
}

impl Default for Resources {
    fn default() -> Self {
        Self::new()
    }
}
