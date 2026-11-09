import React, { useRef, useState } from 'react';
import {
  Upload,
  FileImage,
  RotateCw,
  Trash2,
  ArrowUp,
  ArrowDown,
  Play,
  AlertCircle,
} from 'lucide-react';
import { SourcePage } from '../types';
import {
  processUploadedFilesToSourcePages,
  rotateImageDataUrl,
} from '../utils/pdfRasterizer';

interface NotesUploadModuleProps {
  existingSubjects: string[];
  selectedSubject: string;
  selectedUnitNumber: number;
  selectedUnitTitle: string;
  uploadedPages: SourcePage[];
  onChangeSubject: (subject: string) => void;
  onChangeUnitNumber: (unitNumber: number) => void;
  onChangeUnitTitle: (unitTitle: string) => void;
  onChangePages: (pages: SourcePage[]) => void;
  onStartProcessing: () => void;
}

export const NotesUploadModule: React.FC<NotesUploadModuleProps> = ({
  existingSubjects,
  selectedSubject,
  selectedUnitNumber,
  selectedUnitTitle,
  uploadedPages,
  onChangeSubject,
  onChangeUnitNumber,
  onChangeUnitTitle,
  onChangePages,
  onStartProcessing,
}) => {
  const [isRasterizing, setIsRasterizing] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFileSelection = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setIsRasterizing(true);
    setUploadError(null);
    try {
      const fileArray = Array.from(files);
      const newPages = await processUploadedFilesToSourcePages(
        fileArray,
        uploadedPages.length + 1
      );
      const combined = [...uploadedPages, ...newPages].map((p, idx) => ({
        ...p,
        pageNumber: idx + 1,
      }));
      onChangePages(combined);

      // Auto-populate unit title from first file name if user hasn't typed one yet
      if (!selectedUnitTitle.trim() && fileArray[0]?.name) {
        const cleanFileTitle = fileArray[0].name
          .replace(/\.[^/.]+$/, '')
          .replace(/[_-]+/g, ' ')
          .trim();
        if (cleanFileTitle) {
          onChangeUnitTitle(cleanFileTitle);
        }
      }
    } catch (err: any) {
      setUploadError(err?.message || 'Failed to read uploaded image or PDF files.');
    } finally {
      setIsRasterizing(false);
    }
  };

  const handleRotatePage = async (index: number) => {
    const target = uploadedPages[index];
    if (!target || target.mimeType === 'application/pdf') return;
    const rotatedUrl = await rotateImageDataUrl(target.dataUrl);
    const next = [...uploadedPages];
    next[index] = {
      ...target,
      dataUrl: rotatedUrl,
      rotation: ((target.rotation || 0) + 90) % 360,
    };
    onChangePages(next);
  };

  const handleMovePage = (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= uploadedPages.length) return;
    const next = [...uploadedPages];
    const [moved] = next.splice(index, 1);
    next.splice(targetIndex, 0, moved);
    onChangePages(
      next.map((p, idx) => ({
        ...p,
        pageNumber: idx + 1,
      }))
    );
  };

  const handleRemovePage = (index: number) => {
    const next = uploadedPages
      .filter((_, idx) => idx !== index)
      .map((p, idx) => ({
        ...p,
        pageNumber: idx + 1,
      }));
    onChangePages(next);
  };

  const handleProceedClick = () => {
    if (!selectedSubject.trim()) {
      setUploadError('Please enter a Subject Name before processing.');
      return;
    }
    if (!selectedUnitTitle.trim()) {
      setUploadError('Please enter a Unit or Chapter Title before processing.');
      return;
    }
    if (uploadedPages.length === 0) {
      setUploadError('Please upload at least one handwritten image or PDF file.');
      return;
    }
    setUploadError(null);
    onStartProcessing();
  };

  return (
    <div className="space-y-5 w-full max-w-full overflow-x-hidden">
      {/* Header & Completely Flexible Subject / Unit Inputs */}
      <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6 space-y-5">
        <div className="space-y-1">
          <p className="text-xs font-medium text-sky-700">
            02. Notes Upload · Flexible Subject & Multi-Page Ingestion
          </p>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
            Upload Handwritten Classroom Notes
          </h1>
          <p className="text-xs sm:text-sm text-slate-600">
            Enter any subject and unit or chapter title, then upload multiple handwritten images
            (JPG, PNG, WEBP) or multi-page PDF documents.
          </p>
        </div>

        {/* Free-Form Subject, Unit Number, and Unit/Chapter Title */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 pt-3 border-t border-slate-100">
          {/* Subject Name Input + Quick Chips for Existing Subjects */}
          <div className="md:col-span-5 space-y-1.5">
            <label
              htmlFor="subject-input"
              className="block text-xs font-semibold text-slate-700"
            >
              1. Subject Name (Any Subject)
            </label>
            <input
              id="subject-input"
              type="text"
              list="existing-subjects-datalist"
              value={selectedSubject}
              onChange={(e) => onChangeSubject(e.target.value)}
              placeholder="e.g., Physics, Organic Chemistry, Literature, History..."
              className="w-full px-3 py-2.5 text-xs sm:text-sm font-medium bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-sky-600"
            />
            <datalist id="existing-subjects-datalist">
              {existingSubjects.map((subj) => (
                <option key={subj} value={subj} />
              ))}
            </datalist>

            {existingSubjects.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <span className="text-[11px] text-slate-500">Your subjects:</span>
                {existingSubjects.map((subj) => (
                  <button
                    key={subj}
                    type="button"
                    onClick={() => onChangeSubject(subj)}
                    className={`px-2 py-0.5 text-[11px] font-semibold rounded border transition-colors cursor-pointer ${
                      selectedSubject === subj
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200'
                    }`}
                  >
                    {subj}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Unit / Chapter Number */}
          <div className="md:col-span-2 space-y-1.5">
            <label
              htmlFor="unit-number-input"
              className="block text-xs font-semibold text-slate-700"
            >
              2. Unit / Chapter #
            </label>
            <input
              id="unit-number-input"
              type="number"
              min={1}
              value={selectedUnitNumber}
              onChange={(e) =>
                onChangeUnitNumber(Math.max(1, Number(e.target.value) || 1))
              }
              className="w-full px-3 py-2.5 text-xs sm:text-sm font-mono font-semibold bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-sky-600"
            />
          </div>

          {/* Unit or Chapter Title */}
          <div className="md:col-span-5 space-y-1.5">
            <label
              htmlFor="unit-title-input"
              className="block text-xs font-semibold text-slate-700"
            >
              3. Unit or Chapter Title
            </label>
            <input
              id="unit-title-input"
              type="text"
              value={selectedUnitTitle}
              onChange={(e) => onChangeUnitTitle(e.target.value)}
              placeholder="e.g., Electrostatics, Thermodynamics, Chapter 1..."
              className="w-full px-3 py-2.5 text-xs sm:text-sm font-medium bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-sky-600"
            />
            <p className="text-[11px] text-slate-500">
              Each unit can be edited and exported as an individual A4 PDF.
            </p>
          </div>
        </div>
      </section>

      {/* Multi-File Dropzone */}
      <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6 space-y-5">
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            handleFileSelection(e.dataTransfer.files);
          }}
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              fileInputRef.current?.click();
            }
          }}
          className="border-2 border-dashed border-slate-300 hover:border-sky-600 bg-slate-50/70 hover:bg-sky-50/30 rounded-xl p-6 sm:p-8 text-center transition-colors cursor-pointer"
        >
          <Upload className="w-8 h-8 text-sky-600 mx-auto mb-2.5" />
          <p className="text-xs sm:text-sm font-bold text-slate-900">
            Drop handwritten note images or multi-page PDFs here, or tap to browse
          </p>
          <p className="text-xs text-slate-500 mt-1 max-w-lg mx-auto">
            Supports JPG, PNG, WEBP, and multi-page PDF documents. You can upload multiple pages
            at once and reorder or rotate them below.
          </p>
          <div className="mt-4">
            <span className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-slate-900 rounded-lg">
              <FileImage className="w-4 h-4" />
              Select Images or PDFs
            </span>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp,image/*,application/pdf,.pdf"
            onChange={(e) => {
              handleFileSelection(e.target.files);
              e.target.value = '';
            }}
            className="hidden"
          />
        </div>

        {isRasterizing && (
          <div className="p-3.5 bg-sky-50 border border-sky-200 rounded-lg text-xs font-medium text-sky-900">
            Extracting and preparing pages from your uploaded files...
          </div>
        )}

        {uploadError && (
          <div className="p-3.5 bg-red-50 border border-red-200 rounded-lg text-xs font-medium text-red-900 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{uploadError}</span>
          </div>
        )}

        {/* Uploaded Pages Queue */}
        {uploadedPages.length > 0 && (
          <div className="space-y-4 pt-2">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-sm font-bold text-slate-900 break-words">
                  Uploaded Pages ({uploadedPages.length} Page{uploadedPages.length > 1 ? 's' : ''})
                </h2>
                <p className="text-xs text-slate-500">
                  Reorder, rotate, or remove pages before starting AI OCR and source verification
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => onChangePages([])}
                  className="px-3 py-2.5 text-xs font-semibold text-slate-600 hover:text-red-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
                >
                  Clear All
                </button>
                <button
                  type="button"
                  onClick={handleProceedClick}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-lg transition-colors cursor-pointer"
                >
                  <Play className="w-4 h-4 shrink-0" />
                  <span>
                    Run AI Processing ({uploadedPages.length} Page
                    {uploadedPages.length > 1 ? 's' : ''})
                  </span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {uploadedPages.map((page, idx) => (
                <div
                  key={`${page.fileName}-${idx}`}
                  className="border border-slate-200 rounded-xl p-3 bg-slate-50/50 flex flex-col justify-between gap-3 min-w-0"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-mono font-bold text-slate-900 shrink-0">
                      Page {page.pageNumber}
                    </span>
                    <span className="text-xs text-slate-500 truncate min-w-0">
                      {page.fileName}
                    </span>
                  </div>

                  <div className="h-48 sm:h-52 bg-white border border-slate-200 rounded-lg overflow-hidden flex items-center justify-center">
                    {page.mimeType === 'application/pdf' ? (
                      <div className="p-4 text-center space-y-1">
                        <p className="text-xs font-bold text-slate-800">PDF Document</p>
                        <p className="text-xs text-slate-500 break-all">{page.fileName}</p>
                      </div>
                    ) : (
                      <img
                        src={page.dataUrl}
                        alt={`Uploaded classroom note page ${page.pageNumber}`}
                        referrerPolicy="no-referrer"
                        className="max-h-full max-w-full object-contain"
                      />
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-1">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => handleMovePage(idx, -1)}
                        title="Move page earlier"
                        className="p-2 text-slate-600 hover:text-slate-900 disabled:opacity-30 bg-white border border-slate-200 rounded-md cursor-pointer"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={idx === uploadedPages.length - 1}
                        onClick={() => handleMovePage(idx, 1)}
                        title="Move page later"
                        className="p-2 text-slate-600 hover:text-slate-900 disabled:opacity-30 bg-white border border-slate-200 rounded-md cursor-pointer"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                      {page.mimeType !== 'application/pdf' && (
                        <button
                          type="button"
                          onClick={() => handleRotatePage(idx)}
                          title="Rotate page 90°"
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-100 cursor-pointer"
                        >
                          <RotateCw className="w-3.5 h-3.5" />
                          <span>Rotate</span>
                        </button>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => handleRemovePage(idx)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 rounded-md cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Remove</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
};
