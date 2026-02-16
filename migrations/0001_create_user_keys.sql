-- Proxy key mapping table: one row per user
CREATE TABLE user_keys (
  email          TEXT PRIMARY KEY,
  bayleaf_token  TEXT NOT NULL UNIQUE,
  or_key_hash    TEXT NOT NULL,
  or_key_secret  TEXT NOT NULL,
  revoked        INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
