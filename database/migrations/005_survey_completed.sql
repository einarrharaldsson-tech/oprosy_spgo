-- Status "completed" (Завершённые) for editors; archive remains admin-only
ALTER TABLE surveys
  MODIFY COLUMN status ENUM('draft', 'active', 'completed', 'archived') NOT NULL DEFAULT 'draft';

ALTER TABLE surveys
  ADD COLUMN completed_at TIMESTAMP NULL AFTER archived_at;
