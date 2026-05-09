use crate::components::identity::NetworkId;
use crate::components::plant::{Burning, GrowthStage, Plant};
use crate::systems::tree_felling::FellMessage;
use crate::Resources;
use ff_common::{EntityId, WILDFIRE_DEADLINE_TICKS};
use tracing::info;

const BURN_DURATION: u64 = 60;

pub struct WildfireResult {
    pub messages: Vec<FellMessage>,
    pub despawned: Vec<EntityId>,
}

pub fn run(world: &mut hecs::World, resources: &Resources) -> WildfireResult {
    let tick = resources.calendar.tick.0;
    let mut messages = Vec::new();
    let mut despawned = Vec::new();

    let mut to_despawn: Vec<(hecs::Entity, EntityId)> = Vec::new();
    for (entity, (burning, net_id)) in world.query_mut::<(&Burning, &NetworkId)>() {
        if tick >= burning.burn_until {
            to_despawn.push((entity, net_id.0));
        }
    }
    for (entity, eid) in &to_despawn {
        let _ = world.despawn(*entity);
        despawned.push(*eid);
    }

    if tick < WILDFIRE_DEADLINE_TICKS {
        if tick % 6000 == 0 && tick > 0 {
            let remaining_min = (WILDFIRE_DEADLINE_TICKS - tick) / 1200;
            messages.push(FellMessage {
                text: format!("Wildfire warning: {} minutes remaining to clear eucalyptus", remaining_min),
                is_death: false,
            });
        }
        return WildfireResult { messages, despawned };
    }

    let mut eucalyptus_alive = false;
    for (_entity, plant) in world.query_mut::<&Plant>() {
        if plant.species_id == 103 && plant.growth_stage != GrowthStage::Dead {
            eucalyptus_alive = true;
            break;
        }
    }

    if !eucalyptus_alive {
        return WildfireResult { messages, despawned };
    }

    if tick == WILDFIRE_DEADLINE_TICKS {
        info!("Wildfire triggered: eucalyptus not cleared in time");
        messages.push(FellMessage {
            text: "WILDFIRE! Eucalyptus was not cleared in time. Everything burns.".into(),
            is_death: true,
        });
    }

    if tick >= WILDFIRE_DEADLINE_TICKS && tick < WILDFIRE_DEADLINE_TICKS + 200 {
        let mut to_burn: Vec<hecs::Entity> = Vec::new();
        for (entity, (plant, already_burning)) in world.query_mut::<(&Plant, Option<&Burning>)>() {
            if plant.species_id == 103 { continue; }
            if plant.growth_stage == GrowthStage::Dead { continue; }
            if already_burning.is_some() { continue; }
            to_burn.push(entity);
            if to_burn.len() >= 15 {
                break;
            }
        }

        for entity in &to_burn {
            if let Ok(mut plant) = world.get::<&mut Plant>(*entity) {
                plant.growth_stage = GrowthStage::Dead;
                plant.health = 0.0;
            }
            let _ = world.insert_one(*entity, Burning { burn_until: tick + BURN_DURATION });
        }

        if !to_burn.is_empty() && tick % 20 == 0 {
            messages.push(FellMessage {
                text: format!("Fire spreading... {} plants burning", to_burn.len()),
                is_death: false,
            });
        }

        let mut burn_animals: Vec<hecs::Entity> = Vec::new();
        for (entity, (_animal, burning)) in world.query_mut::<(&crate::components::animal::Animal, Option<&Burning>)>() {
            if burning.is_some() { continue; }
            let rand_val = super::simple_rand(tick ^ (entity.id() as u64));
            if rand_val < 0.05 {
                burn_animals.push(entity);
            }
        }
        for entity in &burn_animals {
            let _ = world.insert_one(*entity, Burning { burn_until: tick + BURN_DURATION });
        }
        if !burn_animals.is_empty() {
            messages.push(FellMessage {
                text: format!("{} animal(s) caught in wildfire", burn_animals.len()),
                is_death: false,
            });
        }

        let mut kill_players: Vec<hecs::Entity> = Vec::new();
        for (entity, _player) in world.query_mut::<&crate::components::player::Player>() {
            let rand_val = super::simple_rand(tick ^ (entity.id() as u64));
            if rand_val < 0.02 {
                kill_players.push(entity);
            }
        }
        for entity in &kill_players {
            let _ = world.insert_one(*entity, crate::components::player::Dead {
                death_tick: tick,
                cause: crate::components::player::DeathCause::Wildfire,
            });
            if let Ok(mut vel) = world.get::<&mut crate::components::transform::Velocity>(*entity) {
                vel.0 = glam::Vec3::ZERO;
            }
            messages.push(FellMessage {
                text: "You were caught in the wildfire!".into(),
                is_death: true,
            });
        }
    }

    WildfireResult { messages, despawned }
}
