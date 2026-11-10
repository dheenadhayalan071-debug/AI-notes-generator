import { GoogleGenAI, Type, GenerateContentResponse } from '@google/genai';

export const PRIMARY_GEMINI_MODEL_ID = 'gemini-3.8-flash';
export const FALLBACK_GEMINI_MODEL_ID = 'gemini-2.5-flash';

export function getGenAIClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not configured on the server. Please configure it in Settings > Secrets or in your Vercel Environment Variables.'
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
 * Execute generateContent with automatic model fallback if gemini-3.8-flash experiences demand spikes
 */
export async function generateContentWithFallback(
  ai: GoogleGenAI,
  requestParams: any
): Promise<{ response: GenerateContentResponse; modelUsed: string }> {
  try {
    const response = await ai.models.generateContent({
      ...requestParams,
      model: PRIMARY_GEMINI_MODEL_ID,
    });
    return { response, modelUsed: PRIMARY_GEMINI_MODEL_ID };
  } catch (error: any) {
    const status = error?.status || error?.statusCode;
    const msg = error?.message || '';
    const isOverloadedOrUnavailable =
      status === 503 ||
      status === 429 ||
      /unavailable|high demand|overloaded|resource_exhausted/i.test(msg);

    if (isOverloadedOrUnavailable) {
      console.warn(
        `Primary model ${PRIMARY_GEMINI_MODEL_ID} unavailable (${msg}). Falling back to ${FALLBACK_GEMINI_MODEL_ID}...`
      );
      const response = await ai.models.generateContent({
        ...requestParams,
        model: FALLBACK_GEMINI_MODEL_ID,
      });
      return { response, modelUsed: FALLBACK_GEMINI_MODEL_ID };
    }
    throw error;
  }
}

/**
 * Normalize text for deterministic lexical/context grounding checks
 */
export function normalizeText(str: string): string {
  return (str || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s+=()-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Computes how well a supporting passage is grounded in the raw page transcript,
 * and checks whether the source passage has enough contextual substance to support
 * an expanded explanation without introducing external facts.
 */
export function evaluateGroundingAndSufficiency(params: {
  originalKeyword: string;
  supportingSourcePassage: string;
  generatedExplanation: string;
  rawTranscript: string;
  aiSufficiency: string;
  aiEntailmentVerified: boolean;
  aiStatus: string;
  aiUncertaintyReason?: string;
}): {
  verificationStatus: 'VERIFIED' | 'NEEDS_REVIEW';
  sourceSufficiency: 'SUFFICIENT' | 'INSUFFICIENT';
  entailmentVerified: boolean;
  uncertaintyReason?: string;
} {
  const {
    originalKeyword,
    supportingSourcePassage,
    generatedExplanation,
    rawTranscript,
    aiSufficiency,
    aiEntailmentVerified,
    aiStatus,
    aiUncertaintyReason,
  } = params;

  const reasons: string[] = [];
  if (aiUncertaintyReason && aiUncertaintyReason.trim().length > 0) {
    reasons.push(aiUncertaintyReason.trim());
  }

  const passageRaw = (supportingSourcePassage || '').trim();
  const explanationRaw = (generatedExplanation || '').trim();
  const transcriptNorm = normalizeText(rawTranscript);
  const passageNorm = normalizeText(passageRaw);

  // 1. Check for illegibility markers in either source passage or explanation
  const illegibilityRegex =
    /\[unclear\]|\[illegible\]|\?\?\?|illegible|unreadable|smudged|cut off|incomplete step/i;
  if (illegibilityRegex.test(passageRaw) || illegibilityRegex.test(explanationRaw)) {
    reasons.push('Handwriting contains unclear or illegible characters in the source passage.');
  }

  // 2. Check source passage sufficiency (cannot be just a bare keyword with no explanation in notes)
  const passageWords = passageNorm.split(' ').filter((w) => w.length > 1);
  const keywordWords = normalizeText(originalKeyword).split(' ').filter((w) => w.length > 1);

  let sourceSufficiency: 'SUFFICIENT' | 'INSUFFICIENT' =
    aiSufficiency === 'INSUFFICIENT' ? 'INSUFFICIENT' : 'SUFFICIENT';

  if (
    passageWords.length < 4 ||
    passageWords.length <= keywordWords.length + 1 ||
    /insufficient|only keyword|bare heading|no explanation in notes/i.test(explanationRaw)
  ) {
    sourceSufficiency = 'INSUFFICIENT';
    reasons.push(
      'Handwritten notes only list this keyword/fragment without sufficient explanatory context. Flagged to prevent adding external information.'
    );
  }

  // 3. Verify that supportingSourcePassage actually exists in the raw transcript of that page
  let transcriptMatchScore = 0;
  if (transcriptNorm.length > 0 && passageWords.length > 0) {
    const matchedTokens = passageWords.filter((token) => transcriptNorm.includes(token));
    transcriptMatchScore = matchedTokens.length / passageWords.length;
    if (transcriptMatchScore < 0.65) {
      reasons.push(
        `Source passage could not be strongly matched against Page OCR transcript (${Math.round(
          transcriptMatchScore * 100
        )}% lexical overlap).`
      );
    }
  } else {
    reasons.push('Missing raw OCR transcript for the cited source page.');
  }

  // 4. Verify semantic entailment & absence of external textbook padding
  let entailmentVerified = Boolean(aiEntailmentVerified);
  if (sourceSufficiency === 'INSUFFICIENT' || transcriptMatchScore < 0.65) {
    entailmentVerified = false;
  }

  // Check if explanation is disproportionately long compared to a short source note (sign of external knowledge injection)
  const explanationWords = normalizeText(explanationRaw).split(' ').filter(Boolean);
  if (passageWords.length > 0 && explanationWords.length > passageWords.length * 4.5 + 25) {
    entailmentVerified = false;
    reasons.push(
      'Generated explanation expands significantly beyond the brief source passage; requires review to confirm no external facts were added.'
    );
  }

  if (!entailmentVerified && reasons.length === 0) {
    reasons.push(
      'Explanation contains statements that could not be strictly entailed from the handwritten passage alone.'
    );
  }

  const shouldFlag =
    aiStatus === 'NEEDS_REVIEW' ||
    sourceSufficiency === 'INSUFFICIENT' ||
    !entailmentVerified ||
    reasons.length > 0;

  return {
    verificationStatus: shouldFlag ? 'NEEDS_REVIEW' : 'VERIFIED',
    sourceSufficiency,
    entailmentVerified: !shouldFlag,
    uncertaintyReason: shouldFlag
      ? Array.from(new Set(reasons)).join(' ') ||
        'Requires manual verification against original handwritten scan.'
      : undefined,
  };
}

export interface ProcessNotesPayload {
  subject: string;
  unitNumber: number;
  unitTitle: string;
  pages: Array<{ pageNumber: number; fileName: string; dataUrl: string; mimeType: string }>;
}

export async function processNotesCore(payload: ProcessNotesPayload) {
  const { subject, unitNumber, unitTitle, pages } = payload;

  if (!pages || !Array.isArray(pages) || pages.length === 0) {
    throw new Error('At least one page image or PDF page is required.');
  }

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
1. OUTPUT LANGUAGE: All generated headings, explanations, derivation step descriptions, and MCQs MUST be in clear English. (If the subject is Tamil or other languages, preserve original script keywords/quotes in originalKeyword and supportingSourcePassage, and provide the explanation in English).
2. STRICT SOURCE-ONLY RULE:
   - You must use ONLY information explicitly written or drawn in the uploaded handwritten note pages.
   - NEVER introduce external facts, textbook definitions, standard formulas, or missing derivation steps that are not present in the uploaded notes.
3. INSUFFICIENT CONTEXT HANDLING:
   - If a handwritten note only lists a keyword, bullet title, or partial formula WITHOUT enough written detail in the notes to explain it, set:
     - "sourceSufficiency": "INSUFFICIENT"
     - "entailmentVerified": false
     - "verificationStatus": "NEEDS_REVIEW"
     - "generatedExplanation": State ONLY what is literally visible in the notes and explicitly note: "[Insufficient detail in uploaded notes to expand this keyword without external information — please review or add class notes.]"
     - "uncertaintyReason": Explain exactly what detail is missing or unclear in the handwritten notes.
4. UNCLEAR HANDWRITING & DERIVATION GAPS:
   - Never guess illegible words, symbols, or subscripts. Transcribe unclear parts as "[unclear]" in rawPageTranscripts and supportingSourcePassage, and set "verificationStatus": "NEEDS_REVIEW".
   - Include step-by-step formulas and derivations in "formulasAndDerivations" ONLY when present in the original notes.
5. DIAGRAMS:
   - If a page contains a drawn diagram, circuit, graph, or flowchart, include "diagramRegion" with its "pageNumber", normalized bounding box "box2d" as [ymin, xmin, ymax, xmax] (each 0 to 1000), a factual "caption" in English, and the exact "labels" visible in the drawing.
6. MCQ RELIABILITY & TRACEABILITY:
   - Generate multiple-choice questions ("mcqs") strictly from facts explicitly stated in the uploaded notes.
   - Every MCQ MUST include a verbatim "supportingSourcePassage" and "sourcePageReference" proving that both the question and correct answer come directly from the uploaded notes.
   - If the uploaded notes do not contain enough clear, factual statements to support multiple-choice questions without external knowledge, return fewer questions (or an empty array) and explain why in "mcqGenerationNote".`;

  parts.push({ text: promptText });

  const { response, modelUsed } = await generateContentWithFallback(ai, {
    contents: { parts },
    config: {
      systemInstruction:
        'You are an academic source-bound document analyzer. You strictly forbid external knowledge injection. You validate every generated explanation against the verbatim handwritten source context and flag any uncertain, illegible, or under-specified item as NEEDS_REVIEW.',
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
                          'SUFFICIENT if notes contain enough context to explain; INSUFFICIENT if bare keyword or incomplete.',
                      },
                      entailmentVerified: {
                        type: Type.BOOLEAN,
                        description:
                          'True ONLY if every claim in generatedExplanation is directly entailed by supportingSourcePassage.',
                      },
                      verificationStatus: {
                        type: Type.STRING,
                        description: 'VERIFIED or NEEDS_REVIEW',
                      },
                      uncertaintyReason: {
                        type: Type.STRING,
                        description:
                          'Reason if flagged as NEEDS_REVIEW (e.g. illegible handwriting or insufficient source context).',
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
                supportingSourcePassage: {
                  type: Type.STRING,
                  description:
                    'Verbatim quote from the uploaded notes that directly proves the correct answer.',
                },
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
          mcqGenerationNote: {
            type: Type.STRING,
            description:
              'Explanation if fewer MCQs were generated due to limited or uncertain source material.',
          },
        },
        required: ['rawPageTranscripts', 'sections', 'mcqs'],
      },
    },
  });

  const rawJson = (response.text ?? '{}').trim();
  const parsed = JSON.parse(rawJson);

  // Build page transcript map for deterministic server-side grounding audit
  const transcriptMap = new Map<number, string>();
  if (Array.isArray(parsed.rawPageTranscripts)) {
    for (const pt of parsed.rawPageTranscripts) {
      transcriptMap.set(Number(pt.pageNumber) || 1, String(pt.rawTranscript || ''));
    }
  }

  // Run deterministic grounding & sufficiency audit on every generated concept item
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
        aiSufficiency: String(item.sourceSufficiency || 'SUFFICIENT'),
        aiEntailmentVerified: Boolean(item.entailmentVerified),
        aiStatus: String(item.verificationStatus || 'NEEDS_REVIEW'),
        aiUncertaintyReason: item.uncertaintyReason ? String(item.uncertaintyReason) : undefined,
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

  // Audit MCQs so only questions with verifiable source passages are kept
  const rawMcqs = Array.isArray(parsed.mcqs) ? parsed.mcqs : [];
  const verifiedMcqs = rawMcqs
    .filter((mcq: any) => {
      const quote = String(mcq.supportingSourcePassage || '').trim();
      const opts = Array.isArray(mcq.options) ? mcq.options : [];
      if (quote.length < 10 || opts.length < 2) return false;
      if (/\[unclear\]|\[illegible\]/i.test(quote)) return false;

      const pageNum = Number(mcq.sourcePageReference) || 1;
      const pageTranscript = normalizeText(
        transcriptMap.get(pageNum) || Array.from(transcriptMap.values()).join(' ')
      );
      const quoteWords = normalizeText(quote)
        .split(' ')
        .filter((w) => w.length > 2);
      if (pageTranscript.length > 0 && quoteWords.length > 0) {
        const matches = quoteWords.filter((w) => pageTranscript.includes(w));
        if (matches.length / quoteWords.length < 0.55) {
          return false;
        }
      }
      return true;
    })
    .map((mcq: any, mIdx: number) => {
      const opts = (mcq.options || []).slice(0, 4).map((o: any) => String(o));
      while (opts.length < 4) {
        opts.push('Not stated in the uploaded notes');
      }
      return {
        id: `mcq-${Date.now()}-${mIdx}`,
        question: String(mcq.question || ''),
        options: opts as [string, string, string, string],
        correctIndex: Math.max(0, Math.min(3, Number(mcq.correctIndex) || 0)),
        explanation: String(mcq.explanation || ''),
        supportingSourcePassage: String(mcq.supportingSourcePassage || ''),
        sourcePageReference: Number(mcq.sourcePageReference) || 1,
        relatedKeyword: String(mcq.relatedKeyword || 'Unit Concept'),
      };
    });

  let mcqGenerationNote = parsed.mcqGenerationNote ? String(parsed.mcqGenerationNote) : undefined;
  if (verifiedMcqs.length < rawMcqs.length) {
    mcqGenerationNote = `${rawMcqs.length - verifiedMcqs.length} candidate question(s) were omitted because they could not be strictly traced to legible passages in the uploaded notes.`;
  } else if (verifiedMcqs.length === 0 && !mcqGenerationNote) {
    mcqGenerationNote =
      'The uploaded notes did not contain enough verified factual statements to generate reliable MCQs without external information.';
  }

  return {
    modelUsed,
    rawPageTranscripts: Array.from(transcriptMap.entries()).map(([pageNumber, rawTranscript]) => ({
      pageNumber,
      rawTranscript,
    })),
    sections: auditedSections,
    mcqs: verifiedMcqs,
    mcqGenerationNote,
  };
}

export async function regenerateMcqsCore(payload: {
  subject: string;
  unitNumber: number;
  unitTitle: string;
  sections: any[];
}) {
  const { subject, unitNumber, unitTitle, sections } = payload;
  if (!sections || !Array.isArray(sections)) {
    throw new Error('Study sections are required to generate MCQs.');
  }

  const verifiedItems = sections.flatMap((sec: any) =>
    (sec.items || []).filter(
      (item: any) =>
        item.verificationStatus === 'VERIFIED' &&
        item.sourceSufficiency !== 'INSUFFICIENT' &&
        String(item.supportingSourcePassage || '').trim().length >= 12
    )
  );

  if (verifiedItems.length === 0) {
    return {
      mcqs: [],
      mcqGenerationNote:
        'No verified concepts with sufficient source passages are available yet. Please review and verify items in the Study Material Editor first.',
    };
  }

  const ai = getGenAIClient();
  const sourceContextPayload = verifiedItems.map((item: any) => ({
    keyword: item.originalKeyword,
    pageNumber: item.sourcePageReference,
    supportingSourcePassage: item.supportingSourcePassage,
    verifiedExplanation: item.generatedExplanation,
    formulas: item.formulasAndDerivations,
  }));

  const { response, modelUsed } = await generateContentWithFallback(ai, {
    contents: `Generate multiple-choice practice questions for ${subject} (Unit ${unitNumber}: ${unitTitle}) strictly using ONLY the following verified source passages and explanations from the student's uploaded notes:

${JSON.stringify(sourceContextPayload, null, 2)}

STRICT RULES:
1. Every question, correct option, and explanation MUST be 100% traceable to the provided "supportingSourcePassage" and "verifiedExplanation".
2. Do NOT use external facts or textbook trivia not present in the JSON above.
3. If only a few questions can be formed without inventing outside facts, return only those questions and explain why in "mcqGenerationNote".
4. Output strictly in English.`,
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
                options: { type: Type.ARRAY, items: { type: Type.STRING } },
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
  });

  const parsed = JSON.parse((response.text ?? '{}').trim());
  const mcqs = (parsed.mcqs || [])
    .filter((m: any) => String(m.supportingSourcePassage || '').trim().length >= 10)
    .map((m: any, idx: number) => {
      const opts = (m.options || []).slice(0, 4).map((o: any) => String(o));
      while (opts.length < 4) opts.push('Not stated in the uploaded notes');
      return {
        id: `mcq-regen-${Date.now()}-${idx}`,
        question: String(m.question || ''),
        options: opts as [string, string, string, string],
        correctIndex: Math.max(0, Math.min(3, Number(m.correctIndex) || 0)),
        explanation: String(m.explanation || ''),
        supportingSourcePassage: String(m.supportingSourcePassage || ''),
        sourcePageReference: Number(m.sourcePageReference) || 1,
        relatedKeyword: String(m.relatedKeyword || 'Unit Concept'),
      };
    });

  return {
    mcqs,
    mcqGenerationNote:
      parsed.mcqGenerationNote ||
      `Generated ${mcqs.length} source-verified practice question(s) directly from your verified unit notes.`,
  };
}
