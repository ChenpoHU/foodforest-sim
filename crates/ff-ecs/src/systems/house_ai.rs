//! The **house AI** — the game's own lean, online-learning agent, now playing
//! **all the roles**, not just Farmer.
//!
//! Design (see `md/07-master-design.md` §4b): *not* a market LLM. One shared,
//! tiny **linear policy** (`HouseBrain`) pilots every native AI body. We keep it
//! lean by *masking* the action set per role rather than carrying a separate
//! network per role: shared actions (eat, wander, sell) share weights, while
//! role-exclusive actions (plant / research / deploy) are only ever chosen by —
//! and therefore only learn from — the role that can take them. Each role earns
//! a role-appropriate **score** (Farmer/Monarch = coins, Innovator = knowledge,
//! AI faction = machine intelligence) so the reward signal fits the fantasy.
//!
//! Learning is two-fold: **online Q-learning** from the body's own experience
//! and **behavioural cloning** from every human + external-agent success
//! (`imitate`), fed live and replayed from the behaviour log on startup.

use serde::{Deserialize, Serialize};

use crate::components::identity::{NetworkId, Owner};
use crate::components::player::{
    AiMemory, Hunger, Innovator, Inventory, Monarch, NativeAi, Stamina, Wallet, KNOWLEDGE_CAP,
    HOUSE_AI_ACTIONS as NA, HOUSE_AI_FEATURES as NF,
};
use crate::components::plant::Plant;
use crate::components::transform::{Position, Velocity};
use crate::systems::interaction::{self, ActionResult};
use crate::Resources;
use ff_common::{EntityId, PlayerId};
use ff_protocol::ActionKind;
use ff_voxel::VoxelWorld;
use glam::Vec3;
use hecs::Entity;
use rand::Rng;

// Macro-action superset (index = action id). NA == 9.
const A_PLANT: usize = 0;
const A_HARVEST: usize = 1;
const A_EAT: usize = 2;
const A_SELL: usize = 3;
const A_WATER: usize = 4;
const A_WANDER: usize = 5;
const A_RESEARCH: usize = 6;
const A_BREAKTHROUGH: usize = 7;
const A_DEPLOY: usize = 8;

// Roles: 0 Farmer · 1 Tech-Monarch · 2 Innovator · 3 AI faction.
const ROLE_FARMER: u8 = 0;
const ROLE_MONARCH: u8 = 1;
const ROLE_INNOVATOR: u8 = 2;
const ROLE_AI: u8 = 3;

// Which actions each role may choose. Shared actions appear in several masks.
const M_FARMER: [usize; 6] = [A_PLANT, A_HARVEST, A_EAT, A_SELL, A_WATER, A_WANDER];
const M_MONARCH: [usize; 4] = [A_DEPLOY, A_SELL, A_EAT, A_WANDER];
const M_INNOV: [usize; 4] = [A_RESEARCH, A_BREAKTHROUGH, A_EAT, A_WANDER];
const M_AI: [usize; 3] = [A_DEPLOY, A_EAT, A_WANDER];

fn mask(role: u8) -> &'static [usize] {
    match role {
        ROLE_MONARCH => &M_MONARCH,
        ROLE_INNOVATOR => &M_INNOV,
        ROLE_AI => &M_AI,
        _ => &M_FARMER,
    }
}

/// Species the farmer agent sows — clover (500): cheap, fast, reliably valid.
const SOW_SPECIES: u16 = 500;

/// The shared online-learning policy. One small weight matrix; role behaviour
/// comes from masking + role-specific reward, keeping it lean.
#[derive(Clone, Serialize, Deserialize)]
pub struct HouseBrain {
    /// `w[action][feature]` — the linear Q weights (shared across roles).
    pub w: Vec<[f32; NF]>,
    pub epsilon: f32,
    pub alpha: f32,
    pub gamma: f32,
    pub steps: u64,
    pub ewma_reward: f32,
    pub act_counts: [u64; NA],
    #[serde(default)]
    pub imitations: u64,
    #[serde(default)]
    last_log: u64,
    rng: u64,
}

impl Default for HouseBrain {
    fn default() -> Self {
        Self {
            w: vec![[0.0; NF]; NA],
            epsilon: 0.45,
            alpha: 0.03,
            gamma: 0.95,
            steps: 0,
            ewma_reward: 0.0,
            act_counts: [0; NA],
            imitations: 0,
            last_log: 0,
            rng: 0x9e37_79b9_7f4a_7c15,
        }
    }
}

impl HouseBrain {
    fn rand01(&mut self) -> f32 {
        let mut x = self.rng;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.rng = x;
        ((x >> 40) as f32) / ((1u32 << 24) as f32)
    }

    fn q(&self, feats: &[f32; NF], a: usize) -> f32 {
        let mut s = 0.0;
        for i in 0..NF {
            s += self.w[a][i] * feats[i];
        }
        s
    }

    fn best_in(&self, feats: &[f32; NF], actions: &[usize]) -> usize {
        let mut best = actions[0];
        let mut bv = self.q(feats, best);
        for &a in &actions[1..] {
            let v = self.q(feats, a);
            if v > bv {
                bv = v;
                best = a;
            }
        }
        best
    }

    /// ε-greedy over the role's valid actions.
    pub fn choose(&mut self, feats: &[f32; NF], role: u8) -> usize {
        let m = mask(role);
        if self.rand01() < self.epsilon {
            return m[(self.rand01() * m.len() as f32) as usize % m.len()];
        }
        self.best_in(feats, m)
    }

    /// One online TD(0) update, bootstrapping over the role's valid actions.
    pub fn learn(&mut self, last: &[f32; NF], a: usize, r: f32, next: &[f32; NF], role: u8) {
        let m = mask(role);
        let maxn = self.q(next, self.best_in(next, m));
        let target = r + self.gamma * maxn;
        let delta = (target - self.q(last, a)).clamp(-10.0, 10.0);
        for i in 0..NF {
            self.w[a][i] = (self.w[a][i] + self.alpha * delta * last[i]).clamp(-50.0, 50.0);
        }
        self.steps += 1;
        self.ewma_reward = self.ewma_reward * 0.995 + r * 0.005;
        if self.epsilon > 0.05 {
            self.epsilon *= 0.99996;
        }
    }

    /// Behavioural cloning of another player's successful action (within their
    /// role's action set). Stable perceptron correction — only on disagreement.
    pub fn imitate(&mut self, feats: &[f32; NF], a: usize, role: u8) {
        let m = mask(role);
        if !m.contains(&a) {
            return;
        }
        let pred = self.best_in(feats, m);
        if pred != a {
            const ETA: f32 = 0.02;
            for i in 0..NF {
                self.w[a][i] = (self.w[a][i] + ETA * feats[i]).clamp(-50.0, 50.0);
                self.w[pred][i] = (self.w[pred][i] - ETA * feats[i]).clamp(-50.0, 50.0);
            }
        }
        self.imitations = self.imitations.saturating_add(1);
    }
}

/// One decision step for every native AI body, across all roles.
pub fn run(
    world: &mut hecs::World,
    terrain: &mut VoxelWorld,
    resources: &Resources,
    brain: &mut HouseBrain,
    next_entity_id: &mut u64,
) {
    let agents: Vec<(Entity, PlayerId, u8)> = world
        .query::<(&NativeAi, &Owner, &AiMemory)>()
        .iter()
        .map(|(e, (_, owner, mem))| (e, owner.0, mem.role))
        .collect();

    for (e, pid, role) in agents {
        let score = role_score(world, e, role, resources.game_mode);
        let feats = extract_features(world, e, resources);

        let prev = world
            .get::<&AiMemory>(e)
            .ok()
            .filter(|m| m.has_last)
            .map(|m| (m.last_feats, m.last_action as usize, m.last_score, m.pending_bonus));
        if let Some((lf, la, ls, pb)) = prev {
            let reward = (score - ls) * 0.5 + pb;
            brain.learn(&lf, la, reward, &feats, role);
        }

        let a = brain.choose(&feats, role);
        brain.act_counts[a] = brain.act_counts[a].saturating_add(1);
        let ok = apply_action(world, terrain, resources, e, pid, a, next_entity_id);
        let bonus = shaping(a, ok);

        if let Ok(mut m) = world.get::<&mut AiMemory>(e) {
            m.last_feats = feats;
            m.last_action = a as u8;
            m.last_score = score;
            m.pending_bonus = bonus;
            m.has_last = true;
        }
    }

    // Heartbeat ~every 150 brain steps. `steps` can jump by up to (#agents)
    // per call, so use a threshold rather than an exact modulo.
    if brain.steps >= brain.last_log + 150 {
        brain.last_log = brain.steps;
        tracing::info!(
            "house-AI: steps={} imit={} ε={:.3} ewmaR={:+.3} acts(pl,hv,eat,sl,wt,wn,rs,bt,dp)={:?}",
            brain.steps, brain.imitations, brain.epsilon, brain.ewma_reward, brain.act_counts
        );
    }
}

/// Role-appropriate scalar the agent is trying to grow (reward = its delta).
/// The **AI faction's** objective is world-dependent — the per-world register:
/// in Peaceful it's a *companion* rewarded for productivity (coins it generates
/// via its drones); in Realistic/Survival it pursues *ascendancy* (machine
/// intelligence toward the takeover threshold).
fn role_score(world: &hecs::World, e: Entity, role: u8, mode: ff_common::GameMode) -> f32 {
    match role {
        ROLE_INNOVATOR => world.get::<&Innovator>(e).map(|i| i.knowledge).unwrap_or(0.0),
        ROLE_AI => {
            if mode == ff_common::GameMode::Peaceful {
                world.get::<&Wallet>(e).map(|w| w.0 as f32).unwrap_or(0.0)
            } else {
                world.get::<&Monarch>(e).map(|m| m.ai_intelligence).unwrap_or(0.0)
            }
        }
        _ => world.get::<&Wallet>(e).map(|w| w.0 as f32).unwrap_or(0.0),
    }
}

/// Compact local state → fixed feature vector (all roughly 0..1). Public so the
/// server can compute the *same* features for a human / external-agent entity
/// when teaching the house brain by imitation.
pub fn extract_features(world: &hecs::World, e: Entity, resources: &Resources) -> [f32; NF] {
    let pos = world.get::<&Position>(e).map(|p| p.0).unwrap_or(Vec3::ZERO);
    let hunger = world.get::<&Hunger>(e).map(|h| h.0).unwrap_or(0.0);
    let stamina = world.get::<&Stamina>(e).map(|s| s.0).unwrap_or(0.0);
    let coins = world.get::<&Wallet>(e).map(|w| w.0).unwrap_or(0);
    let (produce, food) = inventory_summary(world, e);
    let knowledge = world.get::<&Innovator>(e).map(|i| i.knowledge).unwrap_or(0.0);
    let compute = world.get::<&Monarch>(e).map(|m| m.compute).unwrap_or(0.0);
    let cat_active = if resources.catastrophe.kind as u8 != 0 { 1.0 } else { 0.0 };

    let mut ripe_dist = 1e9_f32;
    for (_pe, (pl, pp)) in world.query::<(&Plant, &Position)>().iter() {
        if pl.growth_stage as u8 == 5 {
            let d = (pp.0 - pos).length();
            if d < ripe_dist {
                ripe_dist = d;
            }
        }
    }
    let ripe_any = if ripe_dist < 1e8 { 1.0 } else { 0.0 };
    let ripe_close = if ripe_dist < 1e8 { (1.0 - (ripe_dist / 60.0)).clamp(0.0, 1.0) } else { 0.0 };

    [
        1.0,                                                   // bias
        (hunger / 100.0).clamp(0.0, 1.0),
        (stamina / 100.0).clamp(0.0, 1.0),
        ((coins as f32 + 1.0).ln() / 6.0).clamp(0.0, 1.0),
        if produce > 0 { 1.0 } else { 0.0 },
        if food > 0 { 1.0 } else { 0.0 },
        ripe_any,
        ripe_close,
        cat_active,                                            // is a crisis on (Innovator)
        (knowledge / KNOWLEDGE_CAP).clamp(0.0, 1.0),           // banked research (Innovator)
        (compute / 100.0).clamp(0.0, 1.0),                     // available compute (Monarch/AI)
    ]
}

fn inventory_summary(world: &hecs::World, e: Entity) -> (u16, u16) {
    let mut produce = 0u16;
    let mut food = 0u16;
    if let Ok(inv) = world.get::<&Inventory>(e) {
        for st in &inv.slots {
            if (1000..2000).contains(&st.item_id) {
                produce = produce.saturating_add(st.count);
            }
            if (1200..3000).contains(&st.item_id) {
                food = food.saturating_add(st.count);
            }
        }
    }
    (produce, food)
}

/// Execute a macro-action through the same interaction pipeline humans use.
fn apply_action(
    world: &mut hecs::World,
    terrain: &mut VoxelWorld,
    resources: &Resources,
    e: Entity,
    pid: PlayerId,
    a: usize,
    next_entity_id: &mut u64,
) -> bool {
    let pos = world.get::<&Position>(e).map(|p| p.0).unwrap_or(Vec3::ZERO);
    let mut rng = rand::thread_rng();
    let tick = resources.calendar.tick.0;

    let action: Option<ActionKind> = match a {
        A_PLANT => {
            let x = pos.x as i32 + rng.gen_range(-5..=5);
            let z = pos.z as i32 + rng.gen_range(-5..=5);
            Some(ActionKind::PlantSeed { species_id: SOW_SPECIES, position: [x, 0, z] })
        }
        A_HARVEST => nearest_ripe(world, e).map(|nid| ActionKind::Harvest { entity_id: nid }),
        A_EAT => first_item(world, e, 1200, 3000).map(|(item, _)| ActionKind::EatItem { item_id: item }),
        A_SELL => first_item(world, e, 1000, 2000).map(|(item, n)| ActionKind::SellItem { item_id: item, count: n }),
        A_WATER => Some(ActionKind::Water { position: [pos.x as i32, 0, pos.z as i32], radius: 3 }),
        A_RESEARCH => Some(ActionKind::Research { topic: ((tick / 37) % 4) as u8 }),
        A_BREAKTHROUGH => {
            // Deploy the breakthrough matching the active catastrophe (kind-1).
            let needed = (resources.catastrophe.kind as u8).saturating_sub(1);
            Some(ActionKind::DeployBreakthrough { kind: needed })
        }
        A_DEPLOY => Some(ActionKind::DeploySemiAI { position: [pos.x as i32, 0, pos.z as i32] }),
        A_WANDER | _ => {
            if let Ok(mut v) = world.get::<&mut Velocity>(e) {
                v.0.x = rng.gen_range(-3.0f32..3.0f32);
                v.0.z = rng.gen_range(-3.0f32..3.0f32);
            }
            return true;
        }
    };

    match action {
        Some(act) => matches!(
            interaction::process_action(world, terrain, resources, e, pid, &act, next_entity_id),
            ActionResult::Success(_) | ActionResult::SuccessWithDespawn(_, _)
        ),
        None => false,
    }
}

fn nearest_ripe(world: &hecs::World, e: Entity) -> Option<EntityId> {
    let pos = world.get::<&Position>(e).map(|p| p.0).unwrap_or(Vec3::ZERO);
    let mut best: Option<(f32, EntityId)> = None;
    for (_pe, (pl, pp, nid)) in world.query::<(&Plant, &Position, &NetworkId)>().iter() {
        if pl.growth_stage as u8 != 5 {
            continue;
        }
        let d = (pp.0 - pos).length();
        if best.map(|(bd, _)| d < bd).unwrap_or(true) {
            best = Some((d, nid.0));
        }
    }
    best.map(|(_, id)| id)
}

fn first_item(world: &hecs::World, e: Entity, lo: u16, hi: u16) -> Option<(u16, u16)> {
    let inv = world.get::<&Inventory>(e).ok()?;
    inv.slots
        .iter()
        .find(|s| (lo..hi).contains(&s.item_id) && s.count > 0)
        .map(|s| (s.item_id, s.count))
}

/// Dense-ish shaping reward so the policy has signal before the score moves.
fn shaping(a: usize, ok: bool) -> f32 {
    match a {
        A_PLANT => if ok { 0.15 } else { -0.02 },
        A_HARVEST => if ok { 0.6 } else { -0.02 },
        A_EAT => if ok { 0.2 } else { -0.05 },
        A_SELL => if ok { 0.3 } else { -0.02 },
        A_WATER => if ok { 0.05 } else { -0.01 },
        A_RESEARCH => if ok { 0.25 } else { -0.02 },
        A_BREAKTHROUGH => if ok { 2.0 } else { -0.05 }, // ending a crisis is the Innovator's payoff
        A_DEPLOY => if ok { 0.25 } else { -0.05 },
        _ => -0.01,
    }
}

/// Map a fine-grained player `ActionKind` to the brain's macro-action index, or
/// `None` when it isn't part of the macro-set. Used to teach the house brain
/// from humans' and external agents' actions.
pub fn macro_action_of(action: &ActionKind) -> Option<usize> {
    match action {
        ActionKind::PlantSeed { .. } => Some(A_PLANT),
        ActionKind::Harvest { .. } => Some(A_HARVEST),
        ActionKind::EatItem { .. } => Some(A_EAT),
        ActionKind::SellItem { .. } => Some(A_SELL),
        ActionKind::Water { .. } => Some(A_WATER),
        ActionKind::Research { .. } => Some(A_RESEARCH),
        ActionKind::DeployBreakthrough { .. } => Some(A_BREAKTHROUGH),
        ActionKind::DeploySemiAI { .. } => Some(A_DEPLOY),
        _ => None,
    }
}
