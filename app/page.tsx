import Link from 'next/link';
import { sql, type Job } from '@/lib/db';
import { JobForm } from './job-form';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const jobs = await sql<(Job & { candidate_count: number })[]>`
    select j.*, count(c.id)::int as candidate_count
      from jobs j
      left join candidates c on c.job_id = j.id
     group by j.id
     order by j.created_at desc
     limit 20
  `;

  return (
    <main className="space-y-12">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">Start from a job description</h1>
        <p className="mt-1 mb-6 text-sm text-muted">
          Paste the JD. We parse the role, source candidates with phone numbers, and screen them
          with an AI voice call.
        </p>
        <JobForm />
      </section>

      <section>
        <h2 className="mb-4 text-sm font-medium tracking-wide text-muted uppercase">Recent jobs</h2>
        {jobs.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line px-4 py-8 text-center text-sm text-muted">
            No jobs yet.
          </p>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
            {jobs.map((job) => (
              <li key={job.id}>
                <Link
                  href={`/jobs/${job.id}`}
                  className="flex items-center justify-between gap-4 bg-panel px-4 py-3.5 transition-colors hover:bg-line/50"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{job.title}</span>
                    <span className="block truncate text-xs text-muted">
                      {[job.seniority, job.location].filter(Boolean).join(' · ') || 'No location'}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-muted">
                    {job.candidate_count} candidate{job.candidate_count === 1 ? '' : 's'}
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
