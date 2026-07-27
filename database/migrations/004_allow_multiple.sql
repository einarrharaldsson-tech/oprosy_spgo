-- Checkbox questions: multiple or single selection
ALTER TABLE questions
  ADD COLUMN allow_multiple TINYINT(1) NOT NULL DEFAULT 1 AFTER is_required;
