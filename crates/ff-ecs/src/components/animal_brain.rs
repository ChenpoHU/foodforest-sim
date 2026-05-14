//! Per-animal learning memory. Carries the trajectory state required for
//! the Q-learning update: which (state, action) we came from, what reward
//! has accumulated since, and short-lived emotional state that biases
//! perception (e.g. fear from witnessing nearby hunts).

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnimalMemory {
    /// Encoded `State` index of the last decision.
    pub prev_state: usize,
    /// Action taken at `prev_state` (encoded as `MoveAction(u8)`).
    pub prev_action: u8,
    /// Out-of-band reward signal accumulated since the last decision
    /// (e.g. positive for eating food, negative for being scared by a hunt).
    pub reward: f32,
    /// False on the very first tick — skip the Q-learning update because
    /// there is no previous (state, action) to credit.
    pub initialized: bool,
    /// 0..1, decays each tick. Inflates perceived threat radius and
    /// biases the brain toward escape actions.
    pub fear: f32,
    /// Lifetime tick count this individual has spent learning.
    pub lifetime_decisions: u32,
}

impl AnimalMemory {
    pub fn new() -> Self {
        Self {
            prev_state: 0,
            prev_action: 8, // STAY
            reward: 0.0,
            initialized: false,
            fear: 0.0,
            lifetime_decisions: 0,
        }
    }
}

impl Default for AnimalMemory {
    fn default() -> Self {
        Self::new()
    }
}
