use x25519_dalek::{EphemeralSecret, PublicKey};
use rand::rngs::OsRng;

pub struct CryptoSession {
    public_key: PublicKey,
    shared_secret: Option<[u8; 32]>,
}

impl CryptoSession {
    pub fn new() -> Self {
        let ephemeral_secret = EphemeralSecret::random_from_rng(&mut OsRng);
        let public_key = PublicKey::from(&ephemeral_secret);
        Self {
            public_key,
            shared_secret: None,
        }
    }

    pub fn public_key(&self) -> &PublicKey {
        &self.public_key
    }

    pub fn derive_shared_secret(&mut self, other_public: &PublicKey) -> [u8; 32] {
        // Generate a new ephemeral secret for each DH exchange
        let ephemeral_secret = EphemeralSecret::random_from_rng(&mut OsRng);
        let shared = ephemeral_secret.diffie_hellman(other_public);
        let secret = shared.to_bytes();
        self.shared_secret = Some(secret);
        secret
    }
}
