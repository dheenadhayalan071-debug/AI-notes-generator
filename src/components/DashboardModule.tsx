import React, { useRef, useState } from 'react';
import {
  BookOpen,
  Upload,
  CheckCircle2,
  AlertTriangle,
  FileText,
  Download,
  Trash2,
  Search,
  Database,
  FileUp,
  HelpCircle,
  Plus,
  Edit3,
  FolderPlus,
  Check,
  X,
} from 'lucide-react';
import {
  StudyUnitDocument,
  ModuleId,
  BackupRestoreMode,
} from '../types';
import {
  ValidatedBackupPreview,
  validateBackupJsonString,
} from '../db/indexedDb';

interface DashboardModuleProps {
  units: StudyUnitDocument[];
  savedSubjects: string[];
  activeUnitId: string;
  selectedSubjectFilter: string;
  onSelectSubjectFilter: (subject: string) => void;
  onOpenUnitInModule: (unitId: string, targetModule: ModuleId) => void;
  onStartUpload: (subject?: string, unitNumber?: number, unitTitle?: string) => void;
  onCreateSubjectCategory: (subjectName: string) => Promise<void>;
  onRenameSubjectCategory: (oldName: string, newName: string) => Promise<void>;
  onDeleteSubjectCategory: (subjectName: string) => Promise<void>;
  onUpdateUnit: (updated: StudyUnitDocument) => Promise<void>;
  onDeleteUnit: (unitId: string) => void;
  onDownloadUnitPdf: (unit: StudyUnitDocument) => void;
  onExportBackup: () => Promise<void>;
  onConfirmRestoreBackup: (
    preview: ValidatedBackupPreview,
    mode: BackupRestoreMode
  ) => Promise<void>;
}

export const DashboardModule: React.FC<DashboardModuleProps> = ({
  units,
  savedSubjects,
  activeUnitId,
  selectedSubjectFilter,
  onSelectSubjectFilter,
  onOpenUnitInModule,
  onStartUpload,
  onCreateSubjectCategory,
  onRenameSubjectCategory,
  onDeleteSubjectCategory,
  onUpdateUnit,
  onDeleteUnit,
  onDownloadUnitPdf,
  onExportBackup,
  onConfirmRestoreBackup,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusBanner, setStatusBanner] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Subject creation & renaming state
  const [isAddingSubject, setIsAddingSubject] = useState(false);
  const [newSubjectName, setNewSubjectName] = useState('');
  const [editingSubjectName, setEditingSubjectName] = useState<string | null>(null);
  const [editingSubjectValue, setEditingSubjectValue] = useState('');

  // Unit inline renaming state
  const [editingUnitId, setEditingUnitId] = useState<string | null>(null);
  const [editUnitSubject, setEditUnitSubject] = useState('');
  const [editUnitNumber, setEditUnitNumber] = useState(1);
  const [editUnitTitle, setEditUnitTitle] = useState('');

  // Backup validation & Merge/Replace modal state
  const [pendingBackupPreview, setPendingBackupPreview] =
    useState<ValidatedBackupPreview | null>(null);
  const [pendingBackupFileName, setPendingBackupFileName] = useState<string>('');
  const [isApplyingBackup, setIsApplyingBackup] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Combine saved custom subjects and subjects derived from units
  const allSubjects = Array.from(
    new Set([...savedSubjects, ...units.map((u) => u.subject).filter(Boolean)])
  ).sort((a, b) => a.localeCompare(b));

  const filteredUnits = units.filter((u) => {
    const matchesSubject =
      selectedSubjectFilter === 'ALL' || u.subject === selectedSubjectFilter;
    const q = searchQuery.trim().toLowerCase();
    if (!q) return matchesSubject;
    const matchesTitle =
      u.unitTitle.toLowerCase().includes(q) ||
      u.subject.toLowerCase().includes(q) ||
      `unit ${u.unitNumber}`.includes(q) ||
      u.sections.some((s) =>
        s.items.some(
          (i) =>
            i.originalKeyword.toLowerCase().includes(q) ||
            i.generatedExplanation.toLowerCase().includes(q)
        )
      );
    return matchesSubject && matchesTitle;
  });

  // Compute exact library metrics (all 0 on fresh install)
  const totalSavedUnits = units.length;
  const totalUploadedDocs = units.reduce(
    (sum, u) => sum + (u.sourcePages?.length || 0),
    0
  );
  const totalConcepts = units.reduce(
    (sum, u) => sum + u.sections.reduce((sSum, s) => sSum + s.items.length, 0),
    0
  );
  const totalVerified = units.reduce(
    (sum, u) =>
      sum +
      u.sections.reduce(
        (sSum, s) => sSum + s.items.filter((i) => i.verificationStatus === 'VERIFIED').length,
        0
      ),
    0
  );
  const totalPendingReviews = totalConcepts - totalVerified;
  const totalMcqs = units.reduce((sum, u) => sum + (u.mcqs?.length || 0), 0);

  const handleBackupExportClick = async () => {
    try {
      await onExportBackup();
      setStatusBanner({
        type: 'success',
        text: 'Library backup (.json) exported successfully.',
      });
    } catch (err: any) {
      setStatusBanner({
        type: 'error',
        text: err?.message || 'Failed to export backup.',
      });
    }
  };

  const handleBackupFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const jsonText = await file.text();
      const preview = validateBackupJsonString(jsonText);
      setPendingBackupFileName(file.name);
      setPendingBackupPreview(preview);
      setStatusBanner(null);
    } catch (err: any) {
      setStatusBanner({
        type: 'error',
        text: err?.message || 'Invalid backup file.',
      });
    } finally {
      e.target.value = '';
    }
  };

  const handleExecuteBackupRestore = async (mode: BackupRestoreMode) => {
    if (!pendingBackupPreview) return;
    setIsApplyingBackup(true);
    try {
      await onConfirmRestoreBackup(pendingBackupPreview, mode);
      setStatusBanner({
        type: 'success',
        text: `Successfully ${
          mode === 'merge' ? 'merged' : 'restored and replaced library with'
        } ${pendingBackupPreview.unitCount} study unit(s) from "${pendingBackupFileName}".`,
      });
      setPendingBackupPreview(null);
    } catch (err: any) {
      setStatusBanner({
        type: 'error',
        text: err?.message || 'Failed to restore backup.',
      });
    } finally {
      setIsApplyingBackup(false);
    }
  };

  const handleAddSubjectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = newSubjectName.trim();
    if (!clean) return;
    await onCreateSubjectCategory(clean);
    setNewSubjectName('');
    setIsAddingSubject(false);
    onSelectSubjectFilter(clean);
  };

  const handleRenameSubjectSubmit = async (oldName: string) => {
    const clean = editingSubjectValue.trim();
    if (clean && clean !== oldName) {
      await onRenameSubjectCategory(oldName, clean);
      if (selectedSubjectFilter === oldName) {
        onSelectSubjectFilter(clean);
      }
    }
    setEditingSubjectName(null);
  };

  const startEditingUnit = (unit: StudyUnitDocument) => {
    setEditingUnitId(unit.id);
    setEditUnitSubject(unit.subject);
    setEditUnitNumber(unit.unitNumber);
    setEditUnitTitle(unit.unitTitle);
  };

  const saveEditingUnit = async (unit: StudyUnitDocument) => {
    await onUpdateUnit({
      ...unit,
      subject: editUnitSubject.trim() || unit.subject,
      unitNumber: Math.max(1, Number(editUnitNumber) || 1),
      unitTitle: editUnitTitle.trim() || unit.unitTitle,
    });
    setEditingUnitId(null);
  };

  return (
    <div className="space-y-6 w-full max-w-full overflow-x-hidden">
      {/* Top Overview & Data Backup Section */}
      <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="space-y-1.5 min-w-0">
            <p className="text-xs font-medium text-sky-700">
              01. Dashboard · Personal Study Library
            </p>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
              Handwritten Notes to Source-Verified Study Materials
            </h1>
            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed max-w-2xl">
              Upload handwritten notes or PDFs from any subject or chapter. AI extracts original
              keywords, formulas, and diagrams while flagging unclear handwriting for your review.
            </p>
          </div>

          {/* Primary Actions & Backup Controls */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleBackupExportClick}
              disabled={units.length === 0 && allSubjects.length === 0}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 rounded-lg transition-colors cursor-pointer"
            >
              <Database className="w-3.5 h-3.5 text-slate-600 shrink-0" />
              <span>Export Backup</span>
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
            >
              <FileUp className="w-3.5 h-3.5 text-slate-600 shrink-0" />
              <span>Restore Backup</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              onChange={handleBackupFileSelected}
              className="hidden"
            />
            <button
              type="button"
              onClick={() =>
                onStartUpload(
                  selectedSubjectFilter !== 'ALL' ? selectedSubjectFilter : '',
                  1,
                  ''
                )
              }
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-lg transition-colors cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5 shrink-0" />
              <span>Upload Notes</span>
            </button>
          </div>
        </div>

        {/* Backup Validation & Merge vs Replace Confirmation Panel */}
        {pendingBackupPreview && (
          <div className="mt-4 p-4 bg-sky-50 border border-sky-200 rounded-xl space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Validate & Restore Backup: {pendingBackupFileName}
                </h3>
                <p className="text-xs text-slate-600 mt-0.5">
                  Contains <strong>{pendingBackupPreview.unitCount}</strong> study unit(s) across{' '}
                  <strong>{pendingBackupPreview.subjectList.join(', ') || '1 subject'}</strong> ·{' '}
                  {pendingBackupPreview.totalConcepts} concepts · {pendingBackupPreview.totalMcqs}{' '}
                  MCQs
                </p>
              </div>
              <span className="text-xs font-mono text-slate-500">
                Exported: {new Date(pendingBackupPreview.exportedAt).toLocaleDateString()}
              </span>
            </div>

            <p className="text-xs text-slate-700">
              How would you like to restore this backup? Choosing <strong>Merge</strong> keeps your
              current study units and adds/updates records from the backup. Choosing{' '}
              <strong>Replace</strong> clears your current library first.
            </p>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                disabled={isApplyingBackup}
                onClick={() => handleExecuteBackupRestore('merge')}
                className="px-3.5 py-2 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-lg cursor-pointer"
              >
                Merge with Existing Library
              </button>
              <button
                type="button"
                disabled={isApplyingBackup}
                onClick={() => handleExecuteBackupRestore('replace')}
                className="px-3.5 py-2 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-lg cursor-pointer"
              >
                Replace Entire Library
              </button>
              <button
                type="button"
                disabled={isApplyingBackup}
                onClick={() => setPendingBackupPreview(null)}
                className="px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {statusBanner && (
          <div
            className={`mt-4 px-4 py-3 rounded-lg border text-xs font-medium flex items-center justify-between gap-3 ${
              statusBanner.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                : 'bg-red-50 border-red-200 text-red-900'
            }`}
          >
            <span className="min-w-0 break-words">{statusBanner.text}</span>
            <button
              type="button"
              onClick={() => setStatusBanner(null)}
              className="text-xs underline font-semibold shrink-0 cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* 5 Core Library Metrics Strip (All 0 on fresh install) */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mt-5 pt-5 border-t border-slate-200">
          <div className="p-3 bg-slate-50/70 rounded-lg border border-slate-100">
            <p className="text-xs text-slate-500">Saved Study Units</p>
            <p className="text-xl sm:text-2xl font-bold text-slate-900 font-mono tabular-nums mt-0.5">
              {totalSavedUnits}
            </p>
          </div>
          <div className="p-3 bg-slate-50/70 rounded-lg border border-slate-100">
            <p className="text-xs text-slate-500">Uploaded Documents</p>
            <p className="text-xl sm:text-2xl font-bold text-slate-900 font-mono tabular-nums mt-0.5">
              {totalUploadedDocs}
            </p>
          </div>
          <div className="p-3 bg-slate-50/70 rounded-lg border border-slate-100">
            <p className="text-xs text-slate-500">Verified Concepts</p>
            <p className="text-xl sm:text-2xl font-bold text-emerald-700 font-mono tabular-nums mt-0.5">
              {totalVerified}
            </p>
          </div>
          <div className="p-3 bg-slate-50/70 rounded-lg border border-slate-100">
            <p className="text-xs text-slate-500">Pending Reviews</p>
            <p className="text-xl sm:text-2xl font-bold text-amber-700 font-mono tabular-nums mt-0.5">
              {totalPendingReviews}
            </p>
          </div>
          <div className="p-3 bg-slate-50/70 rounded-lg border border-slate-100 col-span-2 sm:col-span-1">
            <p className="text-xs text-slate-500">Generated MCQs</p>
            <p className="text-xl sm:text-2xl font-bold text-sky-700 font-mono tabular-nums mt-0.5">
              {totalMcqs}
            </p>
          </div>
        </div>
      </section>

      {/* COMPLETELY EMPTY INITIAL STATE */}
      {units.length === 0 && allSubjects.length === 0 ? (
        <section className="bg-white border border-slate-200 rounded-xl p-8 sm:p-12 text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-sky-50 border border-sky-100 flex items-center justify-center mx-auto">
            <BookOpen className="w-6 h-6 text-sky-600" />
          </div>
          <div className="space-y-1.5 max-w-md mx-auto">
            <h2 className="text-lg sm:text-xl font-bold text-slate-900">
              Your Study Library is Empty
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
              Upload your handwritten classroom notes to generate detailed study materials.
            </p>
          </div>
          <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => onStartUpload('', 1, '')}
              className="inline-flex items-center justify-center gap-2 px-5 py-3 text-xs sm:text-sm font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-lg transition-colors cursor-pointer"
            >
              <Upload className="w-4 h-4" />
              Upload Your First Notes
            </button>
            <button
              type="button"
              onClick={() => setIsAddingSubject(true)}
              className="inline-flex items-center justify-center gap-2 px-4 py-3 text-xs sm:text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
            >
              <FolderPlus className="w-4 h-4" />
              Create Subject Category
            </button>
          </div>

          {isAddingSubject && (
            <form
              onSubmit={handleAddSubjectSubmit}
              className="max-w-sm mx-auto pt-4 flex items-center gap-2"
            >
              <input
                type="text"
                value={newSubjectName}
                onChange={(e) => setNewSubjectName(e.target.value)}
                placeholder="Enter any subject name (e.g. Organic Chemistry)..."
                className="flex-1 min-w-0 px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-sky-600"
                autoFocus
              />
              <button
                type="submit"
                className="px-3 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg cursor-pointer"
              >
                Create
              </button>
              <button
                type="button"
                onClick={() => setIsAddingSubject(false)}
                className="px-2.5 py-2 text-xs text-slate-600 cursor-pointer"
              >
                Cancel
              </button>
            </form>
          )}
        </section>
      ) : (
        <>
          {/* User-Defined Subject Categories Section */}
          <section className="space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h2 className="text-base sm:text-lg font-bold text-slate-900">
                  Your Subject Categories ({allSubjects.length})
                </h2>
                <p className="text-xs text-slate-500">
                  Create, rename, or select any subject category to organize your study units
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {selectedSubjectFilter !== 'ALL' && (
                  <button
                    type="button"
                    onClick={() => onSelectSubjectFilter('ALL')}
                    className="px-3 py-1.5 text-xs font-semibold text-sky-700 bg-sky-50 hover:bg-sky-100 rounded-lg cursor-pointer"
                  >
                    Show All Subjects ({units.length})
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setIsAddingSubject((v) => !v)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  New Subject Category
                </button>
              </div>
            </div>

            {isAddingSubject && (
              <form
                onSubmit={handleAddSubjectSubmit}
                className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row items-stretch sm:items-center gap-2"
              >
                <input
                  type="text"
                  value={newSubjectName}
                  onChange={(e) => setNewSubjectName(e.target.value)}
                  placeholder="Enter any subject name (e.g., Physics, World History, Cardiology, Tamil)..."
                  className="flex-1 min-w-0 px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-sky-600"
                  autoFocus
                />
                <div className="flex items-center gap-2">
                  <button
                    type="submit"
                    className="px-4 py-2 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-lg cursor-pointer"
                  >
                    Save Subject
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsAddingSubject(false)}
                    className="px-3 py-2 text-xs text-slate-600 hover:text-slate-900 cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {allSubjects.map((subject) => {
                const subjectUnits = units.filter((u) => u.subject === subject);
                const isSelected = selectedSubjectFilter === subject;
                const reviewCount = subjectUnits.reduce(
                  (acc, u) =>
                    acc +
                    u.sections.reduce(
                      (sAcc, s) =>
                        sAcc +
                        s.items.filter((i) => i.verificationStatus === 'NEEDS_REVIEW').length,
                      0
                    ),
                  0
                );

                return (
                  <div
                    key={subject}
                    className={`p-4 rounded-xl border transition-all flex flex-col justify-between gap-3 ${
                      isSelected
                        ? 'bg-sky-50/70 border-sky-600'
                        : 'bg-white border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    {editingSubjectName === subject ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={editingSubjectValue}
                          onChange={(e) => setEditingSubjectValue(e.target.value)}
                          className="flex-1 min-w-0 px-2 py-1 text-xs font-bold bg-white border border-slate-300 rounded"
                          autoFocus
                        />
                        <button
                          type="button"
                          onClick={() => handleRenameSubjectSubmit(subject)}
                          className="p-1 text-emerald-700 hover:bg-emerald-50 rounded cursor-pointer"
                          title="Save subject name"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingSubjectName(null)}
                          className="p-1 text-slate-500 hover:bg-slate-100 rounded cursor-pointer"
                          title="Cancel"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-start justify-between gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            onSelectSubjectFilter(isSelected ? 'ALL' : subject)
                          }
                          className="text-left min-w-0 flex-1 cursor-pointer"
                        >
                          <h3 className="text-sm font-bold text-slate-900 truncate">
                            {subject}
                          </h3>
                          <p className="text-xs text-slate-500 mt-0.5">
                            {subjectUnits.length} unit(s) ·{' '}
                            {subjectUnits.reduce(
                              (a, u) => a + (u.sourcePages?.length || 0),
                              0
                            )}{' '}
                            page(s)
                          </p>
                        </button>

                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingSubjectName(subject);
                              setEditingSubjectValue(subject);
                            }}
                            title="Rename subject"
                            className="p-1 text-slate-400 hover:text-slate-700 rounded cursor-pointer"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          {subjectUnits.length === 0 && (
                            <button
                              type="button"
                              onClick={() => onDeleteSubjectCategory(subject)}
                              title="Remove empty subject"
                              className="p-1 text-slate-400 hover:text-red-600 rounded cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2 text-xs">
                      {reviewCount > 0 ? (
                        <span className="text-amber-700 font-medium inline-flex items-center gap-1">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                          {reviewCount} to review
                        </span>
                      ) : (
                        <span className="text-slate-500">
                          {subjectUnits.length === 0 ? 'No units yet' : 'All verified'}
                        </span>
                      )}

                      <button
                        type="button"
                        onClick={() =>
                          onStartUpload(subject, subjectUnits.length + 1, '')
                        }
                        className="text-xs font-semibold text-sky-700 hover:text-sky-800 cursor-pointer"
                      >
                        + Add Unit
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Saved Study Units List */}
          <section className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-base sm:text-lg font-bold text-slate-900">
                  Saved Study Materials ({filteredUnits.length})
                </h2>
                <p className="text-xs text-slate-500">
                  Edit content, resolve review flags, practice MCQs, or download individual unit PDFs
                </p>
              </div>

              {units.length > 0 && (
                <div className="relative w-full sm:w-64">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search units or keywords..."
                    className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-sky-600"
                  />
                </div>
              )}
            </div>

            {filteredUnits.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-xl p-8 text-center space-y-3">
                <BookOpen className="w-7 h-7 text-slate-400 mx-auto" />
                <h3 className="text-sm sm:text-base font-bold text-slate-900">
                  {units.length === 0
                    ? 'Your Study Library is Empty'
                    : 'No study units match your current filter'}
                </h3>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  {units.length === 0
                    ? 'Upload your handwritten classroom notes to generate detailed study materials.'
                    : 'Upload handwritten notes for this subject or clear your search filter.'}
                </p>
                <button
                  type="button"
                  onClick={() =>
                    onStartUpload(
                      selectedSubjectFilter !== 'ALL' ? selectedSubjectFilter : '',
                      1,
                      ''
                    )
                  }
                  className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-lg transition-colors cursor-pointer"
                >
                  <Upload className="w-4 h-4" />
                  {units.length === 0 ? 'Upload Your First Notes' : 'Upload Handwritten Notes'}
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {filteredUnits.map((unit) => {
                  const isCurrent = unit.id === activeUnitId;
                  const items = unit.sections.flatMap((s) => s.items);
                  const verifiedItems = items.filter(
                    (i) => i.verificationStatus === 'VERIFIED'
                  ).length;
                  const needsReviewItems = items.filter(
                    (i) => i.verificationStatus === 'NEEDS_REVIEW'
                  ).length;

                  return (
                    <div
                      key={unit.id}
                      className={`bg-white rounded-xl border p-4 sm:p-5 flex flex-col justify-between gap-4 transition-colors ${
                        isCurrent
                          ? 'border-sky-600'
                          : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <div className="space-y-2 min-w-0">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                          <div className="flex flex-wrap items-center gap-1.5 font-medium text-slate-600 min-w-0">
                            <span className="text-sky-700 font-semibold truncate max-w-[160px]">
                              {unit.subject}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums">
                              Unit {unit.unitNumber}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums">
                              {unit.sourcePages.length} page(s)
                            </span>
                          </div>

                          <div className="flex items-center gap-2">
                            {needsReviewItems > 0 ? (
                              <span className="inline-flex items-center gap-1 text-amber-700 font-semibold">
                                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                                {needsReviewItems} NEEDS_REVIEW
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                                {verifiedItems} VERIFIED
                              </span>
                            )}
                          </div>
                        </div>

                        {editingUnitId === unit.id ? (
                          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                              <input
                                type="text"
                                value={editUnitSubject}
                                onChange={(e) => setEditUnitSubject(e.target.value)}
                                placeholder="Subject name"
                                className="px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded"
                              />
                              <input
                                type="number"
                                min={1}
                                value={editUnitNumber}
                                onChange={(e) => setEditUnitNumber(Number(e.target.value))}
                                placeholder="Unit #"
                                className="px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-200 rounded"
                              />
                              <input
                                type="text"
                                value={editUnitTitle}
                                onChange={(e) => setEditUnitTitle(e.target.value)}
                                placeholder="Unit / Chapter Title"
                                className="px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded"
                              />
                            </div>
                            <div className="flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => setEditingUnitId(null)}
                                className="px-2.5 py-1 text-xs text-slate-600 cursor-pointer"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                onClick={() => saveEditingUnit(unit)}
                                className="px-3 py-1 text-xs font-semibold text-white bg-slate-900 rounded cursor-pointer"
                              >
                                Save Changes
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-start justify-between gap-2">
                            <h3 className="text-sm sm:text-base font-bold text-slate-900 break-words min-w-0">
                              Unit {unit.unitNumber}: {unit.unitTitle}
                            </h3>
                            <button
                              type="button"
                              onClick={() => startEditingUnit(unit)}
                              title="Rename unit or change subject"
                              className="p-1 text-slate-400 hover:text-slate-700 rounded shrink-0 cursor-pointer"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}

                        <p className="text-xs text-slate-600 line-clamp-2 break-words">
                          Keywords:{' '}
                          {items
                            .map((i) => i.originalKeyword)
                            .slice(0, 6)
                            .join(' · ') || 'No keywords extracted'}
                        </p>
                      </div>

                      <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => onOpenUnitInModule(unit.id, 'editor')}
                            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                          >
                            <FileText className="w-3.5 h-3.5 shrink-0" />
                            <span>Review & Edit ({items.length})</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => onOpenUnitInModule(unit.id, 'pdf_mcq')}
                            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-sky-700 bg-sky-50 hover:bg-sky-100 rounded-lg transition-colors cursor-pointer"
                          >
                            <HelpCircle className="w-3.5 h-3.5 shrink-0" />
                            <span>PDF & MCQs ({unit.mcqs.length})</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => onDownloadUnitPdf(unit)}
                            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
                          >
                            <Download className="w-3.5 h-3.5 shrink-0" />
                            <span>PDF</span>
                          </button>
                        </div>

                        {confirmDeleteId === unit.id ? (
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                onDeleteUnit(unit.id);
                                setConfirmDeleteId(null);
                              }}
                              className="px-2.5 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-md cursor-pointer"
                            >
                              Delete
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="px-2 py-1.5 text-xs text-slate-600 hover:text-slate-900 cursor-pointer"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(unit.id)}
                            title="Delete unit material"
                            className="p-2 text-slate-400 hover:text-red-600 rounded-md transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
};
