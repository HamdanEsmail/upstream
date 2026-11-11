# Runbook

How I deploy Upstream, look after it, and curate what the first page shows.

## Deploy

One time:

```bash
npx wrangler d1 create upstream          # put the id it prints into wrangler.jsonc
npx wrangler d1 migrations apply upstream --remote
npx wrangler deploy
npx wrangler secret put TINYFISH_API_KEY
npx wrangler secret put TINYFISH_API_KEY_2   # optional: a second account that lends its free research runs
npx wrangler secret put ADMIN_TOKEN          # a long random string
```

Every time after:

```bash
npm run extension    # only if public/assets/line.css or extension/ changed
npm run check
npx wrangler d1 migrations apply upstream --remote   # only if migrations/ has a new file; before the deploy
npx wrangler deploy
```

The address the Worker is deployed at must be the one in `wrangler.jsonc` (`PUBLIC_BASE_URL`), `extension/config.js` and `extension/manifest.json`. A test fails if the three disagree.

## Settings

| Setting | Where | Meaning |
|---|---|---|
| `PUBLIC_BASE_URL` | `wrangler.jsonc` vars | The address trail links are built from. |
| `PAID_DEEP_BUDGET_USD` | `wrangler.jsonc` vars | The most that may ever be spent on paid deep searches, in dollars. `0` means free runs only. A run costs $2, so `6` allows three. |
| `TINYFISH_API_KEY` | secret | The account everything runs on. |
| `TINYFISH_API_KEY_2` | secret, optional | A second account. Only its free research runs are used. |
| `ADMIN_TOKEN` | secret | For the admin routes below. |

The fixed limits (traces per visitor and per day, pages read per day, how deep links are followed) are in `src/core/limits.ts`.

## Admin routes

All take `Authorization: Bearer <ADMIN_TOKEN>`.

```bash
# Build a trail from a research run that already finished (free, and listed on the first page)
curl -X POST "$BASE/api/admin/adopt" -H "authorization: Bearer $ADMIN_TOKEN" -H "content-type: application/json" \
  -d '{"page_url":"https://example.org/article","text":"The sentence as the page states it.","research_run_id":"<run id>","account":"main"}'

# List a trail on the first page, or take it off with ?off=1
curl -X POST "$BASE/api/admin/traces/<id>/feature" -H "authorization: Bearer $ADMIN_TOKEN"

# Remove a trail and everything it holds
curl -X DELETE "$BASE/api/admin/traces/<id>" -H "authorization: Bearer $ADMIN_TOKEN"
```

A visitor's own trace is never listed on the first page. It is reachable by its link.

## What a deep search costs, and when

1. A free run on the main account, while fewer than two were made there today.
2. A free run on the second account, on the same rule.
3. A paid run from the reserve, while the reserve has room. Only when both accounts answered that their free runs are used.
4. Otherwise none: the trace follows links only and says the deep search is back at midnight UTC.

"Today" is the UTC day. Runs made outside Upstream on the same accounts count: Upstream asks TinyFish how many runs each account made today before it takes a free one.

A free run is checked against the wallet. The account's balance is read just before the run (`wallet_before` on the trace) and again ten minutes after the trail is done (`wallet_after`):

- A fall of $2 or more: the run was charged. It is booked at $2, never more, because my other projects spend from the same wallets. It takes a place in the reserve, even when the reserve has no room, so a reserve raised later pays for one run fewer. The mark `research:charged` is set. While that mark is set no run is called free: rule 3 is the only one left.
- A smaller fall, or none: the run was free.
- A wallet that could not be read, or that went up because I topped it up: booked at $2 to be safe. The mark is not set.

If the wallet cannot be read before a run, no free run is started on that account.

To see what has been spent: `GET /api/stats`, or the footer of any page.

## When something looks wrong

| What I see | What it means | What I do |
|---|---|---|
| A trail says "Not settled" and "the deep search did not run" | The free runs and the reserve were used, or the count could not be read. | Nothing; it is back at midnight UTC. Tracing the sentence again on a later day clears the shallow trail and starts afresh. To do it the same day, delete the trail first. |
| The first page says "Deep searches are switched off for now", or a trail's log says a free run was charged | A run started as a free one was followed by a fall of $2 or more in that account's wallet. | Compare `wallet_before` and `wallet_after` on that trace with what else I spent from that wallet in those minutes. If TinyFish did charge the run, leave it: the reserve decides from here. If the fall was my own other spending, switch free runs back on with the command below. |
| A step says "the page could not be processed" | Reading or matching that page failed three times. The trail carried on without it. | Open the page by hand. Very large PDFs are the usual cause. |
| A trail page says "This trace broke" | A step outside reading failed after its retries. | Trace the same sentence again; a broken trace is cleared and started afresh. Then read the Worker's logs. |
| `429 daily_limit` | 40 new traces today, or fewer than 40 page reads left of the day's 500. | Wait for midnight UTC. |
| The side panel says "Could not reach Upstream" | The service did not answer. | Check `GET /api/health`. |

To switch free runs back on, only after checking that the run was not charged:

```bash
npx wrangler d1 execute upstream --remote --command "DELETE FROM limits WHERE day = 'all' AND name = 'research:charged'"
```

The $2 that was booked stays on the books.

Logs: `npx wrangler tail upstream`. A Workflow's steps: the Cloudflare dashboard, Workers, Workflows, `upstream-trace`.

A trace is carried by several Workflow runs, one after another, because the free plan allows one run 50 requests to other hosts. Their ids are built from the trace's id:

| Run id | What it does |
|---|---|
| `<trace>` | Reads the page, follows links, starts the deep search. A trace with no deep search ends here. |
| `<trace>-wait-0`, `-wait-40`, `-wait-80` | Reads the deep search every 15 seconds, 40 times each. |
| `<trace>-check-0`, `-check-8` | Checks the steps the deep search proposed, eight each, then finishes the trail. |
| `<trace>-book` | Ten minutes after the trail is done, reads the wallet and books the deep search. It also runs when the trace broke after its deep search had started. |
