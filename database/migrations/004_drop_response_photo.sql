-- Remove front-camera photo columns (feature cancelled)
ALTER TABLE responses DROP COLUMN IF EXISTS photo_size;
ALTER TABLE responses DROP COLUMN IF EXISTS photo_mime;
ALTER TABLE responses DROP COLUMN IF EXISTS photo_path;
