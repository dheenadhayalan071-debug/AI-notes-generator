/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import {
  StudyUnitDocument,
  ModuleId,
  SourcePage,
  BackupRestoreMode,
} from './types';
import {
  getAllStudyUnits,
  getAllSavedSubjects,
  saveSubjectCategory,
  renameSubjectAcrossUnits,
  deleteSubjectCategory,
  saveStudyUnit,
  deleteStudyUnit,
  exportLibraryBackupJson,
  applyValidatedBackup,
  ValidatedBackupPreview,
} from './db/indexedDb';
import { cropDiagramFromPage } from './utils/imageCropper';
import { downloadUnitStudyPdf } from './utils/pdfExport';
import { DashboardModule } from './components/DashboardModule';
import { NotesUploadModule } from './components/NotesUploadModule';
import { AiProcessingModule } from './components/AiProcessingModule';
import { StudyEditorModule } from './components/StudyEditorModule';
import { PdfMcqModule } from './components/PdfMcqModule';

const NAV_MODULES: Array<{ id: ModuleId; label: string }> = [
  { id: 'dashboard', label: '01. Dashboard' },
  { id: 'upload', label: '02. Notes Upload' },
  { id: 'processing', label: '03. AI Processing' },
  { id: 'editor', label: '04. Study Editor' },
  { id: 'pdf_mcq', label: '05. PDF & MCQs' },
];

export default function App() {
  const [activeModule, setActiveModule] = useState<ModuleId>('dashboard');
  const [units, setUnits] = useState<StudyUnitDocument[]>([]);
  const [savedSubjects, setSavedSubjects] = useState<string[]>([]);
  const [activeUnitId, setActiveUnitId] = useState<string>('');
  const [selectedSubjectFilter, setSelectedSubjectFilter] = useState<string>('ALL');
  const [isLoadingLibrary, setIsLoadingLibrary] = useState(true);

  // Flexible Upload Module State (starts empty for user input)
  const [uploadSubject, setUploadSubject] = useState<string>('');
  const [uploadUnitNumber, setUploadUnitNumber] = useState<number>(1);
  const [uploadUnitTitle, setUploadUnitTitle] = useState<string>('');
  const [uploadedPages, setUploadedPages] = useState<SourcePage[]>([]);

  // AI Processing State
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStageIndex, setProcessingStageIndex] = useState(0);
  const [processingError, setProcessingError] = useState<string | null>(null);
  const [isSynthesizingMcqs, setIsSynthesizingMcqs] = useState(false);

  // Load user's saved study units and custom subjects from IndexedDB (starts completely empty)
  useEffect(() => {
    let mounted = true;
    async function initLibrary() {
      try {
        const [storedUnits, storedSubjects] = await Promise.all([
          getAllStudyUnits(),
          getAllSavedSubjects(),
        ]);
        if (mounted) {
          setUnits(storedUnits);
          setSavedSubjects(storedSubjects);
          if (storedUnits.length > 0) {
            setActiveUnitId(storedUnits[0].id);
          }
        }
      } catch (err) {
        console.error('Failed to initialize IndexedDB library:', err);
      } finally {
        if (mounted) setIsLoadingLibrary(false);
      }
    }
    initLibrary();
    return () => {
      mounted = false;
    };
  }, []);

  const activeUnit = units.find((u) => u.id === activeUnitId) || units[0];

  const existingSubjects = Array.from(
    new Set([...savedSubjects, ...units.map((u) => u.subject).filter(Boolean)])
  ).sort((a, b) => a.localeCompare(b));

  const handleUpdateUnit = async (updated: StudyUnitDocument) => {
    const saved = await saveStudyUnit(updated);
    const updatedSubjects = await getAllSavedSubjects();
    setUnits((prev) => prev.map((u) => (u.id === saved.id ? saved : u)));
    setSavedSubjects(updatedSubjects);
  };

  const handleDeleteUnit = async (unitId: string) => {
    await deleteStudyUnit(unitId);
    const remaining = units.filter((u) => u.id !== unitId);
    setUnits(remaining);
    if (activeUnitId === unitId) {
      setActiveUnitId(remaining[0]?.id || '');
    }
  };

  const handleCreateSubjectCategory = async (subjectName: string) => {
    await saveSubjectCategory(subjectName);
    const updatedSubjects = await getAllSavedSubjects();
    setSavedSubjects(updatedSubjects);
  };

  const handleRenameSubjectCategory = async (oldName: string, newName: string) => {
    await renameSubjectAcrossUnits(oldName, newName);
    const [updatedUnits, updatedSubjects] = await Promise.all([
      getAllStudyUnits(),
      getAllSavedSubjects(),
    ]);
    setUnits(updatedUnits);
    setSavedSubjects(updatedSubjects);
  };

  const handleDeleteSubjectCategory = async (subjectName: string) => {
    await deleteSubjectCategory(subjectName);
    const updatedSubjects = await getAllSavedSubjects();
    setSavedSubjects(updatedSubjects);
    if (selectedSubjectFilter === subjectName) {
      setSelectedSubjectFilter('ALL');
    }
  };

  const handleOpenUnitInModule = (unitId: string, targetModule: ModuleId) => {
    setActiveUnitId(unitId);
    setActiveModule(targetModule);
  };

  const handleStartUpload = (
    subject?: string,
    unitNumber?: number,
    unitTitle?: string
  ) => {
    if (subject !== undefined) setUploadSubject(subject);
    if (unitNumber !== undefined) setUploadUnitNumber(unitNumber);
    if (unitTitle !== undefined) setUploadUnitTitle(unitTitle);
    setActiveModule('upload');
  };

  const handleRunAiProcessing = async () => {
    if (uploadedPages.length === 0) return;
    const cleanSubject = uploadSubject.trim() || 'General Studies';
    const cleanTitle = uploadUnitTitle.trim() || `Unit ${uploadUnitNumber} Notes`;

    setActiveModule('processing');
    setIsProcessing(true);
    setProcessingError(null);
    setProcessingStageIndex(0);

    const controller = new AbortController();
    const abortTimeout = setTimeout(() => controller.abort(), 290000);

    const stageTimer = setInterval(() => {
      setProcessingStageIndex((prev) => (prev < 4 ? prev + 1 : prev));
    }, 1400);

    try {
      const response = await fetch('/api/notes/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          subject: cleanSubject,
          unitNumber: uploadUnitNumber,
          unitTitle: cleanTitle,
          pages: uploadedPages,
        }),
      });

      let responseText = '';
      try {
        responseText = await response.text();
      } catch (readErr: any) {
        throw new Error(`Failed to read response from server: ${readErr?.message || 'Network error'}`);
      }

      let data: any;
      try {
        data = JSON.parse(responseText);
      } catch {
        // Response was not valid JSON (e.g. 404 HTML, 502/504 Bad Gateway, or plain text)
        if (!response.ok) {
          if (response.status === 504) {
            throw new Error(
              'Server execution reached duration threshold (HTTP 504 Gateway Timeout). Your notes may be large—please retry, or verify Vercel Fluid Compute 300s limit is applied.'
            );
          }
          throw new Error(
            `Backend server error (HTTP ${response.status} ${response.statusText}): ${
              responseText.slice(0, 200).trim() || 'API route not reachable'
            }`
          );
        } else {
          throw new Error(
            `Server returned non-JSON output (HTTP ${response.status}): ${responseText.slice(0, 200).trim()}`
          );
        }
      }

      if (!response.ok) {
        const errorMsg =
          typeof data.error === 'object' && data.error?.message
            ? data.error.message
            : data.error || data.message || `Processing failed (HTTP ${response.status}): ${response.statusText}`;
        throw new Error(errorMsg);
      }

      // Support payload whether under data envelope or direct root
      const payloadData = data.data || data;

      const transcriptMap = new Map<number, string>();
      if (Array.isArray(payloadData.rawPageTranscripts)) {
        for (const pt of payloadData.rawPageTranscripts) {
          transcriptMap.set(Number(pt.pageNumber) || 1, String(pt.rawTranscript || ''));
        }
      }

      const enrichedPages: SourcePage[] = uploadedPages.map((p) => ({
        ...p,
        rawTranscript: transcriptMap.get(p.pageNumber) || p.rawTranscript || '',
      }));

      // Crop any detected diagram regions directly from the uploaded page scan
      const enrichedSections = await Promise.all(
        (payloadData.sections || []).map(async (sec: any) => {
          const itemsWithCrops = await Promise.all(
            (sec.items || []).map(async (item: any) => {
              if (item.diagramRegion && item.diagramRegion.box2d) {
                const targetPage =
                  enrichedPages.find((p) => p.pageNumber === item.diagramRegion.pageNumber) ||
                  enrichedPages[0];
                if (targetPage && targetPage.mimeType !== 'application/pdf') {
                  const croppedDataUrl = await cropDiagramFromPage(
                    targetPage.dataUrl,
                    item.diagramRegion.box2d
                  );
                  return {
                    ...item,
                    diagramRegion: {
                      ...item.diagramRegion,
                      croppedDataUrl,
                    },
                  };
                }
              }
              return item;
            })
          );
          return {
            ...sec,
            items: itemsWithCrops,
          };
        })
      );

      const now = new Date().toISOString();
      const newUnit: StudyUnitDocument = {
        id: `unit-${cleanSubject.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${uploadUnitNumber}-${Date.now()}`,
        subject: cleanSubject,
        unitNumber: uploadUnitNumber,
        unitTitle: cleanTitle,
        createdAt: now,
        updatedAt: now,
        sourcePages: enrichedPages,
        sections: enrichedSections,
        mcqs: payloadData.mcqs || [],
        mcqGenerationNote: payloadData.mcqGenerationNote,
        mcqStatus: 'PENDING',
      };

      const saved = await saveStudyUnit(newUnit);
      const updatedSubjects = await getAllSavedSubjects();
      setUnits((prev) => [saved, ...prev]);
      setSavedSubjects(updatedSubjects);
      setActiveUnitId(saved.id);
      setUploadedPages([]);
      setProcessingStageIndex(4);

      // Start asynchronous Stage 05 MCQ synthesis independently in the background
      handleSynthesizeMcqsForUnit(saved);
    } catch (err: any) {
      setProcessingError(
        err?.message || 'An unexpected error occurred during Gemini Vision processing.'
      );
    } finally {
      clearTimeout(abortTimeout);
      clearInterval(stageTimer);
      setIsProcessing(false);
    }
  };

  const handleSynthesizeMcqsForUnit = async (targetUnit: StudyUnitDocument) => {
    const allItems = targetUnit.sections.flatMap((s) => s.items);
    if (allItems.length === 0) {
      const updated: StudyUnitDocument = {
        ...targetUnit,
        mcqStatus: 'PARTIAL',
        mcqGenerationNote: 'No concepts found to generate practice questions.',
      };
      await handleUpdateUnit(updated);
      return;
    }

    setIsSynthesizingMcqs(true);
    const inProgressUnit: StudyUnitDocument = {
      ...targetUnit,
      mcqStatus: 'PROCESSING',
    };
    await handleUpdateUnit(inProgressUnit);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 26000);

    try {
      const response = await fetch('/api/notes/regenerate-mcqs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          subject: targetUnit.subject,
          unitNumber: targetUnit.unitNumber,
          unitTitle: targetUnit.unitTitle,
          sections: targetUnit.sections,
        }),
      });
      clearTimeout(timeoutId);

      const rawText = await response.text();
      let data: any = {};
      try {
        data = rawText ? JSON.parse(rawText) : {};
      } catch {
        throw new Error(
          `MCQ synthesis returned non-JSON response (HTTP ${response.status}).`
        );
      }

      if (!response.ok) {
        const errorMsg =
          typeof data.error === 'object' && data.error?.message
            ? data.error.message
            : data.error || data.message || `Synthesis failed (HTTP ${response.status})`;
        throw new Error(errorMsg);
      }

      const payloadData = data.data || data;
      const finalUnit: StudyUnitDocument = {
        ...targetUnit,
        mcqs: payloadData.mcqs || [],
        mcqGenerationNote:
          payloadData.mcqGenerationNote || 'Practice questions synthesized from verified passages.',
        mcqStatus:
          payloadData.status || (payloadData.mcqs?.length > 0 ? 'COMPLETED' : 'PARTIAL'),
        updatedAt: new Date().toISOString(),
      };
      await handleUpdateUnit(finalUnit);
    } catch (err: any) {
      console.warn('MCQ Synthesis notice:', err?.message);
      const isAbort = err?.name === 'AbortError' || err?.message?.includes('aborted');
      const failReason = isAbort
        ? 'MCQ generation timed out after 26 seconds. Your study notes and PDF are ready; you can retry MCQ synthesis at any time.'
        : err?.message ||
          'MCQ generation encountered an issue. You can retry generating questions without re-processing notes.';

      const failedUnit: StudyUnitDocument = {
        ...targetUnit,
        mcqStatus: 'FAILED',
        mcqGenerationNote: failReason,
        updatedAt: new Date().toISOString(),
      };
      await handleUpdateUnit(failedUnit);
    } finally {
      clearTimeout(timeoutId);
      setIsSynthesizingMcqs(false);
    }
  };

  const handleExportBackup = async () => {
    const jsonStr = await exportLibraryBackupJson();
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const dateStamp = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `AI_Notes_Studio_Backup_${dateStamp}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const handleConfirmRestoreBackup = async (
    preview: ValidatedBackupPreview,
    mode: BackupRestoreMode
  ) => {
    const { units: restoredUnits, subjects: restoredSubjects } =
      await applyValidatedBackup(preview, mode);
    setUnits(restoredUnits);
    setSavedSubjects(restoredSubjects);
    if (restoredUnits.length > 0) {
      setActiveUnitId(restoredUnits[0].id);
    } else {
      setActiveUnitId('');
    }
  };

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-hidden flex flex-col bg-[#F8FAFC] text-[#0F172A]">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-xs border-b border-slate-200 px-3 sm:px-8 py-3 flex items-center justify-between gap-4 sm:gap-8 no-print">
        {/* Zone 1: Single text element brand wordmark */}
        <a
          href="#dashboard"
          onClick={(e) => {
            e.preventDefault();
            setActiveModule('dashboard');
          }}
          className="text-base sm:text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 font-display"
        >
          AI Notes Studio
        </a>

        {/* Zone 2: 5 single-line module navigation links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
          {NAV_MODULES.map((mod) => {
            const isActive = activeModule === mod.id;
            return (
              <a
                key={mod.id}
                href={`#${mod.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  setActiveModule(mod.id);
                }}
                className={`transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 ${
                  isActive
                    ? 'text-sky-700 font-semibold border-sky-600'
                    : 'text-slate-600 hover:text-slate-900 border-transparent'
                }`}
              >
                {mod.label}
              </a>
            );
          })}
        </nav>

        {/* Zone 3: 1 Primary Action Button */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setActiveModule('upload')}
            className="px-3.5 py-2 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Upload Notes
          </button>
        </div>
      </header>

      {/* Mobile Horizontal Module Switcher (< 768px) */}
      <div className="md:hidden bg-white border-b border-slate-200 px-3 py-2 flex items-center gap-1.5 overflow-x-auto no-print">
        {NAV_MODULES.map((mod) => {
          const isActive = activeModule === mod.id;
          return (
            <button
              key={mod.id}
              type="button"
              onClick={() => setActiveModule(mod.id)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                isActive
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-600 hover:text-slate-900'
              }`}
            >
              {mod.label}
            </button>
          );
        })}
      </div>

      {/* Main Content Workspace */}
      <main className="flex-1 w-full max-w-[1360px] mx-auto px-3 sm:px-8 py-5 sm:py-8">
        {isLoadingLibrary ? (
          <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-2">
            <p className="text-sm font-bold text-slate-900">
              Loading Your Study Library...
            </p>
            <p className="text-xs text-slate-500">
              Connecting to local IndexedDB storage.
            </p>
          </div>
        ) : (
          <>
            {activeModule === 'dashboard' && (
              <DashboardModule
                units={units}
                savedSubjects={savedSubjects}
                activeUnitId={activeUnit?.id || ''}
                selectedSubjectFilter={selectedSubjectFilter}
                onSelectSubjectFilter={setSelectedSubjectFilter}
                onOpenUnitInModule={handleOpenUnitInModule}
                onStartUpload={handleStartUpload}
                onCreateSubjectCategory={handleCreateSubjectCategory}
                onRenameSubjectCategory={handleRenameSubjectCategory}
                onDeleteSubjectCategory={handleDeleteSubjectCategory}
                onUpdateUnit={handleUpdateUnit}
                onDeleteUnit={handleDeleteUnit}
                onDownloadUnitPdf={(unit) => downloadUnitStudyPdf(unit, true)}
                onExportBackup={handleExportBackup}
                onConfirmRestoreBackup={handleConfirmRestoreBackup}
              />
            )}

            {activeModule === 'upload' && (
              <NotesUploadModule
                existingSubjects={existingSubjects}
                selectedSubject={uploadSubject}
                selectedUnitNumber={uploadUnitNumber}
                selectedUnitTitle={uploadUnitTitle}
                uploadedPages={uploadedPages}
                onChangeSubject={setUploadSubject}
                onChangeUnitNumber={setUploadUnitNumber}
                onChangeUnitTitle={setUploadUnitTitle}
                onChangePages={setUploadedPages}
                onStartProcessing={handleRunAiProcessing}
              />
            )}

            {activeModule === 'processing' && (
              <AiProcessingModule
                isProcessing={isProcessing}
                processingStageIndex={processingStageIndex}
                processingError={processingError}
                activeUnit={activeUnit}
                isSynthesizingMcqs={isSynthesizingMcqs}
                mcqJobStatus={activeUnit?.mcqStatus}
                onRetryProcessing={handleRunAiProcessing}
                onTriggerMcqSynthesis={() => {
                  if (activeUnit) {
                    handleSynthesizeMcqsForUnit(activeUnit);
                  }
                }}
                onNavigateModule={setActiveModule}
              />
            )}

            {activeModule === 'editor' && (
              <StudyEditorModule
                units={units}
                activeUnit={activeUnit}
                onSelectUnit={setActiveUnitId}
                onUpdateUnit={handleUpdateUnit}
                onNavigateModule={setActiveModule}
              />
            )}

            {activeModule === 'pdf_mcq' && (
              <PdfMcqModule
                units={units}
                activeUnit={activeUnit}
                onSelectUnit={setActiveUnitId}
                onUpdateUnit={handleUpdateUnit}
                onDownloadUnitPdf={async (unit, includeMcqs) => {
                  await downloadUnitStudyPdf(unit, includeMcqs);
                }}
                onNavigateModule={setActiveModule}
              />
            )}
          </>
        )}
      </main>

      {/* Quiet Academic Footer */}
      <footer className="bg-white border-t border-slate-200 px-3 sm:px-8 py-4 mt-10 no-print">
        <div className="max-w-[1360px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500 text-center sm:text-left">
          <span>
            AI Notes Studio · Personal Handwritten Notes to Source-Verified Study Materials
          </span>
          <span>Local IndexedDB Storage · JSON Backup & Individual Unit PDF Export</span>
        </div>
      </footer>
    </div>
  );
}
