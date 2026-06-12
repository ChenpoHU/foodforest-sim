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
    CountryInfo { name: "Portugal", region_start: 0, region_count: 1 },
    CountryInfo { name: "Spain", region_start: 1, region_count: 1 },
    CountryInfo { name: "France", region_start: 2, region_count: 1 },
    CountryInfo { name: "Italy", region_start: 3, region_count: 1 },
    CountryInfo { name: "Greece", region_start: 4, region_count: 1 },
    CountryInfo { name: "Germany", region_start: 5, region_count: 1 },
    CountryInfo { name: "United Kingdom", region_start: 6, region_count: 1 },
    CountryInfo { name: "Ireland", region_start: 7, region_count: 1 },
    CountryInfo { name: "Netherlands", region_start: 8, region_count: 1 },
    CountryInfo { name: "Switzerland", region_start: 9, region_count: 1 },
    CountryInfo { name: "Austria", region_start: 10, region_count: 1 },
    CountryInfo { name: "Poland", region_start: 11, region_count: 1 },
    CountryInfo { name: "Ukraine", region_start: 12, region_count: 1 },
    CountryInfo { name: "Russia", region_start: 13, region_count: 1 },
    CountryInfo { name: "Sweden", region_start: 14, region_count: 1 },
    CountryInfo { name: "Norway", region_start: 15, region_count: 1 },
    CountryInfo { name: "Romania", region_start: 16, region_count: 1 },
    CountryInfo { name: "Hungary", region_start: 17, region_count: 1 },
    CountryInfo { name: "Czechia", region_start: 18, region_count: 1 },
    CountryInfo { name: "Georgia", region_start: 19, region_count: 1 },
    CountryInfo { name: "Japan", region_start: 20, region_count: 1 },
    CountryInfo { name: "China", region_start: 21, region_count: 1 },
    CountryInfo { name: "South Korea", region_start: 22, region_count: 1 },
    CountryInfo { name: "India", region_start: 23, region_count: 1 },
    CountryInfo { name: "Indonesia", region_start: 24, region_count: 1 },
    CountryInfo { name: "Thailand", region_start: 25, region_count: 1 },
    CountryInfo { name: "Vietnam", region_start: 26, region_count: 1 },
    CountryInfo { name: "Philippines", region_start: 27, region_count: 1 },
    CountryInfo { name: "Malaysia", region_start: 28, region_count: 1 },
    CountryInfo { name: "Iran", region_start: 29, region_count: 1 },
    CountryInfo { name: "Turkey", region_start: 30, region_count: 1 },
    CountryInfo { name: "Israel", region_start: 31, region_count: 1 },
    CountryInfo { name: "Saudi Arabia", region_start: 32, region_count: 1 },
    CountryInfo { name: "Iraq", region_start: 33, region_count: 1 },
    CountryInfo { name: "Pakistan", region_start: 34, region_count: 1 },
    CountryInfo { name: "Bangladesh", region_start: 35, region_count: 1 },
    CountryInfo { name: "Sri Lanka", region_start: 36, region_count: 1 },
    CountryInfo { name: "Nepal", region_start: 37, region_count: 1 },
    CountryInfo { name: "Myanmar", region_start: 38, region_count: 1 },
    CountryInfo { name: "Kazakhstan", region_start: 39, region_count: 1 },
    CountryInfo { name: "Uzbekistan", region_start: 40, region_count: 1 },
    CountryInfo { name: "Cambodia", region_start: 41, region_count: 1 },
    CountryInfo { name: "South Africa", region_start: 42, region_count: 1 },
    CountryInfo { name: "Nigeria", region_start: 43, region_count: 1 },
    CountryInfo { name: "Egypt", region_start: 44, region_count: 1 },
    CountryInfo { name: "Kenya", region_start: 45, region_count: 1 },
    CountryInfo { name: "Ethiopia", region_start: 46, region_count: 1 },
    CountryInfo { name: "Morocco", region_start: 47, region_count: 1 },
    CountryInfo { name: "Tanzania", region_start: 48, region_count: 1 },
    CountryInfo { name: "Ghana", region_start: 49, region_count: 1 },
    CountryInfo { name: "Uganda", region_start: 50, region_count: 1 },
    CountryInfo { name: "Algeria", region_start: 51, region_count: 1 },
    CountryInfo { name: "Tunisia", region_start: 52, region_count: 1 },
    CountryInfo { name: "Senegal", region_start: 53, region_count: 1 },
    CountryInfo { name: "Cameroon", region_start: 54, region_count: 1 },
    CountryInfo { name: "Ivory Coast", region_start: 55, region_count: 1 },
    CountryInfo { name: "Zimbabwe", region_start: 56, region_count: 1 },
    CountryInfo { name: "Madagascar", region_start: 57, region_count: 1 },
    CountryInfo { name: "USA", region_start: 58, region_count: 1 },
    CountryInfo { name: "Canada", region_start: 59, region_count: 1 },
    CountryInfo { name: "Mexico", region_start: 60, region_count: 1 },
    CountryInfo { name: "Brazil", region_start: 61, region_count: 1 },
    CountryInfo { name: "Argentina", region_start: 62, region_count: 1 },
    CountryInfo { name: "Chile", region_start: 63, region_count: 1 },
    CountryInfo { name: "Colombia", region_start: 64, region_count: 1 },
    CountryInfo { name: "Peru", region_start: 65, region_count: 1 },
    CountryInfo { name: "Ecuador", region_start: 66, region_count: 1 },
    CountryInfo { name: "Bolivia", region_start: 67, region_count: 1 },
    CountryInfo { name: "Venezuela", region_start: 68, region_count: 1 },
    CountryInfo { name: "Cuba", region_start: 69, region_count: 1 },
    CountryInfo { name: "Guatemala", region_start: 70, region_count: 1 },
    CountryInfo { name: "Costa Rica", region_start: 71, region_count: 1 },
    CountryInfo { name: "Uruguay", region_start: 72, region_count: 1 },
    CountryInfo { name: "Paraguay", region_start: 73, region_count: 1 },
    CountryInfo { name: "Australia", region_start: 74, region_count: 1 },
    CountryInfo { name: "New Zealand", region_start: 75, region_count: 1 },
    CountryInfo { name: "Papua New Guinea", region_start: 76, region_count: 1 },
    CountryInfo { name: "Fiji", region_start: 77, region_count: 1 },
    CountryInfo { name: "Azerbaijan", region_start: 78, region_count: 1 },
    CountryInfo { name: "Lebanon", region_start: 79, region_count: 1 },
];

pub const REGIONS: &[(&str, RegionParams)] = &[
    ("Alentejo",
     RegionParams::land(8.0, 5.0, 0.04, 0.35, 0.3, false)),
    ("Andalusia",
     RegionParams::land(8.0, 5.0, 0.04, 0.35, 0.3, false)),
    ("Provence",
     RegionParams::land(8.0, 5.0, 0.04, 0.35, 0.3, false)),
    ("Tuscany",
     RegionParams::land(8.0, 5.0, 0.04, 0.35, 0.3, false)),
    ("Crete",
     RegionParams::land(8.0, 5.0, 0.04, 0.35, 0.3, false)),
    ("Bavaria",
     RegionParams::land(9.0, 5.0, 0.035, 0.5, 0.3, true)),
    ("Kent",
     RegionParams::land(10.0, 6.0, 0.04, 0.72, 0.3, true)),
    ("Munster",
     RegionParams::land(10.0, 6.0, 0.04, 0.72, 0.3, true)),
    ("Holland",
     RegionParams::land(10.0, 6.0, 0.04, 0.72, 0.3, true)),
    ("Valais",
     RegionParams::mountain(16.0, 11.0, 0.05, 0.6, 0.5, true, 30.0)),
    ("Tyrol",
     RegionParams::mountain(16.0, 11.0, 0.05, 0.6, 0.5, true, 30.0)),
    ("Masovia",
     RegionParams::land(9.0, 5.0, 0.035, 0.5, 0.3, true)),
    ("Cherkasy",
     RegionParams::land(9.0, 5.0, 0.035, 0.5, 0.3, true)),
    ("Krasnodar",
     RegionParams::land(9.0, 5.0, 0.035, 0.5, 0.3, true)),
    ("Skane",
     RegionParams::mountain(11.0, 6.0, 0.04, 0.55, 0.4, false, 18.0)),
    ("Vestland",
     RegionParams::mountain(11.0, 6.0, 0.04, 0.55, 0.4, false, 18.0)),
    ("Transylvania",
     RegionParams::land(9.0, 5.0, 0.035, 0.5, 0.3, true)),
    ("Pannonia",
     RegionParams::land(9.0, 5.0, 0.035, 0.5, 0.3, true)),
    ("Bohemia",
     RegionParams::land(9.0, 5.0, 0.035, 0.5, 0.3, true)),
    ("Kakheti",
     RegionParams::land(9.0, 5.0, 0.035, 0.5, 0.3, true)),
    ("Kansai",
     RegionParams::land(10.0, 6.0, 0.04, 0.72, 0.3, true)),
    ("Yunnan",
     RegionParams::mountain(16.0, 11.0, 0.05, 0.6, 0.5, true, 30.0)),
    ("Jeolla",
     RegionParams::land(10.0, 6.0, 0.04, 0.72, 0.3, true)),
    ("Kerala",
     RegionParams::land(7.0, 5.0, 0.045, 0.9, 0.25, true)),
    ("Bali",
     RegionParams::land(7.0, 5.0, 0.045, 0.9, 0.25, true)),
    ("Chiang Mai",
     RegionParams::land(7.0, 5.0, 0.045, 0.9, 0.25, true)),
    ("Mekong Delta",
     RegionParams::land(7.0, 5.0, 0.045, 0.9, 0.25, true)),
    ("Luzon",
     RegionParams::land(7.0, 5.0, 0.045, 0.9, 0.25, true)),
    ("Cameron Highlands",
     RegionParams::land(7.0, 5.0, 0.045, 0.9, 0.25, true)),
    ("Gilan",
     RegionParams::land(5.0, 3.0, 0.03, 0.2, 0.2, false)),
    ("Anatolia",
     RegionParams::land(8.0, 5.0, 0.04, 0.35, 0.3, false)),
    ("Galilee",
     RegionParams::land(8.0, 5.0, 0.04, 0.35, 0.3, false)),
    ("Asir",
     RegionParams::land(5.0, 3.0, 0.03, 0.2, 0.2, false)),
    ("Mesopotamia",
     RegionParams::land(5.0, 3.0, 0.03, 0.2, 0.2, false)),
    ("Punjab",
     RegionParams::land(5.0, 3.0, 0.03, 0.2, 0.2, false)),
    ("Bengal",
     RegionParams::land(7.0, 5.0, 0.045, 0.9, 0.25, true)),
    ("Kandy",
     RegionParams::land(7.0, 5.0, 0.045, 0.9, 0.25, true)),
    ("Kathmandu Valley",
     RegionParams::mountain(16.0, 11.0, 0.05, 0.6, 0.5, true, 30.0)),
    ("Shan",
     RegionParams::land(7.0, 5.0, 0.045, 0.9, 0.25, true)),
    ("Almaty",
     RegionParams::land(9.0, 5.0, 0.035, 0.5, 0.3, true)),
    ("Fergana",
     RegionParams::land(5.0, 3.0, 0.03, 0.2, 0.2, false)),
    ("Siem Reap",
     RegionParams::land(7.0, 5.0, 0.045, 0.9, 0.25, true)),
    ("Cape Winelands",
     RegionParams::land(8.0, 5.0, 0.04, 0.35, 0.3, false)),
    ("Cross River",
     RegionParams::land(7.0, 5.0, 0.045, 0.9, 0.25, true)),
    ("Nile Delta",
     RegionParams::land(5.0, 3.0, 0.03, 0.2, 0.2, false)),
    ("Rift Valley",
     RegionParams::mountain(16.0, 11.0, 0.05, 0.6, 0.5, true, 30.0)),
    ("Shewa",
     RegionParams::mountain(16.0, 11.0, 0.05, 0.6, 0.5, true, 30.0)),
    ("Atlas",
     RegionParams::land(8.0, 5.0, 0.04, 0.35, 0.3, false)),
    ("Kilimanjaro",
     RegionParams::mountain(16.0, 11.0, 0.05, 0.6, 0.5, true, 30.0)),
    ("Ashanti",
     RegionParams::land(7.0, 5.0, 0.045, 0.9, 0.25, true)),
    ("Buganda",
     RegionParams::land(7.0, 5.0, 0.045, 0.9, 0.25, true)),
    ("Tell Atlas",
     RegionParams::land(8.0, 5.0, 0.04, 0.35, 0.3, false)),
    ("Cap Bon",
     RegionParams::land(8.0, 5.0, 0.04, 0.35, 0.3, false)),
    ("Casamance",
     RegionParams::land(7.0, 4.0, 0.04, 0.35, 0.3, false)),
    ("West",
     RegionParams::land(7.0, 5.0, 0.045, 0.9, 0.25, true)),
    ("Lagunes",
     RegionParams::land(7.0, 5.0, 0.045, 0.9, 0.25, true)),
    ("Highveld",
     RegionParams::land(7.0, 4.0, 0.04, 0.35, 0.3, false)),
    ("Antananarivo",
     RegionParams::mountain(16.0, 11.0, 0.05, 0.6, 0.5, true, 30.0)),
    ("California",
     RegionParams::land(8.0, 5.0, 0.04, 0.35, 0.3, false)),
    ("British Columbia",
     RegionParams::land(10.0, 6.0, 0.04, 0.72, 0.3, true)),
    ("Oaxaca",
     RegionParams::mountain(16.0, 11.0, 0.05, 0.6, 0.5, true, 30.0)),
    ("Bahia",
     RegionParams::land(7.0, 5.0, 0.045, 0.9, 0.25, true)),
    ("Argentine Pampas",
     RegionParams::land(9.0, 5.0, 0.035, 0.5, 0.3, true)),
    ("Maipo Valley",
     RegionParams::land(8.0, 5.0, 0.04, 0.35, 0.3, false)),
    ("Antioquia",
     RegionParams::land(7.0, 5.0, 0.045, 0.9, 0.25, true)),
    ("Sacred Valley",
     RegionParams::mountain(16.0, 11.0, 0.05, 0.6, 0.5, true, 30.0)),
    ("Cotopaxi",
     RegionParams::mountain(16.0, 11.0, 0.05, 0.6, 0.5, true, 30.0)),
    ("Yungas",
     RegionParams::mountain(16.0, 11.0, 0.05, 0.6, 0.5, true, 30.0)),
    ("Merida",
     RegionParams::land(7.0, 5.0, 0.045, 0.9, 0.25, true)),
    ("Vinales",
     RegionParams::land(7.0, 5.0, 0.045, 0.9, 0.25, true)),
    ("Antigua",
     RegionParams::mountain(16.0, 11.0, 0.05, 0.6, 0.5, true, 30.0)),
    ("Meseta Central",
     RegionParams::land(7.0, 5.0, 0.045, 0.9, 0.25, true)),
    ("Uruguayan Pampas",
     RegionParams::land(9.0, 5.0, 0.035, 0.5, 0.3, true)),
    ("Itapua",
     RegionParams::land(7.0, 4.0, 0.04, 0.35, 0.3, false)),
    ("Tasmania",
     RegionParams::land(10.0, 6.0, 0.04, 0.72, 0.3, true)),
    ("Canterbury",
     RegionParams::land(10.0, 6.0, 0.04, 0.72, 0.3, true)),
    ("Wahgi Valley",
     RegionParams::land(7.0, 5.0, 0.045, 0.9, 0.25, true)),
    ("Viti Levu",
     RegionParams::land(7.0, 5.0, 0.045, 0.9, 0.25, true)),
    ("Ganja",
     RegionParams::land(5.0, 3.0, 0.03, 0.2, 0.2, false)),
    ("Bekaa",
     RegionParams::land(8.0, 5.0, 0.04, 0.35, 0.3, false)),
];

pub fn native_species_for_region(region_index: u8) -> &'static [u16] {
    let country = COUNTRIES.iter().find(|c|
        region_index >= c.region_start && region_index < c.region_start + c.region_count
    );
    match country.map(|c| c.name) {
        Some("Portugal") | Some("Spain") | Some("France") | Some("Italy") | Some("Greece") | Some("Turkey") | Some("Israel") | Some("South Africa") | Some("Morocco") | Some("Algeria") | Some("Tunisia") | Some("USA") | Some("Chile") | Some("Lebanon")
            => &[105, 200, 202, 203, 300, 500, 600],
        Some("Germany") | Some("Poland") | Some("Ukraine") | Some("Russia") | Some("Romania") | Some("Hungary") | Some("Czechia") | Some("Georgia") | Some("Kazakhstan") | Some("Argentina") | Some("Uruguay")
            => &[101, 104, 112, 204, 400, 500],
        Some("United Kingdom") | Some("Ireland") | Some("Netherlands") | Some("Japan") | Some("South Korea") | Some("Canada") | Some("Australia") | Some("New Zealand")
            => &[101, 104, 112, 204, 400, 500],
        Some("Switzerland") | Some("Austria") | Some("China") | Some("Nepal") | Some("Kenya") | Some("Ethiopia") | Some("Tanzania") | Some("Madagascar") | Some("Mexico") | Some("Peru") | Some("Ecuador") | Some("Bolivia") | Some("Guatemala")
            => &[101, 112, 306, 400, 500],
        Some("Sweden") | Some("Norway")
            => &[101, 104, 112, 204, 500],
        Some("India") | Some("Indonesia") | Some("Thailand") | Some("Vietnam") | Some("Philippines") | Some("Malaysia") | Some("Bangladesh") | Some("Sri Lanka") | Some("Myanmar") | Some("Cambodia") | Some("Nigeria") | Some("Ghana") | Some("Uganda") | Some("Cameroon") | Some("Ivory Coast") | Some("Brazil") | Some("Colombia") | Some("Venezuela") | Some("Cuba") | Some("Costa Rica") | Some("Papua New Guinea") | Some("Fiji")
            => &[111, 202, 207, 208, 306, 400, 500],
        Some("Iran") | Some("Saudi Arabia") | Some("Iraq") | Some("Pakistan") | Some("Uzbekistan") | Some("Egypt") | Some("Azerbaijan")
            => &[110, 200, 201, 402, 500],
        Some("Senegal") | Some("Zimbabwe") | Some("Paraguay")
            => &[201, 202, 208, 400, 500],
        _ => &[100, 200, 300, 400, 500],
    }
}

pub fn invasive_species_for_region(region_index: u8) -> Option<u16> {
    let country = COUNTRIES.iter().find(|c|
        region_index >= c.region_start && region_index < c.region_start + c.region_count
    );
    match country.map(|c| c.name) {
        Some("Portugal") | Some("Spain") | Some("France") | Some("Italy") | Some("Greece") | Some("Turkey") | Some("Israel") | Some("South Africa") | Some("Morocco") | Some("Algeria") | Some("Tunisia") | Some("USA") | Some("Chile") | Some("Lebanon") | Some("Australia")
            => Some(103),
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

    // ── Inland lakes: flood genuine basins so low hollows become real water,
    // Jiuzhaigou-style — a flat per-basin spill surface over a pale sand bed. ──
    flood_lakes(&mut world, &params, ocean_level);

    world
}

/// Fill inland depressions with lake water via a priority-flood (Barnes /
/// Planchon "fill"): for every column, compute the level it would flood to
/// before water could spill off the map edge. Where that sits above the actual
/// ground we have an enclosed basin, so we pour still water onto a pale sand
/// bed (which makes the shallows glow turquoise). This targets the REAL hollows
/// the player sees, not noise-defined patches.
fn flood_lakes(world: &mut VoxelWorld, params: &RegionParams, ocean_level: u32) {
    use std::cmp::Reverse;
    use std::collections::BinaryHeap;

    let w = world.width as i32;
    let d = world.depth as i32;
    let n = (w * d) as usize;
    if n < 4 {
        return;
    }
    let idx = |x: i32, z: i32| (z * w + x) as usize;

    // Top solid height per column.
    let mut ground = vec![0i32; n];
    for z in 0..d {
        for x in 0..w {
            ground[idx(x, z)] = world.height_at(x, z);
        }
    }

    // Priority-flood. Border columns drain off the map (water level = ground);
    // the interior is filled to the lowest spill level reachable from a border.
    let mut water = vec![i32::MAX; n];
    let mut heap: BinaryHeap<Reverse<(i32, i32)>> = BinaryHeap::new(); // (level, index)
    for z in 0..d {
        for x in 0..w {
            if x == 0 || z == 0 || x == w - 1 || z == d - 1 {
                let i = idx(x, z);
                water[i] = ground[i];
                heap.push(Reverse((water[i], i as i32)));
            }
        }
    }
    while let Some(Reverse((lvl, i32idx))) = heap.pop() {
        let i = i32idx as usize;
        if lvl > water[i] {
            continue; // stale entry
        }
        let x = (i as i32) % w;
        let z = (i as i32) / w;
        for (dx, dz) in [(-1, 0), (1, 0), (0, -1), (0, 1)] {
            let (nx, nz) = (x + dx, z + dz);
            if nx < 0 || nz < 0 || nx >= w || nz >= d {
                continue;
            }
            let ni = idx(nx, nz);
            let spill = water[i].max(ground[ni]);
            if spill < water[ni] {
                water[ni] = spill;
                heap.push(Reverse((spill, ni as i32)));
            }
        }
    }

    // Precompute basin depth per column (0 = drains away / disqualified). A
    // column only qualifies if it's inland, above sea level, and not already
    // river/ocean water. Done before any mutation so we never hold an immutable
    // borrow of `world` while pouring.
    let mut depth = vec![0i32; n];
    for z in 0..d {
        for x in 0..w {
            let i = idx(x, z);
            let g = ground[i];
            if g < ocean_level as i32 {
                continue;
            }
            if ocean_blend(x as u32, z as u32, world.width, world.depth, params) < 0.45 {
                continue;
            }
            if matches!(world.get(x, g, z), VoxelMaterial::Water | VoxelMaterial::Ocean) {
                continue;
            }
            depth[i] = (water[i] - g).max(0);
        }
    }

    // Group flooded cells (depth ≥ 1) into connected basins, then flood each
    // kept basin WHOLE — its shallow shores AND deep middle. That's the fix for
    // "water in the air": if we flooded only the deep core, the dry shallow rim
    // would leave the core standing as an exposed column. A whole basin is
    // contained by its own dry banks (which sit at the water line), so it reads
    // as a proper lake. We keep only basins with a genuinely deep core, and cap
    // total coverage by taking the deepest basins first.
    const MIN_CORE_DEPTH: i32 = 3;
    let cap = (n as f32 * 0.07) as usize; // ≤ ~7% of the map as lakes
    let mut visited = vec![false; n];
    let mut keep = vec![false; n];
    let mut components: Vec<(i32, Vec<usize>)> = Vec::new(); // (max_depth, cells)
    let mut stack: Vec<usize> = Vec::new();
    for start in 0..n {
        if visited[start] || depth[start] < 1 {
            continue;
        }
        visited[start] = true;
        stack.clear();
        stack.push(start);
        let mut cells: Vec<usize> = Vec::new();
        let mut max_depth = 0i32;
        while let Some(c) = stack.pop() {
            cells.push(c);
            if depth[c] > max_depth {
                max_depth = depth[c];
            }
            let cx = (c % w as usize) as i32;
            let cz = (c / w as usize) as i32;
            for (dx, dz) in [(-1, 0), (1, 0), (0, -1), (0, 1)] {
                let (nx, nz) = (cx + dx, cz + dz);
                if nx < 0 || nz < 0 || nx >= w || nz >= d {
                    continue;
                }
                let ni = idx(nx, nz);
                if !visited[ni] && depth[ni] >= 1 {
                    visited[ni] = true;
                    stack.push(ni);
                }
            }
        }
        if max_depth >= MIN_CORE_DEPTH {
            components.push((max_depth, cells));
        }
    }
    components.sort_by(|a, b| b.0.cmp(&a.0)); // deepest basins first
    let mut used = 0usize;
    for (_md, cells) in &components {
        if used > 0 && used + cells.len() > cap {
            continue; // would blow the budget — skip (but always keep at least one)
        }
        for &c in cells {
            keep[c] = true;
        }
        used += cells.len();
    }

    // Pour the kept basins: pale sand bed, then water up to the spill surface.
    for z in 0..d {
        for x in 0..w {
            let i = idx(x, z);
            if !keep[i] {
                continue;
            }
            let g = ground[i];
            world.set(x, g, z, VoxelMaterial::Sand);
            for y in (g + 1)..=water[i] {
                world.set(x, y, z, VoxelMaterial::Lake);
            }
        }
    }
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

#[cfg(test)]
mod lake_check {
    use super::*;
    use ff_common::VoxelMaterial;
    #[test]
    fn lakes_are_generated() {
        let mut total_surface = 0usize;
        for region in [0u8, 4] {
            for seed in [42u32] {
                let world = generate_terrain(region, seed);
                let mut surf = 0usize;
                for z in 0..world.depth as i32 {
                    for x in 0..world.width as i32 {
                        let h = world.height_at(x, z);
                        if world.get(x, h, z) == VoxelMaterial::Lake { surf += 1; }
                    }
                }
                total_surface += surf;
                println!("region {region} seed {seed}: {surf} lake surface tiles");
            }
        }
        println!("TOTAL lake surface tiles across samples: {total_surface}");
        assert!(total_surface > 0, "no lakes generated in any sampled region/seed");
    }

    #[test]
    fn region_tables_align() {
        let span = COUNTRIES.last().unwrap();
        let total = (span.region_start + span.region_count) as usize;
        assert_eq!(REGIONS.len(), total, "REGIONS length must equal the country span");
        assert_eq!(COUNTRIES.len(), 80, "expected 80 countries");
        assert_eq!(REGIONS.len(), 80, "expected 80 regions (1 location each)");
        // No gaps/overlaps in the country index ranges.
        let mut next = 0u8;
        for c in COUNTRIES {
            assert_eq!(c.region_start, next, "gap/overlap before {}", c.name);
            next += c.region_count;
        }
        // High region indices must generate without panicking.
        for region in [40u8, 60, 79] {
            let w = generate_terrain(region, 7);
            assert!(w.data.iter().any(|&b| b != 0), "region {region} generated empty");
        }
    }
}
