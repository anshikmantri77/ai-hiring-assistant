/**
 * Vapi voice AI client. https://docs.vapi.ai/api-reference
 * Only the fields this app reads are typed. Vapi is the source of truth for a
 * call; the DB row is a cache refreshed by polling and by the webhook.
 *
 * Loaded directly by scripts/ and tests under `node --experimental-strip-types`,
 * so: no constructor parameter properties, and no `@/` imports.
 */

const BASE = 'https://api.vapi.ai';

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/** The answers the assistant's structured-data schema extracted from the call. */
export type CallResult = { [key: string]: Json };

/** Subset of Vapi's Call object this app reads. */
export type VapiCall = {
  id: string;
  assistantId?: string | null;
  /** 'webCall' | 'outboundPhoneCall' | 'inboundPhoneCall' */
  type?: string | null;
  /** 'scheduled' | 'queued' | 'ringing' | 'in-progress' | 'forwarding' | 'ended' */
  status: string;
  endedReason?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  recordingUrl?: string | null;
  artifact?: { recordingUrl?: string | null } | null;
  analysis?: { summary?: string | null; structuredData?: CallResult | null } | null;
  assistantOverrides?: { variableValues?: Record<string, string> } | null;
};

export type Assistant = { id: string; name: string };

class VapiError extends Error {
  readonly status: number;

  constructor(status: number, path: string, body: string) {
    super(`Vapi ${path} failed (${status}): ${body.slice(0, 400)}`);
    this.name = 'VapiError';
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const key = process.env.VAPI_PRIVATE_KEY;
  if (!key) throw new Error('VAPI_PRIVATE_KEY is not set');

  const res = await fetch(`${BASE}${path}`, {
    ...init,
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });

  // Read as text first: error bodies are not always JSON.
  const text = await res.text();
  if (!res.ok) throw new VapiError(res.status, path, text);
  return (text ? JSON.parse(text) : null) as T;
}

export function listAssistants(): Promise<Assistant[]> {
  return request('/assistant?limit=100');
}

export function createAssistant(body: Record<string, unknown>): Promise<Assistant> {
  return request('/assistant', { method: 'POST', body: JSON.stringify(body) });
}

export function updateAssistant(id: string, body: Record<string, unknown>): Promise<Assistant> {
  return request(`/assistant/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}

export function getAssistant(id: string): Promise<Assistant> {
  return request(`/assistant/${id}`);
}

export function getPhoneNumber(id: string): Promise<{ id: string; number?: string }> {
  return request(`/phone-number/${id}`);
}

export function getCall(callId: string): Promise<VapiCall> {
  return request(`/call/${callId}`);
}

/** Outbound phone call. Only usable when VAPI_PHONE_NUMBER_ID is configured. */
export function createPhoneCall(input: {
  assistantId: string;
  phoneNumberId: string;
  number: string;
  name: string;
  variables: Record<string, string>;
}): Promise<VapiCall> {
  return request('/call', {
    method: 'POST',
    body: JSON.stringify({
      assistantId: input.assistantId,
      phoneNumberId: input.phoneNumberId,
      customer: { number: input.number, name: input.name },
      assistantOverrides: { variableValues: input.variables },
    }),
  });
}

/**
 * Maps a Vapi call onto the app's canonical statuses (lib/call-state.ts), so
 * polling and the dashboard stay provider-agnostic.
 */
export function canonicalStatus(call: Pick<VapiCall, 'status' | 'endedReason'>): string {
  switch (call.status) {
    case 'scheduled':
      return 'SCHEDULED';
    case 'queued':
      return 'INITIATED';
    case 'ringing':
      return 'RINGING';
    case 'in-progress':
    case 'forwarding':
      return 'IN_PROGRESS';
    case 'ended':
      break;
    default:
      return 'INITIATED';
  }
  const reason = (call.endedReason ?? '').toLowerCase();
  if (reason.includes('cancel')) return 'CANCELLED';
  if (/did-not-answer|busy|voicemail|microphone-permission|did-not-join|no-answer/.test(reason)) {
    return 'NOT_CONNECTED';
  }
  if (/error|fault|failed/.test(reason)) return 'FAILED';
  return 'COMPLETED';
}

/** The columns of `calls` that a Vapi call fills. */
export function callFields(call: VapiCall) {
  const structured = call.analysis?.structuredData ?? null;
  const summary = call.analysis?.summary ?? null;
  // The dashboard reads result.summary; Vapi returns its summary beside the
  // structured data rather than inside it.
  const result: CallResult | null = structured
    ? { ...structured, ...(summary && !structured.summary ? { summary } : {}) }
    : null;

  const started = call.startedAt ? Date.parse(call.startedAt) : NaN;
  const ended = call.endedAt ? Date.parse(call.endedAt) : NaN;

  return {
    status: canonicalStatus(call),
    result,
    recording_url: call.artifact?.recordingUrl ?? call.recordingUrl ?? null,
    engagement_status: call.endedReason ?? null,
    answered_by: call.type === 'webCall' ? 'web' : call.type ? 'phone' : null,
    duration_seconds:
      Number.isFinite(started) && Number.isFinite(ended) ? Math.round((ended - started) / 1000) : null,
  };
}

/**
 * Text that will be SPOKEN by the agent. Job fields come from a pasted JD, so
 * strip template braces and line breaks (prompt-injection surface) and cap the
 * length; fall back when empty so the agent never stumbles on a blank.
 */
export function spoken(value: string | null | undefined, fallback: string): string {
  const clean = (value ?? '').replace(/[{}\r\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  return clean || fallback;
}

/** Variables injected into the assistant's prompt. Vapi uses {{double_braces}}. */
export function screeningVariables(
  job: { title: string; company: string; location: string },
  candidate: { id: string; name: string },
): Record<string, string> {
  return {
    candidate_id: candidate.id,
    candidate_name: spoken(candidate.name, 'there'),
    job_role: spoken(job.title, 'the open role'),
    company: spoken(job.company, 'the hiring team'),
    location: spoken(job.location, 'the listed location'),
  };
}

/**
 * Webhook target for the assistant, or undefined when APP_URL is not a public
 * https origin (localhost) — polling covers that case.
 */
export function webhookServer(): { url: string; headers: Record<string, string> } | undefined {
  const origin = process.env.APP_URL;
  const secret = process.env.VAPI_WEBHOOK_SECRET;
  if (!origin || !origin.startsWith('https://') || !secret) return undefined;
  return {
    url: `${origin.replace(/\/$/, '')}/api/webhooks/vapi`,
    headers: { 'x-vapi-secret': secret },
  };
}
