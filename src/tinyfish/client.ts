// The one place every TinyFish call goes through. It adds the key for the chosen account
// and turns a refusal into a TinyFishError. A key is read here and nowhere else, and never
// appears in an error or a log.
import type { Env } from "../env";

/** `main` is the account everything runs on; `second` only lends its free research runs. */
export type Account = "main" | "second";

export class TinyFishError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(`TinyFish HTTP ${status} ${code}`);
    this.name = "TinyFishError";
    this.status = status;
    this.code = code;
  }
}

/** An error code is a short token. Anything longer could echo what was sent, so it is not kept. */
const CODE_SHAPE = /^[A-Za-z0-9_.-]{1,64}$/;

async function errorFrom(res: Response): Promise<TinyFishError> {
  let code: unknown;
  try {
    const body = JSON.parse(await res.text()) as { code?: unknown; error?: { code?: unknown } | string };
    code = typeof body.error === "object" && body.error !== null ? body.error.code : body.code;
  } catch {
    // not JSON: there is no code in it
  }
  return new TinyFishError(res.status, typeof code === "string" && CODE_SHAPE.test(code) ? code : `http_${res.status}`);
}

/** Reads a 2xx body as JSON; a body that is not JSON becomes a TinyFishError `bad_json`. */
export async function readJson<T = unknown>(res: Response): Promise<T> {
  try {
    return (await res.json()) as T;
  } catch {
    throw new TinyFishError(res.status, "bad_json");
  }
}

export async function tinyfishFetch(env: Env, account: Account, url: string, init: RequestInit = {}): Promise<Response> {
  const key = account === "main" ? env.TINYFISH_API_KEY : env.TINYFISH_API_KEY_2;
  if (!key) throw new TinyFishError(0, "no_key");
  const headers = new Headers(init.headers);
  headers.set("X-API-Key", key);
  headers.set("Content-Type", "application/json");
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) throw await errorFrom(res);
  return res;
}
