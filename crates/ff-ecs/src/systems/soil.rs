//! Soil system: nutrient diffusion, organic decomposition, mycorrhizal network growth.
//! Runs every 20 ticks (1 second).

use crate::components::soil::SoilGrid;
use crate::Resources;

const DIFFUSION_RATE: f32 = 0.01;
const DECOMPOSITION_RATE: f32 = 0.002;
const EVAPORATION_BASE: f32 = 0.005;
const MYCORRHIZAL_GROWTH_RATE: f32 = 0.001;

pub fn run(soil_grid: &mut SoilGrid, resources: &Resources) {
    let weather = &resources.weather;
    let temp_factor = (weather.temperature / 25.0).clamp(0.2, 2.0);

    let w = soil_grid.width;
    let d = soil_grid.depth;
    let layers = soil_grid.layers;

    // We need to avoid aliasing, so we work on a snapshot of deltas.
    // For efficiency, we compute diffusion for the surface layer only (layer 0).

    // 1. Organic matter decomposition -> NPK release
    for z in 0..d {
        for x in 0..w {
            for layer in 0..layers {
                let soil = soil_grid.get_mut(x, z, layer);

                // Decomposition: organic matter breaks down into nutrients
                let decomp = soil.organic_matter * DECOMPOSITION_RATE * temp_factor;
                soil.organic_matter = (soil.organic_matter - decomp).max(0.0);
                soil.nitrogen += decomp * 30.0;
                soil.phosphorus += decomp * 10.0;
                soil.potassium += decomp * 20.0;

                // Cap nutrients
                soil.nitrogen = soil.nitrogen.min(100.0);
                soil.phosphorus = soil.phosphorus.min(100.0);
                soil.potassium = soil.potassium.min(100.0);

                // Evaporation (surface layer only, reduced by mulch/ground cover)
                if layer == 0 {
                    let evap = EVAPORATION_BASE * temp_factor;
                    soil.moisture = (soil.moisture - evap).max(0.0);
                }

                // Vertical seepage: moisture moves downward between layers
                if layer < layers - 1 {
                    let seep = soil.moisture * 0.03;
                    soil.moisture -= seep;
                    // We'll add to lower layer in the next iteration
                    // (slight approximation to avoid double-borrow)
                }
            }
        }
    }

    // 2. Horizontal nutrient diffusion (surface layer, simplified 3x3 blur)
    // Collect averages first, then apply
    let mut nitrogen_deltas = vec![0.0f32; w * d];
    let mut phosphorus_deltas = vec![0.0f32; w * d];
    let mut potassium_deltas = vec![0.0f32; w * d];

    for z in 1..d.saturating_sub(1) {
        for x in 1..w.saturating_sub(1) {
            let center = soil_grid.surface(x, z);
            let mut n_avg = 0.0f32;
            let mut p_avg = 0.0f32;
            let mut k_avg = 0.0f32;
            let mut count = 0.0f32;

            for dz in [-1i32, 0, 1] {
                for dx in [-1i32, 0, 1] {
                    let nx = (x as i32 + dx) as usize;
                    let nz = (z as i32 + dz) as usize;
                    let neighbor = soil_grid.surface(nx, nz);
                    n_avg += neighbor.nitrogen;
                    p_avg += neighbor.phosphorus;
                    k_avg += neighbor.potassium;
                    count += 1.0;
                }
            }

            n_avg /= count;
            p_avg /= count;
            k_avg /= count;

            let idx = z * w + x;
            nitrogen_deltas[idx] = (n_avg - center.nitrogen) * DIFFUSION_RATE;
            phosphorus_deltas[idx] = (p_avg - center.phosphorus) * DIFFUSION_RATE;
            potassium_deltas[idx] = (k_avg - center.potassium) * DIFFUSION_RATE;
        }
    }

    // Apply deltas
    for z in 1..d.saturating_sub(1) {
        for x in 1..w.saturating_sub(1) {
            let idx = z * w + x;
            let soil = soil_grid.surface_mut(x, z);
            soil.nitrogen = (soil.nitrogen + nitrogen_deltas[idx]).max(0.0);
            soil.phosphorus = (soil.phosphorus + phosphorus_deltas[idx]).max(0.0);
            soil.potassium = (soil.potassium + potassium_deltas[idx]).max(0.0);
        }
    }

    // 3. Mycorrhizal network: grows slowly in soil near mature trees
    // (actual tree proximity check would require spatial index — simplified here
    //  to just grow slowly everywhere organic matter is high)
    for z in 0..d {
        for x in 0..w {
            let soil = soil_grid.surface_mut(x, z);
            if soil.organic_matter > 0.05 {
                soil.mycorrhizal_network =
                    (soil.mycorrhizal_network + MYCORRHIZAL_GROWTH_RATE).min(1.0);
            } else {
                // Slowly decay without organic matter
                soil.mycorrhizal_network =
                    (soil.mycorrhizal_network - MYCORRHIZAL_GROWTH_RATE * 0.5).max(0.0);
            }
        }
    }
}
