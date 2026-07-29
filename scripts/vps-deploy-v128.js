import { Client } from 'ssh2';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const PASS = process.env.VPS_PASSWORD;
if (!PASS) {
  console.error('Set VPS_PASSWORD');
  process.exit(1);
}

const REMOTE = '/var/www/oprosy';
const BACKUP_STAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

const CODE_FILES = [
  'package.json',
  'client/package.json',
  'server/package.json',
  'client/src/version.js',
  'client/src/styles.css',
  'client/src/App.jsx',
  'client/src/api.js',
  'client/src/components/Layout.jsx',
  'client/src/hooks/useVoiceRecorder.js',
  'client/src/pages/ConductPage.jsx',
  'client/src/pages/OfflineQueuePage.jsx',
  'client/src/lib/offlineConductLog.js',
  'client/src/lib/offlineConductStore.js',
  'client/src/lib/offlineConductSync.js',
  'server/src/routes/surveys.js',
  'server/src/services/audioStorage.js',
  'server/src/services/responseUploads.js',
  'server/src/scripts/initDb.js',
  'database/schema.sql',
  'database/migrations/009_response_upload_sessions.sql',
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
  return new Promise((resolve, reject) =>
    sftp.fastPut(local, remote, (e) => (e ? reject(e) : resolve()))
  );
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

const remoteCmd = [
  'set -e',
  `cd ${REMOTE}`,
  'mkdir -p /var/backups/oprosy',
  `tar -czf /var/backups/oprosy/oprosy-v1.2.8-${BACKUP_STAMP}.tgz --exclude=node_modules --exclude=server/node_modules --exclude=client/node_modules --exclude=server/uploads .`,
  'echo backup_ok',
  'ls -lh /var/backups/oprosy/oprosy-v1.2.8-*.tgz | tail -n 3',
  'cd client/dist/assets',
  "KEEP_JS=$(grep -oE 'index-[A-Za-z0-9_-]+\\.js' ../index.html | head -1)",
  "KEEP_CSS=$(grep -oE 'index-[A-Za-z0-9_-]+\\.css' ../index.html | head -1)",
  'for f in *; do [ "$f" = "$KEEP_JS" ] || [ "$f" = "$KEEP_CSS" ] || rm -f -- "$f"; done',
  'grep -o "1\\.2\\.8" "$KEEP_JS" | head -3 || true',
  'pm2 restart oprosy',
  'sleep 2',
  'curl -sS http://127.0.0.1:3000/api/health',
  'echo',
].join('\n');

const conn = new Client();
conn
  .on('ready', async () => {
    try {
      const sftp = await new Promise((res, rej) =>
        conn.sftp((e, s) => (e ? rej(e) : res(s)))
      );
      for (const f of CODE_FILES) {
        const local = path.join(ROOT, f);
        if (!fs.existsSync(local)) {
          console.warn('skip missing', f);
          continue;
        }
        await mkdirp(sftp, path.posix.dirname(`${REMOTE}/${f}`));
        await put(sftp, local, `${REMOTE}/${f}`);
        console.log('up', f);
      }
      for (const f of walkDist(path.join(ROOT, 'client/dist'))) {
        await mkdirp(sftp, path.posix.dirname(`${REMOTE}/client/dist/${f.rel}`));
        await put(sftp, f.full, `${REMOTE}/client/dist/${f.rel}`);
      }
      console.log('dist uploaded');
      conn.exec(remoteCmd, (e, s) => {
        if (e) throw e;
        s.on('data', (d) => process.stdout.write(d));
        s.stderr.on('data', (d) => process.stderr.write(d));
        s.on('close', (code) => {
          conn.end();
          process.exit(code || 0);
        });
      });
    } catch (err) {
      console.error(err);
      conn.end();
      process.exit(1);
    }
  })
  .on('error', (e) => {
    console.error(e);
    process.exit(1);
  })
  .connect({ host: '31.31.201.243', username: 'root', password: PASS });
