-- Question type "address" with DaData autocomplete
ALTER TABLE questions
  MODIFY COLUMN answer_type ENUM('checkbox', 'text', 'select', 'address') NOT NULL DEFAULT 'checkbox';
