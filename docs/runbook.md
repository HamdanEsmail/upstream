# Runbook

How I deploy Upstream, look after it, and curate what the first page shows.

## Deploy

One time:

```bash
npx wrangler d1 create upstream          # put the id it prints into wrangler.jsonc
npx wrangler d1 migrations apply upstream --remote
npx wrangler deploy
npx wrangler secret put TINYFISH_API_KEY
npx wrangler secret put TINYFISH_API_KEY_2   # optional: a second account, used only for free research runs while TinyFish gave them
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
| `PAID_DEEP_BUDGET_USD` | `wrangler.jsonc` vars | The most that may ever be spent on deep searches, in dollars. A run costs $2, so `8` allows four in all. A run that was started as a free one and then charged counts in it. With `0`, no deep search is started once a run has been charged. |
| `TINYFISH_API_KEY` | secret | The account everything runs on. |
| `TINYFISH_API_KEY_2` | secret, optional | A second account. Only its free research runs were ever used. Since a run was charged on 12 November 2026 it is no longer called. |
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

TinyFish charges $2 for a research run. On the live service every deep search is paid from the reserve:

1. A paid run, while the reserve has room: `PAID_DEEP_BUDGET_USD` divided by 2, less the runs counted under `research:paid` in the `limits` table. The first page says how many are left.
2. Otherwise none: the trace follows links and searches for the sentence, both free, and says the money set aside is used up. The first page says so before anyone starts a trace.

How it came to this. Until 11 November 2026 TinyFish gave two research runs a day free on an account, and Upstream used those first. On a database where no run has been charged, the code still starts that way:

1. A free run on the main account, while fewer than two were made there today.
2. A free run on the second account, on the same rule.
3. A paid run from the reserve, while the reserve has room. Only when both accounts answered that their free runs are used.
4. Otherwise none: the trace follows links and searches for the sentence, and says the deep search is back at midnight UTC.

"Today" is the UTC day. Runs made outside Upstream on the same accounts count: Upstream asks TinyFish how many runs each account made today before it takes a free one.

A run started as a free one is checked against the wallet. The account's balance is read just before the run (`wallet_before` on the trace) and again ten minutes after the trail is done (`wallet_after`):

- A fall of $2 or more: the run was charged. It is booked at $2, never more, because my other projects spend from the same wallets. It takes a place in the reserve, even when the reserve has no room, so a reserve raised later pays for one run fewer. The mark `research:charged` is set. While that mark is set no run is called free: rule 3 is the only one left.
- A smaller fall, or none: the run was free.
- A wallet that could not be read, or that went up because I topped it up: booked at $2 to be safe. The mark is not set.

If the wallet cannot be read before a run, no free run is started on that account.

That check is what found TinyFish's change. On 12 November 2026 the first run of the day on the main account (trace `4emqnht65u`, started 03:04 UTC) was followed by a fall of $2.01 in the wallet. The $2 arrived between two and five minutes after the trail was done. The run was booked at $2 and the mark has been set since.

To see what has been spent: `GET /api/stats`, or the footer of any page.

## When something looks wrong

| What I see | What it means | What I do |
|---|---|---|
| A trail says "Not settled" and "the deep search did not run" | The reserve pays for no more. On a database where runs are still thought free: the day's free runs and the reserve were used, or the count could not be read. | Raise `PAID_DEEP_BUDGET_USD` and deploy, if more deep searches are wanted. Tracing the sentence again on a later day clears the shallow trail and starts afresh. To do it the same day, delete the trail first. |
| The first page says "The money set aside for deep searches is used up" | A run has been charged, and the reserve pays for no more. | The same: raise the reserve, or leave it. |
| A trail's log says a run started as a free one was charged | That run was followed by a fall of $2 or more in the account's wallet. | Compare `wallet_before` and `wallet_after` on that trace with what else I spent from that wallet in those minutes. If TinyFish did charge the run, leave it: the reserve decides from here. If the fall was my own other spending, clear the mark with the command below. |
| A step says "the page could not be processed" | Reading or matching that page failed three times. The trail carried on without it. | Open the page by hand. Very large PDFs are the usual cause. |
| A trail page says "This trace broke" | A step outside reading failed after its retries. | Trace the same sentence again; a broken trace is cleared and started afresh. Then read the Worker's logs. |
| `429 daily_limit` | 40 new traces today, or fewer than 40 page reads left of the day's 500. | Wait for midnight UTC. |
| The side panel says "Could not reach Upstream" | The service did not answer. | Check `GET /api/health`. |

To switch free runs back on, only after checking that the run was not charged:

```bash
npx wrangler d1 execute upstream --remote --command "DELETE FROM limits WHERE day = 'all' AND name = 'research:charged'"
```

The $2 that was booked stays on the books. TinyFish's price list has shown no free research runs since 12 November 2026, so on the live service there is no reason to run this.

Logs: `npx wrangler tail upstream`. A Workflow's steps: the Cloudflare dashboard, Workers, Workflows, `upstream-trace`.

A trace is carried by several Workflow runs, one after another, because the free plan allows one run 50 requests to other hosts. Their ids are built from the trace's id:

| Run id | What it does |
|---|---|
| `<trace>` | Reads the page, follows links, starts the deep search. A trace with no deep search ends here. |
| `<trace>-wait-0`, `-wait-40`, `-wait-80` | Reads the deep search every 15 seconds, 40 times each. |
| `<trace>-check-0`, `-check-8` | Checks the steps the deep search proposed, eight each, then finishes the trail. |
| `<trace>-book` | Ten minutes after the trail is done, reads the wallet and books the deep search. It also runs when the trace broke after its deep search had started. |
