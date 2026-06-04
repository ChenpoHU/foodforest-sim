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
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Monarch {
    /// 0..100. Spent to deploy AI workers (20 per deployment). Regenerates
    /// passively (~0.5 per tick = 10/s).
    pub compute: f32,
    /// 0..100. Soft prestige meter — each successful AI harvest grants +1.
    pub influence: f32,
    /// Lifetime count of AI workers this monarch has deployed.
    pub deployments: u32,
    /// Lifetime count of plants auto-harvested by this monarch's AI fleet
    /// — i.e. "jobs cut" from the farmer player perspective.
    pub jobs_cut: u32,
    /// 0..100. Each Farmer revolt vote adds `DISCONTENT_PER_REVOLT`.
    /// Reaching `DISCONTENT_DEMOTION_THRESHOLD` triggers automatic
    /// demotion back to Farmer.
    pub discontent: f32,
    /// 0..100. Grows with deployments and successful auto-harvests by
    /// this monarch's drones. Reaching `AI_TAKEOVER_THRESHOLD` triggers
    /// an AI takeover — the Monarch is demoted to Farmer and a global
    /// announcement is broadcast.
    pub ai_intelligence: f32,
    /// PlayerIds (as u64) of every Farmer who has already revolted
    /// against this Monarch — prevents one player from grinding
    /// discontent up alone.
    pub revolt_voters: Vec<u64>,
}

/// Marker + resources for the Innovator role. Distributed human
/// ingenuity, designed as the counterweight to TechMonarch's
/// centralised AI: each catastrophe needs a different specialised
/// insight, and the Innovator builds that knowledge per topic. When a
/// global catastrophe is active they can spend Knowledge to deploy a
/// matching Breakthrough that ends the crisis.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Innovator {
    /// 0..100. Accumulated by `Research` actions. Spent on
    /// `DeployBreakthrough` to end a matching catastrophe.
    pub knowledge: f32,
    /// Lifetime count of breakthroughs this player has deployed —
    /// purely informational, for the dashboard / surveillance feed.
    pub breakthroughs: u32,
    /// Which Topic the Innovator most recently researched (used to
    /// drive small per-topic bonuses + visualised on the HUD).
    ///   0 = Climate, 1 = Medicine, 2 = Defense, 3 = Food
    pub focus_topic: u8,
}

impl Default for Innovator {
    fn default() -> Self {
        Self { knowledge: 0.0, breakthroughs: 0, focus_topic: 0 }
    }
}

/// Knowledge gained per Research action.
pub const RESEARCH_GAIN: f32 = 8.0;
/// Knowledge cap.
pub const KNOWLEDGE_CAP: f32 = 100.0;
/// Knowledge cost to deploy a Breakthrough.
pub const BREAKTHROUGH_COST: f32 = 30.0;

/// Marks a player entity driven by an AI agent rather than a human. AI
/// players are first-class — they pick a role like anyone else. `label`
/// names the controller (the game's own learning-agent build, e.g.
/// "sylva-rl-v1"); deliberately never a market LLM, since this game runs
/// its own lean online-learning AI. The native AI systems query for this
/// component to know which entities they may pilot, and the surveillance
/// roster / nameplates tag these players with 🤖.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AiControlled {
    pub label: String,
}

/// Worn outfit, crafted from gathered materials. 0 = default clothes.
/// Drives the avatar's appearance (and, with the seasons system, could
/// gate cold resistance later).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default)]
pub struct Outfit(pub u8); // 0 default, 1 Linen Tunic, 2 Fur Coat

/// Crafting material item ids + recipe costs.
pub const ITEM_HIDE: u16 = 3000;   // dropped by hunting animals
pub const ITEM_FIBER: u16 = 3001;  // gathered when harvesting plants
pub const TUNIC_FIBER_COST: u16 = 5;
pub const COAT_HIDE_COST: u16 = 4;

/// Coin cost a Farmer must pay (and lose) to ascend to Tech-Monarch.
pub const MONARCH_ASCENSION_COST: u32 = 500;
/// Discontent points added per Farmer revolt vote.
pub const DISCONTENT_PER_REVOLT: f32 = 25.0;
/// Discontent reading that triggers automatic demotion.
pub const DISCONTENT_DEMOTION_THRESHOLD: f32 = 100.0;
/// AI-intelligence reading that triggers an AI takeover.
pub const AI_TAKEOVER_THRESHOLD: f32 = 100.0;
/// Per-deployment intelligence bump.
pub const AI_INT_PER_DEPLOY: f32 = 4.0;
/// Per-auto-harvest intelligence bump (drone successfully harvested).
pub const AI_INT_PER_HARVEST: f32 = 1.0;

impl Default for Monarch {
    fn default() -> Self {
        Self {
            compute: 100.0,
            influence: 0.0,
            deployments: 0,
            jobs_cut: 0,
            discontent: 0.0,
            ai_intelligence: 0.0,
            revolt_voters: Vec::new(),
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
