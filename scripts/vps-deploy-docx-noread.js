import { Client } from 'ssh2';
import fs from 'fs';
import path from 'path';

const PASS = process.env.VPS_PASSWORD;
const REMOTE = '/var/www/oprosy';
const ROOT = process.cwd();
const f = 'server/src/services/docxImport.js';

const conn = new Client();
conn.on('ready', async () => {
  const sftp = await new Promise((res, rej) => conn.sftp((e, s) => (e ? rej(e) : res(s))));
  await new Promise((resolve, reject) =>
    sftp.fastPut(path.join(ROOT, f), `${REMOTE}/${f}`, (e) => (e ? reject(e) : resolve()))
  );
  console.log('uploaded', f);

  const remoteCmd = `
set -e
grep -n "stripDoNotRead\\|не\\\\s\\*зачитывать" ${REMOTE}/${f} | head -10
pm2 restart oprosy
sleep 1
curl -sS http://127.0.0.1:3000/api/health
echo
`;
  conn.exec(remoteCmd, (e, s) => {
    if (e) throw e;
    s.on('data', (d) => process.stdout.write(d));
    s.stderr.on('data', (d) => process.stderr.write(d));
    s.on('close', (code) => {
      conn.end();
      process.exit(code || 0);
    });
  });
}).on('error', (e) => {
  console.error(e);
  process.exit(1);
}).connect({ host: '31.31.201.243', username: 'root', password: PASS });
