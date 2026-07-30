use crate::websocket::WsMessage;
use tokio::sync::broadcast;

pub struct BroadcastHub {
    tx: broadcast::Sender<WsMessage>,
}

impl BroadcastHub {
    pub fn new() -> Self {
        let (tx, _) = broadcast::channel(1000);
        Self { tx }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<WsMessage> {
        self.tx.subscribe()
    }

    pub fn broadcast(&self, msg: WsMessage) {
        let _ = self.tx.send(msg);
    }
}
