# AI Notes Generator — Source-Verified Classroom Study Studio (Final Refined Plan)

A personal-use, AI-powered academic web application that converts multi-page handwritten classroom notes and PDFs into structured, English-language study materials and practice MCQs—featuring responsive mobile/desktop workflows, `IndexedDB` document persistence with full `.json` backup/restore, strict source-entailment verification, and standalone unit PDF file downloads.

## User Review & Final Refinements Incorporated

> [!IMPORTANT]
> All four final refinements have been integrated into the architecture while preserving the 5-module workflow, responsive layouts, and academic light theme:

1. **Strengthened AI Grounding (Semantic Entailment + Source Context Validation)**:
   - OCR substring matching alone only checks that a quote exists on the page—it **never** automatically marks `generatedExplanation` as `VERIFIED`.
   - Our server pipeline enforces a **Two-Stage Extraction + Entailment Audit**:
     - **Stage A (Extractive OCR & Candidate Restructuring)**: Transcribes the handwritten pages verbatim and links each `originalKeyword` to its `supportingSourcePassage` and `sourcePageReference`.
     - **Stage B (Strict Source-Context Entailment Audit)**: Validates `generatedExplanation` against the actual `supportingSourcePassage` and page transcript. Any explanation that introduces unstated facts, external textbook definitions, or unverified formula steps—or whose source passage fails deterministic transcript checks—is strictly flagged as `NEEDS_REVIEW` with a specific `uncertaintyReason`.
2. **Strict Source-Only Rule for Insufficient Notes**:
   - When handwritten notes list a keyword, bullet, or formula fragment without enough written context to explain it, the system **never** fills the gap with external knowledge. Instead, it preserves the keyword and verbatim source text, notes that the uploaded scan lacks sufficient detail for expansion, and flags the item as `NEEDS_REVIEW` so the student can supply or approve the explanation manually.
3. **MCQ Traceability & Insufficiency Safeguard**:
   - Every MCQ (`question`, `correctIndex` answer, and `explanation`) must include a verbatim `supportingSourcePassage` and `sourcePageReference` from the uploaded notes.
   - If the uploaded notes lack sufficient factual detail to form valid questions without guessing or pulling outside knowledge, the system generates only the exact number of questions strictly supported by the source (or zero if the notes are purely fragmentary), displaying a transparent notice rather than fabricating unsupported questions.
4. **Full Data Backup & Restore (`.json` Archive)**:
   - Includes an **"Export Backup (.json)"** and **"Restore Backup (.json)"** control in the Dashboard so users can export their entire `IndexedDB` library (or individual units)—including source scans, manual edits, verification statuses, diagram crops, and MCQs—and restore them at any time to prevent data loss.

---

## 1. Overview & Core Concept

- **What It Does**: Converts handwritten classroom notes (multiple images or multi-page PDFs) into structured, unit-organized study materials and concept-clarity MCQs across **Physics (10 Units)**, **Tamil**, **Psychology**, and **General Knowledge**.
- **Language Consistency**: Produces clean, consistent **English output** across all headings, expanded explanations, derivations, and MCQs (preserving original Tamil script terms alongside English explanations where present in Tamil notes).
- **Personal-Use Scope**: Focused strictly on the single-user study workflow (`Upload → AI Processing → Review → PDF Export`) with local `IndexedDB` persistence and portable `.json` backup/restore.

---

## 2. User Experience & Visual Design

### Key User Flows (The 5 Core Modules)

1. **01. Dashboard (with Data Backup & Restore)**:
   - Displays the 4 supported subjects (**Physics — Units 1 to 10**, **Tamil**, **Psychology**, **General Knowledge**), saved unit materials stored in `IndexedDB`, verification status counts (`VERIFIED` vs. `NEEDS_REVIEW`), and quick actions to open any unit in the Editor or export its PDF.
   - **Data Backup Toolbar**: Provides one-click **Export Library Backup (`.json`)** and **Restore from Backup (`.json`)** buttons to safeguard all saved study materials, edits, and MCQs.
2. **02. Notes Upload**:
   - Accepts **multiple images** (`.jpg`, `.png`, `.webp`) and **multi-page PDFs** (client-side PDF page rendering so every PDF page becomes an inspectable page image).
   - Provides page reordering, rotation, removal, subject selection, unit selection (Physics Units 1–10 or subject units), and one-click sample handwritten classroom notes for instant testing.
3. **03. AI Processing**:
   - Server-side multimodal processing via Express (`/api/notes/process`) showing real-time stage progress:
     1. *Page OCR & Illegibility Detection*
     2. *Keyword, Formula & Diagram Bounding-Box Extraction*
     3. *Strict Source-Only Expansion (No External Knowledge)*
     4. *Source-Context Entailment & Sufficiency Audit (`VERIFIED` / `NEEDS_REVIEW`)*
     5. *Traceable Source-Only MCQ Synthesis*
4. **04. Study Material Editor**:
   - **Desktop (`>= 1024px`)**: Side-by-side split view (Left: multi-page zoomable source scan with diagram bounding boxes; Right: structured study material editor).
   - **Mobile (`< 1024px`)**: Switchable top tabs (`Original Notes (Page X/N)` | `Generated Editor`) with a badge showing pending `NEEDS_REVIEW` items.
   - **Editing & Review Controls**: Inline editing for headings, original keywords, expanded explanations, step-by-step formulas/derivations, cropped source diagrams with label tables, and manual resolution of `NEEDS_REVIEW` flags. All edits persist automatically to `IndexedDB`.
5. **05. PDF & MCQ Generator**:
   - **PDF Preview & Separate Unit Download**:
     - Displays a paginated A4 preview with title block, Table of Contents, highlighted original keywords, step-by-step derivations, embedded diagram crops, and page numbers.
     - Automatically scales the A4 sheet on mobile screens using a `ResizeObserver` scale wrapper (`transform: scale(...)` with matched layout height).
     - **"Download Unit PDF" Button**: Builds and downloads a standalone `Subject_Unit_X.pdf` binary file directly to the device (compatible with Android and desktop browsers).
   - **Traceable MCQ Practice**:
     - Interactive multiple-choice practice where every question, correct answer, and explanation displays its exact `supportingSourcePassage` and `sourcePageReference` from the uploaded notes. If notes have insufficient context for additional questions, clearly notifies the user instead of inventing external questions.

### Visual Identity & Theme

- **Aesthetic Direction**: Crisp Academic Light Theme (`#F8FAFC` workspace canvas, `#FFFFFF` cards and A4 sheets, `#0F172A` primary ink, `#0284C7` academic azure accent, `#059669` verified emerald, `#D97706` review amber).
- **Typography (2+1 Font Rule)**:
  - **Display & Headings**: `Plus Jakarta Sans` (600/700).
  - **Body & Study Explanations**: `DM Sans` (400/500).
  - **Formulas, Derivations & Page Metrics**: `IBM Plex Mono` (`tabular-nums`).

---

## 3. Key Technical Decisions & Grounding Architecture

- **Decision 1 — Source-Context Entailment & Insufficiency Gate**:
  - *Why*: OCR text matching only proves a keyword appeared on the page; it does not prove the generated explanation is supported by the notes.
  - *Implementation*:
    1. Every item requires `originalKeyword`, `supportingSourcePassage`, `generatedExplanation`, `sourcePageReference`, `sourceSufficiency` (`'SUFFICIENT' | 'INSUFFICIENT'`), `entailmentVerified` (`boolean`), and `verificationStatus` (`'VERIFIED' | 'NEEDS_REVIEW'`).
    2. If the handwritten notes only mention a keyword or incomplete formula without supporting explanation (`sourceSufficiency === 'INSUFFICIENT'`), the system refrains from adding external facts and marks `verificationStatus = "NEEDS_REVIEW"`.
    3. Both the AI entailment check and the server-side verifier audit that `supportingSourcePassage` is grounded in the page transcript, contains sufficient explanatory clauses (not just a bare 1–2 word title), has no `[unclear]` markers, and introduces no unsupported claims before allowing `VERIFIED`.
- **Decision 2 — Traceable Source-Only MCQs**:
  - *Implementation*: Each MCQ object requires `question`, `options`, `correctIndex`, `explanation`, `supportingSourcePassage`, and `sourcePageReference`. Server-side validation discards or flags any MCQ that lacks a verified `supportingSourcePassage` from the notes, and permits zero or fewer MCQs when the uploaded notes lack sufficient testable statements.
- **Decision 3 — IndexedDB Storage + Portable JSON Backup/Restore**:
  - *Implementation*: All units, multi-page scans, edited explanations, and MCQs are persisted in `IndexedDB` (`ai_notes_studio_db`) and can be exported to a single timestamped `.json` backup file or restored via file upload with schema validation and merge/replace support.
- **Decision 4 — Validated Server-Side Gemini Model & Binary PDF Export**:
  - *Implementation*: Server-only `@google/genai` integration in `server.ts` using `process.env.GEMINI_API_KEY` and validated model ID (`gemini-3.8-flash`), paired with client-side binary `.pdf` generation via `jspdf` for reliable downloads on Android and desktop.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

### Architecture & Component Diagram

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│                 Responsive Application Shell (Desktop & Mobile)              │
│  [AI Notes Studio]   [01. Dashboard ··· 05. PDF & MCQs]   [+ Upload Notes]   │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │
         ┌─────────────────────────────┼─────────────────────────────┐
         ▼                             ▼                             ▼
┌─────────────────┐         ┌─────────────────────┐         ┌──────────────────┐
│  01. Dashboard  │         │  02. Notes Upload   │         │ 03. AI Pipeline  │
│  • Physics 1-10 │         │  • Multi-Image &    │         │ • OCR Transcript │
│  • Tamil, Psych,│────────▶│    Multi-Page PDF   │────────▶│ • Source-Only    │
│    General Know.│         │  • Page Rasterizer  │         │   Expansion      │
│  • JSON Backup  │         │  • Subject & Unit   │         │ • Entailment &   │
│    & Restore    │         │    Assignment       │         │   Context Audit  │
└────────┬────────┘         └─────────────────────┘         └────────┬─────────┘
         │                                                           │
         └─────────────────────────────┬─────────────────────────────┘
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                         04. Study Material Editor                            │
│  • Desktop: Side-by-Side Split View (45% Source Scan | 55% Study Editor)     │
│  • Mobile : Switchable Tabs ([Original Notes] <---> [Generated Editor])      │
│  ┌───────────────────────────────────┬────────────────────────────────────┐  │
│  │ Source Scan & Diagram Cropper     │ Structured English Study Editor    │  │
│  │ • Multi-page viewer & zoom        │ • Headings & Highlighted Keywords  │  │
│  │ • Bounding-box diagram crop       │ • Verbatim Source Passage Citation │  │
│  │ • Page jump from any concept      │ • Step-by-Step Derivations         │  │
│  │                                   │ • NEEDS_REVIEW Filter & Approval   │  │
│  └───────────────────────────────────┴────────────────────────────────────┘  │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                     05. PDF & MCQ Generator Studio                           │
│  ┌───────────────────────────────────┬────────────────────────────────────┐  │
│  │ Tab A: Responsive A4 PDF & Export │ Tab B: Traceable Source-Only MCQs  │  │
│  │ • ResizeObserver Mobile Scaling   │ • Grounded Question + Answer + Why │  │
│  │ • TOC, Keywords, Formulas, Crops  │ • Verbatim Source Quote & Page Ref │  │
│  │ • Binary .pdf Download (jspdf)    │ • Insufficiency Guard (No Guessing)│  │
│  └───────────────────────────────────┴────────────────────────────────────┘  │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │
                    ┌──────────────────┴──────────────────┐
                    ▼                                     ▼
┌───────────────────────────────────────┐ ┌────────────────────────────────────┐
│ Browser IndexedDB + JSON Backup       │ │ Express Backend (`server.ts`)      │
│ • Persists scans, edits, crops & MCQs │ │ • Keeps GEMINI_API_KEY server-only │
│ • Export / Restore `.json` archives   │ │ • Entailment & Sufficiency Audit   │
└───────────────────────────────────────┘ └────────────────────────────────────┘
```
