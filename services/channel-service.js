const http = require("http");
const { nextId } = require("./db");

const PORT = Number(process.env.CHANNEL_PORT || 4000);
const CRM_WEBHOOK_URL = process.env.CRM_WEBHOOK_URL || "http://localhost:3000/api/webhooks/channel";

function send(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
  });
}

function chance(seedText) {
  let hash = 0;
  for (let index = 0; index < seedText.length; index += 1) {
    hash = ((hash << 5) - hash) + seedText.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(Math.sin(hash) * 10000) % 1;
}

async function callback(payload) {
  try {
    await fetch(CRM_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    setTimeout(() => callback({ ...payload, meta: { retry: true, previousError: error.message } }), 2500);
  }
}

function scheduleLifecycle(requestId, body) {
  const base = `${requestId}:${body.customerId}`;
  const failed = chance(`${base}:failed`) < 0.08;
  const opened = chance(`${base}:open`) < 0.68;
  const read = opened && chance(`${base}:read`) < 0.82;
  const clicked = read && chance(`${base}:click`) < 0.42;
  const converted = clicked && chance(`${base}:convert`) < 0.24;
  const events = failed ? ["FAILED"] : ["DELIVERED", opened && "OPENED", read && "READ", clicked && "CLICKED", converted && "CONVERTED"].filter(Boolean);

  events.forEach((status, index) => {
    const jitter = Math.round(chance(`${base}:${status}`) * 900);
    setTimeout(() => {
      callback({
        requestId,
        communicationId: body.communicationId,
        campaignId: body.campaignId,
        status,
        timestamp: new Date().toISOString(),
        meta: { simulated: true, channel: body.channel }
      });
    }, 900 + index * 1400 + jitter);
  });

  if (!failed && chance(`${base}:duplicate`) < 0.15) {
    setTimeout(() => {
      callback({
        requestId,
        communicationId: body.communicationId,
        campaignId: body.campaignId,
        status: "DELIVERED",
        timestamp: new Date().toISOString(),
        meta: { simulated: true, duplicateTest: true }
      });
    }, 4200);
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, {});
  if (req.method !== "POST" || req.url !== "/send") return send(res, 404, { error: "Not found" });
  try {
    const body = await readBody(req);
    const requestId = nextId("req");
    scheduleLifecycle(requestId, body);
    return send(res, 202, { requestId, acceptedAt: new Date().toISOString() });
  } catch (error) {
    return send(res, 500, { error: error.message });
  }
});

server.listen(PORT, () => {
  console.log(`Channel service running at http://localhost:${PORT}`);
  console.log(`Posting receipts to ${CRM_WEBHOOK_URL}`);
});
