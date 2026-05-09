use glam::Vec3;
use serde::{Deserialize, Serialize};

/// NPC agent with a role and task queue.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NpcAgent {
    pub role: NpcRole,
    pub task_queue: Vec<NpcTask>,
    pub home_position: Vec3,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u8)]
pub enum NpcRole {
    Farmer = 0,
    Forester = 1,
    Herbalist = 2,
    Beekeeper = 3,
    Trader = 4,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum NpcTask {
    GoTo(Vec3),
    Plant {
        species_id: u16,
        position: Vec3,
    },
    Water {
        target_entity: u64,
    },
    Harvest {
        target_entity: u64,
    },
    Trade {
        with_player: u64,
    },
    Idle {
        ticks_remaining: u32,
    },
    /// Patrol between waypoints.
    Patrol {
        waypoints: Vec<Vec3>,
        current_index: usize,
    },
}
