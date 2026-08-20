//! Provider layer: discovery, capabilities, and the contract clients consume.
//!
//! The organizing idea is that **the agent is the authority**. This layer's job
//! is to ask each installed CLI what it is and what it can do, normalize the
//! answers into one shape, and pass them through without editorializing. It
//! does not decide which CLIs exist, which models are real, or which features a
//! provider ought to have.
//!
//! What that buys: adding a CLI that speaks a transport we already implement is
//! a catalog row, and a user's self-hosted model appears in the UI without any
//! code knowing it exists.
//!
//! - [`types`] — the wire contract. Opaque model ids, `Option` capabilities,
//!   config dimensions as data.
//! - [`catalog`] — where to look and how to launch. A lookup table, not a gate.
//! - [`acp_probe`] — one handshake that yields version, capabilities, models and
//!   config options.
//! - [`discovery`] — model listing for CLIs that need to be asked instead.
//! - [`registry`] — merges config with the catalog, probes concurrently, caches.

pub mod acp_probe;
pub mod catalog;
pub mod discovery;
pub mod registry;
pub mod types;

pub use registry::{CustomProvider, ProviderRegistry};
pub use types::{
    ConfigApplied, ConfigChoice, ConfigMutability, ConfigOption, ConfigOptionType, DiscoverySource,
    Model, ModelCapabilities, ProviderCapabilities, ProviderDescriptor, ProviderState, Transport,
};
