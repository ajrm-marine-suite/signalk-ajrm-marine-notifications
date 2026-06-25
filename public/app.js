const API = "../plugins/signalk-ajrm-marine-notifications";

refresh();

async function refresh() {
  try {
    const response = await fetch(`${API}/status`, { cache: "no-store" });
    const projection = await response.json();
    if (!response.ok) throw new Error(projection.error || `HTTP ${response.status}`);
    renderProjection(projection);
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    window.setTimeout(refresh, 2000);
  }
}

function renderProjection(projection) {
  const active = Array.isArray(projection.active) ? projection.active : [];
  const history = Array.isArray(projection.recentActivity)
    ? projection.recentActivity
    : Array.isArray(projection.history)
      ? projection.history
      : [];
  const providers = providerSummary([...active, ...history]);

  setStatus(`Live v${projection.version}`, "live");
  setText("activeCount", active.length);
  setText("recentCount", history.length);
  setText("audioSequence", projection.audioSequence ?? 0);
  setText("providerCount", providers.length);
  setText(
    "contract",
    `${projection.contract || "unknown"} v${projection.contractVersion || "?"}`,
  );
  setText("sessionId", projection.sessionId || "—");
  setText("sequence", projection.sequence ?? "—");
  setText("serverTime", formatDateTime(projection.serverTime));
  setText("updatedAt", formatDateTime(projection.updatedAt));
  renderAudioDeliveryNote();
  renderProviders(providers);
  renderEntries("active", active, "No active brokered notifications.");
  renderEntries("history", history, "No recent activity.");
  document.getElementById("rawProjection").textContent = JSON.stringify(
    projection,
    null,
    2,
  );
}

function setStatus(message, mode) {
  const status = document.getElementById("status");
  status.textContent = message;
  status.classList.toggle("live", mode === "live");
  status.classList.toggle("error", mode === "error");
}

function setText(id, value) {
  document.getElementById(id).textContent = String(value);
}

function renderAudioDeliveryNote() {
  const element = document.getElementById("audioRequest");
  element.textContent =
    "Audio delivery is published as one-shot Signal K events at vessels.self.plugins.ajrmMarineNotifications.audio.";
}

function renderProviders(providers) {
  const element = document.getElementById("providers");
  element.replaceChildren();
  if (!providers.length) {
    element.textContent = "None.";
    return;
  }
  for (const provider of providers) {
    const item = document.createElement("article");
    item.className = "provider-card";
    item.append(
      tag(provider.name),
      factLine("Active", provider.active),
      factLine("Recent", provider.recent),
      factLine("Audio events", provider.audio),
    );
    element.append(item);
  }
}

function renderEntries(id, entries, emptyText) {
  const element = document.getElementById(id);
  element.replaceChildren();
  if (!entries.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = emptyText;
    element.append(empty);
    return;
  }
  for (const entry of entries) element.append(entryCard(entry));
}

function entryCard(entry) {
  const presentation = entry.presentation || {};
  const priority = entry.priority || {};
  const delivery = entry.delivery || {};
  const article = document.createElement("article");
  article.className = `notification-card level-${safeClass(priority.level)}`;

  const heading = document.createElement("h3");
  heading.textContent = `${presentation.label || priority.level || "Notification"}: ${
    presentation.title || entry.subjectKey || "Untitled"
  }`;

  const message = document.createElement("p");
  message.textContent = presentation.message || "";

  const meta = document.createElement("dl");
  meta.className = "facts compact";
  meta.append(
    factItem("Provider", entry.provider),
    factItem("Subject", entry.subjectKey),
    factItem("Event", entry.eventId),
    factItem("Revision", entry.revision ?? "—"),
    factItem("Lifecycle", entry.lifecycle),
    factItem("Priority", priority.score ?? "—"),
    factItem("Audio", delivery.audio ? "Yes" : "No"),
    factItem("Preempt", delivery.preempt === false ? "No" : "Yes"),
    factItem("Correlation", entry.correlationId || "—"),
    factItem("Timestamp", formatDateTime(entry.timestamp)),
  );

  article.append(heading, message, meta);
  return article;
}

function providerSummary(entries) {
  const counts = new Map();
  for (const entry of entries) {
    const name = entry.provider || "unknown";
    const item = counts.get(name) || { name, active: 0, recent: 0, audio: 0 };
    if (entry.lifecycle === "active") item.active += 1;
    else item.recent += 1;
    if (entry.delivery?.audio) item.audio += 1;
    counts.set(name, item);
  }
  return [...counts.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

function factLine(label, value) {
  const row = document.createElement("p");
  row.className = "fact-line";
  const strong = document.createElement("strong");
  strong.textContent = `${label}: `;
  row.append(strong, document.createTextNode(String(value ?? "—")));
  return row;
}

function factItem(label, value) {
  const group = document.createElement("div");
  const term = document.createElement("dt");
  const description = document.createElement("dd");
  term.textContent = label;
  description.textContent = String(value ?? "—");
  group.append(term, description);
  return group;
}

function tag(value) {
  const element = document.createElement("h3");
  element.className = "tag";
  element.textContent = value || "unknown";
  return element;
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "—";
  return date.toLocaleString();
}

function safeClass(value) {
  return String(value || "info").toLowerCase().replace(/[^a-z0-9_-]/g, "-");
}
