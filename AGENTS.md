# AGENTS.md — handoff for the next agent

Context for anyone (human or AI) picking this repo up cold. Read this before editing.
Last verified at commit `44da434`.

---

## What this is

A hiring assistant. Paste a job description → it parses into structured fields → sources
real candidates → an AI voice agent phones them and asks four screening questions →
answers come back as structured JSON on a dashboard, with the call recording.

Built for an assignment: Parts 1 and 2 of the brief are the same product (voice reachout
+ dashboard of responses), so they are one app. Part 3 is a written answer in the README.

**It is live and has placed real screening calls.** Seven calls across three terminal
states, two with full answer extraction.

---

## Status — read this before assuming anything

| Thing | State |
|---|---|
| Local dev | **Working** |
| Tests | **18 passing**, `npm test` |
| Typecheck / build | **Clean** |
| Supabase Postgres | **Working**, schema applied |
| Hunar integration | **Working**, real calls placed end to end |
| Sourcing — `mock` | Working |
| Sourcing — `searchapi` | **Working**, verified with 10 real LinkedIn profiles |
| Sourcing — `pdl` | Implemented, **never executed** (signup needs a corporate email) |
| Sourcing — `apollo` | Implemented, **never executed** (phones need a paid tier) |
| Vercel deployment | **Live**, HTTP 200 |
| Production `PEOPLE_PROVIDER` | ⚠️ **still `mock`** — the deployed demo shows sample candidates |
| Production `APP_URL` | ⚠️ **still wrong** — webhooks have never fired in production |
| App authentication | **None.** Deliberate. See "Deliberately not done". |

The two ⚠️ rows are the only things standing between this and a finished submission.
Both are Vercel environment variables plus a redeploy — no code change.

---

## Start here

```bash
npm install
cp .env.example .env.local     # fill in; see the table in README.md
npm run preflight              # verifies the Hunar key + agent resolve
npm run db:push                # applies schema.sql, idempotent
npm run dev
```

`npm run preflight` is the fastest way to tell whether the environment is sane. It
checks the API key, that `HUNAR_AGENT_ID` resolves to a real agent, and whether any
from-number can dial `+91`.

**Port note:** the developer's machine has something on 3000, so Next often lands on
3001. Read the actual port from the dev server output rather than assuming.

### Other scripts

| Command | Purpose |
|---|---|
| `npm run seed:agent` | Creates the Hunar screening agent, or reuses it by name. Prints `HUNAR_AGENT_ID`. |
| `npm run set-phone -- "<name>" +91XXXXXXXXXX` | Attaches a real number to one candidate on the **newest** job. Writes to the DB only, never the repo. |
| `npm test` | 18 unit tests, Node's built-in runner, no framework |

---

## Where things live

```
app/
  page.tsx                          job list (server component)
  job-form.tsx                      JD textarea (client)
  jobs/[id]/page.tsx                job detail (server)
  jobs/[id]/dashboard.tsx           candidate table + polling (client)
  api/jobs/route.ts                 POST — parse JD, create job
  api/jobs/[id]/source/route.ts     POST — run sourcing provider, bulk insert
  api/jobs/[id]/calls/route.ts      GET  — dashboard data + polling refresh
                                    POST — launch Hunar calls
  api/webhooks/hunar/[event]/       POST — 4 callback URLs, one handler
lib/
  db.ts              postgres.js client (lazy Proxy) + row types + candidateRows()
  hunar.ts           Hunar API client
  call-state.ts      normalizeStatus / isSettled / needsRefresh — shared server+client
  webhook-signature.ts  HMAC verification
  parse-jd.ts        Claude parser + keyword fallback
  people.ts          4 sourcing providers behind one switch
  http.ts            error message helper
scripts/             db-push, seed-agent, preflight, set-phone
schema.sql           whole schema, create-if-not-exists + idempotent alters
```

---

## Non-obvious things that will cost you hours

Each of these was a real bug. Do not "simplify" them away.

**1. Hunar returns call status as a human label.** `NOT_CONNECTED` can arrive as
`Not Connected`. Uppercasing alone leaves a space and fails the terminal check, so the
dashboard polls forever. `normalizeStatus()` collapses both spellings; it runs at the
**write** boundary so the DB only ever holds canonical values.

**2. `result` and `recording_url` arrive AFTER `COMPLETED`.** Measured 15+ seconds later
on a real call. Terminal status does **not** mean the payload is ready. `needsRefresh()`
keeps polling until it lands, bounded at 15 minutes so `NOT_CONNECTED` calls aren't
chased forever. `lib/call-state.ts`.

**3. Hunar prompt variables use SINGLE braces.** `{job_role}`, not `{{job_role}}`. The
double form is rejected with a 400 at agent creation.

**4. `listAgents()` must pass `?page_size=200`.** Server default is 10. The org has 16+
agents, so reuse-by-name silently misses and creates a duplicate agent every run.

**5. `to_jsonb(l.*)` over an unmatched LEFT JOIN** can yield an object of nulls rather
than SQL NULL — every call-less candidate then looks like it has a call. Guarded with
`case when l.id is null then null`. `lib/db.ts`.

**6. The DB client is a lazy Proxy on purpose.** `next build` loads every route module
without env vars; an eager connect fails the build.

**7. Mock candidate data is `import`ed, not read from disk.** Next.js does not trace
`fs` reads into the serverless bundle — a runtime read works locally and 404s on Vercel.

**8. Scripts run under `node --experimental-strip-types`.** That means: no TypeScript
constructor parameter properties, and relative imports inside `lib/` files that scripts
load **must carry the `.ts` extension**. Webpack tolerates extensionless; Node does not.

**9. The `call_summary` webhook carries no summary string.** It has `status`,
`recording_url`, `result` — nothing else. There is no summary column; `calls.webhook_events`
is the counter that proves callbacks arrived, incremented only by the webhook route.

**10. Webhook signatures are computed over the raw body.** The handler reads
`req.text()`, verifies, then parses. Parsing first and re-serialising produces different
bytes and the signature never matches.

**11. Candidates can have `phone = NULL`.** SERP-based sourcing finds real people with
no number. They're stored and shown but not callable — checkbox disabled, launch
endpoint returns 400. Postgres treats NULLs as distinct in a unique index, which is why
there's a **partial** unique on `(job_id, linkedin)` alongside `(job_id, phone)`.

---

## Deliberately not done

Do not "fix" these without asking — each is a considered trade-off, documented in the
README.

- **No authentication.** A reviewer needs to open the URL and use it. In production this
  is a password gate at minimum, because anyone with the link can spend Hunar credits.
- **No job queue.** Calls dispatch synchronously via `Promise.all`. Correct up to ~50
  candidates; a queue is the documented scale-up path.
- **No `POST /calls/bulk/`.** Per-candidate calls give per-candidate error attribution,
  which matters more at demo scale.
- **No rate limiting.** Known gap, documented.
- **No migration history.** `schema.sql` is idempotent create-and-alter. Right size for
  this project.
- **Mock provider is the default.** So the demo never depends on a third-party plan tier.

---

## Open items, with locations

| Priority | Item | Where |
|---|---|---|
| **BLOCKER** | Set `PEOPLE_PROVIDER=searchapi` in Vercel, redeploy | Vercel env vars |
| **BLOCKER** | Set `APP_URL` to the deployment origin, redeploy | Vercel env vars |
| MEDIUM | Dashboard GET fans out N Hunar requests per viewer — serverless timeout risk | `api/jobs/[id]/calls/route.ts` GET |
| MEDIUM | Prompt injection: JD text reaches the *spoken* call via the parsed `company` field | `lib/parse-jd.ts` |
| MEDIUM | Phone numbers and recording URLs are visible to any visitor | `lib/db.ts` `candidateRows()` |
| LOW | `message(err)` returns raw upstream errors to clients | `lib/http.ts` |
| LOW | No route-level or integration tests; all 18 are pure-function | `lib/*.test.ts` |

Vercel does **not** apply env var changes to an existing deployment. Always redeploy.

To confirm webhooks work after fixing `APP_URL`: launch a call, then
`select webhook_events from calls order by created_at desc limit 1`. Non-zero means the
callback path fired — polling cannot increment it.

---

## Rules for whoever works on this next

**Never commit secrets.** `.gitignore` covers `.env*` with an exception for
`.env.example`. Git history has been scanned clean — keep it that way.

**Never place a call to a number without confirming the recipient consented.** This
software dials real phones and costs real money. `npm run set-phone` writes to the
database precisely so a real number never enters the repo. Do not add real numbers to
`data/candidates.sample.json`.

**Verify against the live API, not from memory.** The Hunar OpenAPI document is at
`https://api.voice.hunar.ai/docs/external/openapi.json`. Several bugs in this project's
history came from assuming an API shape. Fetch and check.

**Run the full gate before committing:**

```bash
npm test && npx tsc --noEmit && npm run build
```

**If the README and the code disagree, the code is right** — fix the README.
