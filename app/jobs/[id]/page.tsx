import { notFound } from 'next/navigation';
import { sql, candidateRows, type Job } from '@/lib/db';
import { Dashboard } from './dashboard';

export const dynamic = 'force-dynamic';

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [job] = await sql<Job[]>`select * from jobs where id = ${id}`;
  if (!job) notFound();

  const candidates = await candidateRows(id);

  return (
    <main className="space-y-8">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">{job.title}</h1>
        <p className="mt-1 text-sm text-muted">
          {[job.company, job.location, job.seniority].filter(Boolean).join(' · ') ||
            'No company or location parsed'}
        </p>
        {job.skills.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {job.skills.map((skill) => (
              <li
                key={skill}
                className="rounded border border-line bg-panel px-2 py-0.5 text-xs text-muted"
              >
                {skill}
              </li>
            ))}
          </ul>
        )}
      </section>

      <Dashboard jobId={id} initial={candidates} />
    </main>
  );
}
