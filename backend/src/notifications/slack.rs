use crate::notifications::{Notification, NotificationProvider};
use crate::Result;

pub struct SlackProvider {
    webhook_url: String,
    client: reqwest::Client,
}

impl SlackProvider {
    pub fn new(webhook_url: String) -> Self {
        Self {
            webhook_url,
            client: reqwest::Client::new(),
        }
    }
}

impl NotificationProvider for SlackProvider {
    async fn send(&self, notification: &Notification) -> Result<()> {
        let payload = serde_json::json!({
            "text": format!("{}: {}", notification.title, notification.body),
            "blocks": [
                {
                    "type": "header",
                    "text": {
                        "type": "plain_text",
                        "text": notification.title.clone()
                    }
                },
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": notification.body.clone()
                    }
                }
            ]
        });

        let _ = self.client
            .post(&self.webhook_url)
            .json(&payload)
            .send()
            .await;

        Ok(())
    }
}
