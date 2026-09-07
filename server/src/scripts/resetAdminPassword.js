import bcrypt from 'bcryptjs';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const NEW_PASSWORD = process.argv[2] || 'admin';

const conn = await mysql.createConnection({
  host: process.env.DB_HOST === 'localhost' ? '127.0.0.1' : (process.env.DB_HOST || '127.0.0.1'),
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'oprosy',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'oprosy',
});

const [rows] = await conn.execute("SELECT id, login, role FROM users WHERE role='admin'");
if (!rows.length) {
  console.log('Админ не найден в БД.');
} else {
  const hash = await bcrypt.hash(NEW_PASSWORD, 10);
  for (const user of rows) {
    await conn.execute('UPDATE users SET password_hash = ? WHERE id = ?', [hash, user.id]);
    console.log(`Пароль сброшен: ${user.login} (${user.role}) -> ${NEW_PASSWORD}`);
  }
}
await conn.end();