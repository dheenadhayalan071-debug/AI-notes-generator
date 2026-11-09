import React, { useState } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  ZoomIn,
  ZoomOut,
  Plus,
  Trash2,
  FileText,
  Eye,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Upload,
} from 'lucide-react';
import {
  StudyUnitDocument,
  StudySection,
  VerifiedConceptItem,
  DerivationStep,
  ModuleId,
} from '../types';

interface StudyEditorModuleProps {
  units: StudyUnitDocument[];
  activeUnit: StudyUnitDocument | undefined;
  onSelectUnit: (unitId: string) => void;
  onUpdateUnit: (updated: StudyUnitDocument) => void;
  onNavigateModule: (module: ModuleId) => void;
}

export const StudyEditorModule: React.FC<StudyEditorModuleProps> = ({
  units,
  activeUnit,
  onSelectUnit,
  onUpdateUnit,
  onNavigateModule,
}) => {
  const [mobileActivePane, setMobileActivePane] = useState<'scan' | 'editor'>('editor');
  const [selectedPageIdx, setSelectedPageIdx] = useState(0);
  const [zoomPercent, setZoomPercent] = useState(100);
  const [showRawTranscript, setShowRawTranscript] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'NEEDS_REVIEW' | 'VERIFIED'>('ALL');

  if (!activeUnit) {
    return (
      <section className="bg-white border border-slate-200 rounded-xl p-8 sm:p-12 text-center space-y-4">
        <FileText className="w-10 h-10 text-slate-400 mx-auto" />
        <div className="space-y-1 max-w-md mx-auto">
          <h2 className="text-lg font-bold text-slate-900">No Study Material Selected</h2>
          <p className="text-xs sm:text-sm text-slate-600">
            Upload your handwritten classroom notes first to inspect original scans, review
            explanations, and edit formulas.
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

  const pages = activeUnit.sourcePages || [];
  const currentPage = pages[Math.min(selectedPageIdx, Math.max(0, pages.length - 1))];

  const allItems = activeUnit.sections.flatMap((s) => s.items);
  const needsReviewCount = allItems.filter((i) => i.verificationStatus === 'NEEDS_REVIEW').length;
  const verifiedCount = allItems.length - needsReviewCount;

  const handleJumpToSourcePage = (pageNumber: number) => {
    const idx = pages.findIndex((p) => p.pageNumber === pageNumber);
    if (idx >= 0) {
      setSelectedPageIdx(idx);
    } else if (pageNumber >= 1 && pageNumber <= pages.length) {
      setSelectedPageIdx(pageNumber - 1);
    }
    setMobileActivePane('scan');
  };

  const updateSectionField = (
    sectionId: string,
    field: 'heading' | 'subheading',
    value: string
  ) => {
    const nextSections = activeUnit.sections.map((sec) =>
      sec.id === sectionId ? { ...sec, [field]: value } : sec
    );
    onUpdateUnit({ ...activeUnit, sections: nextSections });
  };

  const updateConceptItem = (
    sectionId: string,
    itemId: string,
    updater: (item: VerifiedConceptItem) => VerifiedConceptItem
  ) => {
    const nextSections = activeUnit.sections.map((sec) => {
      if (sec.id !== sectionId) return sec;
      return {
        ...sec,
        items: sec.items.map((it) => (it.id === itemId ? updater(it) : it)),
      };
    });
    onUpdateUnit({ ...activeUnit, sections: nextSections });
  };

  const handleDeleteConceptItem = (sectionId: string, itemId: string) => {
    const nextSections = activeUnit.sections.map((sec) => {
      if (sec.id !== sectionId) return sec;
      return {
        ...sec,
        items: sec.items.filter((it) => it.id !== itemId),
      };
    });
    onUpdateUnit({ ...activeUnit, sections: nextSections });
  };

  const handleDeleteSection = (sectionId: string) => {
    const nextSections = activeUnit.sections.filter((sec) => sec.id !== sectionId);
    onUpdateUnit({ ...activeUnit, sections: nextSections });
  };

  const handleAddConceptItem = (sectionId: string) => {
    const newItem: VerifiedConceptItem = {
      id: `item-manual-${Date.now()}`,
      originalKeyword: 'New Classroom Keyword',
      supportingSourcePassage: 'Enter verbatim supporting passage from your handwritten page...',
      generatedExplanation: 'Enter detailed English explanation grounded in the class notes...',
      sourcePageReference: currentPage ? currentPage.pageNumber : 1,
      sourceSufficiency: 'SUFFICIENT',
      entailmentVerified: true,
      verificationStatus: 'VERIFIED',
      formulasAndDerivations: [],
    };
    const nextSections = activeUnit.sections.map((sec) =>
      sec.id === sectionId ? { ...sec, items: [...sec.items, newItem] } : sec
    );
    onUpdateUnit({ ...activeUnit, sections: nextSections });
  };

  const handleAddSection = () => {
    const nextIdx = activeUnit.sections.length + 1;
    const newSec: StudySection = {
      id: `sec-manual-${Date.now()}`,
      heading: `${nextIdx}. New Study Section Heading`,
      subheading: 'Subheading or Topic Scope',
      items: [
        {
          id: `item-manual-${Date.now()}-1`,
          originalKeyword: 'Key Concept',
          supportingSourcePassage: 'Source passage from handwritten page...',
          generatedExplanation: 'Detailed conceptual explanation...',
          sourcePageReference: currentPage ? currentPage.pageNumber : 1,
          sourceSufficiency: 'SUFFICIENT',
          entailmentVerified: true,
          verificationStatus: 'VERIFIED',
          formulasAndDerivations: [],
        },
      ],
    };
    onUpdateUnit({
      ...activeUnit,
      sections: [...activeUnit.sections, newSec],
    });
  };

  const handleAddDerivationStep = (sectionId: string, itemId: string) => {
    updateConceptItem(sectionId, itemId, (item) => {
      const nextStepNum = (item.formulasAndDerivations?.length || 0) + 1;
      const nextSteps: DerivationStep[] = [
        ...(item.formulasAndDerivations || []),
        {
          stepNumber: nextStepNum,
          expression: 'F = m * a',
          explanation: 'Step description from notes',
        },
      ];
      return { ...item, formulasAndDerivations: nextSteps };
    });
  };

  return (
    <div className="space-y-4 w-full max-w-full overflow-x-hidden">
      {/* Top Toolbar: Unit Switcher, Subject/Title Edit, Filter Controls & Export Link */}
      <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="space-y-1 min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
              <span className="font-semibold text-sky-700">04. Study Material Editor</span>
              <span aria-hidden="true">·</span>
              <span>{verifiedCount} Verified</span>
              <span aria-hidden="true">·</span>
              <span className={needsReviewCount > 0 ? 'text-amber-700 font-semibold' : ''}>
                {needsReviewCount} Flagged NEEDS_REVIEW
              </span>
              <span aria-hidden="true">·</span>
              <span className="text-emerald-700">Auto-saved to IndexedDB</span>
            </div>

            {units.length > 1 && (
              <select
                aria-label="Select Study Unit"
                value={activeUnit.id}
                onChange={(e) => {
                  setSelectedPageIdx(0);
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
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Interactive Filter Segmented Control */}
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto max-w-full">
              <button
                type="button"
                onClick={() => setStatusFilter('ALL')}
                className={`px-2.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  statusFilter === 'ALL'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                All ({allItems.length})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('NEEDS_REVIEW')}
                className={`px-2.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  statusFilter === 'NEEDS_REVIEW'
                    ? 'bg-amber-600 text-white shadow-xs'
                    : 'text-amber-800 hover:text-amber-950'
                }`}
              >
                Needs Review ({needsReviewCount})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('VERIFIED')}
                className={`px-2.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  statusFilter === 'VERIFIED'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'text-emerald-800 hover:text-emerald-950'
                }`}
              >
                Verified ({verifiedCount})
              </button>
            </div>

            <button
              type="button"
              onClick={() => onNavigateModule('pdf_mcq')}
              className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-lg transition-colors cursor-pointer"
            >
              <span>PDF & MCQs</span>
              <ArrowRight className="w-3.5 h-3.5 shrink-0" />
            </button>
          </div>
        </div>

        {/* Editable Subject, Unit Number, and Unit/Chapter Title */}
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 pt-3 border-t border-slate-100">
          <div className="sm:col-span-4">
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">
              Subject Category
            </label>
            <input
              type="text"
              value={activeUnit.subject}
              onChange={(e) => onUpdateUnit({ ...activeUnit, subject: e.target.value })}
              className="w-full px-3 py-1.5 text-xs font-semibold text-slate-900 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-sky-600"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">
              Unit / Ch #
            </label>
            <input
              type="number"
              min={1}
              value={activeUnit.unitNumber}
              onChange={(e) =>
                onUpdateUnit({
                  ...activeUnit,
                  unitNumber: Math.max(1, Number(e.target.value) || 1),
                })
              }
              className="w-full px-3 py-1.5 text-xs font-mono font-semibold text-slate-900 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-sky-600"
            />
          </div>
          <div className="sm:col-span-6">
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">
              Unit or Chapter Title
            </label>
            <input
              type="text"
              value={activeUnit.unitTitle}
              onChange={(e) => onUpdateUnit({ ...activeUnit, unitTitle: e.target.value })}
              className="w-full px-3 py-1.5 text-xs font-semibold text-slate-900 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-sky-600"
            />
          </div>
        </div>
      </section>

      {/* MOBILE ONLY: Switchable Tabs between Original Notes and Study Editor */}
      <div className="lg:hidden grid grid-cols-2 gap-1.5 p-1.5 bg-slate-200/80 rounded-xl">
        <button
          type="button"
          onClick={() => setMobileActivePane('scan')}
          className={`py-2.5 px-2 text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer ${
            mobileActivePane === 'scan'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Eye className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">
            Original Notes ({currentPage?.pageNumber || 1}/{pages.length || 1})
          </span>
        </button>
        <button
          type="button"
          onClick={() => setMobileActivePane('editor')}
          className={`py-2.5 px-2 text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer ${
            mobileActivePane === 'editor'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <FileText className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">Study Editor ({allItems.length})</span>
          {needsReviewCount > 0 && (
            <span className="text-amber-700 font-mono shrink-0">· {needsReviewCount}!</span>
          )}
        </button>
      </div>

      {/* DESKTOP SIDE-BY-SIDE SPLIT VIEW / MOBILE TABBED VIEW */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* LEFT PANE: Original Handwritten Scan & Raw OCR Transcript */}
        <aside
          className={`lg:col-span-5 bg-white border border-slate-200 rounded-xl overflow-hidden lg:sticky lg:top-20 min-w-0 ${
            mobileActivePane === 'scan' ? 'block' : 'hidden lg:block'
          }`}
        >
          <div className="p-3 sm:p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 bg-slate-50">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={selectedPageIdx <= 0}
                onClick={() => setSelectedPageIdx((i) => Math.max(0, i - 1))}
                className="p-1.5 bg-white border border-slate-200 rounded-md disabled:opacity-40 cursor-pointer"
                title="Previous page"
              >
                <ChevronLeft className="w-4 h-4 text-slate-700" />
              </button>
              <span className="text-xs font-mono font-bold text-slate-900 tabular-nums">
                Page {currentPage?.pageNumber || 1} / {pages.length || 1}
              </span>
              <button
                type="button"
                disabled={selectedPageIdx >= pages.length - 1}
                onClick={() => setSelectedPageIdx((i) => Math.min(pages.length - 1, i + 1))}
                className="p-1.5 bg-white border border-slate-200 rounded-md disabled:opacity-40 cursor-pointer"
                title="Next page"
              >
                <ChevronRight className="w-4 h-4 text-slate-700" />
              </button>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setZoomPercent((z) => Math.max(60, z - 20))}
                className="p-1.5 bg-white border border-slate-200 rounded-md text-slate-700 hover:bg-slate-100 cursor-pointer"
                title="Zoom Out"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <span className="text-xs font-mono text-slate-600 tabular-nums px-1">
                {zoomPercent}%
              </span>
              <button
                type="button"
                onClick={() => setZoomPercent((z) => Math.min(180, z + 20))}
                className="p-1.5 bg-white border border-slate-200 rounded-md text-slate-700 hover:bg-slate-100 cursor-pointer"
                title="Zoom In"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setShowRawTranscript((v) => !v)}
                className={`px-2.5 py-1 text-xs font-semibold rounded-md border transition-colors cursor-pointer ${
                  showRawTranscript
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
              >
                {showRawTranscript ? 'Hide OCR' : 'OCR Text'}
              </button>
            </div>
          </div>

          {/* Scan Viewport */}
          <div className="max-h-[600px] overflow-auto bg-slate-100 p-3 sm:p-4 flex justify-center">
            {currentPage ? (
              <div
                style={{ width: `${zoomPercent}%` }}
                className="transition-all duration-150 origin-top"
              >
                <img
                  src={currentPage.dataUrl}
                  alt={`Handwritten source page ${currentPage.pageNumber}`}
                  referrerPolicy="no-referrer"
                  className="w-full h-auto rounded-lg border border-slate-300 bg-white shadow-xs"
                />
              </div>
            ) : (
              <div className="p-10 text-center text-xs text-slate-500">
                No source scan image attached to this unit.
              </div>
            )}
          </div>

          {showRawTranscript && currentPage && (
            <div className="p-3.5 border-t border-slate-200 bg-slate-50 space-y-1.5">
              <p className="text-xs font-bold text-slate-800">
                Verbatim OCR Transcript (Page {currentPage.pageNumber})
              </p>
              <textarea
                rows={4}
                value={currentPage.rawTranscript}
                onChange={(e) => {
                  const nextPages = activeUnit.sourcePages.map((p, idx) =>
                    idx === selectedPageIdx ? { ...p, rawTranscript: e.target.value } : p
                  );
                  onUpdateUnit({ ...activeUnit, sourcePages: nextPages });
                }}
                className="w-full p-2.5 text-xs font-mono bg-white border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:border-sky-600"
              />
            </div>
          )}
        </aside>

        {/* RIGHT PANE: Structured Study Material Editor */}
        <div
          className={`lg:col-span-7 space-y-5 min-w-0 ${
            mobileActivePane === 'editor' ? 'block' : 'hidden lg:block'
          }`}
        >
          {activeUnit.sections.map((section) => {
            const visibleItems = section.items.filter((item) => {
              if (statusFilter === 'ALL') return true;
              return item.verificationStatus === statusFilter;
            });

            if (statusFilter !== 'ALL' && visibleItems.length === 0) {
              return null;
            }

            return (
              <div
                key={section.id}
                className="bg-white border border-slate-200 rounded-xl p-3.5 sm:p-5 space-y-4 min-w-0"
              >
                {/* Section Heading & Subheading Editor */}
                <div className="space-y-2 pb-3.5 border-b border-slate-200">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="text-xs font-semibold text-slate-500">
                      Section Heading & Subheading
                    </label>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleAddConceptItem(section.id)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-sky-700 bg-sky-50 hover:bg-sky-100 rounded-md cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Add Concept
                      </button>
                      {activeUnit.sections.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleDeleteSection(section.id)}
                          className="p-1 text-slate-400 hover:text-red-600 rounded cursor-pointer"
                          title="Delete section"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                  <input
                    type="text"
                    value={section.heading}
                    onChange={(e) =>
                      updateSectionField(section.id, 'heading', e.target.value)
                    }
                    className="w-full text-sm sm:text-base font-bold text-slate-900 bg-slate-50/70 border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-sky-600"
                  />
                  <input
                    type="text"
                    value={section.subheading}
                    onChange={(e) =>
                      updateSectionField(section.id, 'subheading', e.target.value)
                    }
                    className="w-full text-xs text-slate-600 bg-slate-50/50 border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-sky-600"
                  />
                </div>

                {/* Concept Items List */}
                <div className="space-y-4">
                  {visibleItems.map((item) => {
                    const isVerified = item.verificationStatus === 'VERIFIED';

                    return (
                      <div
                        key={item.id}
                        className={`rounded-xl border p-3.5 sm:p-4 space-y-3.5 transition-colors min-w-0 ${
                          isVerified
                            ? 'bg-white border-slate-200'
                            : 'bg-amber-50/35 border-amber-300'
                        }`}
                      >
                        {/* Top Bar: Original Keyword, Source Page Link & Verification Status Toggle */}
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                          <div className="flex-1 min-w-0 space-y-1">
                            <span className="text-[11px] font-semibold text-sky-800 block">
                              Preserved Original Keyword (Highlighted in PDF)
                            </span>
                            <input
                              type="text"
                              value={item.originalKeyword}
                              onChange={(e) =>
                                updateConceptItem(section.id, item.id, (prev) => ({
                                  ...prev,
                                  originalKeyword: e.target.value,
                                }))
                              }
                              className="w-full px-3 py-1.5 text-xs sm:text-sm font-bold text-sky-950 bg-sky-100/80 border border-sky-200 rounded-lg focus:outline-none focus:border-sky-600"
                            />
                          </div>

                          <div className="flex flex-wrap items-center gap-1.5 self-start sm:self-end shrink-0">
                            <button
                              type="button"
                              onClick={() => handleJumpToSourcePage(item.sourcePageReference)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-mono font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
                              title="Jump source scan to this page"
                            >
                              <Eye className="w-3.5 h-3.5 text-sky-600" />
                              Page {item.sourcePageReference}
                            </button>

                            <button
                              type="button"
                              onClick={() =>
                                updateConceptItem(section.id, item.id, (prev) => {
                                  const nextStatus =
                                    prev.verificationStatus === 'VERIFIED'
                                      ? 'NEEDS_REVIEW'
                                      : 'VERIFIED';
                                  return {
                                    ...prev,
                                    verificationStatus: nextStatus,
                                    sourceSufficiency:
                                      nextStatus === 'VERIFIED'
                                        ? 'SUFFICIENT'
                                        : prev.sourceSufficiency,
                                    entailmentVerified: nextStatus === 'VERIFIED',
                                  };
                                })
                              }
                              className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
                                isVerified
                                  ? 'bg-emerald-100 text-emerald-900 hover:bg-emerald-200'
                                  : 'bg-amber-200 text-amber-950 hover:bg-amber-300'
                              }`}
                            >
                              {isVerified ? (
                                <>
                                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                                  <span>VERIFIED</span>
                                </>
                              ) : (
                                <>
                                  <AlertTriangle className="w-3.5 h-3.5 text-amber-800 shrink-0" />
                                  <span>NEEDS_REVIEW · Approve</span>
                                </>
                              )}
                            </button>

                            <button
                              type="button"
                              onClick={() => handleDeleteConceptItem(section.id, item.id)}
                              className="p-1.5 text-slate-400 hover:text-red-600 rounded-md cursor-pointer"
                              title="Delete concept item"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>

                        {/* Uncertainty Alert Banner when NEEDS_REVIEW */}
                        {!isVerified && (
                          <div className="p-3 bg-amber-100/70 border border-amber-300 rounded-lg text-xs text-amber-950 space-y-1">
                            <p className="font-bold flex items-center gap-1.5">
                              <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                              Source Grounding Flag:
                            </p>
                            <p className="break-words">
                              {item.uncertaintyReason ||
                                'This concept was flagged because the handwritten notes were unclear or lacked sufficient detail to expand without external knowledge.'}
                            </p>
                          </div>
                        )}

                        {/* Verbatim Supporting Source Passage */}
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <label className="text-xs font-semibold text-slate-600">
                              Supporting Source Passage (Verbatim from Notes)
                            </label>
                            <div className="flex items-center gap-1.5 text-xs text-slate-500">
                              <span>Page:</span>
                              <input
                                type="number"
                                min={1}
                                max={Math.max(1, pages.length)}
                                value={item.sourcePageReference}
                                onChange={(e) =>
                                  updateConceptItem(section.id, item.id, (prev) => ({
                                    ...prev,
                                    sourcePageReference: Math.max(1, Number(e.target.value) || 1),
                                  }))
                                }
                                className="w-14 px-2 py-0.5 text-xs font-mono bg-white border border-slate-200 rounded"
                              />
                            </div>
                          </div>
                          <textarea
                            rows={2}
                            value={item.supportingSourcePassage}
                            onChange={(e) =>
                              updateConceptItem(section.id, item.id, (prev) => ({
                                ...prev,
                                supportingSourcePassage: e.target.value,
                              }))
                            }
                            className="w-full p-2.5 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:border-sky-600"
                          />
                        </div>

                        {/* Generated English Explanation */}
                        <div className="space-y-1">
                          <label className="text-xs font-semibold text-slate-700">
                            Detailed Study Explanation
                          </label>
                          <textarea
                            rows={3}
                            value={item.generatedExplanation}
                            onChange={(e) =>
                              updateConceptItem(section.id, item.id, (prev) => ({
                                ...prev,
                                generatedExplanation: e.target.value,
                              }))
                            }
                            className="w-full p-2.5 text-xs sm:text-sm bg-white border border-slate-200 rounded-lg text-slate-900 leading-relaxed focus:outline-none focus:border-sky-600"
                          />
                        </div>

                        {/* Formulas & Step-by-Step Derivations */}
                        <div className="space-y-2 pt-1">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-slate-700">
                              Formulas & Derivations ({item.formulasAndDerivations?.length || 0})
                            </span>
                            <button
                              type="button"
                              onClick={() => handleAddDerivationStep(section.id, item.id)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md cursor-pointer"
                            >
                              <Plus className="w-3 h-3" />
                              Add Step
                            </button>
                          </div>

                          {item.formulasAndDerivations &&
                            item.formulasAndDerivations.length > 0 && (
                              <div className="space-y-2 bg-slate-50 p-2.5 sm:p-3 rounded-lg border border-slate-200">
                                {item.formulasAndDerivations.map((step, sIdx) => (
                                  <div
                                    key={sIdx}
                                    className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center"
                                  >
                                    <span className="sm:col-span-2 text-xs font-mono font-bold text-sky-800">
                                      Step {step.stepNumber}
                                    </span>
                                    <input
                                      type="text"
                                      value={step.expression}
                                      onChange={(e) =>
                                        updateConceptItem(section.id, item.id, (prev) => {
                                          const next = [...prev.formulasAndDerivations];
                                          next[sIdx] = {
                                            ...next[sIdx],
                                            expression: e.target.value,
                                          };
                                          return { ...prev, formulasAndDerivations: next };
                                        })
                                      }
                                      placeholder="Formula expression..."
                                      className="sm:col-span-5 px-2.5 py-1.5 text-xs font-mono font-semibold bg-white border border-slate-200 rounded-md text-slate-900 min-w-0"
                                    />
                                    <input
                                      type="text"
                                      value={step.explanation}
                                      onChange={(e) =>
                                        updateConceptItem(section.id, item.id, (prev) => {
                                          const next = [...prev.formulasAndDerivations];
                                          next[sIdx] = {
                                            ...next[sIdx],
                                            explanation: e.target.value,
                                          };
                                          return { ...prev, formulasAndDerivations: next };
                                        })
                                      }
                                      placeholder="Step explanation..."
                                      className="sm:col-span-4 px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-md text-slate-700 min-w-0"
                                    />
                                    <button
                                      type="button"
                                      onClick={() =>
                                        updateConceptItem(section.id, item.id, (prev) => ({
                                          ...prev,
                                          formulasAndDerivations: prev.formulasAndDerivations
                                            .filter((_, idx) => idx !== sIdx)
                                            .map((st, idx) => ({ ...st, stepNumber: idx + 1 })),
                                        }))
                                      }
                                      className="sm:col-span-1 p-1 text-slate-400 hover:text-red-600 justify-self-end cursor-pointer"
                                      title="Remove step"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}
                        </div>

                        {/* Cropped Source Diagram & Labels */}
                        {item.diagramRegion && (
                          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2.5">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-bold text-slate-800">
                                Extracted Source Diagram (Page {item.diagramRegion.pageNumber})
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  updateConceptItem(section.id, item.id, (prev) => ({
                                    ...prev,
                                    diagramRegion: undefined,
                                  }))
                                }
                                className="text-xs text-red-600 hover:underline cursor-pointer"
                              >
                                Remove Diagram
                              </button>
                            </div>

                            {item.diagramRegion.croppedDataUrl && (
                              <div className="bg-white border border-slate-200 rounded-lg p-2 flex justify-center">
                                <img
                                  src={item.diagramRegion.croppedDataUrl}
                                  alt={item.diagramRegion.caption}
                                  referrerPolicy="no-referrer"
                                  className="max-h-44 object-contain"
                                />
                              </div>
                            )}

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              <div>
                                <label className="block text-[11px] text-slate-500 mb-1">
                                  Diagram Caption
                                </label>
                                <input
                                  type="text"
                                  value={item.diagramRegion.caption}
                                  onChange={(e) =>
                                    updateConceptItem(section.id, item.id, (prev) => ({
                                      ...prev,
                                      diagramRegion: prev.diagramRegion
                                        ? { ...prev.diagramRegion, caption: e.target.value }
                                        : undefined,
                                    }))
                                  }
                                  className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-md text-slate-900"
                                />
                              </div>
                              <div>
                                <label className="block text-[11px] text-slate-500 mb-1">
                                  Extracted Diagram Labels
                                </label>
                                <input
                                  type="text"
                                  value={(item.diagramRegion.labels || []).join(', ')}
                                  onChange={(e) =>
                                    updateConceptItem(section.id, item.id, (prev) => ({
                                      ...prev,
                                      diagramRegion: prev.diagramRegion
                                        ? {
                                            ...prev.diagramRegion,
                                            labels: e.target.value
                                              .split(',')
                                              .map((s) => s.trim())
                                              .filter(Boolean),
                                          }
                                        : undefined,
                                    }))
                                  }
                                  className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-200 rounded-md text-slate-800"
                                />
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <button
              type="button"
              onClick={handleAddSection}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              Add New Section
            </button>

            <button
              type="button"
              onClick={() => onNavigateModule('pdf_mcq')}
              className="inline-flex items-center gap-1.5 px-5 py-2.5 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-lg transition-colors cursor-pointer"
            >
              <Sparkles className="w-4 h-4" />
              Continue to PDF & MCQ Studio
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
