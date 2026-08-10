# AI Hiring Assistant

Paste a job description → source candidates with phone numbers → screen them with a
[Hunar.ai](https://api.voice.hunar.ai/docs/external/) voice agent → read the answers,
recordings, and engagement on a dashboard.

Built as one app because Parts 1 and 2 of the assignment are the same product: an
AI-driven candidate reachout with a dashboard of responses. Part 3 is answered
[below](#part-3--tracking-attendance-for-1000-people-across-100-locations-without-smartphones).

---

## Architecture

```mermaid
flowchart LR
  U[Recruiter] -->|paste JD| A["/api/jobs"]
  A -->|Claude, or keyword fallback| P[parse-jd]
  A --> DB[(Postgres)]

  U -->|Source candidates| S["/api/jobs/:id/source"]
  S --> PS{PEOPLE_PROVIDER}
  PS -->|apollo| AP[Apollo.io people search]
  PS -->|mock| MK[candidates.sample.json]
  S --> DB

  U -->|Screen selected| C["/api/jobs/:id/calls"]
  C -->|POST /external/v1/calls/| H[Hunar Voice AI]
  H -->|dials| CAND[Candidate phone]
  H -->|status / result / recording / summary| W["/api/webhooks/hunar/:event"]
  W --> DB
  C -.->|polling fallback when APP_URL is not public| H
  DB --> D[Dashboard]
```

**Why both webhooks and polling.** Hunar posts results to `callback_config` URLs, which
needs a public HTTPS origin. On `localhost` there is nothing to post to, so
`GET /api/jobs/:id/calls` re-reads any in-flight call straight from Hunar before
returning. The dashboard works identically either way; it just tells you which mode
it is in.

### Data model

| Table | Purpose |
|---|---|
| `jobs` | Raw JD plus the parsed `title`, `company`, `location`, `seniority`, `skills[]` |
| `candidates` | Sourced people, unique on `(job_id, phone)` so re-sourcing is idempotent |
| `calls` | One row per Hunar call, keyed by Hunar's call id; holds status, extracted `result` JSON, recording URL, engagement, duration |

---

## Setup

```bash
npm install
cp .env.example .env.local     # then fill it in — see the table below
npm run preflight              # verifies the Hunar key and that a from-number can dial +91
npm run db:push                # applies schema.sql (idempotent)
npm run seed:agent             # prints HUNAR_AGENT_ID; paste it into .env.local
npm run preflight              # re-run: also confirms HUNAR_AGENT_ID resolves
npm run dev
```

Run `preflight` first. `POST /external/v1/calls/` returns a `400` if the org has no
validated from-number whose `allowed_countries` includes `IN`, and that failure looks
identical to a code bug from the dashboard.

Open http://localhost:3000.

With `PEOPLE_PROVIDER=mock` (the default) and no `ANTHROPIC_API_KEY`, the only paid
key you need is `HUNAR_API_KEY`.

### Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string. Supabase: use the **Session pooler** URI with `?sslmode=require`. |
| `HUNAR_API_KEY` | yes | Sent as the `X-API-Key` header on every Hunar request. |
| `HUNAR_AGENT_ID` | yes | Produced by `npm run seed:agent`. |
| `APP_URL` | for webhooks | Public HTTPS origin Hunar calls back. Leave as `http://localhost:3000` locally and the polling fallback takes over. |
| `WEBHOOK_TOKEN` | for webhooks | Shared secret appended as `?token=…` to every callback URL; the webhook route rejects anything else. Generate with `openssl rand -hex 24`. |
| `PEOPLE_PROVIDER` | no | `mock` (default) or `apollo`. |
| `APOLLO_API_KEY` | only for `apollo` | Apollo.io key. Phone numbers come back only on plans with phone reveal enabled; candidates without a number are dropped. |
| `ANTHROPIC_API_KEY` | no | Enables Claude-based JD parsing. Without it, parsing falls back to keyword extraction. |

`.env.local` is gitignored. No key is ever committed or logged.

### Receiving webhooks locally

```bash
ngrok http 3000
```

Put the `https://…ngrok…` URL in `APP_URL`, restart `npm run dev`, and calls launched
from then on will carry live callback URLs.

---

## Hunar integration

Everything below was verified against the live OpenAPI document at
`https://api.voice.hunar.ai/docs/external/openapi.json`.

- **Auth** — `X-API-Key: $HUNAR_API_KEY` on every request.
- **Agent** (`POST /external/v1/agents/`) — created once by `scripts/seed-agent.ts`,
  or reused if an agent with the same name already exists. Persona `NEHA`, language
  `ENGLISH`. Its `result_schema` extracts `interested`, `notice_period`,
  `expected_ctc`, `availability`, and `summary`.
- **Call** (`POST /external/v1/calls/`) — `callee_name`, `mobile_number` (E.164),
  `agent_id`, `timezone: Asia/Kolkata`, plus `custom_data` carrying `job_role`,
  `company`, and `location` into the agent's prompt variables.
- **Detail** (`GET /external/v1/calls/{call_id}/`) — the polling fallback and the
  source of truth after every webhook.
- **Statuses** — `NOT_STARTED`, `SCHEDULED`, `INITIATED`, `RINGING`, `IN_PROGRESS`,
  `COMPLETED`, `NOT_CONNECTED`, `CANCELLED`, `FAILED`. The last four are terminal, so
  the dashboard stops polling once every call reaches one.

The webhook route uses the callback payload only to identify the call, then re-reads
the record from Hunar. That way one handler covers all four callback shapes, and a
malformed or partial payload cannot corrupt a row.

---

## Deploying to Vercel

1. Push the repo to GitHub and import it in Vercel.
2. Add every variable from the table above as a Vercel environment variable, with
   `APP_URL` set to your deployment's own `https://` origin.
3. Deploy, then run `npm run db:push` locally against the same `DATABASE_URL` (the
   schema is not applied automatically).
4. Launch one call to your own number and watch the row settle on the dashboard.

---

## Tests

```bash
npm test
```

Covers the no-LLM job-description parser, which is the path the demo runs on.

---

## Part 3 — Tracking attendance for 1000 people across 100 locations without smartphones

> *If there were no smartphones but LLMs exist, how would an HR track attendance of
> 1000 people across 100 locations daily?*

**Answer: don't build an app — build a phone call.** Every one of those 100 locations
already has a working phone: a landline, a feature phone, or a shared handset. Voice is
the one interface that needs no smartphone, no data plan, no literacy assumption, and no
device rollout. An LLM voice agent — exactly what the Hunar API in this repo provides —
turns that phone into the attendance terminal.

**How it works**

1. **Register locations, not devices.** Each site has one registered phone number and a
   supervisor. Each worker has a short PIN, issued once on paper.
2. **The system calls out, on a schedule.** At the start of each shift the platform
   places an outbound call to each site — 100 calls, fanned out in parallel, the same
   bulk-dispatch shape as `POST /external/v1/calls/bulk/`. Outbound beats inbound: it
   removes "the supervisor forgot to call in" as a failure mode, and it timestamps
   itself.
3. **The agent takes a verbal roll-call.** It reads the roster for that site and the
   supervisor answers down the list. Because it is an LLM and not a DTMF tree, it
   handles "Ramesh is here but Sunita's on leave today, and we've got a new fellow
   called Imran" in one breath, in the local language, without a menu.
4. **Identity is confirmed by PIN, not by voice.** For any worker where presence is
   disputed or the site is high-risk, the agent asks that worker to come to the phone
   and speak their PIN. This is the anti-fraud control: a supervisor can claim a name,
   but cannot produce someone else's PIN on demand.
5. **Structured extraction, not a transcript.** The agent's result schema is the
   attendance record — `{ present: [], absent: [], on_leave: [], new: [], headcount }`.
   That is a database row, not prose. Same mechanism this app uses to pull notice
   period and expected CTC out of a screening call.
6. **Reconcile and escalate.** The platform compares reported headcount against the
   roster. Sites that don't answer, whose numbers don't add up, or whose PIN checks
   fail get flagged and re-dialled; only those exceptions reach a human. HR sees one
   dashboard of 100 sites, not 1000 individual pings.

**Why this holds up at 1000×100 scale.** The daily work is 100 calls of two to three
minutes each, which is a few hours of parallel machine time and zero hours of human
time. Cost scales with sites, not with headcount, so adding workers to a site is free.
The only hardware requirement is a phone that already exists at every location.

**Where it is weak, and the mitigation.** Proxy attendance is the real risk — a
supervisor answering for absent workers. PIN-on-demand raises the cost of that, and
random spot-checks (the agent asks for two randomly chosen workers to verify in person
each day) raise it further, but voice alone cannot fully prove physical presence.
Where the stakes justify it, pair the call with something cheap and physical: a rotating
code written on a whiteboard at the site, or a per-shift code the agent reads out and
requires back on the next call. Poor line quality and code-switching between languages
are the other practical failure modes; both are handled by re-dial plus routing
unresolved sites to a human, which is why the reconciliation step exists.

---

## Notes and known limits

- Apollo's people search returns phone numbers only on plans with phone reveal enabled.
  Candidates without a reachable number are filtered out rather than saved unreachable,
  so a search can legitimately return zero rows; the mock provider is there so the demo
  never depends on that.
- Call summaries arrive only via the `summary` webhook — they are not on Hunar's
  call-detail response — so on a localhost-only run the summary column stays empty
  while every other field fills in from polling.
- `npm run db:push` applies `schema.sql` directly. There is no migration history; for a
  demo-scale app that is the right amount of machinery.
