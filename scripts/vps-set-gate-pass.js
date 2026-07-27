import { Client } from 'ssh2';

const HOST = process.env.VPS_HOST || '31.31.201.243';
const PASSWORD = process.env.VPS_PASSWORD;
const GATE_USER = 'gate';
const GATE_PASS = 'Admsp@2026';

if (!PASSWORD) {
  console.error('Set VPS_PASSWORD');
  process.exit(1);
}

// Escape single quotes for shell
const passShell = GATE_PASS.replace(/'/g, `'\\''`);

const cmd = `
set -e
htpasswd -cb /etc/nginx/.htpasswd '${GATE_USER}' '${passShell}'
chmod 640 /etc/nginx/.htpasswd
chown root:www-data /etc/nginx/.htpasswd
systemctl reload nginx
# update credentials note
grep -v 'HTTP Basic Auth' /root/oprosy-credentials.txt > /tmp/cred.txt 2>/dev/null || true
grep -v '^User: gate' /tmp/cred.txt > /tmp/cred2.txt 2>/dev/null || cp /tmp/cred.txt /tmp/cred2.txt 2>/dev/null || true
grep -v '^Pass: ' /tmp/cred2.txt > /tmp/cred3.txt 2>/dev/null || true
{
  cat /tmp/cred3.txt 2>/dev/null || true
  echo ""
  echo "HTTP Basic Auth (nginx):"
  echo "User: ${GATE_USER}"
  echo "Pass: ${GATE_PASS}"
} > /root/oprosy-credentials.txt
chmod 600 /root/oprosy-credentials.txt
curl -sS -o /dev/null -w "auth:%{http_code}\\n" -u '${GATE_USER}:${passShell}' https://127.0.0.1/ -k
echo OK
`;

const conn = new Client();
conn
  .on('ready', () => {
    conn.exec(cmd, (err, stream) => {
      if (err) {
        console.error(err);
        process.exit(1);
      }
      stream.on('data', (d) => process.stdout.write(d));
      stream.stderr.on('data', (d) => process.stderr.write(d));
      stream.on('close', (code) => {
        console.log(`\nШлюз: ${GATE_USER} / ${GATE_PASS}`);
        console.log(`https://${HOST}/`);
        conn.end();
        process.exit(code || 0);
      });
    });
  })
  .connect({ host: HOST, username: 'root', password: PASSWORD });
