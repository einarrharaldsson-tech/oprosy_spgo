import { Client } from 'ssh2';

const PASSWORD = process.env.VPS_PASSWORD;
const conn = new Client();
conn
  .on('ready', () => {
    const cmd = `
set -e
cd /var/www/oprosy/server
node --input-type=module <<'NODE'
import bcrypt from 'bcryptjs';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const hash = await bcrypt.hash('admin', 10);
const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});
const [rows] = await conn.query('SELECT id, login, role FROM users');
console.log('users', JSON.stringify(rows));
await conn.query('UPDATE users SET password_hash = ? WHERE login = ?', [hash, 'admin']);
console.log('admin password reset to admin');
await conn.end();
NODE
curl -sS -X POST http://127.0.0.1/api/auth/login -H 'Content-Type: application/json' -d '{"login":"admin","password":"admin"}'
echo
`;
    conn.exec(cmd, (e, s) => {
      s.on('data', (d) => process.stdout.write(d));
      s.stderr.on('data', (d) => process.stderr.write(d));
      s.on('close', () => conn.end());
    });
  })
  .connect({ host: '31.31.201.243', username: 'root', password: PASSWORD });
