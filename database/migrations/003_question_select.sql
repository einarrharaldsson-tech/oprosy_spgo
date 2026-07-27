-- Add dropdown (select) answer type for questions
ALTER TABLE questions
  MODIFY COLUMN answer_type ENUM('checkbox', 'text', 'select') NOT NULL DEFAULT 'checkbox';
