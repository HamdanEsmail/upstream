// The side panel. It sends the highlighted sentence to Upstream, then shows the trail the
// service draws, refreshed every few seconds until the trace is done. When it is done, the
// sentence on the page is underlined with the verdict beside it.

const BASE = self.UPSTREAM_BASE;
const body = document.getElementById("body");
const full = document.getElementById("full");
document.getElementById("home").href = BASE + "/";

let current = null; // { id, tabId, text, marked }
let timer = null;

/** A plain state screen: a label, a few big words, a sentence, and an optional button. */
function state(label, word, why, options = {}) {
  const section = document.createElement("section");
  section.className = options.busy ? "state busy" : "state";
  for (const [cls, text] of [["label", label], ["word", word], ["why", why]]) {
    const p = document.createElement("p");
    p.className = cls;
    p.textContent = text;
    section.appendChild(p);
  }
  if (options.retry) {
    const button = document.createElement("button");
    button.className = "btn solid";
    button.type = "button";
    button.textContent = "Try again";
    button.addEventListener("click", options.retry);
    section.appendChild(button);
  }
  body.replaceChildren(section);
}

function plain(seconds) {
  const s = Math.max(0, Math.round(seconds));
  return s < 60 ? s + " s" : Math.floor(s / 60) + " min " + (s % 60) + " s";
}

function clocks() {
  for (const el of document.querySelectorAll("[data-since]")) {
    const since = Date.parse(el.getAttribute("data-since"));
    if (!Number.isNaN(since)) el.textContent = plain((Date.now() - since) / 1000);
  }
}

/** Runs inside the page: underlines the traced sentence and puts the verdict beside it. */
function markOnPage(text, verdict, url) {
  const probe = text.replace(/\s+/g, " ").trim().slice(0, 80);
  const selection = window.getSelection();
  if (!probe || !selection) return false;
  selection.removeAllRanges();
  if (!window.find(probe, false, false, true)) return false;
  const range = selection.getRangeAt(0).cloneRange();
  selection.removeAllRanges();
  if (window.CSS && CSS.highlights) {
    const style = document.createElement("style");
    style.textContent = "::highlight(upstream){text-decoration:underline 3px #1d6d88;background-color:#e4eff3;color:inherit}";
    document.head.appendChild(style);
    CSS.highlights.set("upstream", new Highlight(range));
  }
  const tag = document.createElement("a");
  tag.href = url;
  tag.target = "_blank";
  tag.rel = "noopener";
  tag.textContent = "Upstream: " + verdict;
  tag.style.cssText = "font:600 12px system-ui,sans-serif;background:#15191c;color:#fff;padding:2px 6px;margin:0 6px;text-decoration:none;white-space:nowrap";
  const end = range.cloneRange();
  end.collapse(false);
  end.insertNode(tag);
  return true;
}

async function markPage() {
  const verdict = document.querySelector("#trail .verdict .word");
  if (!current || current.marked || !verdict || current.tabId === undefined) return;
  current.marked = true;
  await chrome.storage.session.set({ current });
  try {
    await chrome.scripting.executeScript({ target: { tabId: current.tabId }, func: markOnPage, args: [current.text, verdict.textContent.trim(), BASE + "/t/" + current.id] });
  } catch {
    // The tab has moved on or cannot be written to. The trail in the panel is what matters.
  }
}

async function poll() {
  clearTimeout(timer);
  if (!current) return;
  try {
    const res = await fetch(`${BASE}/api/traces/${encodeURIComponent(current.id)}/fragment?panel=1`);
    if (res.ok) {
      // The markup comes from Upstream itself, which escapes everything it took from a page.
      body.innerHTML = await res.text();
      clocks();
    } else if (res.status === 404) {
      current = null;
      await chrome.storage.session.remove("current");
      return state("Gone", "That trail no longer exists", "Highlight the sentence again to trace it afresh.");
    }
  } catch {
    // A passing network fault: try again on the next turn.
  }
  const trail = document.getElementById("trail");
  if (!trail || trail.getAttribute("data-running") === "true") timer = setTimeout(poll, 3000);
  else markPage();
}

async function start(ask) {
  full.hidden = true;
  if (!ask.text || ask.text.length < 12) return state("Too short", "Highlight a whole sentence", "Select at least a dozen characters: the sentence that makes the claim works best.");
  state("Starting", "Sending the sentence", "The first steps appear within seconds. The full trail usually takes 4 to 6 minutes.", { busy: true });
  let res;
  let data;
  try {
    res = await fetch(BASE + "/api/traces", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ page_url: ask.url, text: ask.text, near: ask.near }),
    });
    data = await res.json();
  } catch {
    return state("No answer", "Could not reach Upstream", "Check your connection, then try again.", { retry: () => start(ask) });
  }
  if (!res.ok) return state("Not started", "Upstream said no", data.message || "The request was refused.");
  current = { id: data.id, tabId: ask.tabId, text: ask.text, marked: false };
  await chrome.storage.session.set({ current });
  full.href = data.url;
  full.hidden = false;
  poll();
}

/** Picks up a request the background part left, once. */
async function pickUp() {
  const stored = await chrome.storage.session.get(["ask", "current"]);
  if (stored.ask && Date.now() - stored.ask.at < 120000) {
    await chrome.storage.session.remove("ask");
    return start(stored.ask);
  }
  if (stored.current && !current) {
    current = stored.current;
    full.href = BASE + "/t/" + current.id;
    full.hidden = false;
    poll();
  }
}

document.addEventListener("click", (event) => {
  const button = event.target.closest ? event.target.closest("[data-copy]") : null;
  if (!button) return;
  const source = document.getElementById(button.getAttribute("data-copy"));
  if (!source) return;
  navigator.clipboard.writeText(source.textContent).then(
    () => (button.textContent = "Copied"),
    () => (button.textContent = "Select the text above to copy it"),
  );
});

chrome.runtime.onMessage.addListener((message) => {
  if (message && message.type === "ask") pickUp();
});

setInterval(clocks, 1000);
pickUp();
