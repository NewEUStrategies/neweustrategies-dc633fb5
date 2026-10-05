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
// `HomeBuilderContent` i `ContentRenderer`) dostaje co najwyżej dwa widgety
// wyznaczone czystą funkcją dokumentu `lcpCandidates`
// (src/lib/builder/lcpCandidate.ts) i podaje ich identyfikatory w dół drzewa.
// Priorytet i znacznik `data-lcp-candidate` dostaje wyłącznie pierwszy obraz
// tych widgetów; każdy inny obraz jest `loading=lazy` + `fetchpriority=auto`,
// więc React nie emituje dla niego automatycznego preloadu. Renderery powłoki
// (nagłówek, stopka, menu mobilne, popupy) nie są właścicielami - podają pustą
// listę.
//
// KANDYDATÓW LICZY WYŁĄCZNIE SERWER (runda poprawek 9, PROVE: `check:bundle`).
// `lcpCandidates` + preload z `heroImage.ts` w chunku wejściowym kosztowały
// +1,1 KB gzip na ścieżce bootu, a zasada fali zabrania wzrostu. Serwer liczy
// kandydatów w renderze właściciela (kontekst dostępu renderu - ten sam, którym
// `SectionsList` filtruje sekcje) i zapisuje ich na korzeniu renderera
// (`lcpRootAttributes`); klient przy hydratacji ODCZYTUJE te same identyfikatory
// z DOM-u serwera (`readServerLcpCandidates`), więc renderuje identyczne
// atrybuty i znaczniki - parytet bajtowy bez kodu `lcpCandidates` w bundlu
// klienta (`isServerRender()` wycina go z grafu przeglądarki).
//
// RENDER CZYSTO KLIENCKI (nawigacja SPA, nowy dokument w tym samym rendererze;
// recenzja P1.4 runda 3, M1) nie ma kandydata, znacznika ani preloadu, ale
// pierwszy obraz widgetów PIERWSZEJ malowanej sekcji ładuje się `eager`
// (`LcpImage` = "eager"): obraz leniwy czekałby na commit, layout i obserwację
// IO nowej strony, a baza dawała tu priorytet obrazom trzech sekcji.
import { createContext, useContext, type ReactNode } from "react";
import { preload } from "react-dom";
import { isServer } from "@tanstack/router-core/isServer";
import type { ImagePreloadInput } from "@/lib/seo/meta";
import { useAccessContext } from "@/lib/builder/accessControl";
import { isSsrRequest } from "@/lib/ssr/isSsrRequest";

/**
 * Czy to render SERWEROWY. `isServer` z router-core jest stałą warunków
 * eksportu: w buildzie przeglądarki `false` - Rollup zwija całe wyrażenie, więc
 * gałęzie serwerowe (`lcpCandidates`, `heroImage.ts`, `preload()`) wypadają
 * z bundla klienta - a w workerze `true`. W warunku `development` (`bun run dev`)
 * i pod `NODE_ENV=test` ma jednak wartość `undefined` (src/lib/ssr/isSsrRequest.ts):
 * wtedy rozstrzyga brak `document`, liczony przy każdym wywołaniu (recenzja P1.4
 * runda 3, m1 - inaczej serwer dev nie miał ani kandydata, ani preloadu).
 */
export function isServerRender(): boolean {
  return isServer ?? isSsrRequest();
}

/** Stała tożsamość pustej listy kandydatów (kontekst i `memo` jej nie zmieniają). */
export const NO_LCP_CANDIDATES: readonly string[] = Object.freeze([]);

const LcpCandidatesContext = createContext<readonly string[]>(NO_LCP_CANDIDATES);

/** Sekcja jest PIERWSZĄ malowaną sekcją renderu czysto klienckiego właściciela. */
const LcpEagerSectionContext = createContext(false);

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

/**
 * Owija KAŻDĄ sekcję renderera (także z `eager` = fałsz), więc sekcje
 * zagnieżdżonego renderera nie dziedziczą flagi sekcji rodzica.
 */
export function LcpEagerSection({ eager, children }: { eager: boolean; children: ReactNode }) {
  return (
    <LcpEagerSectionContext.Provider value={eager}>{children}</LcpEagerSectionContext.Provider>
  );
}

/**
 * Priorytet PIERWSZEGO obrazu widgetu (P1.4):
 *  - `true`    - kandydat LCP strony (`lcpCandidates`; tylko SSR i hydratacja):
 *                eager + fetchpriority=high + `data-lcp-candidate`,
 *  - `"eager"` - pierwsza malowana sekcja renderu czysto klienckiego właściciela
 *                (nawigacja SPA): `priority` atomu obrazu, czyli eager (atom
 *                `OptimizedImage` wiąże je z fetchpriority=high), bez znacznika
 *                i bez preloadu,
 *  - `false`   - `loading=lazy` + `fetchpriority=auto`.
 */
export type LcpImage = boolean | "eager";

/** Priorytet pierwszego obrazu widgetu o tym identyfikatorze (patrz `LcpImage`). */
export function useLcpImage(widgetId: string): LcpImage {
  const candidates = useContext(LcpCandidatesContext);
  const eagerSection = useContext(LcpEagerSectionContext);
  return candidates.includes(widgetId) || (eagerSection && "eager");
}

/**
 * NOŚNIK KANDYDATÓW Z SSR DO HYDRATACJI: atrybuty korzenia renderera-właściciela.
 * `data-lcp-root` to `useId()` renderera (ten sam na serwerze i przy
 * hydratacji), `data-lcp-ids` - identyfikatory po spacji (`lcpCandidateIds`
 * odrzuca identyfikatory puste i z białymi znakami, więc podział jest
 * odwracalny). Serwer emituje go ZAWSZE, także bez kandydatów
 * (`data-lcp-ids=""`): klient odróżnia wtedy hydratację bez kandydata (wszystko
 * leniwe, jak w HTML-u serwera) od renderu czysto klienckiego (`"eager"` w
 * pierwszej sekcji). `null` (renderer bez nośnika) - brak atrybutów.
 */
export function lcpRootAttributes(
  rootId: string,
  widgetIds: readonly string[] | null,
): { "data-lcp-root": string; "data-lcp-ids": string } | undefined {
  return widgetIds ? { "data-lcp-root": rootId, "data-lcp-ids": widgetIds.join(" ") } : undefined;
}

/**
 * Kandydaci zapisani przez SERWER na korzeniu renderera o tym `useId()`. Woła
 * go pierwszy render kliencki (hydratacja): DOM serwera już istnieje, a wynik
 * jest dokładnie listą, z której serwer wyrenderował atrybuty i znaczniki
 * (pusty atrybut = pusta lista). `null` = brak korzenia, czyli render czysto
 * kliencki (identyfikatory `useId()` klienta mają inny kształt niż serwerowe).
 * Dopasowanie idzie po wartości `useId()`, unikalnej w obrębie korzenia Reacta
 * (`hydrateRoot` TanStack Start), więc każdy właściciel czyta tylko swój nośnik.
 */
export function readServerLcpCandidates(rootId: string): readonly string[] | null {
  if (typeof document === "undefined") return null;
  for (const root of document.querySelectorAll("[data-lcp-root]")) {
    if (root.getAttribute("data-lcp-root") === rootId) {
      const ids = root.getAttribute("data-lcp-ids");
      return ids ? ids.split(" ") : NO_LCP_CANDIDATES;
    }
  }
  return null;
}

/**
 * Atrybut znacznika na `<img>` kandydata (`LcpImage` = `true`). Pusty string
 * renderuje się jako `data-lcp-candidate=""` (selektor
 * `img[data-lcp-candidate]`), `undefined` nie renderuje atrybutu - także dla
 * `"eager"` renderu klienckiego. Ten sam wynik w SSR i na kliencie.
 */
export function lcpCandidateAttr(lcp: LcpImage): "" | undefined {
  return lcp === true ? "" : undefined;
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
 * Trasy wołają go przez `usePreloadLcpImages`, czyli tylko w SSR.
 */
export function preloadLcpImages(preloads: readonly LcpImagePreload[] | null | undefined): void {
  for (const input of preloads ?? []) {
    if (input.href) preload(input.href, lcpImagePreloadOptions(input));
  }
}

/**
 * Hook trasy: preload kandydatów policzonych przez loader DLA GOŚCIA
 * (`builderHeroPreloads`). Działa WYŁĄCZNIE w SSR (`isServerRender`): loader liczy
 * preloady tylko na serwerze, a przy hydratacji link jest już w `<head>`, więc
 * kod preloadu nie trafia do bundla klienta. SSR jest anonimowy z konstrukcji
 * (`GUEST_ACCESS_CONTEXT`); warunek sesji pilnuje, żeby preload gościa nigdy
 * nie poszedł do dokumentu renderowanego z innym kontekstem dostępu niż
 * kandydat renderera (recenzja P1.4, B1).
 */
export function usePreloadLcpImages(preloads: readonly LcpImagePreload[] | null | undefined): void {
  const { isAuthenticated } = useAccessContext();
  if (isServerRender() && !isAuthenticated) preloadLcpImages(preloads);
}
