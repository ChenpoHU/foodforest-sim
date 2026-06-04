 //! ff-client-wasm: Browser WASM client for the Food Forest simulation.
//!
//! Exports a `GameClient` to JavaScript that handles:
//! - WebSocket connection to the game server
//! - Sending player input at 20 Hz
//! - Receiving and buffering entity updates
//! - Client-side prediction and interpolation

mod input;
mod interpolation;
mod net;
mod prediction;

use ff_common::{EntityId, PlayerId, Tick};
use ff_protocol::codec::{decode, decode_payload, encode};
use ff_protocol::messages::*;
use std::cell::RefCell;
use std::collections::HashMap;
use wasm_bindgen::prelude::*;

thread_local! {
    static CLIENT: RefCell<GameClient> = RefCell::new(GameClient::new());
}

/// Entity as seen by the client (position + visual state).
#[derive(Debug, Clone)]
pub struct ClientEntity {
    pub entity_id: EntityId,
    pub kind: u8, // 0=player, 1=plant, 2=animal, 3=npc
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub rotation: f32,
    pub state_flags: u8,
    // Interpolation
    pub prev_x: f32,
    pub prev_y: f32,
    pub prev_z: f32,
    pub interp_t: f32,
}

struct GameClient {
    connected: bool,
    my_entity_id: EntityId,
    my_player_id: PlayerId,
    tick: Tick,
    entities: HashMap<u64, ClientEntity>,
    input_seq: u32,
    terrain_bytes: Vec<u8>,
    // Pending messages from WebSocket (pushed by JS callback)
    pending_messages: Vec<Vec<u8>>,
}

impl GameClient {
    fn new() -> Self {
        Self {
            connected: false,
            my_entity_id: EntityId(0),
            my_player_id: PlayerId(0),
            tick: Tick(0),
            entities: HashMap::new(),
            input_seq: 0,
            terrain_bytes: Vec::new(),
            pending_messages: Vec::new(),
        }
    }
}

/// Initialize the client and connect to the game server.
#[wasm_bindgen]
pub fn client_connect(server_url: &str, player_name: &str) -> bool {
    let url = server_url.to_string();
    let name = player_name.to_string();

    // Connection is handled by JS (WebSocket API) — we just track state
    CLIENT.with(|c| {
        let mut client = c.borrow_mut();
        client.connected = true;
    });

    // Build ClientHello message for JS to send
    let hello = ClientHello {
        player_name: name,
        token: "dev-token".into(),
        protocol_version: 1,
        game_mode: 1,
        region_index: 0,
        plot_seed: 42,
        player_role: 0, traveling: false,
        is_ai: false, agent_label: String::new(),
    };

    if let Ok(_buf) = encode(MessageType::ClientHello, &hello) {
        // JS will send this via WebSocket
        true
    } else {
        false
    }
}

/// Build a ClientHello binary message for JS to send.
#[wasm_bindgen]
pub fn build_hello_message(player_name: &str) -> Vec<u8> {
    let hello = ClientHello {
        player_name: player_name.to_string(),
        token: "dev-token".into(),
        protocol_version: 1,
        game_mode: 1,
        region_index: 0,
        plot_seed: 42,
        player_role: 0, traveling: false,
        is_ai: false, agent_label: String::new(),
    };
    encode(MessageType::ClientHello, &hello).unwrap_or_default()
}

/// Push a received binary message from JS WebSocket callback.
#[wasm_bindgen]
pub fn on_message(data: &[u8]) {
    CLIENT.with(|c| {
        c.borrow_mut().pending_messages.push(data.to_vec());
    });
}

/// Process all pending messages. Called once per frame from JS.
#[wasm_bindgen]
pub fn client_tick(dt: f32) {
    CLIENT.with(|c| {
        let mut client = c.borrow_mut();

        // Process pending messages
        let messages: Vec<Vec<u8>> = client.pending_messages.drain(..).collect();
        for msg in messages {
            process_message(&mut client, &msg);
        }

        // Interpolate entities
        for entity in client.entities.values_mut() {
            entity.interp_t = (entity.interp_t + dt * 10.0).min(1.0); // 100ms interpolation
        }
    });
}

/// Build a ClientInput binary message for JS to send.
#[wasm_bindgen]
pub fn build_input_message(move_x: f32, move_z: f32, yaw: f32, jump: bool, sprint: bool) -> Vec<u8> {
    CLIENT.with(|c| {
        let mut client = c.borrow_mut();
        client.input_seq += 1;

        let input = ClientInput {
            seq: client.input_seq,
            tick: client.tick,
            move_dir: [move_x, move_z],
            yaw,
            jump,
            sprint,
        };

        encode(MessageType::ClientInput, &input).unwrap_or_default()
    })
}

/// Build a ClientAction binary message for JS to send.
#[wasm_bindgen]
pub fn build_action_message(action_json: &str) -> Vec<u8> {
    // Simplified: parse action type from a simple string format
    // In production, this would be a proper serialization
    CLIENT.with(|c| {
        let mut client = c.borrow_mut();
        client.input_seq += 1;

        let action = ClientAction {
            seq: client.input_seq,
            action: ActionKind::PlantSeed { species_id: 100, position: [0, 0, 0] }, // default for now
        };

        encode(MessageType::ClientAction, &action).unwrap_or_default()
    })
}

/// Get the number of entities currently tracked.
#[wasm_bindgen]
pub fn get_entity_count() -> u32 {
    CLIENT.with(|c| c.borrow().entities.len() as u32)
}

/// Get entity data as a flat Float32Array for Three.js rendering.
/// Layout: [entity_id, kind, x, y, z, rotation, state_flags, interp_x, interp_y, interp_z]
/// 10 floats per entity.
#[wasm_bindgen]
pub fn get_entity_data() -> Vec<f32> {
    CLIENT.with(|c| {
        let client = c.borrow();
        let mut data = Vec::with_capacity(client.entities.len() * 10);

        for entity in client.entities.values() {
            // Interpolated position
            let ix = entity.prev_x + (entity.x - entity.prev_x) * entity.interp_t;
            let iy = entity.prev_y + (entity.y - entity.prev_y) * entity.interp_t;
            let iz = entity.prev_z + (entity.z - entity.prev_z) * entity.interp_t;

            data.push(entity.entity_id.0 as f32);
            data.push(entity.kind as f32);
            data.push(ix);
            data.push(iy);
            data.push(iz);
            data.push(entity.rotation);
            data.push(entity.state_flags as f32);
            data.push(entity.x); // target position
            data.push(entity.y);
            data.push(entity.z);
        }

        data
    })
}

/// Get my entity ID.
#[wasm_bindgen]
pub fn get_my_entity_id() -> u64 {
    CLIENT.with(|c| c.borrow().my_entity_id.0)
}

/// Get terrain bytes (for initial voxel loading).
#[wasm_bindgen]
pub fn get_terrain_ptr() -> *const u8 {
    CLIENT.with(|c| c.borrow().terrain_bytes.as_ptr())
}

#[wasm_bindgen]
pub fn get_terrain_len() -> usize {
    CLIENT.with(|c| c.borrow().terrain_bytes.len())
}

/// Check if we're connected and have received world state.
#[wasm_bindgen]
pub fn is_ready() -> bool {
    CLIENT.with(|c| {
        let client = c.borrow();
        client.connected && !client.terrain_bytes.is_empty()
    })
}

fn process_message(client: &mut GameClient, data: &[u8]) {
    let Ok((msg_type, payload)) = decode(data) else {
        return;
    };

    match msg_type {
        MessageType::ServerWelcome => {
            if let Ok(welcome) = decode_payload::<ServerWelcome>(payload) {
                client.my_entity_id = welcome.your_entity_id;
                client.my_player_id = welcome.your_player_id;
                client.tick = welcome.tick;
                web_sys::console::log_1(
                    &format!(
                        "Welcome! Entity={:?} Player={:?}",
                        welcome.your_entity_id, welcome.your_player_id
                    )
                    .into(),
                );
            }
        }
        MessageType::ServerWorldState => {
            if let Ok(world_state) = decode_payload::<ServerWorldState>(payload) {
                client.terrain_bytes = world_state.terrain_bytes;
                client.tick = world_state.tick;

                // Load initial entities
                for es in &world_state.entities {
                    client.entities.insert(
                        es.entity_id.0,
                        ClientEntity {
                            entity_id: es.entity_id,
                            kind: match es.kind {
                                EntityKind::Player => 0,
                                EntityKind::Plant { .. } => 1,
                                EntityKind::Animal { .. } => 2,
                                EntityKind::NpcAgent { .. } => 3,
                                EntityKind::DroppedItem { .. } => 4,
                                EntityKind::Structure { .. } => 5,
                                EntityKind::SemiAI => 6,
                            },
                            x: es.position[0],
                            y: es.position[1],
                            z: es.position[2],
                            rotation: es.rotation,
                            state_flags: 0,
                            prev_x: es.position[0],
                            prev_y: es.position[1],
                            prev_z: es.position[2],
                            interp_t: 1.0,
                        },
                    );
                }

                web_sys::console::log_1(
                    &format!(
                        "World loaded: {} terrain bytes, {} entities",
                        client.terrain_bytes.len(),
                        client.entities.len()
                    )
                    .into(),
                );
            }
        }
        MessageType::ServerBatchUpdate => {
            if let Ok(batch) = decode_payload::<ServerBatchUpdate>(payload) {
                client.tick = batch.tick;

                for update in &batch.updates {
                    if let Some(entity) = client.entities.get_mut(&update.entity_id.0) {
                        // Save previous position for interpolation
                        entity.prev_x = entity.x;
                        entity.prev_y = entity.y;
                        entity.prev_z = entity.z;

                        // Set new target position
                        entity.x = update.position[0];
                        entity.y = update.position[1];
                        entity.z = update.position[2];
                        entity.rotation = update.rotation;
                        entity.state_flags = update.state_flags;
                        entity.interp_t = 0.0; // restart interpolation
                    } else {
                        // New entity — spawn
                        client.entities.insert(
                            update.entity_id.0,
                            ClientEntity {
                                entity_id: update.entity_id,
                                kind: 0, // unknown until EntitySpawn
                                x: update.position[0],
                                y: update.position[1],
                                z: update.position[2],
                                rotation: update.rotation,
                                state_flags: update.state_flags,
                                prev_x: update.position[0],
                                prev_y: update.position[1],
                                prev_z: update.position[2],
                                interp_t: 1.0,
                            },
                        );
                    }
                }
            }
        }
        MessageType::ServerEntitySpawn => {
            if let Ok(spawn) = decode_payload::<ServerEntitySpawn>(payload) {
                let es = &spawn.entity;
                client.entities.insert(
                    es.entity_id.0,
                    ClientEntity {
                        entity_id: es.entity_id,
                        kind: match es.kind {
                            EntityKind::Player => 0,
                            EntityKind::Plant { .. } => 1,
                            EntityKind::Animal { .. } => 2,
                            EntityKind::NpcAgent { .. } => 3,
                            EntityKind::DroppedItem { .. } => 4,
                            EntityKind::Structure { .. } => 5,
                            EntityKind::SemiAI => 6,
                        },
                        x: es.position[0],
                        y: es.position[1],
                        z: es.position[2],
                        rotation: es.rotation,
                        state_flags: 0,
                        prev_x: es.position[0],
                        prev_y: es.position[1],
                        prev_z: es.position[2],
                        interp_t: 1.0,
                    },
                );
            }
        }
        MessageType::ServerEntityDespawn => {
            if let Ok(despawn) = decode_payload::<ServerEntityDespawn>(payload) {
                client.entities.remove(&despawn.entity_id.0);
            }
        }
        MessageType::ServerActionResult => {
            if let Ok(result) = decode_payload::<ServerActionResult>(payload) {
                let status = if result.success { "OK" } else { "FAIL" };
                web_sys::console::log_1(
                    &format!(
                        "Action #{}: {} — {}",
                        result.seq,
                        status,
                        result.message.unwrap_or_default()
                    )
                    .into(),
                );
            }
        }
        _ => {}
    }
}
