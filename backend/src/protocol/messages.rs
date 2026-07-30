use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ProtocolMessage {
    Hello { version: String, capabilities: Vec<String> },
    Authenticate { token: String },
    Subscribe { channel: String },
    Event { channel: String, payload: serde_json::Value },
    Ping,
    Pong,
}
