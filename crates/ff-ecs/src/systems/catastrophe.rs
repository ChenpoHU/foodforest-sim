//! Global catastrophes — pandemic, solar flare, drought, nuclear,
//! asteroid. Single periodic tick:
//!   - If none active, roll a small chance to start one (mode-gated).
//!   - If active, apply its per-tick damage and tick the countdown.
//!   - When the duration runs out (or an Innovator deploys a matching
//!     Breakthrough), reset to None.
//!
//! Each kind has its own damage rule; see `apply_damage` below. None
//! of them require their own ECS components — they all mutate
//! existing health/moisture/etc. via the standard query API, so adding
//! a new catastrophe later is just another `apply_damage` arm.

use crate::components::animal::Animal;
use crate::components::ai_agent::SemiAIWorker;
use crate::components::soil::SoilGrid;
use crate::components::plant::{Plant, Burning};
use crate::{Catastrophe, CatastropheKind, Resources};
use ff_common::{EntityId, GameMode};

/// Returns the list of entities to despawn this tick (e.g. drones
/// destroyed by a solar flare). The caller (tick.rs) folds these into
/// its existing despawn broadcast pipeline.
pub fn run(world: &mut hecs::World, soil_grid: &mut SoilGrid, resources: &mut Resources) -> Vec<EntityId> {
    let tick = resources.calendar.tick.0;

    // Catastrophes only run in Realistic or Survival. Peaceful keeps
    // the world chill (it's described as "for all ages" in the UI).
    if matches!(resources.game_mode, GameMode::Peaceful) {
        return Vec::new();
    }

    // Step 1: maybe spawn a new catastrophe.
    if resources.catastrophe.kind == CatastropheKind::None {
        maybe_spawn(resources, tick);
        return Vec::new();
    }

    // Step 2: tick the active one. Damage scales with intensity.
    let kind = resources.catastrophe.kind;
    let intensity = resources.catastrophe.intensity;
    let despawned = apply_damage(world, soil_grid, kind, intensity);

    // Intensity drifts upward toward its target (100% by mid-event)
    // then back down toward 0 as the event resolves naturally.
    resources.catastrophe.ticks_elapsed = resources.catastrophe.ticks_elapsed.saturating_add(1);
    let t = resources.catastrophe.ticks_elapsed as f32;
    let d = resources.catastrophe.duration_ticks as f32;
    if d > 0.0 {
        let half = d * 0.5;
        let next_intensity = if t < half {
            // ramp up
            (t / half * 100.0).clamp(0.0, 100.0)
        } else {
            // ramp down
            ((1.0 - (t - half) / half) * 100.0).clamp(0.0, 100.0)
        };
        if (next_intensity - resources.catastrophe.intensity).abs() > 1.0 {
            resources.catastrophe.intensity = next_intensity;
            resources.catastrophe.dirty = true;
        }
    }

    if resources.catastrophe.ticks_elapsed >= resources.catastrophe.duration_ticks {
        // Natural end.
        resources.catastrophe.kind = CatastropheKind::None;
        resources.catastrophe.intensity = 0.0;
        resources.catastrophe.ticks_elapsed = 0;
        resources.catastrophe.duration_ticks = 0;
        resources.catastrophe.dirty = true;
    }

    despawned
}

/// Innovator helper: end the active catastrophe (called from ws.rs
/// after a successful DeployBreakthrough). Sets the dirty flag so
/// tick.rs pushes the cleared state to all clients.
pub fn resolve_active(resources: &mut Resources) {
    resources.catastrophe.kind = CatastropheKind::None;
    resources.catastrophe.intensity = 0.0;
    resources.catastrophe.ticks_elapsed = 0;
    resources.catastrophe.duration_ticks = 0;
    resources.catastrophe.dirty = true;
}

fn maybe_spawn(resources: &mut Resources, tick: u64) {
    // 0.5% chance per tick (so ~1 catastrophe per ~200 ticks = ~10s
    // at the 20 Hz tick rate). Plenty of action for testing; can
    // throttle later.
    let r = simple_hash(tick) % 200;
    if r != 0 {
        return;
    }
    // Pick which catastrophe — uniformly over the 5 kinds.
    let pick = (simple_hash(tick.wrapping_add(7919)) % 5) as u8 + 1;
    let kind = CatastropheKind::from_u8(pick);
    let duration = match kind {
        CatastropheKind::Asteroid   => 80,   // sudden + brief
        CatastropheKind::SolarFlare => 120,
        CatastropheKind::Pandemic   => 240,  // long, slow
        CatastropheKind::Drought    => 200,
        CatastropheKind::Nuclear    => 200,
        CatastropheKind::None       => return,
    };
    resources.catastrophe = Catastrophe {
        kind,
        intensity: 1.0,
        ticks_elapsed: 0,
        duration_ticks: duration,
        last_broadcast_tick: tick,
        dirty: true,
    };
}

fn apply_damage(
    world: &mut hecs::World,
    soil_grid: &mut SoilGrid,
    kind: CatastropheKind,
    intensity: f32,
) -> Vec<EntityId> {
    let scale = (intensity / 100.0).clamp(0.0, 1.0);
    let mut despawned: Vec<EntityId> = Vec::new();

    match kind {
        CatastropheKind::Pandemic => {
            // Animals get sick: hunger ticks upward, energy drops.
            // Existing animal_ai system already culls/flees animals
            // whose stats degrade past thresholds.
            for (_e, animal) in world.query_mut::<&mut Animal>() {
                animal.hunger = (animal.hunger + 0.5 * scale).min(100.0);
                animal.energy = (animal.energy - 0.4 * scale).max(0.0);
            }
        }
        CatastropheKind::SolarFlare => {
            // Drones (SemiAIWorkers) are electronics — fry them.
            // 0.6% per tick × scale.
            let kill_chance = 0.006 * scale;
            let entities: Vec<hecs::Entity> = world
                .query::<&SemiAIWorker>()
                .iter()
                .filter(|_| simple_unit_random() < kill_chance)
                .map(|(e, _)| e)
                .collect();
            for e in entities {
                let net_id = world
                    .get::<&crate::components::identity::NetworkId>(e)
                    .map(|n| n.0)
                    .ok();
                let _ = world.despawn(e);
                if let Some(eid) = net_id {
                    despawned.push(eid);
                }
            }
        }
        CatastropheKind::Drought => {
            // Bleed soil moisture across the whole grid. The water
            // system normally tops it up; drought outpaces that.
            for block in soil_grid.data.iter_mut() {
                block.moisture = (block.moisture - 0.02 * scale).max(0.0);
            }
        }
        CatastropheKind::Nuclear => {
            // Mix of effects: animal sickness + plants catching fire.
            for (_e, animal) in world.query_mut::<&mut Animal>() {
                animal.energy = (animal.energy - 0.5 * scale).max(0.0);
                animal.hunger = (animal.hunger + 0.3 * scale).min(100.0);
            }
            // Random plants ignite — reuse the existing Burning
            // component so the wildfire visual + propagation handles
            // the rest.
            let burn_until = u64::MAX; // burns until consumed
            let plant_entities: Vec<hecs::Entity> = world
                .query::<&Plant>()
                .iter()
                .filter(|_| simple_unit_random() < 0.0015 * scale)
                .map(|(e, _)| e)
                .collect();
            for e in plant_entities {
                let _ = world.insert_one(e, Burning { burn_until });
            }
        }
        CatastropheKind::Asteroid => {
            // Brief but brutal: many plants ignite, animals take a
            // sharp hit.
            for (_e, animal) in world.query_mut::<&mut Animal>() {
                animal.energy = (animal.energy - 1.0 * scale).max(0.0);
                animal.hunger = (animal.hunger + 0.6 * scale).min(100.0);
            }
            let burn_until = u64::MAX;
            let plant_entities: Vec<hecs::Entity> = world
                .query::<&Plant>()
                .iter()
                .filter(|_| simple_unit_random() < 0.004 * scale)
                .map(|(e, _)| e)
                .collect();
            for e in plant_entities {
                let _ = world.insert_one(e, Burning { burn_until });
            }
        }
        CatastropheKind::None => {}
    }

    despawned
}

/// Tiny linear-congruential PRNG fed by tick number — same trick the
/// rest of the codebase uses to avoid pulling in `rand`.
fn simple_hash(seed: u64) -> u64 {
    let mut x = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
    x ^= x >> 33;
    x = x.wrapping_mul(0xff51afd7ed558ccd);
    x ^= x >> 33;
    x = x.wrapping_mul(0xc4ceb9fe1a85ec53);
    x ^= x >> 33;
    x
}

/// 0..1 float from a thread-local counter — fine for "small chance
/// per entity per tick" rolls. NOT deterministic across runs because
/// we don't need it to be.
fn simple_unit_random() -> f32 {
    use std::cell::Cell;
    thread_local! { static SEED: Cell<u64> = const { Cell::new(0x9E37_79B9_7F4A_7C15) }; }
    SEED.with(|s| {
        let mut x = s.get();
        x = x.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        s.set(x);
        ((x >> 33) as u32) as f32 / (u32::MAX as f32)
    })
}
