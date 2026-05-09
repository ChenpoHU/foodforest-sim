use ff_common::Tick;
use serde::{Deserialize, Serialize};

/// In-game calendar. One game day = ~720 ticks = 36 seconds real time.
/// One game year = 365 days = ~7.3 hours real time.
const TICKS_PER_DAY: u64 = 720;
const DAYS_PER_YEAR: u32 = 365;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Season {
    Spring,
    Summer,
    Autumn,
    Winter,
}

impl Season {
    pub fn from_day(day: u32) -> Self {
        let day_of_year = day % DAYS_PER_YEAR;
        match day_of_year {
            0..=90 => Season::Spring,
            91..=181 => Season::Summer,
            182..=272 => Season::Autumn,
            _ => Season::Winter,
        }
    }

    pub fn as_u8(self) -> u8 {
        match self {
            Season::Spring => 0,
            Season::Summer => 1,
            Season::Autumn => 2,
            Season::Winter => 3,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct GameCalendar {
    pub tick: Tick,
    pub day: u32,
    pub season: Season,
    pub year: u32,
}

impl GameCalendar {
    pub fn new() -> Self {
        Self {
            tick: Tick(0),
            day: 80, // start in late spring
            season: Season::Spring,
            year: 1,
        }
    }

    /// Advance by one tick. Returns true if day changed.
    pub fn advance(&mut self) -> bool {
        self.tick.0 += 1;
        let new_day = (self.tick.0 / TICKS_PER_DAY) as u32;
        if new_day != self.day {
            self.day = new_day;
            self.year = 1 + self.day / DAYS_PER_YEAR;
            self.season = Season::from_day(self.day);
            true
        } else {
            false
        }
    }

    /// Time of day as 0.0..1.0 (0.0 = midnight, 0.5 = noon).
    pub fn time_of_day(&self) -> f32 {
        let tick_in_day = self.tick.0 % TICKS_PER_DAY;
        tick_in_day as f32 / TICKS_PER_DAY as f32
    }

    /// Sunlight factor based on time of day (simplified sinusoidal).
    pub fn sunlight_factor(&self) -> f32 {
        let t = self.time_of_day();
        // Sun rises at 0.25 (6am), peaks at 0.5 (noon), sets at 0.75 (6pm)
        if t < 0.25 || t > 0.75 {
            0.0
        } else {
            let x = (t - 0.25) / 0.5; // 0..1 during daylight
            (x * std::f32::consts::PI).sin()
        }
    }
}

impl Default for GameCalendar {
    fn default() -> Self {
        Self::new()
    }
}
