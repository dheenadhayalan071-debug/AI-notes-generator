export type ModuleId = 'dashboard' | 'upload' | 'processing' | 'editor' | 'pdf_mcq';

export type VerificationStatus = 'VERIFIED' | 'NEEDS_REVIEW';

export type SourceSufficiency = 'SUFFICIENT' | 'INSUFFICIENT';

export type BackupRestoreMode = 'merge' | 'replace';

export interface SourcePage {
  pageNumber: number;
  fileName: string;
  dataUrl: string;
  mimeType: string;
  rawTranscript: string;
  rotation?: number;
}

export interface DerivationStep {
  stepNumber: number;
  expression: string;
  explanation: string;
}

export interface DiagramRegion {
  pageNumber: number;
  /** Normalized bounding box [ymin, xmin, ymax, xmax] in 0..1000 scale */
  box2d?: [number, number, number, number];
  croppedDataUrl?: string;
  caption: string;
  labels: string[];
}

export interface VerifiedConceptItem {
  id: string;
  originalKeyword: string;
  supportingSourcePassage: string;
  generatedExplanation: string;
  sourcePageReference: number;
  sourceSufficiency: SourceSufficiency;
  entailmentVerified: boolean;
  verificationStatus: VerificationStatus;
  uncertaintyReason?: string;
  formulasAndDerivations: DerivationStep[];
  diagramRegion?: DiagramRegion;
}

export interface StudySection {
  id: string;
  heading: string;
  subheading: string;
  items: VerifiedConceptItem[];
}

export interface PracticeMCQ {
  id: string;
  question: string;
  options: [string, string, string, string];
  correctIndex: number;
  explanation: string;
  supportingSourcePassage: string;
  sourcePageReference: number;
  relatedKeyword: string;
}

export type McqJobStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'PARTIAL' | 'FAILED';

export interface StudyUnitDocument {
  id: string;
  subject: string;
  unitNumber: number;
  unitTitle: string;
  createdAt: string;
  updatedAt: string;
  sourcePages: SourcePage[];
  sections: StudySection[];
  mcqs: PracticeMCQ[];
  mcqGenerationNote?: string;
  mcqStatus?: McqJobStatus;
}
