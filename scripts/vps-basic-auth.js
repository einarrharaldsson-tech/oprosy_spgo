import { Client } from 'ssh2';
import crypto from 'crypto';

const HOST = process.env.VPS_HOST || '31.31.201.243';
const PASSWORD = process.env.VPS_PASSWORD;
const GATE_USER = process.env.GATE_USER || 'gate';
const GATE_PASS = process.env.GATE_PASS || crypto.randomBytes(9).toString('base64url');

if (!PASSWORD) {
  console.error('Set VPS_PASSWORD');
  process.exit(1);
}

const nginxConf = `server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    client_max_body_size 64m;

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

const cmd = `
set -e
# create/update htpasswd ( -b batch, -c create )
htpasswd -cb /etc/nginx/.htpasswd '${GATE_USER}' '${GATE_PASS}'
chmod 640 /etc/nginx/.htpasswd
chown root:www-data /etc/nginx/.htpasswd

cat > /etc/nginx/sites-available/oprosy <<'EOF'
${nginxConf}
EOF

nginx -t
systemctl reload nginx

# append to credentials note
umask 077
{
  echo ""
  echo "HTTP Basic Auth (nginx):"
  echo "User: ${GATE_USER}"
  echo "Pass: ${GATE_PASS}"
} >> /root/oprosy-credentials.txt

echo "OK gate=${GATE_USER}"
curl -sS -o /dev/null -w "noauth:%{http_code}\\n" http://127.0.0.1/
curl -sS -o /dev/null -w "withauth:%{http_code}\\n" -u '${GATE_USER}:${GATE_PASS}' http://127.0.0.1/api/health
`;

const conn = new Client();
conn
  .on('ready', () => {
    conn.exec(cmd, (err, stream) => {
      if (err) {
        console.error(err);
        conn.end();
        process.exit(1);
      }
      stream.on('data', (d) => process.stdout.write(d));
      stream.stderr.on('data', (d) => process.stderr.write(d));
      stream.on('close', (code) => {
        console.log('\n=== Basic Auth enabled ===');
        console.log(`URL: http://${HOST}/`);
        console.log(`Gate login: ${GATE_USER}`);
        console.log(`Gate password: ${GATE_PASS}`);
        console.log('(also in /root/oprosy-credentials.txt on server)');
        console.log('App login still: admin / admin');
        conn.end();
        process.exit(code || 0);
      });
    });
  })
  .on('error', (e) => {
    console.error(e);
    process.exit(1);
  })
  .connect({ host: HOST, username: 'root', password: PASSWORD });
