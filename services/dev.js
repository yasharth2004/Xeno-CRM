const { spawn } = require("child_process");
const path = require("path");

const scripts = [
  ["channel", "services/channel-service.js"],
  ["crm", "services/crm-server.js"]
];

const children = scripts.map(([name, script]) => {
  const child = spawn(process.execPath, [path.join(__dirname, "..", script)], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env }
  });
  child.stdout.on("data", data => process.stdout.write(`[${name}] ${data}`));
  child.stderr.on("data", data => process.stderr.write(`[${name}] ${data}`));
  return child;
});

function shutdown() {
  children.forEach(child => child.kill("SIGTERM"));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
