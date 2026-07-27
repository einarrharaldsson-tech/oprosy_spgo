-- Migration: audio recording per response session
ALTER TABLE responses
  ADD COLUMN IF NOT EXISTS audio_path VARCHAR(500) NULL AFTER respondent_note,
  ADD COLUMN IF NOT EXISTS audio_mime VARCHAR(64) NULL AFTER audio_path,
  ADD COLUMN IF NOT EXISTS audio_size INT UNSIGNED NULL AFTER audio_mime,
  ADD COLUMN IF NOT EXISTS audio_duration_sec INT UNSIGNED NULL AFTER audio_size;
