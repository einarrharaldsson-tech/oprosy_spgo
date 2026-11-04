import { Client } from 'ssh2';

const HOST = process.env.VPS_HOST || '31.31.201.243';
const PASS = process.env.VPS_PASSWORD;
if (!PASS) {
  console.error('Set VPS_PASSWORD');
  process.exit(1);
}

const RENEW_SCRIPT = `#!/bin/bash
# Renew Let's Encrypt short-lived IP certificate (~6 days).
# Prefer "certbot renew"; if lineage is broken, re-issue with --ip-address.
set -euo pipefail
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/snap/bin:\${PATH}"

LOG=/var/log/oprosy-certbot-renew.log
IP="${HOST}"
WEBROOT=/var/www/certbot
LIVE="/etc/letsencrypt/live/\${IP}"

exec >>"\$LOG" 2>&1
echo "==== \$(date -Is) renew start ===="

if certbot renew --quiet --deploy-hook "systemctl reload nginx"; then
  echo "certbot renew ok"
else
  echo "certbot renew failed — re-issuing IP shortlived cert"
  mkdir -p "\${WEBROOT}/.well-known/acme-challenge"
  chown -R www-data:www-data "\${WEBROOT}" || true
  certbot certonly --non-interactive --agree-tos --register-unsafely-without-email \\
    --preferred-profile shortlived \\
    --webroot --webroot-path "\${WEBROOT}" \\
    --ip-address "\${IP}" \\
    --deploy-hook "systemctl reload nginx" \\
    --force-renewal
fi

if [[ -f "\${LIVE}/fullchain.pem" ]]; then
  openssl x509 -in "\${LIVE}/fullchain.pem" -noout -dates -subject || true
fi
echo "==== \$(date -Is) renew done ===="
`;

const CRON = `# Renew Let's Encrypt short-lived IP certificate (~6 days)
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/snap/bin
15 3 */3 * * root /usr/local/bin/oprosy-certbot-renew >> /var/log/oprosy-certbot-renew.log 2>&1
`;

function exec(conn, cmd, timeout = 120000) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, { pty: true }, (err, stream) => {
      if (err) return reject(err);
      let out = '';
      const t = setTimeout(() => {
        stream.close();
        reject(new Error('timeout'));
      }, timeout);
      stream.on('data', (d) => {
        out += d.toString();
        process.stdout.write(d);
      });
      stream.stderr.on('data', (d) => {
        out += d.toString();
        process.stderr.write(d);
      });
      stream.on('close', (code) => {
        clearTimeout(t);
        if (code !== 0) reject(new Error(`exit ${code}\n${out}`));
        else resolve(out);
      });
    });
  });
}

function sftpWrite(conn, remotePath, content, mode) {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) return reject(err);
      sftp.writeFile(remotePath, content, (e) => {
        if (e) return reject(e);
        if (mode == null) return resolve();
        sftp.chmod(remotePath, mode, (ce) => (ce ? reject(ce) : resolve()));
      });
    });
  });
}

const conn = new Client();
await new Promise((resolve, reject) => {
  conn.on('ready', resolve).on('error', reject).connect({
    host: HOST,
    username: 'root',
    password: PASS,
    readyTimeout: 60000,
  });
});

console.log('=== before ===');
await exec(
  conn,
  'echo ---cron.d---; cat /etc/cron.d/oprosy-certbot 2>/dev/null || echo missing; echo ---script---; ls -la /usr/local/bin/oprosy-certbot-renew 2>/dev/null || echo no-script; echo ---renewal---; ls /etc/letsencrypt/renewal/ 2>/dev/null; openssl x509 -in /etc/letsencrypt/live/' +
    HOST +
    '/fullchain.pem -noout -dates -subject 2>/dev/null || true'
);

await sftpWrite(conn, '/usr/local/bin/oprosy-certbot-renew', RENEW_SCRIPT, 0o755);
await sftpWrite(conn, '/etc/cron.d/oprosy-certbot', CRON, 0o644);

console.log('\n=== after ===');
await exec(
  conn,
  'chmod 755 /usr/local/bin/oprosy-certbot-renew; chmod 644 /etc/cron.d/oprosy-certbot; echo ---script---; head -20 /usr/local/bin/oprosy-certbot-renew; echo ---cron---; cat /etc/cron.d/oprosy-certbot; echo ---dry-run renew---; certbot renew --dry-run 2>&1 | tail -40'
);

conn.end();
console.log('\nDone: every 3 days at 03:15 via /usr/local/bin/oprosy-certbot-renew');
