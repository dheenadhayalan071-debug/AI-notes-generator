import { Client } from '@upstash/qstash';
import { createClient } from '@supabase/supabase-js';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '2mb',
    },
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

function getQStash() {
  const token = process.env.QSTASH_TOKEN;
  if (!token) throw new Error('Server configuration is missing QSTASH_TOKEN.');
  return new Client({ token });
}

function jsonError(res: any, status: number, message: string) {
  return res.status(status).json({
    success: false,
    error: { message },
  });
}

function getRequestBody(req: any): any {
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body || {};
}

function toJobResponse(row: any) {
  return {
    jobId: row.id,
    unitId: row.unit_id,
    status: row.status,
    mcqs: Array.isArray(row.mcqs) ? row.mcqs : [],
    error: row.error_message || undefined,
    attempts: row.attempts,
    updatedAt: row.updated_at,
  };
}

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');

  const supabase = getSupabase();

  if (req.method === 'GET') {
    const jobId = String(req.query?.id || '');
    if (!jobId) return jsonError(res, 400, 'A job ID is required.');

    const { data, error } = await supabase
      .from('mcq_generation_jobs')
      .select(
        'id, unit_id, status, mcqs, error_message, attempts, updated_at'
      )
      .eq('id', jobId)
      .maybeSingle();

    if (error) {
      console.error('Unable to read MCQ job status:', error.message);
      return jsonError(res, 500, 'Could not retrieve MCQ job status.');
    }
    if (!data) return jsonError(res, 404, 'MCQ job was not found.');

    return res.status(200).json({ success: true, job: toJobResponse(data) });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return jsonError(res, 405, 'Use GET to poll a job or POST to create one.');
  }

  const body = getRequestBody(req);
  const unitId = String(body.unitId || '').trim();
  const idempotencyKey = String(body.idempotencyKey || '').trim();
  const subject = String(body.subject || '').trim();
  const unitTitle = String(body.unitTitle || '').trim();
  const unitNumber = Number(body.unitNumber);
  const sections = body.sections;

  if (!unitId || !idempotencyKey || !subject || !unitTitle) {
    return jsonError(
      res,
      400,
      'unitId, idempotencyKey, subject, and unitTitle are required.'
    );
  }
  if (!Number.isInteger(unitNumber) || unitNumber < 1) {
    return jsonError(res, 400, 'unitNumber must be a positive integer.');
  }
  if (!Array.isArray(sections)) {
    return jsonError(res, 400, 'sections must be an array.');
  }

  // Idempotent replay returns the original job, never enqueues a duplicate.
  const existingByKey = await supabase
    .from('mcq_generation_jobs')
    .select(
      'id, unit_id, status, mcqs, error_message, attempts, updated_at'
    )
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();

  if (existingByKey.error) {
    console.error('Unable to check MCQ idempotency key:', existingByKey.error.message);
    return jsonError(res, 500, 'Could not create an MCQ job.');
  }
  if (existingByKey.data) {
    return res.status(200).json({
      success: true,
      job: toJobResponse(existingByKey.data),
      reused: true,
    });
  }

  // Only one active job per unit. Return it instead of duplicating work.
  const active = await supabase
    .from('mcq_generation_jobs')
    .select(
      'id, unit_id, status, mcqs, error_message, attempts, updated_at'
    )
    .eq('unit_id', unitId)
    .in('status', ['PENDING', 'PROCESSING'])
    .maybeSingle();

  if (active.error) {
    console.error('Unable to check active MCQ job:', active.error.message);
    return jsonError(res, 500, 'Could not check for an active MCQ job.');
  }
  if (active.data) {
    return res.status(200).json({
      success: true,
      job: toJobResponse(active.data),
      reused: true,
    });
  }

  const { data: inserted, error: insertError } = await supabase
    .from('mcq_generation_jobs')
    .insert({
      unit_id: unitId,
      idempotency_key: idempotencyKey,
      subject,
      unit_number: unitNumber,
      unit_title: unitTitle,
      payload: {
        sections,
        existingMcqs: Array.isArray(body.existingMcqs) ? body.existingMcqs : [],
        maxQuestions: Number(body.maxQuestions) || 6,
      },
      status: 'PENDING',
      mcqs: [],
    })
    .select(
      'id, unit_id, status, mcqs, error_message, attempts, updated_at'
    )
    .single();

  if (insertError) {
    // A concurrent request may have won the unique active-unit or key race.
    const raced = await supabase
      .from('mcq_generation_jobs')
      .select(
        'id, unit_id, status, mcqs, error_message, attempts, updated_at'
      )
      .eq('unit_id', unitId)
      .in('status', ['PENDING', 'PROCESSING'])
      .maybeSingle();

    if (raced.data) {
      return res.status(200).json({
        success: true,
        job: toJobResponse(raced.data),
        reused: true,
      });
    }

    console.error('Unable to insert MCQ job:', insertError.message);
    return jsonError(res, 500, 'Could not create the MCQ job.');
  }

  const baseUrl = String(process.env.APP_BASE_URL || '').replace(/\/+$/, '');
  if (!baseUrl) {
    await supabase
      .from('mcq_generation_jobs')
      .update({
        status: 'FAILED',
        error_message: 'APP_BASE_URL is not configured.',
        updated_at: new Date().toISOString(),
      })
      .eq('id', inserted.id);

    return jsonError(res, 500, 'Server configuration is missing APP_BASE_URL.');
  }

  try {
    await getQStash().publishJSON({
      url: `${baseUrl}/api/notes/mcq-worker`,
      body: { jobId: inserted.id },
      retries: 3,
      deduplicationId: `mcq-${inserted.id}`,
    });
  } catch (error: any) {
    console.error('Unable to enqueue MCQ job:', error?.message || error);
    await supabase
      .from('mcq_generation_jobs')
      .update({
        status: 'FAILED',
        error_message: 'Could not enqueue the MCQ job. You can retry generation.',
        updated_at: new Date().toISOString(),
      })
      .eq('id', inserted.id);

    return res.status(502).json({
      success: false,
      job: {
        ...toJobResponse(inserted),
        status: 'FAILED',
        error: 'Could not enqueue the MCQ job. You can retry generation.',
      },
      error: { message: 'Could not enqueue the MCQ job. You can retry generation.' },
    });
  }

  return res.status(202).json({
    success: true,
    job: toJobResponse(inserted),
    reused: false,
  });
}
