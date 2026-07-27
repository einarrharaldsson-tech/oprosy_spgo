import { Client } from 'ssh2';
import fs from 'fs';
import path from 'path';

const PASS = process.env.VPS_PASSWORD;
const REMOTE = '/var/www/oprosy';
const ROOT = process.cwd();

function put(sftp, local, remote) {
  return new Promise((resolve, reject) => sftp.fastPut(local, remote, (e) => (e ? reject(e) : resolve())));
}

const conn = new Client();
conn.on('ready', async () => {
  const sftp = await new Promise((res, rej) => conn.sftp((e, s) => (e ? rej(e) : res(s))));
  await put(sftp, path.join(ROOT, 'server/src/index.js'), `${REMOTE}/server/src/index.js`);
  // re-upload current dist index + newest js to be sure
  await put(sftp, path.join(ROOT, 'client/dist/index.html'), `${REMOTE}/client/dist/index.html`);
  const assets = fs.readdirSync(path.join(ROOT, 'client/dist/assets'));
  for (const name of assets) {
    await put(sftp, path.join(ROOT, 'client/dist/assets', name), `${REMOTE}/client/dist/assets/${name}`);
    console.log('asset', name);
  }
  const cmd = `
set -e
# keep only files referenced by index.html
cd /var/www/oprosy/client/dist/assets
KEEP_JS=$(grep -oE 'index-[A-Za-z0-9_-]+\\.js' ../index.html | head -1)
KEEP_CSS=$(grep -oE 'index-[A-Za-z0-9_-]+\\.css' ../index.html | head -1)
echo "keep $KEEP_JS $KEEP_CSS"
for f in *; do
  if [ "$f" != "$KEEP_JS" ] && [ "$f" != "$KEEP_CSS" ]; then
    rm -f -- "$f"
    echo "removed $f"
  fi
done
ls -la
pm2 restart oprosy
sleep 1
curl -sS -D- -o /dev/null http://127.0.0.1/ | head -20
curl -sS http://127.0.0.1/ | grep -oE 'assets/index-[^"]+'
grep -o 'Выпадающий список[^"]*' /var/www/oprosy/client/dist/assets/$KEEP_JS
`;
  conn.exec(cmd, (e, stream) => {
    stream.on('data', (d) => process.stdout.write(d));
    stream.stderr.on('data', (d) => process.stderr.write(d));
    stream.on('close', () => conn.end());
  });
}).connect({ host: '31.31.201.243', username: 'root', password: PASS });
