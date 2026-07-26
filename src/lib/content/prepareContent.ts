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

  // OSOBNY licznik per silnik - NIE wspólny.
  //
  // `ContentRenderer` renderuje dokładnie JEDEN silnik (builder ⊕ blocks ⊕ html),
  // więc "ciągła numeracja między silnikami" nie ma odbiorcy, a wspólny licznik
  // aktywnie szkodził na dwa sposoby:
  //
  //  1. `processDocFootnotes` zwraca `notes: col.notes` - TĘ SAMĄ tablicę co
  //     kolektor. Przy wspólnym liczniku pass HTML dopisywał do niej, więc
  //     `col.notes.slice(builderNotes.length)` liczyło od końca i dawało ZAWSZE
  //     pustą listę: wpis richtext/markdown pokazywał markery [1], [2] i ani
  //     jednego przypisu w sekcji końcowej (odsyłacze w nikąd).
  //  2. Zaległe `content_pl/en` z `[fn]` w rekordzie renderowanym builderem
  //     dopisywało swoje noty do listy buildera - przypisy-widma bez odsyłacza
  //     w treści.
  //
  // Dwa liczniki zamykają oba przypadki i dodatkowo gwarantują, że renderowany
  // silnik zawsze numeruje od [1], niezależnie od zaległych danych drugiego.
  const { doc: preparedDoc, notes: builderNotes } = processDocFootnotes(
    builderDoc,
    lang,
    createCounter(1),
  );
  const htmlCol = createCounter(1);
  const expandedHtml = expandFootnotes(rawHtml ?? "", htmlCol);
  const htmlNotes = htmlCol.notes;
  const { html: withToc, hasMarker } = processManualToc(expandedHtml, lang);

  // Blocks trzyma własną sekcję przypisów (BlocksRenderer) - nie dublujemy.
  const footnotes = engine === "builder" ? builderNotes : engine === "html" ? htmlNotes : [];

  return {
    engine,
    builderDoc: preparedDoc,
    blocksDoc,
    html: withToc,
    footnotes,
    hasManualToc: hasMarker,
  };
}
