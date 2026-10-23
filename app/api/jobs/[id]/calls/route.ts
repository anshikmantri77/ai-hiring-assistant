import { NextResponse } from 'next/server';
import { sql, candidateRows, type Candidate, type Job } from '@/lib/db';
import { createPhoneCall, canonicalStatus, screeningVariables, webhookServer } from '@/lib/vapi';
import { needsRefresh } from '@/lib/call-state';
import { syncCall } from '@/lib/sync-call';
import { message } from '@/lib/http';

type Params = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Dashboard data. Before returning, any call still in flight is refreshed
 * straight from Vapi — the fallback for local dev, where Vapi cannot reach a
 * localhost webhook, and for web calls whose end-of-call report is late.
 */
export async function GET(_req: Request, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  try {
    const rows = await candidateRows(id);
    const pending = rows.filter((r) => r.call && needsRefresh(r.call));

    await Promise.all(
      pending.map(async (row) => {
        try {
          await syncCall(row.call!.id);
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

/** Places an outbound PHONE call per selected candidate (optional feature). */
export async function POST(req: Request, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  try {
    const { candidateIds } = (await req.json()) as { candidateIds?: unknown };
    if (!Array.isArray(candidateIds) || candidateIds.length === 0) {
      return NextResponse.json({ error: 'Select at least one candidate.' }, { status: 400 });
    }
    if (!candidateIds.every((v): v is string => typeof v === 'string' && UUID.test(v))) {
      return NextResponse.json({ error: 'candidateIds must be uuids.' }, { status: 400 });
    }

    const assistantId = process.env.VAPI_ASSISTANT_ID;
    if (!assistantId) {
      return NextResponse.json(
        { error: 'VAPI_ASSISTANT_ID is not set. Run `npm run seed:agent` and set it.' },
        { status: 500 },
      );
    }
    const phoneNumberId = process.env.VAPI_PHONE_NUMBER_ID;
    if (!phoneNumberId) {
      return NextResponse.json(
        {
          error:
            'Phone calling is not configured (VAPI_PHONE_NUMBER_ID). ' +
            'Use each candidate’s “interview link” instead — it is free and needs no phone.',
        },
        { status: 400 },
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

    const reachable = candidates.filter((c): c is Candidate & { phone: string } => Boolean(c.phone));
    const unreachable = candidates.filter((c) => !c.phone);
    if (unreachable.length > 0) {
      return NextResponse.json(
        {
          error:
            `No phone number for ${unreachable.map((c) => c.name).join(', ')}. ` +
            'Send them their interview link instead.',
        },
        { status: 400 },
      );
    }

    // Guard against double-dispatch: two clicks must not place two real calls.
    const busy = await sql<{ candidate_id: string }[]>`
      select distinct candidate_id from calls
       where candidate_id = any(${reachable.map((c) => c.id)}::uuid[])
         and status not in ('COMPLETED', 'NOT_CONNECTED', 'CANCELLED', 'FAILED')
    `;
    const busyIds = new Set(busy.map((b) => b.candidate_id));
    const toCall = reachable.filter((c) => !busyIds.has(c.id));
    const skipped = reachable.filter((c) => busyIds.has(c.id)).map((c) => c.name);

    if (toCall.length === 0) {
      return NextResponse.json(
        { error: `Already calling ${skipped.join(', ')}. Wait for the call to finish.` },
        { status: 409 },
      );
    }

    const outcomes = await Promise.all(
      toCall.map(async (c) => {
        try {
          const call = await createPhoneCall({
            assistantId,
            phoneNumberId,
            number: c.phone,
            name: c.name,
            variables: screeningVariables(job, c),
          });
          await sql`
            insert into calls (id, candidate_id, status)
            values (${call.id}, ${c.id}, ${canonicalStatus(call)})
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
      skipped,
      webhooksEnabled: Boolean(webhookServer()),
    });
  } catch (err) {
    console.error(`POST /api/jobs/${id}/calls failed`, err);
    return NextResponse.json({ error: message(err) }, { status: 500 });
  }
}
