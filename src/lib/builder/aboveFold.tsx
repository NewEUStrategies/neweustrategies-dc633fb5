// Kontekst KANDYDATÓW LCP publicznego renderera buildera (P1.4).
//
// Widget nie zna swojej pozycji w dokumencie, więc nie może sam rozstrzygnąć,
// czy jego obraz jest elementem LCP strony. Dotąd rozstrzygała to POZYCJA
// SEKCJI (indeks < ABOVE_FOLD_SECTION_COUNT): każdy widget trzech czołowych
// sekcji oznaczał swój pierwszy obraz `eager` + `fetchpriority=high`, a do tego
// każdy slider - bezwarunkowo. Fixture `/` miał 9 obrazów High; przy różnych
// okładkach leadów każdy z nich dokłada się do zbioru przed LCP (werdykt LP-1).
//
// Teraz renderer-WŁAŚCICIEL (główna treść strony: `lcpOwner` w
// `HomeBuilderContent` i `ContentRenderer`) liczy czystą funkcją dokumentu
// `lcpCandidates` (src/lib/builder/lcpCandidate.ts) co najwyżej dwa widgety
// i podaje ich identyfikatory w dół drzewa. Priorytet i znacznik
// `data-lcp-candidate` dostaje wyłącznie pierwszy obraz tych widgetów; każdy
// inny obraz jest `loading=lazy` + `fetchpriority=auto`, więc React nie
// emituje dla niego automatycznego preloadu. Renderery powłoki (nagłówek,
// stopka, menu mobilne, popupy) nie są właścicielami - podają pustą listę.
//
// Wartość jest czystą pochodną dokumentu, identyczną w SSR i pierwszym renderze
// klienta - zero ryzyka rozjazdu hydratacji.
import { createContext, useContext, type ReactNode } from "react";
import { preload } from "react-dom";
import type { ImagePreloadInput } from "@/lib/seo/meta";

const NO_CANDIDATES: readonly string[] = Object.freeze([]);

const LcpCandidatesContext = createContext<readonly string[]>(NO_CANDIDATES);

/**
 * Podaje identyfikatory widgetów-kandydatów LCP. KAŻDY renderer buildera
 * ustawia ten kontekst (także pustą listą), więc zagnieżdżony renderer nigdy
 * nie dziedziczy kandydatów rodzica.
 */
export function LcpCandidatesProvider({
  widgetIds,
  children,
}: {
  widgetIds: readonly string[];
  children: ReactNode;
}) {
  return (
    <LcpCandidatesContext.Provider value={widgetIds}>{children}</LcpCandidatesContext.Provider>
  );
}

/** Czy widget o tym identyfikatorze jest kandydatem LCP strony. */
export function useIsLcpWidget(widgetId: string): boolean {
  return useContext(LcpCandidatesContext).includes(widgetId);
}

/**
 * Atrybut znacznika na `<img>` kandydata. Pusty string renderuje się jako
 * `data-lcp-candidate=""` (selektor `img[data-lcp-candidate]`), `undefined`
 * nie renderuje atrybutu. Ten sam wynik w SSR i na kliencie.
 */
export function lcpCandidateAttr(isLcp: boolean): "" | undefined {
  return isLcp ? "" : undefined;
}

/** Opcje `ReactDOM.preload` dla deskryptora obrazu LCP (bez pustego `imageSrcSet`). */
export function lcpImagePreloadOptions(input: ImagePreloadInput) {
  return input.imageSrcSet
    ? {
        as: "image" as const,
        fetchPriority: "high" as const,
        imageSrcSet: input.imageSrcSet,
        imageSizes: input.imageSizes ?? "100vw",
      }
    : { as: "image" as const, fetchPriority: "high" as const };
}

/**
 * JEDNO ŹRÓDŁO PRELOADU OBRAZU LCP (werdykt LP-2). Wołane w renderze trasy:
 * `preload()` z react-dom zapisuje ten sam klucz zasobu (`srcSet\nsizes`, bez
 * srcSet - `href`), który sprawdza automatyczny preload `<img>` w SSR, więc
 * React emituje dokładnie jeden `<link rel=preload as=image fetchpriority=high>`
 * w preambule - także wtedy, gdy sekcja z obrazem dostrumieniowuje się później.
 * Na kliencie (nawigacja SPA) wstawia ten sam link do `<head>`, gdy go nie ma.
 */
export function preloadLcpImages(preloads: readonly ImagePreloadInput[] | null | undefined): void {
  for (const input of preloads ?? []) {
    if (input.href) preload(input.href, lcpImagePreloadOptions(input));
  }
}
