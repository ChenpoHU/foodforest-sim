//! Interaction system: processes player actions (plant, harvest, dig, water, build).
//! Driven by player input (not the tick loop).

use crate::components::identity::{NetworkId, Owner};
use crate::components::physics::{Collider, Grounded};
use crate::components::plant::{FellingPhase, GrowthStage, Harvestable, Plant, TreeFelling};
use crate::components::player::PlayerSkills;
use crate::components::transform::{Position, Rotation, Velocity};
use crate::Resources;
use ff_common::{EntityId, GameMode, PlayerId, VoxelMaterial};
use ff_protocol::ActionKind;
use ff_voxel::VoxelWorld;
use glam::Vec3;

/// Result of processing a player action.
pub enum ActionResult {
    Success(String),
    Failure(String),
    SuccessWithDespawn(String, EntityId),
}

/// Process a single player action. Returns success/failure for the client.
pub fn process_action(
    world: &mut hecs::World,
    terrain: &mut VoxelWorld,
    resources: &Resources,
    player_entity: hecs::Entity,
    player_id: PlayerId,
    action: &ActionKind,
    next_entity_id: &mut u64,
) -> ActionResult {
    // Get player position for range checks
    let player_pos = match world.get::<&Position>(player_entity) {
        Ok(p) => p.0,
        Err(_) => return ActionResult::Failure("Player entity not found".into()),
    };

    match action {
        ActionKind::PlantSeed { species_id } => {
            // Validate species exists
            let Some(species) = resources.species_db.get_plant(*species_id) else {
                return ActionResult::Failure("Unknown plant species".into());
            };

            // Plant at player's feet position
            let plant_x = player_pos.x as i32;
            let plant_z = player_pos.z as i32;
            let plant_y = terrain.spawn_height(plant_x, plant_z);

            let id = *next_entity_id;
            *next_entity_id += 1;

            world.spawn((
                NetworkId(EntityId(id)),
                Owner(player_id),
                Position(Vec3::new(plant_x as f32, plant_y, plant_z as f32)),
                Rotation(0.0),
                Plant::new_seed(*species_id),
            ));

            ActionResult::Success(format!("Planted {} seed", species.name))
        }

        ActionKind::Harvest { entity_id } => {
            // Find the target entity and validate (two-pass to avoid borrow conflicts)
            let mut target_entity = None;
            for (entity, (net_id, pos, plant)) in
                world.query_mut::<(&NetworkId, &Position, &Plant)>()
            {
                if net_id.0 == *entity_id {
                    let dist = (pos.0 - player_pos).length();
                    if dist > 5.0 {
                        return ActionResult::Failure("Too far away".into());
                    }
                    if plant.growth_stage != GrowthStage::Fruiting {
                        return ActionResult::Failure("Not ready to harvest".into());
                    }
                    target_entity = Some(entity);
                    break;
                }
            }

            let mut found = None;
            if let Some(te) = target_entity {
                if let Ok(mut harvestable) = world.get::<&mut Harvestable>(te) {
                    let tick = resources.calendar.tick.0 as u32;
                    if tick - harvestable.last_harvest_tick < harvestable.cooldown_ticks {
                        return ActionResult::Failure("Harvest on cooldown".into());
                    }
                    harvestable.last_harvest_tick = tick;
                    found = Some((harvestable.yield_item_id, harvestable.yield_amount));
                }
            }

            match found {
                Some((_item_id, _amount)) => {
                    // TODO: add items to player inventory
                    ActionResult::Success("Harvested!".into())
                }
                None => ActionResult::Failure("Nothing to harvest".into()),
            }
        }

        ActionKind::Dig { position } => {
            let [x, y, z] = *position;
            let dist = Vec3::new(x as f32, y as f32, z as f32) - player_pos;
            if dist.length() > 5.0 {
                return ActionResult::Failure("Too far away".into());
            }

            // Replace with air (dig) — drops the soil voxel
            if terrain.is_solid(x, y, z) {
                terrain.set(x, y, z, VoxelMaterial::Air);
                ActionResult::Success("Dug block".into())
            } else {
                ActionResult::Failure("Nothing to dig".into())
            }
        }

        ActionKind::Water { position, radius } => {
            let [x, _y, z] = *position;
            let r = (*radius as i32).min(5);
            // Watering is handled by directly modifying soil moisture
            // (actual soil grid modification would go here)
            let _ = (x, z, r);
            ActionResult::Success("Watered area".into())
        }

        ActionKind::BuildSwale { position, .. } => {
            let [x, y, z] = *position;
            let dist = Vec3::new(x as f32, y as f32, z as f32) - player_pos;
            if dist.length() > 5.0 {
                return ActionResult::Failure("Too far away".into());
            }

            terrain.set(x, y, z, VoxelMaterial::Swale);
            ActionResult::Success("Built swale".into())
        }

        ActionKind::BuildHugelBed { position } => {
            let [x, y, z] = *position;
            let dist = Vec3::new(x as f32, y as f32, z as f32) - player_pos;
            if dist.length() > 5.0 {
                return ActionResult::Failure("Too far away".into());
            }
            terrain.set(x, y, z, VoxelMaterial::HugelBed);
            ActionResult::Success("Built hugel bed".into())
        }

        ActionKind::AddMulch { position } => {
            let [x, y, z] = *position;
            terrain.set(x, y, z, VoxelMaterial::Mulch);
            ActionResult::Success("Added mulch".into())
        }

        ActionKind::CutTree { entity_id } => {
            let mut target_entity = None;
            let mut tree_pos = Vec3::ZERO;
            let mut species_id = 0u16;

            for (entity, (net_id, pos, plant)) in
                world.query_mut::<(&NetworkId, &Position, &Plant)>()
            {
                if net_id.0 == *entity_id {
                    let dist = (pos.0 - player_pos).length();
                    if dist > 6.0 {
                        return ActionResult::Failure("Too far away".into());
                    }
                    if plant.growth_stage == GrowthStage::Dead {
                        return ActionResult::Failure("Tree is already dead".into());
                    }
                    if plant.growth_stage == GrowthStage::Seed
                        || plant.growth_stage == GrowthStage::Germinating
                    {
                        return ActionResult::Failure("Too small to cut, pull the sprout instead".into());
                    }
                    target_entity = Some(entity);
                    tree_pos = pos.0;
                    species_id = plant.species_id;
                    break;
                }
            }

            let Some(te) = target_entity else {
                return ActionResult::Failure("No tree found".into());
            };

            let species = resources.species_db.get_plant(species_id);
            let name = species.map(|s| s.name.as_str()).unwrap_or("tree");

            if resources.game_mode == GameMode::Peaceful {
                let _ = world.despawn(te);
                return ActionResult::SuccessWithDespawn(format!("Removed {}", name), *entity_id);
            }

            if world.get::<&TreeFelling>(te).is_ok() {
                return ActionResult::Failure("Already being cut".into());
            }

            let growth_ratio = if let Ok(plant) = world.get::<&Plant>(te) {
                (plant.growth_points / species.map(|s| s.maturity_threshold).unwrap_or(50000.0))
                    .min(1.0)
                    .max(0.1)
            } else {
                1.0
            };
            let (height, density) = match species {
                Some(s) => (
                    s.max_height_voxels as f32 * growth_ratio,
                    if s.id == 103 { 0.7 } else { 1.0 },
                ),
                None => (8.0, 1.0),
            };

            let dir_to_player = Vec3::new(
                player_pos.x - tree_pos.x,
                0.0,
                player_pos.z - tree_pos.z,
            );
            let len = dir_to_player.length().max(0.01);
            let fall_away = [-dir_to_player.x / len, -dir_to_player.z / len];

            let wind = resources.weather.wind_speed;
            let stability = if wind > 10.0 { 0.6 } else { 0.9 };
            let trunk = height * 0.08 + 0.3;
            let cut_time = trunk * density * 20.0;

            let felling = TreeFelling {
                phase: FellingPhase::Cutting,
                cutter_entity_id: player_entity.id() as u64,
                progress: 0.0,
                cut_threshold: cut_time,
                trunk_diameter: trunk,
                tree_height: height,
                wood_density: density,
                root_stability: stability,
                fall_direction: fall_away,
                hazard_radius: height * 1.2,
                ticks_in_phase: 0,
            };

            let _ = world.insert_one(te, felling);
            ActionResult::Success(format!("Cutting {} (height {:.0})...", name, height))
        }

        ActionKind::Inspect { entity_id } => {
            for (entity, (net_id, pos)) in
                world.query_mut::<(&NetworkId, &Position)>()
            {
                if net_id.0 != *entity_id { continue; }

                if let Ok(plant) = world.get::<&Plant>(entity) {
                    let name = resources.species_db.get_plant(plant.species_id)
                        .map(|s| s.name.as_str()).unwrap_or("Unknown");
                    let stage = match plant.growth_stage {
                        GrowthStage::Seed => "Seed",
                        GrowthStage::Germinating => "Germinating",
                        GrowthStage::Seedling => "Seedling",
                        GrowthStage::Juvenile => "Juvenile",
                        GrowthStage::Mature => "Mature",
                        GrowthStage::Fruiting => "Fruiting",
                        GrowthStage::Dormant => "Dormant",
                        GrowthStage::Dead => "Dead",
                    };
                    let species = resources.species_db.get_plant(plant.species_id);
                    let max_gp = species.map(|s| s.maturity_threshold).unwrap_or(1.0);
                    let growth_pct = ((plant.growth_points / max_gp) * 100.0).min(100.0);
                    return ActionResult::Success(format!(
                        "INSPECT|plant|{}|{}|{:.0}%|{:.0}%|{}",
                        name, stage, plant.health * 100.0, growth_pct, plant.cut_count
                    ));
                }

                if let Ok(animal) = world.get::<&crate::components::animal::Animal>(entity) {
                    let name = resources.species_db.get_animal(animal.species_id)
                        .map(|s| s.name.as_str()).unwrap_or("Unknown");
                    let behavior = match &animal.behavior {
                        crate::components::animal::AnimalBehavior::Idle => "Idle",
                        crate::components::animal::AnimalBehavior::Wandering => "Wandering",
                        crate::components::animal::AnimalBehavior::Foraging => "Foraging",
                        crate::components::animal::AnimalBehavior::Fleeing { .. } => "Fleeing",
                        crate::components::animal::AnimalBehavior::Following { .. } => "Following",
                        crate::components::animal::AnimalBehavior::Sleeping => "Sleeping",
                        crate::components::animal::AnimalBehavior::Scratching => "Scratching",
                        crate::components::animal::AnimalBehavior::Pollinating => "Pollinating",
                        _ => "Active",
                    };
                    return ActionResult::Success(format!(
                        "INSPECT|animal|{}|{}|hunger:{:.0}%|energy:{:.0}%",
                        name, behavior, animal.hunger * 100.0, animal.energy * 100.0
                    ));
                }

                if let Ok(player) = world.get::<&crate::components::player::Player>(entity) {
                    let player_name = world.get::<&crate::components::identity::Name>(entity)
                        .map(|n| n.0.clone()).unwrap_or_else(|_| "Unknown".into());
                    let stamina = world.get::<&crate::components::player::Stamina>(entity)
                        .map(|s| s.0).unwrap_or(0.0);
                    let hunger = world.get::<&crate::components::player::Hunger>(entity)
                        .map(|h| h.0).unwrap_or(0.0);
                    return ActionResult::Success(format!(
                        "INSPECT|player|{}|stamina:{:.0}%|hunger:{:.0}%",
                        player_name, stamina, hunger
                    ));
                }

                return ActionResult::Success("INSPECT|unknown|Entity".into());
            }
            ActionResult::Failure("Entity not found".into())
        }

        _ => ActionResult::Failure("Action not implemented yet".into()),
    }
}
