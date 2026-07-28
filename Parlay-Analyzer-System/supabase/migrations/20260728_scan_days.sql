-- Configurable upcoming-fixture scan window. Existing installations keep
-- the previous behavior through the default value of 11 days.
ALTER TABLE scheduler_config
  ADD COLUMN IF NOT EXISTS scan_days integer NOT NULL DEFAULT 11;

ALTER TABLE scheduler_config
  DROP CONSTRAINT IF EXISTS scheduler_config_scan_days_check;

ALTER TABLE scheduler_config
  ADD CONSTRAINT scheduler_config_scan_days_check
  CHECK (scan_days BETWEEN 1 AND 90);