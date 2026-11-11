// The document every page shares: title, fonts, the stylesheet, the one script, the top bar
// and the footer with the spend line and the credit. Every page reads without the script.
import type { Child } from "hono/jsx";
import { raw } from "hono/html";

const FONTS =
  "https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,400&display=swap";

export const AUTHOR_URL = "https://github.com/HamdanEsmail";

export type SiteStats = { traces: number; steps: number; deepSearches: number; spendUsd: number };

/** The wordmark: a stop on a line, seen from where the line ends. */
export function Mark() {
  return (
    <a class="mark" href="/">
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="M10 19V6" stroke="#1d6d88" stroke-width="3" fill="none" />
        <circle cx="10" cy="5" r="3.2" fill="#fff" stroke="#1d6d88" stroke-width="2.6" />
      </svg>
      Upstream
    </a>
  );
}

export function Layout(props: {
  title: string;
  description: string;
  base: string;
  path: string;
  current?: "home" | "how" | "get";
  /** Reload every few seconds when scripts are off: a running trace must not look stuck. */
  refresh?: boolean;
  stats: SiteStats;
  children: Child;
}) {
  const root = props.base.replace(/\/$/, "");
  const here = (name: "home" | "how" | "get") => (props.current === name ? { "aria-current": "page" as const } : {});
  return (
    <>
      {raw("<!doctype html>")}
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width,initial-scale=1" />
          <title>{props.title}</title>
          <meta name="description" content={props.description} />
          <meta name="author" content="Hamdan Esmail" />
          <link rel="canonical" href={`${root}${props.path}`} />
          <meta property="og:title" content={props.title} />
          <meta property="og:description" content={props.description} />
          <meta property="og:image" content={`${root}/assets/social.jpg`} />
          <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
          <link href={FONTS} rel="stylesheet" />
          <link rel="stylesheet" href="/assets/line.css" />
          {props.refresh ? raw('<noscript><meta http-equiv="refresh" content="5"></noscript>') : null}
          <script src="/assets/trail.js" defer></script>
        </head>
        <body>
          <a class="skip" href="#content">
            Skip to the content
          </a>
          <header class="top">
            <Mark />
            <nav aria-label="Pages">
              <a href="/" {...here("home")}>
                Trace a claim
              </a>
              <a href="/#traced">Traced so far</a>
              <a href="/get" {...here("get")}>
                Get the extension
              </a>
              <a href="/how" {...here("how")}>
                How it works
              </a>
            </nav>
          </header>
          <div id="content">{props.children}</div>
          <footer class="foot">
            <span>
              {props.stats.traces} {props.stats.traces === 1 ? "trail" : "trails"} · {props.stats.steps} steps read · {props.stats.deepSearches} deep{" "}
              {props.stats.deepSearches === 1 ? "search" : "searches"} · TinyFish spend ${props.stats.spendUsd.toFixed(2)}
            </span>
            <span>
              Built by{" "}
              <a href={AUTHOR_URL} rel="author">
                Hamdan Esmail
              </a>
            </span>
          </footer>
        </body>
      </html>
    </>
  );
}
