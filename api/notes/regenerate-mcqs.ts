import { GoogleGenAI, Type, GenerateContentResponse } from '@google/genai';

export const maxDuration = 120;
export const config = {
  maxDuration: 120,
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

export const PRIMARY_GEMINI_MODEL_ID = 'gemini-3.8-flash';
export const FALLBACK_GEMINI_MODEL_ID = 'gemini-2.5-flash';

export function getGenAIClient(): GoogleGenAI {
  const apiKey = (process.env.GEMINI_API_KEY || process.env.API_KEY || '').trim();
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not configured on the server. Please configure GEMINI_API_KEY in your Vercel Environment Variables or Project Settings.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      apiVersion: 'v1beta',
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

/**
 * Execute generateContent with explicit timeout and automatic model fallback
 */
export async function generateContentWithTimeoutAndFallback(
  ai: GoogleGenAI,
  requestParams: any,
  timeoutMs: number = 22000
): Promise<{ response: GenerateContentResponse; modelUsed: string }> {
  const callModel = async (model: string) => {
    let timer: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const err = new Error(`Gemini request timed out after ${timeoutMs}ms for model ${model}`);
        (err as any).code = 'TIMEOUT';
        reject(err);
      }, timeoutMs);
    });

    try {
      const response = await Promise.race([
        ai.models.generateContent({
          ...requestParams,
          model,
        }),
        timeoutPromise,
      ]);
      return response;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  try {
    const response = await callModel(PRIMARY_GEMINI_MODEL_ID);
    return { response, modelUsed: PRIMARY_GEMINI_MODEL_ID };
  } catch (error: any) {
    const status = error?.status || error?.statusCode;
    const msg = error?.message || '';
    const isTimeout = error?.code === 'TIMEOUT' || /timeout/i.test(msg);
    const isOverloadedOrUnavailable =
      status === 503 ||
      status === 429 ||
      isTimeout ||
      /unavailable|high demand|overloaded|resource_exhausted/i.test(msg);

    if (isOverloadedOrUnavailable) {
      console.warn(
        `Primary model ${PRIMARY_GEMINI_MODEL_ID} failed (${msg}). Retrying once with ${FALLBACK_GEMINI_MODEL_ID}...`
      );
      try {
        const fallbackResponse = await callModel(FALLBACK_GEMINI_MODEL_ID);
        return { response: fallbackResponse, modelUsed: FALLBACK_GEMINI_MODEL_ID };
      } catch (fallbackError: any) {
        console.error(`Fallback model ${FALLBACK_GEMINI_MODEL_ID} also failed:`, fallbackError.message);
        throw fallbackError;
      }
    }
    throw error;
  }
}

export interface RegenerateMcqsPayload {
  jobId?: string;
  subject: string;
  unitNumber: number;
  unitTitle: string;
  sections: any[];
  maxQuestions?: number;
}

export async function regenerateMcqsCore(payload: RegenerateMcqsPayload) {
  const { subject, unitNumber, unitTitle, sections, maxQuestions = 6 } = payload;
  if (!sections || !Array.isArray(sections)) {
    throw new Error('Study sections are required to generate MCQs.');
  }

  // 1. Gather all verified concepts with sufficient handwritten source text
  const verifiedItems = sections.flatMap((sec: any) =>
    (sec.items || []).filter(
      (item: any) =>
        item.verificationStatus === 'VERIFIED' &&
        item.sourceSufficiency !== 'INSUFFICIENT' &&
        String(item.supportingSourcePassage || '').trim().length >= 10
    )
  );

  console.log(`[MCQ Engine] Found ${verifiedItems.length} eligible verified concept(s) for ${subject} Unit ${unitNumber}`);

  if (verifiedItems.length === 0) {
    return {
      status: 'PARTIAL',
      mcqs: [],
      mcqGenerationNote:
        'No concepts with sufficient handwritten context are verified yet. Please review and verify items in the Study Material Editor first.',
    };
  }

  // 2. Select a focused batch of concepts (limit to top 8 concepts max to avoid massive prompt size and slow latency)
  const candidateItems = verifiedItems.slice(0, 8);
  const targetCount = Math.max(1, Math.min(maxQuestions, candidateItems.length * 2, 8));

  const sourceContextPayload = candidateItems.map((item: any) => ({
    keyword: item.originalKeyword,
    pageNumber: item.sourcePageReference,
    supportingSourcePassage: item.supportingSourcePassage,
    verifiedExplanation: item.generatedExplanation,
    formulas: (item.formulasAndDerivations || []).map((f: any) => f.expression),
  }));

  const ai = getGenAIClient();

  const promptText = `Generate ${targetCount} multiple-choice practice questions for ${subject} (Unit ${unitNumber}: ${unitTitle}) strictly using ONLY the verified source passages and explanations below:

${JSON.stringify(sourceContextPayload, null, 2)}

STRICT ENGINEERING RULES:
1. Every question, correct option, and explanation MUST be 100% traceable to the provided "supportingSourcePassage" and "verifiedExplanation".
2. Do NOT invent outside textbook facts.
3. Every question must have exactly 4 options.
4. Output strictly in English.`;

  const { response, modelUsed } = await generateContentWithTimeoutAndFallback(
    ai,
    {
      contents: promptText,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            mcqs: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  question: { type: Type.STRING },
                  options: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                  },
                  correctIndex: { type: Type.INTEGER },
                  explanation: { type: Type.STRING },
                  supportingSourcePassage: { type: Type.STRING },
                  sourcePageReference: { type: Type.INTEGER },
                  relatedKeyword: { type: Type.STRING },
                },
                required: [
                  'question',
                  'options',
                  'correctIndex',
                  'explanation',
                  'supportingSourcePassage',
                  'sourcePageReference',
                  'relatedKeyword',
                ],
              },
            },
            mcqGenerationNote: { type: Type.STRING },
          },
          required: ['mcqs'],
        },
      },
    },
    22000 // 22s finite timeout ensures function completes well within Vercel's limit
  );

  let parsed: any = {};
  try {
    const rawText = (response.text ?? '{}').trim();
    parsed = JSON.parse(rawText);
  } catch (parseErr) {
    console.warn('[MCQ Engine] Failed to parse Gemini JSON output:', parseErr);
    parsed = { mcqs: [] };
  }

  // 3. Strict Source-Grounding Validation
  const rawMcqs = Array.isArray(parsed.mcqs) ? parsed.mcqs : [];
  const validMcqs = rawMcqs
    .filter((m: any) => {
      const q = String(m.question || '').trim();
      const quote = String(m.supportingSourcePassage || '').trim();
      const opts = Array.isArray(m.options) ? m.options : [];
      if (q.length < 5 || quote.length < 8 || opts.length < 2) return false;
      if (/\[unclear\]|\[illegible\]/i.test(quote)) return false;
      return true;
    })
    .map((m: any, idx: number) => {
      const opts = (m.options || []).slice(0, 4).map((o: any) => String(o));
      while (opts.length < 4) opts.push('Not stated in the uploaded notes');
      return {
        id: `mcq-gen-${Date.now()}-${idx}`,
        question: String(m.question || ''),
        options: opts as [string, string, string, string],
        correctIndex: Math.max(0, Math.min(3, Number(m.correctIndex) || 0)),
        explanation: String(m.explanation || ''),
        supportingSourcePassage: String(m.supportingSourcePassage || ''),
        sourcePageReference: Number(m.sourcePageReference) || 1,
        relatedKeyword: String(m.relatedKeyword || 'Unit Concept'),
      };
    });

  const jobStatus = validMcqs.length > 0 ? (validMcqs.length < rawMcqs.length ? 'PARTIAL' : 'COMPLETED') : 'PARTIAL';

  return {
    status: jobStatus,
    modelUsed,
    mcqs: validMcqs,
    mcqGenerationNote:
      parsed.mcqGenerationNote ||
      (validMcqs.length > 0
        ? `Generated ${validMcqs.length} source-verified practice question(s) directly from your verified unit notes.`
        : 'The uploaded notes did not contain enough verified factual statements to generate reliable MCQs without external information.'),
  };
}

export default async function handler(req: any, res: any) {
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
    const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const result = await regenerateMcqsCore({ ...payload, jobId: requestId });
    const durationMs = Date.now() - startTime;
    console.log(`[${requestId}] Finished MCQ Job: ${result.status} (${result.mcqs?.length || 0} MCQs, ${durationMs}ms, model: ${result.modelUsed})`);

    return res.status(200).json({
      success: true,
      jobId: requestId,
      data: result,
      ...result,
    });
  } catch (error: any) {
    const durationMs = Date.now() - startTime;
    console.error(`[${requestId}] MCQ Job FAILED (${durationMs}ms):`, error?.message || error);
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
    });
  }
}
