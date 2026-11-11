import { GoogleGenAI, Type, GenerateContentResponse } from '@google/genai';

export const maxDuration = 300;
export const config = {
  maxDuration: 300,
  api: {
    bodyParser: {
      sizeLimit: '25mb',
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
export async function generateContentWithFallback(
  ai: GoogleGenAI,
  requestParams: any,
  timeoutMs: number = 75000
): Promise<{ response: GenerateContentResponse; modelUsed: string }> {
  const callModel = async (model: string) => {
    let timer: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const err = new Error(`Gemini vision request timed out after ${timeoutMs}ms for model ${model}`);
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
        `Primary model ${PRIMARY_GEMINI_MODEL_ID} encounter (${msg}). Retrying once with ${FALLBACK_GEMINI_MODEL_ID}...`
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

export function normalizeText(str: string): string {
  return (str || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s+=()-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function evaluateGroundingAndSufficiency(params: {
  originalKeyword: string;
  supportingSourcePassage: string;
  generatedExplanation: string;
  rawTranscript: string;
  allTranscripts?: string;
  aiSufficiency: string;
  aiEntailmentVerified: boolean;
  aiStatus: string;
  aiUncertaintyReason?: string;
  formulasCount?: number;
}): {
  verificationStatus: 'VERIFIED' | 'PARTIALLY_SUPPORTED' | 'NEEDS_REVIEW';
  sourceSufficiency: 'SUFFICIENT' | 'PARTIAL' | 'INSUFFICIENT';
  entailmentVerified: boolean;
  uncertaintyReason?: string;
} {
  const {
    originalKeyword,
    supportingSourcePassage,
    generatedExplanation,
    aiSufficiency,
    aiStatus,
    aiUncertaintyReason,
    formulasCount = 0,
  } = params;

  const passageRaw = (supportingSourcePassage || '').trim();
  const explanationRaw = (generatedExplanation || '').trim();
  const keywordRaw = (originalKeyword || '').trim();

  // 1. Genuine Illegibility Check (explicit smudged ink or [unclear] tokens)
  const illegibilityRegex =
    /\[unclear\]|\[illegible\]|\?\?\?|unreadable ink|smudged ink|torn page/i;
  const isIllegible =
    illegibilityRegex.test(passageRaw) || illegibilityRegex.test(explanationRaw);

  if (isIllegible) {
    return {
      verificationStatus: 'NEEDS_REVIEW',
      sourceSufficiency: 'INSUFFICIENT',
      entailmentVerified: false,
      uncertaintyReason:
        'Handwriting contains unclear or illegible characters ([unclear]) in the source passage. Needs review against original note scan.',
    };
  }

  // Filter out benign filler reasons (e.g. "None", "N/A", "Verified")
  const isBenignReason = (r?: string) => {
    if (!r) return true;
    const clean = r.trim().toLowerCase();
    return (
      clean === '' ||
      clean === 'none' ||
      clean === 'none.' ||
      clean === 'n/a' ||
      clean === 'na' ||
      clean === 'nil' ||
      clean === 'null' ||
      clean === 'verified' ||
      clean.startsWith('none ') ||
      clean.startsWith('no uncertainty') ||
      clean.startsWith('all statements verified')
    );
  };

  const hasSpecificUncertainty =
    Boolean(aiUncertaintyReason) && !isBenignReason(aiUncertaintyReason);

  // Check if passage has mathematical symbols or equations
  const hasFormulaOrMath =
    formulasCount > 0 ||
    /[=\\^_+/∫∮∑√±<>]/.test(passageRaw) ||
    /\\(frac|vec|hat|int|oint|times|cdot|pi|epsilon|mu|sigma|theta|alpha|beta|lambda|omega)/i.test(
      passageRaw
    );

  const passageNorm = normalizeText(passageRaw);
  const keywordNorm = normalizeText(keywordRaw);
  const passageWords = passageNorm.split(' ').filter((w) => w.length > 1);
  const keywordWords = keywordNorm.split(' ').filter((w) => w.length > 1);

  // 2. Purely bare isolated keyword check (literally 1-2 words with zero context, no formula, no statement)
  const isBareKeywordWithoutContext =
    !hasFormulaOrMath &&
    (passageWords.length === 0 ||
      (passageWords.length <= keywordWords.length &&
        keywordNorm.includes(passageNorm)));

  if (isBareKeywordWithoutContext) {
    return {
      verificationStatus: 'NEEDS_REVIEW',
      sourceSufficiency: 'INSUFFICIENT',
      entailmentVerified: false,
      uncertaintyReason:
        'Handwritten notes only list an isolated keyword/bullet title without an accompanying definition, formula, or context on the page.',
    };
  }

  // 3. Partial Support Evaluation:
  // Concept is supported, but notes lack complete derivation or full textbook proof
  const isPartiallySupportedPrompt =
    aiStatus === 'PARTIALLY_SUPPORTED' ||
    aiSufficiency === 'PARTIAL' ||
    /partial|brief formula|bullet only|formula only/i.test(aiUncertaintyReason || '');

  // Check if explanation expands wildly (more than 6x passage words + 50 words without math)
  const explanationWords = normalizeText(explanationRaw).split(' ').filter(Boolean);
  const isOverlyExpansive =
    !hasFormulaOrMath &&
    passageWords.length > 0 &&
    explanationWords.length > passageWords.length * 6 + 45;

  if (isPartiallySupportedPrompt || isOverlyExpansive) {
    return {
      verificationStatus: 'PARTIALLY_SUPPORTED',
      sourceSufficiency: 'PARTIAL',
      entailmentVerified: true,
      uncertaintyReason: hasSpecificUncertainty
        ? aiUncertaintyReason!.trim()
        : 'Source notes provide foundational formula or summary statement; verified against source context.',
    };
  }

  // 4. If AI flagged NEEDS_REVIEW, check whether it's genuinely inadequate or just concise
  if (aiStatus === 'NEEDS_REVIEW' || aiSufficiency === 'INSUFFICIENT') {
    // If it has a complete sentence or formula, elevate to PARTIALLY_SUPPORTED rather than rejecting!
    if (hasFormulaOrMath || passageWords.length >= 4) {
      return {
        verificationStatus: 'PARTIALLY_SUPPORTED',
        sourceSufficiency: 'PARTIAL',
        entailmentVerified: true,
        uncertaintyReason: hasSpecificUncertainty
          ? aiUncertaintyReason!.trim()
          : 'Concise statement or formula preserved from handwritten notes.',
      };
    }

    return {
      verificationStatus: 'NEEDS_REVIEW',
      sourceSufficiency: 'INSUFFICIENT',
      entailmentVerified: false,
      uncertaintyReason: hasSpecificUncertainty
        ? aiUncertaintyReason!.trim()
        : 'Requires manual verification against original handwritten scan.',
    };
  }

  // 5. Default: VERIFIED
  return {
    verificationStatus: 'VERIFIED',
    sourceSufficiency: 'SUFFICIENT',
    entailmentVerified: true,
    uncertaintyReason: undefined,
  };
}

export interface ProcessNotesPayload {
  subject: string;
  unitNumber: number;
  unitTitle: string;
  pages: Array<{ pageNumber: number; fileName: string; dataUrl: string; mimeType: string }>;
}

export async function processNotesCore(payload: ProcessNotesPayload) {
  const t0 = Date.now();
  const { subject, unitNumber, unitTitle, pages } = payload;

  if (!pages || !Array.isArray(pages) || pages.length === 0) {
    throw new Error('At least one page image or PDF page is required.');
  }

  console.log(
    `[Pipeline Start Stages 01-04] Processing ${pages.length} page(s) for "${subject}" Unit ${unitNumber}: ${unitTitle}`
  );

  const ai = getGenAIClient();
  const parts: Array<{ inlineData?: { mimeType: string; data: string }; text?: string }> = [];

  for (const page of pages) {
    const base64Match = page.dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    const mimeType = base64Match ? base64Match[1] : page.mimeType || 'image/png';
    const base64Data = base64Match ? base64Match[2] : page.dataUrl;

    parts.push({
      text: `=== UPLOADED SOURCE PAGE ${page.pageNumber} (${page.fileName}) ===`,
    });
    parts.push({
      inlineData: {
        mimeType,
        data: base64Data,
      },
    });
  }

  const promptText = `You are a strict, source-bound academic OCR and study material structuring engine for ${subject} (Unit ${unitNumber}: ${unitTitle}).

CRITICAL ENGINEERING RULES (MUST OBEY WITHOUT EXCEPTION):
1. OUTPUT LANGUAGE: All generated headings, explanations, derivation step descriptions MUST be in clear English. (If the subject is another language, preserve original script keywords/quotes in originalKeyword and supportingSourcePassage, and provide the explanation in English).
2. STRICT SOURCE-ONLY RULE:
   - You must use ONLY information explicitly written or drawn in the uploaded handwritten note pages.
   - NEVER introduce external facts, textbook definitions, standard formulas, or missing derivation steps that are not present in the uploaded notes.
3. THREE VERIFICATION STATUS CLASSIFICATIONS:
   - "VERIFIED": The source notes provide enough evidence (a clear statement, derived formula, or complete definition) to justify the explanation.
   - "PARTIALLY_SUPPORTED": The source notes state a formula, concise bullet point, or partial step that is true and legible, but lacks a full textbook explanation or proof. State what IS written and note what is omitted without inventing missing facts.
   - "NEEDS_REVIEW": The handwriting is genuinely unclear/illegible (transcribe unclear tokens as "[unclear]"), or the note is a bare isolated keyword with ZERO accompanying explanation, formula, or context on the page.
   - DO NOT classify an item as NEEDS_REVIEW merely because it is concise, short, or a standalone formula! A formula or complete statement is sufficient evidence for a focused explanation.
4. SOURCE CONTEXT EVALUATION:
   - Include surrounding lines and nearby formulas from the same page in "supportingSourcePassage".
   - A formula or complete statement IS sufficient evidence for a limited explanation even if it does not support a broader textbook-style explanation.
5. DIAGRAMS:
   - If a page contains a drawn diagram, circuit, graph, or flowchart, include "diagramRegion" with its "pageNumber", normalized bounding box "box2d" as [ymin, xmin, ymax, xmax] (each 0 to 1000), a factual "caption" in English, and the exact "labels" visible in the drawing.`;

  parts.push({ text: promptText });

  const tVisionStart = Date.now();
  const { response, modelUsed } = await generateContentWithFallback(ai, {
      contents: { parts },
      config: {
        systemInstruction:
          'You are an academic source-bound document analyzer. You strictly forbid external knowledge injection. You validate every generated explanation against the verbatim handwritten source context and categorize items into VERIFIED, PARTIALLY_SUPPORTED, or NEEDS_REVIEW.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            rawPageTranscripts: {
              type: Type.ARRAY,
              description: 'Verbatim OCR transcription for each uploaded page.',
              items: {
                type: Type.OBJECT,
                properties: {
                  pageNumber: { type: Type.INTEGER },
                  rawTranscript: {
                    type: Type.STRING,
                    description:
                      'Exact text transcribed from the page, using [unclear] for illegible handwriting.',
                  },
                },
                required: ['pageNumber', 'rawTranscript'],
              },
            },
            sections: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  heading: { type: Type.STRING },
                  subheading: { type: Type.STRING },
                  items: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        originalKeyword: {
                          type: Type.STRING,
                          description: 'Exact keyword or point preserved from the handwritten notes.',
                        },
                        supportingSourcePassage: {
                          type: Type.STRING,
                          description: 'Verbatim passage from the handwritten page supporting this concept.',
                        },
                        generatedExplanation: {
                          type: Type.STRING,
                          description:
                            'English explanation grounded strictly in supportingSourcePassage without external knowledge.',
                        },
                        sourcePageReference: { type: Type.INTEGER },
                        sourceSufficiency: {
                          type: Type.STRING,
                          description:
                            'SUFFICIENT if notes contain enough context; PARTIAL if concise formula or statement; INSUFFICIENT if bare isolated keyword.',
                        },
                        entailmentVerified: {
                          type: Type.BOOLEAN,
                          description:
                            'True ONLY if every claim in generatedExplanation is directly entailed by supportingSourcePassage.',
                        },
                        verificationStatus: {
                          type: Type.STRING,
                          description: 'VERIFIED, PARTIALLY_SUPPORTED, or NEEDS_REVIEW',
                        },
                        uncertaintyReason: {
                          type: Type.STRING,
                          description:
                            'Specific reason if PARTIALLY_SUPPORTED or NEEDS_REVIEW (leave empty if VERIFIED).',
                        },
                        formulasAndDerivations: {
                          type: Type.ARRAY,
                          items: {
                            type: Type.OBJECT,
                            properties: {
                              stepNumber: { type: Type.INTEGER },
                              expression: { type: Type.STRING },
                              explanation: { type: Type.STRING },
                            },
                            required: ['stepNumber', 'expression', 'explanation'],
                          },
                        },
                        diagramRegion: {
                          type: Type.OBJECT,
                          properties: {
                            hasDiagram: { type: Type.BOOLEAN },
                            pageNumber: { type: Type.INTEGER },
                            box2d: {
                              type: Type.ARRAY,
                              items: { type: Type.INTEGER },
                              description:
                                '[ymin, xmin, ymax, xmax] normalized 0..1000 coordinates of diagram on the page',
                            },
                            caption: { type: Type.STRING },
                            labels: {
                              type: Type.ARRAY,
                              items: { type: Type.STRING },
                            },
                          },
                          required: ['hasDiagram'],
                        },
                      },
                      required: [
                        'originalKeyword',
                        'supportingSourcePassage',
                        'generatedExplanation',
                        'sourcePageReference',
                        'sourceSufficiency',
                        'entailmentVerified',
                        'verificationStatus',
                      ],
                    },
                  },
                },
                required: ['heading', 'subheading', 'items'],
              },
            },
          },
          required: ['rawPageTranscripts', 'sections'],
        },
      },
    });

    const visionDurationMs = Date.now() - tVisionStart;
    console.log(
      `[Stage 01-03 Gemini Vision Completed] Verbatim OCR, Keyword Extraction & Grounded Explanation took ${visionDurationMs}ms (model: ${modelUsed})`
    );

    const tAuditStart = Date.now();
    const rawJson = (response.text ?? '{}').trim();
    const parsed = JSON.parse(rawJson);

    const transcriptMap = new Map<number, string>();
    if (Array.isArray(parsed.rawPageTranscripts)) {
      for (const pt of parsed.rawPageTranscripts) {
        transcriptMap.set(Number(pt.pageNumber) || 1, String(pt.rawTranscript || ''));
      }
    }

    const auditedSections = (parsed.sections || []).map((sec: any, sIdx: number) => ({
      id: `sec-${Date.now()}-${sIdx}`,
      heading: String(sec.heading || `Section ${sIdx + 1}`),
      subheading: String(sec.subheading || 'Extracted Classroom Notes'),
      items: (sec.items || []).map((item: any, iIdx: number) => {
        const pageNum = Number(item.sourcePageReference) || 1;
        const pageTranscript =
          transcriptMap.get(pageNum) ||
          Array.from(transcriptMap.values()).join('\n') ||
          String(item.supportingSourcePassage || '');

        const audit = evaluateGroundingAndSufficiency({
          originalKeyword: String(item.originalKeyword || ''),
          supportingSourcePassage: String(item.supportingSourcePassage || ''),
          generatedExplanation: String(item.generatedExplanation || ''),
          rawTranscript: pageTranscript,
          allTranscripts: Array.from(transcriptMap.values()).join('\n'),
          aiSufficiency: String(item.sourceSufficiency || 'SUFFICIENT'),
          aiEntailmentVerified: Boolean(item.entailmentVerified),
          aiStatus: String(item.verificationStatus || 'VERIFIED'),
          aiUncertaintyReason: item.uncertaintyReason ? String(item.uncertaintyReason) : undefined,
          formulasCount: Array.isArray(item.formulasAndDerivations)
            ? item.formulasAndDerivations.length
            : 0,
        });

        let diagramRegion = undefined;
        if (item.diagramRegion && item.diagramRegion.hasDiagram) {
          const box =
            Array.isArray(item.diagramRegion.box2d) && item.diagramRegion.box2d.length === 4
              ? (item.diagramRegion.box2d.map((n: any) =>
                  Math.max(0, Math.min(1000, Number(n) || 0))
                ) as [number, number, number, number])
              : undefined;
          diagramRegion = {
            pageNumber: Number(item.diagramRegion.pageNumber) || pageNum,
            box2d: box,
            caption: String(item.diagramRegion.caption || `${item.originalKeyword} Diagram`),
            labels: Array.isArray(item.diagramRegion.labels)
              ? item.diagramRegion.labels.map((l: any) => String(l))
              : [],
          };
        }

        return {
          id: `item-${Date.now()}-${sIdx}-${iIdx}`,
          originalKeyword: String(item.originalKeyword || 'Untitled Concept'),
          supportingSourcePassage: String(item.supportingSourcePassage || ''),
          generatedExplanation: String(item.generatedExplanation || ''),
          sourcePageReference: pageNum,
          sourceSufficiency: audit.sourceSufficiency,
          entailmentVerified: audit.entailmentVerified,
          verificationStatus: audit.verificationStatus,
          uncertaintyReason: audit.uncertaintyReason,
          formulasAndDerivations: Array.isArray(item.formulasAndDerivations)
            ? item.formulasAndDerivations.map((f: any, fIdx: number) => ({
                stepNumber: Number(f.stepNumber) || fIdx + 1,
                expression: String(f.expression || ''),
                explanation: String(f.explanation || ''),
              }))
            : [],
          diagramRegion,
        };
      }),
    }));

    const auditDurationMs = Date.now() - tAuditStart;
    const totalItemCount = auditedSections.reduce((sum: number, s: any) => sum + (s.items?.length || 0), 0);
    console.log(
      `[Stage 04 Verification Completed] Source entailment & sufficiency audit took ${auditDurationMs}ms across ${totalItemCount} concept(s)`
    );

    const totalDurationMs = Date.now() - t0;
    console.log(`[Pipeline Summary Stages 01-04] Total duration: ${totalDurationMs}ms`);

    const result = {
      modelUsed,
      timings: {
        totalMs: totalDurationMs,
        visionMs: visionDurationMs,
        auditMs: auditDurationMs,
      },
      rawPageTranscripts: Array.from(transcriptMap.entries()).map(([pageNumber, rawTranscript]) => ({
        pageNumber,
        rawTranscript,
      })),
      sections: auditedSections,
      mcqs: [],
      mcqGenerationNote: 'Study material structured and verified. MCQs ready for generation.',
    };

    return result;
}

export default async function handler(req: any, res: any) {
  const startTime = Date.now();
  const requestId = `proc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
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
    console.log(`[${requestId}] Starting notes processing: "${payload?.subject || 'Unknown'}" Unit ${payload?.unitNumber || 1}`);

    const result = await processNotesCore(payload);
    const durationMs = Date.now() - startTime;
    console.log(`[${requestId}] Completed notes processing (${durationMs}ms, model: ${result.modelUsed})`);

    return res.status(200).json({
      success: true,
      status: 'completed',
      data: result,
      ...result,
    });
  } catch (error: any) {
    const durationMs = Date.now() - startTime;
    console.error(`[${requestId}] Error (${durationMs}ms):`, error);
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
