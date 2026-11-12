import { Receiver } from '@upstash/qstash';
import { createClient } from '@supabase/supabase-js';
import { regenerateMcqsCore } from './regenerate-mcqs';

export const maxDuration = 300;
export const config = {
  maxDuration: 300,
  api: {
    bodyParser: false,
  },
};

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error('Server configuration is missing Supabase credentials.');
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function readRawBody(req: any): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString('utf8');
}

function getHeader(req: any, name: string): string {
  const value = req.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

function send(res: any, status: number, body: Record<string, unknown>) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json(body);
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { success: false, error: 'Method not allowed.' });
  }

  const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY;
  const baseUrl = String(process.env.APP_BASE_URL || '').replace(/\/+$/, '');

  if (!currentSigningKey || !nextSigningKey || !baseUrl) {
    console.error('QStash worker configuration is incomplete.');
    return send(res, 500, { success: false, error: 'Worker configuration is incomplete.' });
  }

  let rawBody = '';
  try {
    rawBody = await readRawBody(req);
  } catch {
    return send(res, 400, { success: false, error: 'Could not read request body.' });
  }

  const signature = getHeader(req, 'upstash-signature');
  const receiver = new Receiver({
    currentSigningKey,
    nextSigningKey,
  });

  let verified = false;
  try {
    verified = await receiver.verify({
      signature,
      body: rawBody,
      url: `${baseUrl}/api/notes/mcq-worker`,
    });
  } catch {
    verified = false;
  }

  if (!verified) {
    return send(res, 401, { success: false, error: 'Invalid QStash signature.' });
  }

  let body: any;
  try {
    body = JSON.parse(rawBody || '{}');
  } catch {
    return send(res, 400, { success: false, error: 'Invalid JSON body.' });
  }

  const jobId = String(body.jobId || '');
  if (!jobId) return send(res, 400, { success: false, error: 'jobId is required.' });

  const supabase = getSupabase();

  const { data: claimed, error: claimError } = await supabase.rpc(
    'claim_mcq_generation_job',
    {
      p_job_id: jobId,
      p_concurrency_limit: 3,
    }
  );

  if (claimError) {
    console.error('Could not claim MCQ job:', claimError.message);
    return send(res, 500, { success: false, error: 'Could not claim the job.' });
  }

  if (!claimed) {
    const { data: existing } = await supabase
      .from('mcq_generation_jobs')
      .select('status')
      .eq('id', jobId)
      .maybeSingle();

    if (!existing) return send(res, 404, { success: false, error: 'Job not found.' });

    // Already completed or being worked on. A duplicate delivery should not
    // generate again. Leave PENDING jobs for QStash retry when concurrency is full.
    if (existing.status === 'PENDING') {
      return send(res, 429, { success: false, retry: true, error: 'Worker concurrency is full.' });
    }

    return send(res, 200, { success: true, skipped: true, status: existing.status });
  }

  const { data: job, error: readError } = await supabase
    .from('mcq_generation_jobs')
    .select('id, subject, unit_number, unit_title, payload, attempts')
    .eq('id', jobId)
    .single();

  if (readError || !job) {
    console.error('Could not read claimed MCQ job:', readError?.message);
    return send(res, 500, { success: false, error: 'Could not read the claimed job.' });
  }

  try {
    const payload = job.payload || {};
    const result = await regenerateMcqsCore({
      subject: job.subject,
      unitNumber: job.unit_number,
      unitTitle: job.unit_title,
      sections: payload.sections,
      existingMcqs: payload.existingMcqs,
      maxQuestions: payload.maxQuestions,
    });

    const { error: saveError } = await supabase
      .from('mcq_generation_jobs')
      .update({
        status: result.status,
        mcqs: result.mcqs,
        error_message:
          result.status === 'PARTIAL' ? result.mcqGenerationNote : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id);

    if (saveError) {
      throw new Error(`Could not persist generated questions: ${saveError.message}`);
    }

    return send(res, 200, {
      success: true,
      status: result.status,
      count: result.mcqs.length,
    });
  } catch (error: any) {
    const message = String(error?.message || 'MCQ generation failed.');
    const attempts = Number(job.attempts) || 1;
    const terminal =
      error?.retryable === false ||
      error?.code === 'INVALID_MODEL_RESPONSE' ||
      attempts >= 4;

    console.error(`MCQ job ${job.id} attempt ${attempts} failed: ${message}`);

    await supabase
      .from('mcq_generation_jobs')
      .update({
        status: terminal ? 'FAILED' : 'PENDING',
        error_message: terminal
          ? message
          : `Attempt ${attempts} failed; QStash may retry. ${message}`,
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id);

    // Non-2xx causes QStash's bounded retry policy to deliver the job again.
    if (!terminal) {
      return send(res, 503, {
        success: false,
        retry: true,
        error: 'Temporary MCQ generation failure.',
      });
    }

    // Terminal failures are persisted and acknowledged; QStash must not retry
    // indefinitely. The frontend can offer an explicit new job.
    return send(res, 200, {
      success: false,
      status: 'FAILED',
      error: 'MCQ generation failed. The saved study material is unchanged.',
    });
  }
}
