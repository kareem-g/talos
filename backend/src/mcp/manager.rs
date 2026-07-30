use crate::mcp::{McpServer, McpStatus};
use crate::Result;
use std::sync::Arc;
use tokio::sync::RwLock;

pub struct McpManager {
    servers: Arc<RwLock<std::collections::HashMap<String, McpServer>>>,
}

impl McpManager {
    pub fn new() -> Self {
        Self {
            servers: Arc::new(RwLock::new(std::collections::HashMap::new())),
        }
    }

    pub async fn add_server(&self, server: McpServer) -> Result<()> {
        let mut servers = self.servers.write().await;
        servers.insert(server.id.clone(), server);
        Ok(())
    }

    pub async fn remove_server(&self, id: &str) -> Result<()> {
        let mut servers = self.servers.write().await;
        if let Some(server) = servers.remove(id) {
            // Stop if running
            if matches!(server.status, McpStatus::Running) {
                self.stop_server(id).await?;
            }
        }
        Ok(())
    }

    pub async fn start_server(&self, id: &str) -> Result<()> {
        let servers = self.servers.read().await;
        let server = servers.get(id)
            .ok_or_else(|| crate::AgentDeckError::Unknown("Server not found".to_string()))?;

        let socket_path = format!("/tmp/agentdeck-mcp-{}.sock", id);

        // Start MCP server with Unix socket
        let mut cmd = tokio::process::Command::new(&server.command);
        cmd.args(&server.args);
        cmd.envs(&server.env);

        // Spawn the process
        let _ = cmd.spawn()?;

        drop(servers);

        let mut servers = self.servers.write().await;
        if let Some(server) = servers.get_mut(id) {
            server.status = McpStatus::Running;
            server.socket_path = Some(socket_path);
        }

        Ok(())
    }

    pub async fn stop_server(&self, id: &str) -> Result<()> {
        // Find and kill the process
        let _ = tokio::process::Command::new("pkill")
            .args(["-f", &format!("agentdeck-mcp-{}", id)])
            .output()
            .await;

        let mut servers = self.servers.write().await;
        if let Some(server) = servers.get_mut(id) {
            server.status = McpStatus::Stopped;
            server.socket_path = None;
        }

        Ok(())
    }

    pub async fn list_servers(&self) -> Result<Vec<McpServer>> {
        let servers = self.servers.read().await;
        Ok(servers.values().cloned().collect())
    }
}
