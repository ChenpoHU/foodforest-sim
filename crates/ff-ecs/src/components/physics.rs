use glam::Vec3;
use serde::{Deserialize, Serialize};

/// Axis-aligned bounding box collider (half-extents from center).
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Collider {
    pub half_extents: Vec3,
}

/// Whether the entity is standing on solid ground.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Grounded(pub bool);

/// Mass in kilograms (affects gravity, not currently used for physics sim).
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Mass(pub f32);
