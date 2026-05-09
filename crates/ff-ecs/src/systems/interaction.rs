//! Interaction system: processes player actions (plant, harvest, dig, water, build).
//! Driven by player input (not the tick loop).

use crate::components::identity::{NetworkId, Owner};
use crate::components::physics::{Collider, Grounded};
use crate::components::plant::{GrowthStage, Harvestable, Plant};
use crate::components::transform::{Position, Rotation, Velocity};
use crate::Resources;
use ff_common::{EntityId, PlayerId, VoxelMaterial};
use ff_protocol::ActionKind;
use ff_voxel::VoxelWorld;
use glam::Vec3;

/// Result of processing a player action.
pub enum ActionResult {
    Success(String),
    Failure(String),
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
            let plant_y = terrain.spawn_height(plant_x, plant_z) as f32;

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

        _ => ActionResult::Failure("Action not implemented yet".into()),
    }
}
