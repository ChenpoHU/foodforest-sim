use glam::Vec3;
use serde::{Deserialize, Serialize};

/// World-space position in voxel coordinates.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Position(pub Vec3);

/// Heading / yaw in radians.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Rotation(pub f32);

/// Linear velocity (voxels per second).
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Velocity(pub Vec3);
