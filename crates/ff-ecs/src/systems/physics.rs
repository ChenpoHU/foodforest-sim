//! Physics system: gravity, AABB vs voxel collision, grounded detection.

use crate::components::transform::{Position, Velocity};
use crate::components::physics::{Collider, Grounded};
use ff_voxel::VoxelWorld;

const GRAVITY: f32 = -20.0; // voxels/sec^2

pub fn run(world: &mut hecs::World, terrain: &VoxelWorld, dt: f32) {
    for (_entity, (pos, vel, collider, grounded)) in world
        .query_mut::<(&mut Position, &mut Velocity, &Collider, &mut Grounded)>()
    {
        // Apply gravity
        vel.0.y += GRAVITY * dt;

        // Integrate position
        let new_pos = pos.0 + vel.0 * dt;

        // Resolve collision against voxel terrain (simple Y-axis resolution)
        let feet_x = new_pos.x as i32;
        let feet_z = new_pos.z as i32;
        let ground_y = terrain.height_at(feet_x, feet_z) as f32 + 0.5;

        let half_h = collider.half_extents.y;

        if new_pos.y - half_h < ground_y {
            // Snap to ground
            pos.0.x = new_pos.x;
            pos.0.z = new_pos.z;
            pos.0.y = ground_y + half_h;
            vel.0.y = 0.0;
            grounded.0 = true;
        } else {
            pos.0 = new_pos;
            grounded.0 = false;
        }

        // Horizontal bounds check (clamp to world)
        pos.0.x = pos.0.x.clamp(0.0, terrain.width as f32 - 1.0);
        pos.0.z = pos.0.z.clamp(0.0, terrain.depth as f32 - 1.0);
    }
}
