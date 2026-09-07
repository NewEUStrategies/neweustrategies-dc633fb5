// Treść strony głównej zbudowanej w CMS-ie: dokument buildera + sekcja
// przypisów.
//
// PO CO OSOBNO. `articleRef` istnieje WYŁĄCZNIE po to, żeby `FootnoteTooltips`
// wiedziało, w którym poddrzewie szukać markerów `[1]`. Trzymanie tego refa
// w ciele trasy wiązało najważniejszą trasę serwisu z detalem implementacyjnym
// przypisów; tutaj ref i jego jedyny konsument stoją obok siebie.
//
// STRUMIENIOWANIE JEST WŁĄCZONE (2026-09-01) - ten sam kontrakt, który `$.tsx`
// stosuje dla wpisów i WSZYSTKICH stron publicznych. Loader `/` blokuje pierwszy
// bajt wyłącznie na sekcjach nad zgięciem (`prefetchAboveFoldQueries`:
// 3 sekcje, budżet 2,5 s), a sekcje niżej dostrumieniowuje `ServerSectionGate`.
//
// CO TU STAŁO WCZEŚNIEJ I DLACZEGO BYŁO NIEPRAWDĄ. Poprzedni komentarz mówił:
// „strumieniowanie jest tu celowo wyłączone, bo loader dogrzewa zapytania
// wszystkich widgetów, a granica strumieniowa, która odrzuci w trakcie
// flushowania, potrafi uszkodzić skrypt bootstrapu `$_TSR.router`". Trzy
// nieprawdy w jednym akapicie:
//   1. Loader dogrzewał wszystko TYLKO na serwerze - nawigacja klientowa na `/`
//      grzała od dawna wyłącznie sekcje nad zgięciem, więc przesłanka nie
//      obowiązywała na połowie ścieżek.
//   2. Promise tej bramki NIE POTRAFI ODRZUCIĆ: to `Promise.allSettled(...)`
//      ścigane z budżetem, który wyłącznie `resolve()`-uje
//      (`lib/builder/sectionStreaming.tsx` - `createBoundedSectionPrefetch`),
//      a całość stoi pod `RenderErrorBoundary fallback={null}`.
//   3. Incydent z uszkodzonym bootstrapem miał USTALONĄ, inną przyczynę:
//      `tee()` strumienia w środku łańcucha middleware łamał tożsamość body
//      koperty SSR (2026-07-30). Zapis do cache'a jest od tamtej naprawy
//      odroczony do `src/server.ts`.
// Komentarz, który jest nieprawdziwy, jest gorszy od braku komentarza - dlatego
// jest tu wyliczony, a nie po cichu usunięty.
//
// CZYM TO JEST DZIŚ ZABEZPIECZONE: dane rozstrzygnięte w fazie renderu jadą
// strumieniem zapytań. `router.options.hydrate` (src/router.tsx) oddaje jeden
// tick na dostarczone porcje; nie czeka na domknięcie całego strumienia.
// Testy artefaktu sprawdzają zachowanie HTML podczas hydratacji.
// `shouldDehydrateQuery` przepuszcza wyłącznie `status: "success"`,
// więc żadna obietnica w locie nie idzie do serializacji. Na kliencie bramka
// jest w całości tree-shaken (`import.meta.env.SSR`), więc nawigacja SPA nie
// nie czeka na serwerową bramkę danych. Leniwy kod widgetów nadal może
// zawiesić własną granicę Suspense podczas nawigacji.
//
// CENA, ŚWIADOMIE PRZYJĘTA: sekcja spod zgięcia, której zapytania nie zmieszczą
// się w `SERVER_SECTION_STREAM_BUDGET_MS` (2 s), jedzie do HTML-a jako szkielet
// i dociąga się na kliencie - także dla crawlera. Wcześniej mieściła się w 6 s
// budżetu całego dokumentu, ale kosztem TTFB KAŻDEGO czytelnika na cache MISS.
// Ta sama wymiana obowiązuje na `$.tsx`, czyli na powierzchniach silniejszych
// linkowo niż strona główna.
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
      <BuilderRenderer doc={doc} lang={lang} stream />
      {footnotes.length > 0 && (
        <div className="max-w-[1400px] mx-auto px-4 lg:px-8">
          <FootnotesList notes={footnotes} lang={lang} />
          <FootnoteTooltips notes={footnotes} containerRef={articleRef} />
        </div>
      )}
    </div>
  );
}
