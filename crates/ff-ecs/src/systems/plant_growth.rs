//! Plant growth system: the core game mechanic.
//!
//! Growth rate per tick:
//!   growth = base_rate
//!          * soil_factor(N, P, K, organic_matter)
//!          * water_factor(soil_moisture, species.water_need)
//!          * light_factor(sunlight, shade_tolerance)
//!          * temp_factor(temperature, frost_tolerance)
//!          * companion_factor(nearby_companions)
//!          * mycorrhizal_bonus(soil.mycorrhizal_network)

use crate::components::plant::{GrowthStage, Harvestable, Plant};
use crate::components::soil::SoilGrid;
use crate::components::transform::Position;
use crate::resources::calendar::Season;
use crate::Resources;

pub fn run(world: &mut hecs::World, resources: &Resources, soil_grid: &SoilGrid) {
    let weather = &resources.weather;
    let calendar = &resources.calendar;
    let species_db = &resources.species_db;
    let tick = calendar.tick.0 as u32;

    for (_entity, (plant, pos)) in world.query_mut::<(&mut Plant, &Position)>() {
        if plant.growth_stage == GrowthStage::Dead {
            continue;
        }

        plant.age_ticks += 1;

        let Some(species) = species_db.get_plant(plant.species_id) else {
            continue;
        };

        // Sample soil at plant position
        let sx = (pos.0.x as usize).min(soil_grid.width.saturating_sub(1));
        let sz = (pos.0.z as usize).min(soil_grid.depth.saturating_sub(1));
        let soil = soil_grid.surface(sx, sz);

        // --- Compute growth factors (each 0.0..2.0, 1.0 = ideal) ---

        // Soil nutrient factor: average of NPK satisfaction
        let n_sat = (soil.nitrogen / (species.nutrient_need.nitrogen * 100.0 + 1.0)).min(2.0);
        let p_sat = (soil.phosphorus / (species.nutrient_need.phosphorus * 100.0 + 1.0)).min(2.0);
        let k_sat = (soil.potassium / (species.nutrient_need.potassium * 100.0 + 1.0)).min(2.0);
        let soil_factor = ((n_sat + p_sat + k_sat) / 3.0).max(0.1);

        // Water factor: bell curve around ideal moisture
        let moisture_diff = (soil.moisture - species.water_need).abs();
        let water_factor = (1.0 - moisture_diff * 2.0).max(0.1).min(2.0);

        // Light factor: sunlight vs shade tolerance
        let light_factor = if weather.sunlight > 0.5 {
            // Bright: sun-loving plants thrive, shade-tolerant are ok
            1.0 + (1.0 - species.shade_tolerance) * 0.5
        } else if weather.sunlight > 0.1 {
            // Partial shade: shade-tolerant plants do well
            0.5 + species.shade_tolerance
        } else {
            // Night: minimal growth
            0.1
        };

        // Temperature factor
        let temp_factor = if weather.temperature < 0.0 {
            // Frost: only frost-tolerant plants survive
            species.frost_tolerance
        } else if weather.temperature > 40.0 {
            // Heat stress
            0.3
        } else {
            // Normal range: peak at 20-25C
            let ideal_diff = ((weather.temperature - 22.0) / 15.0).abs();
            (1.5 - ideal_diff).max(0.3).min(1.5)
        };

        // Mycorrhizal bonus
        let myc_bonus = 1.0 + soil.mycorrhizal_network * 0.3;

        // pH factor: penalty outside preferred range
        let ph_factor = if soil.ph >= species.preferred_ph_min && soil.ph <= species.preferred_ph_max
        {
            1.0
        } else {
            0.5
        };

        // Combined growth
        let growth = species.growth_rate
            * soil_factor
            * water_factor
            * light_factor
            * temp_factor
            * myc_bonus
            * ph_factor;

        plant.growth_points += growth;

        // Health: declines if conditions are very poor
        if soil_factor < 0.3 || water_factor < 0.3 {
            plant.health = (plant.health - 0.001).max(0.0);
        } else {
            plant.health = (plant.health + 0.0005).min(1.0);
        }

        // Stage transitions
        let old_stage = plant.growth_stage;
        plant.growth_stage = match plant.growth_stage {
            GrowthStage::Seed if plant.growth_points >= 100.0 => GrowthStage::Germinating,
            GrowthStage::Germinating if plant.growth_points >= 500.0 => GrowthStage::Seedling,
            GrowthStage::Seedling if plant.growth_points >= 2000.0 => GrowthStage::Juvenile,
            GrowthStage::Juvenile if plant.growth_points >= species.maturity_threshold => {
                GrowthStage::Mature
            }
            GrowthStage::Mature => {
                // Transition to fruiting in appropriate season
                match calendar.season {
                    Season::Spring | Season::Summer => GrowthStage::Fruiting,
                    _ => GrowthStage::Mature,
                }
            }
            GrowthStage::Fruiting => {
                // Return to mature after fruiting period (500 ticks)
                if plant.age_ticks % 500 == 0 {
                    GrowthStage::Mature
                } else {
                    GrowthStage::Fruiting
                }
            }
            GrowthStage::Dormant => {
                // Wake up in spring
                if calendar.season == Season::Spring {
                    GrowthStage::Mature
                } else {
                    GrowthStage::Dormant
                }
            }
            other => {
                // Deciduous dormancy in winter
                if calendar.season == Season::Winter && species.frost_tolerance < 0.5 {
                    GrowthStage::Dormant
                } else {
                    other
                }
            }
        };

        // Death
        if plant.health <= 0.0 {
            plant.growth_stage = GrowthStage::Dead;
        }

        let _ = (old_stage, tick); // suppress unused warnings
    }

    // Update harvestable cooldowns
    for (_entity, (plant, harvestable)) in world.query_mut::<(&Plant, &mut Harvestable)>() {
        if plant.growth_stage == GrowthStage::Fruiting
            && tick.saturating_sub(harvestable.last_harvest_tick) > harvestable.cooldown_ticks
        {
            // Ready to harvest again (handled by interaction system)
        }
    }
}
