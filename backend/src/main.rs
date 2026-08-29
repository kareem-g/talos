use agentdeck_backend::{config::Config, daemon::Daemon};
use tracing::info;

#[tokio::main]
async fn main() -> agentdeck_backend::Result<()> {
    // Hidden helper modes: re-invoked by the daemon as MCP servers.
    // Runs on stdio and exits when the pipe closes; never touches config,
    // logging, or the daemon lifecycle.
    match std::env::args().nth(1).as_deref() {
        Some("__permission-mcp") => {
            agentdeck_backend::permissions::run_mcp_server()
                .await
                .map_err(|error| agentdeck_backend::AgentDeckError::Io(error))?;
            return Ok(());
        }
        Some("__browser-mcp") => {
            agentdeck_backend::browser::mcp::run_mcp_server()
                .await
                .map_err(|error| agentdeck_backend::AgentDeckError::Io(error))?;
            return Ok(());
        }
        _ => {}
    }

    // Initialize tracing
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .with_target(true)
        .with_thread_ids(true)
        .init();

    info!("AgentDeck Linux Daemon starting...");

    // Load configuration
    let config = Config::load().await?;
    info!("Configuration loaded from {:?}", config.path());

    // Initialize and start daemon
    let daemon = Daemon::new(config).await?;

    // Setup graceful shutdown
    let shutdown = setup_shutdown_handler();

    info!("Daemon ready. Press Ctrl+C to stop.");
    daemon.run(shutdown).await?;

    info!("Daemon stopped gracefully.");
    Ok(())
}

fn setup_shutdown_handler() -> tokio::sync::watch::Receiver<bool> {
    let (tx, rx) = tokio::sync::watch::channel(false);

    tokio::spawn(async move {
        let mut sigterm = tokio::signal::unix::signal(
            tokio::signal::unix::SignalKind::terminate()
        ).expect("Failed to create SIGTERM handler");
        let mut sigint = tokio::signal::unix::signal(
            tokio::signal::unix::SignalKind::interrupt()
        ).expect("Failed to create SIGINT handler");

        tokio::select! {
            _ = sigterm.recv() => {},
            _ = sigint.recv() => {},
        }

        let _ = tx.send(true);
    });

    rx
}
