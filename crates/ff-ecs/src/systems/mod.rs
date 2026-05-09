//! ECS systems — each is a function called in deterministic order by the tick loop.

pub mod animal_ai;
pub mod interaction;
pub mod npc_ai;
pub mod physics;
pub mod plant_growth;
pub mod soil;
pub mod tree_felling;
pub mod water;
pub mod wildfire;

use crate::components::soil::SoilGrid;
use crate::Resources;
use ff_common::GameMode;
use ff_voxel::VoxelWorld;

pub struct TickResult {
    pub messages: Vec<tree_felling::FellMessage>,
    pub despawned: Vec<ff_common::EntityId>,
}

/// Run all simulation systems for one tick.
pub fn run_tick(
    world: &mut hecs::World,
    resources: &mut Resources,
    soil_grid: &mut SoilGrid,
    terrain: &VoxelWorld,
) -> TickResult {
    let tick = resources.calendar.tick.0;
    let dt = ff_common::TICK_DT;

    let day_changed = resources.calendar.advance();
    if day_changed {
        let rand_val = simple_rand(tick);
        resources.weather =
            crate::resources::Weather::generate_daily(&resources.calendar, rand_val);
    }
    resources.weather.update_sunlight(&resources.calendar);

    physics::run(world, terrain, dt);

    plant_growth::run(world, resources, soil_grid);

    let mut fell_messages = Vec::new();
    let mut despawned = Vec::new();

    if resources.game_mode != GameMode::Peaceful && tick % 2 == 0 {
        fell_messages = tree_felling::run(world, resources);
    }

    if resources.game_mode == GameMode::Hardcore {
        let fire_result = wildfire::run(world, resources);
        fell_messages.extend(fire_result.messages);
        despawned.extend(fire_result.despawned);
    }

    if tick % 20 == 0 {
        soil::run(soil_grid, resources);
    }

    if tick % 20 == 0 {
        water::run(soil_grid, terrain, resources);
    }

    if tick % 5 == 0 {
        animal_ai::run(world, terrain, soil_grid, resources);
    }

    if tick % 10 == 0 {
        npc_ai::run(world, terrain, resources);
    }

    TickResult { messages: fell_messages, despawned }
}

/// Simple deterministic pseudo-random for weather generation.
/// Not cryptographic — just needs to be consistent for a given tick.
fn simple_rand(seed: u64) -> f32 {
    let x = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
    let bits = ((x >> 33) ^ x) as u32;
    (bits as f32) / (u32::MAX as f32)
}
