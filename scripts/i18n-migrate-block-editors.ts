#!/usr/bin/env bun
// Mechanical i18n migration for src/components/admin/blocks/edit/*.tsx.
// - Adds `import { useBlocksI18n } from "@/lib/blocks/i18n";` if needed.
// - Injects `const i18n = useBlocksI18n();` at the top of each exported function component body (only when at least one replacement applies).
// - Maps known hardcoded PL placeholders/labels to i18n.field/ui/editor calls.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DIR = "src/components/admin/blocks/edit";

// Map: literal PL string -> i18n call expression.
const STR_MAP: Record<string, string> = {
  // Common fields
  "URL obrazu…": 'i18n.field("imageUrl")',
  "URL obrazu": 'i18n.field("imageUrl")',
  "Tekst alt": 'i18n.field("alt")',
  "URL linku (opcjonalnie)": 'i18n.field("href")',
  "Podpis (opcjonalnie)": 'i18n.field("captionPh")',
  "https://...": 'i18n.field("urlPh")',
  "https://…": 'i18n.field("urlPh")',
  Tytuł: 'i18n.field("title")',
  "Podtytuł / opis": 'i18n.field("subtitlePh")',
  Opis: 'i18n.field("description")',
  Nagłówek: 'i18n.field("title")',
  "URL obrazu tła (opcjonalnie)": 'i18n.field("coverUrl")',
  "Eyebrow (mała etykieta nad tytułem)": 'i18n.field("eyebrow")',
  "CTA: etykieta": 'i18n.field("ctaLabel")',
  "CTA: URL": 'i18n.field("ctaUrl")',
  "Sekundarne CTA: etykieta": 'i18n.field("secondaryCtaLabel")',
  "Sekundarne CTA: URL": 'i18n.field("secondaryCtaUrl")',
  Etykieta: 'i18n.field("label")',
  // Editor-specific
  "Cytat do udostępnienia na X (max ~280 znaków)": 'i18n.editor("xquote","textPh")',
  "via @handle (bez @)": 'i18n.field("via")',
  "Hashtagi (oddzielone przecinkiem)": 'i18n.field("hashtags")',
  "Tekst callout…": 'i18n.editor("callout","textPh")',
  "URL pliku wideo (.mp4, .webm)…": 'i18n.editor("video","urlPh")',
  "Bieżący miesiąc": 'i18n.editor("calendar","monthPh")',
  "Wpisz wiersz / poezję…": 'i18n.editor("verse","textPh")',
  "https://www.youtube.com/watch?v=…  •  https://vimeo.com/…  •  https://x.com/…":
    'i18n.editor("embed","urlPh")',
  "Treść obok mediów…": 'i18n.editor("mediaText","contentPh") || "Treść obok mediów…"',
  "Tytuł rozwijanego elementu…": 'i18n.editor("details","summaryPh")',
  "Treść ukryta pod tytułem…": 'i18n.editor("details","contentPh")',
  "Treść cytatu…": 'i18n.editor("quote","textPh")',
  "- Autor (opcjonalnie)": 'i18n.editor("quote","citePh")',
  "Wyróżniony cytat…": 'i18n.editor("pullquote","textPh")',
  "— źródło / autor": 'i18n.editor("pullquote","citePh")',
  "Tytuł / podgląd (kliknij aby rozwinąć)": 'i18n.editor("spoiler","summaryPh")',
  "Ukryta treść (HTML)": 'i18n.editor("spoiler","hiddenHtmlPh")',
  "Tytuł (np. Zapisz się do newslettera)": 'i18n.editor("newsletter","titlePh")',
  "Placeholder (np. Szukaj...)": 'i18n.editor("searchWidget","placeholderPh")',
  "Etykieta przycisku (np. Szukaj)": 'i18n.editor("searchWidget","buttonLabelPh")',
  "Akcja (np. /search)": 'i18n.editor("searchWidget","actionPh")',
  "Tytuł (np. Spis treści)": 'i18n.editor("toc","titlePh")',
  "Wstępnie sformatowany tekst (zachowuje spacje i nowe linie)…":
    'i18n.editor("preformatted","textPh")',
};

// JSX text nodes (between > and <) — common labels.
const TEXT_MAP: Record<string, string> = {
  "Pozycja mediów:": '{i18n.editor("mediaText","mediaPosition")}:',
  Lewa: '{i18n.editor("mediaText","left")}',
  Prawa: '{i18n.editor("mediaText","right")}',
  "Podział strony": '{i18n.editor("pageBreak","label")}',
  "Newsletter (inline)": '{i18n.editor("newsletter","title")}',
  Karta: '{i18n.editor("newsletter","variantCard")}',
  "Inline (1 linia)": '{i18n.editor("newsletter","variantInline")}',
  Spoiler: '{i18n.editor("spoiler","title")}',
  "Otwarty domyślnie": '{i18n.ui("defaultOpen")}',
  "Wysokość:": '{i18n.editor("spacer","heightLabel")}',
  "X Quote / Click-to-Tweet": '{i18n.editor("xquote","title")}',
  "Spis treści": '{i18n.editor("toc","title")}',
  Numerowana: '{i18n.editor("toc","ordered")}',
  "Sticky (sidebar)": '{i18n.editor("toc","sticky")}',
  Search: '{i18n.editor("searchWidget","title")}',
  "Tag Cloud": '{i18n.editor("tagCloud","title")}',
  "Pokaż liczbę wpisów": '{i18n.ui("showCount")}',
};

let totalFiles = 0;
let modifiedFiles = 0;
const skipped: string[] = [];

const files = readdirSync(DIR).filter((f) => f.endsWith(".tsx"));
for (const file of files) {
  totalFiles++;
  const path = join(DIR, file);
  let src = readFileSync(path, "utf8");
  const original = src;

  let touched = false;

  // 1) String replacements inside attributes/expressions: placeholder="X" / title="X" / value="X" (when value is literal label) / text strings inside other JSX
  for (const [needle, replacement] of Object.entries(STR_MAP)) {
    const reAttr = new RegExp(`(placeholder|title|aria-label)="${escapeRegex(needle)}"`, "g");
    src = src.replace(reAttr, (_m, attr) => {
      touched = true;
      return `${attr}={${replacement}}`;
    });
  }

  // 2) JSX text nodes between tags (>Foo<).
  for (const [needle, replacement] of Object.entries(TEXT_MAP)) {
    const reText = new RegExp(`>${escapeRegex(needle)}<`, "g");
    src = src.replace(reText, () => {
      touched = true;
      return `>${replacement}<`;
    });
  }

  if (!touched) {
    skipped.push(file);
    continue;
  }

  // 3) Add import if missing.
  if (!src.includes('from "@/lib/blocks/i18n"')) {
    // place after the last existing import block
    const importBlockMatch = src.match(/^(import[^\n]*\n)+/m);
    const importLine = `import { useBlocksI18n } from "@/lib/blocks/i18n";\n`;
    if (importBlockMatch) {
      src =
        src.slice(0, importBlockMatch[0].length) +
        importLine +
        src.slice(importBlockMatch[0].length);
    } else {
      src = importLine + src;
    }
  }

  // 4) Inject `const i18n = useBlocksI18n();` at the top of each exported function component body that doesn't already have it.
  src = src.replace(
    /export function (\w+)\(([^)]*)\)\s*(?::\s*[^{]+)?\{/g,
    (match, _name, _args) => {
      // Look ahead in the file for an existing hook usage in this function - keep simple: add anyway, dedupe later.
      return `${match}\n  const i18n = useBlocksI18n();`;
    },
  );
  // Remove duplicate consecutive `const i18n = useBlocksI18n();` if any.
  src = src.replace(
    /(\n\s*const i18n = useBlocksI18n\(\);)(\s*\n\s*const i18n = useBlocksI18n\(\);)+/g,
    "$1",
  );

  if (src !== original) {
    writeFileSync(path, src);
    modifiedFiles++;
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

console.log(`Files scanned: ${totalFiles}`);
console.log(`Files modified: ${modifiedFiles}`);
console.log(`Skipped (no matches): ${skipped.length}`);
if (skipped.length) console.log("Skipped:", skipped.join(", "));
