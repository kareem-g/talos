//! Minimal Chrome DevTools Protocol (CDP) client, written in-repo.
//!
//! Speaks JSON-RPC over a WebSocket to Chromium's remote-debugging endpoint.
//! A tiny surface on purpose: send a command (`{id, method, params}`) and await
//! its response; CDP *events* are routed to a broadcast channel so callers can
//! watch for page loads and similar without a heavyweight client crate.
//!
//! No dependency beyond `tokio-tungstenite` (already in the tree for the WS
//! gateway) and `futures`.

use futures::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::net::TcpStream;
use tokio::sync::{broadcast, mpsc, oneshot, Mutex};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};

type WsStream = WebSocketStream<MaybeTlsStream<TcpStream>>;

/// How many CDP events we buffer before dropping the oldest. Events are
/// informational (page loads etc.); the dashboard polls for real state, so
/// dropping under pressure is fine.
const EVENT_CAPACITY: usize = 256;

#[derive(Clone)]
pub struct CdpClient {
    next_id: Arc<AtomicU64>,
    pending: Arc<Mutex<HashMap<u64, oneshot::Sender<Value>>>>,
    events: broadcast::Sender<Value>,
    writer: mpsc::Sender<Value>,
}

impl CdpClient {
    /// Connect to a tab's `webSocketDebuggerUrl`.
    pub async fn connect(ws_url: &str) -> crate::Result<Self> {
        let (ws, _) = connect_async(ws_url)
            .await
            .map_err(|e| crate::AgentDeckError::Unknown(format!("CDP connect: {e}")))?;
        let (mut sink, mut stream) = ws.split();
        let (writer_tx, mut writer_rx) = mpsc::channel::<Value>(256);
        let (events_tx, _) = broadcast::channel(EVENT_CAPACITY);
        let pending = Arc::new(Mutex::new(HashMap::<u64, oneshot::Sender<Value>>::new()));
        let next_id = Arc::new(AtomicU64::new(1));

        // Writer task: serializes commands from the channel onto the socket.
        let mut sink_task = sink;
        tokio::spawn(async move {
            while let Some(msg) = writer_rx.recv().await {
                if sink_task
                    .send(Message::Text(msg.to_string().into()))
                    .await
                    .is_err()
                {
                    break;
                }
            }
            let _ = sink_task.close().await;
        });

        // Reader task: resolve pending responses by id, fan out events.
        let pending_r = Arc::clone(&pending);
        let events_r = events_tx.clone();
        tokio::spawn(async move {
            while let Some(Ok(Message::Text(text))) = stream.next().await {
                let Ok(value) = serde_json::from_str::<Value>(&text) else {
                    continue;
                };
                if let Some(id) = value.get("id").and_then(Value::as_u64) {
                    if let Some(tx) = pending_r.lock().await.remove(&id) {
                        let _ = tx.send(value);
                    }
                } else if value.get("method").is_some() {
                    let _ = events_r.send(value);
                }
            }
        });

        Ok(Self {
            next_id,
            pending,
            events: events_tx,
            writer: writer_tx,
        })
    }

    /// Send a CDP command and await its `result` (or surface `error`).
    pub async fn call(&self, method: &str, params: Value) -> crate::Result<Value> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel();
        self.pending.lock().await.insert(id, tx);
        let frame = json!({ "id": id, "method": method, "params": params });
        self.writer
            .send(frame)
            .await
            .map_err(|_| crate::AgentDeckError::Unknown("CDP writer closed".into()))?;
        let reply = rx
            .await
            .map_err(|_| crate::AgentDeckError::Unknown("CDP: no reply (page closed?)".into()))?;
        if let Some(error) = reply.get("error") {
            let message = error
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("cdp error");
            return Err(crate::AgentDeckError::Unknown(format!(
                "CDP {method}: {message}"
            )));
        }
        Ok(reply.get("result").cloned().unwrap_or(Value::Null))
    }

    /// Convenience: `Runtime.evaluate` a JS expression (return value only).
    pub async fn evaluate(&self, expression: &str) -> crate::Result<Value> {
        let result = self
            .call(
                "Runtime.evaluate",
                json!({
                    "expression": expression,
                    "returnByValue": true,
                    "awaitPromise": true,
                }),
            )
            .await?;
        let value = result
            .pointer("/result/value")
            .cloned()
            .unwrap_or(Value::Null);
        if let Some(exception) = result.get("exceptionDetails") {
            return Err(crate::AgentDeckError::Unknown(format!(
                "page JS exception: {}",
                exception
                    .pointer("/exception/description")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown")
            )));
        }
        Ok(value)
    }

    pub fn subscribe(&self) -> broadcast::Receiver<Value> {
        self.events.subscribe()
    }
}
