import { NextResponse } from 'next/server';
import { sql, type Job } from '@/lib/db';
import { toE164 } from '@/lib/people';
import { message } from '@/lib/http';

type Params = { params: Promise<{ id: string }> };

/**
 * Adds one candidate by hand.
 *
 * Sourcing providers differ in what they return — a SERP-based search finds real
 * people but no phone numbers. This is how a recruiter who already has someone's
 * number gets them into the pipeline without touching the database.
 */
export async function POST(req: Request, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  try {
    const body = (await req.json()) as { name?: unknown; phone?: unknown; title?: unknown };

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (name.length < 2) {
      return NextResponse.json({ error: 'Name is required.' }, { status: 400 });
    }

    const rawPhone = typeof body.phone === 'string' ? body.phone.trim() : '';
    const phone = toE164(rawPhone);
    if (!/^\+\d{10,15}$/.test(phone)) {
      return NextResponse.json(
        { error: 'Enter a valid phone number, e.g. 9876543210 or +919876543210.' },
        { status: 400 },
      );
    }

    const [job] = await sql<Job[]>`select * from jobs where id = ${id}`;
    if (!job) return NextResponse.json({ error: 'Job not found.' }, { status: 404 });

    const title = typeof body.title === 'string' ? body.title.trim() : '';

    // (job_id, phone) is unique, so adding the same number twice is a no-op
    // rather than a duplicate row — and therefore a duplicate call.
    const [candidate] = await sql<{ id: string }[]>`
      insert into candidates (job_id, name, title, company, location, phone, linkedin)
      values (${id}, ${name}, ${title}, '', ${job.location}, ${phone}, null)
      on conflict do nothing
      returning id
    `;
    if (!candidate) {
      return NextResponse.json(
        { error: 'That phone number is already on this job.' },
        { status: 409 },
      );
    }

    return NextResponse.json({ id: candidate.id, name, phone }, { status: 201 });
  } catch (err) {
    console.error(`POST /api/jobs/${id}/candidates failed`, err);
    return NextResponse.json({ error: message(err) }, { status: 500 });
  }
}
