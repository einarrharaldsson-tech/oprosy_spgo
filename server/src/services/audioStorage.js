import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const AUDIO_ROOT = path.resolve(__dirname, '../../uploads/audio');

const ALLOWED_MIME = new Set([
  'audio/webm',
  'audio/webm;codecs=opus',
  'audio/ogg',
  'audio/ogg;codecs=opus',
  'audio/mp4',
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
]);

export function ensureAudioRoot() {
  fs.mkdirSync(AUDIO_ROOT, { recursive: true });
}

export function surveyAudioDir(surveyId) {
  return path.join(AUDIO_ROOT, `survey_${surveyId}`);
}

export function normalizeMime(mime) {
  if (!mime) return 'audio/webm';
  const base = String(mime).split(';')[0].trim().toLowerCase();
  return base || 'audio/webm';
}

export function isAllowedAudioMime(mime) {
  const normalized = normalizeMime(mime);
  if (ALLOWED_MIME.has(normalized)) return true;
  return String(mime || '').toLowerCase().startsWith('audio/');
}

export function extensionForMime(mime) {
  const m = normalizeMime(mime);
  if (m.includes('webm')) return 'webm';
  if (m.includes('ogg')) return 'ogg';
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
  if (m.includes('mp4')) return 'm4a';
  if (m.includes('wav')) return 'wav';
  return 'webm';
}

/** Relative path stored in DB */
export function buildRelativeAudioPath(surveyId, responseId, mime) {
  const ext = extensionForMime(mime);
  return `survey_${surveyId}/response_${responseId}.${ext}`;
}

export function absoluteAudioPath(relativePath) {
  const safe = String(relativePath || '').replace(/\\/g, '/');
  if (!safe || safe.includes('..')) return null;
  const full = path.resolve(AUDIO_ROOT, safe);
  if (!full.startsWith(AUDIO_ROOT)) return null;
  return full;
}

export async function saveResponseAudio({ surveyId, responseId, buffer, mime }) {
  ensureAudioRoot();
  const relative = buildRelativeAudioPath(surveyId, responseId, mime);
  const dir = surveyAudioDir(surveyId);
  fs.mkdirSync(dir, { recursive: true });
  const full = path.join(AUDIO_ROOT, relative.replace(/\//g, path.sep));
  await fs.promises.writeFile(full, buffer);
  return {
    relativePath: relative,
    mime: normalizeMime(mime),
    size: buffer.length,
  };
}

export function deleteAudioFile(relativePath) {
  const full = absoluteAudioPath(relativePath);
  if (full && fs.existsSync(full)) {
    fs.unlinkSync(full);
  }
}

/** Remove all audio files for a survey directory */
export function deleteSurveyAudioDir(surveyId) {
  const dir = surveyAudioDir(surveyId);
  if (!fs.existsSync(dir)) return;
  fs.rmSync(dir, { recursive: true, force: true });
}
