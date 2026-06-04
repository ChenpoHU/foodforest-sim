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
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, Mutex};
use tokio_tungstenite::tungstenite::Message;
use tracing::{error, info, warn};

/// Monotonic counter to generate a unique `PlayerId` per WebSocket
/// connection. Previously we derived the id from `hash_name(player_name)`,
/// which collided whenever two clients used the same display name (the
/// default "Farmer" was a guaranteed collision). The second connect
/// would overwrite the first's session, and every server-bound action
/// got routed to the wrong WS.
static NEXT_PLAYER_ID: AtomicU64 = AtomicU64::new(1);

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
        "Player '{}' connected from {peer_addr} (mode={} region={} plot={} role={})",
        hello.player_name, hello.game_mode, hello.region_index, hello.plot_seed, hello.player_role
    );

    let (tx, mut rx) = mpsc::unbounded_channel::<Vec<u8>>();
    let player_id = PlayerId(NEXT_PLAYER_ID.fetch_add(1, Ordering::Relaxed));

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
        // Validate role against the (possibly already-set) mode. TechMonarch
        // is silently downgraded to Farmer outside Realistic.
        let role = ff_common::PlayerRole::from(hello.player_role)
            .validate_for_mode(shard.resources.game_mode);
        info!("  → role resolved as {:?}", role);
        // Disambiguate display name on collision (e.g. two players both
        // named "Farmer"). The Monarch's surveillance roster needs to be
        // able to tell them apart; player_id is already unique, this is
        // just for the human-visible name.
        let display_name = disambiguate_name(&hello.player_name, &shard);
        let session = PlayerSession::new(
            player_id,
            EntityId(0), // will be set below
            display_name.clone(),
            hello.player_name.clone(), // origin_name — key for persistent state
            tx,
        );
        let (eid, entity) = shard.add_player(player_id, display_name, session);

        // Restore persistent state (wallet, inventory, Monarch) if we
        // have any saved for this origin name. When `hello.traveling`
        // is true, we charge TRAVEL_COST from the restored wallet — if
        // the wallet can't cover it we still let them through (better
        // UX than denying the connection mid-flight), but their coins
        // saturate at zero. The client previews the cost before they
        // ever get here and disables the Travel button when broke, so
        // this branch is the safety net rather than the typical path.
        let persisted = shard.persistent_state.remove(&hello.player_name);
        let mut applied_travel_cost = 0u32;
        if let Some(p) = &persisted {
            // Wallet
            if let Ok(mut w) = shard.ecs_world.get::<&mut ff_ecs::components::player::Wallet>(entity) {
                w.0 = p.coins;
                if hello.traveling {
                    let cost = ff_common::TRAVEL_COST.min(w.0);
                    w.0 -= cost;
                    applied_travel_cost = cost;
                }
            }
            // Inventory
            if let Ok(mut inv) = shard.ecs_world.get::<&mut ff_ecs::components::player::Inventory>(entity) {
                inv.slots.clear();
                for &(item_id, count) in &p.inventory {
                    inv.add(item_id, count);
                }
            }
            // Monarch role (overrides the hello.player_role choice on
            // reconnect — once a monarch, stays a monarch).
            if let Some(m) = &p.monarch {
                let _ = shard.ecs_world.insert_one(entity, m.clone());
            }
        }
        // If we DIDN'T have persistent state for this player AND they
        // asked for TechMonarch in hello, install a default Monarch.
        if persisted.as_ref().and_then(|p| p.monarch.as_ref()).is_none()
            && role == ff_common::PlayerRole::TechMonarch
        {
            let _ = shard
                .ecs_world
                .insert_one(entity, ff_ecs::components::player::Monarch::default());
        }
        // Innovator role: install the component. We don't persist the
        // Innovator's research yet (a TODO alongside the wallet/monarch
        // persistence) — they start fresh on each connect for now.
        if role == ff_common::PlayerRole::Innovator {
            let _ = shard
                .ecs_world
                .insert_one(entity, ff_ecs::components::player::Innovator::default());
        }
        if hello.traveling {
            info!(
                "  → restored persistent state (traveling, -{} coins) for '{}'",
                applied_travel_cost, hello.player_name
            );
        } else if persisted.is_some() {
            info!("  → restored persistent state (rejoin) for '{}'", hello.player_name);
        }

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
            } else if shard.ecs_world.get::<&ff_ecs::components::ai_agent::SemiAIWorker>(_e).is_ok() {
                EntityKind::SemiAI
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

            let outfit = shard.ecs_world
                .get::<&ff_ecs::components::player::Outfit>(_e)
                .map(|o| o.0)
                .unwrap_or(0);
            snaps.push(EntitySnapshot {
                entity_id: net_id.0,
                kind,
                position: [pos.0.x, pos.0.y, pos.0.z],
                rotation: rot,
                state,
                outfit,
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

            // Update the surveillance tag so the Monarch sees "moving"
            // vs "idle" without us having to inspect every input.
            let moving = input.move_dir[0].abs() + input.move_dir[1].abs() > 0.01;
            if let Some(s) = shard.sessions.get_mut(&player_id) {
                let tag = if input.jump {
                    "jumping"
                } else if input.sprint && moving {
                    "sprinting"
                } else if moving {
                    "moving"
                } else {
                    "idle"
                };
                if s.last_action != tag {
                    s.last_action = tag.to_string();
                }
            }
        }
        MessageType::ClientAction => {
            let action: ClientAction = decode_payload(payload)?;
            let mut shard = shard.lock().await;

            // Record a short surveillance tag for this action.
            if let Some(s) = shard.sessions.get_mut(&player_id) {
                s.last_action = action_tag(&action.action);
            }

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

                // DeploySemiAI fan-out: the world spawn happens in the
                // ECS handler, but clients that joined BEFORE the drone
                // existed never received a kind tag for the new entity
                // (ServerBatchUpdate carries position only). Push a
                // ServerEntitySpawn so every connected client renders
                // the drone with the right mesh, not the gray fallback.
                if success {
                    if let ff_protocol::messages::ActionKind::DeploySemiAI { .. } =
                        &action.action
                    {
                        // Find the newest SemiAI worker owned by this player —
                        // it's the one we just spawned.
                        let mut newest: Option<(EntityId, [f32; 3], f32)> = None;
                        for (e, (net_id, owner, pos)) in shard
                            .ecs_world
                            .query::<(
                                &ff_ecs::components::identity::NetworkId,
                                &ff_ecs::components::identity::Owner,
                                &ff_ecs::components::transform::Position,
                            )>()
                            .iter()
                        {
                            if owner.0 != player_id {
                                continue;
                            }
                            if shard
                                .ecs_world
                                .get::<&ff_ecs::components::ai_agent::SemiAIWorker>(e)
                                .is_err()
                            {
                                continue;
                            }
                            let rot = shard
                                .ecs_world
                                .get::<&ff_ecs::components::transform::Rotation>(e)
                                .map(|r| r.0)
                                .unwrap_or(0.0);
                            if newest.is_none() || newest.unwrap().0 .0 < net_id.0 .0 {
                                newest = Some((net_id.0, [pos.0.x, pos.0.y, pos.0.z], rot));
                            }
                        }
                        if let Some((entity_id, position, rotation)) = newest {
                            let snap = EntitySnapshot {
                                entity_id,
                                kind: EntityKind::SemiAI,
                                position,
                                rotation,
                                state: EntityState::Active,
                                outfit: 0,
                            };
                            let spawn = ServerEntitySpawn { entity: snap };
                            if let Ok(buf) = encode(MessageType::ServerEntitySpawn, &spawn) {
                                for session in shard.sessions.values() {
                                    session.send(buf.clone());
                                }
                            }
                        }
                    }
                }

                // Craft fan-out — when a player puts on (or takes off) an
                // outfit, their avatar's appearance changes. Re-broadcast a
                // ServerEntitySpawn for the player's own entity so every
                // connected client (and the player themselves, in third
                // person) re-skins the avatar with the new outfit id.
                if success {
                    if let ff_protocol::messages::ActionKind::Craft { .. } = &action.action {
                        if let Ok(net_id) = shard
                            .ecs_world
                            .get::<&ff_ecs::components::identity::NetworkId>(pe)
                        {
                            let pos = shard
                                .ecs_world
                                .get::<&ff_ecs::components::transform::Position>(pe)
                                .map(|p| [p.0.x, p.0.y, p.0.z])
                                .unwrap_or([0.0, 0.0, 0.0]);
                            let rot = shard
                                .ecs_world
                                .get::<&ff_ecs::components::transform::Rotation>(pe)
                                .map(|r| r.0)
                                .unwrap_or(0.0);
                            let outfit = shard
                                .ecs_world
                                .get::<&ff_ecs::components::player::Outfit>(pe)
                                .map(|o| o.0)
                                .unwrap_or(0);
                            let snap = EntitySnapshot {
                                entity_id: net_id.0,
                                kind: EntityKind::Player,
                                position: pos,
                                rotation: rot,
                                state: EntityState::Active,
                                outfit,
                            };
                            let spawn = ServerEntitySpawn { entity: snap };
                            if let Ok(buf) = encode(MessageType::ServerEntitySpawn, &spawn) {
                                for session in shard.sessions.values() {
                                    session.send(buf.clone());
                                }
                            }
                        }
                    }
                }

                // Propaganda fan-out — the ECS handler validates and
                // charges Influence; the broadcast itself is a network
                // side-effect, so we issue it here from the WS layer
                // where the session map lives.
                if success {
                    if let ff_protocol::messages::ActionKind::Propaganda { tone, message } =
                        &action.action
                    {
                        let from_name = shard
                            .sessions
                            .get(&player_id)
                            .map(|s| s.player_name.clone())
                            .unwrap_or_else(|| "Tech Monarch".into());
                        let bc = ServerStateBroadcast {
                            from_player: player_id,
                            from_name,
                            tone: *tone,
                            message: message.trim().to_string(),
                        };
                        if let Ok(buf) = encode(MessageType::ServerStateBroadcast, &bc) {
                            for session in shard.sessions.values() {
                                session.send(buf.clone());
                            }
                        }
                    }
                }

                // GrantUbi multi-recipient fan-out: when target=0 the
                // ECS handler just validates the Monarch role; the
                // actual credit pass is done here so we can see every
                // session and credit each connected farmer atomically.
                if success {
                    if let ff_protocol::messages::ActionKind::GrantUbi {
                        target_player_id: 0,
                        amount,
                    } = &action.action
                    {
                        // Collect farmer entities (anyone NOT a Monarch).
                        let mut farmer_entities: Vec<(hecs::Entity, ff_common::PlayerId)> =
                            Vec::new();
                        for (e, player) in shard
                            .ecs_world
                            .query::<&ff_ecs::components::player::Player>()
                            .iter()
                        {
                            if player.player_id == player_id {
                                continue;
                            }
                            if !shard.sessions.contains_key(&player.player_id) {
                                continue;
                            }
                            if shard
                                .ecs_world
                                .get::<&ff_ecs::components::player::Monarch>(e)
                                .is_ok()
                            {
                                continue;
                            }
                            farmer_entities.push((e, player.player_id));
                        }
                        let total_cost = (*amount as u64) * (farmer_entities.len() as u64);
                        let monarch_balance = shard
                            .ecs_world
                            .query_one::<&ff_ecs::components::player::Wallet>(pe)
                            .ok()
                            .and_then(|mut q| q.get().map(|w| w.0 as u64))
                            .unwrap_or(0);
                        if total_cost > monarch_balance {
                            // Tell the monarch we couldn't afford it.
                            let resp = ServerActionResult {
                                seq: action.seq,
                                success: false,
                                message: Some(format!(
                                    "Not enough coin: need {} ({} × {}) but have {}",
                                    total_cost,
                                    amount,
                                    farmer_entities.len(),
                                    monarch_balance
                                )),
                            };
                            if let Ok(buf) = encode(MessageType::ServerActionResult, &resp) {
                                if let Some(session) = shard.sessions.get(&player_id) {
                                    session.send(buf);
                                }
                            }
                        } else if farmer_entities.is_empty() {
                            let resp = ServerActionResult {
                                seq: action.seq,
                                success: false,
                                message: Some("No farmers connected to receive UBI".into()),
                            };
                            if let Ok(buf) = encode(MessageType::ServerActionResult, &resp) {
                                if let Some(session) = shard.sessions.get(&player_id) {
                                    session.send(buf);
                                }
                            }
                        } else {
                            // Debit monarch.
                            if let Ok(mut w) = shard
                                .ecs_world
                                .get::<&mut ff_ecs::components::player::Wallet>(pe)
                            {
                                w.0 = w.0.saturating_sub(total_cost as u32);
                            }
                            // Credit each farmer + push their player state.
                            for (fe, fpid) in &farmer_entities {
                                if let Ok(mut w) = shard
                                    .ecs_world
                                    .get::<&mut ff_ecs::components::player::Wallet>(*fe)
                                {
                                    w.0 = w.0.saturating_add(*amount);
                                }
                                tick::send_player_state(&mut shard, *fpid);
                            }
                            // Drop a state broadcast so everyone sees the gift.
                            let from_name = shard
                                .sessions
                                .get(&player_id)
                                .map(|s| s.player_name.clone())
                                .unwrap_or_else(|| "Tech Monarch".into());
                            let bc = ServerStateBroadcast {
                                from_player: player_id,
                                from_name,
                                tone: 1, // Rally
                                message: format!(
                                    "UBI distributed: {} coins to {} farmers",
                                    amount,
                                    farmer_entities.len()
                                ),
                            };
                            if let Ok(buf) = encode(MessageType::ServerStateBroadcast, &bc) {
                                for session in shard.sessions.values() {
                                    session.send(buf.clone());
                                }
                            }
                        }
                    }
                }

                // GrantUbi single-recipient: the ECS handler already
                // performed the transfer. We just need to push fresh
                // ServerPlayerState to the recipient so their HUD updates.
                if success {
                    if let ff_protocol::messages::ActionKind::GrantUbi {
                        target_player_id,
                        ..
                    } = &action.action
                    {
                        if *target_player_id != 0 {
                            tick::send_player_state(
                                &mut shard,
                                ff_common::PlayerId(*target_player_id),
                            );
                        }
                    }
                }

                // Innovator's DeployBreakthrough: ECS handler debited
                // Knowledge + validated the kind. We end the active
                // catastrophe here (the catastrophe lives on resources,
                // and the ECS handler can't mutate that and a player
                // component in the same borrow scope). The clear sets
                // a `dirty` flag that tick.rs's catastrophe broadcaster
                // picks up next pass.
                if success {
                    if let ff_protocol::messages::ActionKind::DeployBreakthrough { .. } =
                        &action.action
                    {
                        ff_ecs::systems::catastrophe::resolve_active(&mut shard.resources);
                        // Inform every connected player immediately so
                        // they see the banner clear without waiting for
                        // the 1 Hz broadcast tick.
                        let cleared = ff_protocol::messages::ServerCatastrophe {
                            kind: 0, intensity: 0.0, ticks_remaining: 0,
                            message: "Breakthrough deployed — catastrophe averted".into(),
                        };
                        if let Ok(buf) = encode(MessageType::ServerCatastrophe, &cleared) {
                            for session in shard.sessions.values() {
                                session.send(buf.clone());
                            }
                        }
                    }
                }

                // AscendToMonarch: ECS handler charged the wallet. Now
                // attach the Monarch component server-side and broadcast
                // the role change so every client (including the
                // ascending one) flips their toolbar.
                if success {
                    if let ff_protocol::messages::ActionKind::AscendToMonarch = &action.action {
                        let _ = shard.ecs_world.insert_one(
                            pe,
                            ff_ecs::components::player::Monarch::default(),
                        );
                        let player_name = shard
                            .sessions
                            .get(&player_id)
                            .map(|s| s.player_name.clone())
                            .unwrap_or_default();
                        let change = ff_protocol::messages::ServerRoleChanged {
                            player_id,
                            player_name,
                            new_role: 1,
                            reason: ff_protocol::messages::RoleChangeReason::Ascended,
                        };
                        if let Ok(buf) = encode(MessageType::ServerRoleChanged, &change) {
                            for session in shard.sessions.values() {
                                session.send(buf.clone());
                            }
                        }
                        // Push fresh state so the ascending player's HUD
                        // flips to Monarch instantly (compute meter
                        // appears with the default 100/100).
                        tick::send_player_state(&mut shard, player_id);
                    }
                }

                // Revolt: ECS handler already bumped discontent. The
                // tick.rs threshold check will demote the target if the
                // bar fills. Just push fresh state to the target so the
                // bar moves on their HUD without waiting 1 s for the
                // politics broadcast.
                if success {
                    if let ff_protocol::messages::ActionKind::Revolt { target_monarch_id } =
                        &action.action
                    {
                        tick::send_player_state(
                            &mut shard,
                            ff_common::PlayerId(*target_monarch_id),
                        );
                    }
                }

                // IssueTask: ECS handler escrowed reward + charged
                // Influence. Now register the task in the shard's
                // active_tasks map and broadcast it to every session.
                if success {
                    if let ff_protocol::messages::ActionKind::IssueTask {
                        tone,
                        message,
                        task_kind,
                        target,
                        reward,
                    } = &action.action
                    {
                        let monarch_name = shard
                            .sessions
                            .get(&player_id)
                            .map(|s| s.player_name.clone())
                            .unwrap_or_else(|| "Tech Monarch".into());
                        let task_id = shard.next_task_id;
                        shard.next_task_id = shard.next_task_id.saturating_add(1);
                        let task = crate::shard::MonarchTask {
                            id: task_id,
                            monarch_id: player_id,
                            monarch_name: monarch_name.clone(),
                            tone: *tone,
                            message: message.trim().to_string(),
                            task_kind: *task_kind,
                            target: *target,
                            reward: *reward,
                        };
                        shard.active_tasks.insert(task_id, task);
                        let bc = ServerTaskBroadcast {
                            task_id,
                            monarch_id: player_id,
                            monarch_name,
                            tone: *tone,
                            message: message.trim().to_string(),
                            task_kind: *task_kind,
                            target: *target,
                            reward: *reward,
                        };
                        if let Ok(buf) = encode(MessageType::ServerTaskBroadcast, &bc) {
                            for session in shard.sessions.values() {
                                session.send(buf.clone());
                            }
                        }
                    }
                }

                // Task-progress tracking: every successful action that
                // matches an active task kind bumps the issuing player's
                // progress. Tasks are NOT winner-take-all — every farmer
                // who hits the target gets paid out of the Monarch's
                // wallet at claim time. Each player can only claim a
                // given task once. If the Monarch can't cover a payout
                // the task is cancelled and all open progress is dropped.
                if success {
                    let completions = bump_task_progress(&mut shard, player_id, &action.action);
                    for (task_id, reward, winner_name) in completions {
                        // Look up the issuing Monarch and their wallet.
                        let monarch_id = match shard.active_tasks.get(&task_id) {
                            Some(t) => t.monarch_id,
                            None => continue, // already cancelled in this batch
                        };
                        let mut monarch_entity = None;
                        let mut winner_entity = None;
                        for (e, p) in shard
                            .ecs_world
                            .query::<&ff_ecs::components::player::Player>()
                            .iter()
                        {
                            if p.player_id == monarch_id {
                                monarch_entity = Some(e);
                            } else if p.player_id == player_id {
                                winner_entity = Some(e);
                            }
                        }
                        let monarch_balance = monarch_entity
                            .and_then(|e| {
                                shard
                                    .ecs_world
                                    .get::<&ff_ecs::components::player::Wallet>(e)
                                    .map(|w| w.0)
                                    .ok()
                            })
                            .unwrap_or(0);

                        // Can the monarch pay? If not, cancel the task
                        // and notify everyone — fairer than partially
                        // paying or silently dropping the claim.
                        if monarch_balance < reward {
                            shard.active_tasks.remove(&task_id);
                            shard
                                .task_progress
                                .retain(|(tid, _), _| *tid != task_id);
                            // Reuse ServerTaskComplete with reward = 0 +
                            // winner_id = 0 to signal "task defunded".
                            let bc = ServerTaskComplete {
                                task_id,
                                winner_id: ff_common::PlayerId(0),
                                winner_name: "(defunded)".into(),
                                reward: 0,
                                monarch_id,
                            };
                            if let Ok(buf) = encode(MessageType::ServerTaskComplete, &bc) {
                                for session in shard.sessions.values() {
                                    session.send(buf.clone());
                                }
                            }
                            continue;
                        }

                        // Debit Monarch, credit winner.
                        if let Some(me) = monarch_entity {
                            if let Ok(mut w) = shard
                                .ecs_world
                                .get::<&mut ff_ecs::components::player::Wallet>(me)
                            {
                                w.0 = w.0.saturating_sub(reward);
                            }
                        }
                        if let Some(we) = winner_entity {
                            if let Ok(mut w) = shard
                                .ecs_world
                                .get::<&mut ff_ecs::components::player::Wallet>(we)
                            {
                                w.0 = w.0.saturating_add(reward);
                            }
                        }

                        let bc = ServerTaskComplete {
                            task_id,
                            winner_id: player_id,
                            winner_name: winner_name.clone(),
                            reward,
                            monarch_id,
                        };
                        if let Ok(buf) = encode(MessageType::ServerTaskComplete, &bc) {
                            for session in shard.sessions.values() {
                                session.send(buf.clone());
                            }
                        }
                        // Refresh both players' HUDs so wallet changes
                        // appear instantly (without waiting for the
                        // next 0.5 s heartbeat).
                        tick::send_player_state(&mut shard, player_id);
                        tick::send_player_state(&mut shard, monarch_id);
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

/// Returns `true` if a `ClientAction` counts toward a task of the given
/// kind. Task-kind discriminants:
///   0 = Plant  (any `PlantSeed`)
///   1 = Harvest (any `Harvest`)
///   2 = CutTree (`CutTree` — counted on the SuccessWithDespawn path)
///   3 = Hunt    (`HuntAnimal`)
fn action_matches_task(action: &ff_protocol::messages::ActionKind, task_kind: u8) -> bool {
    use ff_protocol::messages::ActionKind::*;
    match (task_kind, action) {
        (0, PlantSeed { .. }) => true,
        (1, Harvest { .. }) => true,
        (2, CutTree { .. }) => true,
        (3, HuntAnimal { .. }) => true,
        _ => false,
    }
}

/// Walks every active task and bumps the actor's progress against
/// matching ones. Returns the list of `(task_id, reward, winner_name)`
/// for tasks the caller just completed THIS TICK — the caller pays from
/// the Monarch's wallet and fans out `ServerTaskComplete`.
///
/// Excludes the issuing Monarch's own actions. Per-player progress is
/// capped at `target + 1` so each player can only claim each task once
/// (further matching actions don't bump or re-trigger completion).
fn bump_task_progress(
    shard: &mut crate::shard::Shard,
    actor: PlayerId,
    action: &ff_protocol::messages::ActionKind,
) -> Vec<(u32, u32, String)> {
    // Snapshot task info so we can mutate task_progress while iterating.
    let task_infos: Vec<(u32, u8, u32, u32, PlayerId)> = shard
        .active_tasks
        .values()
        .map(|t| (t.id, t.task_kind, t.target, t.reward, t.monarch_id))
        .collect();
    if task_infos.is_empty() {
        return Vec::new();
    }
    let actor_name = shard
        .sessions
        .get(&actor)
        .map(|s| s.player_name.clone())
        .unwrap_or_else(|| "?".into());
    let mut completed = Vec::new();
    for (task_id, task_kind, target, reward, monarch_id) in task_infos {
        if monarch_id == actor {
            continue;
        }
        if !action_matches_task(action, task_kind) {
            continue;
        }
        let key = (task_id, actor);
        let progress = shard.task_progress.entry(key).or_insert(0);
        // Already claimed (sentinel: target + 1 means paid out)?
        if *progress > target {
            continue;
        }
        *progress = progress.saturating_add(1);
        if *progress == target {
            // Just hit target — record the completion and lift the
            // progress one more so we never re-trigger.
            *progress = target.saturating_add(1);
            completed.push((task_id, reward, actor_name.clone()));
        }
    }
    completed
}

/// If `desired` is already in use as a display name, append " #2",
/// " #3", … until a free slot is found. Player ids are still unique
/// either way; this is purely so a Monarch can tell two "Farmer"s apart
/// in the surveillance roster and decision log.
fn disambiguate_name(desired: &str, shard: &Shard) -> String {
    let exists = |candidate: &str| {
        shard.sessions.values().any(|s| s.player_name == candidate)
    };
    if !exists(desired) {
        return desired.to_string();
    }
    let mut n = 2;
    loop {
        let candidate = format!("{} #{}", desired, n);
        if !exists(&candidate) {
            return candidate;
        }
        n += 1;
    }
}

/// Short human-readable tag for the surveillance feed.
fn action_tag(action: &ff_protocol::messages::ActionKind) -> String {
    use ff_protocol::messages::ActionKind::*;
    match action {
        PlantSeed { species_id, .. } => format!("plant #{species_id}"),
        Harvest { .. } => "harvest".into(),
        Dig { .. } => "dig".into(),
        Water { .. } => "water".into(),
        BuildSwale { .. } => "build swale".into(),
        BuildHugelBed { .. } => "build hugel".into(),
        AddMulch { .. } => "mulch".into(),
        FeedAnimal { .. } => "feed animal".into(),
        TradeNpc { .. } => "trade".into(),
        PickUp { .. } => "pick up".into(),
        CutTree { .. } => "cut tree".into(),
        Inspect { .. } => "inspect".into(),
        HuntAnimal { .. } => "hunt".into(),
        BuildHochsitz { .. } => "build hochsitz".into(),
        EatItem { .. } => "eat".into(),
        SellItem { .. } => "sell".into(),
        DeploySemiAI { .. } => "deploy AI".into(),
        Propaganda { tone, .. } => match tone {
            1 => "rally broadcast".into(),
            2 => "crisis broadcast".into(),
            _ => "decree broadcast".into(),
        },
        GrantUbi { target_player_id, amount } => {
            if *target_player_id == 0 {
                format!("UBI {} all", amount)
            } else {
                format!("UBI {} → {}", amount, target_player_id)
            }
        }
        IssueTask { task_kind, target, reward, .. } => {
            let kind = match task_kind {
                0 => "plant",
                1 => "harvest",
                2 => "cut tree",
                3 => "hunt",
                _ => "task",
            };
            format!("issued task: {kind} ×{target} (🪙{reward})")
        }
        AscendToMonarch => "ascending".into(),
        Revolt { .. } => "revolting".into(),
        Research { topic } => {
            let name = match topic {
                0 => "Climate", 1 => "Medicine", 2 => "Defense",
                3 => "Food",   _ => "Topic?"
            };
            format!("researching {name}")
        }
        DeployBreakthrough { kind } => {
            let name = match kind {
                0 => "Vaccine", 1 => "Solar Shield", 2 => "Drought-resistant Seeds",
                3 => "Decontamination", 4 => "Deflector", _ => "Breakthrough"
            };
            format!("deploying {name}")
        }
        Craft { recipe } => match recipe {
            0 => "crafting tunic".into(),
            1 => "crafting fur coat".into(),
            255 => "undressing".into(),
            _ => "crafting".into(),
        },
    }
}
