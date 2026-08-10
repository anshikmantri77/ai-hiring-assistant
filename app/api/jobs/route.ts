import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { parseJd } from '@/lib/parse-jd';
import { message } from '@/lib/http';

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const { rawJd } = (await req.json()) as { rawJd?: unknown };
    if (typeof rawJd !== 'string' || rawJd.trim().length < 20) {
      return NextResponse.json(
        { error: 'Paste a job description of at least 20 characters.' },
        { status: 400 },
      );
    }

    const parsed = await parseJd(rawJd);
    const [job] = await sql<{ id: string }[]>`
      insert into jobs (title, company, location, seniority, skills, raw_jd)
      values (${parsed.title}, ${parsed.company}, ${parsed.location},
              ${parsed.seniority}, ${parsed.skills}, ${rawJd})
      returning id
    `;
    return NextResponse.json({ id: job.id, ...parsed }, { status: 201 });
  } catch (err) {
    console.error('POST /api/jobs failed', err);
    return NextResponse.json({ error: message(err) }, { status: 500 });
  }
}
