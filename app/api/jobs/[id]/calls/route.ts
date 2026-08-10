import { NextResponse } from 'next/server';
import { sql, candidateRows, type Candidate, type Job } from '@/lib/db';
import { createCall, getCall, callbackConfig, isSettled } from '@/lib/hunar';
import { message } from '@/lib/http';

type Params = { params: Promise<{ id: string }> };

/**
 * Dashboard data. Before returning, any call that is still in flight is
 * refreshed straight from Hunar — this is the fallback for local dev, where
 * Hunar cannot reach a localhost webhook.
 */
export async function GET(_req: Request, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  try {
    const rows = await candidateRows(id);
    const pending = rows.filter((r) => r.call && !isSettled(r.call.status));

    await Promise.all(
      pending.map(async (row) => {
        try {
          const detail = await getCall(row.call!.id);
          await sql`
            update calls set
              status            = ${detail.status},
              result            = ${detail.result ? sql.json(detail.result) : null},
              recording_url     = ${detail.recording_url},
              engagement_status = ${detail.engagement_status},
              answered_by       = ${detail.answered_by},
              duration_seconds  = ${detail.duration_seconds},
              updated_at        = now()
            where id = ${row.call!.id}
          `;
        } catch (err) {
          // One unreachable call must not blank the whole dashboard.
          console.error(`Polling call ${row.call!.id} failed`, err);
        }
      }),
    );

    return NextResponse.json({ candidates: pending.length ? await candidateRows(id) : rows });
  } catch (err) {
    console.error(`GET /api/jobs/${id}/calls failed`, err);
    return NextResponse.json({ error: message(err) }, { status: 500 });
  }
}

/** Launches a screening call per selected candidate. */
export async function POST(req: Request, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  try {
    const agentId = process.env.HUNAR_AGENT_ID;
    if (!agentId) {
      return NextResponse.json(
        { error: 'HUNAR_AGENT_ID is not set. Run `npm run seed:agent` and paste the id into .env.local.' },
        { status: 500 },
      );
    }

    const { candidateIds } = (await req.json()) as { candidateIds?: unknown };
    if (!Array.isArray(candidateIds) || candidateIds.length === 0) {
      return NextResponse.json({ error: 'Select at least one candidate.' }, { status: 400 });
    }

    const [job] = await sql<Job[]>`select * from jobs where id = ${id}`;
    if (!job) return NextResponse.json({ error: 'Job not found.' }, { status: 404 });

    const candidates = await sql<Candidate[]>`
      select * from candidates
       where job_id = ${id} and id = any(${candidateIds as string[]}::uuid[])
    `;
    if (candidates.length === 0) {
      return NextResponse.json({ error: 'No matching candidates for this job.' }, { status: 404 });
    }

    const callbacks = callbackConfig();
    const outcomes = await Promise.all(
      candidates.map(async (c) => {
        try {
          const call = await createCall({
            callee_name: c.name,
            mobile_number: c.phone,
            agent_id: agentId,
            custom_data: {
              job_role: job.title,
              company: job.company,
              location: job.location || 'not specified',
            },
            callback_config: callbacks,
          });
          await sql`
            insert into calls (id, candidate_id, status)
            values (${call.id}, ${c.id}, ${call.status})
            on conflict (id) do nothing
          `;
          return { candidateId: c.id, callId: call.id, ok: true as const };
        } catch (err) {
          console.error(`Creating call for ${c.id} failed`, err);
          return { candidateId: c.id, ok: false as const, error: message(err) };
        }
      }),
    );

    return NextResponse.json({
      launched: outcomes.filter((o) => o.ok).length,
      failed: outcomes.filter((o) => !o.ok),
      // Surfaced in the UI so a localhost run explains its own missing webhooks.
      webhooksEnabled: Boolean(callbacks),
    });
  } catch (err) {
    console.error(`POST /api/jobs/${id}/calls failed`, err);
    return NextResponse.json({ error: message(err) }, { status: 500 });
  }
}
