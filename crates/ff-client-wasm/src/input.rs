//! Input state management.
//! Keyboard/mouse/touch state is captured in JavaScript and passed to WASM
//! via the build_input_message() function.

/// Input state (tracked in JS, passed per-frame to WASM).
pub struct InputState {
    pub move_x: f32,
    pub move_z: f32,
    pub yaw: f32,
    pub jump: bool,
    pub sprint: bool,
}

impl Default for InputState {
    fn default() -> Self {
        Self {
            move_x: 0.0,
            move_z: 0.0,
            yaw: 0.0,
            jump: false,
            sprint: false,
        }
    }
}
