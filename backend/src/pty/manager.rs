use crate::{pty::{PtySession, PtyState}};
use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
use std::sync::Arc;
use tokio::sync::{mpsc, RwLock};

pub struct PtyManager {
    sessions: Arc<RwLock<std::collections::HashMap<String, PtySessionHandle>>>,
    pty_system: NativePtySystem,
}

pub struct PtySessionHandle {
    pub session: PtySession,
    pub tx: mpsc::UnboundedSender<String>,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(RwLock::new(std::collections::HashMap::new())),
            pty_system: NativePtySystem::default(),
        }
    }

    pub async fn spawn_session(
        &self,
        agent: &str,
        project: Option<&str>,
        command: Vec<String>,
    ) -> crate::Result<PtySession> {
        let id = uuid::Uuid::new_v4().to_string();

        let pair = self.pty_system.openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        }).map_err(|e| crate::AgentDeckError::Pty(e.to_string()))?;

        let mut cmd = CommandBuilder::new(&command[0]);
        for arg in &command[1..] {
            cmd.arg(arg);
        }
        if let Some(proj) = project {
            cmd.cwd(proj);
        }

        let child = pair.slave.spawn_command(cmd)
            .map_err(|e| crate::AgentDeckError::Pty(e.to_string()))?;

        let session = PtySession {
            id: id.clone(),
            agent: agent.to_string(),
            project: project.map(|s| s.to_string()),
            pid: child.process_id().unwrap_or(0),
            state: PtyState::Running,
            created_at: chrono::Utc::now(),
        };

        let (tx, mut rx) = mpsc::unbounded_channel::<String>();

        // Spawn reader task - clone reader before moving pair.master
        let mut reader = pair.master.try_clone_reader()
            .expect("Failed to clone PTY reader");

        let _sessions = Arc::clone(&self.sessions);
        let _session_id = id.clone();
        tokio::task::spawn_blocking(move || {
            let mut buf = [0u8; 4096];
            loop {
                match std::io::Read::read(&mut reader, &mut buf) {
                    Ok(n) if n > 0 => {
                        let data = String::from_utf8_lossy(&buf[..n]).to_string();
                        tracing::debug!("PTY output: {}", data);
                    }
                    Ok(_) => break,
                    Err(_) => break,
                }
            }
        });

        // Spawn writer task - take writer after cloning reader
        let mut writer = pair.master.take_writer()
            .expect("Failed to take PTY writer");
        tokio::spawn(async move {
            while let Some(data) = rx.recv().await {
                let _ = std::io::Write::write_all(&mut writer, data.as_bytes());
                let _ = std::io::Write::flush(&mut writer);
            }
        });

        let handle = PtySessionHandle { session: session.clone(), tx };
        self.sessions.write().await.insert(id.clone(), handle);

        Ok(session)
    }

    pub async fn send_input(&self, session_id: &str, data: &str) -> crate::Result<()> {
        let sessions = self.sessions.read().await;
        if let Some(handle) = sessions.get(session_id) {
            let _ = handle.tx.send(data.to_string());
            Ok(())
        } else {
            Err(crate::AgentDeckError::Session(
                format!("Session {} not found", session_id)
            ))
        }
    }

    pub async fn kill_session(&self, session_id: &str) -> crate::Result<()> {
        let mut sessions = self.sessions.write().await;
        if let Some(handle) = sessions.remove(session_id) {
            // Send SIGTERM
            let _ = nix::sys::signal::kill(
                nix::unistd::Pid::from_raw(handle.session.pid as i32),
                nix::sys::signal::Signal::SIGTERM,
            );
        }
        Ok(())
    }
}
