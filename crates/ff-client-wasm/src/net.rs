//! WebSocket wrapper (JS-side integration).
//! The actual WebSocket is created in JavaScript; this module provides
//! helper types for the WASM-JS bridge.

/// Connection state tracked on the Rust side.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectionState {
    Disconnected,
    Connecting,
    Connected,
    Error,
}
