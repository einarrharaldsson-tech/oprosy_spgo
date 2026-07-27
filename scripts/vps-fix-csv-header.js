import { Client } from 'ssh2';
import fs from 'fs';
import path from 'path';

const PASS = process.env.VPS_PASSWORD;
const REMOTE = '/var/www/oprosy';
const local = path.join(process.cwd(), 'server/src/routes/surveys.js');

const conn = new Client();
conn.on('ready', () => {
  conn.sftp((e, sftp) => {
    sftp.fastPut(local, `${REMOTE}/server/src/routes/surveys.js`, (err) => {
      if (err) { console.error(err); conn.end(); return; }
      console.log('uploaded surveys.js');
      conn.exec(`pm2 restart oprosy && sleep 2 && node <<'NODE'
import('mysql2/promise').then(async (mysql) => {
  // quick login+export via http
});
NODE
TOKEN=$(curl -sS -X POST http://127.0.0.1:3000/api/auth/login -H 'Content-Type: application/json' --data-binary '{"login":"admin","password":"admin"}')
echo "$TOKEN" | head -c 80; echo
TOK=$(echo "$TOKEN" | sed -n 's/.*"token":"\\([^"]*\\)".*/\\1/p')
SID=$(curl -sS http://127.0.0.1:3000/api/surveys -H "Authorization: Bearer $TOK" | sed -n 's/.*"id":\\([0-9]*\\).*/\\1/p' | head -1)
echo "sid=$SID"
curl -sS -D /tmp/h.txt -o /tmp/export.csv "http://127.0.0.1:3000/api/surveys/$SID/responses/export.csv" -H "Authorization: Bearer $TOK"
head -5 /tmp/h.txt
echo '---'
head -c 200 /tmp/export.csv; echo
wc -c /tmp/export.csv
`, (e2, stream) => {
        stream.on('data', (d) => process.stdout.write(d));
        stream.stderr.on('data', (d) => process.stderr.write(d));
        stream.on('close', () => conn.end());
      });
    });
  });
}).connect({ host: '31.31.201.243', username: 'root', password: PASS });
