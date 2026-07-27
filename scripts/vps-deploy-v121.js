import { Client } from 'ssh2';
import fs from 'fs';
import path from 'path';
const PASS = process.env.VPS_PASSWORD;
const REMOTE = '/var/www/oprosy';
const ROOT = process.cwd();
const files = [
  'package.json',
  'client/package.json',
  'server/package.json',
  'client/src/version.js',
  'client/src/components/AppFooter.jsx',
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
    await mkdirp(sftp, path.posix.dirname(`${REMOTE}/${f}`));
    await put(sftp, path.join(ROOT, f), `${REMOTE}/${f}`);
    console.log('up', f);
  }
  for (const f of walkDist(path.join(ROOT, 'client/dist'))) {
    await mkdirp(sftp, path.posix.dirname(`${REMOTE}/client/dist/${f.rel}`));
    await put(sftp, f.full, `${REMOTE}/client/dist/${f.rel}`);
  }
  console.log('dist uploaded');
  conn.exec(`
cd ${REMOTE}/client/dist/assets
KEEP_JS=$(grep -oE 'index-[A-Za-z0-9_-]+\\.js' ../index.html | head -1)
KEEP_CSS=$(grep -oE 'index-[A-Za-z0-9_-]+\\.css' ../index.html | head -1)
for f in *; do [ "$f" = "$KEEP_JS" ] || [ "$f" = "$KEEP_CSS" ] || rm -f -- "$f"; done
pm2 restart oprosy
sleep 1
curl -sS http://127.0.0.1:3000/api/health
echo
`, (e, s) => {
    s.on('data', (d) => process.stdout.write(d));
    s.stderr.on('data', (d) => process.stderr.write(d));
    s.on('close', (code) => { console.log('remote exit', code); conn.end(); });
  });
}).connect({ host: '31.31.201.243', username: 'root', password: PASS });
