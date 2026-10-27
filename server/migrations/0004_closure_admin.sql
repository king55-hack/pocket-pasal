-- Owners asking to close their account or stop their paid plan. The admin decides; deletion happens 14 days after approval.
CREATE TABLE closure_requests (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL,
  shop_name TEXT NOT NULL,
  owner_email TEXT NOT NULL,
  type TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  reason_text TEXT,
  status TEXT NOT NULL,
  requested_at INTEGER NOT NULL,
  decided_at INTEGER,
  decision_note TEXT,
  scheduled_at INTEGER,
  done_at INTEGER
);
CREATE INDEX closure_status ON closure_requests (status, scheduled_at);
CREATE INDEX closure_shop ON closure_requests (shop_id, requested_at);

-- Wrong admin keys, counted per address, so the key cannot be guessed.
CREATE TABLE admin_attempts (
  key TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX admin_attempts_key ON admin_attempts (key, at);
