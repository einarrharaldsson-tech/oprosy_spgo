-- Migration: front-camera photo per response session
ALTER TABLE responses
  ADD COLUMN IF NOT EXISTS photo_path VARCHAR(500) NULL AFTER audio_duration_sec,
  ADD COLUMN IF NOT EXISTS photo_mime VARCHAR(64) NULL AFTER photo_path,
  ADD COLUMN IF NOT EXISTS photo_size INT UNSIGNED NULL AFTER photo_mime;
