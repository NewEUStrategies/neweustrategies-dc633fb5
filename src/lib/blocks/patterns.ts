// Wzorce blokowe (odpowiednik "Patterns" z WordPress Gutenberg) - gotowe
// kompozycje bloków dla redakcji think-tanku. Czyste fabryki: każde wstawienie
// tworzy ŚWIEŻE id (regenerateBlockIds), a treść powstaje w języku aktywnego
// dokumentu (dokumenty PL/EN są rozdzielone - patrz LocalizedBlocks).
//
// Kształty danych bloków pochodzą z BLOCK_SPECS[type].create() (jedno źródło
// prawdy rejestru), nadpisujemy wyłącznie pola treści - dzięki temu wzorce
// nie mogą się zdesynchronizować ze schematem bloku.

import type { Block, BlockType, Json } from "./types";
import { BLOCK_SPECS } from "./registry";
import { regenerateBlockIds } from "./clipboard";
import { toJson } from "@/lib/builder/types";

export type PatternLang = "pl" | "en";

export interface BlockPattern {
  /** Stabilny klucz (i18n: blocks.patterns.items.<key>.name / .desc). */
  key: string;
  category: "article" | "layout" | "marketing";
  /** Typ bloku, którego ikona reprezentuje wzorzec w inserterze. */
  iconType: BlockType;
  create: (lang: PatternLang) => Block[];
}

/** Blok z rejestru z nadpisanymi polami treści (kształt zawsze ze specs). */
function specBlock(type: BlockType, data: Record<string, Json>): Block {
  const base = BLOCK_SPECS[type].create();
  return { ...base, data: { ...base.data, ...data } };
}

const pick = (lang: PatternLang, pl: string, en: string): string => (lang === "pl" ? pl : en);

export const BLOCK_PATTERNS: readonly BlockPattern[] = [
  {
    key: "key-takeaways",
    category: "article",
    iconType: "list",
    create: (lang) => [
      specBlock("heading", {
        level: 2,
        text: pick(lang, "Kluczowe wnioski", "Key takeaways"),
      }),
      specBlock("list", {
        ordered: false,
        items: toJson([
          pick(lang, "Najważniejsza obserwacja analizy.", "The single most important finding."),
          pick(lang, "Konsekwencja dla decydentów.", "What it means for decision-makers."),
          pick(lang, "Rekomendowany następny krok.", "The recommended next step."),
        ]),
      }),
    ],
  },
  {
    key: "expert-quote",
    category: "article",
    iconType: "pullquote",
    create: (lang) => [
      specBlock("pullquote", {
        text: pick(
          lang,
          "Celny cytat eksperta, który niesie tezę sekcji.",
          "A sharp expert quote carrying the section's thesis.",
        ),
        cite: pick(lang, "Imię Nazwisko, afiliacja", "Name Surname, affiliation"),
      }),
    ],
  },
  {
    key: "chapter-break",
    category: "article",
    iconType: "separator",
    create: (lang) => [
      specBlock("separator", { variant: "line" }),
      specBlock("heading", { level: 2, text: pick(lang, "Nowy rozdział", "New chapter") }),
      specBlock("paragraph", {
        html: pick(
          lang,
          "<p>Akapit otwierający rozdział - jedna teza, jedno zdanie kontekstu.</p>",
          "<p>Chapter-opening paragraph - one thesis, one sentence of context.</p>",
        ),
      }),
    ],
  },
  {
    key: "two-column-analysis",
    category: "layout",
    iconType: "columns",
    create: (lang) => [
      specBlock("columns", {
        left: toJson([
          specBlock("heading", { level: 3, text: pick(lang, "Szanse", "Opportunities") }),
          specBlock("paragraph", {
            html: pick(lang, "<p>Argumenty za.</p>", "<p>Arguments in favour.</p>"),
          }),
        ]),
        right: toJson([
          specBlock("heading", { level: 3, text: pick(lang, "Ryzyka", "Risks") }),
          specBlock("paragraph", {
            html: pick(lang, "<p>Argumenty przeciw.</p>", "<p>Arguments against.</p>"),
          }),
        ]),
      }),
    ],
  },
  {
    key: "faq-details",
    category: "article",
    iconType: "details",
    create: (lang) => [
      specBlock("heading", {
        level: 2,
        text: pick(lang, "Najczęstsze pytania", "Frequently asked questions"),
      }),
      specBlock("details", {
        summary: pick(lang, "Pytanie pierwsze?", "First question?"),
        body: pick(lang, "Zwięzła odpowiedź analityka.", "A concise analyst answer."),
      }),
      specBlock("details", {
        summary: pick(lang, "Pytanie drugie?", "Second question?"),
        body: pick(lang, "Zwięzła odpowiedź analityka.", "A concise analyst answer."),
      }),
    ],
  },
  {
    key: "newsletter-cta",
    category: "marketing",
    iconType: "newsletter",
    create: (lang) => [
      specBlock("newsletter", {
        title: pick(lang, "Bądź na bieżąco", "Stay in the loop"),
        description: pick(
          lang,
          "Najważniejsze analizy prosto na Twoją skrzynkę.",
          "The most important analyses straight to your inbox.",
        ),
        variant: "card",
      }),
    ],
  },
  {
    key: "data-table",
    category: "article",
    iconType: "table",
    create: (lang) => [
      specBlock("heading", {
        level: 3,
        text: pick(lang, "Dane w tabeli", "Data at a glance"),
      }),
      specBlock("table", {
        header: true,
        rows: toJson([
          [pick(lang, "Wskaźnik", "Indicator"), "2024", "2025"],
          [pick(lang, "Przykładowa metryka", "Sample metric"), "1,2", "1,8"],
          [pick(lang, "Druga metryka", "Second metric"), "42", "57"],
        ]),
      }),
    ],
  },
  {
    key: "summary-box",
    category: "layout",
    iconType: "group",
    create: (lang) => [
      specBlock("group", {
        background: "",
        padding: 16,
        children: toJson([
          specBlock("heading", { level: 3, text: pick(lang, "W skrócie", "In brief") }),
          specBlock("list", {
            ordered: true,
            items: [
              pick(lang, "Punkt pierwszy.", "Point one."),
              pick(lang, "Punkt drugi.", "Point two."),
            ] as unknown as Json,
          }),
        ]),
      }),
    ],
  },
];

/** Bloki wzorca ze świeżymi id - gotowe do wstawienia do dokumentu. */
export function instantiatePattern(pattern: BlockPattern, lang: PatternLang): Block[] {
  return regenerateBlockIds(pattern.create(lang));
}

/** Filtr wzorców po etykiecie/opisie (i18n dostarcza wołający). */
export function filterPatterns(
  patterns: readonly BlockPattern[],
  query: string,
  label: (p: BlockPattern) => string,
  description: (p: BlockPattern) => string,
): BlockPattern[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...patterns];
  return patterns.filter(
    (p) =>
      p.key.includes(q) ||
      label(p).toLowerCase().includes(q) ||
      description(p).toLowerCase().includes(q),
  );
}
