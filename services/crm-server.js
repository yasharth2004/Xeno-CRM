const http = require("http");
const path = require("path");
const fs = require("fs");
const { nextId, readDb, writeDb } = require("./db");
const { seed } = require("./seed");

const PORT = Number(process.env.CRM_PORT || 3000);
const CHANNEL_URL = process.env.CHANNEL_URL || "http://localhost:4000/send";
const publicDir = path.join(__dirname, "..", "public");

const funnelOrder = ["SENT", "DELIVERED", "OPENED", "READ", "CLICKED", "CONVERTED", "FAILED"];
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

seed();

function send(res, status, data, headers = {}) {
  const body = typeof data === "string" ? data : JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": typeof data === "string" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    ...headers
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function latestStatus(events, communicationId) {
  const communicationEvents = events
    .filter(event => event.communicationId === communicationId)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  return communicationEvents.at(-1)?.type || "QUEUED";
}

function parseSegmentPrompt(prompt = "") {
  const text = prompt.toLowerCase();
  const rule = {};

  const spentMatch = text.match(/(?:spent|spend|value|worth|more than|above|over)\D*(\d[\d,]*)/);
  if (spentMatch) rule.spentGreaterThan = Number(spentMatch[1].replace(/,/g, ""));

  const inactiveMatch = text.match(/(?:haven'?t|not|inactive|dormant|no order|win back|bring back|lost).{0,40}?(\d+)\s*(?:days?|d)/);
  if (inactiveMatch) rule.lastPurchaseDays = Number(inactiveMatch[1]);

  const recentMatch = text.match(/(?:last|past|within).{0,20}?(\d+)\s*(?:days?|d)/);
  if (recentMatch && !text.includes("haven") && !text.includes("inactive")) rule.purchasedWithinDays = Number(recentMatch[1]);

  const orderMatch = text.match(/(?:at least|more than|over)\s*(\d+)\s*(?:orders?|purchases?)/);
  if (orderMatch) rule.minOrderCount = Number(orderMatch[1]);

  for (const city of ["mumbai", "delhi", "bengaluru", "pune", "hyderabad", "chennai"]) {
    if (text.includes(city)) rule.city = city[0].toUpperCase() + city.slice(1);
  }

  for (const category of ["sneakers", "denim", "coffee", "skincare", "activewear", "accessories"]) {
    if (text.includes(category)) rule.category = category;
  }

  if (text.includes("high value") && !rule.spentGreaterThan) rule.spentGreaterThan = 12000;
  if ((text.includes("at risk") || text.includes("dormant")) && !rule.lastPurchaseDays) rule.lastPurchaseDays = 60;
  if (Object.keys(rule).length === 0) {
    rule.spentGreaterThan = 5000;
    rule.lastPurchaseDays = 45;
  }

  return rule;
}

function daysSince(iso) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

function matchesRule(customer, rule) {
  if (rule.spentGreaterThan && customer.totalSpent <= rule.spentGreaterThan) return false;
  if (rule.spentLessThan && customer.totalSpent >= rule.spentLessThan) return false;
  if (rule.lastPurchaseDays && daysSince(customer.lastOrderDate) < rule.lastPurchaseDays) return false;
  if (rule.purchasedWithinDays && daysSince(customer.lastOrderDate) > rule.purchasedWithinDays) return false;
  if (rule.minOrderCount && customer.orderCount < rule.minOrderCount) return false;
  if (rule.city && customer.city !== rule.city) return false;
  if (rule.category && customer.preferredCategory !== rule.category) return false;
  return true;
}

function audienceForRule(db, rule) {
  return db.customers.filter(customer => matchesRule(customer, rule));
}

function personalize(template, customer) {
  return template
    .replaceAll("{{name}}", customer.name.split(" ")[0])
    .replaceAll("{{city}}", customer.city)
    .replaceAll("{{category}}", customer.preferredCategory);
}

function suggestChannel(audience) {
  if (!audience.length) return "EMAIL";
  const counts = audience.reduce((acc, customer) => {
    acc[customer.preferredChannel] = (acc[customer.preferredChannel] || 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

function buildMessage(goal = "", audience = []) {
  const lowerGoal = goal.toLowerCase();
  const category = audience[0]?.preferredCategory || "your favorites";
  if (lowerGoal.includes("win") || lowerGoal.includes("dormant") || lowerGoal.includes("bring back")) {
    return "Hey {{name}}, we saved a fresh 20% comeback offer on {{category}} for you. Tap today and make your next order feel easy.";
  }
  if (lowerGoal.includes("vip") || lowerGoal.includes("high value")) {
    return "Hey {{name}}, you are on our early-access list. Your private {{category}} edit is ready before it opens to everyone else.";
  }
  if (lowerGoal.includes("repeat") || lowerGoal.includes("second")) {
    return "Hey {{name}}, your next {{category}} pick is waiting. Use XENO10 before midnight and keep the streak going.";
  }
  return `Hey {{name}}, we picked a ${category} offer for shoppers like you in {{city}}. Open it today before it expires.`;
}

function summarizeCampaign(db, campaign) {
  const communications = db.communications.filter(item => item.campaignId === campaign.id);
  const events = db.events.filter(event => event.campaignId === campaign.id);
  const counts = Object.fromEntries(funnelOrder.map(status => [status, 0]));
  communications.forEach(communication => {
    const seen = new Set(events.filter(event => event.communicationId === communication.id).map(event => event.type));
    seen.forEach(status => {
      counts[status] = (counts[status] || 0) + 1;
    });
  });
  const sent = Math.max(counts.SENT, communications.length, 1);
  const openRate = Math.round((counts.OPENED / sent) * 100);
  const clickRate = Math.round((counts.CLICKED / sent) * 100);
  const conversionRate = Math.round((counts.CONVERTED / sent) * 100);
  const insight = conversionRate >= 8
    ? "Strong commercial signal. Increase budget or widen the segment with the same offer."
    : clickRate >= 15
      ? "Creative is working, but conversion is lagging. Test a sharper incentive on the landing step."
      : openRate >= 25
        ? "Subject and channel are healthy. Try stronger product specificity in the body copy."
        : "Early engagement is soft. Narrow the audience or switch to the audience's dominant channel.";
  return { counts, openRate, clickRate, conversionRate, insight };
}

function serializeState(db) {
  const campaigns = db.campaigns.map(campaign => ({
    ...campaign,
    analytics: summarizeCampaign(db, campaign)
  }));
  const communications = db.communications.map(communication => ({
    ...communication,
    status: latestStatus(db.events, communication.id)
  }));
  return {
    customers: db.customers,
    orders: db.orders,
    campaigns,
    communications,
    events: db.events.slice(-300)
  };
}

async function callChannel(payload) {
  const response = await fetch(CHANNEL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error(`Channel service returned ${response.status}`);
  return response.json();
}

async function handleApi(req, res, url) {
  const db = readDb() || seed();

  if (req.method === "GET" && url.pathname === "/api/state") {
    return send(res, 200, serializeState(db));
  }

  if (req.method === "POST" && url.pathname === "/api/reset") {
    const resetDb = seed({ force: true });
    return send(res, 200, serializeState(resetDb));
  }

  if (req.method === "POST" && url.pathname === "/api/ai/segment") {
    const body = await readBody(req);
    const rule = parseSegmentPrompt(body.prompt);
    const audience = audienceForRule(db, rule);
    return send(res, 200, {
      rule,
      count: audience.length,
      revenueOpportunity: audience.reduce((sum, customer) => sum + Math.round(customer.totalSpent * 0.12), 0),
      suggestedChannel: suggestChannel(audience),
      preview: audience.slice(0, 8)
    });
  }

  if (req.method === "POST" && url.pathname === "/api/ai/message") {
    const body = await readBody(req);
    const audience = audienceForRule(db, body.rule || {});
    return send(res, 200, {
      message: buildMessage(body.goal, audience),
      channel: suggestChannel(audience)
    });
  }

  if (req.method === "GET" && url.pathname === "/api/ai/suggestions") {
    const ideas = [
      { name: "High Value At Risk", rule: { spentGreaterThan: 12000, lastPurchaseDays: 60 }, reason: "Large historical spend and cooling recency.", expectedImpact: "Recover premium shoppers before they churn." },
      { name: "Bengaluru Coffee Regulars", rule: { city: "Bengaluru", category: "coffee", minOrderCount: 2 }, reason: "Habit-forming category with local purchase density.", expectedImpact: "Drive fast repeat orders with low discounting." },
      { name: "Mumbai Sneaker Drop", rule: { city: "Mumbai", category: "sneakers" }, reason: "Local audience aligned to an upcoming product story.", expectedImpact: "Improve click-through via city-specific creative." },
      { name: "Second Purchase Push", rule: { minOrderCount: 1, purchasedWithinDays: 45 }, reason: "Fresh buyers are easiest to convert into repeat customers.", expectedImpact: "Lift retention without broad blasting." }
    ].map(idea => {
      const audience = audienceForRule(db, idea.rule);
      return {
        ...idea,
        count: audience.length,
        revenueOpportunity: audience.reduce((sum, customer) => sum + Math.round(customer.totalSpent * 0.1), 0),
        channel: suggestChannel(audience)
      };
    });
    return send(res, 200, ideas);
  }

  if (req.method === "POST" && url.pathname === "/api/campaigns") {
    const body = await readBody(req);
    const rule = body.rule || parseSegmentPrompt(body.prompt || body.name || "");
    const audience = audienceForRule(db, rule);
    const campaign = {
      id: nextId("cmp"),
      name: body.name || "Untitled Campaign",
      goal: body.goal || body.name || "",
      rule,
      channel: body.channel || suggestChannel(audience),
      message: body.message || buildMessage(body.goal, audience),
      status: "LAUNCHED",
      audienceSize: audience.length,
      createdAt: new Date().toISOString()
    };
    db.campaigns.unshift(campaign);

    for (const customer of audience) {
      const communication = {
        id: nextId("com"),
        campaignId: campaign.id,
        customerId: customer.id,
        channel: campaign.channel,
        recipient: campaign.channel === "EMAIL" ? customer.email : customer.phone,
        message: personalize(campaign.message, customer),
        requestId: null,
        createdAt: new Date().toISOString()
      };
      db.communications.push(communication);
      db.events.push({
        id: nextId("evt"),
        communicationId: communication.id,
        campaignId: campaign.id,
        type: "SENT",
        timestamp: new Date().toISOString(),
        source: "crm"
      });
      try {
        const channelResult = await callChannel({
          communicationId: communication.id,
          campaignId: campaign.id,
          customerId: customer.id,
          channel: communication.channel,
          recipient: communication.recipient,
          message: communication.message
        });
        communication.requestId = channelResult.requestId;
      } catch (error) {
        db.events.push({
          id: nextId("evt"),
          communicationId: communication.id,
          campaignId: campaign.id,
          type: "FAILED",
          timestamp: new Date().toISOString(),
          source: "crm",
          meta: { reason: error.message }
        });
      }
    }
    writeDb(db);
    return send(res, 201, { campaign, state: serializeState(db) });
  }

  if (req.method === "POST" && url.pathname === "/api/webhooks/channel") {
    const body = await readBody(req);
    const communication = db.communications.find(item => item.id === body.communicationId || item.requestId === body.requestId);
    if (!communication) return send(res, 404, { error: "Communication not found" });
    const duplicate = db.events.some(event =>
      event.communicationId === communication.id &&
      event.type === body.status &&
      event.sourceRequestId === body.requestId
    );
    if (!duplicate) {
      db.events.push({
        id: nextId("evt"),
        communicationId: communication.id,
        campaignId: communication.campaignId,
        type: body.status,
        timestamp: body.timestamp || new Date().toISOString(),
        source: "channel",
        sourceRequestId: body.requestId,
        meta: body.meta || {}
      });
      writeDb(db);
    }
    return send(res, 200, { ok: true });
  }

  return send(res, 404, { error: "Not found" });
}

function serveStatic(req, res, url) {
  const safePath = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(publicDir, safePath));
  if (!filePath.startsWith(publicDir)) return send(res, 403, "Forbidden");
  fs.readFile(filePath, (error, data) => {
    if (error) return send(res, 404, "Not found");
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": contentTypes[ext] || "application/octet-stream" });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === "OPTIONS") return send(res, 204, "");
  try {
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
    return serveStatic(req, res, url);
  } catch (error) {
    return send(res, 500, { error: error.message });
  }
});

server.listen(PORT, () => {
  console.log(`CRM app running at http://localhost:${PORT}`);
  console.log(`Using channel service at ${CHANNEL_URL}`);
});
