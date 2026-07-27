import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { ensureAudioRoot } from './services/audioStorage.js';
import authRoutes from './routes/auth.js';
import usersRoutes from './routes/users.js';
import surveysRoutes from './routes/surveys.js';
import dadataRoutes from './routes/dadata.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const base = config.basePath;

ensureAudioRoot();

app.use(
  cors({
    origin: config.nodeEnv === 'production' ? false : config.clientUrl,
    credentials: true,
  })
);
app.use(express.json({ limit: '2mb' }));

const apiRouter = express.Router();
apiRouter.get('/health', (_req, res) => {
  res.json({ ok: true, basePath: base || '/' });
});
apiRouter.use('/auth', authRoutes);
apiRouter.use('/users', usersRoutes);
apiRouter.use('/surveys', surveysRoutes);
apiRouter.use('/dadata', dadataRoutes);

app.use(`${base}/api`, apiRouter);

const clientDist = path.resolve(__dirname, '../../client/dist');
app.use(
  base || '/',
  express.static(clientDist, {
    setHeaders(res, filePath) {
      if (filePath.endsWith('index.html')) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  })
);

app.get(`${base}/*`, (req, res, next) => {
  if (req.path.startsWith(`${base}/api`)) return next();
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.sendFile(path.join(clientDist, 'index.html'), (err) => {
    if (err) next();
  });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'Файл слишком большой' });
  }
  if (err?.message && /docx|аудиофайл|Нужен файл/i.test(err.message)) {
    return res.status(400).json({ error: err.message });
  }
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

app.listen(config.port, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${config.port}${base || '/'}`;
  console.log(`Oprosy: ${url}`);
});
