use crate::components::plant::{CompanionEffect, ForestLayer, NutrientUptake};
use serde::{Deserialize, Serialize};

/// Database of all plant and animal species definitions.
pub struct SpeciesDb {
    pub plants: Vec<PlantSpecies>,
    pub animals: Vec<AnimalSpecies>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlantSpecies {
    pub id: u16,
    pub name: String,
    pub layer: ForestLayer,
    /// Base growth points per tick under ideal conditions.
    pub growth_rate: f32,
    /// Growth points needed to reach Mature stage.
    pub maturity_threshold: f32,
    /// Water need (0.0..1.0, where 1.0 = very thirsty).
    pub water_need: f32,
    /// Ideal nutrient uptake rates.
    pub nutrient_need: NutrientUptake,
    /// Preferred soil pH range.
    pub preferred_ph_min: f32,
    pub preferred_ph_max: f32,
    /// Shade tolerance (0.0 = needs full sun, 1.0 = thrives in shade).
    pub shade_tolerance: f32,
    /// Frost tolerance (0.0 = dies at first frost, 1.0 = hardy).
    pub frost_tolerance: f32,
    /// Companion planting effects on other species.
    pub companions: Vec<CompanionEffect>,
    /// Visual: max height in voxels when mature.
    pub max_height_voxels: u8,
    /// Root depth in soil layers.
    pub root_depth_voxels: u8,
    /// Canopy / spread radius in voxels.
    pub canopy_radius_voxels: u8,
    /// Item ID yielded when harvested.
    pub harvest_item_id: u16,
    /// Typical yield per harvest.
    pub harvest_amount: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnimalSpecies {
    pub id: u16,
    pub name: String,
    /// Movement speed in voxels per second.
    pub speed: f32,
    /// What does it eat? (plant species IDs, or 0 for omnivore).
    pub diet: Vec<u16>,
    /// Does it provide ecosystem services?
    pub ecosystem_service: EcosystemService,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum EcosystemService {
    None,
    /// Chickens: reduce compaction, add organic matter.
    SoilScratching,
    /// Ducks: eat slugs/pests.
    PestControl,
    /// Bees: pollinate flowering plants, increase yield.
    Pollination,
    /// Earthworms: improve soil structure.
    SoilAeration,
}

impl SpeciesDb {
    /// Create a default species database with Mediterranean food forest species.
    pub fn new_default() -> Self {
        Self {
            plants: default_plants(),
            animals: default_animals(),
        }
    }

    pub fn get_plant(&self, id: u16) -> Option<&PlantSpecies> {
        self.plants.iter().find(|p| p.id == id)
    }

    pub fn get_animal(&self, id: u16) -> Option<&AnimalSpecies> {
        self.animals.iter().find(|a| a.id == id)
    }
}

fn default_plants() -> Vec<PlantSpecies> {
    vec![
        // === CANOPY (Layer 0) ===
        PlantSpecies {
            id: 100,
            name: "Chestnut".into(),
            layer: ForestLayer::Canopy,
            growth_rate: 0.8,
            maturity_threshold: 80_000.0,
            water_need: 0.5,
            nutrient_need: NutrientUptake { nitrogen: 0.3, phosphorus: 0.2, potassium: 0.2 },
            preferred_ph_min: 5.5, preferred_ph_max: 6.5,
            shade_tolerance: 0.2, frost_tolerance: 0.7,
            companions: vec![],
            max_height_voxels: 12, root_depth_voxels: 4, canopy_radius_voxels: 6,
            harvest_item_id: 1100, harvest_amount: 20,
        },
        PlantSpecies {
            id: 101,
            name: "Walnut".into(),
            layer: ForestLayer::Canopy,
            growth_rate: 0.6,
            maturity_threshold: 100_000.0,
            water_need: 0.4,
            nutrient_need: NutrientUptake { nitrogen: 0.3, phosphorus: 0.15, potassium: 0.25 },
            preferred_ph_min: 6.0, preferred_ph_max: 7.5,
            shade_tolerance: 0.1, frost_tolerance: 0.6,
            companions: vec![],
            max_height_voxels: 15, root_depth_voxels: 4, canopy_radius_voxels: 8,
            harvest_item_id: 1101, harvest_amount: 15,
        },
        PlantSpecies {
            id: 102,
            name: "Carob".into(),
            layer: ForestLayer::Canopy,
            growth_rate: 0.5,
            maturity_threshold: 90_000.0,
            water_need: 0.2,
            nutrient_need: NutrientUptake { nitrogen: 0.15, phosphorus: 0.1, potassium: 0.1 },
            preferred_ph_min: 6.5, preferred_ph_max: 8.5,
            shade_tolerance: 0.1, frost_tolerance: 0.3,
            companions: vec![],
            max_height_voxels: 10, root_depth_voxels: 3, canopy_radius_voxels: 5,
            harvest_item_id: 1102, harvest_amount: 25,
        },
        // === UNDERSTORY (Layer 1) ===
        PlantSpecies {
            id: 200,
            name: "Fig".into(),
            layer: ForestLayer::Understory,
            growth_rate: 1.2,
            maturity_threshold: 30_000.0,
            water_need: 0.4,
            nutrient_need: NutrientUptake { nitrogen: 0.2, phosphorus: 0.15, potassium: 0.2 },
            preferred_ph_min: 6.0, preferred_ph_max: 8.0,
            shade_tolerance: 0.4, frost_tolerance: 0.3,
            companions: vec![],
            max_height_voxels: 6, root_depth_voxels: 3, canopy_radius_voxels: 4,
            harvest_item_id: 1200, harvest_amount: 30,
        },
        PlantSpecies {
            id: 201,
            name: "Pomegranate".into(),
            layer: ForestLayer::Understory,
            growth_rate: 1.0,
            maturity_threshold: 25_000.0,
            water_need: 0.3,
            nutrient_need: NutrientUptake { nitrogen: 0.15, phosphorus: 0.1, potassium: 0.15 },
            preferred_ph_min: 5.5, preferred_ph_max: 7.5,
            shade_tolerance: 0.3, frost_tolerance: 0.4,
            companions: vec![],
            max_height_voxels: 5, root_depth_voxels: 2, canopy_radius_voxels: 3,
            harvest_item_id: 1201, harvest_amount: 15,
        },
        PlantSpecies {
            id: 202,
            name: "Citrus (Orange)".into(),
            layer: ForestLayer::Understory,
            growth_rate: 0.9,
            maturity_threshold: 35_000.0,
            water_need: 0.5,
            nutrient_need: NutrientUptake { nitrogen: 0.25, phosphorus: 0.15, potassium: 0.3 },
            preferred_ph_min: 6.0, preferred_ph_max: 7.0,
            shade_tolerance: 0.2, frost_tolerance: 0.2,
            companions: vec![],
            max_height_voxels: 5, root_depth_voxels: 2, canopy_radius_voxels: 3,
            harvest_item_id: 1202, harvest_amount: 25,
        },
        // === SHRUB (Layer 2) ===
        PlantSpecies {
            id: 300,
            name: "Rosemary".into(),
            layer: ForestLayer::Shrub,
            growth_rate: 2.0,
            maturity_threshold: 8_000.0,
            water_need: 0.15,
            nutrient_need: NutrientUptake { nitrogen: 0.05, phosphorus: 0.05, potassium: 0.05 },
            preferred_ph_min: 6.0, preferred_ph_max: 8.0,
            shade_tolerance: 0.3, frost_tolerance: 0.5,
            companions: vec![
                CompanionEffect { target_species: 202, growth_modifier: 0.1, pest_resistance: 0.2, radius: 4.0 },
            ],
            max_height_voxels: 2, root_depth_voxels: 1, canopy_radius_voxels: 1,
            harvest_item_id: 1300, harvest_amount: 5,
        },
        PlantSpecies {
            id: 301,
            name: "Lavender".into(),
            layer: ForestLayer::Shrub,
            growth_rate: 1.8,
            maturity_threshold: 7_000.0,
            water_need: 0.1,
            nutrient_need: NutrientUptake { nitrogen: 0.03, phosphorus: 0.03, potassium: 0.03 },
            preferred_ph_min: 6.5, preferred_ph_max: 8.5,
            shade_tolerance: 0.1, frost_tolerance: 0.6,
            companions: vec![],
            max_height_voxels: 1, root_depth_voxels: 1, canopy_radius_voxels: 1,
            harvest_item_id: 1301, harvest_amount: 10,
        },
        // === HERBACEOUS (Layer 3) ===
        PlantSpecies {
            id: 400,
            name: "Comfrey".into(),
            layer: ForestLayer::Herbaceous,
            growth_rate: 3.0,
            maturity_threshold: 4_000.0,
            water_need: 0.4,
            nutrient_need: NutrientUptake { nitrogen: 0.1, phosphorus: 0.05, potassium: 0.15 },
            preferred_ph_min: 6.0, preferred_ph_max: 7.5,
            shade_tolerance: 0.7,
            frost_tolerance: 0.8,
            companions: vec![
                // Comfrey is a dynamic accumulator — benefits all nearby plants
                CompanionEffect { target_species: 0, growth_modifier: 0.15, pest_resistance: 0.0, radius: 3.0 },
            ],
            max_height_voxels: 1, root_depth_voxels: 3, canopy_radius_voxels: 1,
            harvest_item_id: 1400, harvest_amount: 8,
        },
        // === GROUND COVER (Layer 4) ===
        PlantSpecies {
            id: 500,
            name: "White Clover".into(),
            layer: ForestLayer::GroundCover,
            growth_rate: 4.0,
            maturity_threshold: 2_000.0,
            water_need: 0.3,
            nutrient_need: NutrientUptake { nitrogen: 0.0, phosphorus: 0.05, potassium: 0.05 },
            preferred_ph_min: 6.0, preferred_ph_max: 7.0,
            shade_tolerance: 0.5, frost_tolerance: 0.8,
            companions: vec![
                // Nitrogen fixer — benefits all nearby plants
                CompanionEffect { target_species: 0, growth_modifier: 0.1, pest_resistance: 0.0, radius: 2.0 },
            ],
            max_height_voxels: 0, root_depth_voxels: 1, canopy_radius_voxels: 2,
            harvest_item_id: 0, harvest_amount: 0, // not harvested directly
        },
        PlantSpecies {
            id: 501,
            name: "Strawberry".into(),
            layer: ForestLayer::GroundCover,
            growth_rate: 2.5,
            maturity_threshold: 3_000.0,
            water_need: 0.5,
            nutrient_need: NutrientUptake { nitrogen: 0.1, phosphorus: 0.1, potassium: 0.15 },
            preferred_ph_min: 5.5, preferred_ph_max: 6.5,
            shade_tolerance: 0.3, frost_tolerance: 0.5,
            companions: vec![],
            max_height_voxels: 0, root_depth_voxels: 1, canopy_radius_voxels: 1,
            harvest_item_id: 1501, harvest_amount: 10,
        },
        // === VINE (Layer 6) ===
        PlantSpecies {
            id: 600,
            name: "Grape Vine".into(),
            layer: ForestLayer::Vine,
            growth_rate: 2.0,
            maturity_threshold: 15_000.0,
            water_need: 0.3,
            nutrient_need: NutrientUptake { nitrogen: 0.1, phosphorus: 0.1, potassium: 0.2 },
            preferred_ph_min: 5.5, preferred_ph_max: 7.0,
            shade_tolerance: 0.2, frost_tolerance: 0.4,
            companions: vec![],
            max_height_voxels: 4, root_depth_voxels: 2, canopy_radius_voxels: 2,
            harvest_item_id: 1600, harvest_amount: 20,
        },
        // === ROOT (Layer 5) ===
        PlantSpecies {
            id: 700,
            name: "Jerusalem Artichoke".into(),
            layer: ForestLayer::Root,
            growth_rate: 3.5,
            maturity_threshold: 5_000.0,
            water_need: 0.3,
            nutrient_need: NutrientUptake { nitrogen: 0.05, phosphorus: 0.05, potassium: 0.1 },
            preferred_ph_min: 6.0, preferred_ph_max: 7.5,
            shade_tolerance: 0.3, frost_tolerance: 0.9,
            companions: vec![],
            max_height_voxels: 2, root_depth_voxels: 2, canopy_radius_voxels: 1,
            harvest_item_id: 1700, harvest_amount: 12,
        },
    ]
}

fn default_animals() -> Vec<AnimalSpecies> {
    vec![
        AnimalSpecies {
            id: 10,
            name: "Chicken".into(),
            speed: 2.0,
            diet: vec![500, 501], // eats ground cover
            ecosystem_service: EcosystemService::SoilScratching,
        },
        AnimalSpecies {
            id: 11,
            name: "Duck".into(),
            speed: 2.5,
            diet: vec![],
            ecosystem_service: EcosystemService::PestControl,
        },
        AnimalSpecies {
            id: 12,
            name: "Honeybee Colony".into(),
            speed: 5.0,
            diet: vec![],
            ecosystem_service: EcosystemService::Pollination,
        },
        AnimalSpecies {
            id: 20,
            name: "Wild Boar".into(),
            speed: 4.0,
            diet: vec![700, 501], // digs roots, eats fruit
            ecosystem_service: EcosystemService::SoilAeration,
        },
        AnimalSpecies {
            id: 21,
            name: "Deer".into(),
            speed: 6.0,
            diet: vec![400, 300], // browses herbs and shrubs
            ecosystem_service: EcosystemService::None,
        },
    ]
}
