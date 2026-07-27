import { Client } from 'ssh2';
import fs from 'fs';
import path from 'path';
const PASS = process.env.VPS_PASSWORD;
const DADATA = process.env.DADATA_API_KEY;
const REMOTE = '/var/www/oprosy';
const ROOT = process.cwd();
const files = [
  'database/schema.sql',
  'database/migrations/006_question_address.sql',
  'server/src/scripts/initDb.js',
  'server/src/config.js',
  'server/src/index.js',
  'server/src/routes/dadata.js',
  'server/src/routes/surveys.js',
  'client/src/components/AddressInput.jsx',
  'client/src/pages/ConductPage.jsx',
  'client/src/pages/ConstructorEditPage.jsx',
  'client/src/pages/SurveyResponsesPage.jsx',
  'client/src/styles.css',
  '.env.example',
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
  const remoteScript = `
set -e
cd ${REMOTE}
# migration
bash -lc 'set -a; source ${REMOTE}/.env; set +a; mysql -h 127.0.0.1 -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" < ${REMOTE}/database/migrations/006_question_address.sql' || true
# ensure DADATA_API_KEY in .env
if grep -q '^DADATA_API_KEY=' ${REMOTE}/.env; then
  sed -i 's/^DADATA_API_KEY=.*/DADATA_API_KEY=${DADATA}/' ${REMOTE}/.env
else
  printf '\\nDADATA_API_KEY=${DADATA}\\n' >> ${REMOTE}/.env
fi
grep -E '^DADATA_API_KEY=' ${REMOTE}/.env | sed 's/=.*/=***/'
mysql -N -e "SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='oprosy' AND TABLE_NAME='questions' AND COLUMN_NAME='answer_type'" 2>/dev/null || true
cd ${REMOTE}/client/dist/assets
KEEP_JS=$(grep -oE 'index-[A-Za-z0-9_-]+\\.js' ../index.html | head -1)
KEEP_CSS=$(grep -oE 'index-[A-Za-z0-9_-]+\\.css' ../index.html | head -1)
for f in *; do [ "$f" = "$KEEP_JS" ] || [ "$f" = "$KEEP_CSS" ] || rm -f -- "$f"; done
pm2 restart oprosy --update-env
sleep 2
curl -sS http://127.0.0.1:3000/api/health
echo
`;
  conn.exec(remoteScript, (e, s) => {
    if (e) { console.error(e); conn.end(); return; }
    s.on('data', (d) => process.stdout.write(d));
    s.stderr.on('data', (d) => process.stderr.write(d));
    s.on('close', (code) => { console.log('remote exit', code); conn.end(); });
  });
}).connect({ host: '31.31.201.243', username: 'root', password: PASS });
