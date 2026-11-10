import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Download,
  FileText,
  HelpCircle,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Plus,
  AlertTriangle,
  Printer,
  BookOpen,
  Maximize2,
  Minimize2,
  ZoomIn,
  ZoomOut,
  ChevronLeft,
  ChevronRight,
  Upload,
} from 'lucide-react';
import {
  StudyUnitDocument,
  PracticeMCQ,
  VerifiedConceptItem,
  ModuleId,
} from '../types';

interface PdfMcqModuleProps {
  units: StudyUnitDocument[];
  activeUnit: StudyUnitDocument | undefined;
  onSelectUnit: (unitId: string) => void;
  onUpdateUnit: (updated: StudyUnitDocument) => void;
  onDownloadUnitPdf: (unit: StudyUnitDocument, includeMcqs: boolean) => Promise<void>;
  onNavigateModule: (module: ModuleId) => void;
}

const A4_WIDTH_PX = 794; // 210mm @ 96 DPI
const A4_MIN_HEIGHT_PX = 1123; // 297mm @ 96 DPI

interface PaginatedSheet {
  pageNumber: number;
  isFirstPage: boolean;
  blocks: Array<
    | {
        type: 'section_header';
        sectionId: string;
        heading: string;
        subheading: string;
      }
    | {
        type: 'concept_item';
        item: VerifiedConceptItem;
      }
    | {
        type: 'mcq_block';
        mcqs: PracticeMCQ[];
      }
  >;
}

/**
 * Splits a StudyUnitDocument into discrete A4 preview pages so users can navigate
 * Page 1, Page 2, ... Page N with realistic A4 proportions and page numbers.
 */
function buildPaginatedA4Sheets(
  unit: StudyUnitDocument,
  includeMcqs: boolean
): PaginatedSheet[] {
  const sheets: PaginatedSheet[] = [];
  let currentBlocks: PaginatedSheet['blocks'] = [];
  let currentWeight = 320; // Cover header + TOC weight on page 1
  const maxPageWeight = 980;

  const flushSheet = () => {
    sheets.push({
      pageNumber: sheets.length + 1,
      isFirstPage: sheets.length === 0,
      blocks: currentBlocks,
    });
    currentBlocks = [];
    currentWeight = 80;
  };

  for (const section of unit.sections) {
    if (currentWeight + 90 > maxPageWeight && currentBlocks.length > 0) {
      flushSheet();
    }
    currentBlocks.push({
      type: 'section_header',
      sectionId: section.id,
      heading: section.heading,
      subheading: section.subheading,
    });
    currentWeight += 75;

    for (const item of section.items) {
      const itemWeight =
        130 +
        (item.formulasAndDerivations?.length || 0) * 38 +
        (item.diagramRegion ? 190 : 0);

      if (currentWeight + itemWeight > maxPageWeight && currentBlocks.length > 0) {
        flushSheet();
      }
      currentBlocks.push({
        type: 'concept_item',
        item,
      });
      currentWeight += itemWeight;
    }
  }

  if (includeMcqs && unit.mcqs.length > 0) {
    const mcqWeight = 90 + unit.mcqs.length * 110;
    if (currentWeight + mcqWeight > maxPageWeight && currentBlocks.length > 0) {
      flushSheet();
    }
    currentBlocks.push({
      type: 'mcq_block',
      mcqs: unit.mcqs,
    });
  }

  if (currentBlocks.length > 0 || sheets.length === 0) {
    flushSheet();
  }

  return sheets;
}

export const PdfMcqModule: React.FC<PdfMcqModuleProps> = ({
  units,
  activeUnit,
  onSelectUnit,
  onUpdateUnit,
  onDownloadUnitPdf,
  onNavigateModule,
}) => {
  const [activeTab, setActiveTab] = useState<'pdf' | 'mcq'>('pdf');
  const [includeMcqsInPdf, setIncludeMcqsInPdf] = useState(true);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
  const [downloadSuccessText, setDownloadSuccessText] = useState<string | null>(null);

  // PDF Preview Controls: Zoom, Page Navigation & Full-Screen Mobile Preview
  const [isFullScreenPreview, setIsFullScreenPreview] = useState(false);
  const [zoomMode, setZoomMode] = useState<'fit' | number>('fit');
  const [currentPreviewPage, setCurrentPreviewPage] = useState(1);

  const previewContainerRef = useRef<HTMLDivElement | null>(null);
  const a4SheetRef = useRef<HTMLDivElement | null>(null);
  const [autoFitScale, setAutoFitScale] = useState(1);
  const [scaledWrapperHeight, setScaledWrapperHeight] = useState<number | undefined>(undefined);

  // MCQ Quiz Interactive State
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, number>>({});
  const [isRegeneratingMcqs, setIsRegeneratingMcqs] = useState(false);
  const [mcqStatusNote, setMcqStatusNote] = useState<string | null>(null);
  const [showNewMcqForm, setShowNewMcqForm] = useState(false);
  const [newMcqDraft, setNewMcqDraft] = useState({
    question: '',
    opt0: '',
    opt1: '',
    opt2: '',
    opt3: '',
    correctIndex: 0,
    explanation: '',
    supportingSourcePassage: '',
    sourcePageReference: 1,
    relatedKeyword: '',
  });

  const sheets = useMemo(() => {
    if (!activeUnit) return [];
    return buildPaginatedA4Sheets(activeUnit, includeMcqsInPdf);
  }, [activeUnit, includeMcqsInPdf]);

  useEffect(() => {
    setCurrentPreviewPage(1);
  }, [activeUnit?.id, includeMcqsInPdf]);

  const effectiveScale = zoomMode === 'fit' ? autoFitScale : zoomMode / 100;

  // Compute dynamic mobile scale factor using ResizeObserver
  useEffect(() => {
    const updateScale = () => {
      if (!previewContainerRef.current) return;
      const availableWidth = previewContainerRef.current.clientWidth - 16;
      const fitScale =
        availableWidth < A4_WIDTH_PX
          ? Math.max(0.32, availableWidth / A4_WIDTH_PX)
          : 1;
      setAutoFitScale(fitScale);

      const activeScale = zoomMode === 'fit' ? fitScale : zoomMode / 100;
      if (a4SheetRef.current) {
        const unscaledHeight = Math.max(A4_MIN_HEIGHT_PX, a4SheetRef.current.scrollHeight);
        setScaledWrapperHeight(Math.ceil(unscaledHeight * activeScale));
      }
    };

    updateScale();
    const observer = new ResizeObserver(updateScale);
    if (previewContainerRef.current) observer.observe(previewContainerRef.current);
    if (a4SheetRef.current) observer.observe(a4SheetRef.current);
    window.addEventListener('resize', updateScale);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateScale);
    };
  }, [activeUnit, activeTab, includeMcqsInPdf, currentPreviewPage, zoomMode, isFullScreenPreview]);

  if (!activeUnit) {
    return (
      <section className="bg-white border border-slate-200 rounded-xl p-8 sm:p-12 text-center space-y-4">
        <FileText className="w-10 h-10 text-slate-400 mx-auto" />
        <div className="space-y-1 max-w-md mx-auto">
          <h2 className="text-lg font-bold text-slate-900">
            No Study Material Available for PDF Export
          </h2>
          <p className="text-xs sm:text-sm text-slate-600">
            Upload your handwritten notes first to generate structured A4 study sheets and
            source-traceable practice MCQs.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onNavigateModule('upload')}
          className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-lg cursor-pointer"
        >
          <Upload className="w-4 h-4" />
          Upload Handwritten Notes
        </button>
      </section>
    );
  }

  const activeSheet =
    sheets[Math.min(currentPreviewPage - 1, Math.max(0, sheets.length - 1))] || sheets[0];

  const handleDownloadClick = async () => {
    setIsDownloadingPdf(true);
    setDownloadSuccessText(null);
    try {
      await onDownloadUnitPdf(activeUnit, includeMcqsInPdf);
      setDownloadSuccessText(
        `Downloaded standalone PDF for ${activeUnit.subject} — Unit ${activeUnit.unitNumber}: ${activeUnit.unitTitle}.`
      );
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  const handleRegenerateMcqs = async () => {
    setIsRegeneratingMcqs(true);
    setMcqStatusNote(null);
    try {
      const response = await fetch('/api/notes/regenerate-mcqs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: activeUnit.subject,
          unitNumber: activeUnit.unitNumber,
          unitTitle: activeUnit.unitTitle,
          sections: activeUnit.sections,
        }),
      });
      const rawText = await response.text();
      let data: any = {};
      try {
        data = rawText ? JSON.parse(rawText) : {};
      } catch {
        if (!response.ok) {
          throw new Error(
            `Server returned HTTP ${response.status} (${response.statusText || 'Error'}). Ensure the backend serverless route is deployed.`
          );
        }
        throw new Error('Received unexpected non-JSON response from MCQ generator.');
      }
      if (!response.ok) {
        const errMsg =
          typeof data.error === 'object' && data.error?.message
            ? data.error.message
            : data.error || data.message || `Failed to regenerate MCQs (HTTP ${response.status}).`;
        throw new Error(errMsg);
      }
      const payloadData = data.data || data;
      setSelectedAnswers({});
      onUpdateUnit({
        ...activeUnit,
        mcqs: payloadData.mcqs || [],
        mcqGenerationNote: payloadData.mcqGenerationNote,
      });
      setMcqStatusNote(payloadData.mcqGenerationNote || 'MCQs updated from verified unit passages.');
    } catch (err: any) {
      setMcqStatusNote(err?.message || 'Could not regenerate MCQs.');
    } finally {
      setIsRegeneratingMcqs(false);
    }
  };

  const handleCreateCustomMcq = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMcqDraft.question.trim() || !newMcqDraft.supportingSourcePassage.trim()) return;
    const created: PracticeMCQ = {
      id: `mcq-custom-${Date.now()}`,
      question: newMcqDraft.question.trim(),
      options: [
        newMcqDraft.opt0 || 'Option A',
        newMcqDraft.opt1 || 'Option B',
        newMcqDraft.opt2 || 'Option C',
        newMcqDraft.opt3 || 'Option D',
      ],
      correctIndex: newMcqDraft.correctIndex,
      explanation: newMcqDraft.explanation.trim() || 'Grounded in uploaded notes.',
      supportingSourcePassage: newMcqDraft.supportingSourcePassage.trim(),
      sourcePageReference: newMcqDraft.sourcePageReference,
      relatedKeyword: newMcqDraft.relatedKeyword.trim() || 'Unit Concept',
    };
    onUpdateUnit({
      ...activeUnit,
      mcqs: [...activeUnit.mcqs, created],
    });
    setShowNewMcqForm(false);
    setNewMcqDraft({
      question: '',
      opt0: '',
      opt1: '',
      opt2: '',
      opt3: '',
      correctIndex: 0,
      explanation: '',
      supportingSourcePassage: '',
      sourcePageReference: 1,
      relatedKeyword: '',
    });
  };

  const allItems = activeUnit.sections.flatMap((s) => s.items);
  const verifiedCount = allItems.filter((i) => i.verificationStatus === 'VERIFIED').length;
  const needsReviewCount = allItems.length - verifiedCount;

  const answeredCount = Object.keys(selectedAnswers).length;
  const correctCount = activeUnit.mcqs.filter(
    (m) => selectedAnswers[m.id] !== undefined && selectedAnswers[m.id] === m.correctIndex
  ).length;

  const stepZoom = (delta: number) => {
    const currentPct = Math.round(effectiveScale * 100);
    const nextPct = Math.max(40, Math.min(160, currentPct + delta));
    setZoomMode(nextPct);
  };

  return (
    <div className="space-y-5 w-full max-w-full overflow-x-hidden">
      {/* Top Control Header */}
      <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 no-print">
        <div className="space-y-2 min-w-0">
          <p className="text-xs font-medium text-sky-700">
            05. PDF & MCQ Generator · Individual Unit Export & Traceable Practice
          </p>
          <div className="flex flex-wrap items-center gap-2.5">
            {units.length > 1 ? (
              <select
                aria-label="Select Unit to Export or Practice"
                value={activeUnit.id}
                onChange={(e) => {
                  setSelectedAnswers({});
                  onSelectUnit(e.target.value);
                }}
                className="w-full sm:w-auto max-w-full px-3 py-2 text-xs sm:text-sm font-bold text-slate-900 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-sky-600"
              >
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.subject} — Unit {u.unitNumber}: {u.unitTitle}
                  </option>
                ))}
              </select>
            ) : (
              <h2 className="text-sm sm:text-base font-bold text-slate-900 break-words">
                {activeUnit.subject} — Unit {activeUnit.unitNumber}: {activeUnit.unitTitle}
              </h2>
            )}

            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg max-w-full overflow-x-auto">
              <button
                type="button"
                onClick={() => setActiveTab('pdf')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeTab === 'pdf'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                PDF Preview & Export
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('mcq')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeTab === 'mcq'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <HelpCircle className="w-3.5 h-3.5" />
                MCQ Practice ({activeUnit.mcqs.length})
              </button>
            </div>
          </div>
        </div>

        {/* Export Actions */}
        <div className="flex flex-wrap items-center gap-2.5">
          <label className="inline-flex items-center gap-2 text-xs text-slate-700 font-medium cursor-pointer">
            <input
              type="checkbox"
              checked={includeMcqsInPdf}
              onChange={(e) => setIncludeMcqsInPdf(e.target.checked)}
              className="rounded border-slate-300 text-sky-600 focus:ring-sky-500"
            />
            <span>Include MCQs in PDF</span>
          </label>

          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Print</span>
          </button>

          <button
            type="button"
            disabled={isDownloadingPdf}
            onClick={handleDownloadClick}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-50 rounded-lg transition-colors cursor-pointer"
          >
            <Download className="w-4 h-4 shrink-0" />
            <span>
              {isDownloadingPdf
                ? 'Generating PDF...'
                : `Download Unit ${activeUnit.unitNumber} PDF`}
            </span>
          </button>
        </div>
      </section>

      {downloadSuccessText && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs font-medium text-emerald-900 flex items-center justify-between gap-2 no-print">
          <span className="min-w-0 break-words">{downloadSuccessText}</span>
          <button
            type="button"
            onClick={() => setDownloadSuccessText(null)}
            className="underline font-semibold shrink-0 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* TAB A: RESPONSIVE A4 PDF PREVIEW WITH FULL-SCREEN, ZOOM & PAGE NAVIGATION */}
      {activeTab === 'pdf' && (
        <div
          className={
            isFullScreenPreview
              ? 'fixed inset-0 z-50 bg-slate-900/95 flex flex-col p-2 sm:p-6 overflow-y-auto'
              : 'space-y-3'
          }
        >
          {/* PDF Preview Toolbar: Page Navigation, Zoom Controls & Fullscreen Toggle */}
          <div
            className={`flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 rounded-xl border no-print ${
              isFullScreenPreview
                ? 'bg-slate-800 border-slate-700 text-white sticky top-0 z-10'
                : 'bg-white border-slate-200 text-slate-700'
            }`}
          >
            {/* Page Navigation */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={currentPreviewPage <= 1}
                onClick={() => setCurrentPreviewPage((p) => Math.max(1, p - 1))}
                className={`p-1.5 rounded-lg border disabled:opacity-40 cursor-pointer ${
                  isFullScreenPreview
                    ? 'bg-slate-700 border-slate-600 text-white'
                    : 'bg-slate-50 border-slate-200 text-slate-700'
                }`}
                title="Previous PDF page"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-xs font-mono font-bold tabular-nums px-1.5">
                Page {currentPreviewPage} of {sheets.length}
              </span>
              <button
                type="button"
                disabled={currentPreviewPage >= sheets.length}
                onClick={() =>
                  setCurrentPreviewPage((p) => Math.min(sheets.length, p + 1))
                }
                className={`p-1.5 rounded-lg border disabled:opacity-40 cursor-pointer ${
                  isFullScreenPreview
                    ? 'bg-slate-700 border-slate-600 text-white'
                    : 'bg-slate-50 border-slate-200 text-slate-700'
                }`}
                title="Next PDF page"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            {/* Zoom & Full-Screen Controls */}
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => stepZoom(-15)}
                className={`p-1.5 rounded-lg border cursor-pointer ${
                  isFullScreenPreview
                    ? 'bg-slate-700 border-slate-600 text-white'
                    : 'bg-slate-50 border-slate-200 text-slate-700'
                }`}
                title="Zoom Out"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setZoomMode('fit')}
                className={`px-2.5 py-1 text-xs font-mono font-semibold rounded-lg border cursor-pointer ${
                  zoomMode === 'fit'
                    ? 'bg-sky-600 text-white border-sky-600'
                    : isFullScreenPreview
                    ? 'bg-slate-700 border-slate-600 text-slate-200'
                    : 'bg-slate-50 border-slate-200 text-slate-700'
                }`}
              >
                Fit ({Math.round(effectiveScale * 100)}%)
              </button>
              <button
                type="button"
                onClick={() => stepZoom(15)}
                className={`p-1.5 rounded-lg border cursor-pointer ${
                  isFullScreenPreview
                    ? 'bg-slate-700 border-slate-600 text-white'
                    : 'bg-slate-50 border-slate-200 text-slate-700'
                }`}
                title="Zoom In"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                onClick={() => setIsFullScreenPreview((v) => !v)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg border cursor-pointer ${
                  isFullScreenPreview
                    ? 'bg-amber-500 text-slate-950 border-amber-400'
                    : 'bg-slate-900 text-white border-slate-900'
                }`}
              >
                {isFullScreenPreview ? (
                  <>
                    <Minimize2 className="w-3.5 h-3.5" />
                    <span>Exit Full Screen</span>
                  </>
                ) : (
                  <>
                    <Maximize2 className="w-3.5 h-3.5" />
                    <span>Full Screen</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* A4 Sheet Viewport */}
          <div
            ref={previewContainerRef}
            className="w-full overflow-x-auto flex justify-center bg-slate-200/75 border border-slate-300 rounded-xl p-2 sm:p-6"
          >
            <div
              style={{
                width: `${Math.ceil(A4_WIDTH_PX * effectiveScale)}px`,
                height: scaledWrapperHeight ? `${scaledWrapperHeight}px` : 'auto',
              }}
              className="relative flex justify-center"
            >
              <div
                ref={a4SheetRef}
                style={{
                  width: `${A4_WIDTH_PX}px`,
                  minHeight: `${A4_MIN_HEIGHT_PX}px`,
                  transform: `scale(${effectiveScale})`,
                  transformOrigin: 'top center',
                }}
                className="bg-white text-slate-900 shadow-md border border-slate-200 p-10 flex flex-col justify-between"
              >
                <div className="space-y-7">
                  {/* First Page Formal Cover Header & Table of Contents */}
                  {activeSheet?.isFirstPage && (
                    <>
                      <div className="bg-slate-900 text-white rounded-lg p-6 space-y-2">
                        <div className="flex items-center justify-between text-xs font-mono text-sky-400">
                          <span>
                            {activeUnit.subject.toUpperCase()} · UNIT {activeUnit.unitNumber} STUDY
                            MATERIAL
                          </span>
                          <span>SOURCE-VERIFIED EDITION</span>
                        </div>
                        <h1 className="text-2xl font-bold tracking-tight text-white">
                          Unit {activeUnit.unitNumber}: {activeUnit.unitTitle}
                        </h1>
                        <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-xs text-slate-300 font-mono">
                          <span>Source Pages: {activeUnit.sourcePages.length}</span>
                          <span>
                            Verified Concepts: {verifiedCount}/{allItems.length}
                          </span>
                          <span>Updated: {new Date(activeUnit.updatedAt).toLocaleDateString()}</span>
                        </div>
                      </div>

                      {/* Table of Contents */}
                      <div className="bg-slate-50 border border-slate-200 rounded-lg p-5 space-y-3">
                        <h2 className="text-xs font-bold tracking-wider text-slate-900 font-mono">
                          TABLE OF CONTENTS
                        </h2>
                        <div className="divide-y divide-slate-200/70 text-xs">
                          {activeUnit.sections.map((sec, idx) => (
                            <div
                              key={sec.id}
                              className="py-2 flex items-center justify-between gap-4"
                            >
                              <span className="font-semibold text-slate-800">
                                {idx + 1}. {sec.heading.replace(/^\d+\.\s*/, '')}
                              </span>
                              <span className="font-mono text-slate-500 tabular-nums shrink-0">
                                {sec.items.length} concept(s)
                              </span>
                            </div>
                          ))}
                          {includeMcqsInPdf && activeUnit.mcqs.length > 0 && (
                            <div className="py-2 flex items-center justify-between gap-4 text-sky-800 font-semibold">
                              <span>
                                Practice Multiple-Choice Questions ({activeUnit.mcqs.length} Items)
                              </span>
                              <span className="font-mono tabular-nums">Page {sheets.length}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </>
                  )}

                  {/* Paginated Content Blocks */}
                  <div className="space-y-6">
                    {activeSheet?.blocks.map((block, bIdx) => {
                      if (block.type === 'section_header') {
                        return (
                          <div key={`sec-${block.sectionId}-${bIdx}`} className="border-b border-slate-300 pb-2 pt-2">
                            <h2 className="text-lg font-bold text-slate-900">{block.heading}</h2>
                            {block.subheading && (
                              <p className="text-xs text-slate-600 italic mt-0.5">
                                {block.subheading}
                              </p>
                            )}
                          </div>
                        );
                      }

                      if (block.type === 'concept_item') {
                        const item = block.item;
                        const isVerified = item.verificationStatus === 'VERIFIED';
                        return (
                          <div
                            key={item.id}
                            className="space-y-2.5 pb-4 border-b border-slate-100 last:border-b-0"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <span
                                className={`px-2.5 py-1 rounded text-sm font-bold ${
                                  isVerified
                                    ? 'bg-sky-100 text-sky-950'
                                    : 'bg-amber-100 text-amber-950'
                                }`}
                              >
                                {item.originalKeyword}
                              </span>
                              <span className="text-xs font-mono text-slate-500 tabular-nums">
                                Source Page {item.sourcePageReference} · {item.verificationStatus}
                              </span>
                            </div>

                            <p className="text-xs font-mono text-slate-500 bg-slate-50 px-3 py-1.5 rounded border border-slate-200/80">
                              Source Note (Page {item.sourcePageReference}): &ldquo;
                              {item.supportingSourcePassage}&rdquo;
                            </p>

                            <p className="text-sm text-slate-800 leading-relaxed">
                              {item.generatedExplanation}
                            </p>

                            {item.formulasAndDerivations &&
                              item.formulasAndDerivations.length > 0 && (
                                <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 space-y-2">
                                  <p className="text-xs font-bold text-sky-800 font-mono">
                                    FORMULAS & STEP-BY-STEP DERIVATION
                                  </p>
                                  <div className="space-y-1.5">
                                    {item.formulasAndDerivations.map((st) => (
                                      <div
                                        key={st.stepNumber}
                                        className="text-xs flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-3"
                                      >
                                        <span className="font-mono font-bold text-slate-900 shrink-0">
                                          Step {st.stepNumber}: {st.expression}
                                        </span>
                                        {st.explanation && (
                                          <span className="text-slate-600">
                                            — {st.explanation}
                                          </span>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                            {item.diagramRegion && (
                              <div className="border border-slate-200 rounded-lg p-3.5 bg-slate-50/50 space-y-2">
                                {item.diagramRegion.croppedDataUrl && (
                                  <div className="bg-white border border-slate-200 rounded p-2 flex justify-center">
                                    <img
                                      src={item.diagramRegion.croppedDataUrl}
                                      alt={item.diagramRegion.caption}
                                      referrerPolicy="no-referrer"
                                      className="max-h-44 object-contain"
                                    />
                                  </div>
                                )}
                                <p className="text-xs font-bold text-slate-800">
                                  Diagram (Page {item.diagramRegion.pageNumber}):{' '}
                                  {item.diagramRegion.caption}
                                </p>
                                {item.diagramRegion.labels &&
                                  item.diagramRegion.labels.length > 0 && (
                                    <p className="text-xs font-mono text-slate-600">
                                      Labels: {item.diagramRegion.labels.join(' · ')}
                                    </p>
                                  )}
                              </div>
                            )}
                          </div>
                        );
                      }

                      if (block.type === 'mcq_block') {
                        return (
                          <div key={`mcqs-${bIdx}`} className="pt-4 border-t-2 border-slate-200 space-y-4">
                            <h2 className="text-base font-bold text-slate-900">
                              Source-Verified Practice Questions ({block.mcqs.length} MCQs)
                            </h2>
                            <div className="space-y-4">
                              {block.mcqs.map((mcq, idx) => (
                                <div
                                  key={mcq.id}
                                  className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg space-y-2 text-xs"
                                >
                                  <p className="font-bold text-slate-900">
                                    Q{idx + 1}. {mcq.question}
                                  </p>
                                  <div className="grid grid-cols-2 gap-1.5 text-slate-700 pl-2">
                                    {mcq.options.map((opt, oIdx) => (
                                      <div key={oIdx}>
                                        ({['A', 'B', 'C', 'D'][oIdx]}) {opt}
                                      </div>
                                    ))}
                                  </div>
                                  <p className="text-emerald-800 font-medium pt-1 border-t border-slate-200/80">
                                    Correct: ({['A', 'B', 'C', 'D'][mcq.correctIndex]}) —{' '}
                                    {mcq.explanation}{' '}
                                    <span className="font-mono text-slate-500">
                                      [Source Page {mcq.sourcePageReference}]
                                    </span>
                                  </p>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      }

                      return null;
                    })}
                  </div>
                </div>

                {/* A4 Page Footer with Page Numbers */}
                <div className="pt-6 mt-8 border-t border-slate-200 flex items-center justify-between text-xs font-mono text-slate-500">
                  <span>
                    {activeUnit.subject} · Unit {activeUnit.unitNumber}: {activeUnit.unitTitle}
                  </span>
                  <span>
                    Page {activeSheet?.pageNumber || 1} of {sheets.length}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB B: TRACEABLE SOURCE-ONLY MCQ PRACTICE */}
      {activeTab === 'mcq' && (
        <div className="space-y-5">
          <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="min-w-0">
                <h2 className="text-base sm:text-lg font-bold text-slate-900">
                  Source-Verified MCQ Practice ({activeUnit.mcqs.length} Questions)
                </h2>
                <p className="text-xs text-slate-600">
                  Every question, correct answer, and explanation is strictly linked to a verbatim
                  passage from your uploaded handwritten notes.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                {answeredCount > 0 && (
                  <span className="px-3 py-1.5 bg-slate-100 rounded-lg text-xs font-mono font-bold text-slate-900 tabular-nums">
                    Score: {correctCount}/{answeredCount}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedAnswers({})}
                  className="px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
                >
                  Reset
                </button>
                <button
                  type="button"
                  onClick={() => setShowNewMcqForm((v) => !v)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Custom MCQ</span>
                </button>
                <button
                  type="button"
                  disabled={isRegeneratingMcqs}
                  onClick={handleRegenerateMcqs}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-50 rounded-lg cursor-pointer"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${isRegeneratingMcqs ? 'animate-spin' : ''}`}
                  />
                  <span>
                    {isRegeneratingMcqs ? 'Synthesizing...' : 'Regenerate Traceable MCQs'}
                  </span>
                </button>
              </div>
            </div>

            {(mcqStatusNote || activeUnit.mcqGenerationNote) && (
              <div className="p-3.5 bg-sky-50 border border-sky-200 rounded-lg text-xs text-sky-950 flex items-start gap-2">
                <BookOpen className="w-4 h-4 text-sky-700 shrink-0 mt-0.5" />
                <span className="break-words">
                  {mcqStatusNote || activeUnit.mcqGenerationNote}
                </span>
              </div>
            )}

            {showNewMcqForm && (
              <form
                onSubmit={handleCreateCustomMcq}
                className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3"
              >
                <h3 className="text-xs font-bold text-slate-900">
                  Add Custom Source-Traceable MCQ
                </h3>
                <input
                  type="text"
                  required
                  value={newMcqDraft.question}
                  onChange={(e) => setNewMcqDraft({ ...newMcqDraft, question: e.target.value })}
                  placeholder="Question text..."
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg"
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {(['opt0', 'opt1', 'opt2', 'opt3'] as const).map((key, idx) => (
                    <input
                      key={key}
                      type="text"
                      required
                      value={newMcqDraft[key]}
                      onChange={(e) => setNewMcqDraft({ ...newMcqDraft, [key]: e.target.value })}
                      placeholder={`Option ${['A', 'B', 'C', 'D'][idx]}...`}
                      className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg"
                    />
                  ))}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <select
                    value={newMcqDraft.correctIndex}
                    onChange={(e) =>
                      setNewMcqDraft({ ...newMcqDraft, correctIndex: Number(e.target.value) })
                    }
                    className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg"
                  >
                    <option value={0}>Correct Answer: Option A</option>
                    <option value={1}>Correct Answer: Option B</option>
                    <option value={2}>Correct Answer: Option C</option>
                    <option value={3}>Correct Answer: Option D</option>
                  </select>
                  <input
                    type="text"
                    required
                    value={newMcqDraft.supportingSourcePassage}
                    onChange={(e) =>
                      setNewMcqDraft({
                        ...newMcqDraft,
                        supportingSourcePassage: e.target.value,
                      })
                    }
                    placeholder="Supporting quote from notes..."
                    className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg"
                  />
                  <input
                    type="text"
                    required
                    value={newMcqDraft.explanation}
                    onChange={(e) =>
                      setNewMcqDraft({ ...newMcqDraft, explanation: e.target.value })
                    }
                    placeholder="Concept explanation..."
                    className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowNewMcqForm(false)}
                    className="px-3 py-1.5 text-xs text-slate-600 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-1.5 text-xs font-semibold text-white bg-slate-900 rounded-lg cursor-pointer"
                  >
                    Save Question
                  </button>
                </div>
              </form>
            )}
          </section>

          {activeUnit.mcqs.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center space-y-3">
              <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto" />
              <h3 className="text-sm sm:text-base font-bold text-slate-900">
                No MCQs Generated for This Unit Yet
              </h3>
              <p className="text-xs text-slate-600 max-w-md mx-auto">
                To prevent unsupported questions, MCQs are only generated when sufficient verified
                source passages exist in your uploaded notes. Verify items in the Study Editor and
                click &ldquo;Regenerate Traceable MCQs&rdquo;, or add a custom question above.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {activeUnit.mcqs.map((mcq, qIdx) => {
                const chosenIdx = selectedAnswers[mcq.id];
                const isAnswered = chosenIdx !== undefined;
                const isCorrect = isAnswered && chosenIdx === mcq.correctIndex;

                return (
                  <div
                    key={mcq.id}
                    className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-4"
                  >
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                        <span className="font-mono font-bold text-sky-700">
                          Question {qIdx + 1}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="break-words">Keyword: {mcq.relatedKeyword}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono">Source Page {mcq.sourcePageReference}</span>
                      </div>
                      <h3 className="text-sm sm:text-base font-bold text-slate-900 break-words">
                        {mcq.question}
                      </h3>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {mcq.options.map((option, optIdx) => {
                        const isSelected = chosenIdx === optIdx;
                        const isRightOption = mcq.correctIndex === optIdx;

                        let btnClass =
                          'bg-slate-50 border-slate-200 text-slate-800 hover:bg-slate-100';
                        if (isAnswered) {
                          if (isRightOption) {
                            btnClass =
                              'bg-emerald-50 border-emerald-500 text-emerald-950 font-semibold';
                          } else if (isSelected) {
                            btnClass = 'bg-red-50 border-red-400 text-red-950';
                          } else {
                            btnClass = 'bg-slate-50 border-slate-200 text-slate-500 opacity-75';
                          }
                        }

                        return (
                          <button
                            key={optIdx}
                            type="button"
                            onClick={() =>
                              setSelectedAnswers((prev) => ({ ...prev, [mcq.id]: optIdx }))
                            }
                            className={`p-3 rounded-lg border text-left text-xs transition-colors flex items-start justify-between gap-2 cursor-pointer ${btnClass}`}
                          >
                            <span className="break-words min-w-0">
                              <strong className="font-mono mr-1.5">
                                ({['A', 'B', 'C', 'D'][optIdx]})
                              </strong>
                              {option}
                            </span>
                            {isAnswered && isRightOption && (
                              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                            )}
                            {isAnswered && isSelected && !isRightOption && (
                              <XCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                            )}
                          </button>
                        );
                      })}
                    </div>

                    {isAnswered && (
                      <div
                        className={`p-3.5 rounded-lg border text-xs space-y-2 ${
                          isCorrect
                            ? 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
                            : 'bg-amber-50/70 border-amber-200 text-amber-950'
                        }`}
                      >
                        <p className="font-bold">
                          {isCorrect
                            ? 'Correct Answer!'
                            : `Incorrect — Correct Option is (${
                                ['A', 'B', 'C', 'D'][mcq.correctIndex]
                              })`}
                        </p>
                        <p className="leading-relaxed break-words">{mcq.explanation}</p>
                        <p className="font-mono text-[11px] text-slate-600 pt-1 border-t border-slate-200/70 break-words">
                          Traceable Source Note (Page {mcq.sourcePageReference}): &ldquo;
                          {mcq.supportingSourcePassage}&rdquo;
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
