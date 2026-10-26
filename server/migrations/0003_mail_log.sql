-- One row per email a shop asked us to send (receipts and reports), so the daily limit can be enforced.
CREATE TABLE mail_log (
  shop_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  kind TEXT NOT NULL
);
CREATE INDEX mail_log_shop ON mail_log (shop_id, at);
