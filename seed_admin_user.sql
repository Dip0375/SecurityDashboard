-- ============================================================
-- AWS SecureView — Seed Admin User
-- Run this in: Supabase Dashboard → SQL Editor → New Query → Run
--
-- Change the email, name, and password before running.
-- ============================================================

INSERT INTO dashboard_users (
  email,
  name,
  role,
  password,
  notify_email,
  notifications_enabled,
  notify_failed_login,
  notify_new_login,
  notify_password_change,
  notify_user_add,
  notify_critical_alert,
  created_at,
  updated_at
)
VALUES (
  'admin@yourcompany.com',   -- ← change to your email
  'Admin',                   -- ← change to your name
  'admin',
  'YourStrong@Pass2024!',    -- ← change to your password
  'admin@yourcompany.com',   -- ← notification email (can be same)
  TRUE,
  TRUE,
  TRUE,
  TRUE,
  FALSE,
  TRUE,
  NOW(),
  NOW()
)
ON CONFLICT (email) DO UPDATE
  SET
    name       = EXCLUDED.name,
    role       = EXCLUDED.role,
    password   = EXCLUDED.password,
    updated_at = NOW();
