-- Applied with `npm run db:push` (idempotent).

create table if not exists jobs (
  id          uuid primary key default gen_random_uuid(),
  title       text        not null,
  company     text        not null default '',
  location    text        not null default '',
  seniority   text        not null default '',
  skills      text[]      not null default '{}',
  raw_jd      text        not null,
  created_at  timestamptz not null default now()
);

create table if not exists candidates (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid        not null references jobs(id) on delete cascade,
  name        text        not null,
  title       text        not null default '',
  company     text        not null default '',
  location    text        not null default '',
  phone       text        not null,
  linkedin    text,
  created_at  timestamptz not null default now(),
  -- One row per candidate per job; lets sourcing re-run without duplicating.
  unique (job_id, phone)
);

create table if not exists calls (
  id                uuid primary key,          -- Hunar call id
  candidate_id      uuid        not null references candidates(id) on delete cascade,
  status            text        not null default 'NOT_STARTED',
  result            jsonb,
  summary           text,
  recording_url     text,
  engagement_status text,
  answered_by       text,
  duration_seconds  numeric,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists candidates_job_id_idx on candidates (job_id);
create index if not exists calls_candidate_id_idx on calls (candidate_id);

-- Sourcing providers differ in what they can return. A SERP-based search finds
-- real profiles but no phone number, so a candidate may exist without one; it
-- simply cannot be screened until a number is attached.
alter table candidates alter column phone drop not null;

-- Postgres treats NULLs as distinct in a unique index, so (job_id, phone) no
-- longer dedupes phoneless rows. LinkedIn URL is the stable identity for those.
create unique index if not exists candidates_job_linkedin_key
  on candidates (job_id, linkedin) where linkedin is not null;

-- The `call_summary` event carries no summary string (see Hunar's webhook
-- payload reference), so a populated summary column cannot be used as evidence
-- that callbacks arrived. This counter can: only the webhook route increments
-- it, so a non-zero value proves the webhook path fired rather than polling.
alter table calls add column if not exists webhook_events integer not null default 0;
alter table calls drop column if exists summary;

-- The dashboard's lateral join is `where candidate_id = ? order by created_at
-- desc limit 1`, so the sort column belongs in the index.
create index if not exists calls_candidate_created_idx on calls (candidate_id, created_at desc);
drop index if exists calls_candidate_id_idx;

-- Vestigial: the insert always supplies a company, so this default never fired
-- and 'Hunar.ai' was misleading in a schema dump.
alter table jobs alter column company set default '';
