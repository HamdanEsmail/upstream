// The TinyFish wallet of one account. It is read before a free deep search starts and again
// after the trail is done: a fall of a run's price says the run was charged after all. Reading
// it costs nothing.
import type { Env } from "../env";
import { TinyFishError, readJson, tinyfishFetch, type Account } from "./client";

const WALLET_API = "https://agent.tinyfish.ai/v1/wallet";
/** `available_balance` is a decimal string such as "21.44"; negative when the wallet is overdrawn. */
const AMOUNT = /^-?(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/;

/**
 * What the account can spend, in US dollars. Anything but a dollar amount in the documented
 * shape is a TinyFishError `bad_wallet`, so a cost is never worked out from a guess.
 */
export async function readBalance(env: Env, account: Account): Promise<number> {
  const res = await tinyfishFetch(env, account, WALLET_API, { method: "GET" });
  const body = await readJson<{ available_balance?: unknown; currency?: unknown }>(res);
  const amount = typeof body.available_balance === "number" ? String(body.available_balance) : body.available_balance;
  if (typeof amount !== "string" || !AMOUNT.test(amount) || (body.currency !== undefined && body.currency !== "USD")) {
    throw new TinyFishError(502, "bad_wallet");
  }
  return Number(amount);
}
