import Anthropic from '@anthropic-ai/sdk';

export type ParsedJd = {
  title: string;
  company: string;
  location: string;
  seniority: string;
  skills: string[];
};

const SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'The role title, e.g. "Field Sales Executive"' },
    company: { type: 'string', description: 'Hiring company. Empty string if not stated.' },
    location: { type: 'string', description: 'Primary work location, e.g. "Bangalore"' },
    seniority: {
      type: 'string',
      enum: ['Intern', 'Junior', 'Mid', 'Senior', 'Lead', 'Unspecified'],
    },
    skills: {
      type: 'array',
      items: { type: 'string' },
      description: 'Concrete skills or tools named in the description. At most 12.',
    },
  },
  required: ['title', 'company', 'location', 'seniority', 'skills'],
  additionalProperties: false,
} as const;

/**
 * Extracts structured fields from a pasted job description.
 * Uses Claude when ANTHROPIC_API_KEY is set; otherwise falls back to keyword
 * extraction so the app runs end-to-end with no paid keys but Hunar's.
 */
export async function parseJd(rawJd: string): Promise<ParsedJd> {
  if (!process.env.ANTHROPIC_API_KEY) return keywordParse(rawJd);

  const client = new Anthropic();
  const response = await client.messages.create({
    model: 'claude-opus-5',
    max_tokens: 4096,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [
      {
        role: 'user',
        content: `Extract the structured fields from this job description.\n\n${rawJd}`,
      },
    ],
  });

  // A refusal returns HTTP 200 with empty content — fall back rather than crash.
  if (response.stop_reason === 'refusal') return keywordParse(rawJd);

  const text = response.content.find((b) => b.type === 'text')?.text;
  if (!text) return keywordParse(rawJd);
  return normalize(JSON.parse(text) as ParsedJd);
}

/** Skills we can spot without an LLM. Extend freely — order is irrelevant. */
const KNOWN_SKILLS = [
  'javascript', 'typescript', 'python', 'java', 'golang', 'rust', 'sql', 'react',
  'node.js', 'nextjs', 'django', 'spring', 'aws', 'gcp', 'azure', 'kubernetes',
  'docker', 'postgres', 'mongodb', 'redis', 'kafka', 'excel', 'salesforce',
  'tally', 'crm', 'field sales', 'telesales', 'cold calling', 'b2b sales',
  'customer support', 'accounting', 'welding', 'plumbing', 'electrician',
  'driving', 'delivery', 'warehouse', 'nursing', 'data entry',
];

const SENIORITY: [RegExp, ParsedJd['seniority']][] = [
  [/\b(intern|internship|trainee)\b/i, 'Intern'],
  [/\b(lead|principal|head of|manager)\b/i, 'Lead'],
  [/\b(senior|sr\.?|[5-9]\+?\s*years|1\d\+?\s*years)\b/i, 'Senior'],
  [/\b(junior|jr\.?|fresher|entry[- ]level|0-?[12]\s*years)\b/i, 'Junior'],
];

// A small set of Indian hiring hubs — enough for the demo's mock candidates.
const CITIES = [
  'Bangalore', 'Bengaluru', 'Mumbai', 'Delhi', 'Gurgaon', 'Noida', 'Pune',
  'Hyderabad', 'Chennai', 'Kolkata', 'Ahmedabad', 'Jaipur', 'Remote',
];

function keywordParse(rawJd: string): ParsedJd {
  const lower = rawJd.toLowerCase();

  // First non-empty line is the title in nearly every JD format.
  const firstLine = rawJd.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  const title = firstLine.replace(/^(job title|role|position)\s*[:\-]\s*/i, '').slice(0, 120);

  const company = rawJd.match(/\b(?:at|company|employer)\s*[:\-]?\s*([A-Z][\w&.\- ]{2,40})/)?.[1]?.trim() ?? '';
  const location = CITIES.find((c) => lower.includes(c.toLowerCase())) ?? '';
  const seniority = SENIORITY.find(([re]) => re.test(rawJd))?.[1] ?? 'Unspecified';
  const skills = KNOWN_SKILLS.filter((s) => lower.includes(s));

  return normalize({ title, company, location, seniority, skills });
}

function normalize(p: ParsedJd): ParsedJd {
  return {
    title: p.title?.trim() || 'Untitled role',
    company: p.company?.trim() || '',
    location: p.location?.trim() || '',
    seniority: p.seniority?.trim() || 'Unspecified',
    skills: (p.skills ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 12),
  };
}
