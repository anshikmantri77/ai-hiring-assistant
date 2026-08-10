-- Applied with `npm run db:push` (idempotent).

create table if not exists jobs (
  id          uuid primary key default gen_random_uuid(),
  title       text        not null,
  company     text        not null default 'Hunar.ai',
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
