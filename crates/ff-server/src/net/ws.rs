//! WebSocket server: accepts connections, routes messages to/from the shard.

use crate::session::PlayerSession;
use crate::shard::Shard;
use crate::tick;

use ff_common::{EntityId, PlayerId, ShardId, Tick};
use ff_protocol::codec::{decode, decode_payload, encode};
use ff_protocol::messages::*;

use futures_util::{SinkExt, StreamExt};
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, Mutex};
use tokio_tungstenite::tungstenite::Message;
use tracing::{error, info, warn};

/// Run the WebSocket server and tick loop.
pub async fn run_server(addr: SocketAddr, shard: Arc<Mutex<Shard>>) {
    let listener = TcpListener::bind(addr).await.expect("Failed to bind");
    info!("WebSocket server listening on {addr}");

    // Start the tick loop in a background task
    let tick_shard = Arc::clone(&shard);
    tokio::spawn(async move {
        tick::run_tick_loop(tick_shard).await;
    });

    // Accept connections
    loop {
        match listener.accept().await {
            Ok((stream, peer_addr)) => {
                let shard = Arc::clone(&shard);
                tokio::spawn(handle_connection(stream, peer_addr, shard));
            }
            Err(e) => {
                error!("Accept error: {e}");
            }
        }
    }
}

async fn handle_connection(stream: TcpStream, peer_addr: SocketAddr, shard: Arc<Mutex<Shard>>) {
    let ws_stream = match tokio_tungstenite::accept_async(stream).await {
        Ok(ws) => ws,
        Err(_) => return,  // silently drop non-WebSocket connections (HTTP probes, etc.)
    };
    info!("Player connected from {peer_addr}");

    let (mut ws_sender, mut ws_receiver) = ws_stream.split();

    // Wait for ClientHello
    let hello: ClientHello = loop {
        match ws_receiver.next().await {
            Some(Ok(Message::Binary(data))) => {
                let bytes: Vec<u8> = data.into();
                match decode(&bytes) {
                    Ok((MessageType::ClientHello, payload)) => {
                        match decode_payload::<ClientHello>(payload) {
                            Ok(hello) => break hello,
                            Err(e) => {
                                error!("Failed to decode ClientHello: {e}");
                                return;
                            }
                        }
                    }
                    _ => continue,
                }
            }
            Some(Ok(Message::Close(_))) | None => {
                info!("Connection closed before hello: {peer_addr}");
                return;
            }
            _ => continue,
        }
    };

    info!(
        "Player '{}' connected from {peer_addr} (mode={} region={} plot={})",
        hello.player_name, hello.game_mode, hello.region_index, hello.plot_seed
    );

    let (tx, mut rx) = mpsc::unbounded_channel::<Vec<u8>>();
    let player_id = PlayerId(hash_name(&hello.player_name));

    let (entity_id, shard_id, tick, terrain_bytes) = {
        let mut shard = shard.lock().await;

        if shard.sessions.is_empty() {
            let mode = ff_common::GameMode::from(hello.game_mode);
            shard.resources.game_mode = mode;
            info!("Game mode set to {:?} by first player", mode);

            let terrain = ff_voxel::generate::generate_terrain(hello.region_index, hello.plot_seed);
            let tb = terrain.to_bytes();
            info!(
                "Regenerated terrain for region {} plot_seed {}",
                hello.region_index, hello.plot_seed
            );
            shard.replace_terrain(terrain, tb, hello.region_index);
        }
        let session = PlayerSession::new(
            player_id,
            EntityId(0), // will be set below
            hello.player_name.clone(),
            tx,
        );
        let (eid, _entity) = shard.add_player(player_id, hello.player_name.clone(), session);

        // Update entity_id in session
        if let Some(s) = shard.sessions.get_mut(&player_id) {
            s.entity_id = eid;
        }

        let sid = shard.id;
        let t = shard.resources.calendar.tick;
        let tb = shard.terrain_bytes.clone();
        (eid, sid, t, tb)
    };

    // Send ServerWelcome
    let welcome = ServerWelcome {
        your_entity_id: entity_id,
        your_player_id: player_id,
        shard_id: shard_id,
        tick,
        tick_rate: ff_common::TICK_RATE,
    };
    if let Ok(buf) = encode(MessageType::ServerWelcome, &welcome) {
        let _ = ws_sender.send(Message::Binary(buf.into())).await;
    }

    // Build entity snapshots from ECS
    let entities = {
        let shard = shard.lock().await;
        let mut snaps = Vec::new();

        for (_e, (net_id, pos)) in shard.ecs_world.query::<(
            &ff_ecs::components::identity::NetworkId,
            &ff_ecs::components::transform::Position,
        )>().iter() {
            let rot = shard.ecs_world
                .get::<&ff_ecs::components::transform::Rotation>(_e)
                .map(|r| r.0)
                .unwrap_or(0.0);

            let kind = if let Ok(plant) = shard.ecs_world.get::<&ff_ecs::components::plant::Plant>(_e) {
                EntityKind::Plant { species_id: plant.species_id }
            } else if let Ok(animal) = shard.ecs_world.get::<&ff_ecs::components::animal::Animal>(_e) {
                EntityKind::Animal { species_id: animal.species_id }
            } else if let Ok(structure) = shard.ecs_world.get::<&ff_ecs::components::identity::Structure>(_e) {
                EntityKind::Structure { kind: structure.kind }
            } else if shard.ecs_world.get::<&ff_ecs::components::player::Player>(_e).is_ok() {
                EntityKind::Player
            } else {
                EntityKind::Player
            };

            let state = if let Ok(plant) = shard.ecs_world.get::<&ff_ecs::components::plant::Plant>(_e) {
                EntityState::PlantGrowth {
                    stage: plant.growth_stage as u8,
                    health: plant.health,
                }
            } else if let Ok(animal) = shard.ecs_world.get::<&ff_ecs::components::animal::Animal>(_e) {
                EntityState::AnimalBehavior {
                    behavior: 0,
                    hunger: animal.hunger,
                }
            } else {
                EntityState::Active
            };

            snaps.push(EntitySnapshot {
                entity_id: net_id.0,
                kind,
                position: [pos.0.x, pos.0.y, pos.0.z],
                rotation: rot,
                state,
            });
        }
        snaps
    };

    // Send terrain data as WorldState
    let world_state = ServerWorldState {
        tick,
        calendar: GameCalendarMsg {
            tick,
            day: 80,
            season: 0,
            year: 1,
        },
        weather: WeatherMsg {
            temperature: 22.0,
            rainfall: 0.0,
            wind_speed: 3.0,
            cloud_cover: 0.2,
            sunlight: 0.8,
        },
        entities,
        terrain_bytes,
    };
    if let Ok(buf) = encode(MessageType::ServerWorldState, &world_state) {
        let _ = ws_sender.send(Message::Binary(buf.into())).await;
    }

    // Spawn outbound task: forwards messages from the session channel to WebSocket
    let outbound = tokio::spawn(async move {
        while let Some(data) = rx.recv().await {
            if ws_sender.send(Message::Binary(data.into())).await.is_err() {
                break;
            }
        }
    });

    // Inbound loop: read messages from WebSocket, dispatch to shard
    loop {
        match ws_receiver.next().await {
            Some(Ok(Message::Binary(data))) => {
                let bytes: Vec<u8> = data.into();
                if let Err(e) = handle_message(&shard, player_id, &bytes).await {
                    warn!("Message handling error from {peer_addr}: {e}");
                }
            }
            Some(Ok(Message::Close(_))) | None => {
                info!("Player '{}' disconnected", hello.player_name);
                break;
            }
            Some(Ok(Message::Ping(data))) => {
                // Tungstenite handles pong automatically
                let _ = data;
            }
            Some(Err(e)) => {
                error!("WebSocket error from {peer_addr}: {e}");
                break;
            }
            _ => {}
        }
    }

    // Cleanup
    {
        let mut shard = shard.lock().await;
        shard.remove_player(player_id);
    }
    outbound.abort();
}

async fn handle_message(
    shard: &Arc<Mutex<Shard>>,
    player_id: PlayerId,
    bytes: &[u8],
) -> Result<(), Box<dyn std::error::Error>> {
    let (msg_type, payload) = decode(bytes)?;

    match msg_type {
        MessageType::ClientInput => {
            let input: ClientInput = decode_payload(payload)?;
            let mut shard = shard.lock().await;

            // Find player entity and apply input
            for (_entity, (player, vel, rot)) in shard.ecs_world.query_mut::<(
                &mut ff_ecs::components::player::Player,
                &mut ff_ecs::components::transform::Velocity,
                &mut ff_ecs::components::transform::Rotation,
            )>() {
                if player.player_id == player_id {
                    let speed = if input.sprint { 8.0 } else { 5.0 };
                    vel.0.x = input.move_dir[0] * speed;
                    vel.0.z = input.move_dir[1] * speed;
                    rot.0 = input.yaw;
                    player.last_input_seq = input.seq;

                    if input.jump {
                        // Only jump if grounded (checked in physics system)
                        vel.0.y = 8.0;
                    }
                    break;
                }
            }
        }
        MessageType::ClientAction => {
            let action: ClientAction = decode_payload(payload)?;
            let mut shard = shard.lock().await;

            // Find player entity
            let mut player_entity = None;
            for (entity, player) in shard.ecs_world.query_mut::<&ff_ecs::components::player::Player>()
            {
                if player.player_id == player_id {
                    player_entity = Some(entity);
                    break;
                }
            }

            if let Some(pe) = player_entity {
                let result = shard.process_action(pe, player_id, &action.action);

                let (success, message, despawned) = match result {
                    ff_ecs::systems::interaction::ActionResult::Success(msg) => (true, msg, None),
                    ff_ecs::systems::interaction::ActionResult::Failure(msg) => (false, msg, None),
                    ff_ecs::systems::interaction::ActionResult::SuccessWithDespawn(msg, eid) => {
                        (true, msg, Some(eid))
                    }
                };

                let response = ServerActionResult {
                    seq: action.seq,
                    success,
                    message: Some(message),
                };

                if let Ok(buf) = encode(MessageType::ServerActionResult, &response) {
                    if let Some(session) = shard.sessions.get(&player_id) {
                        session.send(buf);
                    }
                }

                if let Some(eid) = despawned {
                    let despawn = ServerEntityDespawn { entity_id: eid };
                    if let Ok(buf) = encode(MessageType::ServerEntityDespawn, &despawn) {
                        for session in shard.sessions.values() {
                            session.send(buf.clone());
                        }
                    }
                }

                // Push the player's latest state right after every action,
                // so Harvest / Eat / Sell visibly update the Property modal
                // without waiting for the next 0.5 s broadcast tick.
                if success {
                    tick::send_player_state(&mut shard, player_id);
                }
            }
        }
        MessageType::ClientPing => {
            let ping: ClientPing = decode_payload(payload)?;
            let pong = ServerPong {
                client_time_ms: ping.client_time_ms,
                server_time_ms: std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_millis() as u64,
            };
            if let Ok(buf) = encode(MessageType::ServerPong, &pong) {
                let shard = shard.lock().await;
                if let Some(session) = shard.sessions.get(&player_id) {
                    session.send(buf);
                }
            }
        }
        MessageType::ClientChat => {
            let chat: ClientChat = decode_payload(payload)?;
            let shard = shard.lock().await;

            let sender_name = shard
                .sessions
                .get(&player_id)
                .map(|s| s.player_name.clone())
                .unwrap_or_else(|| "???".into());

            let msg = ServerChat {
                sender: player_id,
                sender_name,
                message: chat.message,
            };

            if let Ok(buf) = encode(MessageType::ServerChat, &msg) {
                // Broadcast to all players
                for session in shard.sessions.values() {
                    session.send(buf.clone());
                }
            }
        }
        _ => {
            warn!("Unhandled message type: {:?}", msg_type);
        }
    }

    Ok(())
}

/// Simple string hash for generating player IDs.
fn hash_name(name: &str) -> u64 {
    let mut hash: u64 = 5381;
    for byte in name.bytes() {
        hash = hash.wrapping_mul(33).wrapping_add(byte as u64);
    }
    hash
}
