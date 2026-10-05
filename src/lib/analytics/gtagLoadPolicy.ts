// Polityka dociągania gtag.js - KIEDY wolno wpuścić ~90 KB obcego originu.
//
// PO CO. PSI produkcji pokazał dwa skrypty Google (GA4 + kontener Google Ads):
// ~367 KB transferu i ~580 ms głównego wątku na mobile; na śladzie PSI mobile
// gtag to 153 z 202 ms TBT (76 %) i TTI 7,1 -> 10,6 s. Polecenia (zgoda
// domyślna, `config`, odsłony) nie są tym dotknięte - czekają w
// `window.dataLayer`, natywnej kolejce gtag.js, więc odroczenie skryptu nie
// gubi zdarzeń, DOPÓKI skrypt w końcu dojedzie.
//
// POLITYKA v2 (P1.1, 2026-10-04): ładujemy przy NAJWCZEŚNIEJSZYM z trzech
// sygnałów, wszystkie przez wspólne prymitywy P0.3 (`src/lib/performance/`):
//  (a) pierwsza interakcja odwiedzającego - `enqueue(fire, {priority:
//      "analytics"})`: kolejka po interakcji (`postInteractionQueue.ts`)
//      zwalnia wpis na `pointerdown`/`keydown`/`touchstart`/`wheel`/przewinięcie
//      DOKUMENTU (`firstInteraction.ts`: wyłącznie zdarzenia zaufane; `scroll`
//      ELEMENTU, np. programowe `scrollTo` autoodtwarzanej karuzeli, NIE jest
//      interakcją - dawny nasłuch tego modułu na `window` w fazie capture łapał
//      go i ładował gtag bez udziału odwiedzającego). gtag schodzi OSTATNI: po
//      końcu gestu (strażnik gestu), po klatce, po powłoce zgód, wyspie pod
//      palcem, nagłówku, wyspach i nakładkach, jedno zadanie na klatkę;
//  (b) jawna decyzja o zgodzie - wołający podaje subskrypcję w `onDecision`
//      (w aplikacji: `subscribeConsentChange` + `hasConsentDecision` z
//      `@/lib/ads/consent`); decyzja trafia do tej samej kolejki z `release:
//      "immediate"`, bez czekania na interakcję (decyzja z innej karty przez
//      `storage` nie jest interakcją, a odwiedzający, który ją podjął, chce być
//      mierzony);
//  (c) globalny punkt ciszy strony - `onQuiescent(fire, {priority:
//      "analytics"})` (`whenQuiescent.ts`): co najmniej 5 s po `load` i 5 s bez
//      długich zadań i bez liczonych zasobów, limit 20 s po `load` (także w
//      ukrytej karcie), 10 s od nawigacji, gdy `load` nie przychodzi. Jeden
//      detektor na dokument dla wszystkich konsumentów, więc żądania innych
//      konsumentów (baner, nakładki, wyspy) nie przesuwają okna gtag - i
//      odwrotnie: własne URL-e gtag są zgłoszone `registerOwnedRequest`.
// `fire` jest idempotentne i ZWRACA promise rozstrzygany na `load`/`error`
// gtag.js (KONTRAKT ZADANIA kolejki P0.3), więc kolejka nie puszcza
// następnego kroku na ewaluację tagu.
//
// UZASADNIENIE (Lantern). Lighthouse kończy ślad po `load` + 1 s, 1 s ciszy
// sieci (network-2-quiet) i 1 s ciszy CPU (`wait-for-condition.js:409-480`).
// Lantern liczy TBT z KAŻDEGO długiego zadania w śladzie, kończy TTI na
// ostatnim długim zadaniu i NIE symuluje timerów - przesunięcie gtag „później"
// wewnątrz śladu (dawne `load` + 2-8 s) nie zdejmuje z TBT ani milisekundy.
// Pomaga tylko praca, która startuje po końcu śladu. Okno 5 s jest dłuższe niż
// progi Lighthouse'a, więc gtag ląduje poza śladem; to klasyczna reguła TTI
// (5 s bez długich zadań i bez żądań), a nie wykrywanie Lighthouse'a: ten sam
// punkt obowiązuje każdego odwiedzającego.
//
// ŚWIADOMY KOMPROMIS. Odwiedzający, który wychodzi PRZED pierwszą interakcją i
// PRZED punktem ciszy (zwykle ok. `load` + 10 s, najdalej `load` + 20 s), nie
// wyśle `page_view` (dawniej próg wynosił 2-8 s po `load`). Strata skupia się
// na odbiciach bez dotknięcia strony - ruchu, który GA4 i tak raportuje z
// zaangażowaniem bliskim zeru. Interakcja przed punktem ciszy płaci za
// ewaluację gtag zaraz po swoim geście (ostatnia w kolejce, po klatce), co
// pilnuje RUM P0.6 (INP z atrybucją). Wyjątek od reguły z
// `docs/performance/2026-09-30-critical-boot.md:5` („nie odraczać pracy tylko
// poza okno audytu") ZATWIERDZIŁ właściciel produktu: faza1/ORCHESTRATOR-NOTES.md,
// sekcja „Owner decision" (2026-10-03, TP-1 i TP-2), decyzja D1 w
// faza1/PLAN.md §7. KRYTERIUM WYCOFANIA: spadek `page_view` (GA4 albo RUM)
// o więcej niż 10 % względem linii bazowej sprzed wdrożenia (PLAN.md §8.2) -
// najpierw przegląd listy ignorowanych zasobów i limitu w `whenQuiescent.ts`,
// potem powrót do krótszego okna.
//
// ŁADOWANIE. Moduł NIE MA statycznych importerów w aplikacji:
// `ConsentScriptInjector` dociąga go `import()` z efektu po hydratacji
// (`loadGtagLoadPolicy`), więc ani on, ani prymitywy P0.3, których jest dziś
// jedynym konsumentem, nie wchodzą do zamknięcia bootu (statyczny import
// kosztował +2,4 KB gzip w chunku `index` i ok. +155 ms LCP na mobile
// fixture - dowód A/B P1.1). Późne założenie sygnałów niczego nie gubi - patrz
// PÓŹNY IMPORT w `whenQuiescent.ts`.
//
// Moduł nie trzyma własnego stanu: stan (jeden detektor ciszy, jedna kolejka,
// jedna pierwsza interakcja) należy do prymitywów P0.3; testy zerują go ich
// hakami `__reset…ForTests`. SSR dostaje no-op.

import { enqueue, type QueuePriority } from "@/lib/performance/postInteractionQueue";
import { onQuiescent, registerOwnedRequest } from "@/lib/performance/whenQuiescent";

/** Klasa kolejki P0.3 dla gtag: zawsze ostatnia (`QUEUE_PRIORITIES`). */
export const GTAG_QUEUE_PRIORITY = "analytics" satisfies QueuePriority;

/**
 * Żądania tagu Google (gtag.js i kontener Ads, kolekcja GA4, pingi Ads/ccm,
 * także `www.google.<tld>/pagead|ccm|ads/…`), zgłaszane detektorowi ciszy jako
 * własne - nie przesuwają punktu ciszy pozostałym konsumentom, gdy gtag
 * dojedzie po interakcji przed tym punktem. Detektor ignoruje dziś hosty
 * Google sam z siebie; zgłoszenie jest kontraktem P0.3, niezależnym od jego
 * listy. Po hoście wymagany `/`, więc `googletagmanager.com.evil.io` nie pasuje.
 */
export const GTAG_OWNED_REQUESTS =
  /^https:\/\/([a-z0-9-]+\.)*((googletagmanager\.com|google-analytics\.com|analytics\.google\.com|doubleclick\.net|googlesyndication\.com|googleadservices\.com)\/|google\.[a-z]{2,3}(\.[a-z]{2})?\/(pagead|ccm|ads)\/)/i;

export type CancelGtagLoad = () => void;

/** Wstrzyknięcie gtag.js; promise (rozstrzygany na `load`/`error` skryptu) trzyma kolejkę. */
export type GtagLoad = () => void | PromiseLike<unknown>;

export interface GtagLoadPolicyOptions {
  /**
   * Subskrypcja jawnej decyzji o zgodzie: wołający daje funkcję, która woła
   * `fire` po KAŻDEJ decyzji (idempotencja jest po naszej stronie) i zwraca
   * funkcję odpinającą nasłuch.
   */
  onDecision?: (fire: () => void) => () => void;
}

/**
 * Planuje dociągnięcie gtag.js według polityki z nagłówka pliku. `load` biegnie
 * najwyżej raz. Zwrócona funkcja odwołuje WSZYSTKIE sygnały (wpisy kolejki,
 * zapis w punkcie ciszy, subskrypcję decyzji) - wołać w cleanupie efektu.
 */
export function scheduleGtagLoad(
  load: GtagLoad,
  options: GtagLoadPolicyOptions = {},
): CancelGtagLoad {
  if (typeof window === "undefined" || typeof document === "undefined") return () => {};

  let fired = false;
  let result: void | PromiseLike<unknown>;
  let decisionQueued = false;
  const signals: Array<() => void> = [];
  const releaseSignals = () => {
    while (signals.length) signals.pop()?.();
  };
  // Własne URL-e gtag zostają zgłoszone także po załadowaniu (pingi biegną
  // dalej); wycofujemy je tylko, gdy polityka zostaje odwołana przed `fire`.
  const unregisterOwned = registerOwnedRequest(GTAG_OWNED_REQUESTS);

  const fire = (): void | PromiseLike<unknown> => {
    if (fired) return result;
    fired = true;
    // Pozostałe sygnały schodzą PRZED wstrzyknięciem: wpisy kolejki i zapis w
    // punkcie ciszy nie wystartują drugi raz, subskrypcja decyzji jest odpięta.
    releaseSignals();
    result = load();
    return result;
  };

  // (a) pierwsza interakcja: wpis czeka na zwolnienie kolejki.
  signals.push(enqueue(fire, { priority: GTAG_QUEUE_PRIORITY }));

  // (b) jawna decyzja o zgodzie: ta sama kolejka, bez czekania na interakcję;
  // seria decyzji (baner, panel, druga karta) zakłada najwyżej jeden wpis.
  if (options.onDecision) {
    signals.push(
      options.onDecision(() => {
        if (fired || decisionQueued) return;
        decisionQueued = true;
        signals.push(enqueue(fire, { priority: GTAG_QUEUE_PRIORITY, release: "immediate" }));
      }),
    );
  }

  // (c) globalny punkt ciszy strony.
  signals.push(onQuiescent(fire, { priority: GTAG_QUEUE_PRIORITY }));

  return () => {
    releaseSignals();
    if (!fired) unregisterOwned();
  };
}
