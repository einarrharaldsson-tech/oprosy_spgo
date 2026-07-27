ALTER TABLE surveys
  ADD COLUMN IF NOT EXISTS conduct_mode ENUM('scroll', 'step') NOT NULL DEFAULT 'scroll' AFTER description;
