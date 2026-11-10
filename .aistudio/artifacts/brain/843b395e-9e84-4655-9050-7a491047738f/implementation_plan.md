# Master Engineering Audit & Production Repair Plan — AI Notes Studio

Resolving the critical Vercel production failure (`"Unexpected token 'T', 'The page c...' is not valid JSON"`), implementing dual Vercel Serverless Function + Express architecture, client-side canvas image optimization, robust Content-Type and HTTP status response parsing, and comprehensive test suite validation.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> **Root Cause Identified**:
> In Vercel production (`https://ai-notes-generator-alpha.vercel.app/`), POST `/api/notes/process` returns a `404 Not Found` with plain text: `The page could not be found\nNOT_FOUND\n...`.
> In `src/App.tsx`, the client directly calls `const data = await response.json()` without checking `response.ok` or verifying that `response.headers.get('content-type')` is JSON. When `response.json()` fails to parse the `"The page..."` 404 string, JavaScript throws:
> `"Unexpected token 'T', 'The page c...' is not valid JSON"`.
> 
> Furthermore, the repository currently contains only `server.ts` (a standalone Express server meant for local development or Node/Docker hosts), but lacked a Vercel-compatible serverless entry point (`/api/notes/process.ts` or `vercel.json` rewrites) for Vercel deployments.

- **Confirmed Decision 1 — Dual Deployment Architecture**:
  - Extract the core processing logic (`processNotesCore` and `regenerateMcqsCore`) into a shared, robust module (`src/server/notesProcessor.ts`).
  - Deploy standard Vercel serverless functions in `/api/notes/process.ts` and `/api/notes/regenerate-mcqs.ts` (configured with `maxDuration: 60` and compatible with Vercel's Node runtime) alongside a root `vercel.json` rewrite configuration.
  - Keep `server.ts` Express server mounted for AI Studio dev (`npm run dev`) and standalone production (`npm start`).
- **Confirmed Decision 2 — Automatic Canvas Downscaling (Max 1600px, JPEG 85%)**:
  - Add client-side canvas downscaling before dispatching to the API. High-resolution phone camera photos ($4000\times3000\text{px}$, 10MB+) will be scaled to $\le 1600\text{px}$ maximum dimension at 85% JPEG quality. This reduces payload size from 25–40MB down to $< 1.5\text{MB}$ while preserving fine handwriting lines, eliminating Vercel payload limit errors (4.5MB limit on Vercel hobby/pro) and drastically accelerating OCR processing.
- **Confirmed Decision 3 — Defensive HTTP & Content-Type Error Handling**:
  - Never blind-call `.json()`. First inspect `response.ok` and `content-type`. If non-JSON text is returned (such as a 404 or 504 gateway timeout), capture the text cleanly and display a clear, actionable error: *"Backend service unavailable (HTTP 404 Not Found). The API route could not be reached."* or report specific Gemini API issues without exposing keys.

---

## 1. Overview & Core Concept

- **What It Does**: Personal-use academic studio converting multi-page handwritten notes and PDFs into source-entailed study guides and traceable MCQs across arbitrary subjects and units.
- **Strict Anti-Hallucination & Provenance**: Preserves every extracted keyword verbatim, derives formulas step-by-step, crops actual diagrams directly from the source pages, flags unclear handwriting as `NEEDS_REVIEW`, and allows zero MCQs if notes lack sufficient context.
- **Production Dual Target**: Operates seamlessly in AI Studio development (via `server.ts` Express backend on port 3000) and Vercel production serverless (via `/api/notes/*` functions).

---

## 2. User Experience & Visual Design

- **Mobile First Responsive UX (360px–430px)**:
  - Header, toolbar, cards, and modal dialogs designed with single-line controls, text truncation escape hatches, and `max-w-full overflow-x-hidden` containers to eliminate horizontal page scrolling.
  - Module 04 (Study Material Editor) provides switchable tabs (**Original Notes** with zoom & page navigation vs. **Study Editor**) on mobile screens ($< 1024\text{px}$) and a synchronized side-by-side split view on desktop ($\ge 1024\text{px}$).
- **PDF Preview & Export**:
  - Full-screen preview toggle, page switcher (`Page X of Y`), and zoom controls (`Fit`, `Zoom In`, `Zoom Out`) with responsive `ResizeObserver` scaling on mobile.
  - Native binary `.pdf` export (`jspdf`) creating genuine standalone PDF files with Table of Contents, keyword highlights, derivation steps, embedded diagram crops, and footer numbering.

---

## 3. Technical Architecture & Component Flow

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│                   Frontend Client (React 19 + Tailwind CSS)                  │
│  • Multi-Page Images & PDFs Dropzone                                         │
│  • Client-Side Canvas Optimizer (Max 1600px, JPEG 85% — Fast & < 1.5MB)      │
│  • Safe API Client: Status Code + Content-Type Validation (No JSON crashes)  │
│  • IndexedDB Storage: Automatic saving of edits, units, custom subjects      │
│  • JSON Backup & Restore with Schema Validation (Merge vs. Replace)          │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │
                        POST /api/notes/process (JSON)
                                       │
        ┌──────────────────────────────┴──────────────────────────────┐
        ▼                                                             ▼
┌─────────────────────────────────┐         ┌──────────────────────────────────┐
│   Vercel Serverless Function    │         │    Express Dev/Prod Server       │
│      (/api/notes/process.ts)    │         │          (server.ts)             │
│   • maxDuration: 60s            │         │   • Port 3000 + Vite middleware  │
└───────────────┬─────────────────┘         └─────────────────┬────────────────┘
                │                                             │
                └──────────────────────┬──────────────────────┘
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                    Shared Core Processor (src/server/...)                    │
│  • Multimodal Gemini Vision (gemini-3.8-flash)                               │
│  • Strict JSON response schema enforcement                                   │
│  • Verbatim Page Transcripts & [unclear] marker audits                       │
│  • Deterministic Lexical & Semantic Entailment Grounding Check               │
│  • Source-Only MCQ Traceability Filter                                       │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Implementation Steps

1. **Shared Notes Processor (`src/server/notesProcessor.ts`)**:
   - Extract the entire Gemini Vision OCR, system instructions, response schema, deterministic lexical grounding check, illegibility flagger, and MCQ traceability auditor into a single reusable TypeScript module.
2. **Vercel Serverless Functions (`/api/notes/process.ts`, `/api/notes/regenerate-mcqs.ts`)**:
   - Create standard Vercel serverless request handlers (`(req: VercelRequest, res: VercelResponse)`) that import the shared processor and set proper JSON headers and status codes.
3. **Vercel Configuration (`vercel.json`)**:
   - Add root `vercel.json` defining function settings (`maxDuration: 60`) and API routing rules.
4. **Express Backend Refactoring (`server.ts`)**:
   - Wire `server.ts` to call the shared processor so local dev and standard full-stack Node environments remain 100% in sync with zero duplicated logic.
5. **Client-Side Image Optimization (`src/utils/pdfRasterizer.ts`)**:
   - Add image dimension clamping (max 1600px on the longest edge) and JPEG 85% encoding for all uploaded images and rasterized PDF pages.
6. **Defensive API Client & Error Messaging (`src/App.tsx`, `src/components/PdfMcqModule.tsx`)**:
   - Refactor `fetch` handling to check `response.ok`, parse Content-Type, capture raw text on parse error, and present clear messages when `GEMINI_API_KEY` is missing or when network errors occur.
7. **Build, Lint & Compilation Verification**:
   - Run `compile_applet` and `lint_applet` together and test local API routes via curl.
