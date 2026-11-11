import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { StudyUnitDocument } from '../types';
import { renderMathToHtml, renderTextWithMathToHtml, sanitizeLatex } from './mathRenderer';

/**
 * Creates a clean, styled HTML string for an A4 page element with KaTeX mathematical formulas,
 * sharp academic typography, verified badges, diagrams, and sequential page footers.
 */
function buildA4SheetHtml(params: {
  unit: StudyUnitDocument;
  isFirstPage: boolean;
  pageNumber: number;
  totalPages: number;
  blocksHtml: string;
}): string {
  const { unit, isFirstPage, pageNumber, totalPages, blocksHtml } = params;

  const headerHtml = isFirstPage
    ? `
    <div style="background-color: #0f172a; color: #ffffff; border-radius: 8px; padding: 22px 24px; margin-bottom: 22px;">
      <div style="display: flex; justify-content: space-between; font-size: 11px; font-weight: 700; color: #38bdf8; letter-spacing: 0.05em; font-family: monospace; margin-bottom: 8px;">
        <span>${escapeHtml(unit.subject.toUpperCase())} &bull; UNIT ${unit.unitNumber} STUDY MATERIAL</span>
        <span>SOURCE-VERIFIED EDITION</span>
      </div>
      <h1 style="font-size: 24px; font-weight: 800; line-height: 1.25; margin: 0 0 10px 0; color: #ffffff; font-family: 'Plus Jakarta Sans', system-ui, sans-serif;">
        Unit ${unit.unitNumber}: ${escapeHtml(unit.unitTitle)}
      </h1>
      <div style="padding-top: 10px; border-top: 1px solid #1e293b; display: flex; justify-content: space-between; font-size: 11px; color: #cbd5e1; font-family: monospace;">
        <span>Source Pages: ${unit.sourcePages.length}</span>
        <span>Verified Concepts: ${unit.sections.reduce(
          (acc, s) => acc + s.items.filter((i) => i.verificationStatus === 'VERIFIED').length,
          0
        )} / ${unit.sections.reduce((acc, s) => acc + s.items.length, 0)}</span>
        <span>Date: ${new Date(unit.updatedAt).toLocaleDateString()}</span>
      </div>
    </div>
    `
    : `
    <div style="border-bottom: 2px solid #0f172a; padding-bottom: 8px; margin-bottom: 20px; display: flex; justify-content: space-between; font-size: 11px; font-weight: 700; color: #475569; font-family: monospace;">
      <span>${escapeHtml(unit.subject.toUpperCase())} &bull; UNIT ${unit.unitNumber}: ${escapeHtml(unit.unitTitle)}</span>
      <span>PAGE ${pageNumber} OF ${totalPages}</span>
    </div>
    `;

  const footerHtml = `
    <div style="margin-top: 24px; padding-top: 10px; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; font-size: 10.5px; color: #64748b; font-family: monospace;">
      <span>${escapeHtml(unit.subject)} &bull; Unit ${unit.unitNumber} (Source-Verified Study Material)</span>
      <span>Page ${pageNumber} of ${totalPages}</span>
    </div>
  `;

  return `
    <div class="a4-render-page" style="
      width: 794px;
      min-height: 1123px;
      box-sizing: border-box;
      padding: 40px 42px;
      background-color: #ffffff;
      color: #0f172a;
      font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      line-height: 1.6;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      position: relative;
    ">
      <div>
        ${headerHtml}
        <div style="display: flex; flex-direction: column; gap: 16px;">
          ${blocksHtml}
        </div>
      </div>
      ${footerHtml}
    </div>
  `;
}

function escapeHtml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Builds HTML for a section header
 */
function buildSectionHeaderHtml(heading: string, subheading?: string): string {
  return `
    <div style="border-bottom: 1.5px solid #cbd5e1; padding-bottom: 6px; margin-top: 8px;">
      <h2 style="font-size: 16px; font-weight: 800; color: #0f172a; margin: 0 0 2px 0; font-family: 'Plus Jakarta Sans', system-ui, sans-serif;">
        ${escapeHtml(heading)}
      </h2>
      ${
        subheading
          ? `<p style="font-size: 12px; color: #475569; font-style: italic; margin: 0;">${escapeHtml(subheading)}</p>`
          : ''
      }
    </div>
  `;
}

/**
 * Builds HTML for a verified concept item with KaTeX mathematical formulas
 */
function buildConceptItemHtml(item: any): string {
  const isVerified = item.verificationStatus === 'VERIFIED';
  const badgeBg = isVerified ? '#e0f2fe' : '#fef3c7';
  const badgeColor = isVerified ? '#0369a1' : '#b45309';

  let formulasHtml = '';
  if (item.formulasAndDerivations && item.formulasAndDerivations.length > 0) {
    const stepsHtml = item.formulasAndDerivations
      .map((st: any) => {
        const mathRendered = renderMathToHtml(st.expression, true);
        return `
          <div style="margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1px dashed #e2e8f0;">
            <div style="font-size: 11px; font-weight: 700; color: #0369a1; font-family: monospace; margin-bottom: 4px;">
              Step ${st.stepNumber}:
            </div>
            <div style="background-color: #ffffff; padding: 6px 12px; border-radius: 6px; border: 1px solid #e2e8f0; margin-bottom: 4px; overflow-x: auto;">
              ${mathRendered}
            </div>
            ${
              st.explanation
                ? `<div style="font-size: 12px; color: #475569; font-style: italic; padding-left: 4px;">&bull; ${escapeHtml(
                    st.explanation
                  )}</div>`
                : ''
            }
          </div>
        `;
      })
      .join('');

    formulasHtml = `
      <div style="background-color: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; padding: 12px 14px; margin-top: 10px;">
        <div style="font-size: 11px; font-weight: 800; color: #0369a1; font-family: monospace; letter-spacing: 0.04em; margin-bottom: 8px;">
          FORMULAS & STEP-BY-STEP DERIVATION:
        </div>
        ${stepsHtml}
      </div>
    `;
  }

  let diagramHtml = '';
  if (item.diagramRegion) {
    const diag = item.diagramRegion;
    diagramHtml = `
      <div style="border: 1px solid #cbd5e1; background-color: #fafaf9; border-radius: 8px; padding: 12px; margin-top: 10px; display: flex; gap: 16px; align-items: center;">
        ${
          diag.croppedDataUrl
            ? `<div style="width: 180px; height: 110px; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 6px; display: flex; align-items: center; justify-content: center; overflow: hidden; shrink: 0;">
                <img src="${diag.croppedDataUrl}" alt="${escapeHtml(diag.caption)}" style="max-width: 100%; max-height: 100%; object-fit: contain;" />
              </div>`
            : ''
        }
        <div style="flex: 1; font-size: 12px;">
          <div style="font-weight: 700; color: #0f172a; margin-bottom: 4px;">
            Diagram (Source Page ${diag.pageNumber}): ${escapeHtml(diag.caption)}
          </div>
          ${
            diag.labels && diag.labels.length > 0
              ? `<div style="font-family: monospace; font-size: 11px; color: #475569;">
                  Labels: ${escapeHtml(diag.labels.join(' | '))}
                </div>`
              : ''
          }
        </div>
      </div>
    `;
  }

  const explanationHtml = renderTextWithMathToHtml(item.generatedExplanation);

  return `
    <div style="border-bottom: 1px solid #f1f5f9; padding-bottom: 14px; margin-bottom: 6px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
        <span style="background-color: ${badgeBg}; color: ${badgeColor}; padding: 3px 8px; border-radius: 6px; font-size: 12px; font-weight: 800; letter-spacing: 0.02em;">
          ${escapeHtml(item.originalKeyword)}
        </span>
        <span style="font-size: 11px; font-family: monospace; color: #64748b;">
          Source Page ${item.sourcePageReference} &bull; ${item.verificationStatus}
        </span>
      </div>

      <div style="font-size: 11.5px; font-style: italic; color: #475569; background-color: #f8fafc; padding: 6px 10px; border-radius: 6px; border-left: 3px solid #cbd5e1; margin-bottom: 8px;">
        Source Note (Page ${item.sourcePageReference}): &ldquo;${escapeHtml(item.supportingSourcePassage)}&rdquo;
      </div>

      <div style="font-size: 13.5px; color: #1e293b; line-height: 1.65; margin-bottom: 6px;">
        ${explanationHtml}
      </div>

      ${formulasHtml}
      ${diagramHtml}
    </div>
  `;
}

/**
 * Builds HTML for a practice MCQ block
 */
function buildMcqBlockHtml(mcqs: any[]): string {
  const itemsHtml = mcqs
    .map((mcq, idx) => {
      const qHtml = renderTextWithMathToHtml(mcq.question);
      const expHtml = renderTextWithMathToHtml(mcq.explanation);
      const optLetters = ['A', 'B', 'C', 'D'];

      const optionsHtml = mcq.options
        .map((opt: string, oIdx: number) => {
          return `
            <div style="padding: 4px 8px; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 4px; font-size: 12px;">
              <span style="font-weight: 700; color: #0f172a; margin-right: 4px;">(${optLetters[oIdx]})</span>
              ${renderTextWithMathToHtml(opt)}
            </div>
          `;
        })
        .join('');

      return `
        <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 14px; margin-bottom: 10px; font-size: 12.5px;">
          <div style="font-weight: 700; color: #0f172a; margin-bottom: 8px;">
            Q${idx + 1}. ${qHtml}
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px;">
            ${optionsHtml}
          </div>
          <div style="font-size: 11.5px; color: #065f46; background-color: #ecfdf5; padding: 6px 10px; border-radius: 6px; border: 1px solid #a7f3d0;">
            <span style="font-weight: 700;">Answer: (${optLetters[mcq.correctIndex]})</span> &mdash; ${expHtml}
            <span style="color: #64748b; font-family: monospace; display: block; margin-top: 2px;">
              [Source Page ${mcq.sourcePageReference}: &ldquo;${escapeHtml(mcq.supportingSourcePassage)}&rdquo;]
            </span>
          </div>
        </div>
      `;
    })
    .join('');

  return `
    <div style="margin-top: 14px;">
      <div style="background-color: #e0f2fe; border: 1px solid #bae6fd; border-radius: 8px; padding: 8px 14px; margin-bottom: 12px; font-size: 13px; font-weight: 800; color: #0369a1; font-family: monospace;">
        SOURCE-VERIFIED PRACTICE MCQS (${mcqs.length} QUESTIONS)
      </div>
      ${itemsHtml}
    </div>
  `;
}

/**
 * Downloads a publication-quality A4 PDF with mathematical rendering (via KaTeX),
 * balanced page distribution, exact 'Page X of Y' numbering, and diagram embedding.
 */
export async function downloadUnitStudyPdf(
  unit: StudyUnitDocument,
  includeMcqs: boolean = true
): Promise<string> {
  // Step 1: Divide content into discrete pages to prevent overflowing and awkward page breaks
  interface PageBlock {
    type: 'section_header' | 'concept_item' | 'mcq_block';
    html: string;
    weight: number;
  }

  const rawBlocks: PageBlock[] = [];

  for (const section of unit.sections) {
    rawBlocks.push({
      type: 'section_header',
      html: buildSectionHeaderHtml(section.heading, section.subheading),
      weight: 65,
    });

    for (const item of section.items) {
      let weight = 120;
      if (item.formulasAndDerivations && item.formulasAndDerivations.length > 0) {
        weight += item.formulasAndDerivations.length * 50;
      }
      if (item.diagramRegion) {
        weight += 140;
      }
      if (item.generatedExplanation && item.generatedExplanation.length > 250) {
        weight += Math.min(100, Math.floor(item.generatedExplanation.length / 5));
      }

      rawBlocks.push({
        type: 'concept_item',
        html: buildConceptItemHtml(item),
        weight,
      });
    }
  }

  if (includeMcqs && unit.mcqs && unit.mcqs.length > 0) {
    // Break MCQs into reasonable chunks (2-3 MCQs per block)
    const mcqChunkSize = 2;
    for (let m = 0; m < unit.mcqs.length; m += mcqChunkSize) {
      const slice = unit.mcqs.slice(m, m + mcqChunkSize);
      rawBlocks.push({
        type: 'mcq_block',
        html: buildMcqBlockHtml(slice),
        weight: 180 * slice.length,
      });
    }
  }

  // Step 2: Bin pack blocks into discrete A4 sheets
  const pagesHtml: string[] = [];
  let currentPageBlocks: string[] = [];
  let currentWeight = 260; // cover weight on Page 1
  const maxPageCapacity = 820;

  for (const block of rawBlocks) {
    if (currentWeight + block.weight > maxPageCapacity && currentPageBlocks.length > 0) {
      pagesHtml.push(currentPageBlocks.join(''));
      currentPageBlocks = [];
      currentWeight = 60; // running header weight on Page 2+
    }
    currentPageBlocks.push(block.html);
    currentWeight += block.weight;
  }

  if (currentPageBlocks.length > 0 || pagesHtml.length === 0) {
    pagesHtml.push(currentPageBlocks.join(''));
  }

  const totalPages = pagesHtml.length;

  // Step 3: Render pages inside a hidden DOM container with full KaTeX stylesheets
  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.top = '-99999px';
  container.style.left = '-99999px';
  container.style.width = '794px';
  container.style.backgroundColor = '#ffffff';
  document.body.appendChild(container);

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const a4WidthMm = 210;
  const a4HeightMm = 297;

  try {
    for (let pIdx = 0; pIdx < totalPages; pIdx++) {
      const pageNumber = pIdx + 1;
      const isFirstPage = pIdx === 0;
      const sheetHtml = buildA4SheetHtml({
        unit,
        isFirstPage,
        pageNumber,
        totalPages,
        blocksHtml: pagesHtml[pIdx],
      });

      container.innerHTML = sheetHtml;

      // Small delay for DOM layout and webfonts/KaTeX fonts to settle
      await new Promise((resolve) => setTimeout(resolve, 60));

      const pageEl = container.firstElementChild as HTMLElement;
      if (!pageEl) continue;

      const canvas = await html2canvas(pageEl, {
        scale: 2, // 2x for sharp print quality
        useCORS: true,
        allowTaint: true,
        logging: false,
        backgroundColor: '#ffffff',
        width: 794,
        windowWidth: 794,
      });

      const imgData = canvas.toDataURL('image/jpeg', 0.95);

      if (pIdx > 0) {
        doc.addPage();
      }

      doc.addImage(imgData, 'JPEG', 0, 0, a4WidthMm, a4HeightMm, undefined, 'FAST');
    }

    const safeFileName = `${unit.subject}_Unit_${unit.unitNumber}_${unit.unitTitle}`
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .replace(/_+/g, '_')
      .slice(0, 60) + '.pdf';

    const pdfBlob = doc.output('blob');
    const blobUrl = URL.createObjectURL(pdfBlob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = safeFileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);

    return safeFileName;
  } finally {
    document.body.removeChild(container);
  }
}
