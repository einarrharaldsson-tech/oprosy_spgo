import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

function normalizeBasePath(value) {
  if (!value || value === '/') return '';
  return `/${String(value).replace(/^\/+|\/+$/g, '')}`;
}

export const config = {
  port: Number(process.env.PORT) || 3000,
  basePath: normalizeBasePath(process.env.BASE_PATH),
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
  nodeEnv: process.env.NODE_ENV || 'development',
  dadataApiKey: process.env.DADATA_API_KEY || '',
  db: {
    host: process.env.DB_HOST === 'localhost' ? '127.0.0.1' : (process.env.DB_HOST || '127.0.0.1'),
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'oprosy',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'oprosy',
  },
};
