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
// Wartość jest czystą pochodną dokumentu i kontekstu dostępu czytelnika (tego
// samego, którym `SectionsList` filtruje sekcje), identyczną w SSR i pierwszym
// renderze klienta - parytet hydratacji taki sam jak samych sekcji.
import { createContext, useContext, type ReactNode } from "react";
import { preload } from "react-dom";
import type { ImagePreloadInput } from "@/lib/seo/meta";
import { useAccessContext } from "@/lib/builder/accessControl";

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

/**
 * Deskryptor preloadu obrazu LCP. `media` ma tylko kandydat JEDNEGO urządzenia
 * (dwóch kandydatów: desktop `(min-width: 768px)`, telefon `(max-width: 767px)`,
 * granica reguły `order.mobile` renderera) - telefon nie pobiera z High obrazu,
 * który u niego leży niżej, i odwrotnie (recenzja P1.4, m2).
 */
export interface LcpImagePreload extends ImagePreloadInput {
  readonly media?: string;
}

/**
 * JEDNA wartość domyślna `sizes` dla preloadu obrazu LCP - ta sama, którą
 * emitują `OptimizedImage` (`sizes ?? "100vw"`) i nagłówek `Link`
 * (`imagePreloadLinkHeaderValue`). Deduplikacja i `preload()` liczą klucz z tej
 * samej wartości, więc nie powstaną dwa preloady jednego obrazu (recenzja m3).
 */
const lcpImageSizes = (input: ImagePreloadInput) => input.imageSizes ?? "100vw";

/** Klucz zasobu - ten sam, którym React łączy `preload()` z `<img>` (`srcSet\nsizes` albo `href`). */
export function lcpImagePreloadKey(input: ImagePreloadInput): string {
  return input.imageSrcSet ? `${input.imageSrcSet}\n${lcpImageSizes(input)}` : input.href;
}

/** Opcje `ReactDOM.preload` dla deskryptora obrazu LCP (bez pustego `imageSrcSet`). */
function lcpImagePreloadOptions(input: LcpImagePreload) {
  return {
    as: "image" as const,
    fetchPriority: "high" as const,
    ...(input.imageSrcSet
      ? { imageSrcSet: input.imageSrcSet, imageSizes: lcpImageSizes(input) }
      : null),
    ...(input.media ? { media: input.media } : null),
  };
}

/**
 * JEDNO ŹRÓDŁO PRELOADU OBRAZU LCP (werdykt LP-2). Wołane w renderze trasy:
 * `preload()` z react-dom zapisuje ten sam klucz zasobu (`srcSet\nsizes`, bez
 * srcSet - `href`), który sprawdza automatyczny preload `<img>` w SSR, więc
 * React emituje dokładnie jeden `<link rel=preload as=image fetchpriority=high>`
 * w preambule - także wtedy, gdy sekcja z obrazem dostrumieniowuje się później.
 * Na kliencie (nawigacja SPA) wstawia ten sam link do `<head>`, gdy go nie ma.
 */
export function preloadLcpImages(preloads: readonly LcpImagePreload[] | null | undefined): void {
  for (const input of preloads ?? []) {
    if (input.href) preload(input.href, lcpImagePreloadOptions(input));
  }
}

/**
 * Hook trasy: preload kandydatów policzonych przez loader DLA GOŚCIA
 * (`builderHeroPreloads` - SSR jest zawsze anonimowy). Zalogowany czytelnik może
 * widzieć inną sekcję 0 (reguły `advanced.access`), a renderer liczy jego
 * kandydata z jego kontekstem - preload gościa byłby wtedy pobraniem z High
 * obrazu, którego nikt nie maluje (recenzja P1.4, B1). Dla zalogowanego
 * priorytet niesie sam `<img>` kandydata. SSR i hydratacja gościa - bez zmian.
 */
export function usePreloadLcpImages(preloads: readonly LcpImagePreload[] | null | undefined): void {
  if (!useAccessContext().isAuthenticated) preloadLcpImages(preloads);
}
