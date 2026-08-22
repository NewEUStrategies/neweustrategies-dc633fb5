// Treść strony głównej zbudowanej w CMS-ie: dokument buildera + sekcja
// przypisów.
//
// PO CO OSOBNO. `articleRef` istnieje WYŁĄCZNIE po to, żeby `FootnoteTooltips`
// wiedziało, w którym poddrzewie szukać markerów `[1]`. Trzymanie tego refa
// w ciele trasy wiązało najważniejszą trasę serwisu z detalem implementacyjnym
// przypisów; tutaj ref i jego jedyny konsument stoją obok siebie.
//
// STRUMIENIOWANIE JEST TU CELOWO WYŁĄCZONE (bez `Suspense`/`Await`): loader
// trasy dogrzewa zapytania wszystkich widgetów PRZED dehydratacją, a granica
// strumieniowa, która odrzuci w trakcie flushowania, potrafi uszkodzić skrypt
// bootstrapu `$_TSR.router` i zmusić Reacta do przebudowania całej strony po
// stronie klienta (widoczny błysk SSR + ponowny fetch).
import { useRef } from "react";
import { BuilderRenderer } from "@/components/builder/organisms/BuilderRenderer";
import { FootnotesList, FootnoteTooltips } from "@/components/Footnotes";
import type { BuilderDocument } from "@/lib/builder/types";
import type { Footnote } from "@/lib/footnotes";

export function HomeBuilderContent({
  doc,
  footnotes,
  lang,
}: {
  doc: BuilderDocument;
  footnotes: Footnote[];
  lang: "pl" | "en";
}) {
  const articleRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={articleRef}>
      <BuilderRenderer doc={doc} lang={lang} />
      {footnotes.length > 0 && (
        <div className="max-w-[1400px] mx-auto px-4 lg:px-8">
          <FootnotesList notes={footnotes} lang={lang} />
          <FootnoteTooltips notes={footnotes} containerRef={articleRef} />
        </div>
      )}
    </div>
  );
}
