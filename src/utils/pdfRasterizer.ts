import { SourcePage } from '../types';

/**
 * Optimizes an image data URL via canvas downscaling (max dimension 1600px, JPEG 85%)
 * to keep image payloads fast and well under Vercel serverless payload limits (4.5MB).
 */
export async function optimizeImageDataUrl(dataUrl: string, maxDimension: number = 1600): Promise<string> {
  // If it's a raw PDF dataUrl, do not process via Image
  if (dataUrl.startsWith('data:application/pdf')) {
    return dataUrl;
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;

      // Only downscale if the image exceeds max dimension
      if (width > maxDimension || height > maxDimension) {
        if (width > height) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        } else {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(dataUrl);
        return;
      }

      // Draw white background for clean JPEG compression
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);

      // Encode as JPEG with 85% quality (sharp text & formulas, 10x smaller size)
      const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.85);
      resolve(compressedDataUrl);
    };

    img.onerror = () => {
      // Fallback safely to original dataUrl if decoding fails
      resolve(dataUrl);
    };

    img.src = dataUrl;
  });
}

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
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

/**
 * Converts uploaded FileList / File[] (multiple images and/or multi-page PDFs)
 * into inspectable, optimized SourcePage items.
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
          const viewport = page.getViewport({ scale: 1.5 });
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            await page.render({ canvasContext: ctx, viewport, canvas } as any).promise;
            const pageDataUrl = canvas.toDataURL('image/jpeg', 0.85);
            results.push({
              pageNumber: pageCounter++,
              fileName: `${file.name} (Page ${p}/${pdfDoc.numPages})`,
              dataUrl: pageDataUrl,
              mimeType: 'image/jpeg',
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
      const rawDataUrl = await readFileAsDataUrl(file);
      const optimizedDataUrl = await optimizeImageDataUrl(rawDataUrl, 1600);
      results.push({
        pageNumber: pageCounter++,
        fileName: file.name,
        dataUrl: optimizedDataUrl,
        mimeType: 'image/jpeg',
        rawTranscript: '',
      });
    }
  }

  return results;
}
