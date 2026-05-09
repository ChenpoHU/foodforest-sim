//! ff-protocol: Network message types and binary codec for client-server communication.

pub mod codec;
pub mod messages;

pub use codec::{decode, encode, ProtocolError};
pub use messages::*;
