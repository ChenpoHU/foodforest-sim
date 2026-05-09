//! ECS systems — each is a function called in deterministic order by the tick loop.

pub mod animal_ai;
pub mod interaction;
pub mod npc_ai;
pub mod physics;
pub mod plant_growth;
pub mod soil;
pub mod tree_felling;
pub mod water;

use crate::components::soil::SoilGrid;
use crate::Resources;
use ff_voxel::VoxelWorld;

/// Run all simulation systems for one tick.
///
/// Called by the server at TICK_RATE (20 Hz). Systems run in this exact order:
/// 1. Physics (gravity, collision)
/// 2. Plant growth (every tick)
/// 3. Soil dynamics (every 20 ticks = 1 sec)
/// 4. Water cycle (every 20 ticks = 1 sec)
/// 5. Animal AI (every 5 ticks = 250ms)
/// 6. NPC AI (every 10 ticks = 500ms)
///
/// Interaction system is driven by player input, not the tick loop.
pub fn run_tick(
    world: &mut hecs::World,
    resources: &mut Resources,
    soil_grid: &mut SoilGrid,
    terrain: &VoxelWorld,
) -> Vec<tree_felling::FellMessage> {
    let tick = resources.calendar.tick.0;
    let dt = ff_common::TICK_DT;

    // Update calendar; regenerate weather on day change
    let day_changed = resources.calendar.advance();
    if day_changed {
        let rand_val = simple_rand(tick);
        resources.weather =
            crate::resources::Weather::generate_daily(&resources.calendar, rand_val);
    }
    resources.weather.update_sunlight(&resources.calendar);

    // 1. Physics — every tick
    physics::run(world, terrain, dt);

    // 2. Plant growth — every tick
    plant_growth::run(world, resources, soil_grid);

    let mut fell_messages = Vec::new();
    if tick % 2 == 0 {
        fell_messages = tree_felling::run(world, resources);
    }

    // 3. Soil dynamics — every 20 ticks (1 second)
    if tick % 20 == 0 {
        soil::run(soil_grid, resources);
    }

    // 4. Water cycle — every 20 ticks
    if tick % 20 == 0 {
        water::run(soil_grid, terrain, resources);
    }

    // 5. Animal AI — every 5 ticks (250ms)
    if tick % 5 == 0 {
        animal_ai::run(world, terrain, soil_grid, resources);
    }

    // 6. NPC AI — every 10 ticks (500ms)
    if tick % 10 == 0 {
        npc_ai::run(world, terrain, resources);
    }

    fell_messages
}

/// Simple deterministic pseudo-random for weather generation.
/// Not cryptographic — just needs to be consistent for a given tick.
fn simple_rand(seed: u64) -> f32 {
    let x = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
    let bits = ((x >> 33) ^ x) as u32;
    (bits as f32) / (u32::MAX as f32)
}
