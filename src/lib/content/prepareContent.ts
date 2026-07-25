// Jedno wejście do przygotowania treści przed renderem: rozwija [fn] w
// dokumencie buildera i w surowym HTML pod wspólnym licznikiem, generuje
// manualny <!--TOC--> i zwraca sekcję przypisów w kolejności dokumentu.
//
// Wszystkie trzy trasy renderujące treść (post, page, preview) powinny wołać
// TĘ funkcję - dzięki temu redaktor widzi to samo w podglądzie i po publikacji,
// numeracja przypisów jest ciągła między silnikami, a puste `[fn][/fn]` są
// zgodnie pomijane bez zużycia numeru.

import type { BuilderDocument } from "@/lib/builder/types";
import type { BlocksDoc } from "@/lib/blocks/types";
import {
  processDocFootnotes,
  expandFootnotes,
  createCounter,
  type Footnote,
} from "@/lib/footnotes";
import { processManualToc } from "@/lib/manualToc";
import { resolveContentEngine, type ContentEngine } from "@/lib/content/contentEngine";

export interface PrepareContentInput {
  editor?: string | null;
  builderDoc: BuilderDocument;
  blocksDoc: BlocksDoc | null;
  rawHtml: string;
  lang: "pl" | "en";
}

export interface PreparedContent {
  engine: ContentEngine;
  builderDoc: BuilderDocument;
  blocksDoc: BlocksDoc | null;
  html: string;
  /** Przypisy do sekcji końcowej + FootnoteTooltips (tylko dla aktywnego silnika). */
  footnotes: Footnote[];
  /** Czy autor umieścił marker <!--TOC-->. */
  hasManualToc: boolean;
}

export function prepareContentForRender(input: PrepareContentInput): PreparedContent {
  const { editor, builderDoc, blocksDoc, rawHtml, lang } = input;
  const engine = resolveContentEngine({ editor, builderDoc, blocksDoc });

  // Wspólny licznik: builder + html renderowane na tej samej stronie mają
  // ciągłą numerację, a marker `[fn]` w jednym silniku nie koliduje z drugim.
  const col = createCounter(1);
  const { doc: preparedDoc, notes: builderNotes } = processDocFootnotes(builderDoc, lang, col);
  const expandedHtml = expandFootnotes(rawHtml ?? "", col);
  const htmlNotes = col.notes.slice(builderNotes.length);
  const { html: withToc, hasMarker } = processManualToc(expandedHtml, lang);

  // Blocks trzyma własną sekcję przypisów (BlocksRenderer) - nie dublujemy.
  const footnotes =
    engine === "builder" ? builderNotes : engine === "html" ? htmlNotes : [];

  return {
    engine,
    builderDoc: preparedDoc,
    blocksDoc,
    html: withToc,
    footnotes,
    hasManualToc: hasMarker,
  };
}
