use clap::{Parser, Subcommand};
use tracing::info;

mod eval;

#[derive(Parser)]
#[command(name = "agentdeck")]
#[command(about = "AgentDeck Linux - Visual agent terminal companion")]
#[command(version)]
struct Cli {
    #[command(subcommand)]
    command: Commands,

    #[arg(short, long, global = true)]
    verbose: bool,
}

#[derive(Subcommand)]
enum Commands {
    /// Start the daemon
    Daemon {
        #[command(subcommand)]
        action: DaemonAction,
    },
    /// Run one headless prompt and print the result (eval / automation)
    Run {
        /// The prompt to run
        #[arg(short, long)]
        prompt: String,
        /// Agent to run (claude, opencode, codex, pi, …)
        #[arg(short, long, default_value = "claude")]
        agent: String,
        /// Project directory for the session
        #[arg(short = 'P', long)]
        project: Option<String>,
        /// Print the result as JSON
        #[arg(long)]
        json: bool,
    },
    /// Run an eval suite across agents and report pass/cost/latency
    Eval {
        /// Suite file (JSON array of {name, prompt, expect?})
        #[arg(short, long)]
        suite: std::path::PathBuf,
        /// Comma-separated agents to run against
        #[arg(long, default_value = "claude")]
        agents: String,
        /// Project directory for the sessions
        #[arg(short = 'P', long)]
        project: Option<String>,
        /// Print results as JSON
        #[arg(long)]
        json: bool,
    },
    /// Launch Claude Code
    Claude {
        #[arg(short, long)]
        project: Option<String>,
    },
    /// Launch Codex CLI
    Codex {
        #[arg(short, long)]
        project: Option<String>,
    },
    /// Launch OpenCode
    Opencode {
        #[arg(short, long)]
        project: Option<String>,
    },
    /// List all sessions
    List,
    /// Create a new session
    Create {
        #[arg(short, long)]
        agent: String,
        #[arg(short, long)]
        project: Option<String>,
    },
    /// Attach to a session
    Attach {
        id: String,
    },
    /// Fork a session
    Fork {
        id: String,
    },
    /// Kill a session
    Kill {
        id: String,
    },
    /// Open the dashboard
    Dashboard {
        #[arg(short, long)]
        port: Option<u16>,
    },
    /// Manage tunnels
    Tunnel {
        #[command(subcommand)]
        action: TunnelAction,
    },
    /// Manage MCP servers
    Mcp {
        #[command(subcommand)]
        action: McpAction,
    },
    /// Pair a device
    Pair,
    /// Revoke a paired device
    Revoke {
        device_id: String,
    },
    /// Edit configuration
    Config {
        #[command(subcommand)]
        action: ConfigAction,
    },
    /// Record, replay, and export session trajectories
    Trajectory {
        #[command(subcommand)]
        action: TrajectoryAction,
    },
    /// Show status
    Status,
}

#[derive(Subcommand)]
enum DaemonAction {
    Start {
        #[arg(long)]
        tailscale: bool,
        #[arg(long)]
        cloudflare: bool,
    },
    Stop,
    Restart,
    Status,
}

#[derive(Subcommand)]
enum TunnelAction {
    Status,
    Tailscale {
        #[arg(long)]
        up: bool,
        #[arg(long)]
        down: bool,
    },
    Cloudflare {
        #[arg(long)]
        up: bool,
        #[arg(long)]
        down: bool,
        #[arg(long)]
        token: Option<String>,
    },
}

#[derive(Subcommand)]
enum McpAction {
    List,
    Add {
        name: String,
        command: String,
    },
    Remove {
        name: String,
    },
    Start {
        name: String,
    },
    Stop {
        name: String,
    },
}

#[derive(Subcommand)]
enum ConfigAction {
    Edit,
    Reset,
    Show,
}

#[derive(Subcommand)]
enum TrajectoryAction {
    /// Start recording a session's events to a JSONL file
    Record {
        /// Session to record
        session_id: String,
        /// Output file path (default: app data dir)
        #[arg(short, long)]
        out: Option<std::path::PathBuf>,
    },
    /// Stop recording a session
    Stop {
        /// Session to stop recording
        session_id: String,
    },
    /// Replay a trajectory file through the daemon
    Replay {
        /// Trajectory file to replay
        path: std::path::PathBuf,
        /// Re-target events to this session instead of the recorded one
        #[arg(long)]
        session: Option<String>,
    },
    /// Export a session's persisted events as JSONL
    Export {
        /// Session to export
        session_id: String,
        /// Output file path (default: <session-id>.jsonl)
        #[arg(short, long)]
        out: Option<std::path::PathBuf>,
    },
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let cli = Cli::parse();

    let level = if cli.verbose { "debug" } else { "info" };
    tracing_subscriber::fmt()
        .with_env_filter(level)
        .init();

    match cli.command {
        Commands::Daemon { action } => match action {
            DaemonAction::Start { tailscale, cloudflare } => {
                info!("Starting daemon...");
                if tailscale {
                    info!("Tailscale tunnel enabled");
                }
                if cloudflare {
                    info!("Cloudflare tunnel enabled");
                }
                // Start daemon process
                let mut cmd = tokio::process::Command::new("agentdeck-backend");
                cmd.spawn()?;
                println!("Daemon started on http://localhost:9120");
            }
            DaemonAction::Stop => {
                info!("Stopping daemon...");
                let _ = tokio::process::Command::new("pkill")
                    .args(["-f", "agentdeck-backend"])
                    .output()
                    .await?;
                println!("Daemon stopped");
            }
            DaemonAction::Restart => {
                info!("Restarting daemon...");
                // Stop then start
            }
            DaemonAction::Status => {
                // Check if daemon is running
                let output = tokio::process::Command::new("pgrep")
                    .args(["-f", "agentdeck-backend"])
                    .output()
                    .await?;

                if output.status.success() {
                    println!("Daemon is running");
                } else {
                    println!("Daemon is not running");
                }
            }
        },
        Commands::Run { prompt, agent, project, json } => {
            let result = eval::run_headless(&agent, &prompt, project.as_deref(), std::time::Duration::from_secs(300)).await?;
            if json {
                println!("{}", serde_json::to_string_pretty(&result)?);
            } else {
                println!("agent:        {}", result.agent);
                println!("session:      {}", result.session_id);
                println!("completed:    {}", result.completed);
                println!("tokens:       {} in / {} out", result.input_tokens.unwrap_or(0), result.output_tokens.unwrap_or(0));
                println!("duration:     {} ms", result.duration_ms.map(|d| d.to_string()).unwrap_or_else(|| "-".to_string()));
                if let Some(error) = &result.error {
                    println!("error:        {error}");
                }
                println!("reply:\n{}", result.reply);
            }
        }
        Commands::Eval { suite, agents, project, json } => {
            let agents: Vec<String> = agents
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect();
            eval::run_eval(&suite, &agents, project.as_deref(), json).await?;
        }
        Commands::Claude { project } => {
            let mut cmd = tokio::process::Command::new("claude");
            if let Some(proj) = project {
                cmd.current_dir(proj);
            }
            cmd.spawn()?.wait().await?;
        }
        Commands::Codex { project } => {
            let mut cmd = tokio::process::Command::new("codex");
            if let Some(proj) = project {
                cmd.current_dir(proj);
            }
            cmd.spawn()?.wait().await?;
        }
        Commands::Opencode { project } => {
            let mut cmd = tokio::process::Command::new("opencode");
            if let Some(proj) = project {
                cmd.current_dir(proj);
            }
            cmd.spawn()?.wait().await?;
        }
        Commands::List => {
            let client = reqwest::Client::new();
            let resp = client
                .get("http://localhost:9120/api/sessions")
                .send()
                .await?;
            let data: serde_json::Value = resp.json().await?;
            println!("{}", serde_json::to_string_pretty(&data)?);
        }
        Commands::Create { agent, project } => {
            let client = reqwest::Client::new();
            let resp = client
                .post("http://localhost:9120/api/sessions")
                .json(&serde_json::json!({
                    "agent": agent,
                    "project": project
                }))
                .send()
                .await?;
            let data: serde_json::Value = resp.json().await?;
            println!("Created session: {}", data["id"].as_str().unwrap_or("unknown"));
        }
        Commands::Attach { id } => {
            println!("Attaching to session {}...", id);
            // Open terminal dashboard
        }
        Commands::Fork { id } => {
            println!("Forking session {}...", id);
        }
        Commands::Kill { id } => {
            let client = reqwest::Client::new();
            let resp = client
                .post(format!("http://localhost:9120/api/sessions/{}/kill", id))
                .send()
                .await?;
            let data: serde_json::Value = resp.json().await?;
            println!("{}", data);
        }
        Commands::Dashboard { port } => {
            let url = format!("http://localhost:{}", port.unwrap_or(9120));
            let _ = tokio::process::Command::new("xdg-open")
                .arg(&url)
                .spawn()?;
            println!("Opening dashboard at {}", url);
        }
        Commands::Tunnel { action } => match action {
            TunnelAction::Status => {
                let client = reqwest::Client::new();
                let resp = client
                    .get("http://localhost:9120/api/tunnel/status")
                    .send()
                    .await?;
                let data: serde_json::Value = resp.json().await?;
                println!("{}", serde_json::to_string_pretty(&data)?);
            }
            TunnelAction::Tailscale { up, down } => {
                if up {
                    println!("Starting Tailscale tunnel...");
                }
                if down {
                    println!("Stopping Tailscale tunnel...");
                }
            }
            TunnelAction::Cloudflare { up, down, token } => {
                if up {
                    println!("Starting Cloudflare tunnel...");
                    if let Some(t) = token {
                        println!("Using token: {}...", &t[..8.min(t.len())]);
                    }
                }
                if down {
                    println!("Stopping Cloudflare tunnel...");
                }
            }
        },
        Commands::Mcp { action } => match action {
            McpAction::List => {
                let client = reqwest::Client::new();
                let resp = client
                    .get("http://localhost:9120/api/mcp")
                    .send()
                    .await?;
                let data: serde_json::Value = resp.json().await?;
                println!("{}", serde_json::to_string_pretty(&data)?);
            }
            McpAction::Add { name, command } => {
                println!("Adding MCP server {}: {}", name, command);
            }
            McpAction::Remove { name } => {
                println!("Removing MCP server {}", name);
            }
            McpAction::Start { name } => {
                println!("Starting MCP server {}", name);
            }
            McpAction::Stop { name } => {
                println!("Stopping MCP server {}", name);
            }
        },
        Commands::Pair => {
            let client = reqwest::Client::new();
            let resp = client
                .post("http://localhost:9120/api/pair")
                .send()
                .await?;
            let data: serde_json::Value = resp.json().await?;
            println!("QR Data: {}", data["qr_data"].as_str().unwrap_or(""));
            println!("Fingerprint: {}", data["fingerprint"].as_str().unwrap_or(""));
            println!("Expires at: {}", data["expires_at"].as_str().unwrap_or(""));
        }
        Commands::Revoke { device_id } => {
            println!("Revoking device {}", device_id);
        }
        Commands::Config { action } => match action {
            ConfigAction::Edit => {
                let config_path = config_path();
                let editor = std::env::var("EDITOR").unwrap_or_else(|_| "nano".to_string());
                tokio::process::Command::new(&editor)
                    .arg(config_path)
                    .spawn()?
                    .wait()
                    .await?;
            }
            ConfigAction::Reset => {
                println!("Resetting configuration to defaults...");
            }
            ConfigAction::Show => {
                let config_path = config_path();
                if config_path.exists() {
                    let content = tokio::fs::read_to_string(config_path).await?;
                    println!("{}", content);
                } else {
                    println!("No configuration file found");
                }
            }
        },
        Commands::Trajectory { action } => match action {
            TrajectoryAction::Record { session_id, out } => {
                let client = reqwest::Client::new();
                let mut body = serde_json::json!({ "session_id": session_id });
                if let Some(path) = out {
                    body["path"] = serde_json::json!(path.to_string_lossy());
                }
                let resp = client
                    .post("http://localhost:9120/api/trajectories/record")
                    .json(&body)
                    .send()
                    .await?;
                let data: serde_json::Value = resp.json().await?;
                println!("{}", serde_json::to_string_pretty(&data)?);
            }
            TrajectoryAction::Stop { session_id } => {
                let client = reqwest::Client::new();
                let resp = client
                    .post("http://localhost:9120/api/trajectories/stop")
                    .json(&serde_json::json!({ "session_id": session_id }))
                    .send()
                    .await?;
                let data: serde_json::Value = resp.json().await?;
                println!("{}", serde_json::to_string_pretty(&data)?);
            }
            TrajectoryAction::Replay { path, session } => {
                let client = reqwest::Client::new();
                let mut body = serde_json::json!({ "path": path.to_string_lossy() });
                if let Some(session) = session {
                    body["session_id"] = serde_json::json!(session);
                }
                let resp = client
                    .post("http://localhost:9120/api/trajectories/replay")
                    .json(&body)
                    .send()
                    .await?;
                let data: serde_json::Value = resp.json().await?;
                println!("{}", serde_json::to_string_pretty(&data)?);
            }
            TrajectoryAction::Export { session_id, out } => {
                let client = reqwest::Client::new();
                let resp = client
                    .get(format!(
                        "http://localhost:9120/api/sessions/{session_id}/trajectory"
                    ))
                    .send()
                    .await?;
                if !resp.status().is_success() {
                    let data: serde_json::Value = resp.json().await?;
                    println!("{}", serde_json::to_string_pretty(&data)?);
                } else {
                    let text = resp.text().await?;
                    let path = out
                        .unwrap_or_else(|| std::path::PathBuf::from(format!("{session_id}.jsonl")));
                    std::fs::write(&path, text)?;
                    println!("Exported to {}", path.display());
                }
            }
        },
        Commands::Status => {
            let client = reqwest::Client::new();
            let resp = client
                .get("http://localhost:9120/health")
                .send()
                .await?;
            let data: serde_json::Value = resp.json().await?;
            println!("AgentDeck {}", data["version"].as_str().unwrap_or("unknown"));
            println!("Platform: {}", data["platform"].as_str().unwrap_or("unknown"));
            println!("Status: {}", data["status"].as_str().unwrap_or("unknown"));
        }
    }

    Ok(())
}

fn config_path() -> std::path::PathBuf {
    let base = std::env::var_os("XDG_CONFIG_HOME")
        .map(std::path::PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| std::path::PathBuf::from(home).join(".config")))
        .unwrap_or_else(|| std::path::PathBuf::from("."));
    base.join("agentdeck").join("config.toml")
}
