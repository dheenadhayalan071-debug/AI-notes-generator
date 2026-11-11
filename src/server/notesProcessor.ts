/**
 * Unified server-side notes processor
 * Exports decoupled note processing and traceable MCQ synthesis
 */
export {
  processNotesCore,
  getGenAIClient,
  generateContentWithFallback,
  normalizeText,
  evaluateGroundingAndSufficiency,
  PRIMARY_GEMINI_MODEL_ID,
  FALLBACK_GEMINI_MODEL_ID,
} from '../../api/notes/process';

export {
  regenerateMcqsCore,
  generateContentWithTimeoutAndFallback,
} from '../../api/notes/regenerate-mcqs';
