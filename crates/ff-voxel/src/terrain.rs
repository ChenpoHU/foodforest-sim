//! Terrain query helpers used by ECS systems (physics, planting, water flow).

use crate::VoxelWorld;
use ff_common::VoxelMaterial;

impl VoxelWorld {
    /// Get the surface height at (x, z) — the Y of the highest solid voxel.
    /// Returns 0 if the column is entirely air.
    pub fn height_at(&self, x: i32, z: i32) -> i32 {
        if x < 0 || z < 0 || x >= self.width as i32 || z >= self.depth as i32 {
            return 0;
        }
        for y in (0..self.height as i32).rev() {
            let mat = self.get(x, y, z);
            if mat != VoxelMaterial::Air {
                return y;
            }
        }
        0
    }

    /// Check whether a voxel is solid (non-air, non-water).
    #[inline]
    pub fn is_solid(&self, x: i32, y: i32, z: i32) -> bool {
        let mat = self.get(x, y, z);
        !matches!(mat, VoxelMaterial::Air | VoxelMaterial::Water)
    }

    /// Get the material at a position, returning Air for out-of-bounds.
    #[inline]
    pub fn material_at(&self, x: i32, y: i32, z: i32) -> VoxelMaterial {
        self.get(x, y, z)
    }

    /// Check if position is above ground (useful for entity placement).
    pub fn is_above_ground(&self, x: i32, y: i32, z: i32) -> bool {
        if y <= 0 {
            return false;
        }
        !self.is_solid(x, y, z) && self.is_solid(x, y - 1, z)
    }

    /// Surface Y at (x, z): top face of the highest solid voxel.
    pub fn spawn_height(&self, x: i32, z: i32) -> f32 {
        self.height_at(x, z) as f32 + 0.5
    }

    /// Simple slope check: max height difference among 4 neighbors.
    /// Used for water flow direction.
    pub fn slope_at(&self, x: i32, z: i32) -> f32 {
        let h = self.height_at(x, z) as f32;
        let mut max_diff: f32 = 0.0;
        for (dx, dz) in [(-1, 0), (1, 0), (0, -1), (0, 1)] {
            let nh = self.height_at(x + dx, z + dz) as f32;
            max_diff = max_diff.max((h - nh).abs());
        }
        max_diff
    }

    /// Get the lowest neighbor direction for water flow. Returns (dx, dz).
    pub fn downhill_dir(&self, x: i32, z: i32) -> (i32, i32) {
        let h = self.height_at(x, z);
        let mut best = (0i32, 0i32);
        let mut lowest = h;
        for (dx, dz) in [(-1, 0), (1, 0), (0, -1), (0, 1)] {
            let nh = self.height_at(x + dx, z + dz);
            if nh < lowest {
                lowest = nh;
                best = (dx, dz);
            }
        }
        best
    }
}
