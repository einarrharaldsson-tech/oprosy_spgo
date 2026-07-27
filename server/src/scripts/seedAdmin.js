import bcrypt from 'bcryptjs';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

const [rows] = await conn.execute("SELECT id FROM users WHERE role='admin' LIMIT 1");
if (!rows.length) {
  const hash = await bcrypt.hash('admin', 10);
  await conn.execute(
    'INSERT INTO users (login, password_hash, full_name, role) VALUES (?,?,?,?)',
    ['admin', hash, 'Администратор', 'admin']
  );
  console.log('Admin created: admin/admin');
} else {
  console.log('Admin already exists');
}
await conn.end();
