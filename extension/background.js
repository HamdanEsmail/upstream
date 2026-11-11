// The background part of the extension. It adds one entry to the right-click menu and, when
// that entry is chosen, opens the side panel and hands it what was highlighted. It reads a
// page only at that moment, and only the tab the menu was opened on.

const MENU = "upstream-trace";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: MENU, title: "Trace upstream", contexts: ["selection"] });
  // Clicking the toolbar button opens the panel too, to look at the last trail again.
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

/** Runs inside the page: the highlighted text, the page's address, and the links in that paragraph. */
function grab() {
  const selection = window.getSelection();
  const text = selection ? selection.toString().replace(/\s+/g, " ").trim() : "";
  let node = selection && selection.rangeCount > 0 ? selection.getRangeAt(0).commonAncestorContainer : null;
  if (node && node.nodeType !== Node.ELEMENT_NODE) node = node.parentElement;
  const block = node ? node.closest("p, li, blockquote, td, figcaption, h1, h2, h3, h4") || node : null;
  const near = block
    ? Array.from(block.querySelectorAll("a[href]"))
        .map((a) => a.href)
        .filter((href) => /^https?:/.test(href))
        .slice(0, 20)
    : [];
  return { text, url: location.href, near };
}

async function handOver(info, tab) {
  let found = null;
  try {
    const [answer] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: grab });
    found = answer ? answer.result : null;
  } catch {
    // Some pages (the PDF viewer, the web store) cannot be read. The menu still gives the text.
  }
  const ask = {
    text: (found && found.text) || String(info.selectionText || "").replace(/\s+/g, " ").trim(),
    url: (found && found.url) || info.pageUrl || tab.url || "",
    near: (found && found.near) || [],
    tabId: tab.id,
    at: Date.now(),
  };
  await chrome.storage.session.set({ ask });
  // The panel may still be opening; it also reads the request from storage when it loads.
  chrome.runtime.sendMessage({ type: "ask" }).catch(() => {});
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU || !tab || tab.id === undefined) return;
  // The panel has to be opened at once, while Chrome still counts this as the click.
  chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
  handOver(info, tab);
});
