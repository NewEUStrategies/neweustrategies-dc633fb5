// Odświeżenie href-ów JUŻ wyrenderowanych `<Link>`-ów po zmianie języka renderu.
//
// Język NIE jest częścią adresu, który widzi router: rewrite `input` zdejmuje prefiks
// ("/en/b" i "/b" to dla routera ten sam "/b"), a jedynym, co od języka zależy, jest
// rewrite `output`, czytający `currentLang()`. Bez odświeżenia odnośniki zostawały
// w starym języku: nowa karta, skopiowany link i pasek statusu prowadziły do drugiej
// wersji językowej (sam klik nie, bo `navigate` buduje adres kliku od nowa).
//
// JEDNO MIEJSCE ZMIANY JĘZYKA, JEDNO ODŚWIEŻENIE. Język klienta zmienia przełącznik
// (`switchUiLanguage` -> `setClientLang`) albo sam adres przy nawigacji wstecz/dalej
// i kliku w odnośnik drugiej wersji (`syncClientLangToUrl` w `beforeLoad` korzenia).
// Każda z tych dróg kończy się `onResolved` routera, więc odświeżenie wisi na nim
// (`installLanguageLinkRefresh`, wpinane w `src/router.tsx`), a nie w każdym źródle
// zmiany z osobna - dawniej robił to tylko przełącznik i „wstecz" przez granicę języka
// zostawiało odnośniki chromu (nagłówek, stopka) w starym języku.

/** Magazyn lokalizacji routera, który `<Link>`-i subskrybują. */
export interface RenderedLinksLocationStore {
  get(): object;
  set(location: object): void;
}

/** Tyle routera TanStack, ile potrzeba do odświeżenia odnośników. */
export interface RenderedLinksRouter {
  /** Bez magazynu (atrapa, inny router) odnośniki odświeży dopiero nawigacja. */
  stores?: { location?: RenderedLinksLocationStore };
  /** Bieżące opcje routera - `update` dostaje je z powrotem bez zmian. */
  options?: object;
  /**
   * Bez `update` (atrapa, inny router) nie ma pamięci lokalizacji do czyszczenia.
   * Składnia metody celowo: jej parametr porównywany jest biwariantnie, więc
   * prawdziwy router (`UpdateFn` z pełnymi opcjami konstruktora) pasuje do typu.
   */
  update?(options: object): void;
}

/** Router z subskrypcją zdarzeń - tylko `onResolved` (składnia metody, jak wyżej). */
export interface LanguageAwareRouter extends RenderedLinksRouter {
  subscribe(eventType: "onResolved", fn: () => void): () => void;
}

/**
 * Każe JUŻ wyrenderowanym `<Link>`-om zbudować href od nowa - w bieżącym języku.
 * Dwa mechanizmy routera trzymają stary href:
 *
 *   1. Pamięć lokalizacji. router-core 1.171.37 zapamiętuje wynik
 *      `buildLocation` każdego `<Link>`, który nie zależy od bieżącego adresu
 *      (bezwzględne `to`, bez `search: true` itp.), pod obiektem opcji tego
 *      odnośnika (`staticLocations`, `router.js`). Czyści ją wyłącznie
 *      `update()` (albo `setRoutes`), a zależności od `currentLang()` pamięć nie
 *      widzi. `update` z niezmienionymi opcjami - to samo, co robi
 *      `RouterProvider` przy zmianie propsów - przy tym samym obiekcie
 *      `rewrite` tylko ją czyści i ponownie parsuje `latestLocation`.
 *   2. Przeliczenie na żądanie. `<Link>` buduje lokalizację ponownie dopiero,
 *      gdy magazyn lokalizacji poda INNY obiekt niż ostatnio widziany
 *      (porównanie tożsamości, `link.tsx`/`matchContext.tsx`). Zapis płytkiej
 *      kopii i natychmiastowy powrót tej samej lokalizacji to dwa
 *      powiadomienia; każdy odnośnik przelicza href synchronicznie, w chwili
 *      powiadomienia (migawka `useSyncExternalStore`), więc kopii nie trzeba
 *      renderować. Warunek: wywołanie POZA `router.batch` - w nim (np. wprost ze
 *      słuchacza `onResolved`) oba zapisy scalają się w jedno powiadomienie
 *      z TĄ SAMĄ lokalizacją i żaden odnośnik nic nie przelicza. Kopia ma te same
 *      pola, więc subskrybenci czytający `pathname`, `href` czy `search` nie widzą
 *      różnicy, a w routerze zostaje TA SAMA lokalizacja. Żadnej nawigacji,
 *      zapisu historii ani ładowania tras.
 */
export function refreshRenderedLinks(router: RenderedLinksRouter): void {
  const store = router.stores?.location;
  if (!store) return;
  const location = store.get();
  try {
    router.update?.({ ...router.options });
    store.set({ ...location });
  } catch {
    // Odświeżenie dotyczy samych href-ów - jego błąd (np. wyjątek subskrybenta
    // magazynu) nie może wywrócić nawigacji ani zostawić nieobsłużonego wyjątku.
  }
  // Kopia nie może zostać w routerze - nawet gdy zapis wyżej rzucił.
  store.set(location);
}

/**
 * Po każdym rozstrzygniętym ładowaniu (`onResolved`), w którym zmienił się język renderu
 * (`readLang`), odświeża wyrenderowane odnośniki. O mikrozadanie później: router emituje
 * `onResolved` wewnątrz `router.batch` (router-core `load-client.js`), który scaliłby zapis
 * kopii lokalizacji z jej przywróceniem w jedno powiadomienie bez skutku. Bez zmiany języka
 * nic się nie dzieje (zwykła nawigacja nie płaci za `update`). Zwraca wypięcie słuchacza.
 */
export function installLanguageLinkRefresh(
  router: LanguageAwareRouter,
  readLang: () => string,
): () => void {
  let renderedLang = readLang();
  return router.subscribe("onResolved", () => {
    const lang = readLang();
    if (lang === renderedLang) return;
    renderedLang = lang;
    queueMicrotask(() => refreshRenderedLinks(router));
  });
}
