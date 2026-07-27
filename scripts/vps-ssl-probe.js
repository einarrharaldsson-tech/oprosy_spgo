import { Client } from "ssh2";
const c = new Client();
c.on("ready", () => {
  c.exec("cat /etc/os-release | head -5; which certbot; apt-cache policy certbot 2>/dev/null | head -5; nginx -v 2>&1; curl -sS http://127.0.0.1/api/health", (e,s) => {
    s.on("data", d => process.stdout.write(d));
    s.stderr.on("data", d => process.stderr.write(d));
    s.on("close", () => c.end());
  });
}).connect({ host: "31.31.201.243", username: "root", password: process.env.VPS_PASSWORD });
