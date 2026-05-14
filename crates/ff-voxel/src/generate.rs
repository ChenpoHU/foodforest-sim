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
    pub snow_line: f32,
    pub ocean_north: bool,
    pub ocean_south: bool,
    pub ocean_west: bool,
    pub ocean_east: bool,
    pub red_soil: bool,
}

impl RegionParams {
    const fn land(
        base: f32, amp: f32, freq: f32,
        moist: f32, rock: f32, river: bool,
    ) -> Self {
        Self {
            base_elevation: base, hill_amplitude: amp, hill_frequency: freq,
            moisture: moist, rockiness: rock, river,
            snow_line: 99.0, ocean_north: false, ocean_south: false,
            ocean_west: false, ocean_east: false, red_soil: false,
        }
    }

    const fn coastal(
        base: f32, amp: f32, freq: f32,
        moist: f32, rock: f32, river: bool,
        on: bool, os: bool, ow: bool, oe: bool,
    ) -> Self {
        Self {
            base_elevation: base, hill_amplitude: amp, hill_frequency: freq,
            moisture: moist, rockiness: rock, river,
            snow_line: 99.0,
            ocean_north: on, ocean_south: os, ocean_west: ow, ocean_east: oe,
            red_soil: false,
        }
    }

    const fn mountain(
        base: f32, amp: f32, freq: f32,
        moist: f32, rock: f32, river: bool, snow: f32,
    ) -> Self {
        Self {
            base_elevation: base, hill_amplitude: amp, hill_frequency: freq,
            moisture: moist, rockiness: rock, river,
            snow_line: snow,
            ocean_north: false, ocean_south: false,
            ocean_west: false, ocean_east: false, red_soil: false,
        }
    }
}

pub const PLOT_SIZE: u32 = 80;
pub const GRID_SIDE: u32 = 4;
pub const WORLD_XZ: u32 = PLOT_SIZE * GRID_SIDE;
pub const WORLD_H: u32 = 32;

pub struct CountryInfo {
    pub name: &'static str,
    pub region_start: u8,
    pub region_count: u8,
}

pub const COUNTRIES: &[CountryInfo] = &[
    CountryInfo { name: "Portugal",      region_start: 0,  region_count: 7 },
    CountryInfo { name: "France",        region_start: 7,  region_count: 4 },
    CountryInfo { name: "Spain",         region_start: 11, region_count: 4 },
    CountryInfo { name: "Italy",         region_start: 15, region_count: 4 },
    CountryInfo { name: "Iran",          region_start: 19, region_count: 4 },
    CountryInfo { name: "California",    region_start: 23, region_count: 4 },
    CountryInfo { name: "South Africa",  region_start: 27, region_count: 4 },
    CountryInfo { name: "Yunnan, China", region_start: 31, region_count: 4 },
    CountryInfo { name: "Japan",         region_start: 35, region_count: 4 },
];

pub const REGIONS: &[(&str, RegionParams)] = &[
    // === Portugal 0-6 ===
    ("Minho",
     RegionParams::coastal(10.0, 7.0, 0.06, 0.8, 0.2, true, false, false, true, false)),
    ("Tras-os-Montes",
     RegionParams::mountain(14.0, 10.0, 0.04, 0.3, 0.5, false, 28.0)),
    ("Beira",
     RegionParams::land(12.0, 8.0, 0.05, 0.5, 0.4, true)),
    ("Ribatejo",
     RegionParams::land(6.0, 3.0, 0.03, 0.6, 0.1, true)),
    ("Alentejo",
     RegionParams::land(8.0, 4.0, 0.03, 0.2, 0.3, false)),
    ("Algarve",
     RegionParams::coastal(5.0, 5.0, 0.06, 0.3, 0.3, false, false, true, false, false)),
    ("Lisboa",
     RegionParams::coastal(8.0, 5.0, 0.05, 0.5, 0.2, true, false, false, true, false)),

    // === France 7-10 ===
    ("Provence",
     RegionParams::coastal(8.0, 6.0, 0.05, 0.3, 0.3, false, false, true, false, false)),
    ("Dordogne",
     RegionParams::land(10.0, 6.0, 0.04, 0.6, 0.2, true)),
    ("Loire Valley",
     RegionParams::land(7.0, 4.0, 0.03, 0.7, 0.1, true)),
    ("Normandy",
     RegionParams::coastal(6.0, 5.0, 0.04, 0.8, 0.2, true, true, false, false, false)),

    // === Spain 11-14 ===
    ("Andalusia",
     RegionParams::coastal(9.0, 7.0, 0.05, 0.2, 0.4, false, false, true, false, false)),
    ("Catalonia",
     RegionParams::coastal(10.0, 8.0, 0.05, 0.4, 0.3, false, false, false, false, true)),
    ("Galicia",
     RegionParams::coastal(8.0, 6.0, 0.06, 0.8, 0.2, true, true, false, true, false)),
    ("Basque Country",
     RegionParams::coastal(10.0, 8.0, 0.05, 0.7, 0.3, true, true, false, false, false)),

    // === Italy 15-18 ===
    ("Tuscany",
     RegionParams::land(10.0, 7.0, 0.04, 0.5, 0.3, true)),
    ("Sicily",
     RegionParams::coastal(7.0, 6.0, 0.06, 0.2, 0.3, false, false, true, true, true)),
    ("Amalfi Coast",
     RegionParams::coastal(12.0, 9.0, 0.07, 0.4, 0.5, false, false, true, true, false)),
    ("Piedmont",
     RegionParams::mountain(12.0, 9.0, 0.04, 0.6, 0.4, true, 26.0)),

    // === Iran 19-22 ===
    ("Isfahan",
     RegionParams::land(14.0, 6.0, 0.03, 0.1, 0.5, true)),
    ("Shiraz",
     RegionParams::land(12.0, 7.0, 0.04, 0.15, 0.4, false)),
    ("Gilan",
     RegionParams::coastal(8.0, 7.0, 0.05, 0.8, 0.3, false, true, false, false, false)),
    ("Alborz",
     RegionParams::mountain(16.0, 12.0, 0.04, 0.3, 0.6, true, 24.0)),

    // === California 23-26 ===
    ("Central Valley",
     RegionParams::land(6.0, 3.0, 0.02, 0.3, 0.1, true)),
    ("Napa Valley",
     RegionParams::land(8.0, 5.0, 0.04, 0.4, 0.2, true)),
    ("Coastal Range",
     RegionParams::coastal(10.0, 8.0, 0.05, 0.5, 0.4, false, false, false, true, false)),
    ("Sierra Nevada",
     RegionParams::mountain(16.0, 12.0, 0.04, 0.4, 0.5, true, 22.0)),

    // === South Africa 27-30 ===
    ("Cape Winelands", {
        let mut p = RegionParams::land(8.0, 6.0, 0.04, 0.4, 0.2, true);
        p.red_soil = true;
        p
    }),
    ("Fynbos Coast",
     RegionParams::coastal(6.0, 5.0, 0.06, 0.3, 0.3, false, false, true, true, false)),
    ("Karoo",
     RegionParams::land(12.0, 5.0, 0.03, 0.1, 0.5, false)),
    ("Garden Route",
     RegionParams::coastal(7.0, 6.0, 0.05, 0.7, 0.2, true, false, true, false, false)),

    // === Yunnan, China 31-34 ===
    ("Kunming Plateau",
     RegionParams::mountain(14.0, 6.0, 0.04, 0.6, 0.3, true, 28.0)),
    ("Xishuangbanna",
     RegionParams::land(6.0, 4.0, 0.03, 0.9, 0.1, true)),
    ("Dali",
     RegionParams::mountain(12.0, 8.0, 0.05, 0.6, 0.3, true, 26.0)),
    ("Tiger Leaping Gorge",
     RegionParams::mountain(18.0, 12.0, 0.06, 0.5, 0.6, true, 22.0)),

    // === Japan 35-38 ===
    ("Hokkaido",
     RegionParams::coastal(10.0, 7.0, 0.04, 0.7, 0.2, true, true, false, false, true)),
    ("Kanto",
     RegionParams::coastal(8.0, 6.0, 0.05, 0.6, 0.2, true, false, false, false, true)),
    ("Kansai",
     RegionParams::land(9.0, 6.0, 0.05, 0.6, 0.3, true)),
    ("Kyushu",
     RegionParams::coastal(7.0, 7.0, 0.06, 0.7, 0.3, true, false, true, true, false)),
];

pub fn native_species_for_region(region_index: u8) -> &'static [u16] {
    let country = COUNTRIES.iter().find(|c|
        region_index >= c.region_start && region_index < c.region_start + c.region_count
    );
    match country.map(|c| c.name) {
        Some("Portugal")      => &[100, 101, 102, 200, 201, 202, 203, 300, 301, 400, 500],
        Some("France")        => &[100, 101, 104, 200, 204, 301, 302, 400, 500, 600],
        Some("Spain")         => &[102, 105, 106, 201, 202, 203, 300, 301, 500, 600],
        Some("Italy")         => &[100, 104, 109, 200, 203, 401, 500, 600],
        Some("Iran")          => &[101, 110, 201, 206, 402, 500],
        Some("California")    => &[107, 205, 303, 500, 600],
        Some("South Africa")  => &[108, 304, 305, 500],
        Some("Yunnan, China") => &[111, 207, 208, 210, 306, 500],
        Some("Japan")         => &[112, 209, 306, 403, 500],
        _                     => &[100, 200, 300, 400, 500],
    }
}

pub fn invasive_species_for_region(region_index: u8) -> Option<u16> {
    let country = COUNTRIES.iter().find(|c|
        region_index >= c.region_start && region_index < c.region_start + c.region_count
    );
    match country.map(|c| c.name) {
        Some("Portugal") | Some("Spain") => Some(103),
        Some("South Africa") => Some(103),
        Some("California") => Some(103),
        _ => None,
    }
}

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
    let ocean_level = 4u32;

    let mut world = VoxelWorld::new(width, height, depth);

    for z in 0..depth {
        for x in 0..width {
            let hx = x as f32 * params.hill_frequency;
            let hz = z as f32 * params.hill_frequency;

            // Ocean fade: how close to an ocean edge (0.0 = deep ocean, 1.0 = inland)
            let edge_dist = ocean_blend(x, z, width, depth, &params);

            let n1 = fbm(hx, hz, seed, 4);
            let n2 = fbm(hx * 2.3, hz * 2.3, seed ^ 0xABCD, 2) * 0.3;
            let raw_h = params.base_elevation + (n1 + n2) * params.hill_amplitude;

            // Blend terrain height toward ocean level near ocean edges
            let terrain_h = if edge_dist < 1.0 {
                let ocean_h = ocean_level as f32 - 1.0;
                ocean_h + (raw_h - ocean_h) * edge_dist.max(0.0)
            } else {
                raw_h
            };
            let terrain_h = terrain_h.max(1.0).min((height - 3) as f32);
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
                let mat = if edge_dist < 0.05 && y <= ocean_level {
                    // Deep ocean
                    if y == ocean_level { VoxelMaterial::Ocean }
                    else if y == 0 { VoxelMaterial::Stone }
                    else { VoxelMaterial::Ocean }
                } else if edge_dist < 0.3 && y <= ocean_level && y > ground {
                    // Shallow water near coast
                    VoxelMaterial::Water
                } else if edge_dist < 0.4 && y == ground && ground <= ocean_level + 1 {
                    VoxelMaterial::Sand
                } else if river_dist < 3.0 && y == ground.saturating_sub(1) {
                    VoxelMaterial::Water
                } else if river_dist < 2.0 && y == ground {
                    VoxelMaterial::Water
                } else if river_dist < 5.0 && y == ground {
                    VoxelMaterial::Sand
                } else if y > ground {
                    VoxelMaterial::Air
                } else if y == ground {
                    if ground as f32 >= params.snow_line {
                        VoxelMaterial::Snow
                    } else if ground as f32 >= params.snow_line - 3.0 {
                        if rock_noise > 0.3 { VoxelMaterial::Gravel } else { VoxelMaterial::Snow }
                    } else if is_rocky {
                        VoxelMaterial::Stone
                    } else {
                        VoxelMaterial::Grass
                    }
                } else if y >= ground.saturating_sub(2) {
                    if ground as f32 >= params.snow_line - 2.0 {
                        VoxelMaterial::Stone
                    } else if is_rocky {
                        VoxelMaterial::Stone
                    } else if params.red_soil {
                        VoxelMaterial::RedSoil
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

fn ocean_blend(x: u32, z: u32, w: u32, d: u32, params: &RegionParams) -> f32 {
    let fade = 40.0f32; // voxels of transition
    let mut min_dist = f32::MAX;

    if params.ocean_west {
        min_dist = min_dist.min(x as f32);
    }
    if params.ocean_east {
        min_dist = min_dist.min((w - 1 - x) as f32);
    }
    if params.ocean_north {
        min_dist = min_dist.min(z as f32);
    }
    if params.ocean_south {
        min_dist = min_dist.min((d - 1 - z) as f32);
    }

    if min_dist == f32::MAX {
        return 1.0; // no ocean
    }

    (min_dist / fade).min(1.0)
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
