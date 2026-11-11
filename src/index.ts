import { Hono } from "hono";
import type { Env } from "./env";

export { TraceWorkflow } from "./trace/workflow";

const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", (c) => c.json({ ok: true }));

export default app;
