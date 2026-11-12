import type { NextApiRequest, NextApiResponse } from 'next';
import { regenerateMcqsCore } from '../../lib/regenerate-mcqs-core';

export const maxDuration = 120;
export const config = {
  maxDuration: 120,
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const startTime = Date.now();
  const requestId = `mcq-job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      status: 'FAILED',
      error: {
        code: 'METHOD_NOT_ALLOWED',
        message: 'Method Not Allowed. Use POST.',
      },
    });
  }

  try {
    const payload =
      typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};

    const result = await regenerateMcqsCore({
      subject: payload.subject,
      unitNumber: payload.unitNumber,
      unitTitle: payload.unitTitle,
      sections: payload.sections,
      existingMcqs: Array.isArray(payload.existingMcqs) ? payload.existingMcqs : [],
      maxQuestions: payload.maxQuestions,
    });

    const durationMs = Date.now() - startTime;

    return res.status(200).json({
      success: true,
      jobId: requestId,
      data: result,
      ...result,
      durationMs,
    });
  } catch (error: any) {
    const durationMs = Date.now() - startTime;
    const status = error?.status || error?.statusCode || 500;
    const message =
      error?.message ||
      'Failed to synthesize practice MCQs. Please verify your GEMINI_API_KEY environment variable.';

    return res.status(status).json({
      success: false,
      status: 'FAILED',
      jobId: requestId,
      error: {
        code: error?.code || 'MCQ_GENERATION_ERROR',
        message,
      },
      message,
      mcqs: [],
      mcqGenerationNote: message,
      durationMs,
    });
  }
      }
