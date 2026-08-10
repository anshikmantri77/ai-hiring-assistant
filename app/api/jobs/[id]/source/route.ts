import { NextResponse } from 'next/server';
import { sql, type Job } from '@/lib/db';
import { sourceCandidates, activeProvider } from '@/lib/people';
import { message } from '@/lib/http';

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  try {
    const [job] = await sql<Job[]>`select * from jobs where id = ${id}`;
    if (!job) return NextResponse.json({ error: 'Job not found.' }, { status: 404 });

    const found = await sourceCandidates(job);
    if (found.length === 0) {
      return NextResponse.json(
        { error: `No candidates came back from ${activeProvider()}.` },
        { status: 404 },
      );
    }

    // Re-running sourcing must not duplicate rows. No conflict target: phoneless
    // candidates dedupe on (job_id, linkedin), everyone else on (job_id, phone).
    const inserted = await sql`
      insert into candidates ${sql(
        found.map((c) => ({
          job_id: id,
          name: c.name,
          title: c.title,
          company: c.company,
          location: c.location,
          phone: c.phone,
          linkedin: c.linkedin,
        })),
      )}
      on conflict do nothing
      returning id
    `;
    return NextResponse.json({ found: found.length, added: inserted.length });
  } catch (err) {
    console.error(`POST /api/jobs/${id}/source failed`, err);
    return NextResponse.json({ error: message(err) }, { status: 500 });
  }
}
