// BUDŻET HYDRATACJI - wyciągnięty z `src/router.tsx`, żeby przestał być
// nieobserwowalny.
//
// CO PILNUJE. Jeśli strumień zapytań z SSR nigdy nie domknie się w przeglądarce,
// `options.hydrate` integracji router<->query nigdy się nie rozstrzyga, React nie
// hydratuje i cała strona zostaje statycznym HTML-em: przyciski i linki nie
// reagują, a użytkownik nie widzi żadnego błędu. Budżet przerywa oczekiwanie;
// brakujące dane dociągają się zwykłym refetchem.
//
// DLACZEGO OSOBNY MODUŁ, A NIE `const` W ŚRODKU STRZAŁKI. Przed 2026-09-01
// budżet był lokalną stałą wewnątrz `router.options.hydrate`, a jedynym śladem
// przekroczenia był `console.warn`. Skutek: test mógł wyłącznie POWTÓRZYĆ literał
// 1500 (czyli nie pilnował niczego - zmiana w źródle nie czerwieni takiego testu)
// i musiał szpiegować globalną konsolę, dopasowując tekst. Trzy przypadki
// w `router.test.tsx` stały z tego powodu jako `it.fails`.
//
// Kształt jest kopią dwóch wzorców, które już tu są: stała eksportowana obok
// funkcji (`SSR_QUERY_TIMEOUT_MS` w `lib/ssr/queryTimeout.ts`) i raport
// wstrzykiwany OPCJĄ WYWOŁANIA, nie globalnym setterem (`QueryStreamGuardOptions`
// w `lib/ssr/queryStreamGuard.ts`). Globalny setter byłby zależny od kolejności
// między równoległymi forkami vitesta.
//
// ZACHOWANIE PRODUKCYJNE JEST IDENTYCZNE: ten sam domyślny 1500 ms, ten sam
// jeden `console.warn` znak w znak, ten sam `clearTimeout` w `finally`, ta sama
// kolejność `Promise.race`. Zero nowych ścieżek rzutu.
//
// CZEGO TEN BUDŻET DZISIAJ NIE ŚCINA - i to trzeba powiedzieć wprost, bo
// zmienia ocenę tego bezpiecznika. Zainstalowana integracja
// (`@tanstack/router-ssr-query-core`) czyta `queryStream` przez
// `reader.read().then(...)` W TRYBIE FIRE-AND-FORGET i NIE AWAITUJE go, więc jej
// `hydrate` rozstrzyga się natychmiast. Zmierzone: strumień, który nigdy się nie
// domyka, i `hydrate` rozstrzygnięty po 10 ms. `Promise.race` niżej zawsze
// wygrywa więc gałęzią integracji, a ostrzeżenie o przekroczeniu budżetu jest
// w tej wersji biblioteki MARTWE. Budżet zostaje jako bezpiecznik na
// `ogHydrate` (własny `hydrate` router-core) i na przyszłe wersje integracji,
// ale nikt nie powinien opierać się na nim jako na czynnej ochronie.

/** Ile wolno czekać na domknięcie strumienia zapytań przed hydratacją Reacta. */
export const HYDRATE_BUDGET_MS = 1500;

export interface HydrateBudgetBreach {
  readonly budgetMs: number;
  readonly label?: string;
}

export type HydrateBudgetReporter = (breach: HydrateBudgetBreach) => void;

/** Domyślny raport = DOKŁADNIE dotychczasowy komunikat, znak w znak. */
export const warnHydrateBudget: HydrateBudgetReporter = () => {
  console.warn("[ssr-hydrate] hydration stream exceeded budget - continuing");
};

export interface HydrateBudgetOptions {
  readonly budgetMs?: number;
  readonly report?: HydrateBudgetReporter;
  readonly label?: string;
}

/**
 * Czeka na `work`, ale nie dłużej niż `budgetMs`. Po przekroczeniu raportuje
 * i przepuszcza dalej - nigdy nie rzuca i nigdy nie zostawia wiszącego timera
 * (na Workers wiszący timer po domknięciu odpowiedzi to ostrzeżenia runtime'u
 * i zbędne wybudzenia; w przeglądarce - wyciek).
 */
export async function withHydrateBudget(
  work: Promise<unknown> | undefined,
  options: HydrateBudgetOptions = {},
): Promise<void> {
  const { budgetMs = HYDRATE_BUDGET_MS, report = warnHydrateBudget, label } = options;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      work,
      new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          report({ budgetMs, label });
          resolve();
        }, budgetMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
