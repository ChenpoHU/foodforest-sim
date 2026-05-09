use crate::resources::calendar::{GameCalendar, Season};
use serde::{Deserialize, Serialize};

/// Current weather state — updated once per game day with random variation.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Weather {
    /// Temperature in Celsius.
    pub temperature: f32,
    /// Rainfall in mm per tick (0.0 = dry).
    pub rainfall: f32,
    /// Wind speed in m/s.
    pub wind_speed: f32,
    /// Cloud cover fraction (0.0..1.0).
    pub cloud_cover: f32,
    /// Effective sunlight after clouds and time-of-day (0.0..1.0).
    pub sunlight: f32,
}

impl Default for Weather {
    fn default() -> Self {
        Self {
            temperature: 22.0,
            rainfall: 0.0,
            wind_speed: 3.0,
            cloud_cover: 0.2,
            sunlight: 0.8,
        }
    }
}

impl Weather {
    /// Generate seasonal weather for a Mediterranean climate.
    /// Called once per game day with a random seed.
    pub fn generate_daily(calendar: &GameCalendar, rand_val: f32) -> Self {
        let (base_temp, base_rain_chance, base_cloud) = match calendar.season {
            Season::Spring => (16.0, 0.3, 0.35),
            Season::Summer => (30.0, 0.05, 0.1),
            Season::Autumn => (18.0, 0.35, 0.4),
            Season::Winter => (8.0, 0.45, 0.55),
        };

        // Random variation: rand_val is 0.0..1.0
        let temp_variation = (rand_val - 0.5) * 10.0;
        let temperature = base_temp + temp_variation;

        let is_rainy = rand_val < base_rain_chance;
        let rainfall = if is_rainy {
            0.5 + rand_val * 2.0
        } else {
            0.0
        };

        let cloud_cover = if is_rainy {
            0.7 + rand_val * 0.3
        } else {
            base_cloud + (rand_val - 0.5) * 0.2
        }
        .clamp(0.0, 1.0);

        let sunlight = (1.0 - cloud_cover) * calendar.sunlight_factor();
        let wind_speed = 2.0 + rand_val * 8.0;

        Self {
            temperature,
            rainfall,
            wind_speed,
            cloud_cover,
            sunlight,
        }
    }

    /// Update sunlight based on current time of day (called every tick).
    pub fn update_sunlight(&mut self, calendar: &GameCalendar) {
        self.sunlight = (1.0 - self.cloud_cover) * calendar.sunlight_factor();
    }
}
