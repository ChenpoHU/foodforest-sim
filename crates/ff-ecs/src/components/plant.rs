use serde::{Deserialize, Serialize};

/// Core plant component — attached to every plant entity.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Plant {
    pub species_id: u16,
    pub growth_stage: GrowthStage,
    pub health: f32,
    pub age_ticks: u32,
    /// Accumulated growth points (drives stage transitions).
    pub growth_points: f32,
    pub water_stored: f32,
}

impl Plant {
    pub fn new_seed(species_id: u16) -> Self {
        Self {
            species_id,
            growth_stage: GrowthStage::Seed,
            health: 1.0,
            age_ticks: 0,
            growth_points: 0.0,
            water_stored: 0.0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u8)]
pub enum GrowthStage {
    Seed = 0,
    Germinating = 1,
    Seedling = 2,
    Juvenile = 3,
    Mature = 4,
    Fruiting = 5,
    Dormant = 6,
    Dead = 7,
}

/// Which vertical layer this plant occupies in the food forest.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u8)]
pub enum ForestLayer {
    Canopy = 0,      // tall trees: chestnut, walnut, carob
    Understory = 1,  // small trees: fig, pomegranate, citrus
    Shrub = 2,       // berry bushes, rosemary, lavender
    Herbaceous = 3,  // comfrey, yarrow, fennel
    GroundCover = 4, // clover, strawberry, creeping thyme
    Root = 5,        // potato, carrot, Jerusalem artichoke
    Vine = 6,        // grape, kiwi, passionfruit
}

/// Nutrient uptake rates (units per tick when conditions are ideal).
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct NutrientUptake {
    pub nitrogen: f32,
    pub phosphorus: f32,
    pub potassium: f32,
}

/// Plant interaction effect on nearby species — covers companion planting,
/// allelopathy, water competition, and nutrient dynamics.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct CompanionEffect {
    /// 0 = affects all species, otherwise a specific species id.
    pub target_species: u16,
    /// Growth multiplier: positive = beneficial, negative = antagonistic (allelopathy).
    pub growth_modifier: f32,
    /// Water impact on neighbors: negative = drains moisture (eucalyptus), positive = retains.
    pub water_modifier: f32,
    /// Nutrient impact on neighbors: negative = depletes, positive = enriches (nitrogen fixers).
    pub nutrient_modifier: f32,
    /// Pest resistance bonus (0.0..1.0).
    pub pest_resistance: f32,
    /// Effect radius in voxel units.
    pub radius: f32,
}

/// Marks a plant as harvestable and tracks harvest cooldown.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Harvestable {
    pub yield_item_id: u16,
    pub yield_amount: u16,
    pub cooldown_ticks: u32,
    pub last_harvest_tick: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FellingPhase {
    Cutting,
    Falling,
    Collapsed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TreeFelling {
    pub phase: FellingPhase,
    pub cutter_entity_id: u64,
    pub progress: f32,
    pub cut_threshold: f32,
    pub trunk_diameter: f32,
    pub tree_height: f32,
    pub wood_density: f32,
    pub root_stability: f32,
    pub fall_direction: [f32; 2],
    pub hazard_radius: f32,
    pub ticks_in_phase: u32,
}
