// A trail, drawn as a line of stops. The same markup serves the trail page (two columns on
// a wide screen) and the extension's side panel (one column).
import { plainDate } from "../core/dates";
import type { DocumentStep, TrailDocument } from "../trace/document";
import { dateSourceWords, duration, quoted, reachedLine, reachedWords, readingWords, stageWords } from "./words";

const confirmed = (s: DocumentStep): boolean => s.wording !== null && (s.reading === "exact" || s.reading === "close" || s.reading === "offline");

function Quote({ step }: { step: DocumentStep }) {
  if (step.wording === null) return <p class="gap">{readingWords(step.reading, step.readFrom, step.quotedBy)}</p>;
  if (step.marks === null) return <p class="quote">{quoted(step.wording)}</p>;
  const bare = quoted(step.wording) === step.wording.trim();
  return (
    <p class="quote">
      {bare ? "" : "“"}
      {step.marks.map((run) => (run.op === "added" ? <mark>{run.text}</mark> : run.text))}
      {bare ? "" : "”"}
    </p>
  );
}

function openWords(step: DocumentStep): string {
  if (step.reading === "offline") return "Open where it is quoted";
  if (step.readFrom === "archive") return "Open the saved copy";
  if (step.wording !== null && (step.reading === "exact" || step.reading === "close") && step.openUrl !== step.url) return "Open at the sentence";
  return "Open the page";
}

function Stop({ step, next, cold, last, reached }: { step: DocumentStep; next: DocumentStep | undefined; cold: boolean; last: boolean; reached: string | null }) {
  // The line below a stop shows how the next, older stop was reached.
  const below = next ? (next.reachedBy === "link" ? "" : " search") : cold ? "" : " last";
  const unread = step.position > 0 && !confirmed(step) ? " unread" : "";
  const source = dateSourceWords(step.dateSource);
  return (
    <li class={`stop${below}${unread}`}>
      <p class="meta">
        {step.position === 0 ? "The page you read" : step.date ? step.datePlain : "No date"}{" "}
        <span>
          · {step.name}
          {step.position === 0 && step.date ? ` · ${step.datePlain}` : ""}
          {source ? ` · ${source}` : ""}
        </span>
      </p>
      {step.title ? <p class="title">{step.title}</p> : null}
      <Quote step={step} />
      <p class="tags">
        {step.openUrl ? (
          <a href={step.openUrl} rel="noopener noreferrer" target="_blank">
            {openWords(step)}
          </a>
        ) : null}
        {step.wording !== null ? <span>{readingWords(step.reading, step.readFrom, step.quotedBy)}</span> : null}
        {step.position > 0 ? <span>{reachedWords(step.reachedBy)}</span> : null}
        {step.namesSource ? <span>Names as its source: {step.namesSource}</span> : null}
        {last && step.position > 0 && confirmed(step) && !cold ? <span>{reached === "original" ? "This is the original source." : "This is the earliest copy found."}</span> : null}
      </p>
      {step.notes.map((note) => (
        <p class="drift">Changed here: {note}</p>
      ))}
    </li>
  );
}

function Working({ doc }: { doc: TrailDocument }) {
  return (
    <section class="working" aria-live="polite">
      <p class="label">Tracing</p>
      <p class="word">
        <span class="pulse" aria-hidden="true"></span>
        Following the trail
        <span class="clock" data-since={doc.progress.startedAt}>
          started {doc.progress.startedAt.slice(11, 16)} UTC
        </span>
      </p>
      <p class="why">{stageWords(doc.status, doc.progress.pagesRead, doc.progress.latestHosts)}</p>
      <p class="usual">The first steps appear within seconds. The deep search usually takes 4 to 6 minutes; this page updates by itself.</p>
      {doc.events.length > 0 ? (
        <ol class="log">
          {doc.events.map((e) => (
            <li>{e.message}</li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}

function Verdict({ doc }: { doc: TrailDocument }) {
  if (doc.status === "failed") {
    return (
      <section class="verdict failed">
        <p class="label">Stopped</p>
        <p class="word">This trace broke</p>
        <p class="why">Something failed while tracing. Tracing the same sentence again from the first page starts it afresh.</p>
      </section>
    );
  }
  return (
    <section class="verdict">
      <p class="label">Verdict</p>
      <p class="word">{doc.verdictWords}</p>
      {doc.summary ? <p class="why">{doc.summary}</p> : null}
      <p class="rests">{reachedLine(doc.reached)}</p>
    </section>
  );
}

function Facts({ doc }: { doc: TrailDocument }) {
  const beyond = doc.steps.slice(1);
  // A source known only because a later page quotes it is not counted as read on its own page.
  const onPage = beyond.filter((s) => confirmed(s) && s.reading !== "offline").length;
  const quotedOnly = beyond.filter((s) => confirmed(s) && s.reading === "offline").length;
  // The page the reader started from is never "the earliest step".
  const oldest = [...beyond].reverse().find((s) => s.date !== null && confirmed(s)) ?? [...beyond].reverse().find((s) => s.date !== null);
  const how = !oldest ? "" : oldest.reading === "offline" ? "the earliest step, known only as quoted" : confirmed(oldest) ? "the earliest step confirmed" : "the earliest step, not confirmed";
  const source = oldest ? dateSourceWords(oldest.dateSource) : null;
  const notes = doc.steps.reduce((n, s) => n + s.notes.length, 0);
  const pages = doc.progress.pagesRead;
  return (
    <dl class="facts">
      <div>
        <dt>{beyond.length === 0 ? "No steps back" : `${onPage} of ${beyond.length}`}</dt>
        <dd>
          {beyond.length === 0
            ? "nothing beyond the page you read was found"
            : `steps back, found on the page itself${quotedOnly > 0 ? `; ${quotedOnly} more known only as quoted by another page` : ""}`}
        </dd>
      </div>
      {oldest ? (
        <div>
          <dt>{oldest.datePlain}</dt>
          <dd>
            {how}
            {source ? `, ${source}` : ""}
          </dd>
        </div>
      ) : null}
      <div>
        <dt>
          {notes} {notes === 1 ? "change" : "changes"}
        </dt>
        <dd>named by comparing the sentences</dd>
      </div>
      {doc.seconds !== null ? (
        <div>
          <dt>{duration(doc.seconds)}</dt>
          <dd>{pages > 0 ? `${pages} pages read by the deep search` : "following links only"}</dd>
        </div>
      ) : pages > 0 ? (
        // No time is known for a trail built from a deep search that had already finished.
        <div>
          <dt>{`${pages} ${pages === 1 ? "page" : "pages"}`}</dt>
          <dd>read by the deep search</dd>
        </div>
      ) : null}
    </dl>
  );
}

export function TrailBody({ doc, panel }: { doc: TrailDocument; panel: boolean }) {
  const done = doc.status === "done";
  const cold = done && (doc.verdict === "no_original_source" || doc.verdict === "not_settled");
  return (
    <main class={`trail${panel ? " panel" : ""}`} id="trail" data-id={doc.id} data-running={doc.running ? "true" : "false"}>
      <div class="head">
        <section class="claim">
          <p class="label">
            The claim, as highlighted on{" "}
            <a href={doc.pageUrl} rel="noopener noreferrer" target="_blank">
              {doc.pageSite}
            </a>
          </p>
          <blockquote class="quote">{quoted(doc.text)}</blockquote>
        </section>
        {doc.running ? <Working doc={doc} /> : <Verdict doc={doc} />}
      </div>
      <div class="main">
        <p class="label">The trail, from the page you read back to where it started</p>
        <ol class="line">
          {doc.steps.map((step, i) => (
            <Stop step={step} next={doc.steps[i + 1]} cold={cold} last={i === doc.steps.length - 1} reached={doc.reached} />
          ))}
          {cold ? (
            <li class="stop cold">
              <p class="meta">The trail goes cold here</p>
              <p class="tags">
                <span>{doc.verdict === "no_original_source" ? "No page beyond this point gives a source for the claim." : "Nothing beyond this point could be confirmed."}</span>
              </p>
            </li>
          ) : null}
        </ol>
        {doc.noted.length > 0 ? (
          <section class="noted">
            <p class="label">Also noted by the deep search, not checked by code</p>
            <ul>
              {doc.noted.map((n) => (
                <li>{n}</li>
              ))}
            </ul>
          </section>
        ) : null}
        <p class="ev">
          {done && doc.finishedAt ? `Traced ${plainDate(doc.finishedAt.slice(0, 10))}, ${doc.finishedAt.slice(11, 16)} UTC` : `Started ${plainDate(doc.createdAt.slice(0, 10))}, ${doc.createdAt.slice(11, 16)} UTC`} ·{" "}
          {doc.progress.deepStartedAt !== null ? "TinyFish Fetch and Research" : "TinyFish Fetch"} · spend on this trace ${doc.spendUsd.toFixed(2)}
        </p>
      </div>
      {done ? (
        <div class="more">
          <Facts doc={doc} />
          {doc.cite ? (
            <section class="cite">
              <p class="label">Cite it right</p>
              <pre id="cite-text">{doc.cite.plain}</pre>
              <button class="btn solid" type="button" data-copy="cite-text">
                Copy this citation
              </button>
            </section>
          ) : null}
        </div>
      ) : null}
    </main>
  );
}
