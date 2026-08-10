import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getCall, normalizeStatus } from '@/lib/hunar';
import { verifySignature } from '@/lib/webhook-signature';
import { message } from '@/lib/http';

type Params = { params: Promise<{ event: string }> };

const EVENTS = new Set(['status', 'result', 'recording', 'summary']);

/**
 * Receives Hunar's status/result/recording/summary callbacks.
 *
 * Authenticated two ways. The primary control is Hunar's HMAC signature over
 * the raw body — that proves the request came from Hunar and has not been
 * replayed. The `?token=` check is a secondary gate carried on the callback
 * URL itself, kept because it costs nothing and fails closed if signing is
 * ever unavailable.
 *
 * The payload is used only to identify the call; authoritative state is then
 * re-read from Hunar. One handler therefore covers all four callback shapes,
 * duplicate deliveries converge on the same result, and a partial payload
 * cannot corrupt a row.
 */
export async function POST(req: Request, { params }: Params): Promise<NextResponse> {
  const { event } = await params;
  if (!EVENTS.has(event)) {
    return NextResponse.json({ error: 'Unknown event.' }, { status: 404 });
  }

  const expectedToken = process.env.WEBHOOK_TOKEN;
  const token = new URL(req.url).searchParams.get('token');
  if (!expectedToken || token !== expectedToken) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
  }

  // Read the body as raw text: the signature is computed over exactly these
  // bytes, so parsing before verifying would make it unverifiable.
  const rawBody = await req.text();

  const apiKey = process.env.HUNAR_API_KEY;
  const verdict = verifySignature({
    signatureHeader: req.headers.get('x-hunar-signature'),
    timestampHeader: req.headers.get('x-hunar-timestamp'),
    rawBody,
    trustedKeys: apiKey ? [apiKey] : [],
  });
  if (!verdict.ok) {
    console.error(`Hunar ${event} webhook signature rejected: ${verdict.reason}`);
    return NextResponse.json({ error: 'Invalid signature.' }, { status: 401 });
  }

  try {
    const payload = JSON.parse(rawBody) as Record<string, unknown>;
    const callId = extractCallId(payload);
    if (!callId) {
      console.error(`Hunar ${event} webhook had no call id`);
      // 200, not 400: Hunar retries 4xx, and a payload we cannot parse will
      // not become parseable on a retry.
      return NextResponse.json({ ignored: 'no call id' });
    }

    const [known] = await sql<{ id: string }[]>`select id from calls where id = ${callId}`;
    if (!known) return NextResponse.json({ ignored: 'unknown call' });

    const detail = await getCall(callId);
    await sql`
      update calls set
        status            = ${normalizeStatus(detail.status)},
        result            = ${detail.result ? sql.json(detail.result) : null},
        recording_url     = ${detail.recording_url},
        engagement_status = ${detail.engagement_status},
        answered_by       = ${detail.answered_by},
        duration_seconds  = ${detail.duration_seconds},
        webhook_events    = webhook_events + 1,
        updated_at        = now()
      where id = ${callId}
    `;
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`Hunar ${event} webhook failed`, err);
    return NextResponse.json({ error: message(err) }, { status: 500 });
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Every documented Hunar event carries `call_id` at the top level. */
function extractCallId(payload: Record<string, unknown>): string | null {
  const value = payload.call_id;
  return typeof value === 'string' && UUID.test(value) ? value : null;
}
