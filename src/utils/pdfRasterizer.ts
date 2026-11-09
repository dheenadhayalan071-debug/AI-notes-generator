import { SourcePage } from '../types';

/**
 * Reads an image file into a data URL
 */
function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
    reader.readAsDataURL(file);
  });
}

/**
 * Reads a file as an ArrayBuffer
 */
function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new Error(`Failed to read PDF buffer: ${file.name}`));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Rotates an image data URL by 90 degrees clockwise
 */
export async function rotateImageDataUrl(dataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.height;
      canvas.height = img.width;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

/**
 * Converts uploaded FileList / File[] (multiple images and/or multi-page PDFs)
 * into inspectable SourcePage items.
 */
export async function processUploadedFilesToSourcePages(
  files: File[],
  startingPageNumber: number
): Promise<SourcePage[]> {
  const results: SourcePage[] = [];
  let pageCounter = startingPageNumber;

  for (const file of files) {
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

    if (isPdf) {
      try {
        const pdfjsLib = await import('pdfjs-dist');
        // Configure PDF.js worker via CDN or fallback
        if (pdfjsLib.GlobalWorkerOptions && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
          pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
        }

        const arrayBuffer = await readFileAsArrayBuffer(file);
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        const pdfDoc = await loadingTask.promise;

        for (let p = 1; p <= pdfDoc.numPages; p++) {
          const page = await pdfDoc.getPage(p);
          const viewport = page.getViewport({ scale: 1.75 });
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            await page.render({ canvasContext: ctx, viewport, canvas } as any).promise;
            const pageDataUrl = canvas.toDataURL('image/png');
            results.push({
              pageNumber: pageCounter++,
              fileName: `${file.name} (Page ${p}/${pdfDoc.numPages})`,
              dataUrl: pageDataUrl,
              mimeType: 'image/png',
              rawTranscript: '',
            });
          }
        }
      } catch (err) {
        console.warn('Client-side PDF rasterization fallback to raw PDF data URL:', err);
        // Fallback: send raw PDF dataUrl directly to Gemini Vision (which natively accepts application/pdf)
        const pdfDataUrl = await readFileAsDataUrl(file);
        results.push({
          pageNumber: pageCounter++,
          fileName: file.name,
          dataUrl: pdfDataUrl,
          mimeType: 'application/pdf',
          rawTranscript: '',
        });
      }
    } else {
      const dataUrl = await readFileAsDataUrl(file);
      results.push({
        pageNumber: pageCounter++,
        fileName: file.name,
        dataUrl,
        mimeType: file.type || 'image/png',
        rawTranscript: '',
      });
    }
  }

  return results;
}
