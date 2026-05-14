use crate::VoxelWorld;
use ff_common::VoxelMaterial;

#[derive(Debug, Clone, Copy)]
pub struct RegionParams {
    pub base_elevation: f32,
    pub hill_amplitude: f32,
    pub hill_frequency: f32,
    pub moisture: f32,
    pub rockiness: f32,
    pub river: bool,
}

pub const PLOT_SIZE: u32 = 80;
pub const GRID_SIDE: u32 = 4;
pub const WORLD_XZ: u32 = PLOT_SIZE * GRID_SIDE; // 320
pub const WORLD_H: u32 = 32;

pub const REGIONS: &[(&str, RegionParams)] = &[
    ("Minho", RegionParams {
        base_elevation: 10.0, hill_amplitude: 7.0, hill_frequency: 0.06,
        moisture: 0.8, rockiness: 0.2, river: true,
    }),
    ("Tras-os-Montes", RegionParams {
        base_elevation: 14.0, hill_amplitude: 10.0, hill_frequency: 0.04,
        moisture: 0.3, rockiness: 0.5, river: false,
    }),
    ("Beira", RegionParams {
        base_elevation: 12.0, hill_amplitude: 8.0, hill_frequency: 0.05,
        moisture: 0.5, rockiness: 0.4, river: true,
    }),
    ("Ribatejo", RegionParams {
        base_elevation: 6.0, hill_amplitude: 3.0, hill_frequency: 0.03,
        moisture: 0.6, rockiness: 0.1, river: true,
    }),
    ("Alentejo", RegionParams {
        base_elevation: 8.0, hill_amplitude: 4.0, hill_frequency: 0.03,
        moisture: 0.2, rockiness: 0.3, river: false,
    }),
    ("Algarve", RegionParams {
        base_elevation: 5.0, hill_amplitude: 5.0, hill_frequency: 0.06,
        moisture: 0.3, rockiness: 0.3, river: false,
    }),
    ("Lisboa", RegionParams {
        base_elevation: 8.0, hill_amplitude: 5.0, hill_frequency: 0.05,
        moisture: 0.5, rockiness: 0.2, river: true,
    }),
];

pub fn generate_terrain(region_index: u8, plot_seed: u32) -> VoxelWorld {
    let params = if (region_index as usize) < REGIONS.len() {
        REGIONS[region_index as usize].1
    } else {
        REGIONS[4].1
    };

    let width = WORLD_XZ;
    let height = WORLD_H;
    let depth = WORLD_XZ;
    let seed = plot_seed as u64;

    let mut world = VoxelWorld::new(width, height, depth);

    for z in 0..depth {
        for x in 0..width {
            let hx = x as f32 * params.hill_frequency;
            let hz = z as f32 * params.hill_frequency;

            let n1 = fbm(hx, hz, seed, 4);
            let n2 = fbm(hx * 2.3, hz * 2.3, seed ^ 0xABCD, 2) * 0.3;
            let terrain_h = params.base_elevation + (n1 + n2) * params.hill_amplitude;
            let terrain_h = terrain_h.max(2.0).min((height - 3) as f32);
            let ground = terrain_h as u32;

            let rock_noise = fbm(hx * 3.0, hz * 3.0, seed ^ 0x1234, 2);
            let is_rocky = rock_noise > (1.0 - params.rockiness);

            let river_dist = if params.river {
                let river_z = (depth as f32) * 0.5
                    + fbm(x as f32 * 0.015, 0.0, seed ^ 0x5678, 3) * 25.0;
                ((z as f32) - river_z).abs()
            } else {
                999.0
            };

            for y in 0..height {
                let mat = if river_dist < 3.0 && y == ground.saturating_sub(1) {
                    VoxelMaterial::Water
                } else if river_dist < 2.0 && y == ground {
                    VoxelMaterial::Water
                } else if river_dist < 5.0 && y == ground {
                    VoxelMaterial::Sand
                } else if y > ground {
                    VoxelMaterial::Air
                } else if y == ground {
                    if is_rocky {
                        VoxelMaterial::Stone
                    } else {
                        VoxelMaterial::Grass
                    }
                } else if y >= ground.saturating_sub(2) {
                    if is_rocky {
                        VoxelMaterial::Stone
                    } else {
                        let clay_noise = fbm(hx * 5.0, hz * 5.0, seed ^ 0x9ABC, 1);
                        if clay_noise > 0.6 {
                            VoxelMaterial::Clay
                        } else {
                            VoxelMaterial::Soil
                        }
                    }
                } else {
                    VoxelMaterial::Stone
                };

                world.set(x as i32, y as i32, z as i32, mat);
            }
        }
    }

    world
}

fn fbm(x: f32, z: f32, seed: u64, octaves: u32) -> f32 {
    let mut val = 0.0f32;
    let mut amp = 1.0f32;
    let mut freq = 1.0f32;
    let mut max_amp = 0.0f32;

    for i in 0..octaves {
        val += noise2d(x * freq, z * freq, seed.wrapping_add(i as u64)) * amp;
        max_amp += amp;
        amp *= 0.5;
        freq *= 2.0;
    }

    val / max_amp
}

fn noise2d(x: f32, z: f32, seed: u64) -> f32 {
    let ix = x.floor() as i32;
    let iz = z.floor() as i32;
    let fx = x - x.floor();
    let fz = z - z.floor();

    let sx = fx * fx * (3.0 - 2.0 * fx);
    let sz = fz * fz * (3.0 - 2.0 * fz);

    let n00 = hash_f(ix, iz, seed);
    let n10 = hash_f(ix + 1, iz, seed);
    let n01 = hash_f(ix, iz + 1, seed);
    let n11 = hash_f(ix + 1, iz + 1, seed);

    let nx0 = n00 + sx * (n10 - n00);
    let nx1 = n01 + sx * (n11 - n01);

    nx0 + sz * (nx1 - nx0)
}

fn hash_f(x: i32, z: i32, seed: u64) -> f32 {
    let mut h = seed;
    h = h.wrapping_mul(6364136223846793005).wrapping_add(x as u64);
    h = h.wrapping_mul(6364136223846793005).wrapping_add(z as u64);
    h = h ^ (h >> 33);
    h = h.wrapping_mul(0xff51afd7ed558ccd);
    h = h ^ (h >> 33);
    let bits = (h & 0xFFFF) as f32 / 65535.0;
    bits * 2.0 - 1.0
}
