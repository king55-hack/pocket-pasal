-- Each shop's own merchant keys, encrypted with SECRETS_KEY. The phone never gets them back.
CREATE TABLE pay_config (
  shop_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  mode TEXT NOT NULL,
  enc TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (shop_id, provider)
);

CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  mode TEXT NOT NULL,
  amount_paisa INTEGER NOT NULL,
  ref TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  provider_ref TEXT,
  pay_url TEXT,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  paid_at INTEGER
);
CREATE INDEX payments_shop ON payments (shop_id, created_at);
