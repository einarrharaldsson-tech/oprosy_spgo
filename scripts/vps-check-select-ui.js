import { Client } from 'ssh2';
const PASS = process.env.VPS_PASSWORD;
const conn = new Client();
conn.on('ready', () => {
  const cmd = `
echo '=== index.html ==='
cat /var/www/oprosy/client/dist/index.html
echo
echo '=== assets ==='
ls -la /var/www/oprosy/client/dist/assets/
echo
echo '=== search select in js ==='
grep -l 'Выпадающий список' /var/www/oprosy/client/dist/assets/*.js || echo 'NOT IN BUNDLE'
grep -o 'Выпадающий список[^"]*' /var/www/oprosy/client/dist/assets/*.js | head -3
echo
echo '=== constructor source on server ==='
grep -n 'select\\|Выпадающий\\|answerType' /var/www/oprosy/client/src/pages/ConstructorEditPage.jsx | head -20
echo
echo '=== curl homepage script src ==='
curl -sS http://127.0.0.1:3000/ | head -20
echo
curl -sS https://127.0.0.1/ -k -u 'gate:Admsp@2026' | head -20
`;
  conn.exec(cmd, (e, s) => {
    s.on('data', (d) => process.stdout.write(d));
    s.stderr.on('data', (d) => process.stderr.write(d));
    s.on('close', () => conn.end());
  });
}).connect({ host: '31.31.201.243', username: 'root', password: PASS });
