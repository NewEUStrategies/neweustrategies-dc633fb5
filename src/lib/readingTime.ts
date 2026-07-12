// System czasu czytania wpisu - rdzeń obliczeń + warstwa ustawień CMS.
//
// Algorytm (Medium/Nielsen Norman Group):
//   minutes = words / wpm  +  images(curve)  +  codeWords / (wpm * codeFactor)
// gdzie:
//   - words: liczba słów tekstu (HTML/doc/blocks) - stripHTML + extractText
//   - wpm: prędkość czytania DLA JĘZYKA (PL i EN liczone niezależnie - polska
//     fleksja daje dłuższe słowa i ~220 wpm, angielski ~238 wpm),
//   - images: pierwsze N obrazów po `image_seconds_head` s, kolejne po
//     `image_seconds_tail` s (krzywa Medium),
//   - codeWords: słowa w <pre>/<code> czytane wolniej (mnożnik codeFactor).
//
// WSZYSTKIE parametry są sterowane z panelu /admin/reading-time i zapisywane w
// site_settings pod kluczem `reading_time` (schema + domyślne poniżej). Widok
// publiczny, JSON-LD, blok reading-time i podgląd w edytorze liczą przez ten
// sam rdzeń `computeReadingStats`, więc zmiana w panelu natychmiast rzutuje
// na wpisy. Ręczna wartość `posts.read_minutes` (pole w edytorze) działa jako
// świadomy override redakcji: null = automat.
import { z } from "zod";

// ---------------------------------------------------------------------------
// Ustawienia (site_settings["reading_time"])
// ---------------------------------------------------------------------------

export const READING_TIME_SETTINGS_KEY = "reading_time";

// Schemat jest STRICT (bez .default) - resolveSetting robi deepMerge(defaults,
// zapis) PRZED walidacją, więc braki uzupełniają domyślne poniżej, a schemat
// pilnuje wyłącznie zakresów. Dzięki temu input == output i pasuje do
// sygnatury useSiteSetting(ZodType<T>).
export const readingTimeSettingsSchema = z.object({
  /** Globalny włącznik: false ukrywa czas czytania na całej stronie publicznej. */
  enabled: z.boolean(),
  /** Słowa/min dla treści polskiej. */
  wpm_pl: z.number().int().min(60).max(1200),
  /** Słowa/min dla treści angielskiej. */
  wpm_en: z.number().int().min(60).max(1200),
  /** Minimalna pokazywana liczba minut. */
  min_minutes: z.number().int().min(0).max(10),
  /** Zaokrąglanie wyniku do pełnych minut. */
  rounding: z.enum(["round", "ceil", "floor"]),
  // --- Parametry zaawansowane (sekcja super admina) ---
  /** Sekundy na każdy z pierwszych `image_head_count` obrazów. */
  image_seconds_head: z.number().min(0).max(60),
  /** Sekundy na każdy kolejny obraz. */
  image_seconds_tail: z.number().min(0).max(60),
  /** Ile pierwszych obrazów liczy się po stawce "head". */
  image_head_count: z.number().int().min(0).max(50),
  /** Mnożnik prędkości dla bloków kodu (0.5 = czytany 2x wolniej). */
  code_wpm_factor: z.number().min(0.1).max(1),
});

export type ReadingTimeSettings = z.infer<typeof readingTimeSettingsSchema>;

// Stabilna referencja (useSiteSetting memoizuje po tożsamości `defaults`).
export const DEFAULT_READING_TIME_SETTINGS: ReadingTimeSettings = {
  enabled: true,
  wpm_pl: 220,
  wpm_en: 238,
  min_minutes: 1,
  rounding: "round",
  image_seconds_head: 12,
  image_seconds_tail: 3,
  image_head_count: 10,
  code_wpm_factor: 0.5,
};

export function wpmForLang(settings: ReadingTimeSettings, lang: string | undefined): number {
  return (lang ?? "pl").startsWith("en") ? settings.wpm_en : settings.wpm_pl;
}

// ---------------------------------------------------------------------------
// Ekstrakcja tekstu / obrazów ze źródeł treści
// ---------------------------------------------------------------------------

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
    return Object.values(node as Record<string, unknown>)
      .map(extractText)
      .join(" ");
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

/** Zlicza obrazy w HTML (<img>). */
function countHtmlImages(html: string): number {
  return html.match(/<img\b/gi)?.length ?? 0;
}

/** Zlicza obrazy w strukturze doc/blocks (heurystyka po polu type). */
function countDocImages(node: unknown, seen = new WeakSet<object>()): number {
  if (!node || typeof node !== "object") return 0;
  if (seen.has(node as object)) return 0;
  seen.add(node as object);
  if (Array.isArray(node)) return node.reduce<number>((a, n) => a + countDocImages(n, seen), 0);
  let total = 0;
  const rec = node as Record<string, unknown>;
  const type = typeof rec.type === "string" ? rec.type.toLowerCase() : "";
  if (type.includes("image") || type === "gallery" || type === "figure" || type === "cover") {
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

// ---------------------------------------------------------------------------
// Rdzeń obliczeń (pure, testowalny) - jedno źródło prawdy dla public/admin/SEO
// ---------------------------------------------------------------------------

export interface ReadingStats {
  minutes: number;
  words: number;
  images: number;
}

function applyRounding(value: number, mode: ReadingTimeSettings["rounding"]): number {
  if (mode === "ceil") return Math.ceil(value);
  if (mode === "floor") return Math.floor(value);
  return Math.round(value);
}

/**
 * Statystyki czytania JEDNEJ wersji językowej treści według przekazanych
 * ustawień. Zwraca też words/images, żeby panel admina pokazywał skład wyniku.
 */
export function computeReadingStats(
  sources: ReadingTimeSources,
  lang: string | undefined,
  settings: ReadingTimeSettings = DEFAULT_READING_TIME_SETTINGS,
): ReadingStats {
  const wpm = Math.max(60, wpmForLang(settings, lang));

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
      : countHtmlImages(html) +
        (sources.docs?.reduce<number>((a, d) => a + countDocImages(d), 0) ?? 0);

  const imageSeconds =
    Math.min(images, settings.image_head_count) * settings.image_seconds_head +
    Math.max(0, images - settings.image_head_count) * settings.image_seconds_tail;

  const codeWpm = Math.max(30, wpm * settings.code_wpm_factor);
  const raw = narrativeWords / wpm + codeWords / codeWpm + imageSeconds / 60;

  if (totalWords === 0 && images === 0) return { minutes: 0, words: 0, images: 0 };
  const minutes = Math.max(settings.min_minutes, applyRounding(raw, settings.rounding));
  return { minutes, words: totalWords, images };
}

export function computeReadingMinutes(
  sources: ReadingTimeSources,
  lang: string | undefined,
  settings: ReadingTimeSettings = DEFAULT_READING_TIME_SETTINGS,
): number {
  return computeReadingStats(sources, lang, settings).minutes;
}

/** Wynik dla OBU wersji językowych naraz (podglądy w adminie/edytorze). */
export function computeBilingualReadingStats(
  perLang: { pl: ReadingTimeSources; en: ReadingTimeSources },
  settings: ReadingTimeSettings = DEFAULT_READING_TIME_SETTINGS,
): { pl: ReadingStats; en: ReadingStats } {
  return {
    pl: computeReadingStats(perLang.pl, "pl", settings),
    en: computeReadingStats(perLang.en, "en", settings),
  };
}

/**
 * Efektywny czas czytania wpisu na powierzchni publicznej:
 *   - `enabled: false` w ustawieniach -> null (nie pokazujemy czasu w ogóle),
 *   - ręczny override redakcji (`posts.read_minutes` > 0) wygrywa nad automatem,
 *   - inaczej automat wg ustawień; brak treści -> null.
 */
export function resolveReadMinutes(args: {
  manual: number | null | undefined;
  sources: ReadingTimeSources;
  lang: string | undefined;
  settings: ReadingTimeSettings;
}): number | null {
  if (!args.settings.enabled) return null;
  if (typeof args.manual === "number" && args.manual > 0) return args.manual;
  const auto = computeReadingMinutes(args.sources, args.lang, args.settings);
  return auto > 0 ? auto : null;
}

// ---------------------------------------------------------------------------
// Zgodność wsteczna
// ---------------------------------------------------------------------------

export interface ReadingTimeOptions {
  /** Jawne wpm (nadpisuje język). */
  wpm?: number;
  /** "pl" | "en" - wybiera wpm domyślnych ustawień. */
  lang?: string;
}

/**
 * Stary interfejs (domyślne parametry). Nowy kod powinien używać
 * `computeReadingMinutes` z ustawieniami z site_settings.
 */
export function estimateReadingMinutes(
  sources: ReadingTimeSources,
  wpmOrOptions: number | ReadingTimeOptions = DEFAULT_READING_TIME_SETTINGS.wpm_pl,
): number {
  const opts: ReadingTimeOptions =
    typeof wpmOrOptions === "number" ? { wpm: wpmOrOptions } : wpmOrOptions;
  const settings: ReadingTimeSettings = opts.wpm
    ? { ...DEFAULT_READING_TIME_SETTINGS, wpm_pl: opts.wpm, wpm_en: opts.wpm }
    : DEFAULT_READING_TIME_SETTINGS;
  return computeReadingMinutes(sources, opts.lang ?? "pl", settings);
}
