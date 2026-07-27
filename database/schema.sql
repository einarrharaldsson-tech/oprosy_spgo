-- MariaDB schema for Oprosy survey app
CREATE DATABASE IF NOT EXISTS oprosy
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE oprosy;

CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  login VARCHAR(64) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(255) NOT NULL DEFAULT '',
  role ENUM('admin', 'editor', 'user') NOT NULL DEFAULT 'user',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS surveys (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  description TEXT NULL,
  conduct_mode ENUM('scroll', 'step') NOT NULL DEFAULT 'scroll',
  status ENUM('draft', 'active', 'completed', 'archived') NOT NULL DEFAULT 'draft',
  created_by INT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  archived_at TIMESTAMP NULL,
  completed_at TIMESTAMP NULL,
  CONSTRAINT fk_surveys_created_by FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS survey_access (
  survey_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (survey_id, user_id),
  CONSTRAINT fk_access_survey FOREIGN KEY (survey_id) REFERENCES surveys(id) ON DELETE CASCADE,
  CONSTRAINT fk_access_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS questions (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  survey_id INT UNSIGNED NOT NULL,
  text VARCHAR(1000) NOT NULL,
  answer_type ENUM('checkbox', 'text', 'select', 'address') NOT NULL DEFAULT 'checkbox',
  is_required TINYINT(1) NOT NULL DEFAULT 1,
  allow_multiple TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  CONSTRAINT fk_questions_survey FOREIGN KEY (survey_id) REFERENCES surveys(id) ON DELETE CASCADE,
  INDEX idx_questions_survey (survey_id, sort_order)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS options (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  question_id INT UNSIGNED NOT NULL,
  text VARCHAR(500) NOT NULL,
  jump_action ENUM('none', 'jump', 'end') NOT NULL DEFAULT 'none',
  jump_target_question_id INT UNSIGNED NULL,
  sort_order INT NOT NULL DEFAULT 0,
  CONSTRAINT fk_options_question FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE,
  CONSTRAINT fk_options_jump_target FOREIGN KEY (jump_target_question_id) REFERENCES questions(id) ON DELETE SET NULL,
  INDEX idx_options_question (question_id, sort_order)
) ENGINE=InnoDB;

-- One conducted session of a survey (one respondent fill-out + voice recording)
CREATE TABLE IF NOT EXISTS responses (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  survey_id INT UNSIGNED NOT NULL,
  conducted_by INT UNSIGNED NOT NULL,
  respondent_note VARCHAR(500) NULL,
  audio_path VARCHAR(500) NULL,
  audio_mime VARCHAR(64) NULL,
  audio_size INT UNSIGNED NULL,
  audio_duration_sec INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_responses_survey FOREIGN KEY (survey_id) REFERENCES surveys(id),
  CONSTRAINT fk_responses_user FOREIGN KEY (conducted_by) REFERENCES users(id),
  INDEX idx_responses_survey (survey_id, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS answer_values (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  response_id INT UNSIGNED NOT NULL,
  question_id INT UNSIGNED NOT NULL,
  option_id INT UNSIGNED NULL,
  text_value TEXT NULL,
  CONSTRAINT fk_answers_response FOREIGN KEY (response_id) REFERENCES responses(id) ON DELETE CASCADE,
  CONSTRAINT fk_answers_question FOREIGN KEY (question_id) REFERENCES questions(id),
  CONSTRAINT fk_answers_option FOREIGN KEY (option_id) REFERENCES options(id),
  INDEX idx_answers_response (response_id)
) ENGINE=InnoDB;
