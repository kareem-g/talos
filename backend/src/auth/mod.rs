pub mod pairing;
pub mod crypto;
pub mod devices;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PairedDevice {
    pub id: String,
    pub name: String,
    pub public_key: String,
    pub fingerprint: String,
    pub paired_at: chrono::DateTime<chrono::Utc>,
    pub last_seen: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PairingOffer {
    pub id: String,
    pub qr_data: String,
    pub fingerprint: String,
    pub expires_at: chrono::DateTime<chrono::Utc>,
}
