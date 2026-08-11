import Link from 'next/link';
import { sql, type Job } from '@/lib/db';
import { JobForm } from './job-form';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const jobs = await sql<(Job & { candidate_count: number; call_count: number })[]>`
    select j.*,
           count(distinct c.id)::int  as candidate_count,
           count(distinct cl.id)::int as call_count
      from jobs j
      left join candidates c on c.job_id = j.id
      left join calls cl on cl.candidate_id = c.id
     group by j.id
     order by j.created_at desc
     limit 20
  `;

  return (
    <main className="space-y-16">
      <section>
        <h1 className="max-w-3xl font-display text-4xl leading-[1.05] font-extrabold tracking-tight text-balance sm:text-6xl">
          Paste a job description.
          <br />
          <span className="text-dial">We&apos;ll ring the candidates.</span>
        </h1>
        <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-mute">
          It reads the role, finds people who match, then an AI voice agent calls them and asks
          the four questions you&apos;d ask on a first call. Answers land here.
        </p>

        <div className="mt-8">
          <JobForm />
        </div>
      </section>

      <section>
        <div className="mb-4 flex items-baseline justify-between gap-4 border-b-2 border-ink pb-2">
          <h2 className="font-display text-lg font-extrabold tracking-tight">Your jobs</h2>
          <span className="font-mono text-[11px] tracking-widest text-mute uppercase">
            {jobs.length} open
          </span>
        </div>

        {jobs.length === 0 ? (
          <p className="border-2 border-dashed border-edge px-4 py-12 text-center text-sm text-mute">
            Nothing yet. Paste a description above to start.
          </p>
        ) : (
          <ul className="space-y-2">
            {jobs.map((job) => (
              <li key={job.id}>
                <Link
                  href={`/jobs/${job.id}`}
                  className="group flex items-center justify-between gap-4 border-2 border-ink bg-card px-4 py-3.5 transition-transform hover:-translate-y-0.5"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-display text-base font-semibold tracking-tight">
                      {job.title}
                    </span>
                    <span className="mt-0.5 block truncate font-mono text-[11px] tracking-wider text-mute uppercase">
                      {[job.seniority, job.location].filter(Boolean).join(' · ') || 'no location'}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-4 font-mono text-[11px] tracking-wider text-mute uppercase">
                    <span>
                      <span className="mr-1 text-base font-semibold text-ink">
                        {job.candidate_count}
                      </span>
                      found
                    </span>
                    <span>
                      <span className="mr-1 text-base font-semibold text-ink">{job.call_count}</span>
                      called
                    </span>
                    <span aria-hidden className="text-dial transition-transform group-hover:translate-x-0.5">
                      →
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
