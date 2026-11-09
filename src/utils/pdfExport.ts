import { jsPDF } from 'jspdf';
import { StudyUnitDocument } from '../types';

/**
 * Strips non-ASCII characters that standard jsPDF Helvetica fonts cannot render natively,
 * while preserving transliterated text or safe mathematical symbols so PDFs never show garbled glyphs.
 */
function toPdfSafeText(input: string): string {
  if (!input) return '';
  return input
    .replace(/×/g, 'x')
    .replace(/÷/g, '/')
    .replace(/±/g, '+/-')
    .replace(/≈/g, '~=')
    .replace(/≠/g, '!=')
    .replace(/≤/g, '<=')
    .replace(/≥/g, '>=')
    .replace(/→/g, '->')
    .replace(/←/g, '<-')
    .replace(/↔/g, '<->')
    .replace(/∮/g, 'oint')
    .replace(/∫/g, 'int')
    .replace(/∑/g, 'sum')
    .replace(/Δ/g, 'Delta ')
    .replace(/Φ/g, 'Phi')
    .replace(/π/g, 'pi')
    .replace(/ε/g, 'epsilon')
    .replace(/₀/g, '_0')
    .replace(/₁/g, '_1')
    .replace(/₂/g, '_2')
    .replace(/₃/g, '_3')
    .replace(/²/g, '^2')
    .replace(/³/g, '^3')
    .replace(/⁻¹/g, '^-1')
    .replace(/⁻²/g, '^-2')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/—/g, ' - ')
    .replace(/–/g, '-')
    .replace(/•/g, '-')
    // Preserve printable ASCII; if non-ASCII script (e.g. Tamil script) is present without ASCII, keep transliteration note
    .replace(/[^\x20-\x7E\n]/g, '');
}

/**
 * Generates and triggers a binary .pdf file download for a specific StudyUnitDocument.
 * Compatible with Android mobile browsers, desktop browsers, and sandboxed iframes.
 */
export async function downloadUnitStudyPdf(
  unit: StudyUnitDocument,
  includeMcqs: boolean = true
): Promise<string> {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth(); // 210mm
  const pageHeight = doc.internal.pageSize.getHeight(); // 297mm
  const marginX = 16;
  const contentWidth = pageWidth - marginX * 2;
  let cursorY = 20;

  const ensureSpace = (neededMm: number) => {
    if (cursorY + neededMm > pageHeight - 18) {
      doc.addPage();
      cursorY = 20;
    }
  };

  // --- TOP ACADEMIC BANNER ---
  doc.setFillColor(15, 23, 42); // #0F172A
  doc.rect(marginX, cursorY, contentWidth, 28, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(56, 189, 248); // Sky-400
  doc.text(
    toPdfSafeText(`${unit.subject.toUpperCase()}  |  UNIT ${unit.unitNumber} STUDY MATERIAL`),
    marginX + 6,
    cursorY + 8
  );

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(255, 255, 255);
  const titleLines = doc.splitTextToSize(
    toPdfSafeText(`Unit ${unit.unitNumber}: ${unit.unitTitle}`),
    contentWidth - 12
  );
  doc.text(titleLines, marginX + 6, cursorY + 16);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(203, 213, 225);
  const totalConcepts = unit.sections.reduce((acc, s) => acc + s.items.length, 0);
  const verifiedCount = unit.sections.reduce(
    (acc, s) => acc + s.items.filter((i) => i.verificationStatus === 'VERIFIED').length,
    0
  );
  doc.text(
    `Source Pages: ${unit.sourcePages.length}  |  Verified Concepts: ${verifiedCount}/${totalConcepts}  |  Generated: ${new Date(
      unit.updatedAt
    ).toLocaleDateString()}`,
    marginX + 6,
    cursorY + 24
  );

  cursorY += 36;

  // --- TABLE OF CONTENTS ---
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  const tocHeight = 14 + unit.sections.length * 6.5 + (includeMcqs && unit.mcqs.length > 0 ? 6.5 : 0);
  ensureSpace(tocHeight + 6);
  doc.rect(marginX, cursorY, contentWidth, tocHeight, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(15, 23, 42);
  doc.text('TABLE OF CONTENTS', marginX + 5, cursorY + 7);

  let tocY = cursorY + 13.5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  unit.sections.forEach((sec, idx) => {
    doc.setTextColor(30, 41, 59);
    const secLabel = toPdfSafeText(`${idx + 1}. ${sec.heading.replace(/^\d+\.\s*/, '')}`);
    doc.text(secLabel.slice(0, 78), marginX + 5, tocY);
    doc.setTextColor(100, 116, 139);
    doc.text(`${sec.items.length} concept(s)`, pageWidth - marginX - 5, tocY, { align: 'right' });
    tocY += 6.5;
  });

  if (includeMcqs && unit.mcqs.length > 0) {
    doc.setTextColor(2, 132, 199);
    doc.text(
      `Practice Multiple-Choice Questions (${unit.mcqs.length} Source-Verified Items)`,
      marginX + 5,
      tocY
    );
  }

  cursorY += tocHeight + 10;

  // --- SECTIONS & CONCEPTS ---
  for (let sIdx = 0; sIdx < unit.sections.length; sIdx++) {
    const section = unit.sections[sIdx];
    ensureSpace(22);

    // Section Heading
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12.5);
    doc.setTextColor(15, 23, 42);
    const secHeadingLines = doc.splitTextToSize(toPdfSafeText(section.heading), contentWidth);
    doc.text(secHeadingLines, marginX, cursorY);
    cursorY += secHeadingLines.length * 5.5;

    if (section.subheading) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(9.5);
      doc.setTextColor(71, 85, 105);
      const subLines = doc.splitTextToSize(toPdfSafeText(section.subheading), contentWidth);
      doc.text(subLines, marginX, cursorY);
      cursorY += subLines.length * 4.5 + 2;
    }

    doc.setDrawColor(203, 213, 225);
    doc.line(marginX, cursorY, pageWidth - marginX, cursorY);
    cursorY += 6;

    for (const item of section.items) {
      ensureSpace(32);

      // Original Keyword Highlight Bar
      const isVerified = item.verificationStatus === 'VERIFIED';
      if (isVerified) {
        doc.setFillColor(224, 242, 254); // Sky-100 highlight for original keyword
      } else {
        doc.setFillColor(254, 243, 199); // Amber-100 for NEEDS_REVIEW
      }
      doc.rect(marginX, cursorY - 4, contentWidth, 8, 'F');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10.5);
      doc.setTextColor(isVerified ? 3 : 180, isVerified ? 105 : 83, isVerified ? 161 : 9);
      const kwText = toPdfSafeText(`KEYWORD: ${item.originalKeyword}`).slice(0, 68);
      doc.text(kwText, marginX + 3, cursorY + 1.2);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      const statusBadge = `${item.verificationStatus}  |  Source Page ${item.sourcePageReference}`;
      doc.text(statusBadge, pageWidth - marginX - 3, cursorY + 1.2, { align: 'right' });

      cursorY += 8.5;

      // Supporting Source Passage
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(8.8);
      doc.setTextColor(71, 85, 105);
      const sourceQuoteLines = doc.splitTextToSize(
        toPdfSafeText(`Source Note (Page ${item.sourcePageReference}): "${item.supportingSourcePassage}"`),
        contentWidth - 6
      );
      ensureSpace(sourceQuoteLines.length * 4.2 + 4);
      doc.text(sourceQuoteLines, marginX + 3, cursorY);
      cursorY += sourceQuoteLines.length * 4.2 + 2.5;

      // Generated Explanation
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(15, 23, 42);
      const expLines = doc.splitTextToSize(toPdfSafeText(item.generatedExplanation), contentWidth - 4);
      ensureSpace(expLines.length * 4.8 + 4);
      doc.text(expLines, marginX + 2, cursorY);
      cursorY += expLines.length * 4.8 + 3;

      // Uncertainty Notice if NEEDS_REVIEW
      if (item.verificationStatus === 'NEEDS_REVIEW' && item.uncertaintyReason) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(180, 83, 9);
        const flagLines = doc.splitTextToSize(
          toPdfSafeText(`Review Notice: ${item.uncertaintyReason}`),
          contentWidth - 6
        );
        ensureSpace(flagLines.length * 4.2 + 4);
        doc.text(flagLines, marginX + 3, cursorY);
        cursorY += flagLines.length * 4.2 + 3;
      }

      // Formulas and Step-by-Step Derivations
      if (item.formulasAndDerivations && item.formulasAndDerivations.length > 0) {
        const boxLinesCount = item.formulasAndDerivations.length * 2 + 1;
        const boxHeight = boxLinesCount * 4.6 + 6;
        ensureSpace(boxHeight + 4);

        doc.setFillColor(248, 250, 252);
        doc.setDrawColor(203, 213, 225);
        doc.rect(marginX + 2, cursorY - 2, contentWidth - 4, boxHeight, 'FD');

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(3, 105, 161);
        doc.text('FORMULAS & STEP-BY-STEP DERIVATION:', marginX + 5, cursorY + 3);
        cursorY += 7.5;

        for (const step of item.formulasAndDerivations) {
          doc.setFont('courier', 'bold');
          doc.setFontSize(9.5);
          doc.setTextColor(15, 23, 42);
          const exprLine = toPdfSafeText(`Step ${step.stepNumber}: ${step.expression}`);
          doc.text(exprLine.slice(0, 82), marginX + 6, cursorY);
          cursorY += 4.3;

          if (step.explanation) {
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(8.5);
            doc.setTextColor(71, 85, 105);
            doc.text(toPdfSafeText(`   ${step.explanation}`).slice(0, 92), marginX + 6, cursorY);
            cursorY += 4.5;
          }
        }
        cursorY += 4;
      }

      // Embedded Diagram Crop (if available)
      if (item.diagramRegion) {
        const diag = item.diagramRegion;
        ensureSpace(54);
        doc.setDrawColor(203, 213, 225);
        doc.setFillColor(252, 252, 253);
        doc.rect(marginX + 2, cursorY, contentWidth - 4, 48, 'FD');

        if (diag.croppedDataUrl && diag.croppedDataUrl.startsWith('data:image/')) {
          try {
            doc.addImage(diag.croppedDataUrl, 'PNG', marginX + 6, cursorY + 3, 76, 34);
          } catch {
            // Ignore image embed failure and rely on schematic caption + labels
          }
        }

        const textStartX = diag.croppedDataUrl ? marginX + 86 : marginX + 6;
        const textMaxW = diag.croppedDataUrl ? contentWidth - 92 : contentWidth - 12;

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(15, 23, 42);
        const capLines = doc.splitTextToSize(
          toPdfSafeText(`Diagram (Page ${diag.pageNumber}): ${diag.caption}`),
          textMaxW
        );
        doc.text(capLines, textStartX, cursorY + 8);

        if (diag.labels && diag.labels.length > 0) {
          doc.setFont('courier', 'normal');
          doc.setFontSize(8);
          doc.setTextColor(51, 65, 85);
          const lblLines = doc.splitTextToSize(
            toPdfSafeText(`Labels: ${diag.labels.join(' | ')}`),
            textMaxW
          );
          doc.text(lblLines, textStartX, cursorY + 8 + capLines.length * 4.5 + 2);
        }

        cursorY += 53;
      }

      cursorY += 4;
    }

    cursorY += 4;
  }

  // --- PRACTICE MCQs SECTION ---
  if (includeMcqs && unit.mcqs.length > 0) {
    ensureSpace(35);
    doc.setFillColor(240, 249, 255);
    doc.setDrawColor(186, 230, 253);
    doc.rect(marginX, cursorY, contentWidth, 10, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(3, 105, 161);
    doc.text(
      `SOURCE-VERIFIED PRACTICE MCQS (${unit.mcqs.length} QUESTIONS)`,
      marginX + 4,
      cursorY + 6.5
    );
    cursorY += 15;

    unit.mcqs.forEach((mcq, idx) => {
      const qLines = doc.splitTextToSize(
        toPdfSafeText(`Q${idx + 1}. ${mcq.question}`),
        contentWidth - 4
      );
      ensureSpace(qLines.length * 4.8 + 32);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.8);
      doc.setTextColor(15, 23, 42);
      doc.text(qLines, marginX, cursorY);
      cursorY += qLines.length * 4.8 + 1.5;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(51, 65, 85);
      const optLetters = ['A', 'B', 'C', 'D'];
      mcq.options.forEach((opt, oIdx) => {
        const optLines = doc.splitTextToSize(
          toPdfSafeText(`   (${optLetters[oIdx]}) ${opt}`),
          contentWidth - 10
        );
        ensureSpace(optLines.length * 4.2 + 2);
        doc.text(optLines, marginX + 2, cursorY);
        cursorY += optLines.length * 4.2 + 1;
      });

      const ansLines = doc.splitTextToSize(
        toPdfSafeText(
          `Answer: (${optLetters[mcq.correctIndex]}) — ${mcq.explanation} [Source Page ${mcq.sourcePageReference}: "${mcq.supportingSourcePassage}"]`
        ),
        contentWidth - 6
      );
      ensureSpace(ansLines.length * 4 + 4);
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(8.5);
      doc.setTextColor(5, 150, 105);
      doc.text(ansLines, marginX + 3, cursorY + 1);
      cursorY += ansLines.length * 4 + 6;
    });
  }

  // --- ADD PAGE NUMBERS & FOOTERS TO ALL PAGES ---
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setDrawColor(226, 232, 240);
    doc.line(marginX, pageHeight - 12, pageWidth - marginX, pageHeight - 12);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(
      toPdfSafeText(`${unit.subject} — Unit ${unit.unitNumber}: ${unit.unitTitle} (Source-Verified Study Material)`),
      marginX,
      pageHeight - 7.5
    );
    doc.text(`Page ${p} of ${totalPages}`, pageWidth - marginX, pageHeight - 7.5, {
      align: 'right',
    });
  }

  const safeFileName = `${unit.subject}_Unit_${unit.unitNumber}_${unit.unitTitle}`
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 60) + '.pdf';

  // Use explicit Blob + anchor download for maximum Android & desktop reliability
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
}
