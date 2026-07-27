import { Client } from 'ssh2';

const PASSWORD = process.env.VPS_PASSWORD;
const conn = new Client();
conn
  .on('ready', () => {
    conn.exec(
      `cat /etc/nginx/sites-available/oprosy; echo '---'; curl -sS -D- -o /dev/null http://127.0.0.1:3000/api/health | head -15; echo '---'; curl -sS -D- -o /dev/null http://127.0.0.1/api/health | head -20`,
      (e, s) => {
        s.on('data', (d) => process.stdout.write(d));
        s.stderr.on('data', (d) => process.stderr.write(d));
        s.on('close', () => conn.end());
      }
    );
  })
  .connect({ host: '31.31.201.243', username: 'root', password: PASSWORD });
