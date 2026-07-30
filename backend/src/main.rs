use agentdeck_backend::{config::Config, daemon::Daemon};
use tracing::info;

#[tokio::main]
async fn main() -> agentdeck_backend::Result<()> {
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
