import { Client } from 'ssh2';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const bcrypt = require(path.join(process.cwd(), 'server/node_modules/bcryptjs'));

const PASS = process.env.VPS_PASSWORD;
const APP_LOGIN = process.env.APP_LOGIN || 'admin';
const APP_PASSWORD = process.env.APP_PASSWORD || 'Annapurna8091!';

if (!PASS) {
  console.error('Set VPS_PASSWORD');
  process.exit(1);
}

const REMOTE = '/var/www/oprosy';
const payloadLocal = '/tmp/survey-import-payload.json';
const hash = bcrypt.hashSync(APP_PASSWORD, 10);

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

const helper = `#!/usr/bin/env python3
import json, os, subprocess, urllib.request

os.chdir("${REMOTE}")
# load .env
env = dict(os.environ)
for line in open(".env"):
    line=line.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    k,v=line.split("=",1)
    env[k]=v

hash_value = ${JSON.stringify(hash)}
login = ${JSON.stringify(APP_LOGIN)}
password = ${JSON.stringify(APP_PASSWORD)}

subprocess.check_call([
  "mysql",
  f"-h{env['DB_HOST']}",
  f"-P{env.get('DB_PORT','3306')}",
  f"-u{env['DB_USER']}",
  f"-p{env['DB_PASSWORD']}",
  env['DB_NAME'],
  "-e",
  f"UPDATE users SET password_hash='{hash_value}' WHERE login='{login}' OR role='admin';",
], env=env)
print("password_restored")

req = urllib.request.Request(
  "http://127.0.0.1:3000/api/auth/login",
  data=json.dumps({"login": login, "password": password}).encode(),
  headers={"Content-Type": "application/json"},
)
login_body = urllib.request.urlopen(req).read().decode()
token = json.loads(login_body).get("token") or ""
print("token_ok", bool(token))
if not token:
    raise SystemExit("login failed: " + login_body[:300])

payload = open("server/tmp-problematika-import.json","rb").read()
req = urllib.request.Request(
  "http://127.0.0.1:3000/api/surveys/import/commit",
  data=payload,
  headers={
    "Content-Type": "application/json",
    "Authorization": f"Bearer {token}",
  },
  method="POST",
)
try:
  resp = urllib.request.urlopen(req)
  body = resp.read().decode()
  code = resp.status
except Exception as e:
  body = e.read().decode() if hasattr(e, "read") else str(e)
  code = getattr(e, "code", 0)

print("HTTP", code)
open("/tmp/import-resp.json","w").write(body)
d=json.loads(body)
print("survey_id", d.get("id"))
print("title", d.get("title"))
print("status", d.get("status"))
print("questions", len(d.get("questions") or []))
print("error", d.get("error"))
if code >= 400:
  raise SystemExit(1)
`;

const conn = new Client();
conn
  .on('ready', async () => {
    try {
      const sftp = await new Promise((res, rej) =>
        conn.sftp((e, s) => (e ? rej(e) : res(s)))
      );
      await mkdirp(sftp, `${REMOTE}/server`);
      await put(sftp, payloadLocal, `${REMOTE}/server/tmp-problematika-import.json`);
      await put(
        sftp,
        path.join(process.cwd(), 'server/src/services/docxImport.js'),
        `${REMOTE}/server/src/services/docxImport.js`
      );
      await new Promise((resolve, reject) => {
        sftp.writeFile(`${REMOTE}/server/tmp-import-helper.py`, helper, (e) =>
          e ? reject(e) : resolve()
        );
      });
      console.log('files uploaded');
      conn.exec(`python3 ${REMOTE}/server/tmp-import-helper.py`, (e, stream) => {
        if (e) throw e;
        stream.on('data', (d) => process.stdout.write(d));
        stream.stderr.on('data', (d) => process.stderr.write(d));
        stream.on('close', (code) => {
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
  .connect({
    host: '31.31.201.243',
    username: 'root',
    password: PASS,
    readyTimeout: 90000,
  });
