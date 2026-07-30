use crate::auth::{PairedDevice, PairingOffer};
use crate::Result;
use ed25519_dalek::SigningKey;
use rand::rngs::OsRng;
use rand::RngCore;
use sha2::{Digest, Sha256};
use std::collections::HashMap;

pub struct PairingManager {
    signing_key: SigningKey,
    offers: HashMap<String, PairingOffer>,
    devices: HashMap<String, PairedDevice>,
}

impl PairingManager {
    pub fn new() -> Self {
        let mut secret = [0u8; 32];
        OsRng.fill_bytes(&mut secret);
        let signing_key = SigningKey::from_bytes(&secret);

        Self {
            signing_key,
            offers: HashMap::new(),
            devices: HashMap::new(),
        }
    }

    pub fn create_offer(&mut self, host: &str) -> PairingOffer {
        let id = uuid::Uuid::new_v4().to_string();
        let fingerprint = self.generate_fingerprint();

        let qr_data = format!(
            "agentdeck://pair?host={}&port=9120&fingerprint={}&offer={}",
            host, fingerprint, id
        );

        let offer = PairingOffer {
            id: id.clone(),
            qr_data,
            fingerprint,
            expires_at: chrono::Utc::now() + chrono::Duration::minutes(2),
        };

        self.offers.insert(id, offer.clone());
        offer
    }

    pub fn verify_offer(&mut self, offer_id: &str, device_key: &str, device_name: &str) -> Result<String> {
        let offer = self.offers.remove(offer_id)
            .ok_or_else(|| crate::AgentDeckError::Auth("Offer not found or expired".to_string()))?;

        if chrono::Utc::now() > offer.expires_at {
            return Err(crate::AgentDeckError::Auth("Offer expired".to_string()));
        }

        let device = PairedDevice {
            id: uuid::Uuid::new_v4().to_string(),
            name: device_name.to_string(),
            public_key: device_key.to_string(),
            fingerprint: offer.fingerprint,
            paired_at: chrono::Utc::now(),
            last_seen: Some(chrono::Utc::now()),
        };

        let token = self.generate_device_token(&device.id);
        self.devices.insert(device.id.clone(), device);

        Ok(token)
    }

    pub fn validate_token(&self, token: &str) -> bool {
        // In production: verify JWT signature
        token.len() >= 32
    }

    pub fn revoke_device(&mut self, device_id: &str) -> Result<()> {
        self.devices.remove(device_id)
            .ok_or_else(|| crate::AgentDeckError::Auth("Device not found".to_string()))?;
        Ok(())
    }

    pub fn list_devices(&self) -> Vec<&PairedDevice> {
        self.devices.values().collect()
    }

    pub fn get_device(&self, device_id: &str) -> Option<&PairedDevice> {
        self.devices.get(device_id)
    }

    fn generate_fingerprint(&self) -> String {
        let mut hasher = Sha256::new();
        hasher.update(self.signing_key.verifying_key().as_bytes());
        let result = hasher.finalize();
        hex::encode(&result[..4])
    }

    fn generate_device_token(&self, device_id: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(self.signing_key.as_bytes());
        hasher.update(device_id.as_bytes());
        hasher.update(rand::random::<[u8; 32]>());
        hex::encode(hasher.finalize())
    }
}
