import { Client } from 'ssh2';
const PASS = process.env.VPS_PASSWORD;
const conn = new Client();
conn.on('ready', () => {
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
const c = await mysql.createConnection({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT||3306),
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
});
await c.query('UPDATE users SET password_hash=? WHERE login=?', [hash, 'admin']);
const [s] = await c.query('SELECT id, title FROM surveys ORDER BY id LIMIT 3');
console.log('surveys', JSON.stringify(s));
await c.end();
NODE
RESP=$(curl -sS -X POST http://127.0.0.1:3000/api/auth/login -H 'Content-Type: application/json' --data-binary '{"login":"admin","password":"admin"}')
echo "$RESP" | head -c 120; echo
TOK=$(printf '%s' "$RESP" | sed -n 's/.*"token":"\\([^"]*\\)".*/\\1/p')
SID=$(printf '%s' "$(curl -sS http://127.0.0.1:3000/api/surveys -H "Authorization: Bearer $TOK")" | sed -n 's/.*"id":\\([0-9]\\+\\).*/\\1/p' | head -1)
echo "toklen=\${#TOK} sid=$SID"
curl -sS -D /tmp/h.txt -o /tmp/export.csv "http://127.0.0.1:3000/api/surveys/\${SID}/responses/export.csv" -H "Authorization: Bearer $TOK"
grep -i content-disposition /tmp/h.txt || head -15 /tmp/h.txt
echo '--- body ---'
head -c 400 /tmp/export.csv; echo
wc -c /tmp/export.csv
`;
  conn.exec(cmd, (e, s) => {
    s.on('data', (d) => process.stdout.write(d));
    s.stderr.on('data', (d) => process.stderr.write(d));
    s.on('close', () => conn.end());
  });
}).connect({ host: '31.31.201.243', username: 'root', password: PASS });
