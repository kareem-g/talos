use crate::Result;
use crate::protocol::messages::ProtocolMessage;

pub struct MessageCodec;

impl MessageCodec {
    pub fn encode(msg: &ProtocolMessage) -> Result<String> {
        serde_json::to_string(msg)
            .map_err(|e| crate::AgentDeckError::Serialization(e))
    }

    pub fn decode(data: &str) -> Result<ProtocolMessage> {
        serde_json::from_str(data)
            .map_err(|e| crate::AgentDeckError::Serialization(e))
    }
}
