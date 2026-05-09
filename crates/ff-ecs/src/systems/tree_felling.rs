use crate::components::animal::Animal;
use crate::components::plant::{FellingPhase, GrowthStage, Plant, TreeFelling};
use crate::components::player::{Dead, DeathCause, PlayerSkills};
use crate::components::transform::{Position, Velocity};
use crate::Resources;
use tracing::info;

pub struct FellMessage {
    pub text: String,
    pub is_death: bool,
}

pub fn run(world: &mut hecs::World, resources: &Resources) -> Vec<FellMessage> {
    let tick = resources.calendar.tick.0;
    let wind_speed = resources.weather.wind_speed;
    let rainfall = resources.weather.rainfall;

    let mut fell_events: Vec<FellEvent> = Vec::new();
    let mut mark_dead: Vec<hecs::Entity> = Vec::new();
    let mut messages: Vec<FellMessage> = Vec::new();

    for (tree_entity, (felling, pos, plant)) in
        world.query_mut::<(&mut TreeFelling, &Position, &Plant)>()
    {
        felling.ticks_in_phase += 1;

        match felling.phase {
            FellingPhase::Cutting => {
                let cut_speed = 1.0 / (felling.wood_density * felling.trunk_diameter);
                felling.progress += cut_speed;

                let wind_instability = (wind_speed / 20.0).min(1.0) * 0.3;
                let wet_instability = if rainfall > 0.3 { 0.2 } else { 0.0 };
                let stability_loss = wind_instability + wet_instability;
                felling.root_stability = (felling.root_stability - stability_loss * 0.01).max(0.0);

                let threshold = felling.cut_threshold * felling.root_stability.max(0.3);
                if felling.progress >= threshold {
                    felling.phase = FellingPhase::Falling;
                    felling.ticks_in_phase = 0;

                    let wind_deflection = wind_speed * 0.05;
                    let rand_val = simple_rand(tick ^ (tree_entity.id() as u64));
                    let wind_angle = (rand_val - 0.5) * wind_deflection;
                    felling.fall_direction[0] += wind_angle;

                    let len = (felling.fall_direction[0].powi(2)
                        + felling.fall_direction[1].powi(2))
                    .sqrt()
                    .max(0.01);
                    felling.fall_direction[0] /= len;
                    felling.fall_direction[1] /= len;
                    felling.hazard_radius = felling.tree_height * 1.2;

                    messages.push(FellMessage {
                        text: format!(
                            "Tree falling! species={} height={:.0}",
                            plant.species_id, felling.tree_height
                        ),
                        is_death: false,
                    });
                }
            }

            FellingPhase::Falling => {
                let fall_ticks = (felling.tree_height * 2.0) as u32;
                if felling.ticks_in_phase >= fall_ticks {
                    felling.phase = FellingPhase::Collapsed;
                    felling.ticks_in_phase = 0;

                    fell_events.push(FellEvent {
                        tree_entity,
                        tree_pos: pos.0,
                        fall_dir: felling.fall_direction,
                        hazard_radius: felling.hazard_radius,
                        tree_height: felling.tree_height,
                        cutter_id: felling.cutter_entity_id,
                        species_id: plant.species_id,
                        tick,
                    });

                    mark_dead.push(tree_entity);
                }
            }

            FellingPhase::Collapsed => {}
        }
    }

    for event in &fell_events {
        let mut impact_msgs = resolve_impact(world, event, wind_speed, rainfall);
        messages.append(&mut impact_msgs);
    }

    for entity in mark_dead {
        if let Ok(mut plant) = world.get::<&mut Plant>(entity) {
            plant.growth_stage = GrowthStage::Dead;
        }
    }

    messages
}

struct FellEvent {
    tree_entity: hecs::Entity,
    tree_pos: glam::Vec3,
    fall_dir: [f32; 2],
    hazard_radius: f32,
    tree_height: f32,
    cutter_id: u64,
    species_id: u16,
    tick: u64,
}

fn in_fall_zone(
    entity_pos: &glam::Vec3,
    tree_pos: &glam::Vec3,
    fall_dir: &[f32; 2],
    tree_height: f32,
    canopy_width: f32,
) -> (bool, f32) {
    let fall_vec = glam::Vec2::new(fall_dir[0], fall_dir[1]);
    let to_entity = glam::Vec2::new(entity_pos.x - tree_pos.x, entity_pos.z - tree_pos.z);
    let proj = to_entity.dot(fall_vec);
    if proj < -1.0 || proj > tree_height + 1.0 {
        return (false, 0.0);
    }
    let closest = glam::Vec2::new(
        tree_pos.x + fall_vec.x * proj.max(0.0).min(tree_height),
        tree_pos.z + fall_vec.y * proj.max(0.0).min(tree_height),
    );
    let perp_dist = glam::Vec2::new(entity_pos.x - closest.x, entity_pos.z - closest.y).length();
    if perp_dist > canopy_width + 1.0 {
        return (false, 0.0);
    }
    let danger = (1.0 - perp_dist / (canopy_width + 1.0)).max(0.0);
    (true, danger)
}

fn resolve_impact(
    world: &mut hecs::World,
    event: &FellEvent,
    wind_speed: f32,
    rainfall: f32,
) -> Vec<FellMessage> {
    let canopy_width = event.hazard_radius * 0.3;
    let mut kill_players: Vec<hecs::Entity> = Vec::new();
    let mut kill_animals: Vec<hecs::Entity> = Vec::new();
    let mut kill_plants: Vec<hecs::Entity> = Vec::new();
    let mut messages: Vec<FellMessage> = Vec::new();

    for (entity, (pos, skills)) in world.query_mut::<(&Position, &PlayerSkills)>() {
        let (hit, base_danger) = in_fall_zone(
            &pos.0, &event.tree_pos, &event.fall_dir,
            event.tree_height, canopy_width,
        );
        if !hit { continue; }

        let visibility_penalty = if rainfall > 0.5 { 0.2 } else { 0.0 };
        let wind_randomness = (wind_speed / 30.0).min(0.3);
        let rand_val = simple_rand(event.tick ^ (entity.id() as u64));
        let escape_roll = skills.agility + skills.logging * 0.3
            - visibility_penalty - wind_randomness + rand_val * 0.3;
        let final_danger = base_danger * (1.0 - escape_roll.clamp(0.0, 0.9));

        if final_danger > 0.5 {
            kill_players.push(entity);
        } else {
            messages.push(FellMessage {
                text: format!("Close call! danger={:.0}%", final_danger * 100.0),
                is_death: false,
            });
        }
    }

    for (entity, (pos, _animal)) in world.query_mut::<(&Position, &Animal)>() {
        let (hit, danger) = in_fall_zone(
            &pos.0, &event.tree_pos, &event.fall_dir,
            event.tree_height, canopy_width,
        );
        if !hit { continue; }
        let rand_val = simple_rand(event.tick ^ (entity.id() as u64));
        let escape = rand_val * 0.6;
        let final_danger = danger * (1.0 - escape);
        if final_danger > 0.3 {
            kill_animals.push(entity);
        }
    }

    for (entity, (pos, plant)) in world.query_mut::<(&Position, &Plant)>() {
        if entity == event.tree_entity { continue; }
        if plant.growth_stage == GrowthStage::Dead { continue; }
        let (hit, danger) = in_fall_zone(
            &pos.0, &event.tree_pos, &event.fall_dir,
            event.tree_height, canopy_width,
        );
        if hit && danger > 0.4 {
            kill_plants.push(entity);
        }
    }

    for entity in &kill_players {
        info!("Player crushed by falling tree");
        let _ = world.insert_one(*entity, Dead {
            death_tick: event.tick,
            cause: DeathCause::CrushedByTree,
        });
        if let Ok(mut vel) = world.get::<&mut Velocity>(*entity) {
            vel.0 = glam::Vec3::ZERO;
        }
        messages.push(FellMessage {
            text: "You were crushed by the falling tree!".into(),
            is_death: true,
        });
    }

    for entity in &kill_animals {
        info!("Animal crushed by falling tree");
        let _ = world.despawn(*entity);
    }
    if !kill_animals.is_empty() {
        messages.push(FellMessage {
            text: format!("{} animal(s) crushed by the tree", kill_animals.len()),
            is_death: false,
        });
    }

    for entity in &kill_plants {
        if let Ok(mut plant) = world.get::<&mut Plant>(*entity) {
            let name = plant.species_id;
            plant.growth_stage = GrowthStage::Dead;
            plant.health = 0.0;
            info!("Plant {} crushed by falling tree", name);
        }
        if let Ok(mut vel) = world.get::<&mut Velocity>(*entity) {
            vel.0 = glam::Vec3::ZERO;
        }
    }
    if !kill_plants.is_empty() {
        messages.push(FellMessage {
            text: format!("{} plant(s) crushed by the tree", kill_plants.len()),
            is_death: false,
        });
    }

    messages.push(FellMessage {
        text: format!("Tree collapsed at [{:.0},{:.0}]", event.tree_pos.x, event.tree_pos.z),
        is_death: false,
    });

    messages
}

fn simple_rand(seed: u64) -> f32 {
    let x = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
    let bits = ((x >> 33) ^ x) as u32;
    (bits as f32) / (u32::MAX as f32)
}
