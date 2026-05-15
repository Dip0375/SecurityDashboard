-- ============================================================
-- AWS SecureView — Supabase Database Schema
-- Run this entire script in:
--   Supabase Dashboard → SQL Editor → New Query → Run
-- ============================================================

-- ─── 1. AWS Accounts ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS aws_accounts (
  account_id      TEXT        PRIMARY KEY,
  name            TEXT        NOT NULL,
  region          TEXT        NOT NULL DEFAULT 'us-east-1',
  has_credentials BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 2. AWS Account Credentials (encrypted) ──────────────────
CREATE TABLE IF NOT EXISTS aws_account_credentials (
  account_id        TEXT        PRIMARY KEY REFERENCES aws_accounts(account_id) ON DELETE CASCADE,
  encrypted_secret  TEXT        NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 3. Dashboard Users ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS dashboard_users (
  email                    TEXT        PRIMARY KEY,
  name                     TEXT        NOT NULL DEFAULT 'User',
  role                     TEXT        NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'viewer')),
  password                 TEXT,
  last_login               TIMESTAMPTZ,
  notify_email             TEXT,
  notifications_enabled    BOOLEAN     NOT NULL DEFAULT TRUE,
  notify_failed_login      BOOLEAN     NOT NULL DEFAULT TRUE,
  notify_new_login         BOOLEAN     NOT NULL DEFAULT TRUE,
  notify_password_change   BOOLEAN     NOT NULL DEFAULT TRUE,
  notify_user_add          BOOLEAN     NOT NULL DEFAULT FALSE,
  notify_critical_alert    BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 4. Audit Logs ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_logs (
  id         BIGSERIAL   PRIMARY KEY,
  ts         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "user"     TEXT,
  email      TEXT,
  role       TEXT,
  action     TEXT        NOT NULL,
  detail     TEXT,
  status     TEXT        NOT NULL DEFAULT 'info',
  ip         TEXT        NOT NULL DEFAULT '-'
);

-- Index for fast time-based queries and cleanup
CREATE INDEX IF NOT EXISTS audit_logs_ts_idx ON audit_logs (ts DESC);

-- ─── 5. Dashboard Settings (encrypted key-value store) ────────
CREATE TABLE IF NOT EXISTS dashboard_settings (
  key              TEXT        PRIMARY KEY,
  value_encrypted  TEXT        NOT NULL,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Row Level Security (RLS)
-- The API uses the service-role key which bypasses RLS.
-- Enable RLS to block direct anon/public access.
-- ============================================================

ALTER TABLE aws_accounts             ENABLE ROW LEVEL SECURITY;
ALTER TABLE aws_account_credentials  ENABLE ROW LEVEL SECURITY;
ALTER TABLE dashboard_users          ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs               ENABLE ROW LEVEL SECURITY;
ALTER TABLE dashboard_settings       ENABLE ROW LEVEL SECURITY;

-- Service-role key bypasses RLS automatically — no policies needed.
-- If you want to allow the anon key to read accounts (not recommended),
-- add a policy like: CREATE POLICY "allow_read" ON aws_accounts FOR SELECT USING (true);
