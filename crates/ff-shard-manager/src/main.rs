//! Shard Manager: gateway for player connections, load balancer across shards.
//!
//! Players connect here first, get assigned to a shard, then connect directly.

mod balancer;
mod health;
mod registry;

use ff_common::ShardId;
use ff_protocol::codec::{decode, decode_payload, encode};
use ff_protocol::messages::*;
use futures_util::{SinkExt, StreamExt};
use registry::ShardRegistry;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::Mutex;
use tokio_tungstenite::tungstenite::Message;
use tracing::{error, info, Level};

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_max_level(Level::INFO)
        .init();

    let addr: SocketAddr = std::env::var("GATEWAY_ADDR")
        .unwrap_or_else(|_| "0.0.0.0:8000".into())
        .parse()
        .expect("Invalid GATEWAY_ADDR");

    info!("Shard Manager listening on {addr}");

    let registry = Arc::new(Mutex::new(ShardRegistry::new()));

    // Register default shard (for development)
    {
        let mut reg = registry.lock().await;
        reg.register(
            ShardId(1),
            "127.0.0.1:9000".into(),
            ff_common::MAX_PLAYERS_PER_SHARD,
        );
    }

    // Start health check loop
    let health_registry = Arc::clone(&registry);
    tokio::spawn(async move {
        health::health_check_loop(health_registry).await;
    });

    let listener = TcpListener::bind(addr).await.expect("Failed to bind");

    loop {
        match listener.accept().await {
            Ok((stream, peer)) => {
                let reg = Arc::clone(&registry);
                tokio::spawn(handle_gateway_connection(stream, peer, reg));
            }
            Err(e) => error!("Accept error: {e}"),
        }
    }
}

async fn handle_gateway_connection(
    stream: TcpStream,
    peer: SocketAddr,
    registry: Arc<Mutex<ShardRegistry>>,
) {
    let ws = match tokio_tungstenite::accept_async(stream).await {
        Ok(ws) => ws,
        Err(e) => {
            error!("WS handshake failed for {peer}: {e}");
            return;
        }
    };

    let (mut sender, mut receiver) = ws.split();

    // Wait for ClientHello
    while let Some(msg) = receiver.next().await {
        match msg {
            Ok(Message::Binary(data)) => {
                let bytes: Vec<u8> = data.into();
                if let Ok((MessageType::ClientHello, payload)) = decode(&bytes) {
                    if let Ok(hello) = decode_payload::<ClientHello>(payload) {
                        info!("Gateway: player '{}' requesting shard", hello.player_name);

                        // Assign a shard
                        let reg = registry.lock().await;
                        if let Some(assignment) = balancer::assign_shard(&reg, &hello.player_name) {
                            if let Ok(buf) = encode(MessageType::ShardAssignment, &assignment) {
                                let _ = sender.send(Message::Binary(buf.into())).await;
                            }
                        } else {
                            error!("No available shards for player '{}'", hello.player_name);
                        }
                        break;
                    }
                }
            }
            Ok(Message::Close(_)) | Err(_) => break,
            _ => continue,
        }
    }
}
