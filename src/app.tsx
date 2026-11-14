// Every route: the pages, the JSON API and the admin routes. Form posts call the same
// functions as the API, with the same limits.
import { Hono, type Context } from "hono";
import type { Child } from "hono/jsx";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Env } from "./env";
import { Home } from "./site/home";
import { Layout } from "./site/layout";
import { GetPage, HowPage, NotFoundPage } from "./site/pages";
import { TrailBody } from "./site/trail";
import { adoptTrace } from "./trace/adopt";
import { createTrace, REFUSALS } from "./trace/create";
import { deepSearchesOut, freeRunsOff, paidRunsLeft } from "./trace/deep";
import { buildDocument } from "./trace/document";
import { deleteTraceFully, featuredTraces, getTrace, setFeatured, totals } from "./trace/store";

type AppContext = Context<{ Bindings: Env }>;

/** Begins the work for a new trace. The real one starts the Workflow. */
export type Starter = (env: Env, id: string) => Promise<void>;

const startWorkflow: Starter = async (env, id) => {
  await env.TRACE_WORKFLOW.create({ id, params: { traceId: id } });
};

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data:",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "content-type" };

/** Compares two strings without stopping at the first difference. */
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function isAdmin(c: AppContext): boolean {
  const given = (c.req.header("authorization") ?? "").replace(/^Bearer\s+/i, "");
  return c.env.ADMIN_TOKEN !== "" && same(given, c.env.ADMIN_TOKEN);
}

const visitor = (c: AppContext): string => c.req.header("cf-connecting-ip") ?? "unknown";

export function createApp(deps: { start?: Starter } = {}) {
  const start = deps.start ?? startWorkflow;
  const app = new Hono<{ Bindings: Env }>();

  /** A page is sent with a content security policy: files of this site and the two font hosts only, no inline script, no framing. */
  async function page(
    c: AppContext,
    props: { title: string; description: string; current?: "home" | "how" | "get"; refresh?: boolean; status?: ContentfulStatusCode },
    children: Child,
  ) {
    const body = (
      <Layout title={props.title} description={props.description} base={c.env.PUBLIC_BASE_URL} path={new URL(c.req.url).pathname} current={props.current} refresh={props.refresh} stats={await totals(c.env.DB)}>
        {children}
      </Layout>
    );
    return c.html(body as unknown as string, props.status ?? 200, {
      "cache-control": "no-store",
      "content-security-policy": CSP,
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
    });
  }

  const notFound = (c: AppContext) => page(c, { title: "No trail here · Upstream", description: "This address does not lead to a trail.", status: 404 }, <NotFoundPage />);

  // ---- the API ----

  app.options("/api/*", (c) => c.body(null, 204, CORS));

  app.post("/api/traces", async (c) => {
    let body: { page_url?: unknown; text?: unknown; near?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "bad_request", message: "Send JSON with page_url and text." }, 400, CORS);
    }
    const made = await createTrace(c.env, { pageUrl: body?.page_url, text: body?.text, near: body?.near }, visitor(c), new Date(), (id) => start(c.env, id));
    if (!made.ok) return c.json({ error: made.code, message: made.message }, made.status, CORS);
    const root = c.env.PUBLIC_BASE_URL.replace(/\/$/, "");
    return c.json({ id: made.id, url: `${root}/t/${made.id}`, api: `${root}/api/traces/${made.id}`, reused: made.reused }, made.reused ? 200 : 202, CORS);
  });

  app.get("/api/traces/:id", async (c) => {
    const doc = await buildDocument(c.env, c.req.param("id"));
    if (!doc) return c.json({ error: "not_found", message: "There is no trail with that id." }, 404, CORS);
    return c.json(doc, 200, { ...CORS, "cache-control": "no-store" });
  });

  app.get("/api/traces/:id/fragment", async (c) => {
    const doc = await buildDocument(c.env, c.req.param("id"));
    if (!doc) return c.text("There is no trail with that id.", 404, CORS);
    return c.html((<TrailBody doc={doc} panel={c.req.query("panel") === "1"} />) as unknown as string, 200, { ...CORS, "cache-control": "no-store", "x-content-type-options": "nosniff" });
  });

  app.get("/api/stats", async (c) => c.json(await totals(c.env.DB), 200, CORS));

  // ---- admin ----

  app.post("/api/admin/adopt", async (c) => {
    if (!isAdmin(c)) return c.json({ error: "forbidden", message: "This route needs the admin token." }, 403);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const made = await adoptTrace(c.env, { pageUrl: body.page_url, text: body.text, researchRunId: body.research_run_id, account: body.account }, new Date(), (id) => start(c.env, id));
    if (!made.ok) return c.json({ error: made.code, message: made.message, ...("id" in made && made.id ? { id: made.id } : {}) }, made.status);
    return c.json({ id: made.id, url: `${c.env.PUBLIC_BASE_URL.replace(/\/$/, "")}/t/${made.id}` }, 202);
  });

  app.post("/api/admin/traces/:id/feature", async (c) => {
    if (!isAdmin(c)) return c.json({ error: "forbidden", message: "This route needs the admin token." }, 403);
    const id = c.req.param("id");
    if (!(await getTrace(c.env.DB, id))) return c.json({ error: "not_found", message: "There is no trail with that id." }, 404);
    await setFeatured(c.env.DB, id, c.req.query("off") !== "1");
    return c.json({ id, featured: c.req.query("off") !== "1" });
  });

  app.delete("/api/admin/traces/:id", async (c) => {
    if (!isAdmin(c)) return c.json({ error: "forbidden", message: "This route needs the admin token." }, 403);
    await deleteTraceFully(c.env.DB, c.req.param("id"));
    return c.json({ deleted: c.req.param("id") });
  });

  // ---- the pages ----

  app.get("/", async (c) => {
    const code = c.req.query("note") ?? "";
    const note = Object.hasOwn(REFUSALS, code) ? REFUSALS[code as keyof typeof REFUSALS] : null;
    return page(
      c,
      { title: "Upstream: where did that number come from?", description: "Highlight a claim on any page and follow it back to where it first appeared, with every step read again.", current: "home" },
      <Home
        note={note}
        recent={await featuredTraces(c.env.DB, 12)}
        deepOut={await deepSearchesOut(c.env, new Date().toISOString().slice(0, 10))}
        paidLeft={(await freeRunsOff(c.env)) ? await paidRunsLeft(c.env) : null}
      />,
    );
  });

  app.post("/trace", async (c) => {
    const fields = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const made = await createTrace(c.env, { pageUrl: fields.url, text: fields.text }, visitor(c), new Date(), (id) => start(c.env, id));
    return c.redirect(made.ok ? `/t/${made.id}` : `/?note=${made.code}`, 303);
  });

  app.get("/t/:id", async (c) => {
    const doc = await buildDocument(c.env, c.req.param("id"));
    if (!doc) return notFound(c);
    return page(
      c,
      { title: `${doc.running ? "Tracing" : doc.verdictWords} · Upstream`, description: `“${doc.text}” traced back from ${doc.pageSite}.`, refresh: doc.running },
      <TrailBody doc={doc} panel={false} />,
    );
  });

  app.get("/how", (c) =>
    page(
      c,
      { title: "How Upstream works", description: "Three ways of looking and one rule: a source is shown only after its page has been read.", current: "how" },
      <HowPage reserveUsd={Number(c.env.PAID_DEEP_BUDGET_USD ?? "0") || 0} />,
    ),
  );

  app.get("/get", (c) => page(c, { title: "Get the Upstream extension", description: "Install the Chrome extension in a minute. No account, no key, no local server.", current: "get" }, <GetPage />));

  app.notFound((c) => (c.req.path.startsWith("/api/") ? c.json({ error: "not_found", message: "There is no such route." }, 404, CORS) : notFound(c)));

  return app;
}
