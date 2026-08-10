import { readFile } from 'node:fs/promises';
import type { ParsedJd } from './parse-jd';

export type SourcedCandidate = {
  name: string;
  title: string;
  company: string;
  location: string;
  /** E.164, always +91-normalized. Candidates without one are dropped. */
  phone: string;
  linkedin: string | null;
};

export type Provider = 'mock' | 'apollo';

export function activeProvider(): Provider {
  return process.env.PEOPLE_PROVIDER === 'apollo' ? 'apollo' : 'mock';
}

export async function sourceCandidates(job: ParsedJd, limit = 10): Promise<SourcedCandidate[]> {
  const found = activeProvider() === 'apollo' ? await fromApollo(job, limit) : await fromMock(limit);
  // A screening call needs a reachable number; anything else is noise on the dashboard.
  return found.filter((c) => /^\+\d{10,15}$/.test(c.phone));
}

async function fromMock(limit: number): Promise<SourcedCandidate[]> {
  const path = new URL('../data/candidates.sample.json', import.meta.url);
  const raw = await readFile(path, 'utf8');
  return (JSON.parse(raw) as SourcedCandidate[]).slice(0, limit);
}

/** Apollo's people-search response, narrowed to the fields we read. */
type ApolloPerson = {
  name?: string;
  first_name?: string;
  last_name?: string;
  title?: string;
  organization?: { name?: string } | null;
  city?: string | null;
  state?: string | null;
  linkedin_url?: string | null;
  sanitized_phone?: string | null;
  phone_numbers?: { sanitized_number?: string; raw_number?: string }[] | null;
};

async function fromApollo(job: ParsedJd, limit: number): Promise<SourcedCandidate[]> {
  const key = process.env.APOLLO_API_KEY;
  if (!key) throw new Error('PEOPLE_PROVIDER=apollo but APOLLO_API_KEY is not set');

  const res = await fetch('https://api.apollo.io/api/v1/mixed_people/search', {
    method: 'POST',
    headers: { 'x-api-key': key, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      person_titles: [job.title],
      person_locations: job.location ? [job.location] : undefined,
      q_keywords: job.skills.join(' '),
      page: 1,
      per_page: Math.min(limit, 25),
    }),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`Apollo search failed (${res.status}): ${text.slice(0, 300)}`);

  const people = (JSON.parse(text).people ?? []) as ApolloPerson[];
  return people.map((p) => ({
    name: p.name || [p.first_name, p.last_name].filter(Boolean).join(' ') || 'Unknown',
    title: p.title ?? '',
    company: p.organization?.name ?? '',
    location: [p.city, p.state].filter(Boolean).join(', '),
    // Apollo returns phones only on plans with phone reveal enabled; the
    // caller drops rows where this comes back empty.
    phone: toE164(p.sanitized_phone ?? p.phone_numbers?.[0]?.sanitized_number ?? ''),
    linkedin: p.linkedin_url ?? null,
  }));
}

/** Assumes Indian numbers when no country code is present — Hunar dials +91. */
function toE164(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  if (raw.startsWith('+')) return `+${digits}`;
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  return `+${digits}`;
}
