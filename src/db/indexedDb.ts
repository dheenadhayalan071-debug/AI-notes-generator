import { StudyUnitDocument, BackupRestoreMode } from '../types';

const DB_NAME = 'ai_notes_studio_db';
const DB_VERSION = 2;
const UNITS_STORE = 'study_units';
const SUBJECTS_STORE = 'custom_subjects';

const LEGACY_SAMPLE_IDS = new Set([
  'sample-physics-unit-1',
  'sample-psych-unit-1',
  'sample-tamil-unit-1',
  'sample-gk-unit-1',
]);

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(UNITS_STORE)) {
        const store = db.createObjectStore(UNITS_STORE, { keyPath: 'id' });
        store.createIndex('subject', 'subject', { unique: false });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(SUBJECTS_STORE)) {
        db.createObjectStore(SUBJECTS_STORE, { keyPath: 'name' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Removes any legacy demo sample records while keeping all user-created units intact.
 */
export async function purgeLegacySampleUnits(): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(UNITS_STORE, 'readwrite');
    const store = tx.objectStore(UNITS_STORE);
    for (const sampleId of LEGACY_SAMPLE_IDS) {
      store.delete(sampleId);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAllStudyUnits(): Promise<StudyUnitDocument[]> {
  await purgeLegacySampleUnits();
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(UNITS_STORE, 'readonly');
    const store = tx.objectStore(UNITS_STORE);
    const request = store.getAll();

    request.onsuccess = () => {
      const results = ((request.result as StudyUnitDocument[]) || []).filter(
        (u) => !LEGACY_SAMPLE_IDS.has(u.id)
      );
      results.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      resolve(results);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function getAllSavedSubjects(): Promise<string[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SUBJECTS_STORE, 'readonly');
    const store = tx.objectStore(SUBJECTS_STORE);
    const request = store.getAll();

    request.onsuccess = () => {
      const rows = (request.result as Array<{ name: string }>) || [];
      resolve(rows.map((r) => r.name).filter(Boolean).sort((a, b) => a.localeCompare(b)));
    };
    request.onerror = () => reject(request.error);
  });
}

export async function saveSubjectCategory(subjectName: string): Promise<void> {
  const clean = subjectName.trim();
  if (!clean) return;
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SUBJECTS_STORE, 'readwrite');
    const store = tx.objectStore(SUBJECTS_STORE);
    store.put({ name: clean, updatedAt: new Date().toISOString() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteSubjectCategory(subjectName: string): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SUBJECTS_STORE, 'readwrite');
    const store = tx.objectStore(SUBJECTS_STORE);
    store.delete(subjectName);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function renameSubjectAcrossUnits(oldName: string, newName: string): Promise<void> {
  const cleanNew = newName.trim();
  if (!cleanNew || oldName === cleanNew) return;
  const allUnits = await getAllStudyUnits();
  for (const unit of allUnits) {
    if (unit.subject === oldName) {
      await saveStudyUnit({ ...unit, subject: cleanNew });
    }
  }
  await deleteSubjectCategory(oldName);
  await saveSubjectCategory(cleanNew);
}

export async function saveStudyUnit(unit: StudyUnitDocument): Promise<StudyUnitDocument> {
  const db = await openDatabase();
  const cleanSubject = unit.subject.trim() || 'Uncategorized Subject';
  await saveSubjectCategory(cleanSubject);

  const updatedUnit: StudyUnitDocument = {
    ...unit,
    subject: cleanSubject,
    updatedAt: new Date().toISOString(),
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(UNITS_STORE, 'readwrite');
    const store = tx.objectStore(UNITS_STORE);
    const request = store.put(updatedUnit);

    request.onsuccess = () => resolve(updatedUnit);
    request.onerror = () => reject(request.error);
  });
}

export async function deleteStudyUnit(id: string): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(UNITS_STORE, 'readwrite');
    const store = tx.objectStore(UNITS_STORE);
    const request = store.delete(id);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function clearAllStudyUnits(): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([UNITS_STORE, SUBJECTS_STORE], 'readwrite');
    tx.objectStore(UNITS_STORE).clear();
    tx.objectStore(SUBJECTS_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export interface LibraryBackupPayload {
  schemaVersion: number;
  exportedAt: string;
  application: string;
  subjects: string[];
  units: StudyUnitDocument[];
}

export async function exportLibraryBackupJson(): Promise<string> {
  const units = await getAllStudyUnits();
  const subjects = await getAllSavedSubjects();
  const payload: LibraryBackupPayload = {
    schemaVersion: 2,
    exportedAt: new Date().toISOString(),
    application: 'AI Notes Generator — Classroom Study Studio',
    subjects,
    units,
  };
  return JSON.stringify(payload, null, 2);
}

export interface ValidatedBackupPreview {
  exportedAt: string;
  unitCount: number;
  subjectList: string[];
  totalConcepts: number;
  totalMcqs: number;
  sanitizedUnits: StudyUnitDocument[];
  sanitizedSubjects: string[];
}

/**
 * Validates a backup JSON string BEFORE modifying IndexedDB so the user can review
 * the backup contents and explicitly choose Merge vs. Replace.
 */
export function validateBackupJsonString(jsonString: string): ValidatedBackupPreview {
  let parsed: any;
  try {
    parsed = JSON.parse(jsonString);
  } catch {
    throw new Error('Invalid JSON file. Please select a valid AI Notes Studio backup (.json) file.');
  }

  const candidateUnits: any[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.units)
    ? parsed.units
    : [];

  const candidateSubjects: string[] = Array.isArray(parsed?.subjects)
    ? parsed.subjects.map((s: any) => String(s || '').trim()).filter(Boolean)
    : [];

  const sanitizedUnits: StudyUnitDocument[] = [];

  for (const raw of candidateUnits) {
    if (!raw || typeof raw !== 'object' || !raw.id || !raw.unitTitle) continue;
    const subject = String(raw.subject || 'General Study').trim();
    sanitizedUnits.push({
      id: String(raw.id),
      subject,
      unitNumber: Number(raw.unitNumber) || 1,
      unitTitle: String(raw.unitTitle).trim(),
      createdAt: String(raw.createdAt || new Date().toISOString()),
      updatedAt: String(raw.updatedAt || new Date().toISOString()),
      sourcePages: Array.isArray(raw.sourcePages) ? raw.sourcePages : [],
      sections: Array.isArray(raw.sections) ? raw.sections : [],
      mcqs: Array.isArray(raw.mcqs) ? raw.mcqs : [],
      mcqGenerationNote: raw.mcqGenerationNote ? String(raw.mcqGenerationNote) : undefined,
    });
  }

  if (sanitizedUnits.length === 0 && candidateSubjects.length === 0) {
    throw new Error('Backup file does not contain any valid study units or subjects.');
  }

  const allSubjects = Array.from(
    new Set([...candidateSubjects, ...sanitizedUnits.map((u) => u.subject)])
  );
  const totalConcepts = sanitizedUnits.reduce(
    (acc, u) => acc + u.sections.reduce((sAcc, s) => sAcc + (s.items?.length || 0), 0),
    0
  );
  const totalMcqs = sanitizedUnits.reduce((acc, u) => acc + (u.mcqs?.length || 0), 0);

  return {
    exportedAt: String(parsed?.exportedAt || new Date().toISOString()),
    unitCount: sanitizedUnits.length,
    subjectList: allSubjects,
    totalConcepts,
    totalMcqs,
    sanitizedUnits,
    sanitizedSubjects: allSubjects,
  };
}

/**
 * Applies a validated backup using the user's chosen mode ('merge' or 'replace').
 */
export async function applyValidatedBackup(
  preview: ValidatedBackupPreview,
  mode: BackupRestoreMode
): Promise<{
  restoredCount: number;
  units: StudyUnitDocument[];
  subjects: string[];
}> {
  if (mode === 'replace') {
    await clearAllStudyUnits();
  }

  for (const subj of preview.sanitizedSubjects) {
    await saveSubjectCategory(subj);
  }

  for (const unit of preview.sanitizedUnits) {
    await saveStudyUnit(unit);
  }

  const units = await getAllStudyUnits();
  const subjects = await getAllSavedSubjects();

  return {
    restoredCount: preview.sanitizedUnits.length,
    units,
    subjects,
  };
}
