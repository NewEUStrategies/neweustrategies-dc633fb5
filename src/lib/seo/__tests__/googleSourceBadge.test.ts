// CO DOWODZI TEN PLIK
// Konfiguracja badge „Preferowane źródło w Google"
// (`src/lib/seo/googleSourceBadge.ts`) - do 22.08.2026 ZERO wykonanych linii.
// Badge stoi w stopce i przy każdym artykule, a jego konfiguracja przychodzi
// z `site_settings[key="google_source_badge"]` - czyli z JSON-a wpisywanego w
// panelu, bez migracji i bez kolumn. Dlatego przedmiotem dowodu jest ODPORNOŚĆ
// czytnika tej wartości:
//   1. `googlePreferredSourceUrl` - domena domyślna, podana i taka, która
//      WYMAGA kodowania (spacja, polski znak, `&`): parametr `q` idzie do
//      panelu Google, więc niezakodowany `&` uciąłby zapytanie.
//   2. Klamry zakresu (`clampMargin` 0-48, `clampLogoSize` 10-32) na pełnej
//      macierzy wejść z bazy: liczba, liczba w napisie, napis nieliczbowy,
//      `null`, `undefined`, `NaN`, `Infinity`, wartość ułamkowa (zaokrąglenie).
//   3. Wybór adresu per język (`resolveBadgeHref`) i logotypu per motyw
//      (`resolveBadgeLogo`) razem z KAŻDYM ramieniem spadku.
//   4. TRZY RÓŻNE STANY UKRYCIA: wyłącznik główny, wyłącznik `desktop`,
//      wyłącznik `mobile` - z dowodem, że ukrycie na jednym breakpoincie NIE
//      ukrywa drugiego.
//   5. HOOK `useGoogleSourceBadgeConfig` na prawdziwej ścieżce odczytu
//      (`useSiteSetting` -> `deepMerge` -> atrapa PostgREST, ZERO sieci):
//      wartość BRAK -> dokładnie obiekt domyślny; wartość CZĘŚCIOWA ->
//      deep-merge, w którym zagnieżdżone `logo`/`desktop`/`mobile` NIE zostają
//      `undefined`; wartość USZKODZONA (zły typ, `align` spoza zbioru,
//      margines poza 0-48, rozmiar poza 10-32) -> BEZ wyjątku; oraz brak
//      QueryClientProvidera -> domyślki i ZERO odczytów bazy.
//   6. DEFEKT klasy „Header crash": `deepMerge` chroni przed BRAKUJĄCYM
//      kluczem zagnieżdżonym, ale nie przed zapisanym JAWNIE `null`, a ten
//      czytnik nie ma schematu Zod, więc nie spada na domyślki (patrz
//      `it.fails` na końcu pliku).
//
// CZEGO ŚWIADOMIE NIE DUBLUJE
//   - `src/components/seo/__tests__/GooglePreferredSourceBadge.test.tsx` -
//     testy „wybiera adres per język i spada do domyślnego", „dobiera logo do
//     motywu z fallbackiem", „ogranicza marginesy i rozmiar sygnetu",
//     „mapuje wyrównanie i marginesy na style" i „respektuje włącznik globalny
//     i per breakpoint" biorą po jednym wejściu na helper oraz cały RENDER
//     komponentu (atrybuty `data-*`, `<img>`, klasy). Tutaj nie renderuję
//     ANI JEDNEGO komponentu; wchodzę wyłącznie w wejścia, których tamten plik
//     nie ma: kodowanie domeny, pełna macierz klamr, `null` z bazy w miejscu
//     napisu, wyłącznik `desktop`, hook i deep-merge.
//   - `src/lib/__tests__` dla `useSiteSetting`/`deepMerge` - kontrakt bulk
//     query, `staleTime`, kolejka niepotwierdzonych zapisów i ochrona przed
//     zatruciem prototypu należą do tamtej warstwy. Tutaj przez `useSiteSetting`
//     przechodzę PRAWDZIWIE tylko po to, żeby uszkodzona wartość dotarła do
//     badge dokładnie tak, jak dotrze w produkcji.
//   - `src/lib/seo/__tests__/googleSourceBadgeAnalytics.test.ts` - podwójny
//     beacon kliknięcia (osobny moduł, osobny plik).
//   - `src/routes/admin.settings.google-source.tsx` - formularz zapisu.
//   - `e2e/seo.spec.ts` - ten plik nie styka się z nim wcale: żaden z 15
//     testów e2e nie sprawdza badge ani `site_settings`, a najbliższe (testy
//     „head contract on …") mierzą BAJTY `<head>` na żywym SSR, gdy tutaj nie
//     ma ani serwera, ani żądania HTTP - jedynym wejściem jest atrapa
//     łańcucha PostgREST.
//   - RLS i RPC tabeli `site_settings` - domena pgTAP.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { ok, type SupabaseFromStub } from "@/test/supabaseChain";
import { renderHookWithQueryClient } from "@/test/renderWithQueryClient";

const stubs = vi.hoisted(() => ({ from: null as SupabaseFromStub | null }));

// ZERO SIECI: cały odczyt `site_settings` idzie przez atrapę łańcucha
// PostgREST. `edgeTtlCache` w środowisku z `window` (happy-dom) woła fetcher
// wprost, więc między testami nie ma cache'u do czyszczenia.
vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const from = supabaseFromStub();
  stubs.from = from;
  return { supabase: { from: from.from } };
});

import { siteSettingsQueryOptions } from "@/lib/useSiteSetting";
import {
  GOOGLE_PREFERRED_SOURCE_DOMAIN,
  GOOGLE_SOURCE_BADGE_DEFAULTS,
  GOOGLE_SOURCE_BADGE_SETTINGS_KEY,
  alignClass,
  clampLogoSize,
  clampMargin,
  googlePreferredSourceUrl,
  isBadgeVisible,
  placementStyle,
  resolveBadgeHref,
  resolveBadgeLogo,
  useGoogleSourceBadgeConfig,
  type GoogleSourceBadgeConfig,
  type GoogleSourceBadgeLogo,
  type GoogleSourceBadgePlacement,
} from "@/lib/seo/googleSourceBadge";

/** Atrapa klienta - brak inicjalizacji ma być BŁĘDEM testu, nie cichym `[]`. */
function stub(): SupabaseFromStub {
  const s = stubs.from;
  if (!s) throw new Error("atrapa supabase nie została zainicjalizowana");
  return s;
}

const DEFAULT_URL = googlePreferredSourceUrl();

/** Konfiguracja domyślna z punktowym nadpisaniem - dla helperów czystych. */
const cfg = (patch: Partial<GoogleSourceBadgeConfig> = {}): GoogleSourceBadgeConfig => ({
  ...GOOGLE_SOURCE_BADGE_DEFAULTS,
  ...patch,
});

const placement = (
  patch: Partial<GoogleSourceBadgePlacement> = {},
): GoogleSourceBadgePlacement => ({
  ...GOOGLE_SOURCE_BADGE_DEFAULTS.desktop,
  ...patch,
});

const logo = (patch: Partial<GoogleSourceBadgeLogo> = {}): GoogleSourceBadgeLogo => ({
  ...GOOGLE_SOURCE_BADGE_DEFAULTS.logo,
  ...patch,
});

/** Wiersze, jakie zwróci `select("key,value")` na tabeli `site_settings`. */
function planSettings(rows: ReadonlyArray<{ key: string; value: unknown }>): void {
  stub().setResponse("site_settings", ok([...rows]));
}

/**
 * Odczyt konfiguracji PRZEZ HOOK z zapisaną w bazie wartością.
 *
 * Czekanie jest na ZMIANIE TOŻSAMOŚCI wyniku, nie na `setTimeout`: przy braku
 * danych `resolveSetting` oddaje sam obiekt domyślny, a po deep-merge nowy -
 * więc `not.toBe(GOOGLE_SOURCE_BADGE_DEFAULTS)` jest deterministycznym
 * sygnałem „wiersz z bazy już wpłynął".
 *
 * To jest jedyna droga, którą wartość NIEZGODNA Z TYPEM (`null` w miejscu
 * napisu, `align: "middle"`) trafia do helperów bez ani jednego rzutowania w
 * teście - dokładnie tak, jak trafia w produkcji.
 */
async function readStoredConfig(stored: unknown): Promise<GoogleSourceBadgeConfig> {
  planSettings([{ key: GOOGLE_SOURCE_BADGE_SETTINGS_KEY, value: stored }]);
  const { result } = renderHookWithQueryClient(() => useGoogleSourceBadgeConfig());
  await waitFor(() => expect(result.current).not.toBe(GOOGLE_SOURCE_BADGE_DEFAULTS));
  return result.current;
}

beforeEach(() => {
  stub().reset();
});

describe("googlePreferredSourceUrl", () => {
  it("bez argumentu celuje w domenę serwisu", () => {
    expect(GOOGLE_PREFERRED_SOURCE_DOMAIN).toBe("neweuropeanstrategies.com");
    expect(googlePreferredSourceUrl()).toBe(
      "https://google.com/preferences/source?q=neweuropeanstrategies.com",
    );
    expect(GOOGLE_SOURCE_BADGE_DEFAULTS.url_pl).toBe(googlePreferredSourceUrl());
    expect(GOOGLE_SOURCE_BADGE_DEFAULTS.url_en).toBe(googlePreferredSourceUrl());
  });

  it("przyjmuje domenę podaną jawnie (multi-tenant)", () => {
    expect(googlePreferredSourceUrl("example.org")).toBe(
      "https://google.com/preferences/source?q=example.org",
    );
  });

  it.each([
    ["spacja", "moja domena.pl", "moja%20domena.pl"],
    ["polski znak", "kraków.pl", "krak%C3%B3w.pl"],
    ["ampersand", "a&b.pl", "a%26b.pl"],
    ["znak zapytania", "a?b.pl", "a%3Fb.pl"],
  ])("koduje domenę wymagającą kodowania - %s", (_case, domain, encoded) => {
    // KONSEKWENCJA braku kodowania: niezakodowany `&` uciąłby parametr `q`,
    // a Google dostałby pustą albo obcą domenę do „preferowanego źródła".
    const url = googlePreferredSourceUrl(domain);
    expect(url).toBe(`https://google.com/preferences/source?q=${encoded}`);
    expect(url).not.toContain(domain);
  });

  it("pusta domena daje pusty parametr, a nie wyjątek", () => {
    expect(googlePreferredSourceUrl("")).toBe("https://google.com/preferences/source?q=");
  });
});

describe("klamry zakresu wpisane w adminie", () => {
  it.each([
    ["dolna granica", 0, 0],
    ["górna granica", 48, 48],
    ["poniżej zakresu", -7, 0],
    ["powyżej zakresu", 999, 48],
    ["ułamek w dół", 12.4, 12],
    ["ułamek w górę", 12.5, 13],
    ["liczba w napisie", "24", 24],
    ["napis nieliczbowy", "abc", 0],
    ["pusty napis", "", 0],
    ["null", null, 0],
    ["undefined", undefined, 0],
    ["NaN", Number.NaN, 0],
    ["Infinity", Number.POSITIVE_INFINITY, 0],
    ["-Infinity", Number.NEGATIVE_INFINITY, 0],
    ["obiekt", {}, 0],
    ["prawda logiczna", true, 1],
  ])("clampMargin: %s", (_case, input, expected) => {
    expect(clampMargin(input)).toBe(expected);
  });

  it.each([
    ["dolna granica", 10, 10],
    ["górna granica", 32, 32],
    ["poniżej zakresu", 4, 10],
    ["powyżej zakresu", 99, 32],
    ["liczba w napisie", "18", 18],
    ["ułamek", 17.6, 18],
    ["napis nieliczbowy", "duży", 14],
    ["null", null, 10],
    ["undefined", undefined, 14],
  ])("clampLogoSize: %s", (_case, input, expected) => {
    expect(clampLogoSize(input)).toBe(expected);
  });

  it("spadek rozmiaru sygnetu to 14 px, a NIE 18 px z konfiguracji domyślnej", () => {
    // Przypięcie faktycznej rozbieżności: wartość nieczytelna jako liczba
    // daje 14, choć `GOOGLE_SOURCE_BADGE_DEFAULTS.logo.size` to 18. Redakcja,
    // która wpisze śmieć w rozmiar, dostanie sygnet MNIEJSZY niż domyślny -
    // to zamierzone (14 to bezpieczne minimum czytelności), ale nie jest
    // oczywiste i nie może się zmienić po cichu.
    expect(GOOGLE_SOURCE_BADGE_DEFAULTS.logo.size).toBe(18);
    expect(clampLogoSize("nie-liczba")).toBe(14);
    expect(clampLogoSize(GOOGLE_SOURCE_BADGE_DEFAULTS.logo.size)).toBe(18);
  });
});

describe("resolveBadgeHref", () => {
  it.each([
    ["pl", "https://pl.example"],
    ["PL", "https://pl.example"],
    ["pl-PL", "https://pl.example"],
    ["de", "https://pl.example"],
    ["", "https://pl.example"],
    ["en", "https://en.example"],
    ["EN", "https://en.example"],
    ["en-GB", "https://en.example"],
    ["en_US", "https://en.example"],
  ])("dla języka %s wybiera %s", (lang, expected) => {
    const config = cfg({ url_pl: "https://pl.example", url_en: "https://en.example" });
    expect(resolveBadgeHref(config, lang)).toBe(expected);
  });

  it("obcina białe znaki wokół adresu wpisanego w panelu", () => {
    expect(resolveBadgeHref(cfg({ url_pl: "  https://pl.example  " }), "pl")).toBe(
      "https://pl.example",
    );
  });

  it.each([
    ["pusty", ""],
    ["same spacje", "   "],
    ["tabulator", "\t\n"],
  ])("adres %s spada na panel Google dla naszej domeny", (_case, stored) => {
    expect(resolveBadgeHref(cfg({ url_pl: stored, url_en: stored }), "pl")).toBe(DEFAULT_URL);
    expect(resolveBadgeHref(cfg({ url_pl: stored, url_en: stored }), "en")).toBe(DEFAULT_URL);
  });
});

describe("resolveBadgeLogo", () => {
  it("motyw ciemny: własny ciemny wygrywa, brak ciemnego spada na jasny", () => {
    expect(resolveBadgeLogo(logo({ light: "l.png", dark: "d.png" }), "dark")).toBe("d.png");
    expect(resolveBadgeLogo(logo({ light: "l.png", dark: "" }), "dark")).toBe("l.png");
  });

  it("motyw jasny: własny jasny wygrywa, brak jasnego spada na ciemny", () => {
    // Ramię `light || dark` - jedyna droga, żeby redakcja podająca WYŁĄCZNIE
    // logotyp ciemny nie zobaczyła w trybie jasnym wbudowanego sygnetu.
    expect(resolveBadgeLogo(logo({ light: "l.png", dark: "d.png" }), "light")).toBe("l.png");
    expect(resolveBadgeLogo(logo({ light: "", dark: "d.png" }), "light")).toBe("d.png");
  });

  it.each([
    ["oba puste", "", ""],
    ["oba na samych spacjach", "   ", " \t "],
  ])("%s = wbudowany sygnet Google (null)", (_case, light, dark) => {
    expect(resolveBadgeLogo(logo({ light, dark }), "light")).toBeNull();
    expect(resolveBadgeLogo(logo({ light, dark }), "dark")).toBeNull();
  });

  it("obcina białe znaki wokół adresu logotypu", () => {
    expect(resolveBadgeLogo(logo({ light: "  l.png  ", dark: "  " }), "light")).toBe("l.png");
  });
});

describe("alignClass i placementStyle", () => {
  it.each([
    ["start", "justify-start"],
    ["center", "justify-center"],
    ["end", "justify-end"],
  ] as const)("wyrównanie %s -> %s", (align, expected) => {
    expect(alignClass(align)).toBe(expected);
  });

  it("marginesy poza zakresem są klamrowane po drodze do stylu inline", () => {
    expect(placementStyle(placement({ marginTop: 999, marginBottom: -4, marginX: 12.5 }))).toEqual({
      marginTop: 48,
      marginBottom: 0,
      marginLeft: 13,
      marginRight: 13,
    });
  });

  it("marginX trafia symetrycznie na lewą i prawą krawędź", () => {
    expect(placementStyle(placement({ marginX: 6 }))).toEqual({
      marginTop: 0,
      marginBottom: 0,
      marginLeft: 6,
      marginRight: 6,
    });
  });
});

describe("isBadgeVisible - trzy różne stany ukrycia", () => {
  it("wyłącznik GŁÓWNY gasi badge na obu breakpointach", () => {
    const off = cfg({ enabled: false });
    expect(isBadgeVisible(off, "desktop")).toBe(false);
    expect(isBadgeVisible(off, "mobile")).toBe(false);
  });

  it("wyłącznik DESKTOP nie rusza wersji mobilnej", () => {
    const config = cfg({ desktop: placement({ enabled: false }) });
    expect(isBadgeVisible(config, "desktop")).toBe(false);
    expect(isBadgeVisible(config, "mobile")).toBe(true);
  });

  it("wyłącznik MOBILE nie rusza wersji desktopowej", () => {
    const config = cfg({
      mobile: { ...GOOGLE_SOURCE_BADGE_DEFAULTS.mobile, enabled: false },
    });
    expect(isBadgeVisible(config, "mobile")).toBe(false);
    expect(isBadgeVisible(config, "desktop")).toBe(true);
  });

  it("domyślnie widoczny wszędzie", () => {
    expect(isBadgeVisible(cfg(), "desktop")).toBe(true);
    expect(isBadgeVisible(cfg(), "mobile")).toBe(true);
  });
});

describe("useGoogleSourceBadgeConfig", () => {
  it("POZA QueryClientProviderem oddaje domyślki i NIE czyta bazy", () => {
    // Podglądy w adminie i testy jednostkowe komponentu montują badge bez
    // providera - hook ma wtedy działać „jak z pudełka", a nie wywracać
    // renderu ani wysyłać zapytania.
    planSettings([]);
    const first = renderHook(() => useGoogleSourceBadgeConfig());
    expect(first.result.current).toBe(GOOGLE_SOURCE_BADGE_DEFAULTS);
    // Drugi montaż korzysta z tego samego zapasowego klienta (`??=`).
    const second = renderHook(() => useGoogleSourceBadgeConfig());
    expect(second.result.current).toBe(GOOGLE_SOURCE_BADGE_DEFAULTS);
    expect(stub().chainsFor("site_settings")).toHaveLength(0);
  });

  it("BRAK wpisu w site_settings daje DOKŁADNIE obiekt domyślny", async () => {
    planSettings([{ key: "inne_ustawienie", value: { foo: 1 } }]);
    const { result, queryClient } = renderHookWithQueryClient(() => useGoogleSourceBadgeConfig());
    await waitFor(() =>
      expect(queryClient.getQueryData(siteSettingsQueryOptions.queryKey)).toBeDefined(),
    );
    expect(result.current).toBe(GOOGLE_SOURCE_BADGE_DEFAULTS);
    const chain = stub().lastChain("site_settings");
    expect(chain?.argsOf("select")).toEqual(["key,value"]);
    expect(stub().chainsFor("site_settings")).toHaveLength(1);
  });

  it("wartość CZĘŚCIOWA jest deep-mergowana - żaden klucz zagnieżdżony nie ginie", async () => {
    const config = await readStoredConfig({
      url_pl: "https://pl.example/preferred",
      desktop: { align: "center" },
    });
    expect(config.url_pl).toBe("https://pl.example/preferred");
    expect(config.url_en).toBe(DEFAULT_URL);
    expect(config.desktop.align).toBe("center");
    // Rodzeństwo w nadpisanym obiekcie ZOSTAJE - to jest sedno deep-merge'u.
    expect(config.desktop.variant).toBe(GOOGLE_SOURCE_BADGE_DEFAULTS.desktop.variant);
    expect(config.desktop.enabled).toBe(true);
    expect(config.desktop.marginTop).toBe(0);
    expect(config.mobile).toEqual(GOOGLE_SOURCE_BADGE_DEFAULTS.mobile);
    expect(config.logo).toEqual(GOOGLE_SOURCE_BADGE_DEFAULTS.logo);
    for (const key of ["enabled", "url_pl", "url_en", "logo", "desktop", "mobile"] as const) {
      expect(config[key], `klucz ${key} zniknął po deep-merge`).not.toBeUndefined();
    }
  });

  it("wyłącznik GŁÓWNY zapisany w bazie gasi badge", async () => {
    const config = await readStoredConfig({ enabled: false });
    expect(config.enabled).toBe(false);
    expect(isBadgeVisible(config, "desktop")).toBe(false);
    expect(isBadgeVisible(config, "mobile")).toBe(false);
  });

  it("wyłącznik zapisany tylko dla DESKTOP zostawia mobile widoczne", async () => {
    const config = await readStoredConfig({ desktop: { enabled: false } });
    expect(isBadgeVisible(config, "desktop")).toBe(false);
    expect(isBadgeVisible(config, "mobile")).toBe(true);
  });

  it("wyłącznik zapisany tylko dla MOBILE zostawia desktop widoczny", async () => {
    const config = await readStoredConfig({ mobile: { enabled: false } });
    expect(isBadgeVisible(config, "mobile")).toBe(false);
    expect(isBadgeVisible(config, "desktop")).toBe(true);
  });

  it("wartość USZKODZONA nie rzuca - helpery kleją ją do bezpiecznych wartości", async () => {
    const config = await readStoredConfig({
      // Wartości spoza dozwolonego zbioru i poza zakresem, dokładnie w takim
      // kształcie, w jakim mogą leżeć w kolumnie JSON po ręcznej edycji.
      url_pl: 12345,
      logo: { size: 99, light: "", dark: "" },
      desktop: { align: "middle", variant: "neon", marginTop: 999, marginBottom: -3, marginX: 60 },
    });
    expect(alignClass(config.desktop.align)).toBe("justify-start");
    expect(placementStyle(config.desktop)).toEqual({
      marginTop: 48,
      marginBottom: 0,
      marginLeft: 48,
      marginRight: 48,
    });
    expect(clampLogoSize(config.logo.size)).toBe(32);
    // Wariant spoza zbioru NIE spada na „default" - komponent traktuje go jak
    // wariant nieznany (ani `icon`, ani `compact`), czyli renderuje pełny.
    expect(config.desktop.variant).toBe("neon");
    // Adres zapisany jako liczba nie jest napisem, więc `resolveBadgeHref`
    // rzuca - przypinam FAKTYCZNY stan, patrz `it.fails` niżej.
    expect(() => resolveBadgeHref(config, "pl")).toThrow(TypeError);
  });

  it('null w miejscu adresu spada na panel Google (ramię `?? ""`)', async () => {
    const config = await readStoredConfig({ url_pl: null, url_en: null });
    expect(config.url_pl).toBeNull();
    expect(resolveBadgeHref(config, "pl")).toBe(DEFAULT_URL);
    expect(resolveBadgeHref(config, "en")).toBe(DEFAULT_URL);
  });

  it('null w miejscu logotypu spada na wbudowany sygnet (ramię `?.trim() ?? ""`)', async () => {
    const oba = await readStoredConfig({ logo: { light: null, dark: null } });
    expect(resolveBadgeLogo(oba.logo, "light")).toBeNull();
    expect(resolveBadgeLogo(oba.logo, "dark")).toBeNull();
    const tylkoCiemny = await readStoredConfig({ logo: { light: null, dark: "d.png" } });
    expect(resolveBadgeLogo(tylkoCiemny.logo, "light")).toBe("d.png");
    expect(resolveBadgeLogo(tylkoCiemny.logo, "dark")).toBe("d.png");
  });
});

describe("uszkodzone klucze ZAGNIEŻDŻONE - stan faktyczny i defekt", () => {
  it("STAN FAKTYCZNY: jawny null zagnieżdżony przechodzi przez deep-merge i wywraca helpery", async () => {
    // To jest przypięcie, nie życzenie. `deepMerge` scala tylko obiekty proste,
    // więc zapisane JAWNIE `null` NADPISUJE domyślny podobiekt, a
    // `resolveSetting` bez schematu Zod nie ma czym tego odrzucić.
    const brakLogo = await readStoredConfig({ logo: null });
    expect(brakLogo.logo).toBeNull();
    expect(() => resolveBadgeLogo(brakLogo.logo, "light")).toThrow(TypeError);

    const brakDesktop = await readStoredConfig({ desktop: null });
    expect(brakDesktop.desktop).toBeNull();
    expect(() => isBadgeVisible(brakDesktop, "desktop")).toThrow(TypeError);

    const brakMobile = await readStoredConfig({ mobile: null });
    expect(brakMobile.mobile).toBeNull();
    expect(() => isBadgeVisible(brakMobile, "mobile")).toThrow(TypeError);
  });

  it.fails(
    "DEFEKT: jawny null w logo/desktop/mobile POWINIEN spaść na domyślki, a nie zostać nullem",
    async () => {
      // KONSEKWENCJA DLA UŻYTKOWNIKA: `site_settings.google_source_badge` to
      // kolumna JSON edytowana z panelu (i migracjami). Zapis `{"logo": null}`
      // albo `{"desktop": null}` - a to jest naturalny wynik „wyczyść sekcję"
      // w formularzu i typowy efekt starszego kształtu wpisu - przechodzi
      // przez `deepMerge` NIETKNIĘTY, bo scalane są wyłącznie obiekty proste.
      // `useGoogleSourceBadgeConfig` woła `resolveSetting` BEZ schematu Zod,
      // więc nie ma bramki, która odrzuciłaby taką wartość. Skutkiem jest
      // `TypeError: Cannot read properties of null` w
      // `GooglePreferredSourceBadge` (`config.logo.size`, `config[device]`) -
      // czyli DOKŁADNIE ta klasa awarii, którą komentarz w `useSiteSetting.ts`
      // opisuje jako „root cause of the recent Header crash": biały ekran na
      // stopce i na każdym artykule, na CAŁYM serwisie, po jednym zapisie w
      // panelu.
      //
      // NAPRAWA (w produkcji, nie w teście): przekazać do `resolveSetting`
      // schemat Zod konfiguracji badge - `resolveSetting` sam spada wtedy na
      // `GOOGLE_SOURCE_BADGE_DEFAULTS` przy nieudanym parsowaniu. Ten test
      // zostaje czerwony do tej zmiany, a po niej `it.fails` wywali się
      // natychmiast, bo warunek zacznie być spełniony.
      const config = await readStoredConfig({ logo: null, desktop: null, mobile: null });
      expect(config.logo).toEqual(GOOGLE_SOURCE_BADGE_DEFAULTS.logo);
      expect(config.desktop).toEqual(GOOGLE_SOURCE_BADGE_DEFAULTS.desktop);
      expect(config.mobile).toEqual(GOOGLE_SOURCE_BADGE_DEFAULTS.mobile);
    },
  );

  it.fails("DEFEKT: adres zapisany jako liczba wywraca `resolveBadgeHref`", async () => {
    // KONSEKWENCJA DLA UŻYTKOWNIKA: pole adresu w panelu jest tekstowe, ale
    // wartość w JSON-ie może być liczbą (import, migracja, ręczna edycja
    // wiersza). `resolveBadgeHref` robi wtedy `raw.trim()` na liczbie i rzuca
    // `TypeError`, zamiast spaść na `googlePreferredSourceUrl()`. Badge stoi w
    // stopce, więc wyjątek leci na KAŻDEJ stronie serwisu, a nie tylko w
    // panelu. Naprawa: schemat Zod przy `resolveSetting` (albo strażnik
    // `typeof raw === "string"` w `resolveBadgeHref`) - wtedy uszkodzony wpis
    // daje adres domyślny, a nie biały ekran.
    const config = await readStoredConfig({ url_pl: 12345 });
    expect(resolveBadgeHref(config, "pl")).toBe(DEFAULT_URL);
  });
});
