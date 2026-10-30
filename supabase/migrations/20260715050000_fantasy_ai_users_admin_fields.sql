ALTER TABLE tenant_fantasy_ai.users
  ADD COLUMN IF NOT EXISTS scan_count_today INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_scan_date DATE,
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false;
