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
//      (`siteSettingsQueryOptions` -> bramka Zod
//      `normalizeGoogleSourceBadgeConfig` -> atrapa PostgREST, ZERO sieci):
//      wartość BRAK -> dokładnie obiekt domyślny; wartość CZĘŚCIOWA ->
//      uzupełnienie z domyślek, w którym zagnieżdżone `logo`/`desktop`/`mobile`
//      NIE zostają `undefined`; wartość USZKODZONA (zły typ, `align` spoza
//      zbioru, margines poza 0-48, rozmiar poza 10-32) -> BEZ wyjątku i z
//      polem spadającym na SWOJĄ domyślkę; oraz brak QueryClientProvidera ->
//      domyślki i ZERO odczytów bazy.
//   6. STRAŻNIK klasy „Header crash": zapisane JAWNIE `null` w miejscu
//      sekcji (`logo`/`desktop`/`mobile`) albo liczba w miejscu adresu nie
//      dociera do komponentu - bramka odczytu ma `.catch` per pole, więc
//      jedno złe pole spada na domyślkę, a reszta zapisu redakcji zostaje
//      (patrz sekcja „uszkodzone klucze ZAGNIEŻDŻONE" na końcu pliku).
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
//     napisu, wyłącznik `desktop`, hook i bramka odczytu.
//   - `src/lib/__tests__` dla `useSiteSetting`/`deepMerge` - kontrakt bulk
//     query, `staleTime`, kolejka niepotwierdzonych zapisów i ochrona przed
//     zatruciem prototypu należą do tamtej warstwy. Tutaj przez bulk query
//     przechodzę PRAWDZIWIE tylko po to, żeby uszkodzona wartość dotarła do
//     bramki badge dokładnie tak, jak dotrze w produkcji.
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
  normalizeGoogleSourceBadgeConfig,
  placementStyle,
  resolveBadgeHref,
  resolveBadgeLogo,
  resolveGoogleSourceBadgeConfig,
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
 * danych `resolveGoogleSourceBadgeConfig` oddaje sam obiekt domyślny, a po
 * walidacji obiektu z bazy nowy - więc `not.toBe(GOOGLE_SOURCE_BADGE_DEFAULTS)`
 * jest deterministycznym sygnałem „wiersz z bazy już wpłynął".
 *
 * To jest jedyna droga, którą wartość NIEZGODNA Z TYPEM (`null` w miejscu
 * napisu, `align: "middle"`) trafia do bramki odczytu bez ani jednego
 * rzutowania w teście - dokładnie tak, jak trafia w produkcji.
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

  it("wartość CZĘŚCIOWA jest uzupełniana z domyślek przez bramkę - żaden klucz zagnieżdżony nie ginie", async () => {
    const config = await readStoredConfig({
      url_pl: "https://pl.example/preferred",
      desktop: { align: "center" },
    });
    expect(config.url_pl).toBe("https://pl.example/preferred");
    expect(config.url_en).toBe(DEFAULT_URL);
    expect(config.desktop.align).toBe("center");
    // Rodzeństwo w nadpisanym obiekcie ZOSTAJE - schemat bramki
    // (`normalizeGoogleSourceBadgeConfig`) uzupełnia każde brakujące pole.
    expect(config.desktop.variant).toBe(GOOGLE_SOURCE_BADGE_DEFAULTS.desktop.variant);
    expect(config.desktop.enabled).toBe(true);
    expect(config.desktop.marginTop).toBe(0);
    expect(config.mobile).toEqual(GOOGLE_SOURCE_BADGE_DEFAULTS.mobile);
    expect(config.logo).toEqual(GOOGLE_SOURCE_BADGE_DEFAULTS.logo);
    for (const key of ["enabled", "url_pl", "url_en", "logo", "desktop", "mobile"] as const) {
      expect(config[key], `klucz ${key} zniknął po bramce odczytu`).not.toBeUndefined();
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

  it("wartość USZKODZONA nie rzuca - bramka klei każde pole do bezpiecznej wartości", async () => {
    const config = await readStoredConfig({
      // Wartości spoza dozwolonego zbioru i poza zakresem, dokładnie w takim
      // kształcie, w jakim mogą leżeć w kolumnie JSON po ręcznej edycji.
      url_pl: 12345,
      logo: { size: 99, light: "", dark: "" },
      desktop: { align: "middle", variant: "neon", marginTop: 999, marginBottom: -3, marginX: 60 },
    });
    // `align` spoza zbioru spada na domyślkę DESKTOPU ("end"), a nie na
    // zapasowe `justify-start` z `alignClass` - do helpera dociera już
    // wartość poprawna.
    expect(config.desktop.align).toBe(GOOGLE_SOURCE_BADGE_DEFAULTS.desktop.align);
    expect(alignClass(config.desktop.align)).toBe("justify-end");
    // Marginesy i rozmiar są klamrowane JUŻ w bramce, tą samą klamrą co w
    // renderze - piksele są identyczne jak przed bramką.
    expect(config.desktop).toMatchObject({ marginTop: 48, marginBottom: 0, marginX: 48 });
    expect(placementStyle(config.desktop)).toEqual({
      marginTop: 48,
      marginBottom: 0,
      marginLeft: 48,
      marginRight: 48,
    });
    expect(config.logo.size).toBe(32);
    expect(clampLogoSize(config.logo.size)).toBe(32);
    // ŚWIADOMA DECYZJA: wariant spoza zbioru spada na wariant domyślny TEGO
    // breakpointu - `data-variant` i zdarzenie analityczne nie niosą
    // wartości, której nie da się ustawić w panelu.
    expect(config.desktop.variant).toBe("default");
    // Adres zapisany jako liczba spada na domyślny panel Google - bez wyjątku.
    expect(config.url_pl).toBe(DEFAULT_URL);
    expect(resolveBadgeHref(config, "pl")).toBe(DEFAULT_URL);
  });

  it("null w miejscu adresu spada na domyślny panel Google już w bramce", async () => {
    const config = await readStoredConfig({ url_pl: null, url_en: null });
    expect(config.url_pl).toBe(DEFAULT_URL);
    expect(config.url_en).toBe(DEFAULT_URL);
    expect(resolveBadgeHref(config, "pl")).toBe(DEFAULT_URL);
    expect(resolveBadgeHref(config, "en")).toBe(DEFAULT_URL);
  });

  it("null w miejscu logotypu spada na wbudowany sygnet", async () => {
    const oba = await readStoredConfig({ logo: { light: null, dark: null } });
    expect(resolveBadgeLogo(oba.logo, "light")).toBeNull();
    expect(resolveBadgeLogo(oba.logo, "dark")).toBeNull();
    const tylkoCiemny = await readStoredConfig({ logo: { light: null, dark: "d.png" } });
    expect(resolveBadgeLogo(tylkoCiemny.logo, "light")).toBe("d.png");
    expect(resolveBadgeLogo(tylkoCiemny.logo, "dark")).toBe("d.png");
  });
});

describe("uszkodzone klucze ZAGNIEŻDŻONE - strażnik bramki odczytu", () => {
  it("jawny null w logo/desktop/mobile spada na domyślki, a nie zostaje nullem", async () => {
    // KONSEKWENCJA, przed którą ten test chroni: `site_settings.google_source_badge`
    // to kolumna JSON edytowana z panelu (i migracjami). Zapis `{"logo": null}`
    // albo `{"desktop": null}` - naturalny wynik „wyczyść sekcję" w formularzu
    // i typowy efekt starszego kształtu wpisu - dawał wcześniej
    // `TypeError: Cannot read properties of null` w
    // `GooglePreferredSourceBadge` (`config.logo.size`, `config[device]`),
    // czyli DOKŁADNIE tę klasę awarii, którą komentarz w `useSiteSetting.ts`
    // opisuje jako „root cause of the recent Header crash": biały ekran na
    // stopce i na każdym artykule, na CAŁYM serwisie, po jednym zapisie w
    // panelu. Bramka `normalizeGoogleSourceBadgeConfig` ma `.catch` na każdej
    // sekcji, więc null zamienia się w sekcję domyślną.
    const config = await readStoredConfig({ logo: null, desktop: null, mobile: null });
    expect(config.logo).toEqual(GOOGLE_SOURCE_BADGE_DEFAULTS.logo);
    expect(config.desktop).toEqual(GOOGLE_SOURCE_BADGE_DEFAULTS.desktop);
    expect(config.mobile).toEqual(GOOGLE_SOURCE_BADGE_DEFAULTS.mobile);
    expect(resolveBadgeLogo(config.logo, "light")).toBeNull();
    expect(isBadgeVisible(config, "desktop")).toBe(true);
    expect(isBadgeVisible(config, "mobile")).toBe(true);
  });

  it.each<[string, unknown]>([
    ["null", null],
    ["tablica", []],
    ["napis", "ukryj"],
    ["liczba", 0],
    ["boolean", false],
  ])("sekcja zapisana jako %s spada na sekcję domyślną", (_case, value) => {
    for (const key of ["logo", "desktop", "mobile"] as const) {
      const config = normalizeGoogleSourceBadgeConfig({ [key]: value });
      expect(config[key], `sekcja ${key}`).toEqual(GOOGLE_SOURCE_BADGE_DEFAULTS[key]);
    }
  });

  it("adres zapisany jako liczba daje adres domyślny, a nie wyjątek", async () => {
    // KONSEKWENCJA, przed którą ten test chroni: pole adresu w panelu jest
    // tekstowe, ale wartość w JSON-ie może być liczbą (import, migracja,
    // ręczna edycja wiersza). `resolveBadgeHref` robił wtedy `raw.trim()` na
    // liczbie i rzucał `TypeError` - a badge stoi w stopce, więc wyjątek
    // leciał na KAŻDEJ stronie serwisu, nie tylko w panelu.
    const config = await readStoredConfig({ url_pl: 12345 });
    expect(resolveBadgeHref(config, "pl")).toBe(DEFAULT_URL);
  });

  it("strażnik `typeof` w helperach działa także BEZ bramki (szkic z panelu)", () => {
    // Helpery są publiczne: podgląd w adminie i przyszli konsumenci mogą podać
    // obiekt, który bramki nie widział. Tu wartość niezgodna z typem idzie
    // wprost do helpera - świadome rzutowanie, bo to jest sedno testu.
    const broken = {
      ...GOOGLE_SOURCE_BADGE_DEFAULTS,
      url_pl: 12345,
      url_en: null,
    } as unknown as GoogleSourceBadgeConfig;
    expect(resolveBadgeHref(broken, "pl")).toBe(DEFAULT_URL);
    expect(resolveBadgeHref(broken, "en")).toBe(DEFAULT_URL);
    const brokenLogo = {
      light: 7,
      dark: { url: "x" },
      size: 18,
    } as unknown as GoogleSourceBadgeLogo;
    expect(resolveBadgeLogo(brokenLogo, "light")).toBeNull();
    expect(resolveBadgeLogo(brokenLogo, "dark")).toBeNull();
    expect(resolveBadgeLogo(null, "dark")).toBeNull();
    expect(resolveBadgeLogo(undefined, "light")).toBeNull();
  });

  it("JEDNO złe pole spada na swoją domyślkę - reszta zapisu redakcji zostaje", () => {
    // Odporność per pole, a nie „wszystko albo nic": `resolveSetting` ze
    // schematem oddałby przy jednym złym polu CAŁE domyślki i skasował np.
    // własny adres EN i logotyp redakcji.
    const config = normalizeGoogleSourceBadgeConfig({
      url_pl: 12345,
      url_en: "https://en.example/preferred",
      logo: { light: "l.png", dark: null, size: "duży" },
      desktop: { enabled: false, variant: "icon", align: 42 },
      mobile: { variant: "neon", marginTop: "24" },
    });
    expect(config.url_pl).toBe(DEFAULT_URL);
    expect(config.url_en).toBe("https://en.example/preferred");
    expect(config.logo).toEqual({ light: "l.png", dark: "", size: 14 });
    expect(config.desktop).toEqual({
      ...GOOGLE_SOURCE_BADGE_DEFAULTS.desktop,
      enabled: false,
      variant: "icon",
    });
    // Wariant mobilny spada na domyślkę MOBILE ("compact"), nie desktopu.
    // Margines jako liczba w napisie nadal przechodzi (ta sama klamra co dotąd).
    expect(config.mobile).toEqual({
      ...GOOGLE_SOURCE_BADGE_DEFAULTS.mobile,
      variant: "compact",
      marginTop: 24,
    });
  });

  // KONSEKWENCJA, przed którą ten test chroni: zapis wyłącznika jako `null`
  // albo `0` (migracja, ręczna edycja JSON-a) przed bramką GASIŁ badge, a po
  // pierwszej wersji bramki (`z.boolean().catch(true)`) badge POJAWIAŁ się na
  // każdej stronie serwisu wbrew intencji wyłączenia (fail-open).
  it.each([0, null, "false", "0", " FALSE "])(
    "jednoznacznie fałszywy zapis wyłącznika (%j) GASI badge (fail-closed)",
    (value) => {
      const config = normalizeGoogleSourceBadgeConfig({
        enabled: value,
        desktop: { enabled: value },
      });
      expect(config.enabled).toBe(false);
      expect(config.desktop.enabled).toBe(false);
      expect(isBadgeVisible(config, "desktop")).toBe(false);
      expect(isBadgeVisible(config, "mobile")).toBe(false);
    },
  );

  it.each([1, "true", "1"])(
    "jednoznacznie prawdziwy zapis wyłącznika (%j) włącza badge",
    (value) => {
      const config = normalizeGoogleSourceBadgeConfig({
        enabled: value,
        mobile: { enabled: value },
      });
      expect(config.enabled).toBe(true);
      expect(config.mobile.enabled).toBe(true);
    },
  );

  it("niejednoznaczny albo BRAKUJĄCY wyłącznik spada na domyślkę (widoczny)", () => {
    // Negatyw: fail-closed dotyczy wyłącznie zapisów jednoznacznie fałszywych.
    // Brak klucza (częściowy zapis) nie może gasić badge.
    for (const value of ["nie", {}, [], 2, undefined]) {
      const config = normalizeGoogleSourceBadgeConfig({
        enabled: value,
        desktop: { enabled: value },
      });
      expect(config.enabled, `enabled=${String(value)}`).toBe(true);
      expect(config.desktop.enabled, `desktop.enabled=${String(value)}`).toBe(true);
    }
    expect(normalizeGoogleSourceBadgeConfig({}).enabled).toBe(true);
    expect(normalizeGoogleSourceBadgeConfig({ enabled: false }).enabled).toBe(false);
  });

  it("poprawny, pełny zapis przechodzi BEZ ZMIAN (bramka niczego nie poprawia na siłę)", () => {
    const stored: GoogleSourceBadgeConfig = {
      enabled: false,
      url_pl: "https://pl.example/p",
      url_en: "https://en.example/p",
      logo: { light: "l.png", dark: "d.png", size: 24 },
      desktop: {
        enabled: false,
        variant: "icon",
        align: "center",
        marginTop: 4,
        marginBottom: 8,
        marginX: 12,
      },
      mobile: {
        enabled: true,
        variant: "default",
        align: "end",
        marginTop: 48,
        marginBottom: 0,
        marginX: 1,
      },
    };
    expect(normalizeGoogleSourceBadgeConfig(stored)).toEqual(stored);
    // Puste napisy to poprawne wartości („wbudowany sygnet") - nie są
    // zamieniane na nic innego.
    expect(normalizeGoogleSourceBadgeConfig({ logo: { light: "", dark: "" } }).logo).toEqual(
      GOOGLE_SOURCE_BADGE_DEFAULTS.logo,
    );
  });

  it("klucze spoza kształtu nie przechodzą przez bramkę", () => {
    const config = normalizeGoogleSourceBadgeConfig({
      legacy_flag: true,
      desktop: { color: "red" },
    }) as unknown as Record<string, unknown>;
    expect(config).not.toHaveProperty("legacy_flag");
    expect(config.desktop).toEqual(GOOGLE_SOURCE_BADGE_DEFAULTS.desktop);
  });

  it.each<[string, unknown]>([
    ["brak wpisu", undefined],
    ["null", null],
    ["napis", "włączony"],
    ["liczba", 1],
  ])(
    "wiersz zapisany jako %s daje TĘ SAMĄ referencję domyślek (stabilna tożsamość)",
    (_case, value) => {
      const map = value === undefined ? {} : { [GOOGLE_SOURCE_BADGE_SETTINGS_KEY]: value };
      expect(resolveGoogleSourceBadgeConfig(map)).toBe(GOOGLE_SOURCE_BADGE_DEFAULTS);
    },
  );

  it("tablica w miejscu całego wpisu daje domyślki, a nie wyjątek", () => {
    const map = { [GOOGLE_SOURCE_BADGE_SETTINGS_KEY]: [1, 2, 3] };
    expect(resolveGoogleSourceBadgeConfig(map)).toEqual(GOOGLE_SOURCE_BADGE_DEFAULTS);
    expect(resolveGoogleSourceBadgeConfig(undefined)).toBe(GOOGLE_SOURCE_BADGE_DEFAULTS);
  });

  it("hook liczy bramkę RAZ na zmianę mapy - kolejne rendery dostają tę samą referencję", async () => {
    planSettings([{ key: GOOGLE_SOURCE_BADGE_SETTINGS_KEY, value: { enabled: false } }]);
    const { result, rerender } = renderHookWithQueryClient(() => useGoogleSourceBadgeConfig());
    await waitFor(() => expect(result.current).not.toBe(GOOGLE_SOURCE_BADGE_DEFAULTS));
    const first = result.current;
    rerender();
    rerender();
    expect(result.current).toBe(first);
  });
});
