/**
 * Crops a normalized [ymin, xmin, ymax, xmax] (0..1000) diagram region
 * from an uploaded source page image dataUrl.
 */
export async function cropDiagramFromPage(
  sourceDataUrl: string,
  box2d: [number, number, number, number]
): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const [ymin, xmin, ymax, xmax] = box2d;
      const sx = Math.max(0, Math.floor((xmin / 1000) * img.width));
      const sy = Math.max(0, Math.floor((ymin / 1000) * img.height));
      const sw = Math.max(80, Math.floor(((xmax - xmin) / 1000) * img.width));
      const sh = Math.max(60, Math.floor(((ymax - ymin) / 1000) * img.height));

      const canvas = document.createElement('canvas');
      canvas.width = sw;
      canvas.height = sh;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(sourceDataUrl);
        return;
      }
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => resolve(sourceDataUrl);
    img.src = sourceDataUrl;
  });
}
