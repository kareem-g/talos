use crate::{agent_events::AgentEvent, websocket::WsMessage};
use chrono::{DateTime, Utc};
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::sync::broadcast;

#[derive(Debug, Clone)]
pub struct BroadcastEvent {
    pub id: u64,
    pub timestamp: DateTime<Utc>,
    pub message: WsMessage,
}

#[derive(Clone)]
pub struct BroadcastHub {
    tx: broadcast::Sender<BroadcastEvent>,
    next_id: Arc<AtomicU64>,
    history: Arc<Mutex<VecDeque<BroadcastEvent>>>,
}

impl BroadcastHub {
    pub fn new() -> Self {
        let (tx, _) = broadcast::channel(1000);
        Self {
            tx,
            next_id: Arc::new(AtomicU64::new(1)),
            history: Arc::new(Mutex::new(VecDeque::with_capacity(1000))),
        }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<BroadcastEvent> {
        self.tx.subscribe()
    }

    pub fn broadcast(&self, message: WsMessage) -> u64 {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        self.publish(id, message)
    }

    pub fn broadcast_agent_event(&self, mut event: AgentEvent) -> u64 {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        event.sequence = id;
        self.publish(id, WsMessage::AgentEvent { event })
    }

    fn publish(&self, id: u64, message: WsMessage) -> u64 {
        let event = BroadcastEvent {
            id,
            timestamp: Utc::now(),
            message,
        };
        if let Ok(mut history) = self.history.lock() {
            history.push_back(event.clone());
            while history.len() > 1000 {
                history.pop_front();
            }
        }
        let _ = self.tx.send(event);
        id
    }

    pub fn latest_id(&self) -> u64 {
        self.next_id.load(Ordering::Relaxed).saturating_sub(1)
    }

    pub fn replay_after(&self, after_id: u64) -> Vec<BroadcastEvent> {
        self.history
            .lock()
            .map(|history| history.iter().filter(|event| event.id > after_id).cloned().collect())
            .unwrap_or_default()
    }
}
