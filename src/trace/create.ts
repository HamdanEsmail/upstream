// Starting a trace: check the request, reuse a trail that already exists, keep to the limits.
import { NEAR_MAX, TEXT_MAX, TEXT_MIN, TRACES_PER_DAY, TRACES_PER_VISITOR_PER_HOUR } from "../core/limits";
import { normalise } from "../core/text";
import { addressKey } from "../core/trail";
import type { Env } from "../env";
import { deleteTrace, deleteTraceFully, findTraceByKey, giveBack, insertTrace, takeSlot } from "./store";

export type CreateInput = { pageUrl: unknown; text: unknown; near?: unknown };

export type CreateResult =
  | { ok: true; id: string; reused: boolean }
  | { ok: false; status: 400 | 429 | 503; code: string; message: string };

export const REFUSALS = {
  text_too_short: `Highlight at least ${TEXT_MIN} characters. A whole sentence works best.`,
  text_too_long: `Highlight at most ${TEXT_MAX} characters: one or two sentences.`,
  bad_address: "That is not the address of a public web page.",
  too_many_traces: `You have started ${TRACES_PER_VISITOR_PER_HOUR} traces in the last hour. Try again in a while.`,
  daily_limit: "Upstream has reached today's limit for new traces. It opens again at midnight UTC.",
  could_not_start: "The trace could not be started. Try again.",
} as const;

const refuse = (status: 400 | 429 | 503, code: keyof typeof REFUSALS): CreateResult => ({ ok: false, status, code, message: REFUSALS[code] });

/** A page anyone can open: http or https, a real domain name, not this machine or a private network. */
function publicPage(v: unknown): string | null {
  if (typeof v !== "string") return null;
  let u: URL;
  try {
    u = new URL(v.trim());
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (!host.includes(".") || host.includes(":") || /^\d+(?:\.\d+){3}$/.test(host)) return null;
  if (host === "localhost" || /\.(?:local|localhost|internal|test|invalid)$/.test(host)) return null;
  return u.href;
}

function webLinks(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== "string" || item.length > 2000 || !/^https?:\/\//i.test(item)) continue;
    try {
      new URL(item);
      out.push(item);
    } catch {
      // not an address
    }
    if (out.length >= NEAR_MAX) break;
  }
  return out;
}

async function sha256(s: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

function newId(): string {
  return [...crypto.getRandomValues(new Uint8Array(10))].map((b) => ALPHABET[b % ALPHABET.length]).join("");
}

/**
 * `visitor` is whatever tells one visitor from another (the connecting address); only a
 * hash of it is kept, as the name of an hourly counter. `start` begins the work for a new id.
 */
export async function createTrace(
  env: Env,
  input: CreateInput,
  visitor: string,
  now: Date,
  start: (id: string) => Promise<void>,
  options: { limits?: boolean } = {},
): Promise<CreateResult> {
  const limited = options.limits !== false;
  const text = typeof input.text === "string" ? input.text.replace(/\s+/g, " ").trim() : "";
  if (text.length < TEXT_MIN) return refuse(400, "text_too_short");
  if (text.length > TEXT_MAX) return refuse(400, "text_too_long");
  const pageUrl = publicPage(input.pageUrl);
  const pageKey = pageUrl === null ? null : addressKey(pageUrl);
  if (pageUrl === null || pageKey === null) return refuse(400, "bad_address");

  const textKey = await sha256(`${pageKey}\n${normalise(text).replace(/^["'\s]+|["'\s]+$/g, "")}`);
  const existing = await findTraceByKey(env.DB, textKey);
  // A trace that broke is cleared away, so the same claim can be traced again.
  if (existing && existing.status === "failed") await deleteTraceFully(env.DB, existing.id);
  else if (existing) return { ok: true, id: existing.id, reused: true };

  const stamp = now.toISOString();
  const day = stamp.slice(0, 10);
  const visitorSlot = `visitor:${(await sha256(visitor)).slice(0, 16)}:${stamp.slice(11, 13)}`;
  if (limited) {
    if (!(await takeSlot(env.DB, day, visitorSlot, TRACES_PER_VISITOR_PER_HOUR))) return refuse(429, "too_many_traces");
    if (!(await takeSlot(env.DB, day, "traces", TRACES_PER_DAY))) {
      await giveBack(env.DB, day, visitorSlot);
      return refuse(429, "daily_limit");
    }
  }

  const id = newId();
  await insertTrace(env.DB, { id, pageUrl, text, textKey, near: webLinks(input.near), now: stamp });
  try {
    await start(id);
  } catch {
    await deleteTrace(env.DB, id);
    if (limited) {
      await giveBack(env.DB, day, visitorSlot);
      await giveBack(env.DB, day, "traces");
    }
    return refuse(503, "could_not_start");
  }
  return { ok: true, id, reused: false };
}
