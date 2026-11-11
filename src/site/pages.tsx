// The plain pages: how it works, getting the extension, and not found.
import { FOLLOW_DEPTH, FREE_RESEARCH_RUNS_PER_DAY, RESEARCH_RUN_USD, TRACES_PER_DAY, TRACES_PER_VISITOR_PER_HOUR } from "../core/limits";

export function HowPage({ reserveUsd }: { reserveUsd: number }) {
  return (
    <main class="page">
      <h1>How Upstream works</h1>
      <p class="lede">Two ways of looking, and one rule: a source is shown only after its page has been read and the sentence looked for.</p>

      <h2>Two engines</h2>
      <div class="prose">
        <h3>Following links, in seconds</h3>
        <p>
          Upstream reads the page with TinyFish Fetch and finds the sentence you highlighted. Then it reads the pages that page links to and looks for the same claim on
          them. A page that states it becomes the next step, and the search carries on from there, up to {FOLLOW_DEPTH} steps deep.
        </p>
        <h3>The deep search, in minutes</h3>
        <p>
          Many pages repeat a claim without linking to anything. So a TinyFish research run looks wider: it searches, reads dozens of pages and proposes a trail back to
          the earliest source it can find. This usually takes 4 to 6 minutes. While it runs, the trail page says how many pages it has read.
        </p>
      </div>

      <h2>Every step is read again</h2>
      <div class="prose">
        <p>
          The research run only proposes. Upstream opens each page it names and looks for the sentence. If the page is gone or has changed, it tries the copy the Internet
          Archive saved nearest that date. If a source exists only in print, it looks for the page that quotes it and says so.
        </p>
        <ul>
          <li>
            <b>Found word for word</b>: the sentence is on the page exactly.
          </li>
          <li>
            <b>Found in slightly different words</b>: the page states the same thing; its own sentence is the one shown.
          </li>
          <li>
            <b>Not found on this page</b>: the page was read and does not say it.
          </li>
          <li>
            <b>Could not be read</b>, or <b>not readable online</b>: said plainly, never hidden.
          </li>
        </ul>
      </div>

      <h2>What the trail shows</h2>
      <div class="prose">
        <ul>
          <li>
            A <b>solid line</b> between two steps means the newer page really links to the older one. A <b>dashed line</b> means the older one was found by search.
          </li>
          <li>
            Words in <b>rust</b> are the words a step changed compared with the older sentence it repeats.
          </li>
          <li>
            A <b>change note</b> names what happened: a figure rounded, a figure changed, a careful word such as "about" or "up to" dropped, a year dropped. These are worked
            out by comparing the two sentences, so you can check them by reading.
          </li>
          <li>
            Each date says where it came from when it is not the page's own: the Internet Archive's first saved copy, or the research run.
          </li>
        </ul>
      </div>

      <h2>The six verdicts</h2>
      <div class="prose">
        <ul>
          <li>
            <b>Matches the original</b>: an original source was read and says the same.
          </li>
          <li>
            <b>Changed on the way</b>: an original was read, and the claim differs from it in a figure or a careful word.
          </li>
          <li>
            <b>Out of date</b>: the original is five or more years old and the claim is repeated as if it were current.
          </li>
          <li>
            <b>Said by someone else</b>: a quotation whose earliest appearance has a different speaker or author.
          </li>
          <li>
            <b>No original source</b>: the trail ends on a page that gives no source.
          </li>
          <li>
            <b>Not settled</b>: the steps that matter could not be read, or the deep search did not run.
          </li>
        </ul>
        <p>Every verdict says whether it rests on an original source or only on the earliest copy found.</p>
      </div>

      <h2>What it does not do</h2>
      <div class="prose">
        <ul>
          <li>It does not decide whether a claim is true. It reports where the claim came from and what changed.</li>
          <li>It does not read pages behind a login or a paywall.</li>
          <li>It reads a page up to its first 120,000 characters.</li>
          <li>Inside a PDF the browser cannot jump to a sentence, so the link opens the file.</li>
        </ul>
      </div>

      <h2>Limits and cost</h2>
      <div class="prose">
        <p>
          Following links is free. The deep search is free {FREE_RESEARCH_RUNS_PER_DAY * 2} times a day; after that one costs ${RESEARCH_RUN_USD}, paid from a reserve of $
          {reserveUsd} in total. When the free runs and the reserve are used, a trace still follows links and says that the deep search is back at midnight UTC. A trail
          that exists is never traced twice: the same sentence on the same page opens the saved trail.
        </p>
        <p>
          One visitor can start {TRACES_PER_VISITOR_PER_HOUR} new traces an hour, and all visitors together {TRACES_PER_DAY} a day.
        </p>
      </div>

      <h2>What it sends</h2>
      <div class="prose">
        <p>
          The extension does nothing until you choose "Trace upstream". Then it sends three things: the sentence you highlighted, the address of the page, and the links in
          that paragraph. It does not read your other tabs or your history, and it holds no key.
        </p>
      </div>
    </main>
  );
}

export function GetPage() {
  return (
    <main class="page">
      <h1>Get the Chrome extension</h1>
      <p class="lede">Highlight a sentence, right-click, choose "Trace upstream". The trail opens in a panel beside the page you are reading.</p>

      <h2>Install it in a minute</h2>
      <ol class="steps3">
        <li>
          <b>Download and unzip.</b>
          <a href="/assets/upstream-extension.zip">Download upstream-extension.zip</a> and unzip it into a folder you will keep.
        </li>
        <li>
          <b>Open the extensions page.</b>
          In Chrome, go to <span class="code">chrome://extensions</span> and switch on "Developer mode" at the top right.
        </li>
        <li>
          <b>Load the folder.</b>
          Choose "Load unpacked" and pick the unzipped folder. Upstream now appears in the right-click menu when text is selected.
        </li>
      </ol>

      <h2>What it may do</h2>
      <div class="prose">
        <ul>
          <li>Read the page you are on, only at the moment you choose "Trace upstream".</li>
          <li>Add one entry to the right-click menu and open a side panel.</li>
          <li>Talk to this site, which does the tracing. It talks to no other server.</li>
        </ul>
        <p>
          No account, no key, no local server. If you would rather not install anything, <a href="/">paste a sentence here</a>; the trail is the same.
        </p>
      </div>
    </main>
  );
}

export function NotFoundPage() {
  return (
    <main class="page">
      <h1>No trail here</h1>
      <p class="lede">This address does not lead to a trail. It may have been mistyped.</p>
      <p class="prose">
        <a class="btn solid" href="/">
          Trace a claim
        </a>
      </p>
    </main>
  );
}
