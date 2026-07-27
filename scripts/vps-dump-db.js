import { Client } from 'ssh2';
import fs from 'fs';
const PASS = process.env.VPS_PASSWORD;
const OUT = process.env.VPS_DUMP_OUT;
const remoteCmd = [
  'set -e',
  'cd /var/www/oprosy',
  'set -a',
  '. ./.env',
  'set +a',
  'HOST="$DB_HOST"',
  '[ "$HOST" = "localhost" ] && HOST=127.0.0.1',
  'export MYSQL_PWD="$DB_PASSWORD"',
  'mysqldump -h "$HOST" -P "${DB_PORT:-3306}" -u "$DB_USER" --single-transaction --routines --triggers --databases "$DB_NAME"',
].join('\n');
const conn = new Client();
conn.on('ready', () => {
  conn.exec(remoteCmd, (e, s) => {
    if (e) throw e;
    const chunks = [];
    s.on('data', (d) => chunks.push(d));
    s.stderr.on('data', (d) => process.stderr.write(d));
    s.on('close', (code) => {
      const buf = Buffer.concat(chunks);
      fs.writeFileSync(OUT, buf);
      console.log('vps dump bytes:', buf.length, 'code', code);
      conn.end();
      process.exit(code || 0);
    });
  });
}).on('error', (e) => { console.error(e); process.exit(1); })
  .connect({ host: '31.31.201.243', username: 'root', password: PASS });
