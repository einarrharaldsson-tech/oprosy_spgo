import { Client } from 'ssh2';

const HOST = process.env.VPS_HOST || '31.31.201.243';
const PASSWORD = process.env.VPS_PASSWORD;
const EMAIL = process.env.LE_EMAIL || '';

if (!PASSWORD) {
  console.error('Set VPS_PASSWORD');
  process.exit(1);
}

const nginxHttpOnly = `server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    client_max_body_size 64m;

    # ACME HTTP-01 (без Basic Auth)
    location ^~ /.well-known/acme-challenge/ {
        root /var/www/certbot;
        default_type "text/plain";
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300;
    }

    location / {
        auth_basic "Oprosy";
        auth_basic_user_file /etc/nginx/.htpasswd;

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

const nginxHttps = `server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    client_max_body_size 64m;

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/certbot;
        default_type "text/plain";
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl default_server;
    listen [::]:443 ssl default_server;
    server_name _;

    ssl_certificate     /etc/letsencrypt/live/${HOST}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${HOST}/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;

    client_max_body_size 64m;

    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 300;
    }

    location / {
        auth_basic "Oprosy";
        auth_basic_user_file /etc/nginx/.htpasswd;

        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 300;
    }
}
`;

function exec(conn, cmd, timeout = 600000) {
  return new Promise((resolve, reject) => {
    console.log(`\n$ ${cmd.slice(0, 160)}${cmd.length > 160 ? '…' : ''}`);
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
        if (code !== 0) reject(new Error(`exit ${code}`));
        else resolve(out);
      });
    });
  });
}

function sftpWrite(conn, remotePath, content) {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) return reject(err);
      sftp.writeFile(remotePath, content, (e) => (e ? reject(e) : resolve()));
    });
  });
}

async function main() {
  const conn = new Client();
  await new Promise((resolve, reject) => {
    conn.on('ready', resolve).on('error', reject).connect({
      host: HOST,
      username: 'root',
      password: PASSWORD,
      readyTimeout: 60000,
    });
  });

  // 1) Install snap + certbot (need 5.4+ for IP webroot)
  await exec(
    conn,
    [
      'set -e',
      'export DEBIAN_FRONTEND=noninteractive',
      'apt-get update -y',
      'apt-get install -y snapd curl',
      'systemctl enable --now snapd.socket',
      'sleep 2',
      'snap install core || true',
      'snap refresh core || true',
      'snap install --classic certbot',
      'ln -sfn /snap/bin/certbot /usr/local/bin/certbot',
      'certbot --version',
      'mkdir -p /var/www/certbot/.well-known/acme-challenge',
      'chown -R www-data:www-data /var/www/certbot',
    ].join('\n'),
    900000
  );

  // 2) HTTP nginx with ACME webroot (before cert)
  await sftpWrite(conn, '/etc/nginx/sites-available/oprosy', nginxHttpOnly);
  await exec(conn, 'nginx -t && systemctl reload nginx');

  // 3) Issue IP shortlived cert
  const emailArgs = EMAIL
    ? `--email ${EMAIL}`
    : '--register-unsafely-without-email';
  await exec(
    conn,
    [
      'set -e',
      `certbot certonly --non-interactive --agree-tos ${emailArgs} \\`,
      '  --preferred-profile shortlived \\',
      '  --webroot --webroot-path /var/www/certbot \\',
      `  --ip-address ${HOST} \\`,
      `  --deploy-hook 'systemctl reload nginx'`,
      'ls -la /etc/letsencrypt/live/',
      `certbot certificates || true`,
    ].join('\n'),
    300000
  );

  // 4) HTTPS nginx
  await sftpWrite(conn, '/etc/nginx/sites-available/oprosy', nginxHttps);
  await exec(conn, 'nginx -t && systemctl reload nginx; ufw allow 443/tcp || true');

  // 5) Cron every 5 days at 03:15 — renew + reload nginx
  await sftpWrite(
    conn,
    '/etc/cron.d/oprosy-certbot',
    `# Renew Let's Encrypt short-lived IP certificate (~6 days)
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/snap/bin
15 3 */5 * * root certbot renew --quiet --deploy-hook "systemctl reload nginx" >> /var/log/oprosy-certbot-renew.log 2>&1
`
  );
  await exec(conn, 'chmod 644 /etc/cron.d/oprosy-certbot; cat /etc/cron.d/oprosy-certbot');

  // 6) Update CLIENT_URL in .env
  await exec(
    conn,
    [
      'set -e',
      `sed -i 's|^CLIENT_URL=.*|CLIENT_URL=https://${HOST}|' /var/www/oprosy/.env`,
      'grep CLIENT_URL /var/www/oprosy/.env',
      'cd /var/www/oprosy/server && pm2 restart oprosy',
      'sleep 2',
      `curl -sS -k https://127.0.0.1/api/health -H 'Host: ${HOST}' || true`,
      `curl -sS https://${HOST}/api/health || true`,
      'echo',
      'openssl x509 -in /etc/letsencrypt/live/' + HOST + '/fullchain.pem -noout -dates -subject || true',
    ].join('\n')
  );

  console.log('\n=== HTTPS ready ===');
  console.log(`Open: https://${HOST}/`);
  console.log('Cron: every 5 days at 03:15 (certbot renew)');
  conn.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
