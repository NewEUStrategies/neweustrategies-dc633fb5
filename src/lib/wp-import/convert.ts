// Orkiestrator konwersji HTML z WordPress -> BuilderDocument.
//
// Pipeline: stripFoxizShortcodes -> Elementor mapper -> Gutenberg -> plain HTML.
// Zwraca doc + coverage + warnings + listę mediów wykrytych w treści (do mirroru).
//
// DLACZEGO TEN PLIK MIESZKA W `wp-import`, A NIE W `blocks`
// Moduł nie należy do silnika bloków - CZYTA blokami, ale PRODUKUJE dokument
// buildera, a jego jedyni konsumenci to `wp-import/buildPage.ts` i
// `wp-import.functions.ts`. Trzymany pod `lib/blocks/` był krawędzią cyklu
// `bloki -> builder` (4 z 23 zmierzonych 14.08), i to krawędzią fałszywą:
// import wynikał z miejsca pliku, nie z zależności silnika bloków od buildera.
// `wp-import` to adapter stojący NAD oboma silnikami, więc wolno mu znać oba.
// Patrz `src/lib/content-model/README.md`.
import type { BuilderDocument } from "@/lib/builder/types";
import { newId, toJson } from "@/lib/content-model/json";
import type { BlocksDoc } from "@/lib/blocks/types";
import { parseGutenberg, stripFoxizShortcodes } from "@/lib/blocks/gutenberg";
import { elementorToBuilder, isElementorHtml } from "./elementor";
import { htmlToBlocks } from "@/lib/blocks/migrate";

export interface ConversionCoverage {
  elementorMapped: number;
  gutenbergMapped: number;
  fallback: number;
  total: number;
}

export interface ConversionResult {
  doc: BuilderDocument;
  coverage: ConversionCoverage;
  warnings: string[];
  mediaUrls: string[];
  source: "elementor" | "gutenberg" | "html";
  cleanedHtml: string;
}

const MEDIA_URL_RE =
  /(?:src|href|data-src|data-lazy-src|poster)\s*=\s*"([^"]+\.(?:jpe?g|png|gif|webp|svg|avif|mp4|webm|mp3|ogg|wav|pdf|docx?|xlsx?|zip)(?:\?[^"]*)?)"/gi;
const SRCSET_RE = /\bsrcset\s*=\s*"([^"]+)"/gi;
const STYLE_URL_RE = /url\(\s*"?([^")\s]+\.(?:jpe?g|png|gif|webp|svg|avif))"?\s*\)/gi;

export function extractMediaUrls(html: string): string[] {
  if (!html) return [];
  const set = new Set<string>();
  let m: RegExpExecArray | null;
  MEDIA_URL_RE.lastIndex = 0;
  while ((m = MEDIA_URL_RE.exec(html)) !== null) set.add(m[1]);
  SRCSET_RE.lastIndex = 0;
  while ((m = SRCSET_RE.exec(html)) !== null) {
    for (const chunk of m[1].split(",")) {
      const url = chunk.trim().split(/\s+/)[0];
      if (url) set.add(url);
    }
  }
  STYLE_URL_RE.lastIndex = 0;
  while ((m = STYLE_URL_RE.exec(html)) !== null) set.add(m[1]);
  return Array.from(set).filter((u) => /^https?:\/\//i.test(u));
}

function wrapAsRichTextDoc(blocks: BlocksDoc): BuilderDocument {
  return {
    version: 1,
    sections: [
      {
        id: newId(),
        kind: "section",
        children: [
          {
            id: newId(),
            kind: "column",
            span: { desktop: 12 },
            children: [
              {
                id: newId(),
                kind: "widget",
                type: "rich-text",
                content: {
                  doc: toJson({ pl: blocks, en: { version: 1, blocks: [] } as BlocksDoc }),
                },
              },
            ],
          },
        ],
      },
    ],
  };
}

export function convertHtmlToBuilder(html: string): ConversionResult {
  const cleaned = stripFoxizShortcodes(html ?? "");
  const mediaUrls = extractMediaUrls(cleaned);

  // 1) Elementor
  if (isElementorHtml(cleaned)) {
    const el = elementorToBuilder(cleaned);
    if (el) {
      return {
        doc: el.doc,
        coverage: {
          elementorMapped: el.coverage.elementorMapped,
          gutenbergMapped: 0,
          fallback: el.coverage.fallback,
          total: el.coverage.total,
        },
        warnings: el.warnings,
        mediaUrls,
        source: "elementor",
        cleanedHtml: cleaned,
      };
    }
  }

  // 2) Gutenberg
  const gutenberg = parseGutenberg(cleaned);
  const isGutenberg = /<!--\s*wp:/i.test(cleaned);
  if (isGutenberg && gutenberg.blocks.length > 0) {
    return {
      doc: wrapAsRichTextDoc(gutenberg),
      coverage: {
        elementorMapped: 0,
        gutenbergMapped: gutenberg.blocks.length,
        fallback: 0,
        total: gutenberg.blocks.length,
      },
      warnings: [],
      mediaUrls,
      source: "gutenberg",
      cleanedHtml: cleaned,
    };
  }

  // 3) Plain HTML fallback
  const blocks = cleaned ? htmlToBlocks(cleaned) : ({ version: 1, blocks: [] } as BlocksDoc);
  return {
    doc: wrapAsRichTextDoc(blocks),
    coverage: {
      elementorMapped: 0,
      gutenbergMapped: 0,
      fallback: blocks.blocks.length,
      total: blocks.blocks.length,
    },
    warnings: cleaned
      ? ["Treść nie została rozpoznana jako Elementor ani Gutenberg - użyto fallbacku HTML."]
      : [],
    mediaUrls,
    source: "html",
    cleanedHtml: cleaned,
  };
}
