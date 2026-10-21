// Shrinks a picture in the browser before it is uploaded, so a phone photo of
// several megabytes becomes a few hundred kilobytes. Browser-only.

export type ShrunkImage = { mime: "image/jpeg" | "image/png"; data: string };

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file is not a picture we can read."));
    };
    img.src = url;
  });
}

function toBase64(
  canvas: HTMLCanvasElement,
  mime: string,
  quality: number,
): string {
  const url = canvas.toDataURL(mime, quality);
  return url.slice(url.indexOf(",") + 1);
}

const LIMIT = 1_000_000; // base64 characters the server accepts, with margin

// kind "logo" keeps transparency (PNG) when it fits; photos become JPEG.
export async function shrinkImage(
  file: File,
  kind: "logo" | "photo",
): Promise<ShrunkImage> {
  if (!file.type.startsWith("image/"))
    throw new Error("Please choose a picture file.");
  const img = await loadImage(file);
  let maxSide = kind === "logo" ? 700 : 1500;
  for (let attempt = 0; attempt < 5; attempt++) {
    const scale = Math.min(
      1,
      maxSide / Math.max(img.naturalWidth, img.naturalHeight),
    );
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Your browser could not process that picture.");
    if (kind === "photo") {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
    }
    ctx.drawImage(img, 0, 0, w, h);
    if (kind === "logo") {
      const png = toBase64(canvas, "image/png", 1);
      if (png.length <= LIMIT) return { mime: "image/png", data: png };
    }
    for (const q of [0.84, 0.72, 0.6]) {
      const jpg = toBase64(canvas, "image/jpeg", q);
      if (jpg.length <= LIMIT) return { mime: "image/jpeg", data: jpg };
    }
    maxSide = Math.round(maxSide * 0.75);
  }
  throw new Error("That picture is too large. Try a smaller one.");
}
