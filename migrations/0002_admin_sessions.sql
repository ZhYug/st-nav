-- ST Nav v1.1.0: revocable administrator sessions.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS admin_sessions (
  jti TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires_at ON admin_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_revoked_at ON admin_sessions(revoked_at);

PRAGMA user_version = 2;
