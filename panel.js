
// Simple state
let history = [];
let nextId = 1;
let activeHistoryId = null;
let settings = {
  maxHistory: 300
};

const reqEditor = document.getElementById("requestEditor");
const resViewer = document.getElementById("responseViewer");
const reqHeadersView = document.getElementById("requestHeadersView");
const reqJsonView = document.getElementById("requestJsonView");
const resJsonView = document.getElementById("responseJsonView");
const reqList = document.getElementById("requestList");
const bulkResults = document.getElementById("bulkResults");
const statusLine = document.getElementById("statusLine");

// Filters
const filterMethodEl = document.getElementById("filterMethod");
const filterStatusEl = document.getElementById("filterStatus");
const filterSearchEl = document.getElementById("filterSearch");

// Default request
reqEditor.value = `GET https://httpbin.org/get

`;

// ----- Settings -----
function loadSettings() {
  try {
    const raw = localStorage.getItem("burpRepeaterSettings");
    if (raw) {
      const parsed = JSON.parse(raw);
      Object.assign(settings, parsed);
    }
  } catch (e) {
    console.warn("Settings load error", e);
  }
  document.getElementById("settingMaxHistory").value = settings.maxHistory;
}

function saveSettings() {
  settings.maxHistory = parseInt(document.getElementById("settingMaxHistory").value || "300", 10);
  localStorage.setItem("burpRepeaterSettings", JSON.stringify(settings));
}

// ----- History -----
function addHistoryEntry(entry) {
  history.unshift(entry);
  if (history.length > settings.maxHistory) {
    history = history.slice(0, settings.maxHistory);
  }
  renderHistory();
}

function renderHistory() {
  reqList.innerHTML = "";
  const methodFilter = filterMethodEl.value.trim().toUpperCase();
  const statusFilter = filterStatusEl.value.trim();
  const searchFilter = filterSearchEl.value.trim().toLowerCase();

  history.forEach(item => {
    if (methodFilter && item.method.toUpperCase() !== methodFilter) return;
    if (statusFilter && String(item.status || "").indexOf(statusFilter) === -1) return;
    if (searchFilter && item.url.toLowerCase().indexOf(searchFilter) === -1) return;

    const div = document.createElement("div");
    div.className = "req-item" + (item.id === activeHistoryId ? " active" : "");
    div.dataset.id = item.id;

    const top = document.createElement("div");
    top.className = "req-top-line";

    const left = document.createElement("div");
    left.style.display = "flex";
    left.style.alignItems = "center";

    const methodSpan = document.createElement("span");
    methodSpan.className = "req-method";
    methodSpan.textContent = item.method;

    const urlSpan = document.createElement("span");
    urlSpan.className = "req-url";
    urlSpan.textContent = item.url;

    left.appendChild(methodSpan);
    left.appendChild(urlSpan);

    const statusSpan = document.createElement("span");
    statusSpan.className = "req-status";
    statusSpan.textContent = item.status || "";

    top.appendChild(left);
    top.appendChild(statusSpan);

    const meta = document.createElement("div");
    meta.className = "req-meta";
    meta.textContent = (item.type || "manual") + " | " +
      (item.timeMs != null ? item.timeMs + " ms" : "") +
      (item.size != null ? " | " + item.size + " B" : "");

    div.appendChild(top);
    div.appendChild(meta);

    div.addEventListener("click", () => {
      activeHistoryId = item.id;
      reqEditor.value = item.rawRequest || "";
      resViewer.value = item.responseBody || "";
      statusLine.textContent = item.statusLine || "";
      updateRequestDerivedViews();
      updateResponseDerivedViews();
      renderHistory();
    });

    reqList.appendChild(div);
  });
}

function addBulkResult(row) {
  const tr = document.createElement("tr");
  tr.innerHTML = `<td>${row.id}</td>
                  <td>${row.payload}</td>
                  <td>${row.status}</td>
                  <td>${row.size}</td>
                  <td>${row.time} ms</td>`;
  bulkResults.prepend(tr);
}

// ----- Parsing helpers -----
function parseRawRequest(raw) {
  const lines = raw.split(/\r?\n/);
  if (!lines.length) {
    throw new Error("Empty request");
  }
  const requestLine = lines.shift();
  const [method, url] = requestLine.split(" ");
  if (!method || !url) {
    throw new Error("First line must be: METHOD URL");
  }
  const headers = {};
  let line;
  while (lines.length) {
    line = lines.shift();
    if (line.trim() === "") break;
    const idx = line.indexOf(":");
    if (idx > -1) {
      const name = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      if (name) headers[name] = value;
    }
  }
  const body = lines.join("\n");
  return { method, url, headers, body };
}

function buildCurl(parsed) {
  const parts = ["curl"];
  parts.push("-X");
  parts.push(JSON.stringify(parsed.method));
  Object.entries(parsed.headers || {}).forEach(([k, v]) => {
    parts.push("-H");
    parts.push(JSON.stringify(k + ": " + v));
  });
  if (parsed.body && parsed.body.trim() !== "") {
    parts.push("--data-binary");
    parts.push(JSON.stringify(parsed.body));
  }
  parts.push(JSON.stringify(parsed.url));
  return parts.join(" ");
}

// ----- Request/response derived views -----
function updateRequestDerivedViews() {
  const raw = reqEditor.value;
  let parsed;
  try {
    parsed = parseRawRequest(raw);
  } catch (e) {
    reqHeadersView.textContent = "Parse error: " + e.message;
    reqJsonView.textContent = "";
    return;
  }
  // headers view
  const headersLines = Object.entries(parsed.headers).map(
    ([k, v]) => k + ": " + v
  );
  reqHeadersView.textContent = [
    parsed.method + " " + parsed.url,
    "",
    ...headersLines
  ].join("\n");

  // json view
  try {
    if (parsed.body && parsed.body.trim() !== "") {
      const json = JSON.parse(parsed.body);
      reqJsonView.textContent = JSON.stringify(json, null, 2);
    } else {
      reqJsonView.textContent = "// No body";
    }
  } catch (e) {
    reqJsonView.textContent = "// Body is not valid JSON";
  }
}

function updateResponseDerivedViews(latestText) {
  const text = latestText != null ? latestText : resViewer.value;
  try {
    const json = JSON.parse(text);
    resJsonView.textContent = JSON.stringify(json, null, 2);
  } catch (e) {
    resJsonView.textContent = "// Not valid JSON";
  }
}

// ----- Send request -----
async function sendRequest() {
  const raw = reqEditor.value;
  let parsed;
  try {
    parsed = parseRawRequest(raw);
  } catch (e) {
    resViewer.value = "Parse error: " + e.message;
    statusLine.textContent = "Parse error";
    updateResponseDerivedViews(resViewer.value);
    return;
  }

  const start = performance.now();
  let res, text;
  try {
    res = await fetch(parsed.url, {
      method: parsed.method,
      headers: parsed.headers,
      body: parsed.body || undefined,
      redirect: "follow"
    });
    text = await res.text();
  } catch (e) {
    resViewer.value = "Request error: " + e.message;
    statusLine.textContent = "Error";
    updateResponseDerivedViews(resViewer.value);
    return;
  }
  const end = performance.now();
  const ms = Math.round(end - start);
  const size = text.length;
  const statusText = res.status + " " + (res.statusText || "");

  resViewer.value = text;
  statusLine.textContent = statusText + " | " + ms + " ms | " + size + " bytes";
  updateResponseDerivedViews(text);

  const entry = {
    id: nextId++,
    rawRequest: raw,
    method: parsed.method,
    url: parsed.url,
    status: res.status,
    statusLine: statusText,
    responseBody: text,
    type: "manual",
    timeMs: ms,
    size
  };
  activeHistoryId = entry.id;
  addHistoryEntry(entry);

  addBulkResult({
    id: entry.id,
    payload: parsed.body ? parsed.body.slice(0, 40) + (parsed.body.length > 40 ? "..." : "") : "(no body)",
    status: res.status,
    size,
    time: ms
  });
}

// ----- Tabs -----
function setupTabs() {
  const tabButtons = document.querySelectorAll(".tab-btn");
  const panels = document.querySelectorAll(".tab-panel");

  tabButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      const tabId = btn.dataset.tab;
      tabButtons.forEach(b => b.classList.toggle("active", b === btn));
      panels.forEach(p => p.classList.toggle("active", p.id === tabId));
    });
  });

  // Subtabs
  const subtabGroups = document.querySelectorAll(".subtabs");
  subtabGroups.forEach(group => {
    const scope = group.getAttribute("data-scope");
    const buttons = group.querySelectorAll(".subtab-btn");
    buttons.forEach(btn => {
      btn.addEventListener("click", () => {
        const view = btn.dataset.view;
        buttons.forEach(b => b.classList.toggle("active", b === btn));
        document.querySelectorAll(`.pane-view[data-scope="${scope}"]`).forEach(v => {
          v.classList.toggle("active", v.getAttribute("data-view") === view);
        });
      });
    });
  });
}

// ----- Decoder -----
function runDecoder() {
  const mode = document.getElementById("decoderMode").value;
  const input = document.getElementById("decoderInput").value;
  const outEl = document.getElementById("decoderOutput");
  try {
    let out = "";
    if (mode === "b64enc") {
      out = btoa(input);
    } else if (mode === "b64dec") {
      out = atob(input);
    } else if (mode === "urlenc") {
      out = encodeURIComponent(input);
    } else if (mode === "urldec") {
      out = decodeURIComponent(input);
    } else if (mode === "jsonpretty") {
      out = JSON.stringify(JSON.parse(input), null, 2);
    } else if (mode === "jsonmin") {
      out = JSON.stringify(JSON.parse(input));
    } else if (mode === "jwtdec") {
      const parts = input.split(".");
      if (parts.length < 2) throw new Error("Not a JWT");
      const dec = s => atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
      const header = JSON.parse(dec(parts[0]));
      const payload = JSON.parse(dec(parts[1]));
      out = "Header:\n" + JSON.stringify(header, null, 2) + "\n\nPayload:\n" + JSON.stringify(payload, null, 2);
    } else if (mode === "hexenc") {
      out = Array.from(input).map(c => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
    } else if (mode === "hexdec") {
      const cleaned = input.replace(/[^0-9a-fA-F]/g, "");
      let s = "";
      for (let i = 0; i < cleaned.length; i += 2) {
        s += String.fromCharCode(parseInt(cleaned.substr(i, 2), 16));
      }
      out = s;
    }
    outEl.value = out;
  } catch (e) {
    outEl.value = "Decoder error: " + e.message;
  }
}

// ----- Diff -----
function computeDiff() {
  const left = document.getElementById("diffLeft").value.split(/\r?\n/);
  const right = document.getElementById("diffRight").value.split(/\r?\n/);
  const outLines = [];
  const maxLen = Math.max(left.length, right.length);
  for (let i = 0; i < maxLen; i++) {
    const l = left[i] || "";
    const r = right[i] || "";
    if (l === r) {
      outLines.push("  " + l);
    } else {
      if (l) outLines.push("- " + l);
      if (r) outLines.push("+ " + r);
    }
  }
  document.getElementById("diffOutput").value = outLines.join("\n");
}

// ----- Intruder -----
function intruderLoadFromRepeater() {
  document.getElementById("intruderRequest").value = reqEditor.value;
}

async function intruderRun() {
  const baseReq = document.getElementById("intruderRequest").value;
  const payloadsRaw = document.getElementById("intruderPayloads").value;
  const tbody = document.getElementById("intruderResultsBody");
  tbody.innerHTML = "";
  if (!baseReq.trim()) return;
  const payloads = payloadsRaw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (!payloads.length) return;

  for (let i = 0; i < payloads.length; i++) {
    const payload = payloads[i];
    const raw = baseReq.replace(/§/g, payload);
    let parsed;
    try {
      parsed = parseRawRequest(raw);
    } catch (e) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${i + 1}</td><td>${payload}</td><td>ERR</td><td>-</td><td>-</td>`;
      tbody.appendChild(tr);
      continue;
    }
    const start = performance.now();
    let res, text;
    try {
      res = await fetch(parsed.url, {
        method: parsed.method,
        headers: parsed.headers,
        body: parsed.body || undefined,
        redirect: "follow"
      });
      text = await res.text();
    } catch (e) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${i + 1}</td><td>${payload}</td><td>ERR</td><td>-</td><td>-</td>`;
      tbody.appendChild(tr);
      continue;
    }
    const end = performance.now();
    const ms = Math.round(end - start);
    const size = text.length;
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${i + 1}</td><td>${payload}</td><td>${res.status}</td><td>${size}</td><td>${ms}</td>`;
    tbody.appendChild(tr);
  }
}

// ----- Copy as curl -----
function copyAsCurl() {
  const raw = reqEditor.value;
  try {
    const parsed = parseRawRequest(raw);
    const curl = buildCurl(parsed);
    navigator.clipboard.writeText(curl).then(() => {
      statusLine.textContent = "Copied cURL to clipboard";
      setTimeout(() => {
        statusLine.textContent = "";
      }, 2000);
    }, () => {
      statusLine.textContent = "Failed to copy cURL";
    });
  } catch (e) {
    statusLine.textContent = "Cannot build cURL: " + e.message;
  }
}

// ----- Live capture from devtools.network -----
if (browser.devtools && browser.devtools.network && browser.devtools.network.onRequestFinished) {
  browser.devtools.network.onRequestFinished.addListener(request => {
    try {
      const req = request.request;
      const res = request.response;

      let raw = req.method + " " + req.url + "\n";
      (req.headers || []).forEach(h => {
        raw += h.name + ": " + h.value + "\n";
      });
      raw += "\n";
      if (req.postData && req.postData.text) {
        raw += req.postData.text;
      }

      const status = res.status;
      const statusText = res.status + " " + (res.statusText || "");
      const timeMs = Math.round(request.time || 0);

      request.getContent((body, encoding) => {
        const text = body || "";
        const size = text.length;
        const entry = {
          id: nextId++,
          rawRequest: raw,
          method: req.method,
          url: req.url,
          status,
          statusLine: statusText,
          responseBody: text,
          type: "captured",
          timeMs,
          size
        };
        addHistoryEntry(entry);
      });
    } catch (e) {
      console.error("Error capturing request", e);
    }
  });
} else {
  console.warn("devtools.network API not available");
}

// ----- Event wiring -----
document.getElementById("sendBtn").addEventListener("click", sendRequest);
document.getElementById("copyCurlBtn").addEventListener("click", copyAsCurl);

// Request editor derived views update
reqEditor.addEventListener("input", () => {
  updateRequestDerivedViews();
});

// Filters
filterMethodEl.addEventListener("input", renderHistory);
filterStatusEl.addEventListener("input", renderHistory);
filterSearchEl.addEventListener("input", renderHistory);

// Decoder
document.getElementById("decoderRunBtn").addEventListener("click", runDecoder);

// Diff
document.getElementById("diffRunBtn").addEventListener("click", computeDiff);

// Intruder
document.getElementById("intruderLoadFromRepeaterBtn").addEventListener("click", intruderLoadFromRepeater);
document.getElementById("intruderStartBtn").addEventListener("click", intruderRun);

// Settings
document.getElementById("settingsSaveBtn").addEventListener("click", () => {
  saveSettings();
  statusLine.textContent = "Settings saved";
  setTimeout(() => { statusLine.textContent = ""; }, 2000);
});

// Tabs setup
setupTabs();
loadSettings();
updateRequestDerivedViews();
updateResponseDerivedViews();
