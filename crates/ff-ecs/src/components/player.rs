use ff_common::PlayerId;
use serde::{Deserialize, Serialize};

/// Marker + session data for player-controlled entities.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Player {
    pub player_id: PlayerId,
    pub session_id: u64,
    pub last_input_seq: u32,
}

/// Player inventory.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Inventory {
    pub slots: Vec<ItemStack>,
}

impl Inventory {
    pub fn new() -> Self {
        Self { slots: Vec::new() }
    }

    /// Add items, stacking with existing if possible.
    pub fn add(&mut self, item_id: u16, count: u16) {
        for slot in &mut self.slots {
            if slot.item_id == item_id {
                slot.count = slot.count.saturating_add(count);
                return;
            }
        }
        self.slots.push(ItemStack { item_id, count });
    }

    /// Remove items. Returns true if successful.
    pub fn remove(&mut self, item_id: u16, count: u16) -> bool {
        for slot in &mut self.slots {
            if slot.item_id == item_id && slot.count >= count {
                slot.count -= count;
                if slot.count == 0 {
                    self.slots.retain(|s| s.count > 0);
                }
                return true;
            }
        }
        false
    }

    pub fn has(&self, item_id: u16, count: u16) -> bool {
        self.slots
            .iter()
            .any(|s| s.item_id == item_id && s.count >= count)
    }
}

impl Default for Inventory {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct ItemStack {
    pub item_id: u16,
    pub count: u16,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Stamina(pub f32);

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Hunger(pub f32);

/// FoFo Coin balance — the soft currency. Earned by selling produce and
/// game meat, spent later on trades or upgrades.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default)]
pub struct Wallet(pub u32);

/// Marker + resources for the Tech-Monarch role (only attachable in
/// Realistic mode). The Monarch does not farm directly; instead they
/// pay `compute` to deploy semi-AI workers that harvest fruiting plants
/// in their place, accruing `influence` per successful harvest.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Monarch {
    /// 0..100. Spent to deploy AI workers (20 per deployment). Regenerates
    /// passively (~0.5 per tick = 10/s).
    pub compute: f32,
    /// 0..100. Soft prestige meter — each successful AI harvest grants +1.
    /// Currently informational; future decisions (price manipulation, mass
    /// layoffs) will be gated on minimum influence.
    pub influence: f32,
    /// Lifetime count of AI workers this monarch has deployed.
    pub deployments: u32,
    /// Lifetime count of plants auto-harvested by this monarch's AI fleet
    /// — i.e. "jobs cut" from the farmer player perspective.
    pub jobs_cut: u32,
}

impl Default for Monarch {
    fn default() -> Self {
        Self {
            compute: 100.0,
            influence: 0.0,
            deployments: 0,
            jobs_cut: 0,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct PlayerSkills {
    pub logging: f32,
    pub agility: f32,
    pub tool_quality: f32,
}

impl Default for PlayerSkills {
    fn default() -> Self {
        Self {
            logging: 0.1,
            agility: 0.3,
            tool_quality: 0.2,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Dead {
    pub death_tick: u64,
    pub cause: DeathCause,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum DeathCause {
    CrushedByTree,
    Starvation,
    Wildfire,
}
