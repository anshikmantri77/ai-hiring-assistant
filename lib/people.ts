// Imported rather than read from disk at runtime: Next.js does not trace
// fs reads into the serverless bundle, so a runtime read 404s on Vercel.
import sample from '../data/candidates.sample.json';
import type { ParsedJd } from './parse-jd';

export type SourcedCandidate = {
  name: string;
  title: string;
  company: string;
  location: string;
  /**
   * E.164, or null when the provider found the person but no number.
   * A phoneless candidate is still worth storing — it just cannot be screened
   * until a number is attached (see `npm run set-phone`).
   */
  phone: string | null;
  linkedin: string | null;
};

export type Provider = 'mock' | 'apollo' | 'pdl' | 'searchapi';

export function activeProvider(): Provider {
  const p = process.env.PEOPLE_PROVIDER;
  return p === 'apollo' || p === 'pdl' || p === 'searchapi' ? p : 'mock';
}

export async function sourceCandidates(job: ParsedJd, limit = 10): Promise<SourcedCandidate[]> {
  const provider = activeProvider();
  const found =
    provider === 'apollo'
      ? await fromApollo(job, limit)
      : provider === 'pdl'
        ? await fromPdl(job, limit)
        : provider === 'searchapi'
          ? await fromSearchApi(job, limit)
          : fromMock(limit);
  // Keep everyone the provider found. Anything that is not a valid E.164 number
  // becomes null rather than being discarded: the profile is still a real lead,
  // it just is not callable yet.
  return found.map((c) => ({
    ...c,
    phone: c.phone && /^\+\d{10,15}$/.test(c.phone) ? c.phone : null,
  }));
}

function fromMock(limit: number): SourcedCandidate[] {
  return sample.slice(0, limit).map((c) => ({
    name: c.name,
    title: c.title,
    company: c.company,
    location: c.location,
    phone: c.phone,
    linkedin: c.linkedin,
  }));
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

/**
 * People Data Labs person record, narrowed to the fields we read.
 * Field names per https://docs.peopledatalabs.com/docs/example-record
 */
type PdlPerson = {
  full_name?: string | null;
  job_title?: string | null;
  job_company_name?: string | null;
  location_name?: string | null;
  mobile_phone?: string | null;
  phone_numbers?: string[] | null;
  linkedin_url?: string | null;
};

/**
 * Builds a quoted LIKE literal for PDL's SQL filter. The value comes from a
 * pasted job description, so single quotes are doubled to keep it inside the
 * string literal rather than terminating it.
 */
const likeLiteral = (v: string) => `'%${v.replace(/'/g, "''")}%'`;

async function fromPdl(job: ParsedJd, limit: number): Promise<SourcedCandidate[]> {
  const key = process.env.PDL_API_KEY;
  if (!key) throw new Error('PEOPLE_PROVIDER=pdl but PDL_API_KEY is not set');

  const where: string[] = ['mobile_phone IS NOT NULL'];
  if (job.title) where.push(`job_title LIKE ${likeLiteral(job.title.toLowerCase())}`);
  // PDL stores country lowercase; the JD's city is matched against location_name.
  if (job.location) where.push(`location_name LIKE ${likeLiteral(job.location.toLowerCase())}`);
  else where.push("location_country = 'india'");

  const res = await fetch('https://api.peopledatalabs.com/v5/person/search', {
    method: 'POST',
    headers: { 'X-Api-Key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sql: `SELECT * FROM person WHERE ${where.join(' AND ')}`,
      // Restricts results to records that actually carry a mobile number —
      // without this most rows come back unreachable and get filtered away.
      dataset: 'mobile_phone',
      size: Math.min(limit, 100),
      titlecase: true,
    }),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`PDL search failed (${res.status}): ${text.slice(0, 300)}`);

  const people = (JSON.parse(text).data ?? []) as PdlPerson[];
  return people.map((p) => ({
    name: p.full_name ?? 'Unknown',
    title: p.job_title ?? '',
    company: p.job_company_name ?? '',
    location: p.location_name ?? '',
    phone: toE164(p.mobile_phone ?? p.phone_numbers?.[0] ?? ''),
    linkedin: p.linkedin_url ? `https://www.${p.linkedin_url.replace(/^https?:\/\/(www\.)?/, '')}` : null,
  }));
}

/** A single organic result from SearchAPI's Google engine. */
type SerpResult = { title?: string; link?: string; snippet?: string };

/**
 * SearchAPI.io — a SERP API, not a contact database. It finds real public
 * LinkedIn profiles matching the job description, but returns no phone number,
 * so every candidate it produces arrives un-callable by design. Attach a number
 * with `npm run set-phone` to screen one.
 */
async function fromSearchApi(job: ParsedJd, limit: number): Promise<SourcedCandidate[]> {
  const key = process.env.SEARCHAPI_API_KEY;
  if (!key) throw new Error('PEOPLE_PROVIDER=searchapi but SEARCHAPI_API_KEY is not set');

  const terms = [job.title, job.location, ...job.skills.slice(0, 3)].filter(Boolean);
  const url = new URL('https://www.searchapi.io/api/v1/search');
  url.searchParams.set('engine', 'google');
  // Restricted to profile pages so results are people, not job ads.
  url.searchParams.set('q', `site:linkedin.com/in ${terms.join(' ')}`);
  url.searchParams.set('num', String(Math.min(limit, 20)));
  url.searchParams.set('api_key', key);

  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const text = await res.text();
  if (!res.ok) throw new Error(`SearchAPI search failed (${res.status}): ${text.slice(0, 300)}`);

  const results = (JSON.parse(text).organic_results ?? []) as SerpResult[];
  return results
    .filter((r) => r.link?.includes('linkedin.com/in'))
    .map((r) => {
      // Titles look like "Chenthil Kumar - Senior Backend Engineer | Java ...".
      const [namePart, ...rest] = (r.title ?? '').split(' - ');
      const headline = rest.join(' - ').replace(/\s*\|\s*LinkedIn\s*$/i, '').trim();
      return {
        name: namePart.trim() || 'Unknown',
        // The segment after the last pipe is usually the employer or a skill;
        // taking the first segment keeps it to the role.
        title: headline.split('|')[0].trim(),
        company: '',
        location: job.location,
        phone: null,
        linkedin: r.link ?? null,
      };
    });
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
