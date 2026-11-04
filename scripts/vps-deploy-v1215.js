import { Client } from 'ssh2';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const PASS = process.env.VPS_PASSWORD;
const AITUNNEL_API_KEY = process.env.AITUNNEL_API_KEY;
if (!PASS) {
  console.error('Set VPS_PASSWORD');
  process.exit(1);
}
if (!AITUNNEL_API_KEY) {
  console.error('Set AITUNNEL_API_KEY');
  process.exit(1);
}

const REMOTE = '/var/www/oprosy';
const BACKUP_STAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

const CODE_FILES = [
  'package.json',
  'client/package.json',
  'server/package.json',
  'client/src/version.js',
  'server/src/services/vibeTranscribe.js',
  'server/src/routes/surveys.js',
  '.env.example',
  'docs/razvertyvanie-i-ekspluataciya.md',
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

function readRemote(sftp, remotePath) {
  return new Promise((resolve, reject) => {
    sftp.readFile(remotePath, (e, data) => (e ? reject(e) : resolve(data.toString('utf8'))));
  });
}

function writeRemote(sftp, remotePath, content) {
  return new Promise((resolve, reject) => {
    sftp.writeFile(remotePath, content, (e) => (e ? reject(e) : resolve()));
  });
}

function upsertEnv(body, key, value) {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (re.test(body)) return body.replace(re, line);
  return `${body.replace(/\s*$/, '')}\n${line}\n`;
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
  `tar -czf /var/backups/oprosy/oprosy-v1.2.15-${BACKUP_STAMP}.tgz --exclude=node_modules --exclude=server/node_modules --exclude=client/node_modules --exclude=server/uploads .`,
  'echo backup_ok',
  'cd client/dist/assets',
  `KEEP="${keepAssets}"`,
  'for f in *; do echo " $KEEP " | grep -q " $f " || rm -f -- "$f"; done',
  `cd ${REMOTE}`,
  'pm2 restart oprosy --update-env',
  'sleep 2',
  'curl -sS http://127.0.0.1:3000/api/health',
  'echo',
  'grep -E "^(AITUNNEL_|VIBE_)" .env | sed "s/=.*/=***/"',
  'grep -o "1\\.2\\.15" client/dist/assets/index-*.js | head -2 || true',
].join('\n');

const conn = new Client();
conn
  .on('ready', async () => {
    try {
      const sftp = await new Promise((res, rej) =>
        conn.sftp((e, s) => (e ? rej(e) : res(s)))
      );

      let envBody = await readRemote(sftp, `${REMOTE}/.env`);
      envBody = upsertEnv(envBody, 'AITUNNEL_API_KEY', AITUNNEL_API_KEY);
      envBody = upsertEnv(envBody, 'AITUNNEL_ASR_MODEL', 'qwen3-asr-1.7b');
      envBody = upsertEnv(envBody, 'AITUNNEL_CHAT_MODEL', 'gpt-4o-mini');
      await writeRemote(sftp, `${REMOTE}/.env`, envBody);
      console.log('env updated (AITUNNEL_*)');

      for (const f of CODE_FILES) {
        const local = path.join(ROOT, f);
        await mkdirp(sftp, path.posix.dirname(`${REMOTE}/${f}`));
        await put(sftp, local, `${REMOTE}/${f}`);
        console.log('up', f);
      }
      for (const f of distFiles) {
        await mkdirp(sftp, path.posix.dirname(`${REMOTE}/client/dist/${f.rel}`));
        await put(sftp, f.full, `${REMOTE}/client/dist/${f.rel}`);
      }
      console.log('dist uploaded', distFiles.length);

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
