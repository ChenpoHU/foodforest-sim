//! Client-side prediction: apply inputs immediately, reconcile on server ack.

use ff_common::Tick;

/// A recorded input for prediction reconciliation.
#[derive(Debug, Clone)]
pub struct PredictedInput {
    pub seq: u32,
    pub tick: Tick,
    pub move_dir: [f32; 2],
    pub yaw: f32,
    pub jump: bool,
    pub sprint: bool,
}

/// Prediction buffer: stores unacknowledged inputs.
pub struct PredictionBuffer {
    pub inputs: Vec<PredictedInput>,
}

impl PredictionBuffer {
    pub fn new() -> Self {
        Self { inputs: Vec::new() }
    }

    /// Record a new input.
    pub fn push(&mut self, input: PredictedInput) {
        self.inputs.push(input);
    }

    /// Server acknowledged up to this sequence — discard older inputs.
    pub fn acknowledge(&mut self, seq: u32) {
        self.inputs.retain(|i| i.seq > seq);
    }

    /// Replay unacknowledged inputs to compute predicted position.
    pub fn replay(&self, base_pos: [f32; 3], dt: f32) -> [f32; 3] {
        let mut pos = base_pos;
        for input in &self.inputs {
            let speed = if input.sprint { 8.0 } else { 5.0 };
            pos[0] += input.move_dir[0] * speed * dt;
            pos[2] += input.move_dir[1] * speed * dt;
        }
        pos
    }
}

impl Default for PredictionBuffer {
    fn default() -> Self {
        Self::new()
    }
}
