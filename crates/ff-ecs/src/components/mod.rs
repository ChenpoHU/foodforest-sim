//! ECS components — data attached to entities.

pub mod ai_agent;
pub mod animal;
pub mod animal_brain;
pub mod identity;
pub mod physics;
pub mod plant;
pub mod player;
pub mod soil;
pub mod transform;

pub use ai_agent::*;
pub use animal::*;
pub use animal_brain::*;
pub use identity::*;
pub use physics::*;
pub use plant::*;
pub use player::*;
pub use soil::*;
pub use transform::*;
