//! Tech-Monarch domain logic.
//!
//! Two roles in one file:
//!  - `tick_monarchs` regenerates each Monarch's Compute resource so they
//!    can keep deploying AI workers.
//!  - `tick_semi_ai_workers` walks every deployed AI unit and, on a slow
//!    cadence, makes it auto-harvest the nearest fruiting plant within
//!    range. The proceeds flow into the deploying monarch's wallet, and
//!    a per-monarch counter of "jobs cut" advances — the game-design
//!    proxy for human labour displaced by semi-AI.
//!
//! Runs every 20 ticks (1 s) for both systems.

use crate::components::ai_agent::SemiAIWorker;
use crate::components::plant::{GrowthStage, Harvestable, Plant};
use crate::components::player::{Monarch, Player, Wallet};
use crate::components::transform::{Position, Velocity};
use crate::Resources;
use glam::Vec3;

const HARVEST_RADIUS: f32 = 8.0;
const COMPUTE_REGEN_PER_TICK: f32 = 0.5;
const COMPUTE_CAP: f32 = 100.0;
const INFLUENCE_CAP: f32 = 100.0;
const INFLUENCE_PER_HARVEST: f32 = 1.0;
const FOFO_PER_HARVEST: u32 = 3;

pub fn tick_monarchs(world: &mut hecs::World) {
    use crate::components::player::{
        AiControlled, MonarchAsset, DISCONTENT_FROM_AUTOMATION, WELFARE_DECAY_PER_SEC,
    };

    // Snapshot the labour picture once (immutable) before the mutable pass:
    // how many *free* humans there are, and how many AI workers each Monarch
    // has fielded (the units displacing human labour).
    let mut free_humans = 0u32;
    for (_e, (_p, ai, asset)) in world
        .query::<(&Player, Option<&AiControlled>, Option<&MonarchAsset>)>()
        .iter()
    {
        if ai.is_none() && asset.is_none() {
            free_humans += 1;
        }
    }
    let mut workers_by_owner: std::collections::HashMap<u64, f32> = std::collections::HashMap::new();
    for (_e, w) in world.query::<&SemiAIWorker>().iter() {
        *workers_by_owner.entry(w.owner.0).or_insert(0.0) += 1.0;
    }

    for (_e, (player, monarch)) in world.query_mut::<(&Player, &mut Monarch)>() {
        monarch.compute = (monarch.compute + COMPUTE_REGEN_PER_TICK * 20.0).min(COMPUTE_CAP);
        // Shared prosperity fades over time — welfare reflects *recent* sharing.
        monarch.welfare = (monarch.welfare - WELFARE_DECAY_PER_SEC).max(0.0);
        // Automating human livelihoods without a safety net breeds unrest. Each
        // of this Monarch's AI workers displaces human labour; UBI (welfare)
        // offsets it. Unmet displacement slowly stokes discontent → revolt.
        let workers = *workers_by_owner.get(&player.player_id.0).unwrap_or(&0.0);
        let pressure = (workers / free_humans.max(1) as f32).min(1.5);
        let unmet = (pressure * 30.0 - monarch.welfare).max(0.0);
        monarch.discontent = (monarch.discontent + unmet * DISCONTENT_FROM_AUTOMATION).min(100.0);
    }
}

pub fn tick_semi_ai_workers(world: &mut hecs::World, resources: &Resources) {
    let tick = resources.calendar.tick.0;

    // Phase 1: collect a snapshot of fruiting harvest targets.
    let mut targets: Vec<(hecs::Entity, Vec3)> = Vec::new();
    for (e, (plant, pos, _h)) in world.query::<(&Plant, &Position, &Harvestable)>().iter() {
        if plant.growth_stage == GrowthStage::Fruiting {
            targets.push((e, pos.0));
        }
    }
    if targets.is_empty() {
        return;
    }

    // Phase 2: for each AI worker, claim the nearest target.
    // We need to apply effects (wallet += coins, monarch.influence += 1,
    // plant cooldown bumped). Collect first, apply after to avoid double-borrow.
    struct Effect {
        worker: hecs::Entity,
        target: hecs::Entity,
        owner: ff_common::PlayerId,
        new_velocity: Vec3,
    }
    let mut effects: Vec<Effect> = Vec::new();
    let mut claimed: std::collections::HashSet<hecs::Entity> = std::collections::HashSet::new();

    for (worker_e, (ai, pos, _vel)) in world
        .query::<(&SemiAIWorker, &Position, &Velocity)>()
        .iter()
    {
        let mut best: Option<(hecs::Entity, Vec3, f32)> = None;
        for &(target_e, tpos) in &targets {
            if claimed.contains(&target_e) {
                continue;
            }
            let dx = tpos.x - pos.0.x;
            let dz = tpos.z - pos.0.z;
            let d2 = dx * dx + dz * dz;
            if d2 > HARVEST_RADIUS * HARVEST_RADIUS {
                continue;
            }
            if best.map(|(_, _, b)| d2 < b).unwrap_or(true) {
                best = Some((target_e, tpos, d2));
            }
        }
        if let Some((target_e, tpos, d2)) = best {
            // Steer toward the target so the unit visibly drifts toward
            // the plant it's "working".
            let dir = Vec3::new(tpos.x - pos.0.x, 0.0, tpos.z - pos.0.z).normalize_or_zero();
            let new_vel = dir * 1.5;
            // Only fire the harvest when close enough AND once per second.
            let close_enough = d2 < 4.0;
            let cooled_down = tick.saturating_sub(ai.last_harvest_tick) >= 20;
            if close_enough && cooled_down {
                claimed.insert(target_e);
                effects.push(Effect {
                    worker: worker_e,
                    target: target_e,
                    owner: ai.owner,
                    new_velocity: Vec3::ZERO,
                });
            } else {
                // Just steer; no harvest yet.
                effects.push(Effect {
                    worker: worker_e,
                    target: target_e,
                    owner: ai.owner,
                    new_velocity: new_vel,
                });
            }
        } else {
            // Nothing in range — idle.
            effects.push(Effect {
                worker: worker_e,
                target: hecs::Entity::DANGLING,
                owner: ai.owner,
                new_velocity: Vec3::ZERO,
            });
        }
    }

    // Phase 3: apply velocity + harvests.
    for fx in &effects {
        if let Ok(mut v) = world.get::<&mut Velocity>(fx.worker) {
            v.0 = fx.new_velocity;
        }
    }

    // Map each owner PlayerId to its player entity (for wallet/monarch).
    let mut owners: std::collections::HashMap<ff_common::PlayerId, hecs::Entity> =
        std::collections::HashMap::new();
    for (e, player) in world.query::<&Player>().iter() {
        owners.insert(player.player_id, e);
    }

    for fx in effects {
        if fx.target == hecs::Entity::DANGLING {
            continue;
        }
        // Update the worker's last_harvest_tick.
        if let Ok(mut ai) = world.get::<&mut SemiAIWorker>(fx.worker) {
            ai.last_harvest_tick = tick;
        }
        // Bump the plant's harvest cooldown so a farmer can't double-collect.
        if let Ok(mut h) = world.get::<&mut Harvestable>(fx.target) {
            h.last_harvest_tick = tick as u32;
        }
        // Credit the owner monarch.
        if let Some(&player_entity) = owners.get(&fx.owner) {
            if let Ok(mut wallet) = world.get::<&mut Wallet>(player_entity) {
                wallet.0 = wallet.0.saturating_add(FOFO_PER_HARVEST);
            }
            if let Ok(mut m) = world.get::<&mut Monarch>(player_entity) {
                m.influence = (m.influence + INFLUENCE_PER_HARVEST).min(INFLUENCE_CAP);
                m.jobs_cut = m.jobs_cut.saturating_add(1);
                // Every successful auto-harvest nudges the AI's
                // intelligence — the more the fleet works, the closer
                // the takeover becomes.
                m.ai_intelligence = (m.ai_intelligence
                    + crate::components::player::AI_INT_PER_HARVEST)
                    .min(crate::components::player::AI_TAKEOVER_THRESHOLD);
            }
        }
    }

}
