// Chooses which of a page's links are worth reading when looking for the page's source.

const MOST = 10;

const SOCIAL = new Set([
  "facebook.com", "twitter.com", "x.com", "linkedin.com", "instagram.com", "youtube.com", "youtu.be", "tiktok.com", "pinterest.com",
  "whatsapp.com", "wa.me", "t.me", "threads.net", "bsky.app", "snapchat.com", "flipboard.com",
]);

// Paths that lead to an account, a shop or a share dialog, never to a source.
const NOT_A_SOURCE = /(?:^|\/)(?:login|signin|sign-in|signup|sign-up|register|subscribe|subscription|account|share|sharer|intent|cart|checkout)(?:\/|$)/i;

function parse(link: string): URL | null {
  try {
    const u = new URL(link);
    return u.protocol === "http:" || u.protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}

const site = (u: URL): string => u.hostname.toLowerCase().replace(/^www\./, "");

/** One key per page: the fragment and a trailing slash do not make a different page. */
function pageKey(u: URL): string {
  return site(u) + u.pathname.replace(/\/+$/, "") + u.search;
}

function social(u: URL): boolean {
  const host = site(u);
  for (const s of SOCIAL) if (host === s || host.endsWith("." + s)) return true;
  return false;
}

/** The site an address belongs to, without "www."; empty when the text is not a web address. */
export function siteName(address: string | null): string {
  const u = address === null ? null : parse(address);
  return u ? site(u) : "";
}

/**
 * `near` are the links in the highlighted paragraph (the extension sends them); they come
 * first and may stay on the same site. `links` are the rest of the page's links; of those
 * only links to other sites are kept.
 */
export function candidateLinks(pageUrl: string, links: string[], near: string[]): string[] {
  const page = parse(pageUrl);
  const seen = new Set<string>(page ? [pageKey(page)] : []);
  const out: string[] = [];
  const consider = (link: string, isNear: boolean) => {
    if (out.length >= MOST) return;
    const u = parse(link);
    if (!u || social(u) || NOT_A_SOURCE.test(u.pathname)) return;
    if (!isNear && page && site(u) === site(page)) return;
    const key = pageKey(u);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(link);
  };
  for (const link of near) consider(link, true);
  for (const link of links) consider(link, false);
  return out;
}
