import React from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  Loader2,
  FileText,
  ArrowRight,
  RefreshCw,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import { StudyUnitDocument, ModuleId } from '../types';

interface AiProcessingModuleProps {
  isProcessing: boolean;
  processingStageIndex: number;
  processingError: string | null;
  activeUnit: StudyUnitDocument | undefined;
  isSynthesizingMcqs?: boolean;
  mcqJobStatus?: string;
  onRetryProcessing: () => void;
  onTriggerMcqSynthesis?: () => void;
  onNavigateModule: (module: ModuleId) => void;
}

const PIPELINE_STAGES = [
  {
    title: '01. Handwritten OCR & Illegibility Scan',
    description:
      'Transcribing handwritten pages verbatim and marking unclear or smudged ink tokens as [unclear] instead of guessing.',
  },
  {
    title: '02. Keyword, Formula & Diagram Extraction',
    description:
      'Identifying every original keyword, step-by-step derivation, and diagram bounding box from the uploaded pages.',
  },
  {
    title: '03. Strict Source-Only Explanation',
    description:
      'Expanding keywords into detailed explanations using only information supported by the uploaded notes—never inventing missing facts.',
  },
  {
    title: '04. Source Verification & Sufficiency Audit',
    description:
      'Verifying that every explanation is entailed by its source passage and flagging unclear handwriting or insufficient context as NEEDS_REVIEW.',
  },
  {
    title: '05. Traceable Source-Only MCQ Synthesis (Independent Job)',
    description:
      'Generating practice multiple-choice questions strictly from sufficiently supported source material without holding up PDF availability.',
  },
];

export const AiProcessingModule: React.FC<AiProcessingModuleProps> = ({
  isProcessing,
  processingStageIndex,
  processingError,
  activeUnit,
  isSynthesizingMcqs = false,
  mcqJobStatus,
  onRetryProcessing,
  onTriggerMcqSynthesis,
  onNavigateModule,
}) => {
  const allItems = activeUnit ? activeUnit.sections.flatMap((s) => s.items) : [];
  const verifiedItems = allItems.filter((i) => i.verificationStatus === 'VERIFIED');
  const partiallySupportedItems = allItems.filter(
    (i) => i.verificationStatus === 'PARTIALLY_SUPPORTED'
  );
  const flaggedItems = allItems.filter((i) => i.verificationStatus === 'NEEDS_REVIEW');

  return (
    <div className="space-y-5 w-full max-w-full overflow-x-hidden">
      <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1 min-w-0">
            <p className="text-xs font-medium text-sky-700">
              03. AI Processing · OCR, Keyword Expansion & Source Verification
            </p>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 break-words">
              {isProcessing
                ? 'Processing Uploaded Handwritten Notes...'
                : activeUnit && !processingError
                ? `Processed: ${activeUnit.subject} — Unit ${activeUnit.unitNumber}: ${activeUnit.unitTitle}`
                : 'AI Processing & Source Verification Pipeline'}
            </h1>
            <p className="text-xs sm:text-sm text-slate-600">
              Handwritten Notes → OCR → Keyword Extraction → Detailed Explanation → Source
              Verification → Review → Immediate PDF Availability.
            </p>
          </div>

          {!isProcessing && activeUnit && !processingError && (
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => onNavigateModule('editor')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
              >
                <FileText className="w-4 h-4 shrink-0" />
                <span>Review in Editor</span>
              </button>
              <button
                type="button"
                onClick={() => onNavigateModule('pdf_mcq')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-lg transition-colors cursor-pointer"
              >
                <span>Download PDF & Study</span>
                <ArrowRight className="w-4 h-4 shrink-0" />
              </button>
            </div>
          )}
        </div>

        {/* 5-Stage Pipeline Tracker */}
        <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
          {PIPELINE_STAGES.map((stage, idx) => {
            const isStage5 = idx === 4;
            const studyMaterialDone = !isProcessing && !processingError && activeUnit !== undefined;

            let isCurrent = false;
            let isCompletedStep = false;

            if (isStage5) {
              if (isSynthesizingMcqs) {
                isCurrent = true;
              } else if (activeUnit?.mcqs && activeUnit.mcqs.length > 0) {
                isCompletedStep = true;
              } else if (studyMaterialDone && activeUnit?.mcqStatus === 'COMPLETED') {
                isCompletedStep = true;
              }
            } else {
              isCurrent = isProcessing && processingStageIndex === idx;
              isCompletedStep = studyMaterialDone || (isProcessing && idx < processingStageIndex);
            }

            return (
              <div
                key={stage.title}
                className={`p-3.5 sm:p-4 flex items-start gap-3 transition-colors ${
                  isCurrent ? 'bg-sky-50/70' : 'bg-white'
                }`}
              >
                <div className="mt-0.5 shrink-0">
                  {isCompletedStep ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                  ) : isCurrent ? (
                    <Loader2 className="w-5 h-5 text-sky-600 animate-spin" />
                  ) : (
                    <div className="w-5 h-5 rounded-full border-2 border-slate-300" />
                  )}
                </div>
                <div className="space-y-0.5 min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-xs sm:text-sm font-bold text-slate-900">{stage.title}</h3>
                    {isStage5 && (
                      <span className="text-[11px] font-mono px-2 py-0.5 rounded font-semibold bg-slate-100 text-slate-700">
                        {isSynthesizingMcqs
                          ? 'PROCESSING'
                          : activeUnit?.mcqs && activeUnit.mcqs.length > 0
                          ? `${activeUnit.mcqs.length} MCQs READY`
                          : activeUnit?.mcqStatus || 'PENDING'}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">{stage.description}</p>
                  {isStage5 && !isSynthesizingMcqs && activeUnit && activeUnit.mcqs.length === 0 && (
                    <div className="pt-2 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={onTriggerMcqSynthesis}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-sky-700 bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-md cursor-pointer"
                      >
                        <RefreshCw className="w-3 h-3" />
                        Generate Practice Questions Now
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {processingError && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-xl space-y-3">
            <div className="flex items-start gap-2.5 text-red-900">
              <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <div className="space-y-1 min-w-0">
                <p className="text-sm font-bold">AI Processing Failed</p>
                <p className="text-xs text-red-800 break-words">{processingError}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onRetryProcessing}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Retry Processing
              </button>
              <button
                type="button"
                onClick={() => onNavigateModule('upload')}
                className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
              >
                Return to Notes Upload
              </button>
            </div>
          </div>
        )}

        {/* Empty State if no notes have been processed yet */}
        {!isProcessing && !processingError && !activeUnit && (
          <div className="p-6 bg-slate-50 border border-slate-200 rounded-xl text-center space-y-3">
            <p className="text-sm font-bold text-slate-900">
              No Handwritten Notes Queued for Processing
            </p>
            <p className="text-xs text-slate-600 max-w-md mx-auto">
              Upload your handwritten classroom images or PDF pages in the Notes Upload module to
              run OCR, keyword expansion, and source verification.
            </p>
            <button
              type="button"
              onClick={() => onNavigateModule('upload')}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-lg cursor-pointer"
            >
              <Upload className="w-4 h-4" />
              Go to Notes Upload
            </button>
          </div>
        )}
      </section>

      {/* Extraction & Verification Audit Summary */}
      {!isProcessing && !processingError && activeUnit && (
        <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="text-sm sm:text-base font-bold text-slate-900">
                Source Grounding & Uncertainty Audit Report
              </h2>
              <p className="text-xs text-slate-500">
                {activeUnit.subject} · Unit {activeUnit.unitNumber}: {activeUnit.unitTitle}
              </p>
            </div>
            <span className="text-xs font-mono text-slate-500 tabular-nums">
              {activeUnit.sourcePages.length} Source Page(s) Analyzed
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg">
              <p className="text-xs text-slate-500">Preserved Keywords</p>
              <p className="text-xl font-bold text-slate-900 font-mono tabular-nums mt-1">
                {allItems.length}
              </p>
            </div>
            <div className="p-3.5 bg-emerald-50/60 border border-emerald-200 rounded-lg">
              <p className="text-xs text-emerald-800">Verified Concepts</p>
              <p className="text-xl font-bold text-emerald-700 font-mono tabular-nums mt-1">
                {verifiedItems.length}
              </p>
            </div>
            <div className="p-3.5 bg-sky-50/60 border border-sky-200 rounded-lg">
              <p className="text-xs text-sky-800">Partially Supported</p>
              <p className="text-xl font-bold text-sky-700 font-mono tabular-nums mt-1">
                {partiallySupportedItems.length}
              </p>
            </div>
            <div className="p-3.5 bg-amber-50/70 border border-amber-200 rounded-lg">
              <p className="text-xs text-amber-900">Flagged NEEDS_REVIEW</p>
              <p className="text-xl font-bold text-amber-700 font-mono tabular-nums mt-1">
                {flaggedItems.length}
              </p>
            </div>
            <div className="p-3.5 bg-purple-50/60 border border-purple-200 rounded-lg">
              <p className="text-xs text-purple-900">Traceable MCQs</p>
              <p className="text-xl font-bold text-purple-700 font-mono tabular-nums mt-1">
                {activeUnit.mcqs.length}
              </p>
            </div>
          </div>

          {flaggedItems.length > 0 ? (
            <div className="space-y-3">
              <h3 className="text-xs font-bold text-amber-900 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                <span>
                  Items Flagged as NEEDS_REVIEW (Unclear Handwriting or Insufficient Context)
                </span>
              </h3>
              <div className="divide-y divide-amber-200/60 border border-amber-200 bg-amber-50/40 rounded-xl">
                {flaggedItems.map((item) => (
                  <div
                    key={item.id}
                    className="p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5 text-xs">
                        <span className="font-bold text-slate-900 break-words">
                          {item.originalKeyword}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono text-slate-600">
                          Page {item.sourcePageReference}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-semibold text-amber-800">
                          {item.sourceSufficiency === 'INSUFFICIENT'
                            ? 'Insufficient Source Detail'
                            : 'Requires Review'}
                        </span>
                      </div>
                      <p className="text-xs text-amber-900 break-words">
                        {item.uncertaintyReason ||
                          'Flagged for manual verification against the original handwritten scan.'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onNavigateModule('editor')}
                      className="px-3 py-2 text-xs font-semibold text-amber-950 bg-amber-200/80 hover:bg-amber-300/80 rounded-lg shrink-0 self-start sm:self-center cursor-pointer"
                    >
                      Resolve in Editor
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center gap-3 text-xs text-emerald-900 font-medium">
              <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0" />
              <span>
                All extracted concepts and explanations in this unit passed source-context
                verification with no pending uncertainty flags.
              </span>
            </div>
          )}
        </section>
      )}
    </div>
  );
};
