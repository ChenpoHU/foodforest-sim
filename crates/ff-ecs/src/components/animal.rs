use glam::Vec3;
use serde::{Deserialize, Serialize};

/// Core animal component.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Animal {
    pub species_id: u16,
    pub behavior: AnimalBehavior,
    pub hunger: f32,
    pub energy: f32,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum AnimalBehavior {
    Idle,
    Wandering,
    Foraging,
    Fleeing { from_x: f32, from_z: f32 },
    Following { target_entity: u64 },
    Sleeping,
    /// Chickens scratch soil (reduces compaction, adds organic matter).
    Scratching,
    /// Bees pollinate nearby flowering plants.
    Pollinating,
}

/// Marker: wild animal (deer, boar, birds).
#[derive(Debug, Clone, Copy)]
pub struct WildAnimal;

/// Domesticated animal (chickens, ducks, bees) with a home range.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Domesticated {
    pub pen_center: Vec3,
    pub pen_radius: f32,
}
