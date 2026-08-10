import { NextResponse } from 'next/server';
import { sql, candidateRows, type Candidate, type Job } from '@/lib/db';
import { createCall, getCall, callbackConfig, normalizeStatus } from '@/lib/hunar';
import { needsRefresh } from '@/lib/call-state';
import { message } from '@/lib/http';

type Params = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Spoken aloud when a job description names no employer. */
const COMPANY_FALLBACK = 'the hiring team';

/**
 * Dashboard data. Before returning, any call that is still in flight is
 * refreshed straight from Hunar — this is the fallback for local dev, where
 * Hunar cannot reach a localhost webhook.
 */
export async function GET(_req: Request, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  try {
    const rows = await candidateRows(id);
    const pending = rows.filter((r) => r.call && needsRefresh(r.call));

    await Promise.all(
      pending.map(async (row) => {
        try {
          const detail = await getCall(row.call!.id);
          await sql`
            update calls set
              status            = ${normalizeStatus(detail.status)},
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
    // Validate the request before the server's own configuration, so a caller
    // sending bad input is told about their input rather than our env vars.
    const { candidateIds } = (await req.json()) as { candidateIds?: unknown };
    if (!Array.isArray(candidateIds) || candidateIds.length === 0) {
      return NextResponse.json({ error: 'Select at least one candidate.' }, { status: 400 });
    }
    // Postgres raises on a malformed uuid literal, which would surface as a 500.
    if (!candidateIds.every((v): v is string => typeof v === 'string' && UUID.test(v))) {
      return NextResponse.json({ error: 'candidateIds must be uuids.' }, { status: 400 });
    }

    const agentId = process.env.HUNAR_AGENT_ID;
    if (!agentId) {
      return NextResponse.json(
        { error: 'HUNAR_AGENT_ID is not set. Run `npm run seed:agent` and paste the id into .env.local.' },
        { status: 500 },
      );
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

    // Sourcing keeps profiles that arrived without a number; they are real leads
    // but cannot be dialled until one is attached.
    const reachable = candidates.filter((c): c is Candidate & { phone: string } => Boolean(c.phone));
    const unreachable = candidates.filter((c) => !c.phone);
    if (unreachable.length > 0) {
      return NextResponse.json(
        {
          error:
            `No phone number for ${unreachable.map((c) => c.name).join(', ')}. ` +
            'Attach one with `npm run set-phone -- "<name>" <+91…>` before screening.',
        },
        { status: 400 },
      );
    }

    const callbacks = callbackConfig();
    const outcomes = await Promise.all(
      reachable.map(async (c) => {
        try {
          const call = await createCall({
            callee_name: c.name,
            mobile_number: c.phone,
            agent_id: agentId,
            // Every value must be a non-empty string: these interpolate into
            // the agent's spoken introduction, and a blank reads as a stumble.
            custom_data: {
              job_role: job.title,
              company: job.company || COMPANY_FALLBACK,
              location: job.location || 'not specified',
            },
            callback_config: callbacks,
          });
          await sql`
            insert into calls (id, candidate_id, status)
            values (${call.id}, ${c.id}, ${normalizeStatus(call.status)})
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
