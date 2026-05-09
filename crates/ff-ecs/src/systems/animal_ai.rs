//! Animal AI system: utility-based behavior selection.
//! Runs every 5 ticks (250ms).

use crate::components::animal::{Animal, AnimalBehavior, Domesticated};
use crate::components::soil::SoilGrid;
use crate::components::transform::{Position, Velocity};
use crate::Resources;
use ff_voxel::VoxelWorld;
use glam::Vec3;

pub fn run(
    world: &mut hecs::World,
    terrain: &VoxelWorld,
    soil_grid: &mut SoilGrid,
    resources: &Resources,
) {
    let tick = resources.calendar.tick.0;

    // Collect position updates to apply (avoid borrow issues)
    let mut soil_effects: Vec<(usize, usize)> = Vec::new();

    for (_entity, (animal, pos, vel, domesticated)) in world
        .query_mut::<(&mut Animal, &mut Position, &mut Velocity, Option<&Domesticated>)>()
    {
        // Update hunger/energy
        animal.hunger = (animal.hunger + 0.001).min(1.0);
        animal.energy = (animal.energy - 0.0005).max(0.0);

        // Utility scoring
        let mut best_behavior = AnimalBehavior::Idle;
        let mut best_score: f32 = 0.0;

        // Wandering (default)
        let wander_score = 0.5;
        if wander_score > best_score {
            best_score = wander_score;
            best_behavior = AnimalBehavior::Wandering;
        }

        // Foraging (when hungry)
        let forage_score = animal.hunger * 2.0;
        if forage_score > best_score {
            best_score = forage_score;
            best_behavior = AnimalBehavior::Foraging;
        }

        // Sleeping (when tired)
        let sleep_score = (1.0 - animal.energy) * 2.0;
        if sleep_score > best_score {
            best_score = sleep_score;
            best_behavior = AnimalBehavior::Sleeping;
        }

        // Scratching (chickens — periodic soil work)
        if matches!(animal.behavior, AnimalBehavior::Scratching) || tick % 40 == 0 {
            // Check species — only chickens scratch (species_id = 10)
            if animal.species_id == 10 {
                let scratch_score = 1.5;
                if scratch_score > best_score {
                    best_score = scratch_score;
                    best_behavior = AnimalBehavior::Scratching;
                }
            }
        }

        let _ = best_score; // suppress warning
        animal.behavior = best_behavior;

        // Execute behavior
        match animal.behavior {
            AnimalBehavior::Wandering => {
                // Simple random walk (deterministic from tick + position)
                let hash = tick.wrapping_mul(pos.0.x as u64 as u64 + 1);
                let angle = (hash % 628) as f32 / 100.0; // 0..2*PI
                let speed = 1.5;
                vel.0.x = angle.cos() * speed;
                vel.0.z = angle.sin() * speed;

                // Domesticated: stay near pen
                if let Some(pen) = domesticated {
                    let to_center = pen.pen_center - pos.0;
                    let dist = to_center.length();
                    if dist > pen.pen_radius {
                        vel.0.x = to_center.x.signum() * speed;
                        vel.0.z = to_center.z.signum() * speed;
                    }
                }
            }
            AnimalBehavior::Foraging => {
                // Move toward nearest food (simplified: random direction)
                let speed = 2.0;
                let hash = tick.wrapping_mul(17) + pos.0.z as u64;
                let angle = (hash % 628) as f32 / 100.0;
                vel.0.x = angle.cos() * speed;
                vel.0.z = angle.sin() * speed;

                // Eating reduces hunger
                animal.hunger = (animal.hunger - 0.01).max(0.0);
            }
            AnimalBehavior::Sleeping => {
                vel.0 = Vec3::ZERO;
                animal.energy = (animal.energy + 0.01).min(1.0);
            }
            AnimalBehavior::Scratching => {
                vel.0 = Vec3::ZERO;
                // Modify soil: reduce compaction, add organic matter
                let sx = (pos.0.x as usize).min(soil_grid.width.saturating_sub(1));
                let sz = (pos.0.z as usize).min(soil_grid.depth.saturating_sub(1));
                soil_effects.push((sx, sz));
            }
            AnimalBehavior::Fleeing { from_x, from_z } => {
                let flee_dir = Vec3::new(pos.0.x - from_x, 0.0, pos.0.z - from_z)
                    .normalize_or_zero();
                vel.0 = flee_dir * 4.0;
            }
            _ => {
                vel.0 = Vec3::ZERO;
            }
        }

        // Keep Y on ground
        let ground_y = terrain.spawn_height(pos.0.x as i32, pos.0.z as i32) as f32;
        pos.0.y = ground_y;
    }

    // Apply soil effects from scratching chickens
    for (sx, sz) in soil_effects {
        let soil = soil_grid.surface_mut(sx, sz);
        soil.compaction = (soil.compaction - 0.02).max(0.0);
        soil.organic_matter = (soil.organic_matter + 0.005).min(1.0);
    }
}
