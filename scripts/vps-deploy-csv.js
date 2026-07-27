import { Client } from 'ssh2';
import fs from 'fs';
import path from 'path';

const HOST = '31.31.201.243';
const PASS = process.env.VPS_PASSWORD;
const REMOTE = '/var/www/oprosy';
const ROOT = process.cwd();
const files = [
  'server/src/services/csv.js',
  'server/src/routes/surveys.js',
  'client/src/api.js',
  'client/src/pages/SurveyResponsesPage.jsx',
];

function walkDist(dir, base = dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel = path.relative(base, full).replace(/\\/g, '/');
    if (fs.statSync(full).isDirectory()) walkDist(full, base, out);
    else out.push({ full, rel });
  }
  return out;
}
function put(sftp, local, remote) {
  return new Promise((resolve, reject) => sftp.fastPut(local, remote, (e) => (e ? reject(e) : resolve())));
}
function mkdirp(sftp, dir) {
  return new Promise((resolve) => {
    const parts = dir.split('/').filter(Boolean);
    let cur = '';
    const next = (i) => {
      if (i >= parts.length) return resolve();
      cur += '/' + parts[i];
      sftp.mkdir(cur, () => next(i + 1));
    };
    next(0);
  });
}

const conn = new Client();
conn.on('ready', async () => {
  const sftp = await new Promise((res, rej) => conn.sftp((e, s) => (e ? rej(e) : res(s))));
  for (const f of files) {
    const remote = `${REMOTE}/${f}`;
    await mkdirp(sftp, path.posix.dirname(remote));
    await put(sftp, path.join(ROOT, f), remote);
    console.log('up', f);
  }
  for (const f of walkDist(path.join(ROOT, 'client/dist'))) {
    const remote = `${REMOTE}/client/dist/${f.rel}`;
    await mkdirp(sftp, path.posix.dirname(remote));
    await put(sftp, f.full, remote);
  }
  conn.exec('pm2 restart oprosy && sleep 2 && curl -sS http://127.0.0.1:3000/api/health', (e, stream) => {
    stream.on('data', (d) => process.stdout.write(d));
    stream.stderr.on('data', (d) => process.stderr.write(d));
    stream.on('close', () => { console.log('\ndone'); conn.end(); });
  });
}).connect({ host: HOST, username: 'root', password: PASS });
