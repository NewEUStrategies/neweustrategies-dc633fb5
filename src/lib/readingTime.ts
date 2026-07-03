// Szacowanie czasu czytania materiału na bazie liczby słów.
// Standard: 200-230 wpm dla tekstu ciągłego (PL/EN) - używamy 220.
// Obsługuje HTML, string oraz dowolne struktury JSON (builder/blocks doc)
// wyciągając tekst rekurencyjnie z pól typu string.

const DEFAULT_WPM = 220;

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

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export interface ReadingTimeSources {
  html?: string | null;
  docs?: ReadonlyArray<unknown>;
  extraText?: string | null;
}

export function estimateReadingMinutes(
  sources: ReadingTimeSources,
  wpm: number = DEFAULT_WPM,
): number {
  const parts: string[] = [];
  if (sources.html) parts.push(stripHtml(sources.html));
  if (sources.docs) for (const d of sources.docs) parts.push(extractText(d));
  if (sources.extraText) parts.push(sources.extraText);
  const words = countWords(parts.join(" "));
  if (!words) return 0;
  const wpmSafe = Math.max(60, wpm);
  return Math.max(1, Math.round(words / wpmSafe));
}
