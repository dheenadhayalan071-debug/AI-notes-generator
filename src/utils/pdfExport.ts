import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import 'katex/dist/katex.min.css';
import { StudyUnitDocument, VerifiedConceptItem } from '../types';
import {
  renderMathToHtml,
  renderTextWithMathToHtml,
} from './mathRenderer';

const PAGE_WIDTH_PX = 794;
const PAGE_HEIGHT_PX = 1123;
const HORIZONTAL_MARGIN_PX = 48;
const FOOTER_GAP_PX = 18;
const BLOCK_GAP_PX = 12;
const CAPTURE_SCALE = 2;

interface LayoutBlock {
  html: string;
  type: 'section' | 'concept' | 'mcq-heading' | 'mcq';
  sectionId?: string;
  height?: number;
}

interface MeasuredPage {
  content: HTMLDivElement;
  header: HTMLDivElement;
  footer: HTMLDivElement;
  contentHeight: number;
  firstPage: boolean;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function statusLabel(item: VerifiedConceptItem): string {
  switch (item.verificationStatus) {
    case 'VERIFIED':
      return 'VERIFIED';
    case 'PARTIALLY_SUPPORTED':
      return 'PARTIALLY SUPPORTED';
    default:
      return 'NEEDS REVIEW';
  }
}

function statusColors(item: VerifiedConceptItem): { background: string; color: string } {
  switch (item.verificationStatus) {
    case 'VERIFIED':
      return { background: '#e0f2fe', color: '#0369a1' };
    case 'PARTIALLY_SUPPORTED':
      return { background: '#f0f9ff', color: '#0284c7' };
    default:
      return { background: '#fef3c7', color: '#b45309' };
  }
}

function paragraphHtml(text: string, style = ''): string {
  return `<div style="font-size:13px;line-height:1.6;color:#1e293b;overflow-wrap:anywhere;${style}">${renderTextWithMathToHtml(
    text
  )}</div>`;
}

function quoteHtml(text: string, pageNumber: number, continuation = false): string {
  return `
    <div style="
      box-sizing:border-box;
      width:100%;
      padding:8px 11px;
      border-left:3px solid #cbd5e1;
      border-radius:0 6px 6px 0;
      background:#f8fafc;
      color:#475569;
      font-size:11.5px;
      line-height:1.55;
      font-style:italic;
      overflow-wrap:anywhere;
    ">
      <div style="font-size:10px;font-weight:700;font-style:normal;margin-bottom:4px;color:#64748b;">
        Source Note · Page ${pageNumber}${continuation ? ' · continued' : ''}
      </div>
      “${renderTextWithMathToHtml(text)}”
    </div>
  `;
}

function conceptHeadingHtml(item: VerifiedConceptItem): string {
  const colors = statusColors(item);

  return `
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:2px;">
      <span style="
        display:inline-block;
        max-width:62%;
        padding:4px 9px;
        border-radius:6px;
        background:${colors.background};
        color:${colors.color};
        font-size:12px;
        font-weight:800;
        line-height:1.4;
        overflow-wrap:anywhere;
      ">${escapeHtml(item.originalKeyword)}</span>
      <span style="
        text-align:right;
        color:#64748b;
        font-family:ui-monospace,SFMono-Regular,monospace;
        font-size:10px;
        line-height:1.5;
      ">Source Page ${Number(item.sourcePageReference) || 1}<br>${statusLabel(item)}</span>
    </div>
  `;
}

function continuationAttributionHtml(item: VerifiedConceptItem): string {
  return `
    <div style="
      color:#64748b;
      font-family:ui-monospace,SFMono-Regular,monospace;
      font-size:10px;
      line-height:1.4;
      margin-bottom:2px;
    ">Continued · ${escapeHtml(item.originalKeyword)} · Source Page ${
      Number(item.sourcePageReference) || 1
    }</div>
  `;
}

function wrapConceptFragment(
  item: VerifiedConceptItem,
  innerHtml: string,
  firstFragment: boolean
): string {
  return `
    <div style="
      box-sizing:border-box;
      width:100%;
      padding:10px 12px;
      border:1px solid #e2e8f0;
      border-radius:8px;
      border-bottom:2px solid #e2e8f0;
      background:#ffffff;
      display:flex;
      flex-direction:column;
      gap:9px;
      overflow-wrap:anywhere;
    ">
      ${firstFragment ? conceptHeadingHtml(item) : continuationAttributionHtml(item)}
      ${innerHtml}
    </div>
  `;
}

function formulaStepHtml(step: any, index: number): string {
  const expression = String(step?.expression || '').trim();
  const explanation = String(step?.explanation || '').trim();

  return `
    <div style="
      box-sizing:border-box;
      width:100%;
      padding:8px 10px;
      border:1px solid #e2e8f0;
      border-radius:6px;
      background:#ffffff;
      overflow-wrap:anywhere;
    ">
      <div style="
        color:#0369a1;
        font-family:ui-monospace,SFMono-Regular,monospace;
        font-size:10px;
        font-weight:700;
        margin-bottom:5px;
      ">Step ${Number(step?.stepNumber) || index + 1}</div>
      <div style="
        box-sizing:border-box;
        width:100%;
        color:#0f172a;
        overflow-wrap:anywhere;
        word-break:break-word;
      ">${renderMathToHtml(expression, true)}</div>
      ${
        explanation
          ? `<div style="font-size:11.5px;line-height:1.5;color:#475569;margin-top:6px;overflow-wrap:anywhere;">${renderTextWithMathToHtml(
              explanation
            )}</div>`
          : ''
      }
    </div>
  `;
}

function diagramHtml(item: VerifiedConceptItem): string {
  const diagram = item.diagramRegion;
  if (!diagram) return '';

  const image = diagram.croppedDataUrl
    ? `<img
        src="${escapeHtml(diagram.croppedDataUrl)}"
        alt="${escapeHtml(diagram.caption)}"
        style="display:block;max-width:100%;max-height:150px;object-fit:contain;"
      />`
    : '';

  const labels =
    diagram.labels?.length > 0
      ? `<div style="font-family:ui-monospace,SFMono-Regular,monospace;font-size:10px;color:#475569;overflow-wrap:anywhere;">
          Labels: ${escapeHtml(diagram.labels.join(' | '))}
        </div>`
      : '';

  return `
    <div style="
      box-sizing:border-box;
      width:100%;
      padding:10px;
      border:1px solid #cbd5e1;
      border-radius:7px;
      background:#fafaf9;
      display:flex;
      flex-direction:column;
      gap:7px;
    ">
      ${image}
      <div style="font-size:11.5px;font-weight:700;color:#0f172a;overflow-wrap:anywhere;">
        Diagram · Source Page ${Number(diagram.pageNumber) || Number(item.sourcePageReference) || 1}:
        ${escapeHtml(diagram.caption)}
      </div>
      ${labels}
    </div>
  `;
}

/**
 * Converts content into paragraph-sized pieces first. Math-delimited spans are
 * retained as indivisible tokens so a text split does not break common LaTeX.
 */
function textTokens(text: string): string[] {
  const mathPattern =
    /(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\))/g;
  const tokens: string[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = mathPattern.exec(text)) !== null) {
    const before = text.slice(cursor, match.index);
    tokens.push(...(before.match(/\S+\s*|\s+/g) || []));
    tokens.push(match[0]);
    cursor = match.index + match[0].length;
  }

  tokens.push(...(text.slice(cursor).match(/\S+\s*|\s+/g) || []));
  return tokens;
}

function textParagraphs(text: string): string[] {
  return String(text || '')
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function sectionHeaderHtml(heading: string, subheading?: string): string {
  return `
    <div style="
      box-sizing:border-box;
      width:100%;
      padding:3px 0 7px;
      border-bottom:1.5px solid #cbd5e1;
    ">
      <div style="
        font-family:'Plus Jakarta Sans',system-ui,sans-serif;
        font-size:16px;
        line-height:1.35;
        font-weight:800;
        color:#0f172a;
        overflow-wrap:anywhere;
      ">${escapeHtml(heading)}</div>
      ${
        subheading
          ? `<div style="font-size:11px;line-height:1.45;color:#64748b;font-style:italic;margin-top:3px;overflow-wrap:anywhere;">${escapeHtml(
              subheading
            )}</div>`
          : ''
      }
    </div>
  `;
}

function mcqHtml(mcq: any, index: number): string {
  const options = Array.isArray(mcq.options) ? mcq.options.slice(0, 4) : [];
  const letters = ['A', 'B', 'C', 'D'];
  const optionsHtml = options
    .map(
      (option: string, optionIndex: number) => `
        <div style="
          box-sizing:border-box;
          padding:5px 7px;
          border:1px solid #e2e8f0;
          border-radius:4px;
          background:#ffffff;
          font-size:11px;
          line-height:1.45;
          overflow-wrap:anywhere;
        ">
          <strong>(${letters[optionIndex]})</strong>
          ${renderTextWithMathToHtml(String(option))}
        </div>
      `
    )
    .join('');

  const correctIndex = Math.max(0, Math.min(3, Number(mcq.correctIndex) || 0));

  return `
    <div style="
      box-sizing:border-box;
      width:100%;
      padding:10px 12px;
      border:1px solid #e2e8f0;
      border-radius:7px;
      background:#f8fafc;
      display:flex;
      flex-direction:column;
      gap:7px;
      overflow-wrap:anywhere;
    ">
      <div style="font-size:12px;line-height:1.5;font-weight:700;color:#0f172a;">
        Q${index + 1}. ${renderTextWithMathToHtml(String(mcq.question || ''))}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
        ${optionsHtml}
      </div>
      <div style="
        padding:7px 8px;
        border:1px solid #a7f3d0;
        border-radius:5px;
        background:#ecfdf5;
        color:#065f46;
        font-size:10.5px;
        line-height:1.5;
      ">
        <strong>Answer (${letters[correctIndex]}):</strong>
        ${renderTextWithMathToHtml(String(mcq.explanation || ''))}
        <div style="margin-top:4px;color:#64748b;font-size:9.5px;">
          Source Page ${Number(mcq.sourcePageReference) || 1}:
          “${escapeHtml(mcq.supportingSourcePassage || '')}”
        </div>
      </div>
    </div>
  `;
}

function buildConceptSegments(item: VerifiedConceptItem): string[] {
  const segments: string[] = [];
  const source = String(item.supportingSourcePassage || '').trim();
  const explanation = String(item.generatedExplanation || '').trim();
  const pageNumber = Number(item.sourcePageReference) || 1;

  if (source) {
    for (const paragraph of textParagraphs(source)) {
      segments.push(quoteHtml(paragraph, pageNumber));
    }
  }

  for (const paragraph of textParagraphs(explanation)) {
    segments.push(paragraphHtml(paragraph));
  }

  const formulas = Array.isArray(item.formulasAndDerivations)
    ? item.formulasAndDerivations
    : [];

  if (formulas.length > 0) {
    segments.push(`
      <div style="
        color:#0369a1;
        font-family:ui-monospace,SFMono-Regular,monospace;
        font-size:10px;
        font-weight:800;
        letter-spacing:.03em;
        padding-top:2px;
      ">FORMULAS &amp; STEP-BY-STEP DERIVATION</div>
    `);

    formulas.forEach((step, index) => {
      segments.push(formulaStepHtml(step, index));
    });
  }

  const diagram = diagramHtml(item);
  if (diagram) segments.push(diagram);

  if (segments.length === 0) {
    segments.push(paragraphHtml('No source excerpt or explanation was provided.'));
  }

  return segments;
}

function makePageShell(unit: StudyUnitDocument, firstPage: boolean): HTMLDivElement {
  const page = document.createElement('div');
  page.style.cssText = `
    position:relative;
    box-sizing:border-box;
    width:${PAGE_WIDTH_PX}px;
    height:${PAGE_HEIGHT_PX}px;
    overflow:hidden;
    background:#ffffff;
    color:#0f172a;
    font-family:'DM Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
    font-size:13px;
    line-height:1.55;
  `;

  const header = document.createElement('div');
  header.dataset.role = 'page-header';
  header.style.cssText = `
    position:absolute;
    top:32px;
    left:${HORIZONTAL_MARGIN_PX}px;
    right:${HORIZONTAL_MARGIN_PX}px;
    box-sizing:border-box;
  `;

  if (firstPage) {
    const verifiedCount = unit.sections.reduce(
      (count, section) =>
        count +
        section.items.filter(
          (item) =>
            item.verificationStatus === 'VERIFIED' ||
            item.verificationStatus === 'PARTIALLY_SUPPORTED'
        ).length,
      0
    );
    const totalConceptCount = unit.sections.reduce(
      (count, section) => count + section.items.length,
      0
    );

    header.innerHTML = `
      <div style="
        box-sizing:border-box;
        padding:18px 20px;
        border-radius:8px;
        background:#0f172a;
        color:#ffffff;
      ">
        <div style="
          display:flex;
          justify-content:space-between;
          gap:12px;
          color:#38bdf8;
          font-family:ui-monospace,SFMono-Regular,monospace;
          font-size:9px;
          font-weight:700;
          letter-spacing:.04em;
          line-height:1.5;
          overflow-wrap:anywhere;
        ">
          <span>${escapeHtml(unit.subject.toUpperCase())} · UNIT ${
            unit.unitNumber
          } STUDY MATERIAL</span>
          <span>SOURCE-VERIFIED EDITION</span>
        </div>
        <div style="
          margin-top:8px;
          color:#ffffff;
          font-family:'Plus Jakarta Sans',system-ui,sans-serif;
          font-size:22px;
          font-weight:800;
          line-height:1.25;
          overflow-wrap:anywhere;
        ">Unit ${unit.unitNumber}: ${escapeHtml(unit.unitTitle)}</div>
        <div style="
          display:flex;
          justify-content:space-between;
          flex-wrap:wrap;
          gap:5px 12px;
          margin-top:11px;
          padding-top:9px;
          border-top:1px solid #334155;
          color:#cbd5e1;
          font-family:ui-monospace,SFMono-Regular,monospace;
          font-size:9px;
          line-height:1.5;
        ">
          <span>Source Pages: ${unit.sourcePages.length}</span>
          <span>Supported Concepts: ${verifiedCount}/${totalConceptCount}</span>
          <span>Updated: ${escapeHtml(
            new Date(unit.updatedAt).toLocaleDateString()
          )}</span>
        </div>
      </div>
    `;
  } else {
    header.innerHTML = `
      <div style="
        display:flex;
        justify-content:space-between;
        gap:12px;
        padding-bottom:7px;
        border-bottom:2px solid #0f172a;
        color:#475569;
        font-family:ui-monospace,SFMono-Regular,monospace;
        font-size:9px;
        font-weight:700;
        line-height:1.5;
      ">
        <span style="overflow-wrap:anywhere;">${escapeHtml(
          unit.subject.toUpperCase()
        )} · UNIT ${unit.unitNumber}: ${escapeHtml(unit.unitTitle)}</span>
        <span style="white-space:nowrap;">CONTINUED</span>
      </div>
    `;
  }

  const footer = document.createElement('div');
  footer.dataset.role = 'page-footer';
  footer.style.cssText = `
    position:absolute;
    left:${HORIZONTAL_MARGIN_PX}px;
    right:${HORIZONTAL_MARGIN_PX}px;
    bottom:28px;
    box-sizing:border-box;
    padding-top:7px;
    border-top:1px solid #e2e8f0;
    display:flex;
    justify-content:space-between;
    gap:12px;
    color:#64748b;
    font-family:ui-monospace,SFMono-Regular,monospace;
    font-size:9px;
    line-height:1.4;
  `;
  footer.innerHTML = `
    <span style="overflow-wrap:anywhere;">${escapeHtml(
      unit.subject
    )} · Unit ${unit.unitNumber}: ${escapeHtml(unit.unitTitle)}</span>
    <span data-role="page-number" style="white-space:nowrap;"></span>
  `;

  const content = document.createElement('div');
  content.dataset.role = 'page-content';
  content.style.cssText = `
    position:absolute;
    left:${HORIZONTAL_MARGIN_PX}px;
    right:${HORIZONTAL_MARGIN_PX}px;
    display:flex;
    flex-direction:column;
    gap:${BLOCK_GAP_PX}px;
    box-sizing:border-box;
    overflow:visible;
  `;

  page.append(header, content, footer);
  return page;
}

function positionContent(page: HTMLDivElement): MeasuredPage {
  const header = page.querySelector<HTMLDivElement>('[data-role="page-header"]')!;
  const footer = page.querySelector<HTMLDivElement>('[data-role="page-footer"]')!;
  const content = page.querySelector<HTMLDivElement>('[data-role="page-content"]')!;
  const headerBottom = header.offsetTop + header.offsetHeight;
  const footerTop = footer.offsetTop;
  const contentTop = headerBottom + 18;
  const contentBottom = footerTop - FOOTER_GAP_PX;
  const contentHeight = contentBottom - contentTop;

  content.style.top = `${contentTop}px`;
  content.style.bottom = `${PAGE_HEIGHT_PX - contentBottom}px`;

  return {
    content,
    header,
    footer,
    contentHeight,
    firstPage: header.innerHTML.includes('SOURCE-VERIFIED EDITION'),
  };
}

function waitForImages(root: HTMLElement): Promise<void> {
  const images = Array.from(root.querySelectorAll('img'));
  return Promise.all(
    images.map((image) => {
      if (image.complete) return Promise.resolve();
      return new Promise<void>((resolve) => {
        image.onload = () => resolve();
        image.onerror = () => resolve();
      });
    })
  ).then(() => undefined);
}

async function waitForFonts(): Promise<void> {
  if (document.fonts?.ready) {
    await document.fonts.ready;
  }
}

function appendHtml(parent: HTMLElement, html: string): HTMLElement {
  const template = document.createElement('template');
  template.innerHTML = html.trim();
  const element = template.content.firstElementChild as HTMLElement | null;
  if (!element) {
    const fallback = document.createElement('div');
    parent.appendChild(fallback);
    return fallback;
  }
  parent.appendChild(element);
  return element;
}

function contentHeightWith(parent: HTMLDivElement, html: string): number {
  const element = appendHtml(parent, html);
  const height = parent.scrollHeight;
  parent.removeChild(element);
  return height;
}

function splitTextByMeasuredHeight(
  text: string,
  makeHtml: (chunk: string, continuation: boolean) => string,
  measure: (html: string) => number,
  maxHeight: number
): string[] {
  const paragraphs = textParagraphs(text);
  const output: string[] = [];

  paragraphs.forEach((paragraph, paragraphIndex) => {
    const tokens = textTokens(paragraph);
    if (tokens.length === 0) return;

    let start = 0;
    let continuation = paragraphIndex > 0;

    while (start < tokens.length) {
      let low = start + 1;
      let high = tokens.length;
      let best = start + 1;

      while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        const candidate = tokens.slice(start, middle).join('').trim();
        if (measure(makeHtml(candidate, continuation)) <= maxHeight) {
          best = middle;
          low = middle + 1;
        } else {
          high = middle - 1;
        }
      }

      const chunk = tokens.slice(start, best).join('').trim();
      output.push(makeHtml(chunk, continuation));
      start = best;
      continuation = true;
    }
  });

  return output;
}

function makeOversizedConceptBlocks(
  item: VerifiedConceptItem,
  measure: (html: string) => number,
  maxHeight: number
): LayoutBlock[] {
  const blocks: LayoutBlock[] = [];
  const pageNumber = Number(item.sourcePageReference) || 1;
  const source = String(item.supportingSourcePassage || '').trim();
  const explanation = String(item.generatedExplanation || '').trim();
  let first = true;

  const pushSegment = (html: string) => {
    const wrapped = wrapConceptFragment(item, html, first);
    blocks.push({ html: wrapped, type: 'concept' });
    first = false;
  };

  const splitRichText = (text: string, kind: 'source' | 'explanation') => {
    const makeInner = (chunk: string, continuation: boolean) =>
      kind === 'source'
        ? quoteHtml(chunk, pageNumber, continuation)
        : paragraphHtml(
            chunk,
            continuation ? 'border-left:2px solid #e2e8f0;padding-left:9px;' : ''
          );

    const pieces = splitTextByMeasuredHeight(
      text,
      (chunk, continuation) =>
        wrapConceptFragment(item, makeInner(chunk, continuation), first),
      measure,
      maxHeight
    );

    for (const piece of pieces) {
      blocks.push({ html: piece, type: 'concept' });
      first = false;
    }
  };

  if (source) splitRichText(source, 'source');
  if (explanation) splitRichText(explanation, 'explanation');

  const formulas = Array.isArray(item.formulasAndDerivations)
    ? item.formulasAndDerivations
    : [];

  if (formulas.length > 0) {
    if (first) {
      pushSegment(conceptHeadingHtml(item));
    }

    pushSegment(`
      <div style="color:#0369a1;font-family:ui-monospace,SFMono-Regular,monospace;font-size:10px;font-weight:800;">
        FORMULAS &amp; STEP-BY-STEP DERIVATION
      </div>
    `);

    for (let index = 0; index < formulas.length; index += 1) {
      const step = formulas[index];
      const stepHtml = formulaStepHtml(step, index);
      const stepHeight = measure(wrapConceptFragment(item, stepHtml, first));

      if (stepHeight <= maxHeight) {
        pushSegment(stepHtml);
        continue;
      }

      const stepExplanation = String(step?.explanation || '').trim();
      const expressionHtml = `
        <div style="
          box-sizing:border-box;
          padding:8px 10px;
          border:1px solid #e2e8f0;
          border-radius:6px;
          background:#ffffff;
          overflow-wrap:anywhere;
          word-break:break-word;
        ">
          <div style="font-size:10px;font-weight:700;color:#0369a1;margin-bottom:5px;">Step ${
            Number(step?.stepNumber) || index + 1
          }</div>
          ${renderMathToHtml(String(step?.expression || ''), true)}
        </div>
      `;
      pushSegment(expressionHtml);

      if (stepExplanation) {
        const explanationParts = splitTextByMeasuredHeight(
          stepExplanation,
          (chunk, continuation) =>
            wrapConceptFragment(
              item,
              paragraphHtml(
                `${continuation ? 'Step explanation continued: ' : 'Step explanation: '}${chunk}`
              ),
              first
            ),
          measure,
          maxHeight
        );
        explanationParts.forEach((html) => {
          blocks.push({ html, type: 'concept' });
          first = false;
        });
      }
    }
  }

  const diagram = diagramHtml(item);
  if (diagram) pushSegment(diagram);

  if (blocks.length === 0) {
    pushSegment(paragraphHtml('No source excerpt or explanation was provided.'));
  }

  return blocks;
}

function buildLayoutBlocks(
  unit: StudyUnitDocument,
  includeMcqs: boolean
): LayoutBlock[] {
  const blocks: LayoutBlock[] = [];

  for (const section of unit.sections) {
    blocks.push({
      type: 'section',
      sectionId: section.id,
      html: sectionHeaderHtml(section.heading, section.subheading),
    });

    for (const item of section.items) {
      const innerSegments = buildConceptSegments(item);
      const fullCard = wrapConceptFragment(item, innerSegments.join(''), true);
      blocks.push({ type: 'concept', html: fullCard });
    }
  }

  if (includeMcqs && unit.mcqs?.length > 0) {
    blocks.push({
      type: 'mcq-heading',
      html: `
        <div style="
          box-sizing:border-box;
          width:100%;
          padding:8px 11px;
          border:1px solid #bae6fd;
          border-radius:7px;
          background:#e0f2fe;
          color:#0369a1;
          font-family:ui-monospace,SFMono-Regular,monospace;
          font-size:11px;
          font-weight:800;
        ">SOURCE-VERIFIED PRACTICE MCQS (${unit.mcqs.length} QUESTIONS)</div>
      `,
    });

    unit.mcqs.forEach((mcq, index) => {
      blocks.push({
        type: 'mcq',
        html: mcqHtml(mcq, index),
      });
    });
  }

  return blocks;
}

function appendBlock(page: MeasuredPage, block: LayoutBlock): void {
  appendHtml(page.content, block.html);
}

function isPageContentEmpty(page: MeasuredPage): boolean {
  return page.content.childElementCount === 0;
}

function pageFits(page: MeasuredPage): boolean {
  return page.content.scrollHeight <= page.contentHeight + 0.5;
}

function createMeasuredPage(
  host: HTMLDivElement,
  unit: StudyUnitDocument,
  firstPage: boolean
): MeasuredPage {
  host.replaceChildren();
  const shell = makePageShell(unit, firstPage);
  host.appendChild(shell);
  return positionContent(shell);
}

function splitOversizedBlocks(
  blocks: LayoutBlock[],
  page: MeasuredPage,
  unit: StudyUnitDocument
): LayoutBlock[] {
  const expanded: LayoutBlock[] = [];
  const measure = (html: string) => contentHeightWith(page.content, html);

  for (const block of blocks) {
    if (block.type !== 'concept' || measure(block.html) <= page.contentHeight) {
      expanded.push(block);
      continue;
    }

    const sectionItem = unit.sections
      .flatMap((section) => section.items)
      .find((item) => block.html.includes(escapeHtml(item.originalKeyword)));

    if (!sectionItem) {
      // Non-concept blocks stay intact. The paginator detects if one cannot fit.
      expanded.push(block);
      continue;
    }

    expanded.push(
      ...makeOversizedConceptBlocks(sectionItem, measure, page.contentHeight)
    );
  }

  return expanded;
}

function paginateBlocks(
  blocks: LayoutBlock[],
  host: HTMLDivElement,
  unit: StudyUnitDocument
): string[][] {
  const pages: string[][] = [];
  let page = createMeasuredPage(host, unit, true);
  let pageHtml: string[] = [];

  const flush = () => {
    if (pageHtml.length > 0) pages.push(pageHtml);
    pageHtml = [];
    page = createMeasuredPage(host, unit, false);
  };

  const measureTogether = (candidate: LayoutBlock[]) => {
    const before = page.content.innerHTML;
    page.content.innerHTML = '';
    candidate.forEach((block) => appendBlock(page, block));
    const height = page.content.scrollHeight;
    page.content.innerHTML = before;
    return height;
  };

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];

    // Keep a section title with the first concept when possible, avoiding
    // headings stranded at the bottom of a page.
    if (block.type === 'section') {
      const next = blocks[index + 1];
      if (next && measureTogether([block, next]) > page.contentHeight && !isPageContentEmpty(page)) {
        flush();
      }
    }

    appendBlock(page, block);

    if (pageFits(page)) {
      pageHtml.push(block.html);
      continue;
    }

    page.content.removeChild(page.content.lastElementChild!);

    if (!isPageContentEmpty(page)) {
      flush();
      appendBlock(page, block);
    }

    if (pageFits(page)) {
      pageHtml.push(block.html);
      continue;
    }

    // A block should have been split when it is a large concept. Keep a final
    // safety path that avoids an infinite pagination loop.
    page.content.removeChild(page.content.lastElementChild!);
    if (block.type === 'concept') {
      const currentItem = unit.sections
        .flatMap((section) => section.items)
        .find((item) => block.html.includes(escapeHtml(item.originalKeyword)));

      if (currentItem) {
        const smallFragments = makeOversizedConceptBlocks(
          currentItem,
          (html) => contentHeightWith(page.content, html),
          page.contentHeight
        );
        for (const fragment of smallFragments) {
          appendBlock(page, fragment);
          if (!pageFits(page) && !isPageContentEmpty(page)) {
            page.content.removeChild(page.content.lastElementChild!);
            flush();
            appendBlock(page, fragment);
          }
          pageHtml.push(fragment.html);
        }
      } else {
        appendBlock(page, block);
        pageHtml.push(block.html);
      }
    } else {
      appendBlock(page, block);
      pageHtml.push(block.html);
    }

    if (index < blocks.length - 1) flush();
  }

  if (pageHtml.length > 0 || pages.length === 0) {
    pages.push(pageHtml);
  }

  return pages;
}

function pageHtml(
  unit: StudyUnitDocument,
  blocks: string[],
  pageNumber: number,
  totalPages: number
): string {
  const page = makePageShell(unit, pageNumber === 1);
  const measured = positionContent(page);
  measured.content.innerHTML = blocks.join('');

  const pageNumberElement = page.querySelector<HTMLElement>(
    '[data-role="page-number"]'
  );
  if (pageNumberElement) {
    pageNumberElement.textContent = `Page ${pageNumber} of ${totalPages}`;
  }

  return page.outerHTML;
}

async function capturePage(page: HTMLDivElement): Promise<HTMLCanvasElement> {
  await waitForImages(page);
  await waitForFonts();

  return html2canvas(page, {
    scale: CAPTURE_SCALE,
    useCORS: true,
    allowTaint: false,
    logging: false,
    backgroundColor: '#ffffff',
    width: PAGE_WIDTH_PX,
    height: PAGE_HEIGHT_PX,
    windowWidth: PAGE_WIDTH_PX,
    windowHeight: PAGE_HEIGHT_PX,
    scrollX: 0,
    scrollY: 0,
  });
}

/**
 * Downloads a fixed-size A4 PDF. Pagination is based on actual rendered DOM
 * heights rather than estimated character counts or block weights.
 */
export async function downloadUnitStudyPdf(
  unit: StudyUnitDocument,
  includeMcqs = true
): Promise<string> {
  if (typeof document === 'undefined') {
    throw new Error('PDF export requires a browser document.');
  }

  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = `
    position:fixed;
    left:-10000px;
    top:0;
    width:${PAGE_WIDTH_PX}px;
    pointer-events:none;
    z-index:-1;
  `;
  document.body.appendChild(host);

  try {
    await waitForFonts();

    const initialMeasurePage = createMeasuredPage(host, unit, true);
    const blocks = buildLayoutBlocks(unit, includeMcqs);
    const preparedBlocks = splitOversizedBlocks(blocks, initialMeasurePage, unit);
    const pages = paginateBlocks(preparedBlocks, host, unit);
    const totalPages = pages.length;

    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
      compress: true,
    });

    for (let pageIndex = 0; pageIndex < totalPages; pageIndex += 1) {
      const markup = pageHtml(
        unit,
        pages[pageIndex],
        pageIndex + 1,
        totalPages
      );

      host.innerHTML = markup;
      const renderedPage = host.firstElementChild as HTMLDivElement | null;
      if (!renderedPage) {
        throw new Error(`Could not render PDF page ${pageIndex + 1}.`);
      }

      const measured = positionContent(renderedPage);
      if (measured.content.scrollHeight > measured.contentHeight + 1) {
        throw new Error(
          `PDF page ${pageIndex + 1} exceeded its measured A4 content area. Please retry the export.`
        );
      }

      const canvas = await capturePage(renderedPage);
      if (pageIndex > 0) pdf.addPage('a4', 'portrait');

      // Place the complete A4 capture on the complete A4 PDF page. There is no
      // scaling of an overflowed document into the page.
      pdf.addImage(
        canvas.toDataURL('image/jpeg', 0.96),
        'JPEG',
        0,
        0,
        210,
        297,
        undefined,
        'FAST'
      );
    }

    const safeFileName =
      `${unit.subject}_Unit_${unit.unitNumber}_${unit.unitTitle}`
        .replace(/[^a-zA-Z0-9_-]+/g, '_')
        .replace(/_+/g, '_')
        .slice(0, 60) + '.pdf';

    const blobUrl = URL.createObjectURL(pdf.output('blob'));
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = safeFileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);

    return safeFileName;
  } finally {
    host.remove();
  }
}
