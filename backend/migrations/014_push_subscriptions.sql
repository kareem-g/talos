-- Web Push subscriptions — notifications that arrive with the app closed.
--
-- The dashboard already raises a system notification when an agent finishes or
-- wants an approval, but only while its JavaScript is running. A phone locks
-- the screen and discards the tab within seconds, which is exactly when the
-- user most needs to be paged. So the daemon becomes the sender: it keeps the
-- push endpoints a browser handed it and posts to them itself.
--
-- `endpoint` is the push service URL and is unique per browser install — a
-- re-subscribe from the same browser replaces the old row rather than
-- accumulating duplicates that would page the user twice.
--
-- `p256dh` and `auth` are the client's RFC 8291 payload-encryption keys. They
-- are useless without the endpoint and carry no account authority, but they
-- are still per-device secrets, so they live in the daemon's own database
-- alongside device tokens rather than anywhere it might be served from.
CREATE TABLE IF NOT EXISTS push_subscriptions (
    endpoint TEXT PRIMARY KEY,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    -- The paired device this came from, when the request was authenticated.
    -- Null for the desktop dashboard, which talks to the daemon unauthenticated
    -- over loopback.
    device_id TEXT,
    label TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Last time the push service accepted a delivery, for pruning dead rows.
    last_success DATETIME
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_device ON push_subscriptions(device_id);

-- The VAPID identity (RFC 8292) this daemon signs pushes with.
--
-- Generated once on first use and reused forever: the public key is baked into
-- every browser subscription, so rotating it silently invalidates every
-- existing subscriber. Single row, `id = 1`.
CREATE TABLE IF NOT EXISTS push_vapid_keys (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    private_key TEXT NOT NULL,
    public_key TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
