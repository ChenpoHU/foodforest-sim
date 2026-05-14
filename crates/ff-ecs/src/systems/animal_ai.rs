//! Animal AI system.
//!
//! In `GameMode::Survival` (the highest difficulty), animals are driven by
//! a custom Q-learning brain (see `resources::animal_brain`). They perceive
//! the player, food plants, and herd-mates, accumulate reward signals from
//! the environment, and update a per-species Q-table every decision tick.
//!
//! In `Peaceful` and `Realistic`, the brain is bypassed and a lightweight
//! scripted behavior runs — this keeps the lower difficulties cheap and
//! predictable.
//!
//! Runs every 5 ticks (250 ms).

use crate::components::animal::{Animal, AnimalBehavior, Domesticated};
use crate::components::animal_brain::AnimalMemory;
use crate::components::plant::{GrowthStage, Plant};
use crate::components::player::Player;
use crate::components::soil::SoilGrid;
use crate::components::transform::{Position, Velocity};
use crate::resources::animal_brain::{
    direction_bucket, energy_bucket, hunger_bucket, MoveAction, State,
};
use crate::Resources;
use ff_common::GameMode;
use ff_voxel::VoxelWorld;
use glam::Vec3;

const PERCEPTION_RANGE: f32 = 15.0;
const FOOD_EAT_RANGE: f32 = 2.0;

pub fn run(
    world: &mut hecs::World,
    terrain: &VoxelWorld,
    soil_grid: &mut SoilGrid,
    resources: &mut Resources,
) {
    let tick = resources.calendar.tick.0;
    let use_brain = resources.game_mode == GameMode::Survival;

    // Ensure every animal has an AnimalMemory component before the main pass.
    // (Newly-spawned animals won't have one yet.) Collect first, then insert —
    // we can't insert during a query borrow.
    let animal_entities: Vec<hecs::Entity> = world
        .query_mut::<&Animal>()
        .into_iter()
        .map(|(entity, _)| entity)
        .collect();
    for entity in &animal_entities {
        if world.get::<&AnimalMemory>(*entity).is_err() {
            let _ = world.insert_one(*entity, AnimalMemory::new());
        }
    }

    if use_brain {
        run_with_brain(world, terrain, soil_grid, resources, tick);
    } else {
        run_scripted(world, terrain, soil_grid, resources, tick);
    }
}

// --------------------------------------------------------------------------
// Q-learning driven AI (Survival mode only)
// --------------------------------------------------------------------------

fn run_with_brain(
    world: &mut hecs::World,
    terrain: &VoxelWorld,
    soil_grid: &mut SoilGrid,
    resources: &mut Resources,
    tick: u64,
) {
    // Phase 1: snapshot perceivable positions. Each query_mut releases its
    // borrow when consumed, so they can run sequentially.
    let player_positions: Vec<Vec3> = world
        .query_mut::<(&Player, &Position)>()
        .into_iter()
        .map(|(_, (_, p))| p.0)
        .collect();

    let food_plants: Vec<(u16, Vec3)> = world
        .query_mut::<(&Plant, &Position)>()
        .into_iter()
        .filter(|(_, (plant, _))| plant.growth_stage == GrowthStage::Fruiting)
        .map(|(_, (plant, p))| (plant.species_id, p.0))
        .collect();

    let animal_positions: Vec<(u16, Vec3)> = world
        .query_mut::<(&Animal, &Position)>()
        .into_iter()
        .map(|(_, (a, p))| (a.species_id, p.0))
        .collect();

    // Split the &mut Resources into disjoint field borrows so we can read
    // species_db while mutating species_brains in the same iteration.
    let Resources {
        species_db,
        species_brains,
        ..
    } = resources;

    let mut soil_effects: Vec<(usize, usize)> = Vec::new();

    for (_entity, (animal, pos, vel, domesticated, memory)) in world.query_mut::<(
        &mut Animal,
        &mut Position,
        &mut Velocity,
        Option<&Domesticated>,
        &mut AnimalMemory,
    )>() {
        // Drift baseline drives + decay short-lived emotion.
        animal.hunger = (animal.hunger + 0.001).min(1.0);
        animal.energy = (animal.energy - 0.0005).max(0.0);
        memory.fear = (memory.fear - 0.01).max(0.0);

        let species = species_db.get_animal(animal.species_id);
        let speed = species.map(|s| s.speed).unwrap_or(2.0);
        let diet: Vec<u16> = species.map(|s| s.diet.clone()).unwrap_or_default();
        let is_wild = domesticated.is_none();

        // Fear amplifies threat perception range.
        let threat_range = PERCEPTION_RANGE * (1.0 + memory.fear);

        // Wild animals (and any frightened domestic ones) treat players as threats.
        let threat_dir = if is_wild || memory.fear > 0.5 {
            nearest_direction(pos.0, &player_positions, threat_range)
        } else {
            0
        };
        let food_dir = nearest_food_direction(pos.0, &food_plants, &diet, PERCEPTION_RANGE);
        let herd_dir =
            nearest_herd_direction(pos.0, animal.species_id, &animal_positions, PERCEPTION_RANGE);

        let current_state = State::encode(
            hunger_bucket(animal.hunger),
            energy_bucket(animal.energy),
            threat_dir,
            food_dir,
            herd_dir,
        );

        // Compute reward for the transition `prev -> current`. Combine:
        //  (a) shaped intrinsic terms from the new state, and
        //  (b) any out-of-band rewards accumulated since last decision
        //      (e.g. fear from a nearby hunt, food eaten last tick).
        let intrinsic_reward = shaped_reward(
            animal.hunger,
            animal.energy,
            threat_dir,
            food_dir,
            herd_dir,
            domesticated,
            pos.0,
            memory.fear,
        );
        let reward = intrinsic_reward + memory.reward;

        // Q-learning step.
        let brain = species_brains.get_or_create(animal.species_id);
        if memory.initialized {
            brain.update(
                State(memory.prev_state),
                MoveAction(memory.prev_action),
                reward,
                current_state,
            );
        }

        // Select next action. Use a deterministic per-entity RNG so the
        // simulation stays reproducible across replays.
        let rand01 = deterministic_random(tick, pos.0, animal.species_id);
        let action = brain.select_action(current_state, rand01);

        // Persist trajectory state for next tick.
        memory.prev_state = current_state.0;
        memory.prev_action = action.0;
        memory.reward = 0.0;
        memory.initialized = true;
        memory.lifetime_decisions = memory.lifetime_decisions.saturating_add(1);

        // Translate the discrete action into world effects.
        execute_action(
            action,
            speed,
            animal,
            pos,
            vel,
            domesticated,
            &food_plants,
            &diet,
            threat_dir,
            food_dir,
            memory,
            soil_grid,
            &mut soil_effects,
            tick,
        );

        // Y-axis: glue feet to ground (animals are not in the physics solver).
        let ground_y = terrain.spawn_height(pos.0.x as i32, pos.0.z as i32);
        pos.0.y = ground_y;
    }

    for (sx, sz) in soil_effects {
        let soil = soil_grid.surface_mut(sx, sz);
        soil.compaction = (soil.compaction - 0.02).max(0.0);
        soil.organic_matter = (soil.organic_matter + 0.005).min(1.0);
    }
}

#[allow(clippy::too_many_arguments)]
fn execute_action(
    action: MoveAction,
    speed: f32,
    animal: &mut Animal,
    pos: &Position,
    vel: &mut Velocity,
    domesticated: Option<&Domesticated>,
    food_plants: &[(u16, Vec3)],
    diet: &[u16],
    threat_dir: u8,
    food_dir: u8,
    memory: &mut AnimalMemory,
    soil_grid: &SoilGrid,
    soil_effects: &mut Vec<(usize, usize)>,
    tick: u64,
) {
    // Hard override: collapse when exhausted.
    if animal.energy < 0.1 {
        vel.0 = Vec3::ZERO;
        animal.behavior = AnimalBehavior::Sleeping;
        animal.energy = (animal.energy + 0.01).min(1.0);
        memory.reward += 0.3;
        return;
    }

    // If sitting on food and hungry, eat instead of moving.
    if animal.hunger > 0.4 {
        let near_food = food_plants.iter().any(|(sid, fp)| {
            diet.contains(sid) && hxz_distance(*fp, pos.0) < FOOD_EAT_RANGE
        });
        if near_food {
            vel.0 = Vec3::ZERO;
            animal.behavior = AnimalBehavior::Foraging;
            animal.hunger = (animal.hunger - 0.02).max(0.0);
            memory.reward += 1.0;
            return;
        }
    }

    // Chickens scratch the soil periodically when standing still.
    if action.is_stay() && animal.species_id == 10 && tick % 40 == 0 {
        vel.0 = Vec3::ZERO;
        animal.behavior = AnimalBehavior::Scratching;
        let sx = (pos.0.x as usize).min(soil_grid.width.saturating_sub(1));
        let sz = (pos.0.z as usize).min(soil_grid.depth.saturating_sub(1));
        soil_effects.push((sx, sz));
        memory.reward += 0.1;
        return;
    }

    let (vx, vz) = action.to_velocity(speed);
    vel.0.x = vx;
    vel.0.z = vz;

    // Domesticated animals get a soft pull back toward their pen if they
    // wander too far. This is a guard rail on top of learning, not a substitute.
    if let Some(pen) = domesticated {
        let to_center = pen.pen_center - pos.0;
        let dist = to_center.length();
        if dist > pen.pen_radius * 1.5 {
            vel.0.x = to_center.x.signum() * speed;
            vel.0.z = to_center.z.signum() * speed;
        } else if dist > pen.pen_radius {
            vel.0.x = vel.0.x * 0.5 + to_center.x.signum() * speed * 0.5;
            vel.0.z = vel.0.z * 0.5 + to_center.z.signum() * speed * 0.5;
        }
    }

    animal.behavior = infer_behavior(action, threat_dir, food_dir, animal);
}

fn infer_behavior(
    action: MoveAction,
    threat_dir: u8,
    food_dir: u8,
    animal: &Animal,
) -> AnimalBehavior {
    if action.is_stay() {
        if animal.energy < 0.3 {
            AnimalBehavior::Sleeping
        } else {
            AnimalBehavior::Idle
        }
    } else if threat_dir != 0 {
        AnimalBehavior::Fleeing {
            from_x: 0.0,
            from_z: 0.0,
        }
    } else if food_dir != 0 && animal.hunger > 0.3 {
        AnimalBehavior::Foraging
    } else {
        AnimalBehavior::Wandering
    }
}

/// Reward shaping. Drives learning toward survival behaviors without
/// hard-coding them: positive for being well-fed, rested, near herd,
/// and inside the pen; negative for proximity to threats.
#[allow(clippy::too_many_arguments)]
fn shaped_reward(
    hunger: f32,
    energy: f32,
    threat_dir: u8,
    food_dir: u8,
    herd_dir: u8,
    domesticated: Option<&Domesticated>,
    pos: Vec3,
    fear: f32,
) -> f32 {
    let mut r = 0.0;

    if hunger < 0.3 {
        r += 0.1;
    }
    if hunger > 0.7 {
        r -= 0.2;
    }
    if energy > 0.7 {
        r += 0.1;
    }
    if energy < 0.2 {
        r -= 0.3;
    }

    if threat_dir != 0 {
        r -= 0.8 + fear * 0.5;
    }
    if food_dir != 0 && hunger > 0.3 {
        r += 0.2;
    }
    if herd_dir != 0 {
        r += 0.15;
    }

    if let Some(pen) = domesticated {
        let dist = (pen.pen_center - pos).length();
        if dist > pen.pen_radius {
            r -= 0.5;
        } else {
            r += 0.1;
        }
    }

    r
}

// --------------------------------------------------------------------------
// Perception helpers
// --------------------------------------------------------------------------

fn hxz_distance(a: Vec3, b: Vec3) -> f32 {
    let dx = a.x - b.x;
    let dz = a.z - b.z;
    (dx * dx + dz * dz).sqrt()
}

fn nearest_direction(origin: Vec3, positions: &[Vec3], range: f32) -> u8 {
    let mut best_sq = range * range;
    let mut best = (0.0, 0.0);
    for &p in positions {
        let dx = p.x - origin.x;
        let dz = p.z - origin.z;
        let d2 = dx * dx + dz * dz;
        if d2 < best_sq && d2 > 0.0001 {
            best_sq = d2;
            best = (dx, dz);
        }
    }
    if best_sq >= range * range {
        0
    } else {
        direction_bucket(best.0, best.1)
    }
}

fn nearest_food_direction(
    origin: Vec3,
    food_plants: &[(u16, Vec3)],
    diet: &[u16],
    range: f32,
) -> u8 {
    let mut best_sq = range * range;
    let mut best = (0.0, 0.0);
    for &(sid, p) in food_plants {
        if !diet.contains(&sid) {
            continue;
        }
        let dx = p.x - origin.x;
        let dz = p.z - origin.z;
        let d2 = dx * dx + dz * dz;
        if d2 < best_sq && d2 > 0.0001 {
            best_sq = d2;
            best = (dx, dz);
        }
    }
    if best_sq >= range * range {
        0
    } else {
        direction_bucket(best.0, best.1)
    }
}

fn nearest_herd_direction(
    origin: Vec3,
    own_species: u16,
    animals: &[(u16, Vec3)],
    range: f32,
) -> u8 {
    let mut best_sq = range * range;
    let mut best = (0.0, 0.0);
    for &(sid, p) in animals {
        if sid != own_species {
            continue;
        }
        let dx = p.x - origin.x;
        let dz = p.z - origin.z;
        let d2 = dx * dx + dz * dz;
        // Filter out the animal itself (distance ~0).
        if d2 < best_sq && d2 > 1.0 {
            best_sq = d2;
            best = (dx, dz);
        }
    }
    if best_sq >= range * range {
        0
    } else {
        direction_bucket(best.0, best.1)
    }
}

/// Deterministic uniform [0, 1) RNG keyed by tick + position + species.
/// Same inputs always yield the same value, so replays remain reproducible.
fn deterministic_random(tick: u64, pos: Vec3, species_id: u16) -> f32 {
    let mut x = tick
        .wrapping_mul(6364136223846793005)
        .wrapping_add(pos.x.to_bits() as u64);
    x = x
        .wrapping_mul(2862933555777941757)
        .wrapping_add(pos.z.to_bits() as u64);
    x = x
        .wrapping_mul(3037000493)
        .wrapping_add(species_id as u64);
    let bits = ((x >> 33) ^ x) as u32;
    (bits as f32) / (u32::MAX as f32 + 1.0)
}

// --------------------------------------------------------------------------
// Scripted fallback (Peaceful / Realistic)
// --------------------------------------------------------------------------

fn run_scripted(
    world: &mut hecs::World,
    terrain: &VoxelWorld,
    soil_grid: &mut SoilGrid,
    resources: &Resources,
    tick: u64,
) {
    let mut soil_effects: Vec<(usize, usize)> = Vec::new();

    for (_entity, (animal, pos, vel, domesticated)) in world
        .query_mut::<(&mut Animal, &mut Position, &mut Velocity, Option<&Domesticated>)>()
    {
        animal.hunger = (animal.hunger + 0.001).min(1.0);
        animal.energy = (animal.energy - 0.0005).max(0.0);

        let mut best = AnimalBehavior::Idle;
        let mut best_score: f32 = 0.0;
        if 0.5 > best_score {
            best_score = 0.5;
            best = AnimalBehavior::Wandering;
        }
        let forage = animal.hunger * 2.0;
        if forage > best_score {
            best_score = forage;
            best = AnimalBehavior::Foraging;
        }
        let sleep = (1.0 - animal.energy) * 2.0;
        if sleep > best_score {
            best_score = sleep;
            best = AnimalBehavior::Sleeping;
        }
        if animal.species_id == 10 && (matches!(animal.behavior, AnimalBehavior::Scratching) || tick % 40 == 0)
            && 1.5 > best_score
        {
            best = AnimalBehavior::Scratching;
        }
        animal.behavior = best;

        match animal.behavior {
            AnimalBehavior::Wandering => {
                let hash = tick.wrapping_mul(pos.0.x as u64 + 1);
                let angle = (hash % 628) as f32 / 100.0;
                let speed = 1.5;
                vel.0.x = angle.cos() * speed;
                vel.0.z = angle.sin() * speed;
                if let Some(pen) = domesticated {
                    let to_center = pen.pen_center - pos.0;
                    if to_center.length() > pen.pen_radius {
                        vel.0.x = to_center.x.signum() * speed;
                        vel.0.z = to_center.z.signum() * speed;
                    }
                }
            }
            AnimalBehavior::Foraging => {
                let speed = 2.0;
                let hash = tick.wrapping_mul(17) + pos.0.z as u64;
                let angle = (hash % 628) as f32 / 100.0;
                vel.0.x = angle.cos() * speed;
                vel.0.z = angle.sin() * speed;
                animal.hunger = (animal.hunger - 0.01).max(0.0);
            }
            AnimalBehavior::Sleeping => {
                vel.0 = Vec3::ZERO;
                animal.energy = (animal.energy + 0.01).min(1.0);
            }
            AnimalBehavior::Scratching => {
                vel.0 = Vec3::ZERO;
                let sx = (pos.0.x as usize).min(soil_grid.width.saturating_sub(1));
                let sz = (pos.0.z as usize).min(soil_grid.depth.saturating_sub(1));
                soil_effects.push((sx, sz));
            }
            AnimalBehavior::Fleeing { from_x, from_z } => {
                let flee = Vec3::new(pos.0.x - from_x, 0.0, pos.0.z - from_z).normalize_or_zero();
                vel.0 = flee * 4.0;
            }
            _ => {
                vel.0 = Vec3::ZERO;
            }
        }

        let ground_y = terrain.spawn_height(pos.0.x as i32, pos.0.z as i32);
        pos.0.y = ground_y;
    }

    for (sx, sz) in soil_effects {
        let soil = soil_grid.surface_mut(sx, sz);
        soil.compaction = (soil.compaction - 0.02).max(0.0);
        soil.organic_matter = (soil.organic_matter + 0.005).min(1.0);
    }

    let _ = resources; // currently unused in scripted mode (kept for parity)
}
