//! Interaction system: processes player actions (plant, harvest, dig, water, build).
//! Driven by player input (not the tick loop).

use crate::components::identity::{NetworkId, Owner};
use crate::components::physics::{Collider, Grounded};
use crate::components::plant::{FellingPhase, GrowthStage, Harvestable, Plant, TreeFelling};
use crate::components::player::PlayerSkills;
use crate::components::transform::{Position, Rotation, Velocity};
use crate::Resources;
use ff_common::{EntityId, GameMode, PlayerId, VoxelMaterial};
use ff_protocol::ActionKind;
use ff_voxel::VoxelWorld;
use glam::Vec3;

/// Result of processing a player action.
pub enum ActionResult {
    Success(String),
    Failure(String),
    SuccessWithDespawn(String, EntityId),
}

/// Process a single player action. Returns success/failure for the client.
pub fn process_action(
    world: &mut hecs::World,
    terrain: &mut VoxelWorld,
    resources: &Resources,
    player_entity: hecs::Entity,
    player_id: PlayerId,
    action: &ActionKind,
    next_entity_id: &mut u64,
) -> ActionResult {
    // Get player position for range checks
    let player_pos = match world.get::<&Position>(player_entity) {
        Ok(p) => p.0,
        Err(_) => return ActionResult::Failure("Player entity not found".into()),
    };

    match action {
        ActionKind::PlantSeed { species_id, position } => {
            // Validate species exists
            let Some(species) = resources.species_db.get_plant(*species_id) else {
                return ActionResult::Failure("Unknown plant species".into());
            };

            // Plant at the click position, snapped to terrain height. We
            // accept the player's X/Z and let the terrain decide Y so the
            // sapling sits on the ground even on slopes.
            let [px, _py, pz] = *position;
            let plant_x = px;
            let plant_z = pz;
            let plant_y = terrain.spawn_height(plant_x, plant_z);

            // No distance limit on planting — if the player can click a
            // spot, they can plant there. Lets you lay out a food forest
            // freely without stepping to every tile.

            let id = *next_entity_id;
            *next_entity_id += 1;

            let harvestable =
                Harvestable::from_species(*species_id, species.harvest_item_id, species.harvest_amount);

            let entity = world.spawn((
                NetworkId(EntityId(id)),
                Owner(player_id),
                Position(Vec3::new(plant_x as f32, plant_y, plant_z as f32)),
                Rotation(0.0),
                Plant::new_seed(*species_id),
            ));

            if let Some(h) = harvestable {
                let _ = world.insert_one(entity, h);
            }

            ActionResult::Success(format!("Planted {} seed", species.name))
        }

        ActionKind::Harvest { entity_id } => {
            // Find the target entity and validate (two-pass to avoid borrow conflicts)
            let mut target_entity = None;
            for (entity, (net_id, _pos, plant)) in
                world.query_mut::<(&NetworkId, &Position, &Plant)>()
            {
                if net_id.0 == *entity_id {
                    // No distance check for harvesting — if the player can
                    // click it (it rendered on their screen), they can
                    // gather it. Only ripeness gates the action.
                    if plant.growth_stage != GrowthStage::Fruiting {
                        return ActionResult::Failure("Not ready to harvest".into());
                    }
                    target_entity = Some(entity);
                    break;
                }
            }

            let mut found = None;
            if let Some(te) = target_entity {
                if let Ok(mut harvestable) = world.get::<&mut Harvestable>(te) {
                    let tick = resources.calendar.tick.0 as u32;
                    if tick - harvestable.last_harvest_tick < harvestable.cooldown_ticks {
                        return ActionResult::Failure("Harvest on cooldown".into());
                    }
                    harvestable.last_harvest_tick = tick;
                    found = Some((harvestable.yield_item_id, harvestable.yield_amount));
                }
            }

            match found {
                Some((item_id, amount)) => {
                    if let Ok(mut inv) = world.get::<&mut crate::components::player::Inventory>(player_entity) {
                        inv.add(item_id, amount);
                        // Harvesting also yields plant fibre — the raw
                        // material for crafting cloth garments.
                        inv.add(crate::components::player::ITEM_FIBER, 1);
                    }
                    let name = resources.species_db.get_plant_by_item(item_id)
                        .unwrap_or("produce");
                    ActionResult::Success(format!("Harvested {} x{}", name, amount))
                }
                None => ActionResult::Failure("Nothing to harvest".into()),
            }
        }

        ActionKind::Dig { position } => {
            let [x, y, z] = *position;
            let dist = Vec3::new(x as f32, y as f32, z as f32) - player_pos;
            if dist.length() > 5.0 {
                return ActionResult::Failure("Too far away".into());
            }

            // Replace with air (dig) — drops the soil voxel
            if terrain.is_solid(x, y, z) {
                terrain.set(x, y, z, VoxelMaterial::Air);
                ActionResult::Success("Dug block".into())
            } else {
                ActionResult::Failure("Nothing to dig".into())
            }
        }

        ActionKind::Water { position, radius } => {
            let [x, _y, z] = *position;
            let r = (*radius as i32).min(5);
            // Watering is handled by directly modifying soil moisture
            // (actual soil grid modification would go here)
            let _ = (x, z, r);
            ActionResult::Success("Watered area".into())
        }

        ActionKind::BuildSwale { position, .. } => {
            let [x, y, z] = *position;
            let dist = Vec3::new(x as f32, y as f32, z as f32) - player_pos;
            if dist.length() > 15.0 {
                return ActionResult::Failure("Too far away — move closer".into());
            }

            terrain.set(x, y, z, VoxelMaterial::Swale);
            ActionResult::Success("Built swale".into())
        }

        ActionKind::BuildHugelBed { position } => {
            let [x, y, z] = *position;
            let dist = Vec3::new(x as f32, y as f32, z as f32) - player_pos;
            if dist.length() > 15.0 {
                return ActionResult::Failure("Too far away — move closer".into());
            }
            terrain.set(x, y, z, VoxelMaterial::HugelBed);
            ActionResult::Success("Built hugel bed".into())
        }

        ActionKind::AddMulch { position } => {
            let [x, y, z] = *position;
            terrain.set(x, y, z, VoxelMaterial::Mulch);
            ActionResult::Success("Added mulch".into())
        }

        ActionKind::CutTree { entity_id } => {
            let mut target_entity = None;
            let mut tree_pos = Vec3::ZERO;
            let mut species_id = 0u16;

            for (entity, (net_id, pos, plant)) in
                world.query_mut::<(&NetworkId, &Position, &Plant)>()
            {
                if net_id.0 == *entity_id {
                    let dist = (pos.0 - player_pos).length();
                    if dist > 10.0 {
                        return ActionResult::Failure("Too far away — move closer".into());
                    }
                    if plant.growth_stage == GrowthStage::Dead {
                        return ActionResult::Failure("Tree is already dead".into());
                    }
                    if plant.growth_stage == GrowthStage::Seed
                        || plant.growth_stage == GrowthStage::Germinating
                    {
                        return ActionResult::Failure("Too small to cut, pull the sprout instead".into());
                    }
                    target_entity = Some(entity);
                    tree_pos = pos.0;
                    species_id = plant.species_id;
                    break;
                }
            }

            let Some(te) = target_entity else {
                return ActionResult::Failure("No tree found".into());
            };

            let species = resources.species_db.get_plant(species_id);
            let name = species.map(|s| s.name.as_str()).unwrap_or("tree");

            if resources.game_mode == GameMode::Peaceful {
                let _ = world.despawn(te);
                return ActionResult::SuccessWithDespawn(format!("Removed {}", name), *entity_id);
            }

            if world.get::<&TreeFelling>(te).is_ok() {
                return ActionResult::Failure("Already being cut".into());
            }

            let growth_ratio = if let Ok(plant) = world.get::<&Plant>(te) {
                (plant.growth_points / species.map(|s| s.maturity_threshold).unwrap_or(50000.0))
                    .min(1.0)
                    .max(0.1)
            } else {
                1.0
            };
            let (height, density) = match species {
                Some(s) => (
                    s.max_height_voxels as f32 * growth_ratio,
                    if s.id == 103 { 0.7 } else { 1.0 },
                ),
                None => (8.0, 1.0),
            };

            let dir_to_player = Vec3::new(
                player_pos.x - tree_pos.x,
                0.0,
                player_pos.z - tree_pos.z,
            );
            let len = dir_to_player.length().max(0.01);
            let fall_away = [-dir_to_player.x / len, -dir_to_player.z / len];

            let wind = resources.weather.wind_speed;
            let stability = if wind > 10.0 { 0.6 } else { 0.9 };
            let trunk = height * 0.08 + 0.3;
            let cut_time = trunk * density * 20.0;

            let felling = TreeFelling {
                phase: FellingPhase::Cutting,
                cutter_entity_id: player_entity.id() as u64,
                progress: 0.0,
                cut_threshold: cut_time,
                trunk_diameter: trunk,
                tree_height: height,
                wood_density: density,
                root_stability: stability,
                fall_direction: fall_away,
                hazard_radius: height * 1.2,
                ticks_in_phase: 0,
            };

            let _ = world.insert_one(te, felling);
            ActionResult::Success(format!("Cutting {} (height {:.0})...", name, height))
        }

        ActionKind::Inspect { entity_id } => {
            for (entity, (net_id, pos)) in
                world.query_mut::<(&NetworkId, &Position)>()
            {
                if net_id.0 != *entity_id { continue; }

                if let Ok(plant) = world.get::<&Plant>(entity) {
                    let name = resources.species_db.get_plant(plant.species_id)
                        .map(|s| s.name.as_str()).unwrap_or("Unknown");
                    let stage = match plant.growth_stage {
                        GrowthStage::Seed => "Seed",
                        GrowthStage::Germinating => "Germinating",
                        GrowthStage::Seedling => "Seedling",
                        GrowthStage::Juvenile => "Juvenile",
                        GrowthStage::Mature => "Mature",
                        GrowthStage::Fruiting => "Fruiting",
                        GrowthStage::Dormant => "Dormant",
                        GrowthStage::Dead => "Dead",
                    };
                    let species = resources.species_db.get_plant(plant.species_id);
                    let max_gp = species.map(|s| s.maturity_threshold).unwrap_or(1.0);
                    let growth_pct = ((plant.growth_points / max_gp) * 100.0).min(100.0);
                    return ActionResult::Success(format!(
                        "INSPECT|plant|{}|{}|{:.0}%|{:.0}%|{}",
                        name, stage, plant.health * 100.0, growth_pct, plant.cut_count
                    ));
                }

                if let Ok(animal) = world.get::<&crate::components::animal::Animal>(entity) {
                    let name = resources.species_db.get_animal(animal.species_id)
                        .map(|s| s.name.as_str()).unwrap_or("Unknown");
                    let behavior = match &animal.behavior {
                        crate::components::animal::AnimalBehavior::Idle => "Idle",
                        crate::components::animal::AnimalBehavior::Wandering => "Wandering",
                        crate::components::animal::AnimalBehavior::Foraging => "Foraging",
                        crate::components::animal::AnimalBehavior::Fleeing { .. } => "Fleeing",
                        crate::components::animal::AnimalBehavior::Following { .. } => "Following",
                        crate::components::animal::AnimalBehavior::Sleeping => "Sleeping",
                        crate::components::animal::AnimalBehavior::Scratching => "Scratching",
                        crate::components::animal::AnimalBehavior::Pollinating => "Pollinating",
                        _ => "Active",
                    };
                    return ActionResult::Success(format!(
                        "INSPECT|animal|{}|{}|hunger:{:.0}%|energy:{:.0}%",
                        name, behavior, animal.hunger * 100.0, animal.energy * 100.0
                    ));
                }

                if let Ok(player) = world.get::<&crate::components::player::Player>(entity) {
                    let player_name = world.get::<&crate::components::identity::Name>(entity)
                        .map(|n| n.0.clone()).unwrap_or_else(|_| "Unknown".into());
                    let stamina = world.get::<&crate::components::player::Stamina>(entity)
                        .map(|s| s.0).unwrap_or(0.0);
                    let hunger = world.get::<&crate::components::player::Hunger>(entity)
                        .map(|h| h.0).unwrap_or(0.0);
                    return ActionResult::Success(format!(
                        "INSPECT|player|{}|stamina:{:.0}%|hunger:{:.0}%",
                        player_name, stamina, hunger
                    ));
                }

                return ActionResult::Success("INSPECT|unknown|Entity".into());
            }
            ActionResult::Failure("Entity not found".into())
        }

        ActionKind::HuntAnimal { entity_id } => {
            if resources.game_mode == GameMode::Peaceful {
                return ActionResult::Failure("Hunting is not allowed in peaceful mode".into());
            }

            let mut target_entity = None;
            let mut animal_name = String::new();
            let mut hunt_pos = Vec3::ZERO;

            for (entity, (net_id, pos, animal)) in
                world.query_mut::<(&NetworkId, &Position, &crate::components::animal::Animal)>()
            {
                if net_id.0 == *entity_id {
                    let dist = (pos.0 - player_pos).length();
                    if dist > 8.0 {
                        return ActionResult::Failure("Too far away".into());
                    }
                    animal_name = resources.species_db.get_animal(animal.species_id)
                        .map(|s| s.name.clone()).unwrap_or_else(|| "animal".into());
                    target_entity = Some(entity);
                    hunt_pos = pos.0;
                    break;
                }
            }

            let Some(te) = target_entity else {
                return ActionResult::Failure("No wild animal found".into());
            };

            if world.get::<&crate::components::animal::Domesticated>(te).is_ok() {
                return ActionResult::Failure("Cannot hunt a domesticated animal".into());
            }

            let _ = world.despawn(te);
            // Add meat + a hide (used to craft fur clothing) to inventory.
            if let Ok(mut inv) = world.get::<&mut crate::components::player::Inventory>(player_entity) {
                inv.add(2000, 3);
                inv.add(crate::components::player::ITEM_HIDE, 1);
            }

            // Witnessing a hunt teaches nearby wild animals to fear this area.
            // The brain's next update will credit `prev_action` with this
            // negative reward — so they learn which moves led to a player
            // being close. Domestic animals are spared the fear shock.
            if resources.game_mode == GameMode::Survival {
                broadcast_hunt_fear(world, hunt_pos);
            }

            ActionResult::SuccessWithDespawn(format!("Hunted {} (+3 meat)", animal_name), *entity_id)
        }

        ActionKind::BuildHochsitz { position } => {
            let [x, y, z] = *position;
            let dist = Vec3::new(x as f32, y as f32, z as f32) - player_pos;
            if dist.length() > 15.0 {
                return ActionResult::Failure("Too far away — move closer".into());
            }
            // Place the hochsitz as a structure entity
            let eid = EntityId(*next_entity_id);
            *next_entity_id += 1;
            world.spawn((
                NetworkId(eid),
                Position(Vec3::new(x as f32, y as f32 + 0.5, z as f32)),
                Rotation(0.0),
                crate::components::identity::Structure { kind: 1 },
            ));
            ActionResult::Success(format!("Built hunting stand (Hochsitz)"))
        }

        ActionKind::EatItem { item_id } => {
            let nutrition = eat_nutrition(*item_id);
            let mut inv = match world.get::<&mut crate::components::player::Inventory>(player_entity) {
                Ok(i) => i,
                Err(_) => return ActionResult::Failure("Inventory unavailable".into()),
            };
            if !inv.remove(*item_id, 1) {
                return ActionResult::Failure("You don't have any to eat".into());
            }
            drop(inv);
            if let Ok(mut hunger) = world.get::<&mut crate::components::player::Hunger>(player_entity) {
                hunger.0 = (hunger.0 - nutrition).max(0.0);
            }
            if let Ok(mut stamina) = world.get::<&mut crate::components::player::Stamina>(player_entity) {
                stamina.0 = (stamina.0 + nutrition * 0.5).min(100.0);
            }
            ActionResult::Success(format!("Ate 1 — restored {:.0}% fullness", nutrition))
        }

        ActionKind::GrantUbi { target_player_id, amount } => {
            // Tech-Monarch only. The actual fan-out across multiple
            // recipients is done by the WS layer (we don't have session
            // info here); this handler validates the Monarch and
            // performs the direct 1:1 transfer when the target is a
            // specific player. For "all farmers" mode (target=0) ws.rs
            // handles the multi-credit explicitly.
            if world.get::<&crate::components::player::Monarch>(player_entity).is_err() {
                return ActionResult::Failure("Only Tech Monarchs can wire UBI".into());
            }
            if *amount == 0 {
                return ActionResult::Failure("Amount must be greater than zero".into());
            }
            if *target_player_id == 0 {
                // Multi-recipient transfer is handled in ws.rs which has
                // access to the session map and ECS world. We just return
                // success here so ws.rs can perform the credit pass.
                return ActionResult::Success(format!(
                    "UBI dispatch queued: {} coins each",
                    amount
                ));
            }
            // Single-recipient direct transfer.
            let monarch_wallet_before = world
                .get::<&crate::components::player::Wallet>(player_entity)
                .map(|w| w.0)
                .unwrap_or(0);
            if monarch_wallet_before < *amount {
                return ActionResult::Failure(format!(
                    "Need {} coins (you have {})",
                    amount, monarch_wallet_before
                ));
            }
            // Find target entity.
            let mut target_entity = None;
            for (e, p) in world.query::<&crate::components::player::Player>().iter() {
                if p.player_id.0 == *target_player_id {
                    target_entity = Some(e);
                    break;
                }
            }
            let Some(te) = target_entity else {
                return ActionResult::Failure("Target player not found".into());
            };
            if te == player_entity {
                return ActionResult::Failure("Cannot wire UBI to yourself".into());
            }
            // Debit Monarch.
            if let Ok(mut w) = world.get::<&mut crate::components::player::Wallet>(player_entity) {
                w.0 = w.0.saturating_sub(*amount);
            }
            // Credit target.
            if let Ok(mut w) = world.get::<&mut crate::components::player::Wallet>(te) {
                w.0 = w.0.saturating_add(*amount);
            }
            // Monarch → Innovator support loop: if the recipient is an
            // Innovator, the grant is "research funding" — convert a
            // share of the coins into Knowledge. This gives the Monarch
            // (whose drones get wrecked by catastrophes) a concrete
            // reason to bankroll an Innovator who can end them.
            let mut funded_research = false;
            if let Ok(mut inv) = world.get::<&mut crate::components::player::Innovator>(te) {
                inv.knowledge = (inv.knowledge + (*amount as f32) * 0.5)
                    .min(crate::components::player::KNOWLEDGE_CAP);
                funded_research = true;
            }
            if funded_research {
                ActionResult::Success(format!(
                    "Funded Innovator's research with {} coins (+{:.0} Knowledge)",
                    amount, (*amount as f32) * 0.5
                ))
            } else {
                ActionResult::Success(format!("Wired {} coins UBI", amount))
            }
        }

        ActionKind::IssueTask { tone, message, task_kind, target, reward } => {
            // Tech-Monarch only. Charges 5 Influence to issue; the
            // reward itself is NOT escrowed — every farmer who fulfils
            // the criteria gets paid out of the Monarch's wallet at
            // claim time. If the Monarch can't cover a payout the task
            // auto-cancels (handled in ws.rs). Each player can claim a
            // given task at most once.
            const INFLUENCE_COST: f32 = 5.0;
            if *target == 0 {
                return ActionResult::Failure("Target must be at least 1".into());
            }
            if *reward == 0 {
                return ActionResult::Failure("Reward must be at least 1 coin".into());
            }
            if *task_kind > 3 {
                return ActionResult::Failure("Invalid task kind".into());
            }
            if *tone > 2 {
                return ActionResult::Failure("Invalid tone".into());
            }
            let trimmed = message.trim();
            if trimmed.is_empty() {
                return ActionResult::Failure("Task message cannot be empty".into());
            }
            if trimmed.chars().count() > 200 {
                return ActionResult::Failure(
                    "Task message too long (max 200 characters)".into(),
                );
            }
            // Validate Monarch + take Influence.
            {
                let mut monarch = match world
                    .get::<&mut crate::components::player::Monarch>(player_entity)
                {
                    Ok(m) => m,
                    Err(_) => {
                        return ActionResult::Failure(
                            "Only Tech Monarchs can issue tasks".into(),
                        )
                    }
                };
                if monarch.influence < INFLUENCE_COST {
                    return ActionResult::Failure(format!(
                        "Need {:.0} Influence (you have {:.0})",
                        INFLUENCE_COST, monarch.influence
                    ));
                }
                monarch.influence -= INFLUENCE_COST;
            }
            // Sanity-check the Monarch has at least one reward's worth
            // of coin to seed the task — otherwise it would cancel on
            // the very first claim, wasting Influence. This is a soft
            // check, not an escrow.
            {
                let wallet = world
                    .get::<&crate::components::player::Wallet>(player_entity)
                    .map(|w| w.0)
                    .unwrap_or(0);
                if wallet < *reward {
                    return ActionResult::Failure(format!(
                        "You'd be unable to pay the first claimant — need {} coins, have {}",
                        reward, wallet
                    ));
                }
            }
            ActionResult::Success(format!(
                "Task issued: {} coins per claimant",
                reward
            ))
        }

        ActionKind::Propaganda { tone, message } => {
            // Tech-Monarch only. The action just charges resources here;
            // the actual network fan-out is done by the WS layer (which
            // owns the session map) when it sees ActionResult::Success.
            let mut monarch = match world.get::<&mut crate::components::player::Monarch>(player_entity) {
                Ok(m) => m,
                Err(_) => {
                    return ActionResult::Failure(
                        "Only Tech Monarchs can issue state broadcasts".into(),
                    )
                }
            };
            const INFLUENCE_COST: f32 = 5.0;
            if monarch.influence < INFLUENCE_COST {
                return ActionResult::Failure(format!(
                    "Need {:.0} Influence (you have {:.0})",
                    INFLUENCE_COST, monarch.influence
                ));
            }
            let trimmed = message.trim();
            if trimmed.is_empty() {
                return ActionResult::Failure("Broadcast cannot be empty".into());
            }
            if trimmed.chars().count() > 200 {
                return ActionResult::Failure(
                    "Broadcast too long (max 200 characters)".into(),
                );
            }
            if *tone > 2 {
                return ActionResult::Failure("Invalid tone".into());
            }
            monarch.influence -= INFLUENCE_COST;
            ActionResult::Success(format!("Broadcast sent ({} chars)", trimmed.chars().count()))
        }

        ActionKind::AscendToMonarch => {
            // Farmer-only: spend a fixed pile of coins, gain the
            // Monarch component. We can't add the component here
            // because `world.spawn` / `world.insert_one` would need
            // exclusive access while we hold borrows; ws.rs handles the
            // insert + role-change broadcast after seeing
            // `ActionResult::Success("ascend ...")`. The ECS layer
            // owns the coin charge so the wallet check is atomic.
            if world.get::<&crate::components::player::Monarch>(player_entity).is_ok() {
                return ActionResult::Failure("You are already a Tech Monarch".into());
            }
            if resources.game_mode != ff_common::GameMode::Realistic {
                return ActionResult::Failure(
                    "Ascension is only available in Realistic mode".into(),
                );
            }
            let mut wallet = match world.get::<&mut crate::components::player::Wallet>(player_entity) {
                Ok(w) => w,
                Err(_) => return ActionResult::Failure("Wallet unavailable".into()),
            };
            if wallet.0 < crate::components::player::MONARCH_ASCENSION_COST {
                return ActionResult::Failure(format!(
                    "Need {} coins to ascend (you have {})",
                    crate::components::player::MONARCH_ASCENSION_COST,
                    wallet.0
                ));
            }
            wallet.0 = wallet
                .0
                .saturating_sub(crate::components::player::MONARCH_ASCENSION_COST);
            // Magic prefix lets ws.rs identify this success path without
            // peeking back at the action.
            ActionResult::Success(format!(
                "ascend ok — paid {} coins to become Tech Monarch",
                crate::components::player::MONARCH_ASCENSION_COST
            ))
        }

        ActionKind::Revolt { target_monarch_id } => {
            // Farmer-only: cast a no-confidence vote against a Monarch.
            // Self-target, double-vote, and target-not-a-Monarch are
            // rejected. Each successful revolt bumps discontent; the
            // demotion threshold check is run by tick.rs every second,
            // not here — keeps the per-action path cheap.
            if world.get::<&crate::components::player::Monarch>(player_entity).is_ok() {
                return ActionResult::Failure(
                    "Tech Monarchs cannot revolt — abdicate via the dashboard instead".into(),
                );
            }
            // Find the target's player entity.
            let mut target_entity = None;
            for (e, p) in world.query::<&crate::components::player::Player>().iter() {
                if p.player_id.0 == *target_monarch_id {
                    target_entity = Some(e);
                    break;
                }
            }
            let Some(te) = target_entity else {
                return ActionResult::Failure("Target is not connected".into());
            };
            let mut monarch = match world
                .get::<&mut crate::components::player::Monarch>(te)
            {
                Ok(m) => m,
                Err(_) => return ActionResult::Failure("Target is not a Monarch".into()),
            };
            // Each farmer votes at most once per Monarch instance.
            // (If the Monarch is later re-promoted, the vote list is
            // reset by ws.rs at that time.)
            let actor_id = player_id.0;
            if monarch.revolt_voters.contains(&actor_id) {
                return ActionResult::Failure(
                    "You've already revolted against this Monarch".into(),
                );
            }
            monarch.revolt_voters.push(actor_id);
            monarch.discontent = (monarch.discontent
                + crate::components::player::DISCONTENT_PER_REVOLT)
                .min(crate::components::player::DISCONTENT_DEMOTION_THRESHOLD);
            let pct = monarch.discontent
                / crate::components::player::DISCONTENT_DEMOTION_THRESHOLD
                * 100.0;
            ActionResult::Success(format!("Revolted (discontent now {:.0}%)", pct))
        }

        ActionKind::Research { topic } => {
            // Innovator only. Accumulate knowledge in the chosen
            // topic. Topic codes: 0=Climate, 1=Medicine, 2=Defense,
            // 3=Food. The current ECS doesn't yet split knowledge per
            // topic (just one f32 — the chosen topic is stored as
            // `focus_topic` for HUD display), but the protocol carries
            // the topic so we can split it later without a wire change.
            let mut inv = match world.get::<&mut crate::components::player::Innovator>(player_entity) {
                Ok(i) => i,
                Err(_) => return ActionResult::Failure("Only Innovators can research".into()),
            };
            if *topic > 3 {
                return ActionResult::Failure("Invalid research topic".into());
            }
            inv.focus_topic = *topic;
            inv.knowledge = (inv.knowledge + crate::components::player::RESEARCH_GAIN)
                .min(crate::components::player::KNOWLEDGE_CAP);
            let topic_name = match topic {
                0 => "Climate", 1 => "Medicine", 2 => "Defense",
                3 => "Food",   _ => "?",
            };
            ActionResult::Success(format!(
                "Researched {topic_name} (+{:.0} → {:.0} Knowledge)",
                crate::components::player::RESEARCH_GAIN, inv.knowledge,
            ))
        }

        ActionKind::DeployBreakthrough { kind } => {
            // Innovator only. Spend BREAKTHROUGH_COST knowledge to end
            // the active catastrophe IFF kind matches. Mismatched
            // breakthroughs would waste knowledge — easier UX to
            // reject upfront. ws.rs picks up the success and calls
            // catastrophe::resolve_active.
            let inv_kind = *kind;
            let cat_active_kind = resources.catastrophe.kind as u8;
            if cat_active_kind == 0 {
                return ActionResult::Failure(
                    "No active catastrophe — save your research for later".into(),
                );
            }
            // catastrophe kind discriminant 1..=5 in CatastropheKind matches
            // breakthrough kind 0..=4 (with a +1 offset). We use that mapping.
            // 0=Pandemic→1, 1=SolarFlare→2, 2=Drought→3, 3=Nuclear→4, 4=Asteroid→5
            let needed_breakthrough_for_active = cat_active_kind.saturating_sub(1);
            if inv_kind != needed_breakthrough_for_active {
                return ActionResult::Failure(format!(
                    "Wrong breakthrough — the active catastrophe needs a #{needed_breakthrough_for_active} breakthrough"
                ));
            }
            let mut inv = match world.get::<&mut crate::components::player::Innovator>(player_entity) {
                Ok(i) => i,
                Err(_) => return ActionResult::Failure("Only Innovators can deploy breakthroughs".into()),
            };
            if inv.knowledge < crate::components::player::BREAKTHROUGH_COST {
                return ActionResult::Failure(format!(
                    "Need {:.0} Knowledge (you have {:.0})",
                    crate::components::player::BREAKTHROUGH_COST, inv.knowledge,
                ));
            }
            inv.knowledge -= crate::components::player::BREAKTHROUGH_COST;
            inv.breakthroughs = inv.breakthroughs.saturating_add(1);
            // The ECS handler can't end the catastrophe here without a
            // mut borrow of resources.catastrophe alongside a mut borrow
            // of player_entity's component — but ws.rs runs the
            // resolve step after seeing the success message prefix.
            ActionResult::Success("breakthrough deployed — catastrophe averted".into())
        }

        ActionKind::Craft { recipe } => {
            use crate::components::player::{
                Outfit, ITEM_HIDE, ITEM_FIBER, TUNIC_FIBER_COST, COAT_HIDE_COST,
            };
            // Recipe 255 = take the outfit off (free).
            if *recipe == 255 {
                let _ = world.insert_one(player_entity, Outfit(0));
                return ActionResult::Success("Changed back into everyday clothes".into());
            }
            // Determine material + cost for the chosen garment.
            let (item, cost, outfit_id, name): (u16, u16, u8, &str) = match recipe {
                0 => (ITEM_FIBER, TUNIC_FIBER_COST, 1, "Linen Tunic"),
                1 => (ITEM_HIDE, COAT_HIDE_COST, 2, "Fur Coat"),
                _ => return ActionResult::Failure("Unknown garment".into()),
            };
            // Check + consume materials.
            {
                let mut inv = match world
                    .get::<&mut crate::components::player::Inventory>(player_entity)
                {
                    Ok(i) => i,
                    Err(_) => return ActionResult::Failure("Inventory unavailable".into()),
                };
                let have = inv.slots.iter()
                    .find(|s| s.item_id == item)
                    .map(|s| s.count)
                    .unwrap_or(0);
                if have < cost {
                    let mat = if item == ITEM_FIBER { "plant fibre" } else { "animal hide" };
                    return ActionResult::Failure(format!(
                        "Need {} {} (you have {})", cost, mat, have
                    ));
                }
                if !inv.remove(item, cost) {
                    return ActionResult::Failure("Not enough materials".into());
                }
            }
            let _ = world.insert_one(player_entity, Outfit(outfit_id));
            // "craft ok" prefix lets ws.rs spot this to re-broadcast the
            // player's appearance to everyone else.
            ActionResult::Success(format!("craft ok — crafted and put on a {name}"))
        }

        ActionKind::DeploySemiAI { position } => {
            // Tech-Monarch only. The action does nothing for Farmer players.
            let mut monarch = match world.get::<&mut crate::components::player::Monarch>(player_entity) {
                Ok(m) => m,
                Err(_) => return ActionResult::Failure("Only Tech Monarchs can deploy AI workers".into()),
            };
            if monarch.compute < 20.0 {
                return ActionResult::Failure(
                    format!("Need 20 Compute (you have {:.0})", monarch.compute),
                );
            }
            let [x, _y, z] = *position;
            let dist = (x as f32 - player_pos.x).hypot(z as f32 - player_pos.z);
            if dist > 30.0 {
                return ActionResult::Failure("Target out of broadcast range".into());
            }
            monarch.compute -= 20.0;
            monarch.deployments = monarch.deployments.saturating_add(1);
            // Each deployment edges the AI fleet's collective
            // intelligence up. Hitting AI_TAKEOVER_THRESHOLD will be
            // caught by the politics tick and trigger a takeover.
            monarch.ai_intelligence = (monarch.ai_intelligence
                + crate::components::player::AI_INT_PER_DEPLOY)
                .min(crate::components::player::AI_TAKEOVER_THRESHOLD);
            drop(monarch);

            let y = terrain.spawn_height(x, z);
            let tick = resources.calendar.tick.0;
            let id = *next_entity_id;
            *next_entity_id += 1;
            world.spawn((
                NetworkId(EntityId(id)),
                Owner(player_id),
                Position(Vec3::new(x as f32, y, z as f32)),
                Rotation(0.0),
                Velocity(Vec3::ZERO),
                crate::components::ai_agent::SemiAIWorker {
                    owner: player_id,
                    deployed_at_tick: tick,
                    last_harvest_tick: tick,
                },
            ));
            ActionResult::Success("Deployed semi-AI worker".into())
        }

        ActionKind::SellItem { item_id, count } => {
            if *count == 0 {
                return ActionResult::Failure("Nothing to sell".into());
            }
            let price = sell_price(*item_id);
            if price == 0 {
                return ActionResult::Failure("This item has no market value".into());
            }
            let total = price * (*count as u32);
            let mut inv = match world.get::<&mut crate::components::player::Inventory>(player_entity) {
                Ok(i) => i,
                Err(_) => return ActionResult::Failure("Inventory unavailable".into()),
            };
            if !inv.remove(*item_id, *count) {
                return ActionResult::Failure("Not enough to sell".into());
            }
            drop(inv);
            if let Ok(mut wallet) = world.get::<&mut crate::components::player::Wallet>(player_entity) {
                wallet.0 = wallet.0.saturating_add(total);
            }
            ActionResult::Success(format!("Sold {} for {} FoFo", count, total))
        }

        ActionKind::BuySong { song_id } => {
            let price = song_price(*song_id);
            if price == 0 {
                return ActionResult::Failure("Aurona has no such song".into());
            }
            // song_id ∈ {0,1,2} is guaranteed by the price check above, so the
            // shift can't overflow.
            let bit = 1u8 << *song_id;

            // Already owned?
            let already = world
                .get::<&crate::components::player::SongLibrary>(player_entity)
                .map(|lib| lib.0 & bit != 0)
                .unwrap_or(false);
            if already {
                return ActionResult::Failure("You already own that song".into());
            }

            // Enough FoFo Coin?
            let balance = world
                .get::<&crate::components::player::Wallet>(player_entity)
                .map(|w| w.0)
                .unwrap_or(0);
            if balance < price {
                return ActionResult::Failure(format!("Need {} FoFo Coin for that song", price));
            }

            // Charge the wallet, then set the owned bit (inserting a fresh
            // SongLibrary if this is their first purchase).
            if let Ok(mut wallet) = world.get::<&mut crate::components::player::Wallet>(player_entity) {
                wallet.0 = wallet.0.saturating_sub(price);
            }
            let updated = if let Ok(mut lib) =
                world.get::<&mut crate::components::player::SongLibrary>(player_entity)
            {
                lib.0 |= bit;
                true
            } else {
                false
            };
            if !updated {
                let _ = world
                    .insert_one(player_entity, crate::components::player::SongLibrary(bit));
            }
            ActionResult::Success(format!("Bought a song from Aurona for {} FoFo Coin", price))
        }

        // ── Aurona Fate Oracle ──────────────────────────────────────────────
        ActionKind::PlantBrainChip => {
            // Only meaningful while the player is in the death-pending state.
            if world
                .get::<&crate::components::player::Dead>(player_entity)
                .is_err()
            {
                return ActionResult::Failure("There is no fate to escape".into());
            }
            // The chip must bind to a Monarch. Snapshot one before mutating.
            let monarch = {
                let mut found = None;
                for (_e, (pl, _m)) in world
                    .query::<(
                        &crate::components::player::Player,
                        &crate::components::player::Monarch,
                    )>()
                    .iter()
                {
                    found = Some(pl.player_id);
                    break;
                }
                found
            };
            let Some(monarch) = monarch else {
                return ActionResult::Failure("No Tech-Monarch to take you".into());
            };
            // Revive as the Monarch's asset; the chip keeps you alive and owned.
            let _ = world.remove_one::<crate::components::player::Dead>(player_entity);
            let _ = world.remove_one::<crate::components::plant::Crushed>(player_entity);
            let _ = world.insert_one(
                player_entity,
                crate::components::player::MonarchAsset { monarch },
            );
            if let Ok(mut s) =
                world.get::<&mut crate::components::player::Stamina>(player_entity)
            {
                s.0 = 100.0;
            }
            if let Ok(mut h) = world.get::<&mut crate::components::player::Hunger>(player_entity) {
                h.0 = 0.0;
            }
            ActionResult::Success("chip ok — you live, owned by the machine".into())
        }

        ActionKind::AcceptFate => {
            if world
                .get::<&crate::components::player::Dead>(player_entity)
                .is_err()
            {
                return ActionResult::Failure("You are not dying".into());
            }
            let _ = world.remove_one::<crate::components::player::Dead>(player_entity);
            let _ = world.remove_one::<crate::components::plant::Crushed>(player_entity);
            // Die free — but reborn with nothing. That's the cost of refusing
            // the chip (so servitude is a real temptation, not a trap).
            if let Ok(mut inv) =
                world.get::<&mut crate::components::player::Inventory>(player_entity)
            {
                inv.slots.clear();
            }
            if let Ok(mut wallet) =
                world.get::<&mut crate::components::player::Wallet>(player_entity)
            {
                wallet.0 = 0;
            }
            if let Ok(mut s) =
                world.get::<&mut crate::components::player::Stamina>(player_entity)
            {
                s.0 = 100.0;
            }
            if let Ok(mut h) = world.get::<&mut crate::components::player::Hunger>(player_entity) {
                h.0 = 0.0;
            }
            ActionResult::Success("fate ok — reborn free, with nothing".into())
        }

        ActionKind::RemoveChip => {
            // The liberator: only an Innovator can de-chip, and only a chipped
            // Farmer who is physically within reach.
            if world
                .get::<&crate::components::player::Innovator>(player_entity)
                .is_err()
            {
                return ActionResult::Failure("Only an Innovator can remove a chip".into());
            }
            let mut best: Option<(hecs::Entity, f32)> = None;
            for (e, (pos, _ma)) in world
                .query::<(&Position, &crate::components::player::MonarchAsset)>()
                .iter()
            {
                let dist = pos.0.distance(player_pos);
                if dist <= 8.0 && best.map_or(true, |(_, bd)| dist < bd) {
                    best = Some((e, dist));
                }
            }
            let Some((te, _)) = best else {
                return ActionResult::Failure("No chipped farmer within reach".into());
            };
            let _ = world.remove_one::<crate::components::player::MonarchAsset>(te);
            ActionResult::Success("freed — the chip is out, the Monarch's hold broken".into())
        }

        _ => ActionResult::Failure("Action not implemented yet".into()),
    }
}

/// FoFo Coin price of one of Aurona Singer's songs in the Songbook store.
/// Returns 0 for an unknown id (which rejects the purchase). Indices match
/// the client's SONGS list: 0=Strawberry, 1=Enhanced Love Games, 2=Humandroid.
fn song_price(song_id: u8) -> u32 {
    match song_id {
        0 => 90,  // Strawberry — sweet but deadly
        1 => 120, // Enhanced Love Games — upgrade your heart
        2 => 90,  // Hu Hu Humandroid — clock in, clock in
        _ => 0,
    }
}

/// FoFo Coin price per unit for an inventory item. Returns 0 for items
/// that have no market value (clover ground cover, etc.). Tuned so
/// hunting and tree fruits pay better than easy herbs.
fn sell_price(item_id: u16) -> u32 {
    match item_id {
        // Animal products — premium
        2000 => 12,
        // Nuts — long maturity, higher payoff
        1100 | 1101 => 8,           // Chestnut, Walnut
        1104 | 1105 => 7,           // Hazelnut, Almond
        1108 | 1110 => 10,          // Macadamia, Pistachio
        1107 => 6,                  // Redwood cones
        1102 => 6,                  // Carob pods
        // Fruits & berries — staple income
        1112 => 5,                  // Cherries
        1200..=1210 => 4,           // Understory fruit trees
        1501 => 3,                  // Strawberries
        1600 => 4,                  // Grapes
        // Herbs & spices — small but stackable
        1402 => 8,                  // Saffron (premium)
        1300..=1306 | 1400 | 1401 | 1403 => 2,
        // Ground covers (clover) sell for almost nothing
        1500 => 1,
        _ => 0,
    }
}

/// Hunger reduction (in display-percent units, matching ServerPlayerState.hunger)
/// when the player eats one of `item_id`. Returns 0.0 for inedible items.
fn eat_nutrition(item_id: u16) -> f32 {
    match item_id {
        2000 => 30.0,                                      // Game meat
        1100 | 1101 | 1104 | 1105 | 1107 | 1108 | 1110 => 15.0, // Nuts
        1102 => 12.0,                                      // Carob
        1112 | 1200..=1210 | 1501 | 1600 => 10.0,          // Fruits
        1300..=1306 | 1400..=1403 => 4.0,                  // Herbs & spices
        1500 => 1.0,                                       // Clover
        _ => 0.0,
    }
}

/// Tell every nearby wild animal: "something just got killed here."
/// Bumps their `fear` and queues a negative reward so the brain's next
/// Q-update credits whatever action led them close to a hunting player.
fn broadcast_hunt_fear(world: &mut hecs::World, hunt_pos: Vec3) {
    const FEAR_RADIUS: f32 = 20.0;
    let radius_sq = FEAR_RADIUS * FEAR_RADIUS;
    for (_, (apos, memory, dom)) in world.query_mut::<(
        &Position,
        Option<&mut crate::components::animal_brain::AnimalMemory>,
        Option<&crate::components::animal::Domesticated>,
    )>() {
        if dom.is_some() {
            continue;
        }
        let dx = apos.0.x - hunt_pos.x;
        let dz = apos.0.z - hunt_pos.z;
        if dx * dx + dz * dz > radius_sq {
            continue;
        }
        if let Some(mem) = memory {
            mem.fear = (mem.fear + 0.8).min(1.0);
            mem.reward -= 0.5;
        }
    }
}
