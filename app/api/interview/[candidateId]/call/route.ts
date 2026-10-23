import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getCall, canonicalStatus, type VapiCall } from '@/lib/vapi';
import { message } from '@/lib/http';

type Params = { params: Promise<{ candidateId: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The call can take a moment to become readable right after start(). */
async function getCallWithRetry(callId: string): Promise<VapiCall> {
  try {
    return await getCall(callId);
  } catch {
    await new Promise((r) => setTimeout(r, 1500));
    return getCall(callId);
  }
}

/**
 * Registers a browser-started web call against a candidate. Public (the
 * candidate is not logged in), so nothing from the browser is trusted: the
 * call must exist on Vapi, run OUR assistant, and carry this candidate's id.
 */
export async function POST(req: Request, { params }: Params): Promise<NextResponse> {
  const { candidateId } = await params;
  try {
    const { callId } = (await req.json()) as { callId?: unknown };
    if (!UUID.test(candidateId) || typeof callId !== 'string' || !UUID.test(callId)) {
      return NextResponse.json({ error: 'Bad request.' }, { status: 400 });
    }

    const [candidate] = await sql<{ id: string }[]>`
      select id from candidates where id = ${candidateId}
    `;
    if (!candidate) return NextResponse.json({ error: 'Unknown interview.' }, { status: 404 });

    const call = await getCallWithRetry(callId);
    const forCandidate = call.assistantOverrides?.variableValues?.candidate_id;
    if (
      call.assistantId !== process.env.VAPI_ASSISTANT_ID ||
      (forCandidate !== undefined && forCandidate !== candidateId)
    ) {
      return NextResponse.json({ error: 'Call does not belong to this interview.' }, { status: 403 });
    }

    await sql`
      insert into calls (id, candidate_id, status)
      values (${callId}, ${candidateId}, ${canonicalStatus(call)})
      on conflict (id) do nothing
    `;
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    console.error(`POST /api/interview/${candidateId}/call failed`, err);
    return NextResponse.json({ error: message(err) }, { status: 500 });
  }
}
