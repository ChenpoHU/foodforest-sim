//! Water cycle system: rainfall, surface flow, infiltration, swale retention.
//! Runs every 20 ticks (1 second).

use crate::components::soil::SoilGrid;
use crate::Resources;
use ff_common::VoxelMaterial;
use ff_voxel::VoxelWorld;

pub fn run(soil_grid: &mut SoilGrid, terrain: &VoxelWorld, resources: &Resources) {
    let rainfall = resources.weather.rainfall;

    let w = soil_grid.width;
    let d = soil_grid.depth;

    // 1. Rainfall adds moisture to surface soil
    if rainfall > 0.0 {
        let moisture_add = rainfall * 0.01; // scale rainfall to moisture fraction
        for z in 0..d {
            for x in 0..w {
                let soil = soil_grid.surface_mut(x, z);
                soil.moisture = (soil.moisture + moisture_add).min(1.0);
            }
        }
    }

    // 2. Surface water flow: excess moisture flows downhill
    // Collect flow targets first to avoid aliasing
    let mut flow_targets: Vec<(usize, usize, f32)> = Vec::new();

    for z in 0..d {
        for x in 0..w {
            let soil = soil_grid.surface(x, z);

            // Only flow if saturated
            if soil.moisture <= 0.7 {
                continue;
            }

            // Check if standing on a swale (blocks horizontal flow)
            let terrain_x = x as i32;
            let terrain_z = z as i32;
            let surface_y = terrain.height_at(terrain_x, terrain_z);
            let surface_mat = terrain.material_at(terrain_x, surface_y, terrain_z);

            if surface_mat == VoxelMaterial::Swale {
                // Swale: water infiltrates vertically instead of flowing
                // (handled in step 3)
                continue;
            }

            // Find downhill neighbor
            let (dx, dz) = terrain.downhill_dir(terrain_x, terrain_z);
            if dx == 0 && dz == 0 {
                continue; // no downhill neighbor (flat or lowest point)
            }

            let target_x = (x as i32 + dx) as usize;
            let target_z = (z as i32 + dz) as usize;

            if target_x < w && target_z < d {
                let excess = soil.moisture - 0.7;
                let flow_amount = excess * 0.3; // 30% of excess flows per cycle
                flow_targets.push((target_x, target_z, flow_amount));

                let soil = soil_grid.surface_mut(x, z);
                soil.moisture -= flow_amount;
            }
        }
    }

    // Apply flow
    for (tx, tz, amount) in flow_targets {
        let target_soil = soil_grid.surface_mut(tx, tz);
        target_soil.moisture = (target_soil.moisture + amount).min(1.0);
    }

    // 3. Vertical infiltration: moisture seeps from surface to deeper layers
    for z in 0..d {
        for x in 0..w {
            let layers = soil_grid.layers;
            for layer in 0..layers.saturating_sub(1) {
                let upper_moisture = soil_grid.get(x, z, layer).moisture;
                let compaction = soil_grid.get(x, z, layer).compaction;

                // Infiltration rate reduced by compaction
                let infiltration = upper_moisture * 0.05 * (1.0 - compaction * 0.8);

                if infiltration > 0.001 {
                    soil_grid.get_mut(x, z, layer).moisture -= infiltration;
                    soil_grid.get_mut(x, z, layer + 1).moisture =
                        (soil_grid.get(x, z, layer + 1).moisture + infiltration).min(1.0);
                }
            }

            // Swale bonus: extra infiltration at swale positions
            let terrain_x = x as i32;
            let terrain_z = z as i32;
            let surface_y = terrain.height_at(terrain_x, terrain_z);
            if terrain.material_at(terrain_x, surface_y, terrain_z) == VoxelMaterial::Swale {
                let surface = soil_grid.surface_mut(x, z);
                let extra = surface.moisture * 0.1;
                surface.moisture -= extra;
                if layers > 1 {
                    soil_grid.get_mut(x, z, 1).moisture =
                        (soil_grid.get(x, z, 1).moisture + extra).min(1.0);
                }
            }
        }
    }
}
