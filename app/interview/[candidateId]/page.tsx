import { notFound } from 'next/navigation';
import { sql } from '@/lib/db';
import { screeningVariables } from '@/lib/vapi';
import { Interview } from './interview';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Row = {
  id: string;
  name: string;
  job_title: string;
  job_company: string;
  job_location: string;
  last_status: string | null;
};

/** Public page a candidate opens to take the screening in their browser. */
export default async function InterviewPage({
  params,
}: {
  params: Promise<{ candidateId: string }>;
}) {
  const { candidateId } = await params;
  if (!UUID.test(candidateId)) notFound();

  const [row] = await sql<Row[]>`
    select c.id, c.name,
           j.title as job_title, j.company as job_company, j.location as job_location,
           (select status from calls where candidate_id = c.id
             order by created_at desc limit 1) as last_status
      from candidates c
      join jobs j on j.id = c.job_id
     where c.id = ${candidateId}
  `;
  if (!row) notFound();

  const publicKey = process.env.VAPI_PUBLIC_KEY;
  const assistantId = process.env.VAPI_ASSISTANT_ID;
  const variables = screeningVariables(
    { title: row.job_title, company: row.job_company, location: row.job_location },
    { id: row.id, name: row.name },
  );

  return (
    <main className="mx-auto max-w-xl space-y-6">
      <h1 className="font-display text-3xl leading-tight font-extrabold tracking-tight">
        Quick screening call
      </h1>
      <p className="text-[15px] leading-relaxed text-mute">
        Hi {variables.candidate_name}. This is a two-minute voice conversation about the{' '}
        <span className="font-semibold text-ink">{variables.job_role}</span> role at{' '}
        <span className="font-semibold text-ink">{variables.company}</span>. An AI assistant will
        ask four short questions. Your browser will ask for microphone access. The call is
        recorded so the recruiter can review it.
      </p>

      {row.last_status === 'COMPLETED' ? (
        <p className="border-2 border-live px-4 py-3 font-semibold text-live">
          Thanks, you have already completed this screening. The recruiter will be in touch.
        </p>
      ) : !publicKey || !assistantId ? (
        <p role="alert" className="border-2 border-dead px-4 py-3 text-sm text-dead">
          Voice screening is not configured yet. Please try again later.
        </p>
      ) : (
        <Interview
          candidateId={row.id}
          publicKey={publicKey}
          assistantId={assistantId}
          variables={variables}
        />
      )}
    </main>
  );
}
