import { Client } from 'ssh2';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const HOST = process.env.VPS_HOST || '31.31.201.243';
const USER = process.env.VPS_USER || 'root';
const PASSWORD = process.env.VPS_PASSWORD;
const REMOTE = '/var/www/oprosy';

if (!PASSWORD) {
  console.error('Set VPS_PASSWORD');
  process.exit(1);
}

const SKIP = new Set(['node_modules', '.git', 'dist', 'uploads', 'oprosy-backups']);
const SKIP_FILES = new Set(['.env']);

function shouldSkip(rel) {
  const parts = rel.split(/[/\\]/);
  if (parts.some((p) => SKIP.has(p))) return true;
  if (SKIP_FILES.has(path.basename(rel))) return true;
  if (rel.includes('node_modules')) return true;
  return false;
}

function walk(dir, base = dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel = path.relative(base, full);
    if (shouldSkip(rel)) continue;
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, base, out);
    else out.push({ full, rel: rel.replace(/\\/g, '/') });
  }
  return out;
}

function exec(conn, cmd, { timeout = 600000 } = {}) {
  return new Promise((resolve, reject) => {
    console.log(`\n$ ${cmd.slice(0, 200)}${cmd.length > 200 ? '…' : ''}`);
    conn.exec(cmd, { pty: true }, (err, stream) => {
      if (err) return reject(err);
      let out = '';
      const t = setTimeout(() => {
        stream.close();
        reject(new Error(`timeout: ${cmd.slice(0, 80)}`));
      }, timeout);
      stream.on('data', (d) => {
        const s = d.toString();
        out += s;
        process.stdout.write(s);
      });
      stream.stderr.on('data', (d) => {
        const s = d.toString();
        out += s;
        process.stderr.write(s);
      });
      stream.on('close', (code) => {
        clearTimeout(t);
        if (code !== 0) reject(new Error(`exit ${code}: ${cmd.slice(0, 120)}`));
        else resolve(out);
      });
    });
  });
}

function sftpMkdir(sftp, dir) {
  return new Promise((resolve) => {
    sftp.mkdir(dir, (err) => resolve());
  });
}

async function ensureRemoteDirs(sftp, fileRel) {
  const parts = fileRel.split('/');
  let cur = REMOTE;
  for (let i = 0; i < parts.length - 1; i++) {
    cur += '/' + parts[i];
    await sftpMkdir(sftp, cur);
  }
}

function uploadFile(sftp, local, remote) {
  return new Promise((resolve, reject) => {
    sftp.fastPut(local, remote, (err) => (err ? reject(err) : resolve()));
  });
}

function getSftp(conn) {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => (err ? reject(err) : resolve(sftp)));
  });
}

async function main() {
  const jwt = crypto.randomBytes(32).toString('hex');
  const dbPass = crypto.randomBytes(12).toString('base64url');

  const conn = new Client();
  await new Promise((resolve, reject) => {
    conn
      .on('ready', resolve)
      .on('error', reject)
      .connect({
        host: HOST,
        username: USER,
        password: PASSWORD,
        readyTimeout: 60000,
      });
  });
  console.log('SSH connected');

  // Base packages
  await exec(
    conn,
    [
      'set -e',
      'export DEBIAN_FRONTEND=noninteractive',
      'apt-get update -y',
      'apt-get install -y curl ca-certificates gnupg nginx mariadb-server apache2-utils',
      // Node 20
      'if ! command -v node >/dev/null 2>&1; then',
      '  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -',
      '  apt-get install -y nodejs',
      'fi',
      'node -v && npm -v',
      'npm install -g pm2',
      `mkdir -p ${REMOTE} ${REMOTE}/server/uploads/audio`,
      'systemctl enable --now nginx mariadb',
    ].join('\n'),
    { timeout: 900000 }
  );

  // DB
  await exec(
    conn,
    [
      'set -e',
      `mysql -e "CREATE DATABASE IF NOT EXISTS oprosy CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"`,
      `mysql -e "CREATE USER IF NOT EXISTS 'oprosy'@'localhost' IDENTIFIED BY '${dbPass}';"`,
      `mysql -e "CREATE USER IF NOT EXISTS 'oprosy'@'127.0.0.1' IDENTIFIED BY '${dbPass}';"`,
      `mysql -e "GRANT ALL PRIVILEGES ON oprosy.* TO 'oprosy'@'localhost'; GRANT ALL PRIVILEGES ON oprosy.* TO 'oprosy'@'127.0.0.1'; FLUSH PRIVILEGES;"`,
      'mysql -e "SELECT 1" oprosy',
    ].join('\n')
  );

  // Upload project
  console.log('\n=== upload project ===');
  const sftp = await getSftp(conn);
  await sftpMkdir(sftp, REMOTE);
  const files = walk(ROOT);
  let n = 0;
  for (const f of files) {
    await ensureRemoteDirs(sftp, f.rel);
    await uploadFile(sftp, f.full, `${REMOTE}/${f.rel}`);
    n++;
    if (n % 50 === 0) console.log(`uploaded ${n}/${files.length}`);
  }
  console.log(`uploaded ${n} files`);

  // .env
  const envBody = [
    'DB_HOST=127.0.0.1',
    'DB_PORT=3306',
    'DB_USER=oprosy',
    `DB_PASSWORD=${dbPass}`,
    'DB_NAME=oprosy',
    `JWT_SECRET=${jwt}`,
    'PORT=3000',
    'NODE_ENV=production',
    `CLIENT_URL=http://${HOST}`,
    'BASE_PATH=',
    'MAX_AUDIO_MB=50',
    '',
  ].join('\n');
  await new Promise((resolve, reject) => {
    sftp.writeFile(`${REMOTE}/.env`, envBody, (err) => (err ? reject(err) : resolve()));
  });
  console.log('.env written');

  // Install, build, init, pm2
  await exec(
    conn,
    [
      'set -e',
      `cd ${REMOTE}`,
      'npm install',
      'npm run install:all',
      'npm run build',
      'npm run db:init',
      'chmod -R u+rwX server/uploads',
      'pm2 delete oprosy 2>/dev/null || true',
      `cd ${REMOTE}/server && pm2 start src/index.js --name oprosy`,
      'pm2 save',
      'pm2 startup systemd -u root --hp /root | tail -n 1 > /tmp/pm2-startup.sh || true',
      'bash /tmp/pm2-startup.sh 2>/dev/null || true',
      'pm2 status',
      'sleep 2',
      'curl -sS http://127.0.0.1:3000/api/health || true',
    ].join('\n'),
    { timeout: 900000 }
  );

  // nginx
  const nginxConf = `server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    client_max_body_size 64m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300;
    }
}
`;
  await new Promise((resolve, reject) => {
    sftp.writeFile('/etc/nginx/sites-available/oprosy', nginxConf, (err) =>
      err ? reject(err) : resolve()
    );
  });

  await exec(
    conn,
    [
      'set -e',
      'rm -f /etc/nginx/sites-enabled/default',
      'ln -sfn /etc/nginx/sites-available/oprosy /etc/nginx/sites-enabled/oprosy',
      'nginx -t',
      'systemctl reload nginx',
      'ufw allow OpenSSH 2>/dev/null || true',
      'ufw allow 80/tcp 2>/dev/null || true',
      'ufw allow 443/tcp 2>/dev/null || true',
      'curl -sS http://127.0.0.1/api/health',
      'echo',
      `curl -sS http://${HOST}/api/health || true`,
      'echo',
      'curl -sS -X POST http://127.0.0.1/api/auth/login -H "Content-Type: application/json" -d \'{"login":"admin","password":"admin"}\' | head -c 200',
      'echo',
    ].join('\n')
  );

  // Save credentials note on server (root only)
  const note = `Oprosy deploy\nURL: http://${HOST}/\nDB user: oprosy\nDB pass: ${dbPass}\nJWT set in ${REMOTE}/.env\nAdmin app: admin / admin (change immediately)\n`;
  await new Promise((resolve, reject) => {
    sftp.writeFile('/root/oprosy-credentials.txt', note, { mode: 0o600 }, (err) =>
      err ? reject(err) : resolve()
    );
  });

  console.log('\n=== DONE ===');
  console.log(`Open: http://${HOST}/`);
  console.log('Login: admin / admin  (смените пароль!)');
  console.log(`DB password saved on server: /root/oprosy-credentials.txt`);
  console.log('Смените пароль root SSH — он был в чате.');

  conn.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
