-- Rooms — multi-agent rosters synced across every dashboard client.
--
-- Rooms were browser-local (localStorage), so a room created in one browser
-- never appeared in another. The daemon is now the source of truth: the
-- roster is a JSON blob per room (shape owned by the dashboard; the backend
-- treats it as opaque), read/written over /api/rooms and broadcast live over
-- the websocket as RoomUpsert / RoomDeleted.

CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
