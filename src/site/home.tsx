// The first page: paste a claim and the page it is on, or open a trail that already exists.
import { RESEARCH_RUN_USD, TEXT_MAX, TEXT_MIN } from "../core/limits";
import { siteName } from "../core/links";
import type { Trace } from "../trace/store";
import { quoted, verdictWords } from "./words";

/**
 * `deepOut`: "today" when the day's deep searches are used, "off" when the reserve pays for no more, null when one is to be had.
 * `paidLeft`: how many more the reserve pays for, once a run has been charged; null while runs are still thought free.
 */
export function Home({ note, recent, deepOut, paidLeft }: { note: string | null; recent: Trace[]; deepOut: "today" | "off" | null; paidLeft: number | null }) {
  return (
    <main class="page">
      <h1>Where did that number come from?</h1>
      <p class="lede">
        Highlight a claim on any page. Upstream follows it back, one source at a time, to where it first appeared, and shows what changed on the way.
      </p>

      {note ? (
        <p class="note" role="alert">
          {note}
        </p>
      ) : null}

      {deepOut === "today" ? (
        <p class="note" role="status">
          Today's deep searches are used up. A trace started now follows links and searches the web for the sentence, and takes about a minute. The deep search is back at midnight UTC; trace the same
          sentence again after that and it starts afresh with the full search.
        </p>
      ) : null}
      {deepOut === "off" ? (
        <p class="note" role="status">
          The money set aside for deep searches is used up, so a trace started now follows links and searches the web for the sentence, and takes about a minute. The trails below show what a full
          search finds.
        </p>
      ) : null}

      <form class="ask" method="post" action="/trace">
        <label>
          The page it is on
          <input type="url" name="url" required placeholder="https://" autocomplete="off" inputmode="url" />
        </label>
        <label>
          The sentence, copied from that page
          <textarea name="text" required minlength={TEXT_MIN} maxlength={TEXT_MAX} placeholder="Paste the sentence that makes the claim"></textarea>
        </label>
        <div>
          <button class="btn solid" type="submit" data-busy="Starting the trace…">
            Trace it upstream
          </button>
        </div>
        <p class="hint">
          {deepOut === "today"
            ? "The first steps appear within seconds. Today the trace stops after the links and a web search."
            : deepOut === "off"
              ? "The first steps appear within seconds. For now the trace stops after the links and a web search."
              : "The first steps appear within seconds. The full trail usually takes 4 to 6 minutes, and you can watch it grow."}
          {deepOut === null && paidLeft !== null && paidLeft > 0 ? ` A deep search costs $${RESEARCH_RUN_USD} at TinyFish, and Upstream can pay for ${paidLeft} more.` : null}
        </p>
      </form>

      <h2 id="traced">Traced so far</h2>
      {recent.length === 0 ? (
        <p class="prose">Nothing has been traced yet. Yours can be the first.</p>
      ) : (
        <ol class="traced">
          {recent.map((t) => (
            <li>
              <a href={`/t/${t.id}`}>
                <span class="v">{t.status === "done" ? verdictWords(t.verdict) : "Being traced now"}</span>
                <span class="claimline">{quoted(t.text)}</span>
                <span class="where">highlighted on {siteName(t.pageUrl)}</span>
              </a>
            </li>
          ))}
        </ol>
      )}

      <h2>How it works</h2>
      <ol class="steps3">
        <li>
          <b>It follows the links.</b>
          It reads the page, then the pages it links to, looking for the same claim. When the links run out, it searches the web for the sentence and reads the older
          pages that turn up. This takes seconds, and each step it finds is on screen at once.
        </li>
        <li>
          <b>It searches wider.</b>
          TinyFish's research tool reads dozens of pages to find sources further back still. This takes a few minutes.
        </li>
        <li>
          <b>It reads every step again.</b>
          Nothing is shown on trust. Each source is opened and the sentence found on the page, or you are told it was not.
        </li>
      </ol>
      <p class="prose">
        <a href="/how">More on how it works</a> · <a href="/get">Get the Chrome extension</a>
      </p>
    </main>
  );
}
