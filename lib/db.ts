import postgres from 'postgres';
import type { CallResult } from './hunar';

type Sql = ReturnType<typeof postgres>;

declare global {
  // Reused across hot reloads in dev so we don't leak a pool per compile.
  // eslint-disable-next-line no-var
  var __sql: Sql | undefined;
}

function connect(): Sql {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set. Copy .env.example to .env.local.');
  const client = postgres(url, {
    // Hosted Postgres (Supabase, Neon, Vercel) requires TLS; a local server usually has none.
    ssl: /localhost|127\.0\.0\.1/.test(url) ? false : 'require',
    // Serverless functions get one short-lived connection each; long pools are wasted there.
    max: 3,
    idle_timeout: 20,
  });
  globalThis.__sql = client;
  return client;
}

/**
 * Connects on first use, not on import — `next build` loads every route module
 * without env vars, and an eager connect fails the build.
 */
export const sql: Sql = new Proxy((() => undefined) as unknown as Sql, {
  apply: (_target, _thisArg, args: Parameters<Sql>) =>
    (globalThis.__sql ?? connect())(...args),
  get: (_target, prop) => Reflect.get(globalThis.__sql ?? connect(), prop),
});

export type Job = {
  id: string;
  title: string;
  company: string;
  location: string;
  seniority: string;
  skills: string[];
  raw_jd: string;
  created_at: Date;
};

export type Candidate = {
  id: string;
  job_id: string;
  name: string;
  title: string;
  company: string;
  location: string;
  /** Null when the sourcing provider found the profile but no number. */
  phone: string | null;
  linkedin: string | null;
};

export type Call = {
  id: string;
  candidate_id: string;
  status: string;
  result: CallResult | null;
  summary: string | null;
  recording_url: string | null;
  engagement_status: string | null;
  answered_by: string | null;
  duration_seconds: string | null;
  created_at: string;
  updated_at: Date;
};

/** A candidate joined to its most recent call. Powers the dashboard. */
export type CandidateRow = Candidate & {
  call: Call | null;
};

export async function candidateRows(jobId: string): Promise<CandidateRow[]> {
  const rows = await sql<(Candidate & { call: Call | null })[]>`
    select c.*,
           -- Guard the unmatched side explicitly: to_jsonb() over a whole-row
           -- reference from a LEFT JOIN can yield an object of nulls rather
           -- than SQL NULL, which would read as "this candidate has a call".
           case when l.id is null then null else to_jsonb(l.*) end as call
      from candidates c
      left join lateral (
        select * from calls
         where candidate_id = c.id
         order by created_at desc
         limit 1
      ) l on true
     where c.job_id = ${jobId}
     order by c.created_at
  `;
  return rows;
}
