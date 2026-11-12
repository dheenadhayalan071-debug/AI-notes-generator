import { GoogleGenAI, Type, GenerateContentResponse } from '@google/genai';

export const PRIMARY_GEMINI_MODEL_ID = 'gemini-3.8-flash';
export const FALLBACK_GEMINI_MODEL_ID = 'gemini-2.5-flash';

export function getGenAIClient(): GoogleGenAI {
  const apiKey = (process.env.GEMINI_API_KEY || process.env.API_KEY || '').trim();

  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not configured on the server. Configure it in Vercel Environment Variables.'
    );
  }

  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      apiVersion: 'v1beta',
      headers: { 'User-Agent': 'ai-notes-studio' },
    },
  });
}

export async function generateContentWithTimeoutAndFallback(
  ai: GoogleGenAI,
  requestParams: any,
  timeoutMs = 70000
): Promise<{ response: GenerateContentResponse; modelUsed: string }> {
  const callModel = async (model: string): Promise<GenerateContentResponse> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const error: any = new Error(
          `Gemini request timed out after ${timeoutMs}ms for model ${model}.`
        );
        error.code = 'GEMINI_TIMEOUT';
        reject(error);
      }, timeoutMs);
    });

    try {
      return await Promise.race([
        ai.models.generateContent({ ...requestParams, model }),
        timeout,
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  try {
    return {
      response: await callModel(PRIMARY_GEMINI_MODEL_ID),
      modelUsed: PRIMARY_GEMINI_MODEL_ID,
    };
  } catch (error: any) {
    const status = error?.status || error?.statusCode;
    const message = String(error?.message || '');
    const retryable =
      error?.code === 'GEMINI_TIMEOUT' ||
      status === 429 ||
      status === 503 ||
      /timeout|unavailable|overloaded|resource_exhausted/i.test(message);

    if (!retryable) throw error;

    return {
      response: await callModel(FALLBACK_GEMINI_MODEL_ID),
      modelUsed: FALLBACK_GEMINI_MODEL_ID,
    };
  }
}

export interface RegenerateMcqsPayload {
  subject: string;
  unitNumber: number;
  unitTitle: string;
  sections: any[];
  existingMcqs?: any[];
  maxQuestions?: number;
}

function normalize(text: unknown): string {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function sourceContains(source: string, value: string): boolean {
  const normalizedSource = normalize(source);
  const normalizedValue = normalize(value);
  return Boolean(normalizedValue) && normalizedSource.includes(normalizedValue);
}

function collectCandidates(sections: any[]): any[] {
  const allItems = sections.flatMap((section) =>
    Array.isArray(section?.items) ? section.items : []
  );

  const eligible = allItems.filter((item) => {
    const passage = String(item?.supportingSourcePassage || '').trim();
    const page = Number(item?.sourcePageReference);
    const status = item?.verificationStatus;
    const sufficiency = item?.sourceSufficiency;

    if (!Number.isInteger(page) || page < 1) return false;
    if (passage.length < 8) return false;
    if (/\[(?:unclear|illegible)\]/i.test(passage)) return false;
    if (status !== 'VERIFIED' && status !== 'PARTIALLY_SUPPORTED') return false;
    if (sufficiency === 'INSUFFICIENT') return false;

    return true;
  });

  // Prefer VERIFIED material while retaining eligible partial evidence.
  return eligible.sort((a, b) => {
    const aVerified = a.verificationStatus === 'VERIFIED' ? 1 : 0;
    const bVerified = b.verificationStatus === 'VERIFIED' ? 1 : 0;
    return bVerified - aVerified;
  });
}

export async function regenerateMcqsCore(payload: RegenerateMcqsPayload) {
  const {
    subject,
    unitNumber,
    unitTitle,
    sections,
    existingMcqs = [],
    maxQuestions = 6,
  } = payload;

  if (!Array.isArray(sections)) {
    throw new Error('Study sections are required to generate MCQs.');
  }

  const candidates = collectCandidates(sections).slice(0, 8);
  if (candidates.length === 0) {
    return {
      status: 'PARTIAL' as const,
      modelUsed: undefined,
      mcqs: [],
      mcqGenerationNote:
        'No legible VERIFIED or PARTIALLY_SUPPORTED source passages with page references were eligible for questions.',
    };
  }

  const targetCount = Math.max(
    1,
    Math.min(Number(maxQuestions) || 6, candidates.length * 2, 8)
  );

  const contexts = candidates.map((item, index) => ({
    candidateId: `C${index + 1}`,
    keyword: String(item.originalKeyword || ''),
    verificationStatus: item.verificationStatus,
    pageNumber: Number(item.sourcePageReference),
    sourcePassage: String(item.supportingSourcePassage || ''),
    explanation: String(item.generatedExplanation || ''),
    formulas: (Array.isArray(item.formulasAndDerivations)
      ? item.formulasAndDerivations
      : []
    )
      .map((step: any) => String(step?.expression || ''))
      .filter(Boolean),
  }));

  const prompt = `
Create at most ${targetCount} source-grounded multiple-choice questions for
${subject}, Unit ${unitNumber}: ${unitTitle}.

Use only facts explicitly contained in the supplied source passages. A
PARTIALLY_SUPPORTED concept may only produce a question whose answer is
explicitly stated in that concept's source passage. Do not use outside
knowledge, assumptions, or missing textbook facts. Do not create questions
just to reach the requested count. Return fewer or zero questions if needed.

Each question must:
- Have exactly four distinct, non-empty options.
- Have exactly one correct answer.
- Use the exact candidateId, page number, and source passage from the input.
- Have a correct option supported directly by that source passage.
- Have an explanation that does not add unsupported facts.
- Avoid ambiguous distractors.

Input:
${JSON.stringify(contexts)}

Return JSON only, conforming to the response schema.
`;

  const ai = getGenAIClient();
  const { response, modelUsed } = await generateContentWithTimeoutAndFallback(
    ai,
    {
      contents: prompt,
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
                  candidateId: { type: Type.STRING },
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
                  'candidateId',
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
    70000
  );

  let parsed: any;
  try {
    parsed = JSON.parse(String(response.text || '{}'));
  } catch {
    const error: any = new Error('Gemini returned an invalid JSON response.');
    error.code = 'INVALID_MODEL_RESPONSE';
    error.retryable = false;
    throw error;
  }

  if (!Array.isArray(parsed.mcqs)) {
    const error: any = new Error('Gemini response did not contain an MCQ array.');
    error.code = 'INVALID_MODEL_RESPONSE';
    error.retryable = false;
    throw error;
  }

  const contextById = new Map(
    contexts.map((context) => [context.candidateId, context])
  );
  const seenQuestions = new Set(
    existingMcqs.map((mcq) => normalize(mcq?.question)).filter(Boolean)
  );
  const validMcqs: any[] = [];
  let rejectedCount = 0;

  for (const raw of parsed.mcqs) {
    const context = contextById.get(String(raw?.candidateId || ''));
    const question = String(raw?.question || '').trim();
    const explanation = String(raw?.explanation || '').trim();
    const quote = String(raw?.supportingSourcePassage || '').trim();
    const options = Array.isArray(raw?.options)
      ? raw.options.map((option: any) => String(option).trim())
      : [];
    const correctIndex = Number(raw?.correctIndex);
    const normalizedQuestion = normalize(question);

    if (!context || question.length < 8 || explanation.length < 3) {
      rejectedCount += 1;
      continue;
    }
    if (options.length !== 4 || options.some((option: string) => !option)) {
      rejectedCount += 1;
      continue;
    }
    if (new Set(options.map(normalize)).size !== 4) {
      rejectedCount += 1;
      continue;
    }
    if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex > 3) {
      rejectedCount += 1;
      continue;
    }
    if (seenQuestions.has(normalizedQuestion)) {
      rejectedCount += 1;
      continue;
    }

    // The returned citation must be a verbatim substring of the eligible source.
    if (!sourceContains(context.sourcePassage, quote)) {
      rejectedCount += 1;
      continue;
    }

    // Do not accept a wrong page, candidate keyword, or unsupported answer.
    if (Number(raw.sourcePageReference) !== context.pageNumber) {
      rejectedCount += 1;
      continue;
    }
    if (normalize(raw.relatedKeyword) !== normalize(context.keyword)) {
      rejectedCount += 1;
      continue;
    }
    if (!sourceContains(context.sourcePassage, options[correctIndex])) {
      rejectedCount += 1;
      continue;
    }

    seenQuestions.add(normalizedQuestion);
    validMcqs.push({
      id: `mcq-${crypto.randomUUID()}`,
      question,
      options: options as [string, string, string, string],
      correctIndex,
      explanation,
      // Store the canonical source excerpt rather than relying on model paraphrase.
      supportingSourcePassage: context.sourcePassage,
      sourcePageReference: context.pageNumber,
      relatedKeyword: context.keyword || 'Unit Concept',
    });
  }

  const status =
    validMcqs.length === 0
      ? 'PARTIAL'
      : rejectedCount > 0 || validMcqs.length < targetCount
        ? 'PARTIAL'
        : 'COMPLETED';

  return {
    status,
    modelUsed,
    mcqs: validMcqs,
    mcqGenerationNote:
      String(parsed.mcqGenerationNote || '').trim() ||
      (validMcqs.length > 0
        ? `Generated ${validMcqs.length} question(s) and rejected ${rejectedCount} question(s) that failed source or format validation.`
        : 'No generated question passed the source, citation, and answer validation checks.'),
  };
                    }
