// Walidacja i optymalizacja obrazków karty społecznościowej (og:image).
//
// Podział na czystą część kontraktową (typy MIME, wymiary, plan kompresji) i
// cienką warstwę przeglądarkową (`prepareOgImageFile`), żeby regułę 1200x630
// dało się testować bez DOM-u, a admin dostawał gotowy, skompresowany plik.

export const OG_TARGET_WIDTH = 1200;
export const OG_TARGET_HEIGHT = 630;
export const OG_TARGET_RATIO = OG_TARGET_WIDTH / OG_TARGET_HEIGHT;

/** Formaty, które scrapery (Facebook, LinkedIn, X, Slack) czytają bez problemu. */
export const OG_ACCEPTED_MIME = ["image/jpeg", "image/png", "image/webp"] as const;
/** Formaty czytelne dla przeglądarki, ale ryzykowne dla scraperów - konwertujemy. */
export const OG_CONVERTIBLE_MIME = ["image/avif", "image/gif", "image/bmp"] as const;

/** Docelowy sufit wagi pliku po kompresji (bajty). */
export const OG_MAX_BYTES = 300 * 1024;

export type OgIssueCode =
  | "mime_unsupported"
  | "mime_converted"
  | "dimensions_mismatch"
  | "dimensions_too_small"
  | "dimensions_downscaled"
  | "file_too_large";

export interface OgIssue {
  code: OgIssueCode;
  severity: "error" | "warning";
  params?: Record<string, string | number>;
}

const isAccepted = (mime: string) =>
  (OG_ACCEPTED_MIME as readonly string[]).includes(mime.toLowerCase());
const isConvertible = (mime: string) =>
  (OG_CONVERTIBLE_MIME as readonly string[]).includes(mime.toLowerCase());

/** Sprawdza typ MIME: akceptowany, wymagający konwersji albo odrzucony. */
export function checkOgMime(mime: string): OgIssue | null {
  if (isAccepted(mime)) return null;
  if (isConvertible(mime))
    return { code: "mime_converted", severity: "warning", params: { mime } };
  return { code: "mime_unsupported", severity: "error", params: { mime: mime || "?" } };
}

/**
 * Reguła 1200x630: proporcja musi się zgadzać (tolerancja 1%), a obrazek nie
 * może być mniejszy niż karta docelowa. Większy, ale proporcjonalny plik jest
 * dopuszczony i skalowany w dół.
 */
export function checkOgDimensions(width: number, height: number): OgIssue | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0)
    return { code: "dimensions_mismatch", severity: "error", params: { width, height } };
  const ratio = width / height;
  if (Math.abs(ratio - OG_TARGET_RATIO) / OG_TARGET_RATIO > 0.01)
    return { code: "dimensions_mismatch", severity: "error", params: { width, height } };
  if (width < OG_TARGET_WIDTH || height < OG_TARGET_HEIGHT)
    return { code: "dimensions_too_small", severity: "error", params: { width, height } };
  if (width > OG_TARGET_WIDTH)
    return { code: "dimensions_downscaled", severity: "warning", params: { width, height } };
  return null;
}

export interface OgCompressionPlan {
  width: number;
  height: number;
  /** Docelowy MIME wyjścia - zawsze bezpieczny dla scraperów. */
  mime: "image/jpeg" | "image/png";
  /** Kolejne jakości JPEG próbowane aż plik zmieści się w limicie. */
  qualities: number[];
}

/** Deterministyczny plan skalowania i kompresji dla danego wejścia. */
export function planOgCompression(
  width: number,
  height: number,
  bytes: number,
  hasAlpha = false,
): OgCompressionPlan {
  const scale = width > OG_TARGET_WIDTH ? OG_TARGET_WIDTH / width : 1;
  const mime: OgCompressionPlan["mime"] = hasAlpha ? "image/png" : "image/jpeg";
  const heavy = bytes > OG_MAX_BYTES * 2;
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
    mime,
    qualities: mime === "image/png" ? [1] : heavy ? [0.82, 0.72, 0.62] : [0.86, 0.76, 0.66],
  };
}

export interface OgPreparedFile {
  file: File;
  issues: OgIssue[];
  /** Waga przed i po optymalizacji - do komunikatu w adminie. */
  bytesBefore: number;
  bytesAfter: number;
}

export interface OgRejection {
  file: null;
  issues: OgIssue[];
  bytesBefore: number;
  bytesAfter: 0;
}

export type OgPrepareResult = OgPreparedFile | OgRejection;

const decode = async (file: File): Promise<{ width: number; height: number; bitmap: ImageBitmap }> => {
  const bitmap = await createImageBitmap(file);
  return { width: bitmap.width, height: bitmap.height, bitmap };
};

const toBlob = (canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob | null> =>
  new Promise((resolve) => canvas.toBlob((b) => resolve(b), mime, quality));

/**
 * Waliduje wymiary/typ i zwraca skompresowany plik gotowy do uploadu.
 * Przy błędzie zwraca `file: null` i listę problemów do pokazania w UI.
 */
export async function prepareOgImageFile(file: File): Promise<OgPrepareResult> {
  const issues: OgIssue[] = [];
  const mimeIssue = checkOgMime(file.type);
  if (mimeIssue) {
    if (mimeIssue.severity === "error")
      return { file: null, issues: [mimeIssue], bytesBefore: file.size, bytesAfter: 0 };
    issues.push(mimeIssue);
  }

  let width = 0;
  let height = 0;
  let bitmap: ImageBitmap | null = null;
  try {
    const decoded = await decode(file);
    width = decoded.width;
    height = decoded.height;
    bitmap = decoded.bitmap;
  } catch {
    return {
      file: null,
      issues: [{ code: "dimensions_mismatch", severity: "error", params: { width: 0, height: 0 } }],
      bytesBefore: file.size,
      bytesAfter: 0,
    };
  }

  const dimIssue = checkOgDimensions(width, height);
  if (dimIssue) {
    if (dimIssue.severity === "error") {
      bitmap.close?.();
      return { file: null, issues: [...issues, dimIssue], bytesBefore: file.size, bytesAfter: 0 };
    }
    issues.push(dimIssue);
  }

  const hasAlpha = file.type.toLowerCase() === "image/png";
  const plan = planOgCompression(width, height, file.size, hasAlpha);
  const canvas = document.createElement("canvas");
  canvas.width = plan.width;
  canvas.height = plan.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close?.();
    return { file, issues, bytesBefore: file.size, bytesAfter: file.size };
  }
  ctx.drawImage(bitmap, 0, 0, plan.width, plan.height);
  bitmap.close?.();

  let best: Blob | null = null;
  for (const quality of plan.qualities) {
    const blob = await toBlob(canvas, plan.mime, quality);
    if (!blob) continue;
    best = blob;
    if (blob.size <= OG_MAX_BYTES) break;
  }
  if (!best || best.size >= file.size) {
    if (file.size > OG_MAX_BYTES)
      issues.push({ code: "file_too_large", severity: "warning", params: { bytes: file.size } });
    return { file, issues, bytesBefore: file.size, bytesAfter: file.size };
  }

  const ext = plan.mime === "image/png" ? "png" : "jpg";
  const base = file.name.replace(/\.[^.]+$/, "") || "og-card";
  const optimized = new File([best], `${base}.${ext}`, { type: plan.mime });
  if (optimized.size > OG_MAX_BYTES)
    issues.push({ code: "file_too_large", severity: "warning", params: { bytes: optimized.size } });
  return { file: optimized, issues, bytesBefore: file.size, bytesAfter: optimized.size };
}
