// Utility for producing a cropped/rotated blob from a source image using an
// off-screen canvas. Fed by react-easy-crop's `croppedAreaPixels` payload.
// Output is rescaled to `targetWidth × targetHeight` for consistent storage.

export interface CropArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image load failed"));
    img.src = src;
  });
}

const toRad = (deg: number) => (deg * Math.PI) / 180;

/**
 * Return a Blob containing the cropped/rotated region, rescaled to
 * (targetWidth, targetHeight). Uses a two-canvas approach:
 *  1) rotate the source into a "safe" canvas large enough to hold any rotation
 *  2) draw the crop area, then downscale to the target dimensions
 */
export async function getCroppedBlob(
  imageSrc: string,
  crop: CropArea,
  rotationDeg: number,
  targetWidth: number,
  targetHeight: number,
  mimeType: string = "image/jpeg",
  quality: number = 0.92,
): Promise<Blob> {
  const image = await loadImage(imageSrc);
  const rad = toRad(rotationDeg);

  // Bounding box that fits any rotation of the source image
  const bBoxWidth =
    Math.abs(Math.cos(rad) * image.width) + Math.abs(Math.sin(rad) * image.height);
  const bBoxHeight =
    Math.abs(Math.sin(rad) * image.width) + Math.abs(Math.cos(rad) * image.height);

  const rotCanvas = document.createElement("canvas");
  rotCanvas.width = bBoxWidth;
  rotCanvas.height = bBoxHeight;
  const rotCtx = rotCanvas.getContext("2d");
  if (!rotCtx) throw new Error("no 2d ctx");

  rotCtx.translate(bBoxWidth / 2, bBoxHeight / 2);
  rotCtx.rotate(rad);
  rotCtx.drawImage(image, -image.width / 2, -image.height / 2);

  // Crop region is expressed in source-image coordinates AFTER rotation
  // (that's what react-easy-crop returns as croppedAreaPixels).
  const out = document.createElement("canvas");
  out.width = targetWidth;
  out.height = targetHeight;
  const outCtx = out.getContext("2d");
  if (!outCtx) throw new Error("no 2d ctx");
  outCtx.imageSmoothingEnabled = true;
  outCtx.imageSmoothingQuality = "high";
  outCtx.drawImage(
    rotCanvas,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    targetWidth,
    targetHeight,
  );

  return await new Promise<Blob>((resolve, reject) => {
    out.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
      mimeType,
      quality,
    );
  });
}

/**
 * Read a File into a data URL (safe for cross-origin cropping since it's
 * inline, no CORS gotchas).
 */
export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("read failed"));
    r.readAsDataURL(file);
  });
}

/**
 * Load an image and return its natural dimensions. Used to detect wildly
 * off-ratio uploads and warn the user before opening the cropper.
 */
export async function getImageDimensions(
  src: string,
): Promise<{ width: number; height: number }> {
  const img = await loadImage(src);
  return { width: img.naturalWidth, height: img.naturalHeight };
}
