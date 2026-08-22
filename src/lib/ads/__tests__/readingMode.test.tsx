// Budżet stref reklamowych w trybie czytania - JEDNA decyzja, która rozstrzyga,
// ile reklam zobaczy czytelnik artykułu, i jedna z niewielu w tym repo, gdzie
// pomyłka DAJE CZYTELNIKOWI WIĘCEJ REKLAM, niż zapłacił.
//
// CO TEN PLIK DOWODZI.
//   1. AWARIA ODCZYTU PLANU PODNOSI BUDŻET REKLAM PŁACĄCEMU (`it.fails`).
//      `const paying = tierQ.isPending ? true : (tierQ.data?.rank ?? 0) > 0;`
//      (readingMode.ts:78) rozgałęzia się WYŁĄCZNIE na `isPending`. Stan błędu
//      zapytania to `isPending === false` + `data === undefined`, więc
//      `paying` wychodzi `false`, a budżet skacze z `max_ad_zones_paid` na
//      `max_ad_zones_free`. Komentarz nad funkcją deklaruje intencję ODWROTNĄ
//      („lepiej pokazać płacącemu o jedną reklamę za mało"), i dla stanu
//      OCZEKIWANIA jest ona zrealizowana - ale dla stanu BŁĘDU nie ma jej
//      wcale. Skutek dla użytkownika: chwilowa awaria `current_tier` (offline,
//      500 z PostgREST, wygasły token) zamienia opłacony spokój w pełny tor
//      przeszkód, a czytelnik nie ma jak tego zgłosić - nic się nie wyświetla
//      jako błąd. Test stanu OCZEKIWANIA obok niego przechodzi normalnie, więc
//      różnica między „intencja zrealizowana" i „intencja pominięta" jest tu
//      widoczna w dwóch sąsiednich testach.
//   2. `clampBudget` NIE PRZEPUSZCZA WARTOŚCI REDAKCYJNEJ, KTÓRA ROZWALIŁABY
//      STRONĘ: ujemna schodzi do 0, ponad 8 przycina się do 8, niecałkowita
//      idzie przez `Math.round` (a nie `floor` - 1,5 to 2 strefy, nie 1),
//      a wartość NIE-LICZBOWA (string z panelu, `null`, `NaN`) wraca do
//      domyślnej. To jest granica między „redaktor wpisał bzdurę" i „artykuł
//      renderuje `NaN` stref".
//   3. WYŁĄCZNIK `reading_mode_ads: false` PRZYWRACA STAN SPRZED FUNKCJI -
//      budżet `Number.POSITIVE_INFINITY`, więc KAŻDA strefa przechodzi, w tym
//      `footer_slideup` o najniższym priorytecie. Wyłącznik, który wycina
//      część stref, byłby gorszy niż brak wyłącznika.
//   4. PEŁNA MACIERZ `POST_AD_PRIORITY` × BUDŻET. Priorytety są kolejnością
//      ważności, więc test przechodzi każdą parę (pozycja, budżet 0..5)
//      i sprawdza `priority < budget`. Przestawienie dwóch pozycji w tabeli
//      (np. `sidebar` przed `mid_post`) przechodzi przez `tsc` i przez
//      recenzję - łapie je wyłącznie asercja na CAŁEJ macierzy.
//   5. POZYCJA POZA TABELĄ PRZECHODZI ZAWSZE. `header_banner` i `in_feed` nie
//      są strefami artykułu (`POST_AD_PRIORITY` jest `Partial`), więc budżet
//      trybu czytania nie ma prawa ich wyciszyć - nawet przy budżecie 0.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Odczytu `site_settings` (`useSiteSetting` ma
// własne testy) - ustawienia wstrzykujemy przez PRE-SEED cache react-query pod
// kluczem `siteSettingsQueryOptions.queryKey`, czyli przez PRAWDZIWY kod
// `resolveSetting`/`deepMerge`, bez atrapy tej warstwy.
//
// DLACZEGO `useCurrentTier` JEST PODMIENIONY. To WEJŚCIE decyzji, nie decyzja.
// Stan `isError` prawdziwego `useQuery` da się wywołać tylko przez wywrócenie
// `fetchCurrentTier`, czyli przez atrapę klienta Supabase - a wtedy test mówi
// o kliencie Supabase, nie o budżecie. Podmieniamy więc dokładnie jedno pole
// (`useCurrentTier`), zachowując resztę modułu, i podajemy te trzy stany,
// które react-query realnie produkuje.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { AdPosition } from "@/lib/ads/types";

/** Stan `useCurrentTier`, jaki test chce podstawić na czas jednego renderu. */
interface TierState {
  isPending: boolean;
  data?: { rank: number } | null;
}

let tierState: TierState = { isPending: false, data: { rank: 1 } };

vi.mock("@/lib/billing/tiers", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/lib/billing/tiers");
  return { ...actual, useCurrentTier: () => tierState };
});

const { POST_AD_PRIORITY, READING_AD_DEFAULTS, useReadingAdBudget } =
  await import("@/lib/ads/readingMode");
const { resetPendingWrites, siteSettingsQueryOptions } = await import("@/lib/useSiteSetting");

/** Stan zapytania: dane dojechały. */
const tierOk = (rank: number): TierState => ({ isPending: false, data: { rank } });
/** Stan zapytania: jeszcze nie wiemy (pierwszy render). */
const tierPending: TierState = { isPending: true, data: undefined };
/**
 * Stan zapytania: BŁĄD. Dokładnie to, co react-query oddaje po nieudanym
 * `queryFn` przy `retry: false` - `isPending` już `false`, `data` nadal puste.
 */
const tierError: TierState = { isPending: false, data: undefined };

/**
 * Renderuje hook z ustawieniami `reading` WSTRZYKNIĘTYMI DO CACHE, a nie
 * zamockowanymi: `useSiteSetting` czyta wspólne zapytanie `site_settings`,
 * więc pre-seed pod jego kluczem przepuszcza wartość przez prawdziwe
 * `resolveSetting` + `deepMerge`. `staleTime` tego zapytania to 10 minut, więc
 * refetch (a z nim dotknięcie Supabase) nigdy nie startuje.
 */
function renderBudget(reading?: Record<string, unknown>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(
    siteSettingsQueryOptions.queryKey,
    Object.freeze(reading ? { reading } : {}),
  );
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(() => useReadingAdBudget(), { wrapper });
}

/** Wszystkie strefy artykułu w kolejności rosnącego priorytetu. */
const ZONES: ReadonlyArray<[AdPosition, number]> = [
  ["top_of_post", 0],
  ["mid_post", 1],
  ["sidebar", 2],
  ["bottom_of_post", 3],
  ["footer_slideup", 4],
];

beforeEach(() => {
  resetPendingWrites();
  tierState = tierOk(1);
});

describe("useReadingAdBudget: ranga planu decyduje o budżecie stref", () => {
  it("płacący (rank > 0) dostaje budżet `max_ad_zones_paid`", () => {
    tierState = tierOk(2);
    const { result } = renderBudget({ max_ad_zones_free: 4, max_ad_zones_paid: 1 });
    // Budżet 1 = przechodzi wyłącznie priorytet 0.
    expect(result.current("top_of_post")).toBe(true);
    expect(result.current("mid_post")).toBe(false);
  });

  it("czytelnik bez planu (rank 0) dostaje budżet `max_ad_zones_free`", () => {
    tierState = tierOk(0);
    const { result } = renderBudget({ max_ad_zones_free: 4, max_ad_zones_paid: 1 });
    expect(result.current("top_of_post")).toBe(true);
    expect(result.current("bottom_of_post")).toBe(true);
    expect(result.current("footer_slideup")).toBe(false);
  });

  it("gość (brak wiersza warstwy, data === null) liczy się jak bez planu", () => {
    tierState = { isPending: false, data: null };
    const { result } = renderBudget({ max_ad_zones_free: 2, max_ad_zones_paid: 0 });
    expect(result.current("top_of_post")).toBe(true);
    expect(result.current("mid_post")).toBe(true);
    expect(result.current("sidebar")).toBe(false);
  });

  it("PODCZAS OCZEKIWANIA obowiązuje budżet PŁACĄCEGO - intencja z komentarza", () => {
    // Ta gałąź jest w kodzie zrealizowana: `isPending ? true`. Trzymamy ją
    // w teście, bo to ona pokazuje, że intencja „lepiej o jedną reklamę za
    // mało" JEST wyrażona - i tym mocniejszy jest zarzut z testu poniżej,
    // że dla stanu BŁĘDU jej zabrakło.
    tierState = tierPending;
    const { result } = renderBudget({ max_ad_zones_free: 5, max_ad_zones_paid: 0 });
    expect(result.current("top_of_post")).toBe(false);
  });

  it.fails(
    "DEFEKT: przy BŁĘDZIE odczytu planu budżet ma zostać przy `max_ad_zones_paid`, " +
      "a spada do `max_ad_zones_free` - awaria daje płacącemu WIĘCEJ reklam",
    () => {
      // Oczekiwanie: nierozstrzygnięta ranga (oczekiwanie ALBO błąd) traktowana
      // jednakowo - budżet płacącego. Produkcja rozgałęzia się tylko na
      // `isPending`, więc stan błędu wpada w gałąź „bez planu".
      tierState = tierError;
      const { result } = renderBudget({ max_ad_zones_free: 5, max_ad_zones_paid: 0 });
      expect(result.current("top_of_post")).toBe(false);
    },
  );

  it("STAN FAKTYCZNY przy błędzie odczytu planu: budżet czytelnika BEZ planu", () => {
    // Ten test opisuje zachowanie, jakie produkcja ma DZIŚ. Istnieje po to, by
    // naprawa defektu wyżej nie przeszła niezauważona: gdy `isError` zacznie
    // być obsługiwane, ten test padnie i trzeba go będzie usunąć razem
    // z `it.fails`.
    tierState = tierError;
    const { result } = renderBudget({ max_ad_zones_free: 5, max_ad_zones_paid: 0 });
    expect(result.current("top_of_post")).toBe(true);
    expect(result.current("footer_slideup")).toBe(true);
  });
});

describe("useReadingAdBudget: wartości domyślne i wyłącznik", () => {
  it("brak wiersza `reading` w site_settings używa READING_AD_DEFAULTS", () => {
    tierState = tierOk(0);
    const { result } = renderBudget(undefined);
    // Domyślnie 2 strefy dla czytelnika bez planu: priorytety 0 i 1.
    expect(READING_AD_DEFAULTS.max_ad_zones_free).toBe(2);
    expect(result.current("top_of_post")).toBe(true);
    expect(result.current("mid_post")).toBe(true);
    expect(result.current("sidebar")).toBe(false);
  });

  it("`reading_mode_ads: false` przepuszcza KAŻDĄ strefę, także footer_slideup", () => {
    tierState = tierOk(3);
    const { result } = renderBudget({
      reading_mode_ads: false,
      max_ad_zones_free: 0,
      max_ad_zones_paid: 0,
    });
    for (const [position] of ZONES) {
      expect(result.current(position), `strefa ${position} przy wyłączonym trybie`).toBe(true);
    }
  });

  it("`reading_mode_ads` innego typu niż boolean wraca do domyślnej (true)", () => {
    // Redaktor zapisuje "false" jako STRING - wtedy `typeof !== "boolean"`
    // i obowiązuje domyślne `true`, czyli budżet DZIAŁA. Gdyby zadziałało
    // rzutowanie prawdziwościowe, niepusty string wyłączyłby budżet i strona
    // artykułu dostałaby wszystkie strefy naraz.
    tierState = tierOk(0);
    const { result } = renderBudget({
      reading_mode_ads: "false",
      max_ad_zones_free: 1,
      max_ad_zones_paid: 0,
    });
    expect(result.current("top_of_post")).toBe(true);
    expect(result.current("mid_post")).toBe(false);
  });
});

describe("clampBudget: wartość redakcyjna nie może wyprodukować NaN stref", () => {
  /** Ile stref artykułu przechodzi przy danym ustawieniu (dla rank 0). */
  function zonesAllowed(reading: Record<string, unknown>): number {
    tierState = tierOk(0);
    const { result } = renderBudget(reading);
    return ZONES.filter(([position]) => result.current(position)).length;
  }

  it("wartość ujemna schodzi do 0 - żadna strefa artykułu nie przechodzi", () => {
    expect(zonesAllowed({ max_ad_zones_free: -3 })).toBe(0);
  });

  it("wartość powyżej 8 przycina się do 8 - wszystkie 5 stref przechodzi", () => {
    expect(zonesAllowed({ max_ad_zones_free: 999 })).toBe(ZONES.length);
  });

  it("1,5 zaokrągla się DO GÓRY (Math.round), czyli daje 2 strefy", () => {
    // `Math.floor` dałby 1. Różnica jest widoczna dla czytelnika: jedna
    // reklama w środku artykułu albo jej brak.
    expect(zonesAllowed({ max_ad_zones_free: 1.5 })).toBe(2);
  });

  it("1,4 zaokrągla się W DÓŁ, czyli daje 1 strefę", () => {
    expect(zonesAllowed({ max_ad_zones_free: 1.4 })).toBe(1);
  });

  it.each([
    ["string z panelu", "3"],
    ["null", null],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["obiekt", {}],
  ])("wartość nie-liczbowa (%s) wraca do domyślnej 2", (_label, value) => {
    // `Infinity` też: `Number.isFinite` je odrzuca, więc budżet nie ucieka
    // w nieskończoność przez literówkę w JSON-ie ustawień.
    expect(zonesAllowed({ max_ad_zones_free: value })).toBe(READING_AD_DEFAULTS.max_ad_zones_free);
  });

  it("0 jest wartością PRAWIDŁOWĄ, nie brakiem wartości", () => {
    // Klasyczny błąd tego repo: `||` podmieniłby 0 na domyślne 2, czyli
    // redaktor ustawiający „zero reklam" dostałby dwie.
    expect(zonesAllowed({ max_ad_zones_free: 0 })).toBe(0);
  });
});

describe("POST_AD_PRIORITY: pełna macierz pozycja × budżet", () => {
  it("kolejność ważności stref jest dokładnie ta, na której stoi budżet", () => {
    // Asercja na CAŁEJ tabeli, a nie na pojedynczych wpisach: przestawienie
    // `sidebar` i `mid_post` przechodzi przez typy i przez recenzję.
    expect(POST_AD_PRIORITY).toEqual({
      top_of_post: 0,
      mid_post: 1,
      sidebar: 2,
      bottom_of_post: 3,
      footer_slideup: 4,
    });
  });

  it.each([0, 1, 2, 3, 4, 5])("budżet %i przepuszcza dokładnie strefy o priorytecie < N", (n) => {
    tierState = tierOk(0);
    const { result } = renderBudget({ max_ad_zones_free: n });
    for (const [position, priority] of ZONES) {
      expect(
        result.current(position),
        `${position} (priorytet ${priority}) przy budżecie ${n}`,
      ).toBe(priority < n);
    }
  });

  it.each(["header_banner", "in_feed"] as const)(
    "pozycja poza tabelą (%s) przechodzi także przy budżecie 0",
    (position) => {
      // Te dwie pozycje nie są strefami ARTYKUŁU. Budżet trybu czytania nie
      // ma prawa ich wyciszyć - inaczej wyłączyłby banner nagłówka na całym
      // serwisie przy okazji ustawienia „zero reklam w artykule".
      tierState = tierOk(0);
      const { result } = renderBudget({ max_ad_zones_free: 0, max_ad_zones_paid: 0 });
      expect(POST_AD_PRIORITY[position]).toBeUndefined();
      expect(result.current(position)).toBe(true);
    },
  );
});
