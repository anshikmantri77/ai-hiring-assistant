/**
 * Creates the screening agent once, or reuses it if it already exists.
 * Run: npm run seed:agent   → prints the id to paste into HUNAR_AGENT_ID.
 */
import { listAgents, createAgent } from '../lib/hunar.ts';

const AGENT_NAME = 'AI Hiring Assistant — Screener';

const AGENT_PROMPT = `You are a recruitment screening assistant calling a candidate about a {job_role} opening at {company} in {location}.

Keep the call under three minutes and ask these four things, one at a time, in order:
1. Whether they are interested in the {job_role} role.
2. Their current notice period.
3. Their expected CTC.
4. The earliest date they could start.

If the candidate says it is a bad time, offer to call back and end politely.
If they are not interested, thank them and end the call — do not ask the remaining questions.
Never invent details about salary, benefits, or the interview process; if asked something you do not know, say a recruiter will follow up.`;

const INTRODUCTION = `Hi, am I speaking with {callee_name}? This is an assistant calling from {company} about a {job_role} opening in {location}. Do you have two minutes?`;

const RESULT_PROMPT = `From the conversation, extract the candidate's answers. If the candidate did not answer a question, use an empty string for that field and set interested to false only when they explicitly declined.`;

const RESULT_SCHEMA = {
  type: 'object',
  properties: {
    interested: { type: 'boolean', description: 'Did the candidate express interest in the role?' },
    notice_period: { type: 'string', description: 'Stated notice period, e.g. "30 days".' },
    expected_ctc: { type: 'string', description: 'Stated expected CTC, e.g. "8 LPA".' },
    availability: { type: 'string', description: 'Earliest start date or availability.' },
    summary: { type: 'string', description: 'Two-sentence summary of the call.' },
  },
  required: ['interested', 'notice_period', 'expected_ctc', 'availability', 'summary'],
};

const existing = (await listAgents()).results.find((a) => a.name === AGENT_NAME);
if (existing) {
  console.log(`Reusing existing agent.\nHUNAR_AGENT_ID=${existing.id}`);
} else {
  const agent = await createAgent({
    name: AGENT_NAME,
    voice_persona: 'NEHA',
    language: 'ENGLISH',
    agent_prompt: AGENT_PROMPT,
    objective: 'Screen a candidate for interest, notice period, expected CTC, and availability.',
    introduction: INTRODUCTION,
    result_prompt: RESULT_PROMPT,
    result_schema: RESULT_SCHEMA,
  });
  console.log(`Created agent.\nHUNAR_AGENT_ID=${agent.id}`);
}
