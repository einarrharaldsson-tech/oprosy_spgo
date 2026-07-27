import multer from 'multer';

const MAX_AUDIO_MB = Number(process.env.MAX_AUDIO_MB) || 50;
const MAX_DOCX_MB = Number(process.env.MAX_DOCX_MB) || 10;

export const uploadAudio = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_AUDIO_MB * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    if (!file.mimetype || !file.mimetype.startsWith('audio/')) {
      return cb(new Error('Нужен аудиофайл'));
    }
    cb(null, true);
  },
});

export const uploadDocx = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_DOCX_MB * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const name = (file.originalname || '').toLowerCase();
    const okMime =
      file.mimetype ===
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      file.mimetype === 'application/octet-stream' ||
      file.mimetype === 'application/zip';
    if (!name.endsWith('.docx') && !okMime) {
      return cb(new Error('Нужен файл .docx'));
    }
    if (!name.endsWith('.docx')) {
      return cb(new Error('Нужен файл .docx'));
    }
    cb(null, true);
  },
});
