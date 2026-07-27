ALTER TABLE options
  ADD COLUMN IF NOT EXISTS jump_action ENUM('none', 'jump', 'end') NOT NULL DEFAULT 'none' AFTER text,
  ADD COLUMN IF NOT EXISTS jump_target_question_id INT UNSIGNED NULL AFTER jump_action,
  ADD CONSTRAINT fk_options_jump_target
    FOREIGN KEY (jump_target_question_id) REFERENCES questions(id) ON DELETE SET NULL;
