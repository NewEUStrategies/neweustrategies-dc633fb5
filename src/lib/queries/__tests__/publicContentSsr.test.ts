// @vitest-environment node
//
// USTAWIENIA CZYTANIA NA SERWERZE - skąd render SSR bierze decyzję „co jest
// stroną główną" i co się dzieje, gdy jej nie dostanie.
//
// CO TO DOWODZI. `fetchReadingSettings` w `src/lib/queries/public.ts:392-411`
// ma DWIE rozłączne implementacje wybierane środowiskiem wykonania, więc nie da
// się ich pokryć w jednym pliku:
//
//   * NA SERWERZE (brak `window` + `import.meta.env.SSR`) klucz `reading` jest
//     czytany z BULK-mapy wszystkich ustawień, którą root loader i tak już
//     rozgrzał. To jest cała treść tej optymalizacji i jedyny jej sprawdzalny
//     skutek: render SSR NIE MOŻE zrobić własnego, jednowierszowego selecta na
//     `site_settings`. Wcześniej home-mode i home-page czytały ten sam zapis
//     dwoma osobnymi round-tripami na KAŻDĄ rewalidację strony głównej;
//   * WARTOŚĆ USZKODZONA TO NIE DECYZJA. Gdy pod kluczem `reading` siedzi
//     tekst, liczba albo `null` (stary zapis, ręczna edycja, literówka w
//     migracji), kod oddaje pusty obiekt zamiast przepuścić śmieci do
//     normalizacji trybu - inaczej `homepage_mode` czytałby pole z wartości
//     skalarnej i wywalał render;
//   * AWARIA BULK-ODCZYTU JEST POŁYKANA. `catch { return {} }` (linie 401-403)
//     zamienia odmowę bazy w „operator nic nie ustawił" i NIE próbuje już
//     taniego selecta. Ma to widoczny skutek dla czytelnika, więc obok
//     przypadku przypinającego stan faktyczny stoi `it.fails` z konsekwencją.
//
// JAK. Środowisko `node` (brak `window`, `import.meta.env.SSR === true`), więc
// biegnie DOKŁADNIE gałąź serwerowa. Zaślepione są trzy granice: bulk-czytnik
// ustawień (`@/lib/useSiteSetting`), klient Supabase (żeby dowieść, że NIE
// został użyty) i cache brzegowy. Zero sieci, zero sekretów, zero prawdziwego
// zegara.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
//   * gałęzi PRZEGLĄDARKOWEJ tej samej funkcji (jednowierszowy select po
//     `key = "reading"`) - biegnie w happy-dom i pokrywają ją
//     `src/lib/queries/__tests__/homepageMode.test.ts` oraz
//     `publicContent.test.ts`;
//   * `normalizeHomepageMode` jako czystej funkcji - `homepageMode.test.ts`;
//   * mechaniki samego bulk-czytnika (`fetchAllSiteSettings`: zakres najemcy,
//     cache, kształt mapy) - to jego własny moduł i jego własne testy; tutaj
//     jest atrapą i sprawdzam tylko, ŻE został użyty i co kod robi z odpowiedzią;
//   * stripu bramek buildera na serwerze - `src/lib/builder/__tests__/
//     publicBuilderAccessStrip.test.ts` (też środowisko `node`).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { ok, type SupabaseFromStub } from "@/test/supabaseChain";

/** Data bazowa całego pliku - żaden przypadek nie czyta prawdziwego zegara. */
const DATA_BAZOWA = "2026-08-21T10:00:00.000Z";

const h = vi.hoisted(() => ({
  from: null as SupabaseFromStub | null,
  cache: [] as Array<{ key: string; ttl: number }>,
  ustawienia: vi.fn<() => Promise<Record<string, unknown>>>(),
}));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabase/chain");
  const from = supabaseFromStub();
  h.from = from;
  return { supabase: { from: from.from, rpc: async () => ok(null) } };
});

vi.mock("@/lib/useSiteSetting", () => ({ fetchAllSiteSettings: h.ustawienia }));

vi.mock("@/lib/ssrCache", () => ({
  edgeTtlCache: async <T>(key: string, ttl: number, fn: () => Promise<T>): Promise<T> => {
    h.cache.push({ key, ttl });
    return fn();
  },
}));

import { homepageModeQueryOptions } from "@/lib/queries/public";

/** Atrapa łańcucha PostgREST podpięta przez fabrykę `vi.mock`. */
function baza(): SupabaseFromStub {
  const s = h.from;
  if (!s) throw new Error("test: atrapa łańcucha Supabase nie została podpięta");
  return s;
}

function klient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(DATA_BAZOWA));
  baza().reset();
  h.cache.length = 0;
  h.ustawienia.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ustawienia czytania na SSR: jeden bulk-odczyt zamiast round-tripu na klucz", () => {
  it("render serwerowy czyta tryb z rozgrzanej mapy i NIE robi własnego selecta", async () => {
    h.ustawienia.mockResolvedValue({ reading: { homepage_mode: "latest_posts" } });

    await expect(klient().fetchQuery(homepageModeQueryOptions())).resolves.toBe("latest_posts");
    expect(h.ustawienia).toHaveBeenCalledTimes(1);
    // To jest CAŁA teza tej gałęzi: zero dodatkowych round-tripów na
    // rewalidację strony głównej.
    expect(baza().chainsFor("site_settings")).toHaveLength(0);
    expect(h.cache).toEqual([{ key: "public:home-mode", ttl: 60_000 }]);
  });

  it("mapa BEZ klucza `reading` to brak decyzji, nie awaria", async () => {
    h.ustawienia.mockResolvedValue({ branding: { logo: "x" } });
    await expect(klient().fetchQuery(homepageModeQueryOptions())).resolves.toBe("");
  });

  it("wartość skalarna pod kluczem `reading` nie przecieka do normalizacji trybu", async () => {
    // Stary zapis albo ręczna edycja: `reading` jako tekst. Bez tego warunku
    // kod czytałby `.homepage_mode` ze stringa i oddawał `undefined` z innego
    // miejsca niż zamierzone.
    h.ustawienia.mockResolvedValue({ reading: "static_page" });
    await expect(klient().fetchQuery(homepageModeQueryOptions())).resolves.toBe("");
  });

  it('`reading: null` też jest brakiem decyzji (typeof null === "object")', async () => {
    // Pułapka JavaScriptu: bez jawnego `reading !== null` `null` przeszedłby
    // testem `typeof === "object"` i poleciałby dalej jako obiekt ustawień.
    h.ustawienia.mockResolvedValue({ reading: null });
    await expect(klient().fetchQuery(homepageModeQueryOptions())).resolves.toBe("");
  });

  it("STAN FAKTYCZNY: odmowa bulk-odczytu wygląda jak „operator nic nie ustawił”", async () => {
    h.ustawienia.mockRejectedValue(new Error("odmowa site_settings"));
    await expect(klient().fetchQuery(homepageModeQueryOptions())).resolves.toBe("");
    // Połknięcie jest domknięte: kod NIE próbuje już taniego selecta.
    expect(baza().chainsFor("site_settings")).toHaveLength(0);
  });

  it.fails(
    "AWARIA odczytu ustawień POWINNA być odróżnialna od serwisu bez wybranego trybu",
    async () => {
      // DEFEKT. `src/lib/queries/public.ts:393-404`: gałąź serwerowa
      // `fetchReadingSettings` owija bulk-odczyt w `try`, a `catch` na liniach
      // 401-403 oddaje `{}` - bez logu, bez sygnału i BEZ próby taniego selecta
      // z linii 405-410.
      // MECHANIZM: `{}` przechodzi przez `normalizeHomepageMode(undefined)`
      // (linia 421) i daje `""`, czyli DOKŁADNIE ten sam stan, co serwis, w
      // którym nikt nigdy nie wybrał trybu strony głównej. `homePageQueryOptions`
      // (linia 469) sprawdza tylko `=== "latest_posts"`, więc przy `""` schodzi
      // na rezolucję strony statycznej i dalej na fallback `slug = "home"`.
      // KONSEKWENCJA DLA UŻYTKOWNIKA: serwis skonfigurowany na „najnowsze
      // wpisy" pokazuje pod adresem „/” starą stronę `home` razem z jej
      // `head()` - tytułem, `canonical`, `og:image` i `seo_noindex`. Wynik
      // trafia do `edgeTtlCache` na 60 s, więc jedna odmowa obsługuje wszystkie
      // kolejne żądania w tym oknie; przy `seo_noindex = true` na stronie
      // `home` potrafi to zdeindeksować stronę główną.
      // DLACZEGO TO DECYZJA CZŁOWIEKA: naprawa to wybór między rzuceniem
      // wyjątku (strona główna na 500, gdy nie da się odczytać ustawień),
      // degradacją do jednowierszowego selecta (drugi round-trip w ścieżce,
      // której optymalizacja była całym celem tej gałęzi) a zapamiętaniem
      // „nie wiem" w kontrakcie `HomepageMode`, czytanym przez `routes/index.tsx`.
      // Trzeba też rozstrzygnąć, czy taki wynik wolno zapisać w cache brzegowym.
      h.ustawienia.mockRejectedValue(new Error("odmowa site_settings"));
      await expect(klient().fetchQuery(homepageModeQueryOptions())).rejects.toThrow();
    },
  );
});
