import { Client } from 'ssh2';

const PASS = process.env.VPS_PASSWORD;
const conn = new Client();
conn.on('ready', () => {
  const cmd = `
pm2 logs oprosy --lines 40 --nostream
echo '=== test export ==='
# get token
TOKEN=$(curl -sS -X POST http://127.0.0.1:3000/api/auth/login -H 'Content-Type: application/json' -d '{"login":"admin","password":"admin"}' | php -r 'echo json_decode(file_get_contents("php://stdin"))->token;' 2>/dev/null)
if [ -z "$TOKEN" ]; then
  TOKEN=$(node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).token))" <<EOF
$(curl -sS -X POST http://127.0.0.1:3000/api/auth/login -H 'Content-Type: application/json' -d '{"login":"admin","password":"admin"}')
EOF
)
fi
echo "token_len=\${#TOKEN}"
# list surveys
curl -sS http://127.0.0.1:3000/api/surveys -H "Authorization: Bearer $TOKEN" | head -c 400
echo
SID=$(node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d); const a=j.items||j; console.log((Array.isArray(a)?a:a.surveys||[])[0]?.id||'')})" <<EOF
$(curl -sS http://127.0.0.1:3000/api/surveys -H "Authorization: Bearer $TOKEN")
EOF
)
echo "sid=$SID"
curl -sS -D- -o /tmp/export.csv "http://127.0.0.1:3000/api/surveys/$SID/responses/export.csv" -H "Authorization: Bearer $TOKEN" | head -30
echo
head -c 300 /tmp/export.csv; echo
pm2 logs oprosy --err --lines 15 --nostream
`;
  conn.exec(cmd, (e, s) => {
    s.on('data', (d) => process.stdout.write(d));
    s.stderr.on('data', (d) => process.stderr.write(d));
    s.on('close', () => conn.end());
  });
}).connect({ host: '31.31.201.243', username: 'root', password: PASS });
