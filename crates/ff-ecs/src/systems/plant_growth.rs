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

/// Per-plant interaction pressure accumulated from neighbors.
struct InteractionPressure {
    growth: f32,
    water: f32,
    nutrient: f32,
}

pub fn run(world: &mut hecs::World, resources: &Resources, soil_grid: &SoilGrid) {
    let weather = &resources.weather;
    let calendar = &resources.calendar;
    let species_db = &resources.species_db;
    let tick = calendar.tick.0 as u32;

    // Phase 1: collect positions + species for interaction lookup (every 20 ticks)
    let do_interactions = tick % 20 == 0;
    let mut neighbor_data: Vec<(glam::Vec3, u16)> = Vec::new();
    if do_interactions {
        for (_e, (pos, plant)) in world.query::<(&Position, &Plant)>().iter() {
            if plant.growth_stage != GrowthStage::Dead {
                neighbor_data.push((pos.0, plant.species_id));
            }
        }
    }

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

        // --- Compute interaction pressure from neighbors ---
        let mut pressure = InteractionPressure { growth: 0.0, water: 0.0, nutrient: 0.0 };
        if do_interactions {
            for &(npos, nspecies) in &neighbor_data {
                if nspecies == plant.species_id && (npos - pos.0).length_squared() < 0.01 {
                    continue; // skip self
                }
                let Some(nspec) = species_db.get_plant(nspecies) else { continue };
                let dist = (npos - pos.0).length();
                for fx in &nspec.interactions {
                    if dist > fx.radius { continue; }
                    if fx.target_species != 0 && fx.target_species != plant.species_id { continue; }
                    let falloff = 1.0 - (dist / fx.radius);
                    pressure.growth += fx.growth_modifier * falloff;
                    pressure.water += fx.water_modifier * falloff;
                    pressure.nutrient += fx.nutrient_modifier * falloff;
                }
            }
        }

        // --- Compute growth factors (each 0.0..2.0, 1.0 = ideal) ---

        // Soil nutrient factor — adjusted by neighbor nutrient pressure
        let nutrient_mod = (1.0 + pressure.nutrient).max(0.1);
        let n_sat = (soil.nitrogen / (species.nutrient_need.nitrogen * 100.0 + 1.0)).min(2.0);
        let p_sat = (soil.phosphorus / (species.nutrient_need.phosphorus * 100.0 + 1.0)).min(2.0);
        let k_sat = (soil.potassium / (species.nutrient_need.potassium * 100.0 + 1.0)).min(2.0);
        let soil_factor = (((n_sat + p_sat + k_sat) / 3.0) * nutrient_mod).max(0.1);

        // Water factor — adjusted by neighbor water pressure (eucalyptus drains)
        let effective_moisture = (soil.moisture + pressure.water).max(0.0).min(1.0);
        let moisture_diff = (effective_moisture - species.water_need).abs();
        let water_factor = (1.0 - moisture_diff * 2.0).max(0.1).min(2.0);

        // Light factor: sunlight vs shade tolerance
        let light_factor = if weather.sunlight > 0.5 {
            1.0 + (1.0 - species.shade_tolerance) * 0.5
        } else if weather.sunlight > 0.1 {
            0.5 + species.shade_tolerance
        } else {
            0.1
        };

        // Temperature factor
        let temp_factor = if weather.temperature < 0.0 {
            species.frost_tolerance
        } else if weather.temperature > 40.0 {
            0.3
        } else {
            let ideal_diff = ((weather.temperature - 22.0) / 15.0).abs();
            (1.5 - ideal_diff).max(0.3).min(1.5)
        };

        // Mycorrhizal bonus
        let myc_bonus = 1.0 + soil.mycorrhizal_network * 0.3;

        // pH factor
        let ph_factor = if soil.ph >= species.preferred_ph_min && soil.ph <= species.preferred_ph_max
        {
            1.0
        } else {
            0.5
        };

        // Interaction growth modifier (allelopathy / companion bonus)
        let interaction_factor = (1.0 + pressure.growth).max(0.05);

        // Combined growth
        let growth = species.growth_rate
            * soil_factor
            * water_factor
            * light_factor
            * temp_factor
            * myc_bonus
            * ph_factor
            * interaction_factor;

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
