CREATE TABLE IF NOT EXISTS response_upload_sessions (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  survey_id INT UNSIGNED NOT NULL,
  conducted_by INT UNSIGNED NOT NULL,
  client_session_id VARCHAR(64) NOT NULL,
  status ENUM('active', 'uploading', 'finalized', 'failed') NOT NULL DEFAULT 'active',
  audio_mime VARCHAR(64) NULL,
  audio_duration_sec INT UNSIGNED NULL,
  total_chunks INT UNSIGNED NOT NULL DEFAULT 0,
  response_id INT UNSIGNED NULL,
  last_error VARCHAR(500) NULL,
  finalized_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_upload_sessions_survey FOREIGN KEY (survey_id) REFERENCES surveys(id) ON DELETE CASCADE,
  CONSTRAINT fk_upload_sessions_user FOREIGN KEY (conducted_by) REFERENCES users(id),
  CONSTRAINT fk_upload_sessions_response FOREIGN KEY (response_id) REFERENCES responses(id) ON DELETE SET NULL,
  UNIQUE KEY uq_upload_session_client (client_session_id),
  INDEX idx_upload_sessions_survey_user (survey_id, conducted_by, status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS response_upload_chunks (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  upload_session_id INT UNSIGNED NOT NULL,
  chunk_index INT UNSIGNED NOT NULL,
  chunk_size INT UNSIGNED NOT NULL,
  relative_path VARCHAR(500) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_upload_chunks_session FOREIGN KEY (upload_session_id) REFERENCES response_upload_sessions(id) ON DELETE CASCADE,
  UNIQUE KEY uq_upload_chunk (upload_session_id, chunk_index)
) ENGINE=InnoDB;
