use crate::notifications::{Notification, NotificationProvider};
use crate::Result;

pub struct TelegramProvider {
    bot_token: String,
    chat_id: String,
    client: reqwest::Client,
}

impl TelegramProvider {
    pub fn new(bot_token: String, chat_id: String) -> Self {
        Self {
            bot_token,
            chat_id,
            client: reqwest::Client::new(),
        }
    }
}

impl NotificationProvider for TelegramProvider {
    async fn send(&self, notification: &Notification) -> Result<()> {
        let url = format!(
            "https://api.telegram.org/bot{}/sendMessage",
            self.bot_token
        );

        let text = format!(
            "🔔 *{}*\n\n{}\n\n_Session: {}_",
            notification.title,
            notification.body,
            notification.session_id.as_deref().unwrap_or("none")
        );

        let _ = self.client
            .post(&url)
            .form(&[
                ("chat_id", self.chat_id.as_str()),
                ("text", &text),
                ("parse_mode", "MarkdownV2"),
            ])
            .send()
            .await;

        Ok(())
    }
}
