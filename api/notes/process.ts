import { processNotesCore } from '../../src/server/notesProcessor';

export const config = {
  maxDuration: 60,
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

export default async function handler(req: any, res: any) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      status: 'failed',
      error: {
        code: 'METHOD_NOT_ALLOWED',
        message: 'Method Not Allowed. Use POST.',
      },
    });
  }

  try {
    const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const result = await processNotesCore(payload);
    return res.status(200).json({
      success: true,
      status: 'completed',
      data: result,
      ...result,
    });
  } catch (error: any) {
    console.error('Error in Vercel /api/notes/process:', error);
    const status = error?.status || error?.statusCode || 500;
    const message =
      error?.message ||
      'Failed to process handwritten notes with Gemini Vision. Please check your GEMINI_API_KEY environment variable.';
    return res.status(status).json({
      success: false,
      status: 'failed',
      error: {
        code: error?.code || 'PROCESSING_ERROR',
        message,
      },
      message,
    });
  }
}
