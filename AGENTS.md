# AGENTS.md — handoff for the next agent

Context for anyone (human or AI) picking this repo up cold. Read this before editing.
Last verified at commit `44da434`.

---

## What this is

A hiring assistant. Paste a job description → it parses into structured fields → sources
real candidates → an AI voice agent screens them (in the browser via an interview link,
or by phone) with four questions → answers come back as structured JSON on a dashboard,
with the call recording.

Built for an assignment: Parts 1 and 2 of the brief are the same product (voice reachout
+ dashboard of responses), so they are one app. Part 3 is a written answer in the README.

**It is live and has placed real screening calls.** Seven calls across three terminal
states, two with full answer extraction.

---

## Status — read this before assuming anything

| Thing | State |
|---|---|
| Local dev | **Working** |
| Tests | **16 passing**, `npm test` |
| Typecheck / build | **Clean** |
| Supabase Postgres | **Working**, schema applied |
| Vapi integration | **Working**, real calls placed end to end |
| Browser interview links | **Working**, no phone or telephony cost |
| Sourcing — `mock` | Working |
| Sourcing — `searchapi` | **Working**, verified with 10 real LinkedIn profiles |
| Sourcing — `pdl` | Implemented, **never executed** (signup needs a corporate email) |
| Sourcing — `apollo` | Implemented, **never executed** (phones need a paid tier) |
| Vercel deployment | **Live**, HTTP 200 |
| Production `PEOPLE_PROVIDER` | ⚠️ **still `mock`** — the deployed demo shows sample candidates |
| Production `APP_URL` | ⚠️ **still wrong** — webhooks have never fired in production |
| App authentication | **None** — recruiter dashboard is public |

The two ⚠️ rows are the only things standing between this and a finished submission.
Both are Vercel environment variables plus a redeploy — no code change. The daily
`/api/health` cron keeps a free-tier database from pausing for inactivity.

---

## Start here

```bash
npm install
cp .env.example .env.local     # fill in; see the table in README.md
npm run preflight              # verifies the Vapi key + assistant resolve
npm run db:push                # applies schema.sql, idempotent
npm run dev
```

`npm run preflight` is the fastest way to tell whether the environment is sane. It
checks the private key, that `VAPI_ASSISTANT_ID` resolves to a real assistant, whether
the public key is set for interview links, and whether phone calling is configured.

**Port note:** the developer's machine has something on 3000, so Next often lands on
3001. Read the actual port from the dev server output rather than assuming.

### Other scripts

| Command | Purpose |
|---|---|
| `npm run seed:agent` | Creates the Vapi screening assistant, or updates it in place by name. Prints `VAPI_ASSISTANT_ID`. |
| `npm run set-phone -- "<name>" +91XXXXXXXXXX` | Attaches a real number to one candidate on the **newest** job. Writes to the DB only, never the repo. |
| `npm test` | 16 unit tests, Node's built-in runner, no framework |

---

## Where things live

```
app/
  page.tsx                          job list (server component)
  job-form.tsx                      JD textarea (client)
  jobs/[id]/page.tsx                job detail (server)
  jobs/[id]/dashboard.tsx           candidate table + polling (client)
  interview/[candidateId]/page.tsx  public browser interview (server)
  interview/[candidateId]/interview.tsx  @vapi-ai/web call UI (client)
  api/jobs/route.ts                 POST — parse JD, create job
  api/jobs/[id]/source/route.ts     POST — run sourcing provider, bulk insert
  api/jobs/[id]/calls/route.ts      GET  — dashboard data + polling refresh
                                    POST — launch optional phone calls
  api/jobs/[id]/candidates/route.ts POST — add a candidate (phone optional)
  api/interview/[candidateId]/call/ POST — register a browser-started web call
  api/webhooks/vapi/                POST — status-update / end-of-call-report
  api/health/                       GET  — DB keepalive (Vercel Cron)
lib/
  db.ts              postgres.js client (lazy Proxy) + row types + candidateRows()
  vapi.ts            Vapi API client + status mapping + spoken() sanitizer
  sync-call.ts       one call → DB writer, shared by polling and the webhook
  call-state.ts      normalizeStatus / isSettled / needsRefresh — shared server+client
  parse-jd.ts        Claude parser + keyword fallback
  people.ts          4 sourcing providers behind one switch
  http.ts            error message helper
scripts/             db-push, seed-agent, preflight, set-phone
schema.sql           whole schema, create-if-not-exists + idempotent alters
```

---

## Non-obvious things that will cost you hours

Each of these was a real bug. Do not "simplify" them away.

**1. `result` and `recording_url` arrive AFTER `COMPLETED`.** Measured 15+ seconds later
on a real call. Terminal status does **not** mean the payload is ready. `needsRefresh()`
keeps polling until it lands, bounded at 15 minutes so `NOT_CONNECTED` calls aren't
chased forever. `lib/call-state.ts`.

**2. `to_jsonb(l.*)` over an unmatched LEFT JOIN** can yield an object of nulls rather
than SQL NULL — every call-less candidate then looks like it has a call. Guarded with
`case when l.id is null then null`. `lib/db.ts`.

**3. The DB client is a lazy Proxy on purpose.** `next build` loads every route module
without env vars; an eager connect fails the build.

**4. Mock candidate data is `import`ed, not read from disk.** Next.js does not trace
`fs` reads into the serverless bundle — a runtime read works locally and 404s on Vercel.

**5. Scripts run under `node --experimental-strip-types`.** That means: no TypeScript
constructor parameter properties, and relative imports inside `lib/` files that scripts
load **must carry the `.ts` extension**. Webpack tolerates extensionless; Node does not.

**6. Candidates can have `phone = NULL`.** SERP-based sourcing finds real people with
no number. They're stored and shown and screened via their interview link; only the
phone-call checkbox is disabled, and the phone launch endpoint returns 400 for them.
Postgres treats NULLs as distinct in a unique index, which is why there's a **partial**
unique on `(job_id, linkedin)` alongside `(job_id, phone)`.

**7. Vapi web calls are registered by the browser via `/api/interview/:id/call`, and
the server re-verifies them with `GET /call/{id}`.** The endpoint is public, so it
checks that the call exists on Vapi, runs our assistant, and carries this candidate's
id in `assistantOverrides.variableValues`. `calls.webhook_events` is incremented only by
the webhook route, so a non-zero value proves callbacks arrived.

---

## Deliberately not done

Do not "fix" these without asking — each is a considered trade-off, documented in the
README.

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
| MEDIUM | Dashboard GET fans out N Vapi requests per viewer — serverless timeout risk | `api/jobs/[id]/calls/route.ts` GET |
| LOW | `message(err)` returns raw upstream errors to clients | `lib/http.ts` |
| LOW | No route-level or integration tests; all 16 are pure-function | `lib/*.test.ts` |

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

**Verify against the live API, not from memory.** The Vapi API reference is at
`https://docs.vapi.ai/api-reference`. Several bugs in this project's history came from
assuming an API shape. Fetch and check.

**Run the full gate before committing:**

```bash
npm test && npx tsc --noEmit && npm run build
```

**If the README and the code disagree, the code is right** — fix the README.
