//! Binary codec: frame layout is [u16 msg_type][u32 payload_len][payload].

use crate::messages::MessageType;
use serde::{Deserialize, Serialize};

#[derive(Debug)]
pub enum ProtocolError {
    TooShort,
    InvalidMessageType(u16),
    EncodeFailed(String),
    DecodeFailed(String),
}

impl std::fmt::Display for ProtocolError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::TooShort => write!(f, "message too short (need at least 6 bytes)"),
            Self::InvalidMessageType(t) => write!(f, "invalid message type: 0x{t:04X}"),
            Self::EncodeFailed(e) => write!(f, "encode failed: {e}"),
            Self::DecodeFailed(e) => write!(f, "decode failed: {e}"),
        }
    }
}

impl std::error::Error for ProtocolError {}

/// Header size: 2 bytes msg_type + 4 bytes payload length.
const HEADER_SIZE: usize = 6;

/// Encode a message into a framed binary buffer.
pub fn encode<T: Serialize>(msg_type: MessageType, payload: &T) -> Result<Vec<u8>, ProtocolError> {
    let payload_bytes =
        bincode::serde::encode_to_vec(payload, bincode::config::standard())
            .map_err(|e| ProtocolError::EncodeFailed(e.to_string()))?;

    let msg_type_u16 = msg_type as u16;
    let payload_len = payload_bytes.len() as u32;

    let mut buf = Vec::with_capacity(HEADER_SIZE + payload_bytes.len());
    buf.extend_from_slice(&msg_type_u16.to_le_bytes());
    buf.extend_from_slice(&payload_len.to_le_bytes());
    buf.extend_from_slice(&payload_bytes);

    Ok(buf)
}

/// Decode a framed binary buffer into (MessageType, payload_bytes).
/// The caller is responsible for deserializing the payload based on the type.
pub fn decode(bytes: &[u8]) -> Result<(MessageType, &[u8]), ProtocolError> {
    if bytes.len() < HEADER_SIZE {
        return Err(ProtocolError::TooShort);
    }

    let msg_type_u16 = u16::from_le_bytes([bytes[0], bytes[1]]);
    let payload_len = u32::from_le_bytes([bytes[2], bytes[3], bytes[4], bytes[5]]) as usize;

    let msg_type = match msg_type_u16 {
        0x0001 => MessageType::ClientHello,
        0x0002 => MessageType::ClientInput,
        0x0003 => MessageType::ClientAction,
        0x0004 => MessageType::ClientChat,
        0x0005 => MessageType::ClientPing,
        0x0101 => MessageType::ServerWelcome,
        0x0102 => MessageType::ServerWorldState,
        0x0103 => MessageType::ServerEntitySpawn,
        0x0104 => MessageType::ServerEntityDespawn,
        0x0105 => MessageType::ServerEntityUpdate,
        0x0106 => MessageType::ServerPlayerState,
        0x0107 => MessageType::ServerSoilUpdate,
        0x0108 => MessageType::ServerWeather,
        0x0109 => MessageType::ServerCalendar,
        0x010A => MessageType::ServerChat,
        0x010B => MessageType::ServerPong,
        0x010C => MessageType::ServerActionResult,
        0x010D => MessageType::ServerBatchUpdate,
        0x010E => MessageType::ServerMonarchSurveillance,
        0x010F => MessageType::ServerStateBroadcast,
        0x0110 => MessageType::ServerTaskBroadcast,
        0x0111 => MessageType::ServerTaskComplete,
        0x0112 => MessageType::ServerRoleChanged,
        0x0113 => MessageType::ServerAiTakeover,
        0x0114 => MessageType::ServerPoliticsUpdate,
        0x0115 => MessageType::ServerCatastrophe,
        0x0201 => MessageType::ShardRegister,
        0x0202 => MessageType::ShardPlayerTransfer,
        0x0203 => MessageType::ShardHealthReport,
        0x0204 => MessageType::ShardAssignment,
        other => return Err(ProtocolError::InvalidMessageType(other)),
    };

    let payload = &bytes[HEADER_SIZE..HEADER_SIZE + payload_len];
    Ok((msg_type, payload))
}

/// Helper: decode the payload bytes into a concrete type.
pub fn decode_payload<T: for<'a> Deserialize<'a>>(payload: &[u8]) -> Result<T, ProtocolError> {
    let (val, _) =
        bincode::serde::decode_from_slice(payload, bincode::config::standard())
            .map_err(|e| ProtocolError::DecodeFailed(e.to_string()))?;
    Ok(val)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::messages::{ClientPing, MessageType};
    use ff_common::Tick;

    #[test]
    fn roundtrip_ping() {
        let ping = ClientPing {
            client_time_ms: 12345,
        };
        let buf = encode(MessageType::ClientPing, &ping).unwrap();
        let (msg_type, payload) = decode(&buf).unwrap();
        assert_eq!(msg_type, MessageType::ClientPing);
        let decoded: ClientPing = decode_payload(payload).unwrap();
        assert_eq!(decoded.client_time_ms, 12345);
    }

    #[test]
    fn dump_hello_bytes() {
        let hello = crate::messages::ClientHello {
            player_name: "Farmer".into(),
            token: "dev-token".into(),
            protocol_version: 1,
            game_mode: 1,
            region_index: 0,
            plot_seed: 42,
            player_role: 0,
        };
        let buf = encode(MessageType::ClientHello, &hello).unwrap();
        // Print each byte as hex for JS replication
        let hex: Vec<String> = buf.iter().map(|b| format!("0x{:02X}", b)).collect();
        println!("ClientHello wire bytes ({} total):", buf.len());
        println!("{}", hex.join(", "));

        // Verify roundtrip
        let (msg_type, payload) = decode(&buf).unwrap();
        assert_eq!(msg_type, MessageType::ClientHello);
        let decoded: crate::messages::ClientHello = decode_payload(payload).unwrap();
        assert_eq!(decoded.player_name, "Farmer");
        assert_eq!(decoded.token, "dev-token");
        assert_eq!(decoded.protocol_version, 1);
    }

    #[test]
    fn roundtrip_input() {
        let input = super::super::messages::ClientInput {
            seq: 42,
            tick: Tick(100),
            move_dir: [0.5, -0.5],
            yaw: 1.57,
            jump: true,
            sprint: false,
        };
        let buf = encode(MessageType::ClientInput, &input).unwrap();
        let (msg_type, payload) = decode(&buf).unwrap();
        assert_eq!(msg_type, MessageType::ClientInput);
        let decoded: super::super::messages::ClientInput = decode_payload(payload).unwrap();
        assert_eq!(decoded.seq, 42);
        assert!(decoded.jump);
    }

    #[test]
    fn dump_batch_update_bytes() {
        use crate::messages::{ServerBatchUpdate, ServerEntityUpdate};
        use ff_common::EntityId;

        let batch = ServerBatchUpdate {
            tick: Tick(100),
            updates: vec![
                ServerEntityUpdate {
                    entity_id: EntityId(1000),
                    position: [20.0, 15.5, 25.0],
                    rotation: 1.57,
                    state_flags: 1,
                },
                ServerEntityUpdate {
                    entity_id: EntityId(1001),
                    position: [10.0, 12.0, 30.0],
                    rotation: 0.0,
                    state_flags: 0,
                },
            ],
        };
        let buf = encode(MessageType::ServerBatchUpdate, &batch).unwrap();
        let hex: Vec<String> = buf.iter().map(|b| format!("0x{:02X}", b)).collect();
        println!("ServerBatchUpdate wire bytes ({} total):", buf.len());
        println!("{}", hex.join(", "));

        let (msg_type, payload) = decode(&buf).unwrap();
        assert_eq!(msg_type, MessageType::ServerBatchUpdate);
        let decoded: ServerBatchUpdate = decode_payload(payload).unwrap();
        assert_eq!(decoded.updates.len(), 2);
        assert_eq!(decoded.updates[0].entity_id, EntityId(1000));
    }
}
