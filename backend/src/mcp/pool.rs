use crate::Result;
use std::collections::HashMap;
use tokio::sync::RwLock;

pub struct SocketPool {
    sockets: RwLock<HashMap<String, String>>,
}

impl SocketPool {
    pub fn new() -> Self {
        Self {
            sockets: RwLock::new(HashMap::new()),
        }
    }

    pub async fn get_socket(&self, server_id: &str) -> Result<tokio::net::UnixStream> {
        let socket_path = format!("/tmp/agentdeck-mcp-{}.sock", server_id);

        // Check if we have a cached connection
        let sockets = self.sockets.read().await;
        let _cached = sockets.get(server_id).cloned();
        drop(sockets);

        // Connect to Unix socket
        let stream = tokio::net::UnixStream::connect(&socket_path).await?;

        // Cache the path (not the stream itself - UnixStream is not Clone)
        let mut sockets = self.sockets.write().await;
        sockets.insert(server_id.to_string(), socket_path);

        Ok(stream)
    }
}
