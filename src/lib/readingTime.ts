// Realny estymator czasu czytania wpisu.
//
// Algorytm (Medium/Nielsen Norman Group):
//   minutes = words / wpm  +  images * imageSeconds/60  +  codeWords / codeWpm
// gdzie:
//   - words: liczba słów tekstu (HTML/doc/blocks) - stripHTML + extractText
//   - wpm: prędkość czytania dla języka (PL ~220, EN ~238)
//   - images: liczba obrazów w treści (<img>, figure blocks) -> 12s / 8s / 4s...
//     przybliżamy pierwsze 10 zdjęć jako 12s, kolejne 3s (curve Medium)
//   - codeWords: słowa w blokach <pre>/<code> - kod czyta się ~2x wolniej,
//     więc uwzględniamy je z wpm/2.
// Zwracamy zaokrągloną liczbę minut (min. 1 gdy content istnieje).
//
// Obsługuje: HTML, string oraz dowolne struktury JSON (builder/blocks doc)
// wyciągając tekst rekurencyjnie z pól typu string.

const DEFAULT_WPM = 220;
const IMAGE_SECONDS_HEAD = 12; // pierwsze 10 obrazów
const IMAGE_SECONDS_TAIL = 3; // każde kolejne
const IMAGE_HEAD_COUNT = 10;

export const WPM_BY_LANG: Readonly<Record<string, number>> = {
  pl: 220,
  en: 238,
};

function stripHtml(input: string): string {
  return input
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&[a-z0-9#]+;/gi, " ");
}

function extractText(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string") return node;
  if (typeof node === "number" || typeof node === "boolean") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join(" ");
  if (typeof node === "object") {
    return Object.values(node as Record<string, unknown>).map(extractText).join(" ");
  }
  return "";
}

/** Suma tekstu wewnątrz <pre>/<code> (liczone z inną prędkością). */
function extractCodeText(html: string): string {
  const chunks: string[] = [];
  const re = /<(pre|code)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) chunks.push(stripHtml(m[2] ?? ""));
  return chunks.join(" ");
}

/** Zlicza obrazy w HTML (<img>, <picture><source>, <figure> z data-image). */
function countHtmlImages(html: string): number {
  const imgs = html.match(/<img\b/gi)?.length ?? 0;
  return imgs;
}

/** Zlicza obrazy w strukturze doc/blocks (heurystyka po polach url/src/image). */
function countDocImages(node: unknown, seen = new WeakSet<object>()): number {
  if (!node || typeof node !== "object") return 0;
  if (seen.has(node as object)) return 0;
  seen.add(node as object);
  if (Array.isArray(node)) return node.reduce<number>((a, n) => a + countDocImages(n, seen), 0);
  let total = 0;
  const rec = node as Record<string, unknown>;
  const type = typeof rec.type === "string" ? rec.type.toLowerCase() : "";
  if (
    type.includes("image") ||
    type === "gallery" ||
    type === "figure" ||
    type === "cover"
  ) {
    total += 1;
  }
  for (const v of Object.values(rec)) total += countDocImages(v, seen);
  return total;
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export interface ReadingTimeSources {
  html?: string | null;
  docs?: ReadonlyArray<unknown>;
  extraText?: string | null;
  /** Nadpisz liczbę obrazów (jeśli znana z bazy). */
  images?: number;
}

export interface ReadingTimeOptions {
  /** Prędkość czytania (słowa/min). Domyślnie 220 (PL). */
  wpm?: number;
  /** Kod język: "pl" | "en" - ustawia bazowe wpm. */
  lang?: string;
}

export function estimateReadingMinutes(
  sources: ReadingTimeSources,
  wpmOrOptions: number | ReadingTimeOptions = DEFAULT_WPM,
): number {
  const opts: ReadingTimeOptions =
    typeof wpmOrOptions === "number" ? { wpm: wpmOrOptions } : wpmOrOptions;
  const langKey = (opts.lang ?? "").toLowerCase().slice(0, 2);
  const baseWpm = opts.wpm ?? WPM_BY_LANG[langKey] ?? DEFAULT_WPM;
  const wpmSafe = Math.max(60, baseWpm);

  const html = sources.html ?? "";
  const textParts: string[] = [];
  if (html) textParts.push(stripHtml(html));
  if (sources.docs) for (const d of sources.docs) textParts.push(extractText(d));
  if (sources.extraText) textParts.push(sources.extraText);

  const totalWords = countWords(textParts.join(" "));
  const codeWords = html ? countWords(extractCodeText(html)) : 0;
  // Tekst "narracyjny" = całość - kod (kod dodajemy osobno z wolniejszym wpm).
  const narrativeWords = Math.max(0, totalWords - codeWords);

  const images =
    typeof sources.images === "number" && sources.images >= 0
      ? sources.images
      : countHtmlImages(html) + (sources.docs?.reduce<number>((a, d) => a + countDocImages(d), 0) ?? 0);

  const imageSeconds =
    Math.min(images, IMAGE_HEAD_COUNT) * IMAGE_SECONDS_HEAD +
    Math.max(0, images - IMAGE_HEAD_COUNT) * IMAGE_SECONDS_TAIL;

  const minutes =
    narrativeWords / wpmSafe +
    codeWords / Math.max(30, wpmSafe / 2) +
    imageSeconds / 60;

  if (totalWords === 0 && images === 0) return 0;
  return Math.max(1, Math.round(minutes));
}
