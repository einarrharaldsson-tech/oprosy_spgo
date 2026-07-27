import { Client } from 'ssh2';

const PASSWORD = process.env.VPS_PASSWORD;
const conn = new Client();
conn
  .on('ready', () => {
    const cmd = `
pm2 logs oprosy --lines 30 --nostream
echo '---'
curl -sS -X POST http://127.0.0.1:3000/api/auth/login -H 'Content-Type: application/json' -d '{"login":"admin","password":"admin"}'
echo
curl -sS -X POST http://127.0.0.1/api/auth/login -H 'Content-Type: application/json' -d '{"login":"admin","password":"admin"}'
echo
`;
    conn.exec(cmd, (e, s) => {
      s.on('data', (d) => process.stdout.write(d));
      s.stderr.on('data', (d) => process.stderr.write(d));
      s.on('close', () => conn.end());
    });
  })
  .connect({ host: '31.31.201.243', username: 'root', password: PASSWORD });
