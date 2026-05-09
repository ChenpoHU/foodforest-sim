//! Shard: holds the ECS world, resources, terrain, soil grid, and player sessions.

use ff_common::{EntityId, PlayerId, ShardId, SOIL_LAYERS};
use ff_ecs::components::identity::{NetworkId, Owner};
use ff_ecs::components::physics::{Collider, Grounded};
use ff_ecs::components::player::{Hunger, Inventory, Player, PlayerSkills, Stamina};
use ff_ecs::components::soil::SoilGrid;
use ff_ecs::components::transform::{Position, Rotation, Velocity};
use ff_ecs::Resources;
use ff_voxel::VoxelWorld;
use glam::Vec3;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::session::PlayerSession;

/// A single shard instance.
pub struct Shard {
    pub id: ShardId,
    pub ecs_world: hecs::World,
    pub resources: Resources,
    pub terrain: VoxelWorld,
    pub terrain_bytes: Vec<u8>,
    pub soil_grid: SoilGrid,
    pub sessions: HashMap<PlayerId, PlayerSession>,
    pub next_entity_id: u64,
}

impl Shard {
    pub fn new(id: ShardId, terrain: VoxelWorld, terrain_bytes: Vec<u8>) -> Arc<Mutex<Self>> {
        let w = terrain.width as usize;
        let d = terrain.depth as usize;

        let soil_grid = SoilGrid::new(w, d, SOIL_LAYERS);

        let mut shard = Self {
            id,
            ecs_world: hecs::World::new(),
            resources: Resources::new(),
            terrain,
            terrain_bytes,
            soil_grid,
            sessions: HashMap::new(),
            next_entity_id: 1000,
        };

        // Spawn some initial plants and animals
        shard.spawn_initial_ecosystem();

        Arc::new(Mutex::new(shard))
    }

    /// Spawn a player entity and register their session.
    pub fn add_player(
        &mut self,
        player_id: PlayerId,
        name: String,
        session: PlayerSession,
    ) -> (EntityId, hecs::Entity) {
        let eid = EntityId(self.next_entity_id);
        self.next_entity_id += 1;

        // Spawn at a random-ish position on the terrain
        let spawn_x = (self.terrain.width / 2) as i32;
        let spawn_z = (self.terrain.depth / 2) as i32;
        let spawn_y = self.terrain.spawn_height(spawn_x, spawn_z) as f32;

        let entity = self.ecs_world.spawn((
            NetworkId(eid),
            ff_ecs::components::identity::Name(name),
            Owner(player_id),
            Position(Vec3::new(spawn_x as f32, spawn_y, spawn_z as f32)),
            Rotation(0.0),
            Velocity(Vec3::ZERO),
            Collider {
                half_extents: Vec3::new(0.4, 0.9, 0.4),
            },
            Grounded(true),
            Player {
                player_id,
                session_id: player_id.0,
                last_input_seq: 0,
            },
            Inventory::new(),
            Stamina(100.0),
            Hunger(0.0),
            PlayerSkills::default(),
        ));

        self.sessions.insert(player_id, session);
        tracing::info!("Player {:?} joined shard {:?}", player_id, self.id);

        (eid, entity)
    }

    /// Remove a player from the shard.
    pub fn remove_player(&mut self, player_id: PlayerId) {
        self.sessions.remove(&player_id);

        // Find and despawn the player entity
        let mut to_despawn = Vec::new();
        for (entity, player) in self.ecs_world.query_mut::<&Player>() {
            if player.player_id == player_id {
                to_despawn.push(entity);
            }
        }
        for entity in to_despawn {
            let _ = self.ecs_world.despawn(entity);
        }

        tracing::info!("Player {:?} left shard {:?}", player_id, self.id);
    }

    /// Seed the world with initial plants and animals.
    fn spawn_initial_ecosystem(&mut self) {
        use ff_ecs::components::animal::{Animal, AnimalBehavior, Domesticated};
        use ff_ecs::components::plant::Plant;

        let w = self.terrain.width as i32;
        let d = self.terrain.depth as i32;

        for i in 0..80 {
            let x = (i * 5 + 3) % w;
            let z = (i * 7 + 2) % d;
            let y = self.terrain.spawn_height(x, z) as f32;

            let eid = EntityId(self.next_entity_id);
            self.next_entity_id += 1;

            let mut plant = Plant::new_seed(103);
            plant.growth_stage = ff_ecs::components::plant::GrowthStage::Mature;
            plant.growth_points = 60000.0;

            self.ecs_world.spawn((
                NetworkId(eid),
                Position(Vec3::new(x as f32, y, z as f32)),
                Rotation(0.0),
                plant,
            ));
        }

        let native_species = [100u16, 101, 102, 200, 201, 202];
        for i in 0..12 {
            let x = (i * 11 + 17) % w;
            let z = (i * 13 + 11) % d;
            let y = self.terrain.spawn_height(x, z) as f32;

            let species_id = native_species[(i as usize) % native_species.len()];
            let eid = EntityId(self.next_entity_id);
            self.next_entity_id += 1;

            let mut plant = Plant::new_seed(species_id);
            plant.growth_stage = ff_ecs::components::plant::GrowthStage::Mature;
            plant.growth_points = 50000.0;

            self.ecs_world.spawn((
                NetworkId(eid),
                Position(Vec3::new(x as f32, y, z as f32)),
                Rotation(0.0),
                plant,
            ));
        }

        // Scatter herbs and ground cover
        let herb_species = [300u16, 301, 400, 500, 501];
        for i in 0..100 {
            let x = (i * 3 + 5) % w;
            let z = (i * 5 + 3) % d;
            let y = self.terrain.spawn_height(x, z) as f32;

            let species_id = herb_species[(i as usize) % herb_species.len()];
            let eid = EntityId(self.next_entity_id);
            self.next_entity_id += 1;

            let mut plant = Plant::new_seed(species_id);
            plant.growth_stage = ff_ecs::components::plant::GrowthStage::Mature;
            plant.growth_points = 10000.0;

            self.ecs_world.spawn((
                NetworkId(eid),
                Position(Vec3::new(x as f32, y, z as f32)),
                Rotation(0.0),
                plant,
            ));
        }

        // Spawn chickens
        for i in 0..10 {
            let x = (w / 2 + i * 2) as f32;
            let z = (d / 2 + i * 3) as f32;
            let y = self.terrain.spawn_height(x as i32, z as i32) as f32;

            let eid = EntityId(self.next_entity_id);
            self.next_entity_id += 1;

            self.ecs_world.spawn((
                NetworkId(eid),
                Position(Vec3::new(x, y, z)),
                Rotation(0.0),
                Velocity(Vec3::ZERO),
                Collider {
                    half_extents: Vec3::new(0.3, 0.3, 0.3),
                },
                Grounded(true),
                Animal {
                    species_id: 10,
                    behavior: AnimalBehavior::Wandering,
                    hunger: 0.3,
                    energy: 0.8,
                },
                Domesticated {
                    pen_center: Vec3::new(w as f32 / 2.0, y, d as f32 / 2.0),
                    pen_radius: 20.0,
                },
            ));
        }

        // Spawn wild deer
        for i in 0..5 {
            let x = (i * 17 + 10) % w;
            let z = (i * 13 + 20) % d;
            let y = self.terrain.spawn_height(x, z) as f32;

            let eid = EntityId(self.next_entity_id);
            self.next_entity_id += 1;

            self.ecs_world.spawn((
                NetworkId(eid),
                Position(Vec3::new(x as f32, y, z as f32)),
                Rotation(0.0),
                Velocity(Vec3::ZERO),
                Collider {
                    half_extents: Vec3::new(0.5, 0.8, 0.5),
                },
                Grounded(true),
                Animal {
                    species_id: 21,
                    behavior: AnimalBehavior::Wandering,
                    hunger: 0.2,
                    energy: 0.9,
                },
                ff_ecs::components::animal::WildAnimal,
            ));
        }

        tracing::info!("Spawned initial ecosystem: 80 eucalyptus, 12 native trees, 100 herbs/groundcover, 15 animals");
    }

    /// Run one ECS tick. Borrows fields separately to satisfy the borrow checker.
    pub fn tick(&mut self) -> Vec<ff_ecs::systems::tree_felling::FellMessage> {
        ff_ecs::systems::run_tick(
            &mut self.ecs_world,
            &mut self.resources,
            &mut self.soil_grid,
            &self.terrain,
        )
    }

    /// Process a player action. Borrows fields separately.
    pub fn process_action(
        &mut self,
        player_entity: hecs::Entity,
        player_id: PlayerId,
        action: &ff_protocol::ActionKind,
    ) -> ff_ecs::systems::interaction::ActionResult {
        ff_ecs::systems::interaction::process_action(
            &mut self.ecs_world,
            &mut self.terrain,
            &self.resources,
            player_entity,
            player_id,
            action,
            &mut self.next_entity_id,
        )
    }
}
