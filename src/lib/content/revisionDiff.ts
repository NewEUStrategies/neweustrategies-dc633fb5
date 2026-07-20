// Wizualny diff rewizji (P2 z OCENA_MODULOW_2026-07-20 §1.5): czysta logika
// porównania dwóch snapshotów content_revisions - bez zależności (własny LCS
// liniowy), bez Reacta, unit-testowalna. UI (RevisionDiffDialog) tylko
// renderuje wynik.
//
// Snapshot przechowuje pola z REVISION_FIELDS (lib/content/revisions.ts).
// Treść zależy od silnika (contentEngine): blocks_data / builder_data to
// dokumenty JSON, content_pl/en to HTML - wszystkie normalizujemy do
// czytelnych LINII tekstu i diffujemy liniowo; pola skalarne porównujemy
// jako przed → po.

export interface DiffLine {
  kind: "same" | "added" | "removed";
  text: string;
}

export interface FieldDiff {
  /** Klucz pola snapshotu (np. title_pl, blocks_data:pl). */
  field: string;
  /** Etykieta i18n: adminPostPanes.revisionDiff.fields.<labelKey>. */
  labelKey: string;
  kind: "scalar" | "text";
  before?: string;
  after?: string;
  lines?: DiffLine[];
}

// ---------------------------------------------------------------------------
// LCS diff liniowy. Rozmiar wejścia jest ograniczany (MAX_LINES), żeby
// patologicznie długa treść nie zbudowała macierzy O(n*m) na gigabajty.
const MAX_LINES = 800;

export function diffLines(a: string[], b: string[]): DiffLine[] {
  const aa = a.slice(0, MAX_LINES);
  const bb = b.slice(0, MAX_LINES);
  const n = aa.length;
  const m = bb.length;
  // dp[i][j] = długość LCS sufiksów aa[i:], bb[j:]
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = aa[i] === bb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (aa[i] === bb[j]) {
      out.push({ kind: "same", text: aa[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ kind: "removed", text: aa[i] });
      i++;
    } else {
      out.push({ kind: "added", text: bb[j] });
      j++;
    }
  }
  while (i < n) out.push({ kind: "removed", text: aa[i++] });
  while (j < m) out.push({ kind: "added", text: bb[j++] });
  return out;
}

/** Zwija ciągi niezmienionych linii do kontekstu wokół zmian (jak git diff). */
export function collapseContext(lines: DiffLine[], context = 2): (DiffLine | { gap: number })[] {
  const keep = new Array<boolean>(lines.length).fill(false);
  lines.forEach((l, idx) => {
    if (l.kind === "same") return;
    for (let k = Math.max(0, idx - context); k <= Math.min(lines.length - 1, idx + context); k++) {
      keep[k] = true;
    }
  });
  const out: (DiffLine | { gap: number })[] = [];
  let gap = 0;
  lines.forEach((l, idx) => {
    if (keep[idx]) {
      if (gap > 0) {
        out.push({ gap });
        gap = 0;
      }
      out.push(l);
    } else {
      gap++;
    }
  });
  if (gap > 0) out.push({ gap });
  return out;
}

// ---------------------------------------------------------------------------
// Normalizacja treści do linii tekstu.

function stripHtmlToLines(html: string): string[] {
  const blockBreaks = html
    .replace(/<\s*(\/p|\/h[1-6]|\/li|\/blockquote|\/tr|\/div|br\s*\/?)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return blockBreaks
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 0);
}

// Klucze niosące tekst w dokumentach JSON (bloki + builder). Reszta (id,
// type, url, kolory, style) to szum dla porównania treści.
const TEXTY_KEY =
  /(^|_)(text|html|title|subtitle|label|caption|quote|content|body|description|heading|excerpt|cta|name|question|answer|items?)(_pl|_en)?$/i;

function collectDocLines(node: unknown, into: string[], seen = new WeakSet<object>()): void {
  if (into.length >= MAX_LINES) return;
  if (typeof node === "string") return;
  if (Array.isArray(node)) {
    for (const child of node) collectDocLines(child, into, seen);
    return;
  }
  if (!node || typeof node !== "object") return;
  if (seen.has(node as object)) return;
  seen.add(node as object);
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (typeof value === "string") {
      if (TEXTY_KEY.test(key) && value.trim().length > 0) {
        if (/[<>]/.test(value)) into.push(...stripHtmlToLines(value));
        else {
          const cleaned = value.replace(/\s+/g, " ").trim();
          if (cleaned) into.push(cleaned);
        }
      }
    } else {
      collectDocLines(value, into, seen);
    }
  }
}

export function docToLines(doc: unknown): string[] {
  const lines: string[] = [];
  collectDocLines(doc, lines);
  return lines;
}

// ---------------------------------------------------------------------------
// Porównanie snapshotów pole po polu.

type Snapshot = Record<string, unknown>;

function asString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v, null, 1) ?? "";
  } catch {
    return String(v);
  }
}

const SCALAR_FIELDS: Array<{ field: string; labelKey: string }> = [
  { field: "title_pl", labelKey: "titlePl" },
  { field: "title_en", labelKey: "titleEn" },
  { field: "excerpt_pl", labelKey: "excerptPl" },
  { field: "excerpt_en", labelKey: "excerptEn" },
  { field: "status", labelKey: "status" },
  { field: "editor", labelKey: "editor" },
  { field: "post_format", labelKey: "postFormat" },
  { field: "cover_image_url", labelKey: "cover" },
  { field: "read_minutes", labelKey: "readMinutes" },
  { field: "takeaways_variant", labelKey: "takeawaysVariant" },
];

const JSON_FIELDS: Array<{ field: string; labelKey: string }> = [
  { field: "takeaways_pl", labelKey: "takeawaysPl" },
  { field: "takeaways_en", labelKey: "takeawaysEn" },
  { field: "layout_overrides", labelKey: "layoutOverrides" },
  { field: "custom_meta", labelKey: "customMeta" },
  { field: "related_override", labelKey: "relatedOverride" },
];

function contentLines(snapshot: Snapshot, lang: "pl" | "en"): string[] {
  // Jeden wpis może zmieniać silnik między rewizjami - porównujemy
  // ZNORMALIZOWANY tekst treści niezależnie od silnika: bloki + builder +
  // HTML sklejone w tej kolejności (najwyżej jedno z nich jest niepuste
  // dla danego silnika, ale rewizje przejściowe bywają hybrydą).
  const lines: string[] = [];
  const blocks = snapshot.blocks_data as Record<string, unknown> | null | undefined;
  if (blocks && typeof blocks === "object") {
    const langDoc = (blocks as Record<string, unknown>)[lang];
    if (langDoc) lines.push(...docToLines(langDoc));
  }
  if (lang === "pl" && snapshot.builder_data) lines.push(...docToLines(snapshot.builder_data));
  const html = snapshot[`content_${lang}`];
  if (typeof html === "string" && html.trim()) lines.push(...stripHtmlToLines(html));
  return lines;
}

/** Pełny diff dwóch snapshotów: tylko pola, w których jest różnica. */
export function diffRevisionSnapshots(before: Snapshot, after: Snapshot): FieldDiff[] {
  const out: FieldDiff[] = [];

  for (const { field, labelKey } of SCALAR_FIELDS) {
    const a = asString(before[field]);
    const b = asString(after[field]);
    if (a !== b) out.push({ field, labelKey, kind: "scalar", before: a, after: b });
  }

  for (const { field, labelKey } of JSON_FIELDS) {
    const a = asString(before[field]);
    const b = asString(after[field]);
    if (a !== b) {
      out.push({
        field,
        labelKey,
        kind: "text",
        lines: diffLines(a.split("\n"), b.split("\n")),
      });
    }
  }

  for (const lang of ["pl", "en"] as const) {
    const a = contentLines(before, lang);
    const b = contentLines(after, lang);
    if (a.join("\n") !== b.join("\n")) {
      out.push({
        field: `content:${lang}`,
        labelKey: lang === "pl" ? "contentPl" : "contentEn",
        kind: "text",
        lines: diffLines(a, b),
      });
    }
  }

  return out;
}
