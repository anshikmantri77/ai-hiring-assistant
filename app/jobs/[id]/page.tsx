import Link from 'next/link';
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
        <Link
          href="/"
          className="font-mono text-[11px] tracking-widest text-mute uppercase hover:text-dial"
        >
          ← all jobs
        </Link>
        <h1 className="mt-3 font-display text-3xl leading-tight font-extrabold tracking-tight text-balance sm:text-4xl">
          {job.title}
        </h1>
        <p className="mt-2 font-mono text-xs tracking-wider text-mute uppercase">
          {[job.company, job.location, job.seniority].filter(Boolean).join(' · ') ||
            'no company or location parsed'}
        </p>
        {job.skills.length > 0 && (
          <ul className="mt-4 flex flex-wrap gap-1.5">
            {job.skills.map((skill) => (
              <li
                key={skill}
                className="border border-ink bg-card px-2 py-0.5 font-mono text-[11px] tracking-wide"
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
