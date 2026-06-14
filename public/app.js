const state = {
  data: null,
  currentRule: null,
  suggestions: [],
  activeView: "copilot",
  poller: null
};

const els = {
  tabs: document.querySelectorAll(".tab"),
  views: {
    copilot: document.querySelector("#copilotView"),
    campaigns: document.querySelector("#campaignsView"),
    customers: document.querySelector("#customersView"),
    events: document.querySelector("#eventsView")
  },
  viewTitle: document.querySelector("#viewTitle"),
  promptInput: document.querySelector("#promptInput"),
  campaignName: document.querySelector("#campaignName"),
  channelInput: document.querySelector("#channelInput"),
  messageInput: document.querySelector("#messageInput"),
  analyzeBtn: document.querySelector("#analyzeBtn"),
  messageBtn: document.querySelector("#messageBtn"),
  launchBtn: document.querySelector("#launchBtn"),
  refreshBtn: document.querySelector("#refreshBtn"),
  resetBtn: document.querySelector("#resetBtn"),
  useSuggestedBtn: document.querySelector("#useSuggestedBtn"),
  systemStatus: document.querySelector("#systemStatus"),
  audienceCount: document.querySelector("#audienceCount"),
  revenueOpportunity: document.querySelector("#revenueOpportunity"),
  ruleJson: document.querySelector("#ruleJson"),
  audiencePreview: document.querySelector("#audiencePreview"),
  suggestionsStrip: document.querySelector("#suggestionsStrip"),
  campaignsList: document.querySelector("#campaignsList"),
  customersTable: document.querySelector("#customersTable"),
  eventsList: document.querySelector("#eventsList"),
  toast: document.querySelector("#toast")
};

function money(value) {
  return `Rs ${Number(value || 0).toLocaleString("en-IN")}`;
}

function daysSince(iso) {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  clearTimeout(els.toastTimer);
  els.toastTimer = setTimeout(() => els.toast.classList.remove("show"), 2600);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${response.status}`);
  }
  return response.json();
}

function setView(view) {
  state.activeView = view;
  Object.entries(els.views).forEach(([name, element]) => {
    element.classList.toggle("active-view", name === view);
  });
  els.tabs.forEach(tab => tab.classList.toggle("active", tab.dataset.view === view));
  const titles = {
    copilot: "Build a shopper campaign",
    campaigns: "Campaign performance",
    customers: "Shopper data",
    events: "Communication event stream"
  };
  els.viewTitle.textContent = titles[view];
}

function renderAudience(result) {
  state.currentRule = result.rule;
  els.ruleJson.textContent = JSON.stringify(result.rule, null, 2);
  els.audienceCount.textContent = `${result.count} shoppers selected`;
  els.revenueOpportunity.textContent = money(result.revenueOpportunity);
  els.channelInput.value = result.suggestedChannel || els.channelInput.value;
  els.audiencePreview.innerHTML = result.preview.map(customer => `
    <div class="person-row">
      <div>
        <strong>${customer.name}</strong>
        <span>${customer.city} - ${customer.preferredCategory}</span>
      </div>
      <span>${money(customer.totalSpent)}</span>
    </div>
  `).join("") || `<div class="person-row"><span>No matching shoppers. Loosen the rule.</span></div>`;
}

function renderSuggestions() {
  els.suggestionsStrip.innerHTML = state.suggestions.map((idea, index) => `
    <article class="suggestion">
      <p class="eyebrow">${idea.count} shoppers - ${money(idea.revenueOpportunity)}</p>
      <strong>${idea.name}</strong>
      <p class="campaign-meta">${idea.reason}</p>
      <button class="secondary-button" data-suggestion="${index}">Load segment</button>
    </article>
  `).join("");
}

function renderCustomers() {
  const rows = state.data.customers
    .slice()
    .sort((a, b) => b.totalSpent - a.totalSpent)
    .map(customer => `
      <tr>
        <td><strong>${customer.name}</strong><br><span class="campaign-meta">${customer.email}</span></td>
        <td>${customer.city}</td>
        <td>${money(customer.totalSpent)}</td>
        <td>${customer.orderCount}</td>
        <td>${daysSince(customer.lastOrderDate)} days ago</td>
        <td>${customer.preferredCategory}</td>
      </tr>
    `).join("");
  els.customersTable.innerHTML = rows;
}

function campaignEvents(campaign) {
  return state.data.events.filter(event => event.campaignId === campaign.id);
}

function renderCampaigns() {
  if (!state.data.campaigns.length) {
    els.campaignsList.innerHTML = `<section class="panel"><h3>No campaigns launched yet</h3></section>`;
    return;
  }

  els.campaignsList.innerHTML = state.data.campaigns.map(campaign => {
    const analytics = campaign.analytics;
    const counts = analytics.counts;
    const max = Math.max(counts.SENT, campaign.audienceSize, 1);
    const funnel = ["SENT", "DELIVERED", "OPENED", "READ", "CLICKED", "CONVERTED"].map(status => {
      const height = Math.max(8, Math.round((counts[status] / max) * 100));
      return `
        <div class="funnel-step">
          <div class="bar" style="height:${height}px"></div>
          <span class="funnel-label">${status}<br>${counts[status]}</span>
        </div>
      `;
    }).join("");
    return `
      <article class="campaign-card">
        <div class="campaign-head">
          <div>
            <h3>${campaign.name}</h3>
            <div class="campaign-meta">${campaign.channel} - ${campaign.audienceSize} shoppers - ${new Date(campaign.createdAt).toLocaleString()}</div>
          </div>
          <span class="badge">${campaign.status}</span>
        </div>
        <div class="metric-grid">
          <div class="metric"><span>Open rate</span><strong>${analytics.openRate}%</strong></div>
          <div class="metric"><span>Click rate</span><strong>${analytics.clickRate}%</strong></div>
          <div class="metric"><span>Conversion</span><strong>${analytics.conversionRate}%</strong></div>
        </div>
        <p>${analytics.insight}</p>
        <div class="funnel">${funnel}</div>
      </article>
    `;
  }).join("");
}

function renderEvents() {
  const customerById = new Map(state.data.customers.map(customer => [customer.id, customer]));
  const communicationById = new Map(state.data.communications.map(item => [item.id, item]));
  const events = state.data.events.slice().reverse();
  els.eventsList.innerHTML = events.map(event => {
    const communication = communicationById.get(event.communicationId);
    const customer = communication ? customerById.get(communication.customerId) : null;
    return `
      <div class="event-row">
        <div>
          <strong class="status ${event.type}">${event.type}</strong>
          <span>${customer?.name || "Unknown shopper"} - ${communication?.channel || "CHANNEL"}</span>
        </div>
        <span>${new Date(event.timestamp).toLocaleTimeString()}</span>
      </div>
    `;
  }).join("") || `<section class="panel"><h3>No events yet</h3></section>`;
}

function renderAll() {
  renderCustomers();
  renderCampaigns();
  renderEvents();
  els.systemStatus.textContent = `${state.data.customers.length} shoppers loaded`;
}

async function refresh({ quiet = false } = {}) {
  state.data = await api("/api/state");
  renderAll();
  if (!quiet) toast("Data refreshed");
}

async function loadSuggestions() {
  state.suggestions = await api("/api/ai/suggestions");
  renderSuggestions();
}

async function analyzeAudience() {
  els.analyzeBtn.disabled = true;
  try {
    const result = await api("/api/ai/segment", {
      method: "POST",
      body: JSON.stringify({ prompt: els.promptInput.value })
    });
    renderAudience(result);
    toast("Audience generated");
  } finally {
    els.analyzeBtn.disabled = false;
  }
}

async function draftMessage() {
  if (!state.currentRule) await analyzeAudience();
  const result = await api("/api/ai/message", {
    method: "POST",
    body: JSON.stringify({ goal: els.promptInput.value, rule: state.currentRule })
  });
  els.messageInput.value = result.message;
  els.channelInput.value = result.channel;
  toast("Message drafted");
}

async function launchCampaign() {
  if (!state.currentRule) await analyzeAudience();
  els.launchBtn.disabled = true;
  try {
    const result = await api("/api/campaigns", {
      method: "POST",
      body: JSON.stringify({
        name: els.campaignName.value,
        goal: els.promptInput.value,
        rule: state.currentRule,
        channel: els.channelInput.value,
        message: els.messageInput.value
      })
    });
    state.data = result.state;
    renderAll();
    setView("campaigns");
    toast("Campaign launched. Receipts are arriving.");
  } finally {
    els.launchBtn.disabled = false;
  }
}

function bindEvents() {
  els.tabs.forEach(tab => tab.addEventListener("click", () => setView(tab.dataset.view)));
  els.refreshBtn.addEventListener("click", () => refresh());
  els.resetBtn.addEventListener("click", async () => {
    state.data = await api("/api/reset", { method: "POST" });
    state.currentRule = null;
    renderAudience({ rule: {}, count: 0, revenueOpportunity: 0, preview: [] });
    renderAll();
    toast("Demo data reset");
  });
  els.analyzeBtn.addEventListener("click", analyzeAudience);
  els.messageBtn.addEventListener("click", draftMessage);
  els.launchBtn.addEventListener("click", launchCampaign);
  els.suggestionsStrip.addEventListener("click", event => {
    const button = event.target.closest("[data-suggestion]");
    if (!button) return;
    const idea = state.suggestions[Number(button.dataset.suggestion)];
    state.currentRule = idea.rule;
    els.promptInput.value = `${idea.name}: ${idea.reason}`;
    els.campaignName.value = idea.name;
    els.channelInput.value = idea.channel;
    renderAudience({
      rule: idea.rule,
      count: idea.count,
      revenueOpportunity: idea.revenueOpportunity,
      suggestedChannel: idea.channel,
      preview: state.data.customers.filter(customer => {
        const inactive = !idea.rule.lastPurchaseDays || daysSince(customer.lastOrderDate) >= idea.rule.lastPurchaseDays;
        const recent = !idea.rule.purchasedWithinDays || daysSince(customer.lastOrderDate) <= idea.rule.purchasedWithinDays;
        const spend = !idea.rule.spentGreaterThan || customer.totalSpent > idea.rule.spentGreaterThan;
        const orders = !idea.rule.minOrderCount || customer.orderCount >= idea.rule.minOrderCount;
        const city = !idea.rule.city || customer.city === idea.rule.city;
        const category = !idea.rule.category || customer.preferredCategory === idea.rule.category;
        return inactive && recent && spend && orders && city && category;
      }).slice(0, 8)
    });
  });
  els.useSuggestedBtn.addEventListener("click", () => {
    const firstButton = els.suggestionsStrip.querySelector("[data-suggestion]");
    firstButton?.click();
  });
}

async function init() {
  bindEvents();
  await refresh({ quiet: true });
  await loadSuggestions();
  await analyzeAudience();
  state.poller = setInterval(() => refresh({ quiet: true }), 2200);
}

init().catch(error => {
  els.systemStatus.textContent = "Service unavailable";
  toast(error.message);
});
