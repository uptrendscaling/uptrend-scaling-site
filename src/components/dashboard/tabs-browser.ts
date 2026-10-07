// Browser-only helpers for the dashboard tabs: saving a file, copying text
// and turning the QR image into a PNG. Everything here runs in response to a
// click, never during rendering, so it is safe with server rendering.

import { svgWithSize } from "./tabs-format";

// Hands a file to the browser's download. The temporary link is removed
// again, and the blob address is released a little later (right away can
// cancel the download in some browsers).
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function downloadText(
  text: string,
  fileName: string,
  mimeType: string,
): void {
  downloadBlob(new Blob([text], { type: mimeType }), fileName);
}

// Copies text to the clipboard. The modern way only works on secure pages and
// can be refused, so the fallback selects the text in the given input and
// uses the old copy command. Returns false when nothing could be copied; the
// text is then left selected so the person can press Ctrl+C themselves.
export async function copyText(
  text: string,
  input: HTMLInputElement | null,
): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the selection method.
  }
  if (!input) return false;
  try {
    input.focus();
    input.select();
    input.setSelectionRange(0, text.length);
    return document.execCommand("copy");
  } catch {
    return false;
  }
}

// Draws the QR image onto a white square canvas of `pixels` by `pixels` and
// returns it as a PNG. The SVG is sized explicitly first because a canvas
// cannot draw an SVG that has no width and height.
export function svgToPngBlob(svg: string, pixels = 1024): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(
      new Blob([svgWithSize(svg, pixels)], {
        type: "image/svg+xml;charset=utf-8",
      }),
    );
    const image = new Image();
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = pixels;
        canvas.height = pixels;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("This browser cannot draw the image.");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, pixels, pixels);
        context.drawImage(image, 0, 0, pixels, pixels);
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error("The PNG could not be created."));
        }, "image/png");
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("The QR image could not be drawn."));
    };
    image.src = url;
  });
}
