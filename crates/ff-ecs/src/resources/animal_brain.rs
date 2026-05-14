//! Custom portable Q-learning brain for animal movement.
//!
//! No external ML/AI dependencies — pure Rust. Each species owns a shared
//! Q-table that all individuals of that species learn into during a single
//! world's lifetime. The table is NOT persisted and NOT shared across worlds:
//! each new world starts naive and learns from its own players and animals.
//!
//! Model: tabular Q-learning with epsilon-greedy exploration.
//!   Q(s, a) <- Q(s, a) + alpha * (r + gamma * max_a' Q(s', a') - Q(s, a))
//!
//! State encoding (5 features, all small enums):
//!   hunger bucket   : 0 satiated, 1 hungry, 2 starving
//!   energy bucket   : 0 rested,   1 tired,  2 exhausted
//!   threat dir      : 0 none, 1 N, 2 E, 3 S, 4 W   (nearest player / predator)
//!   food dir        : 0 none, 1 N, 2 E, 3 S, 4 W   (nearest edible plant)
//!   herd dir        : 0 none, 1 N, 2 E, 3 S, 4 W   (nearest same-species animal)
//!
//! Action space (9 moves): N, NE, E, SE, S, SW, W, NW, STAY.
//!
//! State count = 3*3*5*5*5 = 1125, table size = 1125 * 9 = 10125 floats
//! per species (~40 KB). Fits comfortably in cache.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

const HUNGER_BUCKETS: usize = 3;
const ENERGY_BUCKETS: usize = 3;
const DIR_BUCKETS: usize = 5;
pub const NUM_ACTIONS: usize = 9;

pub const STATE_COUNT: usize =
    HUNGER_BUCKETS * ENERGY_BUCKETS * DIR_BUCKETS * DIR_BUCKETS * DIR_BUCKETS;
pub const TABLE_SIZE: usize = STATE_COUNT * NUM_ACTIONS;

const ALPHA: f32 = 0.1;
const GAMMA: f32 = 0.9;
const EPSILON_START: f32 = 0.3;
const EPSILON_MIN: f32 = 0.05;
const EPSILON_DECAY: f32 = 0.0001;
const Q_CLAMP: f32 = 50.0;

/// Bucket a hunger value in [0, 1] into a discrete level.
pub fn hunger_bucket(hunger: f32) -> u8 {
    if hunger < 0.3 {
        0
    } else if hunger < 0.7 {
        1
    } else {
        2
    }
}

/// Bucket an energy value in [0, 1] into a discrete level.
pub fn energy_bucket(energy: f32) -> u8 {
    if energy > 0.7 {
        0
    } else if energy > 0.3 {
        1
    } else {
        2
    }
}

/// Encode a 2D delta vector into a coarse compass direction.
/// Returns: 0 none, 1 +Z (N), 2 +X (E), 3 -Z (S), 4 -X (W).
pub fn direction_bucket(dx: f32, dz: f32) -> u8 {
    if dx.abs() < 0.001 && dz.abs() < 0.001 {
        return 0;
    }
    if dz.abs() >= dx.abs() {
        if dz > 0.0 { 1 } else { 3 }
    } else if dx > 0.0 {
        2
    } else {
        4
    }
}

/// Encoded state index into the Q-table.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct State(pub usize);

impl State {
    pub fn encode(hunger: u8, energy: u8, threat_dir: u8, food_dir: u8, herd_dir: u8) -> Self {
        let mut idx = (hunger as usize).min(HUNGER_BUCKETS - 1);
        idx = idx * ENERGY_BUCKETS + (energy as usize).min(ENERGY_BUCKETS - 1);
        idx = idx * DIR_BUCKETS + (threat_dir as usize).min(DIR_BUCKETS - 1);
        idx = idx * DIR_BUCKETS + (food_dir as usize).min(DIR_BUCKETS - 1);
        idx = idx * DIR_BUCKETS + (herd_dir as usize).min(DIR_BUCKETS - 1);
        State(idx.min(STATE_COUNT - 1))
    }
}

/// Discrete movement action.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MoveAction(pub u8);

impl MoveAction {
    pub const N: Self = Self(0);
    pub const NE: Self = Self(1);
    pub const E: Self = Self(2);
    pub const SE: Self = Self(3);
    pub const S: Self = Self(4);
    pub const SW: Self = Self(5);
    pub const W: Self = Self(6);
    pub const NW: Self = Self(7);
    pub const STAY: Self = Self(8);

    /// Convert action to (vx, vz) unit-ish velocity, scaled by `speed`.
    pub fn to_velocity(self, speed: f32) -> (f32, f32) {
        const D: f32 = 0.7071068;
        const DIRS: [(f32, f32); 9] = [
            (0.0, 1.0),
            (D, D),
            (1.0, 0.0),
            (D, -D),
            (0.0, -1.0),
            (-D, -D),
            (-1.0, 0.0),
            (-D, D),
            (0.0, 0.0),
        ];
        let idx = (self.0 as usize).min(NUM_ACTIONS - 1);
        let (dx, dz) = DIRS[idx];
        (dx * speed, dz * speed)
    }

    pub fn is_stay(self) -> bool {
        self.0 == Self::STAY.0
    }
}

/// One species' Q-table plus learning state. Pure data, fully serializable
/// (in case a future feature wants to persist or transfer brains).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QTable {
    pub values: Vec<f32>,
    pub epsilon: f32,
    pub total_updates: u64,
}

impl QTable {
    pub fn new() -> Self {
        Self {
            values: vec![0.0; TABLE_SIZE],
            epsilon: EPSILON_START,
            total_updates: 0,
        }
    }

    #[inline]
    fn q_idx(state: State, action: MoveAction) -> usize {
        state.0 * NUM_ACTIONS + action.0 as usize
    }

    pub fn get_q(&self, state: State, action: MoveAction) -> f32 {
        self.values[Self::q_idx(state, action)]
    }

    pub fn set_q(&mut self, state: State, action: MoveAction, value: f32) {
        self.values[Self::q_idx(state, action)] = value;
    }

    /// Argmax over actions at `state` — the action the brain currently believes is best.
    pub fn best_action(&self, state: State) -> MoveAction {
        let base = state.0 * NUM_ACTIONS;
        let mut best_idx: u8 = 0;
        let mut best_val = self.values[base];
        for i in 1..NUM_ACTIONS {
            let v = self.values[base + i];
            if v > best_val {
                best_val = v;
                best_idx = i as u8;
            }
        }
        MoveAction(best_idx)
    }

    /// Max Q-value at `state` (used in the Bellman update).
    pub fn max_q(&self, state: State) -> f32 {
        let base = state.0 * NUM_ACTIONS;
        let mut m = self.values[base];
        for i in 1..NUM_ACTIONS {
            let v = self.values[base + i];
            if v > m {
                m = v;
            }
        }
        m
    }

    /// Epsilon-greedy action selection. `rand01` must be in [0, 1).
    pub fn select_action(&self, state: State, rand01: f32) -> MoveAction {
        if rand01 < self.epsilon {
            let a = (rand01 / self.epsilon * NUM_ACTIONS as f32) as usize;
            MoveAction((a.min(NUM_ACTIONS - 1)) as u8)
        } else {
            self.best_action(state)
        }
    }

    /// Standard tabular Q-learning update.
    pub fn update(
        &mut self,
        prev_state: State,
        prev_action: MoveAction,
        reward: f32,
        new_state: State,
    ) {
        let old_q = self.get_q(prev_state, prev_action);
        let max_future = self.max_q(new_state);
        let target = reward + GAMMA * max_future;
        let new_q = (old_q + ALPHA * (target - old_q)).clamp(-Q_CLAMP, Q_CLAMP);
        self.set_q(prev_state, prev_action, new_q);
        self.total_updates = self.total_updates.saturating_add(1);
        self.epsilon = (self.epsilon - EPSILON_DECAY).max(EPSILON_MIN);
    }
}

impl Default for QTable {
    fn default() -> Self {
        Self::new()
    }
}

/// One Q-table per species, lazily allocated. Lives on `Resources`,
/// so it is scoped to a single shard/world.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpeciesBrains {
    pub tables: HashMap<u16, QTable>,
}

impl SpeciesBrains {
    pub fn new() -> Self {
        Self {
            tables: HashMap::new(),
        }
    }

    pub fn get_or_create(&mut self, species_id: u16) -> &mut QTable {
        self.tables.entry(species_id).or_insert_with(QTable::new)
    }

    pub fn get(&self, species_id: u16) -> Option<&QTable> {
        self.tables.get(&species_id)
    }
}

impl Default for SpeciesBrains {
    fn default() -> Self {
        Self::new()
    }
}
