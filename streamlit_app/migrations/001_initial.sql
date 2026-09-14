CREATE TABLE IF NOT EXISTS vehicles (
    owner TEXT NOT NULL,
    id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (owner, id)
);
PRAGMA user_version = 1;
