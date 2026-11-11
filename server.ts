import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { processNotesCore, regenerateMcqsCore } from './src/server/notesProcessor';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Support large multi-page image and PDF payloads
app.use(express.json({ limit: '50mb' }));

/**
 * Health check endpoint to quickly test backend connectivity
 */
app.get('/api/health', (_req, res) => {
  res.json({
    success: true,
    service: 'AI Notes Backend',
    status: 'healthy',
    timestamp: new Date().toISOString(),
    geminiKeyConfigured: Boolean(
      (process.env.GEMINI_API_KEY || process.env.API_KEY || '').trim()
    ),
  });
});

/**
 * POST /api/notes/process
 * Multimodal handwritten notes OCR, source-only concept extraction, entailment verification, and traceable MCQ synthesis.
 */
app.post('/api/notes/process', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const result = await processNotesCore(req.body);
    return res.status(200).json({
      success: true,
      status: 'completed',
      data: result,
      ...result,
    });
  } catch (error: any) {
    console.error('Error in Express /api/notes/process:', error);
    const status = error?.status || error?.statusCode || 500;
    const message =
      error?.message ||
      'Failed to process handwritten notes with Gemini Vision. Please check your API key in Settings > Secrets.';
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
});

/**
 * POST /api/notes/regenerate-mcqs
 * Generates strictly source-traceable MCQs from verified concepts in a study unit.
 */
app.post('/api/notes/regenerate-mcqs', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const result = await regenerateMcqsCore(req.body);
    return res.status(200).json({
      success: true,
      data: result,
      ...result,
    });
  } catch (error: any) {
    console.error('Error in Express /api/notes/regenerate-mcqs:', error);
    const status = error?.status || error?.statusCode || 500;
    const message = error?.message || 'Failed to regenerate MCQs.';
    return res.status(status).json({
      success: false,
      status: 'failed',
      error: {
        code: error?.code || 'REGENERATE_ERROR',
        message,
      },
      message,
    });
  }
});

/**
 * Strict JSON 404 handler for unknown API routes.
 * Never allows API requests to fall through to Vite SPA or static HTML shells.
 */
app.all('/api/*', (_req, res) => {
  res.status(404).json({
    success: false,
    status: 'failed',
    error: {
      code: 'NOT_FOUND',
      message: `API endpoint '${_req.method} ${_req.path}' was not found.`,
    },
  });
});

async function startServer() {
  if (process.env.NODE_ENV === 'production') {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`AI Notes Studio server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
