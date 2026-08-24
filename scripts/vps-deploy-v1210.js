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

const localEnv = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
const vibeKeyMatch = localEnv.match(/^VIBE_API_KEY=(.+)$/m);
const VIBE_API_KEY = (vibeKeyMatch?.[1] || '').trim();
if (!VIBE_API_KEY) {
  console.error('Local .env is missing VIBE_API_KEY');
  process.exit(1);
}

const REMOTE = '/var/www/oprosy';
const BACKUP_STAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

const CODE_FILES = [
  'package.json',
  'client/package.json',
  'server/package.json',
  'client/src/version.js',
  'client/src/components/ResponseAudio.jsx',
  'server/src/routes/surveys.js',
  'server/src/services/vibeTranscribe.js',
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

function readRemote(sftp, remote) {
  return new Promise((resolve, reject) => {
    sftp.readFile(remote, (err, data) => (err ? reject(err) : resolve(data.toString('utf8'))));
  });
}

function writeRemote(sftp, remote, body) {
  return new Promise((resolve, reject) => {
    sftp.writeFile(remote, body, (err) => (err ? reject(err) : resolve()));
  });
}

const distFiles = walkDist(path.join(ROOT, 'client/dist'));
const keepAssets = distFiles
  .filter((f) => f.rel.startsWith('assets/'))
  .map((f) => path.posix.basename(f.rel))
  .join(' ');

const remoteCmd = [
  'set -e',
  `cd ${REMOTE}`,
  'mkdir -p /var/backups/oprosy',
  `tar -czf /var/backups/oprosy/oprosy-v1.2.10-${BACKUP_STAMP}.tgz --exclude=node_modules --exclude=server/node_modules --exclude=client/node_modules --exclude=server/uploads .`,
  'echo backup_ok',
  'ls -lh /var/backups/oprosy/oprosy-v1.2.10-*.tgz | tail -n 3',
  'if grep -q "VIBE_API_KEY=" .env; then echo vibe_key_present; else echo vibe_key_missing; fi',
  'cd client/dist/assets',
  `KEEP="${keepAssets}"`,
  'for f in *; do echo " $KEEP " | grep -q " $f " || rm -f -- "$f"; done',
  'grep -o "1\\.2\\.10" index-*.js | head -3 || true',
  'ls -1',
  'NGINX_CONF=$(ls /etc/nginx/sites-enabled/* 2>/dev/null | head -1)',
  'if [ -n "$NGINX_CONF" ] && ! grep -q proxy_read_timeout "$NGINX_CONF"; then',
  '  sed -i "s/proxy_http_version 1.1;/proxy_http_version 1.1;\\n        proxy_read_timeout 900s;\\n        proxy_send_timeout 900s;/" "$NGINX_CONF"',
  '  nginx -t && systemctl reload nginx',
  '  echo nginx_timeouts_updated',
  'else',
  '  echo nginx_timeouts_ok',
  'fi',
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
      for (const f of distFiles) {
        await mkdirp(sftp, path.posix.dirname(`${REMOTE}/client/dist/${f.rel}`));
        await put(sftp, f.full, `${REMOTE}/client/dist/${f.rel}`);
      }
      console.log('dist uploaded', distFiles.length);

      const envBody = await readRemote(sftp, `${REMOTE}/.env`);
      const nextEnv = /^VIBE_API_KEY=/m.test(envBody)
        ? envBody.replace(/^VIBE_API_KEY=.*$/m, `VIBE_API_KEY=${VIBE_API_KEY}`)
        : `${envBody.replace(/\s*$/, '')}\nVIBE_API_KEY=${VIBE_API_KEY}\n`;
      await writeRemote(sftp, `${REMOTE}/.env`, nextEnv);
      console.log('vibe key written to remote .env');

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
