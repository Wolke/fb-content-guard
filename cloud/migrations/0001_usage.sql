-- No post text, images, original URLs, raw IP addresses or API keys are stored.
CREATE TABLE IF NOT EXISTS usage_events (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('session', 'moderation')),
  subject TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS usage_global ON usage_events(kind, created_at);
CREATE INDEX IF NOT EXISTS usage_ip ON usage_events(kind, ip_hash, created_at);
CREATE INDEX IF NOT EXISTS usage_session ON usage_events(kind, subject, created_at);
CREATE INDEX IF NOT EXISTS usage_cleanup ON usage_events(created_at);
