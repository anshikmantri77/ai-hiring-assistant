/**
 * Hunar Voice AI client.
 * Field names and enums mirror https://api.voice.hunar.ai/docs/external/openapi.json
 */

const BASE = 'https://api.voice.hunar.ai';

export type CallStatus =
  | 'NOT_STARTED'
  | 'SCHEDULED'
  | 'INITIATED'
  | 'RINGING'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'NOT_CONNECTED'
  | 'CANCELLED'
  | 'FAILED';

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/** The answers the agent's `result_schema` extracted from the conversation. */
export type CallResult = { [key: string]: Json };

export type Agent = {
  id: string;
  name: string;
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  voice_persona: string;
};

/** Subset of CallExternalResponseSchema this app actually reads. */
export type CallDetail = {
  id: string;
  status: string;
  callee_name: string;
  mobile_number: string;
  result: CallResult | null;
  recording_url: string | null;
  engagement_status: string | null;
  answered_by: string | null;
  duration_seconds: number | null;
};

// Written without constructor parameter properties: scripts/ run under
// `node --experimental-strip-types`, which rejects that syntax.
class HunarError extends Error {
  readonly status: number;
  readonly path: string;

  constructor(status: number, path: string, body: string) {
    super(`Hunar ${path} failed (${status}): ${body.slice(0, 400)}`);
    this.name = 'HunarError';
    this.status = status;
    this.path = path;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const key = process.env.HUNAR_API_KEY;
  if (!key) throw new Error('HUNAR_API_KEY is not set');

  const res = await fetch(`${BASE}${path}`, {
    ...init,
    cache: 'no-store',
    headers: {
      'X-API-Key': key,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });

  // Read as text first: error bodies are not always JSON.
  const text = await res.text();
  if (!res.ok) throw new HunarError(res.status, path, text);
  return (text ? JSON.parse(text) : null) as T;
}

/**
 * `page_size` defaults to 10 server-side. Agent reuse compares against this
 * list, so a short page would silently create a duplicate agent on every run.
 * 200 is the documented maximum.
 */
export function listAgents(): Promise<{ results: Agent[] }> {
  return request('/external/v1/agents/?page_size=200');
}

export type HunarNumber = {
  phone_number: string;
  country_code: CountryCode;
  /** Countries this number may dial. A +91 callee needs 'IN' in here. */
  allowed_countries: CountryCode[];
  is_default: boolean;
  is_validated: boolean;
};

export type CountryCode = 'IN' | 'US' | 'SA' | 'GB';

export function listNumbers(): Promise<{ results: HunarNumber[] }> {
  return request('/external/v1/numbers/');
}

export type CreateAgentInput = {
  name: string;
  voice_persona: 'NEHA' | 'ROY' | 'ZOE' | 'SAM' | 'MIRA' | 'EESHA';
  language?: 'ENGLISH' | 'HINDI';
  agent_prompt: string;
  objective: string;
  introduction: string;
  result_prompt: string;
  result_schema: Record<string, unknown>;
};

export function createAgent(input: CreateAgentInput): Promise<Agent> {
  return request('/external/v1/agents/', {
    method: 'POST',
    body: JSON.stringify({ language: 'ENGLISH', ...input }),
  });
}

export type CreateCallInput = {
  callee_name: string;
  /** E.164, e.g. +919876543210 */
  mobile_number: string;
  agent_id: string;
  /** Injected into the agent prompt as {{variables}}. String values only. */
  custom_data?: Record<string, string>;
  callback_config?: {
    call_status_callback_url?: string;
    call_result_callback_url?: string;
    call_recording_callback_url?: string;
    call_summary_callback_url?: string;
  };
};

export function createCall(input: CreateCallInput): Promise<{ id: string; status: CallStatus }> {
  return request('/external/v1/calls/', {
    method: 'POST',
    body: JSON.stringify({ timezone: 'Asia/Kolkata', ...input }),
  });
}

export function getCall(callId: string): Promise<CallDetail> {
  return request(`/external/v1/calls/${callId}/`);
}

/**
 * The spec marks the call-detail `status` as "automatically converted to
 * label", so Hunar may return `In Progress` where the enum says `IN_PROGRESS`.
 * Everything is normalized back to the enum spelling on the way into the
 * database, so the rest of the app only ever sees canonical values.
 */
export function normalizeStatus(status: string): string {
  return status.trim().toUpperCase().replace(/[^A-Z]+/g, '_');
}

/** Terminal statuses — no point polling a call in one of these. */
const SETTLED = new Set(['COMPLETED', 'NOT_CONNECTED', 'CANCELLED', 'FAILED']);

export function isSettled(status: string | null | undefined): boolean {
  return status ? SETTLED.has(normalizeStatus(status)) : false;
}

/**
 * Callback URLs for a call. Returns undefined when APP_URL is a localhost
 * address, because Hunar cannot reach it — the dashboard's polling fallback
 * covers that case.
 */
export function callbackConfig(): CreateCallInput['callback_config'] {
  const origin = process.env.APP_URL;
  const token = process.env.WEBHOOK_TOKEN;
  if (!origin || !origin.startsWith('https://') || !token) return undefined;

  const url = (event: string) =>
    `${origin.replace(/\/$/, '')}/api/webhooks/hunar/${event}?token=${encodeURIComponent(token)}`;

  return {
    call_status_callback_url: url('status'),
    call_result_callback_url: url('result'),
    call_recording_callback_url: url('recording'),
    call_summary_callback_url: url('summary'),
  };
}
