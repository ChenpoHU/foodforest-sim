//! JSON **Agent API** — the open door (see `md/08-agent-api.md`).
//!
//! External agents (incl. LLMs like Claude/GPT) and the game's own house
//! learning AI connect to the *same* WebSocket endpoint humans use, but speak
//! **JSON text frames** instead of the binary protocol. Detection is by frame
//! type: a Text frame whose first message is `{"op":"register",…}` enters this
//! handler; humans send Binary `ClientHello`.
//!
//! Wire shape (all newline-free JSON text frames):
//!   • agent → server: `{"op":"register", name, world, region, role, label}`
//!   • server → agent: `{"op":"welcome", player_id, entity_id, …, actions:[…]}`
//!   • server → agent (every `obs_ms`): `{"op":"obs", tick, self, nearby, world, reward}`
//!   • agent → server (any time): `{"op":"plant", species, x, z}` etc. (see §Actions)
//!
//! Every action — agent OR human — is appended to the anonymised behaviour log
//! that trains the house AI (`crate::behaviour_log`).

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use glam::Vec3;
use tokio::net::TcpStream;
use tokio::sync::Mutex;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::WebSocketStream;

use ff_common::{EntityId, GameMode, PlayerId, PlayerRole};
use ff_protocol::ActionKind;

use crate::behaviour_log;
use crate::session::PlayerSession;
use crate::shard::Shard;

type WsSink = futures_util::stream::SplitSink<WebSocketStream<TcpStream>, Message>;
type WsStream = futures_util::stream::SplitStream<WebSocketStream<TcpStream>>;

const MOVE_SPEED: f32 = 4.0;
const OBS_MS: u64 = 500;
const MAX_NEARBY: usize = 40;

/// Parsed `register` frame.
pub struct AgentRegister {
    pub name: String,
    pub world: u8,
    pub region: u8,
    pub role: u8,
    pub label: String,
}

/// Returns `Some` if `text` is a well-formed `{"op":"register",…}` frame.
pub fn parse_register(text: &str) -> Option<AgentRegister> {
    let v: serde_json::Value = serde_json::from_str(text).ok()?;
    if v.get("op")?.as_str()? != "register" {
        return None;
    }
    Some(AgentRegister {
        name: v.get("name").and_then(|x| x.as_str()).unwrap_or("Agent").to_string(),
        world: v.get("world").and_then(|x| x.as_u64()).unwrap_or(1) as u8,
        region: v.get("region").and_then(|x| x.as_u64()).unwrap_or(0) as u8,
        role: v.get("role").and_then(|x| x.as_u64()).unwrap_or(0) as u8,
        label: v.get("label").and_then(|x| x.as_str()).unwrap_or("agent").to_string(),
    })
}

/// Drive one agent connection start-to-finish: create its player, stream it
/// JSON observations, apply its JSON actions, and clean up on disconnect.
pub async fn handle_agent_connection(
    mut sink: WsSink,
    mut stream: WsStream,
    shard: Arc<Mutex<Shard>>,
    reg: AgentRegister,
    peer: SocketAddr,
) {
    let player_id = crate::net::ws::next_player_id();

    // ── Create the agent's player entity (a minimal version of the human
    //    hello path — no persistence/travel for v1). ─────────────────────
    let entity_eid = {
        let mut s = shard.lock().await;
        // The first connection of any kind sets the world's mode.
        if s.sessions.is_empty() {
            s.resources.game_mode = GameMode::from(reg.world);
        }
        let role = PlayerRole::from(reg.role); // honoured in every world now
        let base = crate::net::ws::disambiguate_name(&reg.name, &s);
        let display = format!("🤖 {base}");

        // Agents read JSON, not the binary broadcast stream — give the session
        // a channel whose receiver is drained+discarded so broadcasts never
        // accumulate and `session.send` always succeeds (no spurious kick).
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
        tokio::spawn(async move { while rx.recv().await.is_some() {} });

        let mut session = PlayerSession::new(
            player_id,
            EntityId(0),
            display.clone(),
            reg.name.clone(),
            tx,
        );
        session.is_ai = true;
        session.agent_label = reg.label.clone();

        let (eid, entity) = s.add_player(player_id, display, session);
        if let Some(sess) = s.sessions.get_mut(&player_id) {
            sess.entity_id = eid;
        }
        match role {
            // TechMonarch and the AI faction both deploy automation (Monarch).
            PlayerRole::TechMonarch | PlayerRole::Ai => {
                let _ = s.ecs_world.insert_one(entity, ff_ecs::components::player::Monarch::default());
            }
            PlayerRole::Innovator => {
                let _ = s.ecs_world.insert_one(entity, ff_ecs::components::player::Innovator::default());
            }
            PlayerRole::Farmer => {}
        }
        let _ = s.ecs_world.insert_one(
            entity,
            ff_ecs::components::player::AiControlled { label: reg.label.clone() },
        );
        (entity, eid)
    };
    let (entity, eid) = entity_eid;

    // ── Welcome ────────────────────────────────────────────────────────
    let welcome = serde_json::json!({
        "op": "welcome",
        "player_id": player_id.0,
        "entity_id": eid.0,
        "world": reg.world,
        "region": reg.region,
        "role": reg.role,
        "tick_rate": ff_common::TICK_RATE,
        "obs_ms": OBS_MS,
        "actions": ["move","plant","harvest","water","hunt","eat","sell","cut_tree","inspect"],
    });
    if sink.send(Message::Text(welcome.to_string().into())).await.is_err() {
        let mut s = shard.lock().await;
        s.remove_player(player_id);
        return;
    }
    tracing::info!("🤖 agent '{}' [{}] joined as role {} from {peer}", reg.name, reg.label, reg.role);

    // ── Perceive / act loop ────────────────────────────────────────────
    let mut obs_timer = tokio::time::interval(Duration::from_millis(OBS_MS));
    let mut last_coins: i64 = 0;
    loop {
        tokio::select! {
            _ = obs_timer.tick() => {
                let json = {
                    let mut s = shard.lock().await;
                    // Per-step movement: damp horizontal velocity so a stale
                    // `move` can't make the agent drift forever; the agent
                    // re-issues `move` each step to keep going.
                    if let Ok(mut v) = s.ecs_world.get::<&mut ff_ecs::components::transform::Velocity>(entity) {
                        v.0.x = 0.0;
                        v.0.z = 0.0;
                    }
                    build_observation(&s, entity, &mut last_coins)
                };
                match json {
                    Some(j) => {
                        if sink.send(Message::Text(j.to_string().into())).await.is_err() { break; }
                    }
                    None => break, // entity gone (died / despawned)
                }
            }
            incoming = stream.next() => {
                match incoming {
                    Some(Ok(Message::Text(t))) => {
                        let txt = t.to_string();
                        let mut s = shard.lock().await;
                        apply_agent_message(&mut s, entity, player_id, &txt);
                    }
                    Some(Ok(Message::Ping(p))) => { let _ = sink.send(Message::Pong(p)).await; }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Err(_)) => break,
                    _ => {}
                }
            }
        }
    }

    // ── Cleanup ────────────────────────────────────────────────────────
    {
        let mut s = shard.lock().await;
        s.remove_player(player_id);
    }
    tracing::info!("🤖 agent '{}' disconnected", reg.name);
}

/// Compact, agent-centric JSON observation built from the player's local view.
/// `None` if the entity no longer exists (death / despawn).
fn build_observation(s: &Shard, entity: hecs::Entity, last_coins: &mut i64) -> Option<serde_json::Value> {
    use ff_ecs::components::{animal::Animal, identity::NetworkId, plant::Plant, player, transform::Position};

    let pos = s.ecs_world.get::<&Position>(entity).ok()?.0;
    let stamina = s.ecs_world.get::<&player::Stamina>(entity).map(|x| x.0).unwrap_or(0.0);
    let hunger = s.ecs_world.get::<&player::Hunger>(entity).map(|x| x.0).unwrap_or(0.0);
    let coins = s.ecs_world.get::<&player::Wallet>(entity).map(|x| x.0).unwrap_or(0) as i64;
    let role: u8 = if s.ecs_world.get::<&player::Innovator>(entity).is_ok() {
        2
    } else if s.ecs_world.get::<&player::Monarch>(entity).is_ok() {
        1
    } else {
        0
    };
    let inv: Vec<serde_json::Value> = s
        .ecs_world
        .get::<&player::Inventory>(entity)
        .map(|i| i.slots.iter().map(|st| serde_json::json!({"item": st.item_id, "n": st.count})).collect())
        .unwrap_or_default();

    let reward = coins - *last_coins;
    *last_coins = coins;

    // Nearest entities within area-of-interest.
    let aoi = ff_common::AOI_RADIUS;
    let mut near: Vec<(f32, serde_json::Value)> = Vec::new();
    for (e, (nid, p)) in s.ecs_world.query::<(&NetworkId, &Position)>().iter() {
        if e == entity {
            continue;
        }
        let d = (p.0 - pos).length();
        if d > aoi {
            continue;
        }
        let (kind, species, stage) = if let Ok(pl) = s.ecs_world.get::<&Plant>(e) {
            ("plant", pl.species_id as i64, pl.growth_stage as u8 as i64)
        } else if let Ok(an) = s.ecs_world.get::<&Animal>(e) {
            ("animal", an.species_id as i64, -1)
        } else if s.ecs_world.get::<&player::AiControlled>(e).is_ok() {
            ("ai", -1, -1)
        } else if s.ecs_world.get::<&player::Player>(e).is_ok() {
            ("player", -1, -1)
        } else {
            ("other", -1, -1)
        };
        near.push((
            d,
            serde_json::json!({
                "id": nid.0.0, "kind": kind, "species": species, "stage": stage,
                "pos": [round2(p.0.x), round2(p.0.y), round2(p.0.z)], "dist": round2(d),
            }),
        ));
    }
    near.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    let nearby: Vec<serde_json::Value> = near.into_iter().take(MAX_NEARBY).map(|(_, v)| v).collect();

    Some(serde_json::json!({
        "op": "obs",
        "tick": s.resources.calendar.tick.0,
        "self": {
            "pos": [round2(pos.x), round2(pos.y), round2(pos.z)],
            "hunger": round2(hunger), "stamina": round2(stamina),
            "coins": coins, "role": role, "inv": inv,
        },
        "nearby": nearby,
        "world": {
            "catastrophe": { "kind": s.resources.catastrophe.kind as u8, "intensity": round2(s.resources.catastrophe.intensity) },
        },
        "reward": reward,
    }))
}

/// Apply one JSON action frame. Maps the agent's verb to the same `ActionKind`
/// a human would send, then records it to the behaviour log.
fn apply_agent_message(s: &mut Shard, entity: hecs::Entity, player_id: PlayerId, text: &str) {
    let v: serde_json::Value = match serde_json::from_str(text) {
        Ok(v) => v,
        Err(_) => return,
    };
    let op = v.get("op").and_then(|x| x.as_str()).unwrap_or("");
    let geti = |k: &str| v.get(k).and_then(|x| x.as_i64());
    let getf = |k: &str| v.get(k).and_then(|x| x.as_f64()).map(|f| f as f32);

    // Movement is handled directly (no ActionKind); everything else maps to
    // the shared interaction pipeline.
    if op == "move" {
        let dx = getf("dx").unwrap_or(0.0);
        let dz = getf("dz").unwrap_or(0.0);
        let len = (dx * dx + dz * dz).sqrt();
        if let Ok(mut vel) = s.ecs_world.get::<&mut ff_ecs::components::transform::Velocity>(entity) {
            if len > 1e-3 {
                vel.0 += Vec3::new(dx / len * MOVE_SPEED, 0.0, dz / len * MOVE_SPEED);
            }
        }
        behaviour_log::record_action(
            s.resources.calendar.tick.0, player_id.0, true, role_u8(s, entity), "move",
            serde_json::json!({"dx": dx, "dz": dz}), true, None, None,
        );
        return;
    }

    let action: Option<ActionKind> = match op {
        "plant" => Some(ActionKind::PlantSeed {
            species_id: geti("species").unwrap_or(500) as u16,
            position: [geti("x").unwrap_or(0) as i32, 0, geti("z").unwrap_or(0) as i32],
        }),
        "harvest" => geti("target").map(|t| ActionKind::Harvest { entity_id: EntityId(t as u64) }),
        "water" => Some(ActionKind::Water {
            position: [geti("x").unwrap_or(0) as i32, 0, geti("z").unwrap_or(0) as i32],
            radius: 3,
        }),
        "hunt" => geti("target").map(|t| ActionKind::HuntAnimal { entity_id: EntityId(t as u64) }),
        "cut_tree" => geti("target").map(|t| ActionKind::CutTree { entity_id: EntityId(t as u64) }),
        "inspect" => geti("target").map(|t| ActionKind::Inspect { entity_id: EntityId(t as u64) }),
        "eat" => Some(ActionKind::EatItem { item_id: geti("item").unwrap_or(0) as u16 }),
        "sell" => Some(ActionKind::SellItem {
            item_id: geti("item").unwrap_or(0) as u16,
            count: geti("count").unwrap_or(1) as u16,
        }),
        _ => None,
    };

    if let Some(act) = action {
        // Pre-action context for teaching the house brain by imitation
        // (external agents — incl. LLMs — count among "all players").
        let a_role = role_u8(s, entity);
        let a_mact = ff_ecs::systems::house_ai::macro_action_of(&act);
        let a_feats: Option<[f32; ff_ecs::components::player::HOUSE_AI_FEATURES]> =
            a_mact.map(|_| ff_ecs::systems::house_ai::extract_features(&s.ecs_world, entity, &s.resources));

        let result = s.process_action(entity, player_id, &act);
        let ok = matches!(
            result,
            ff_ecs::systems::interaction::ActionResult::Success(_)
                | ff_ecs::systems::interaction::ActionResult::SuccessWithDespawn(_, _)
        );
        behaviour_log::record_action(
            s.resources.calendar.tick.0,
            player_id.0,
            true,
            a_role,
            op,
            v.get("args").cloned().unwrap_or(serde_json::json!({})),
            ok,
            a_mact.map(|m| m as u8),
            a_feats.as_ref().map(|f| f.as_slice()),
        );
        if ok {
            if let (Some(m), Some(f)) = (a_mact, a_feats.as_ref()) {
                s.house_brain.imitate(f, m, a_role);
            }
        }
    }
}

fn role_u8(s: &Shard, entity: hecs::Entity) -> u8 {
    use ff_ecs::components::player;
    if s.ecs_world.get::<&player::Innovator>(entity).is_ok() {
        2
    } else if s.ecs_world.get::<&player::Monarch>(entity).is_ok() {
        1
    } else {
        0
    }
}

fn round2(x: f32) -> f32 {
    (x * 100.0).round() / 100.0
}
