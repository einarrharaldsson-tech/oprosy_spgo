import { Client } from 'ssh2';

const HOST = process.env.VPS_HOST || '31.31.201.243';
const PASSWORD = process.env.VPS_PASSWORD;

if (!PASSWORD) {
  console.error('Set VPS_PASSWORD');
  process.exit(1);
}

const nginxConf = `server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    client_max_body_size 64m;

    # API — без Basic Auth: приложение само шлёт JWT в Authorization
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300;
    }

    # UI и статика — вход через Basic Auth (как htaccess)
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
cat > /etc/nginx/sites-available/oprosy <<'EOF'
${nginxConf}
EOF
nginx -t
systemctl reload nginx
echo "fixed"
curl -sS -o /dev/null -w "api_no_basic:%{http_code}\\n" http://127.0.0.1/api/health
curl -sS -o /dev/null -w "ui_no_basic:%{http_code}\\n" http://127.0.0.1/
curl -sS -o /dev/null -w "ui_with_basic:%{http_code}\\n" -u 'gate:GG_T2y6ipAe5' http://127.0.0.1/
`;

const conn = new Client();
conn
  .on('ready', () => {
    conn.exec(cmd, (e, stream) => {
      if (e) {
        console.error(e);
        process.exit(1);
      }
      stream.on('data', (d) => process.stdout.write(d));
      stream.stderr.on('data', (d) => process.stderr.write(d));
      stream.on('close', () => {
        console.log('\nUI still behind Basic Auth; /api/ uses app login only.');
        conn.end();
      });
    });
  })
  .connect({ host: HOST, username: 'root', password: PASSWORD });
