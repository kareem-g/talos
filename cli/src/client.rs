use reqwest::Client;
use crate::Result;

pub struct ApiClient {
    client: Client,
    base_url: String,
    token: Option<String>,
}

impl ApiClient {
    pub fn new(base_url: &str, token: Option<String>) -> Self {
        Self {
            client: Client::new(),
            base_url: base_url.to_string(),
            token,
        }
    }

    pub async fn get(&self, path: &str) -> Result<serde_json::Value> {
        let mut req = self.client.get(format!("{}{}", self.base_url, path));
        if let Some(token) = &self.token {
            req = req.header("Authorization", format!("Bearer {}", token));
        }
        let resp = req.send().await?;
        Ok(resp.json().await?)
    }

    pub async fn post(&self, path: &str, body: serde_json::Value) -> Result<serde_json::Value> {
        let mut req = self.client.post(format!("{}{}", self.base_url, path)).json(&body);
        if let Some(token) = &self.token {
            req = req.header("Authorization", format!("Bearer {}", token));
        }
        let resp = req.send().await?;
        Ok(resp.json().await?)
    }
}
