// SILNIK WSZYSTKICH PANELI USTAWIEŃ (`src/lib/admin/useSettings.ts` - 0%).
//
// DLACZEGO TO PIERWSZY PLIK ETAPU USTAWIEŃ. Dwanaście z piętnastu tras
// `admin.settings.*` czyta i zapisuje konfigurację serwisu WYŁĄCZNIE przez ten
// hook. Defekt tutaj nie psuje jednego panelu - psuje wszystkie naraz, i to
// w sposób, który widać dopiero po zapisie: `site_settings` to JEDEN wiersz
// jsonb na klucz, więc zapis wąskiego szkicu potrafi zdmuchnąć gałęzie,
// których dany panel nawet nie pokazuje.
//
// DWA MECHANIZMY, KTÓRE TEN PLIK MA UDOWODNIĆ:
//
//   1. GŁĘBOKIE SCALENIE PRZY ODCZYCIE. Zapisane ustawienia starzeją się:
//      wiersz w bazie może nieść tylko część gałęzi. Spłaszczone rozłożenie
//      (`{...defaults, ...row}`) usuwałoby wymagane wartości domyślne
//      z gałęzi zagnieżdżonych (np. `theme_options.header.search`) i wywalało
//      cały panel. Tu jest tabela: brak wiersza, wiersz pusty, gałąź częściowa,
//      wartość NIEPRAWIDŁOWA (łańcuch/liczba/tablica w miejscu obiektu),
//      wartość FAŁSZYWA ALE PRAWIDŁOWA (`0`, `""`, `false`) - ta ostatnia jest
//      najczęstszym realnym błędem: `??` zachowuje ją, `||` podmienia na
//      domyślną i użytkownik nie może ustawić zera.
//   2. GŁĘBOKIE SCALENIE PRZY ZAPISIE. Kilka paneli woła
//      `useSettings("theme_options", <wąski kształt>)`. Zapis szkicu „jak leci"
//      nadpisałby cały wiersz i zgubił rodzeństwo (`header`, `buttons`,
//      `text_fields`). Zapis MUSI więc najpierw odczytać bieżący wiersz
//      i scalić na nim - i to jest sprawdzane na kolejności ogniw, nie na
//      wyniku.
//
// PLUS: unieważnienie cache w DWÓCH miejscach (klucz sekcji i wspólna mapa
// wszystkich ustawień), emisja zdarzenia dla podglądu na żywo, oraz ścieżki
// błędu odczytu i zapisu.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - `deepMerge` ma własny test jednostkowy; tutaj dowodzimy, że hook go WOŁA
//   i w którą stronę (domyślne pod spodem, dane z bazy na górze).
// - RLS na `site_settings`: zapis jest ograniczony do administratora w obrębie
//   najemcy, a `onConflict: "tenant_id,key"` domyka izolację po stronie bazy.
//   To pgTAP (`rls_tenant_isolation_test.sql`, `security_hardening_rls_test.sql`).
// - INTERFEJSU PANELI: `src/routes/__tests__/adminSettingsRoutes.test.tsx`.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { RecordedChain, SupabaseFromStub } from "@/test/supabaseChain";

const h = vi.hoisted(() => ({
  db: null as SupabaseFromStub | null,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  /** Ile razy hook rozgłosił zmianę ustawień do podglądu na żywo. */
  liveSyncEmits: 0,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (!h.db) throw new Error("test: atrapa bazy nieustawiona");
      return h.db.from(table);
    },
  },
}));
vi.mock("sonner", () => ({
  toast: { success: h.toastSuccess, error: h.toastError },
}));
vi.mock("@/lib/builder/siteSettingsLiveSync", () => ({
  emitSiteSettingsInvalidate: () => {
    h.liveSyncEmits += 1;
  },
}));

import { fail, ok, supabaseFromStub } from "@/test/supabaseChain";
import { useDraft, useSettings, type SettingsRecord } from "@/lib/admin/useSettings";
import { siteSettingsQueryOptions } from "@/lib/useSiteSetting";

/** Zapisane operacje zapisu: klucz + scalona wartość. */
let upserts: { key: string; value: unknown; options: unknown }[] = [];
/** Zawartość tabeli `site_settings` widziana przez atrapę, per klucz. */
let rows: Record<string, unknown> = {};
/** Gdy ustawione, odczyt (SELECT) pada tym komunikatem. */
let readError: string | null = null;
/**
 * Gdy nie jest `null`, zapis (UPSERT) pada tym komunikatem. PUSTY łańcuch jest
 * osobnym, sensownym przypadkiem (błąd bez `message`), więc rozróżnienie musi
 * iść przez `!== null`, a nie przez prawdziwość - inaczej test „błąd bez
 * komunikatu" przechodziłby ścieżką powodzenia.
 */
let writeError: string | null = null;

function wireDb(): void {
  h.db?.setResponse("site_settings", (chain: RecordedChain) => {
    if (chain.has("upsert")) {
      const payload = chain.argsOf("upsert")?.[0];
      const options = chain.argsOf("upsert")?.[1];
      if (writeError !== null) return fail(writeError);
      if (payload && typeof payload === "object" && "key" in payload) {
        const record = payload as { key: string; value: unknown };
        upserts.push({ key: record.key, value: record.value, options });
        rows[record.key] = record.value;
      }
      return ok(null);
    }
    if (readError) return fail(readError);
    const key = String(chain.argsOf("eq")?.[1] ?? "");
    return ok(key in rows ? { value: rows[key] } : null);
  });
}

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function newClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

/**
 * Klient BEZ natychmiastowego sprzątania cache. `gcTime: 0` usuwa wpis, który
 * nie ma obserwatora - a wspólna mapa ustawień (`siteSettingsQueryOptions`)
 * właśnie takim wpisem jest w teście hooka. Bez tego test „nie gubimy innych
 * sekcji" sprawdzałby zachowanie odśmiecacza, nie kodu.
 */
function cachingClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

/** Kształt sekcji z gałęzią zagnieżdżoną - to on ujawnia płaskie scalanie. */
interface NestedShape extends SettingsRecord {
  title: string;
  count: number;
  enabled: boolean;
  header: { search: boolean; sticky: boolean };
}

const NESTED_DEFAULTS: NestedShape = {
  title: "Domyślny tytuł",
  count: 10,
  enabled: true,
  header: { search: true, sticky: false },
};

/** Ogniwa odczytu (SELECT) w kolejności wywołań - do asercji o kolejności. */
function readChains(): RecordedChain[] {
  return (h.db?.chainsFor("site_settings") ?? []).filter((chain) => !chain.has("upsert"));
}

beforeEach(() => {
  h.db = supabaseFromStub();
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
  h.liveSyncEmits = 0;
  upserts = [];
  rows = {};
  readError = null;
  writeError = null;
  wireDb();
});

// ---------------------------------------------------------------------------
// 1. ODCZYT: wartości domyślne, brak wiersza, kształt niepoprawny.
// ---------------------------------------------------------------------------

describe("useSettings - odczyt sekcji ustawień", () => {
  function mount(defaults: NestedShape = NESTED_DEFAULTS) {
    const client = newClient();
    const rendered = renderHook(() => useSettings<NestedShape>("sekcja", defaults), {
      wrapper: wrapper(client),
    });
    return { ...rendered, client };
  }

  it("pyta o JEDEN wiersz po kluczu sekcji - nie o całą tabelę", async () => {
    // `site_settings` niesie konfigurację całego serwisu; odczyt bez `.eq("key")`
    // ciągnąłby do przeglądarki także sekcje, których panel nie pokazuje
    // (w tym `contact_private`).
    const { result } = mount();
    await waitFor(() => expect(result.current.query.data).toBeTruthy());
    const chain = readChains()[0];
    expect(chain.argsOf("select")).toEqual(["value"]);
    expect(chain.argsOf("eq")).toEqual(["key", "sekcja"]);
    expect(chain.has("maybeSingle")).toBe(true);
  });

  it("BRAK wiersza daje wartości domyślne - panel musi się otworzyć", async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.query.data).toEqual(NESTED_DEFAULTS));
  });

  it("wiersz z gałęzią CZĘŚCIOWĄ nie gubi wartości domyślnych z tej gałęzi", async () => {
    // TO JEST TEN DEFEKT, o którym mówi komentarz w kodzie: `{...defaults,
    // ...row}` zostawiłby `header` bez `sticky`, a panel czytający
    // `header.sticky` dostałby `undefined` i wywalił cały widok ustawień.
    rows.sekcja = { header: { search: false } };
    const { result } = mount();
    await waitFor(() =>
      expect(result.current.query.data?.header).toEqual({
        search: false,
        sticky: false,
      }),
    );
    // Rodzeństwo z wartości domyślnych też zostaje.
    expect(result.current.query.data?.title).toBe("Domyślny tytuł");
  });

  it.each([
    { label: "zero", stored: { count: 0 }, expected: 0 },
    { label: "pusty łańcuch", stored: { title: "" }, expected: "" },
    { label: "fałsz", stored: { enabled: false }, expected: false },
  ])(
    "wartość FAŁSZYWA ale PRAWIDŁOWA ($label) NIE jest podmieniana na domyślną",
    async ({ stored, expected }) => {
      // Najczęstszy realny błąd w panelach konfiguracji: `value || default`
      // zamiast `value ?? default`. Administrator ustawia limit na 0 albo
      // czyści tytuł, zapisuje - i po odświeżeniu widzi starą wartość, bez
      // żadnego komunikatu o odrzuceniu.
      rows.sekcja = stored;
      const { result } = mount();
      await waitFor(() => expect(result.current.query.data).toBeTruthy());
      const data = result.current.query.data;
      const key = Object.keys(stored)[0];
      expect(data?.[key]).toBe(expected);
    },
  );

  it.each([
    { label: "łańcuch", stored: "nie obiekt" },
    { label: "liczba", stored: 42 },
    { label: "tablica", stored: [1, 2, 3] },
    { label: "`null`", stored: null },
    { label: "wartość logiczna", stored: true },
  ])("wartość NIEPRAWIDŁOWA w bazie ($label) schodzi na wartości domyślne", async ({ stored }) => {
    // Wiersz o nieznanym kształcie (ręczna edycja, migracja, inna wersja
    // aplikacji) NIE MOŻE wywalić panelu ustawień - to jedyny ekran, z którego
    // da się ten wiersz naprawić.
    rows.sekcja = stored;
    const { result } = mount();
    await waitFor(() => expect(result.current.query.data).toBeTruthy());
    expect(result.current.query.data).toEqual(NESTED_DEFAULTS);
  });

  it("nadwyżkowe klucze z bazy ZOSTAJĄ - panel nie kasuje tego, czego nie zna", async () => {
    // Klucz dodany nowszą wersją aplikacji nie może zniknąć, bo administrator
    // na starszej wersji otworzył panel.
    rows.sekcja = { title: "Z bazy", nieznane_pole: "zostaw mnie" };
    const { result } = mount();
    await waitFor(() => expect(result.current.query.data?.title).toBe("Z bazy"));
    expect(result.current.query.data?.nieznane_pole).toBe("zostaw mnie");
  });

  it("AWARIA odczytu jest BŁĘDEM zapytania - panel musi ją pokazać", async () => {
    // Odwrotnie niż na stronie publicznej: administrator, który widzi wartości
    // domyślne po awarii, zapisze je i NADPISZE realną konfigurację serwisu.
    readError = "permission denied for table site_settings";
    const { result } = mount();
    await waitFor(() => expect(result.current.query.isError).toBe(true));
    expect(result.current.query.data).toBeUndefined();
  });

  it("klucz cache jest ZAWĘŻONY do sekcji - dwa panele nie dzielą wpisu", async () => {
    rows.pierwsza = { title: "Pierwsza" };
    rows.druga = { title: "Druga" };
    const client = newClient();
    const first = renderHook(() => useSettings<NestedShape>("pierwsza", NESTED_DEFAULTS), {
      wrapper: wrapper(client),
    });
    const second = renderHook(() => useSettings<NestedShape>("druga", NESTED_DEFAULTS), {
      wrapper: wrapper(client),
    });
    await waitFor(() => expect(first.result.current.query.data?.title).toBe("Pierwsza"));
    await waitFor(() => expect(second.result.current.query.data?.title).toBe("Druga"));
  });
});

// ---------------------------------------------------------------------------
// 2. ZAPIS: ponowny odczyt i scalenie na bieżącym wierszu.
// ---------------------------------------------------------------------------

describe("useSettings - zapis sekcji ustawień", () => {
  function mount(key = "sekcja", defaults: NestedShape = NESTED_DEFAULTS) {
    const client = newClient();
    const rendered = renderHook(() => useSettings<NestedShape>(key, defaults), {
      wrapper: wrapper(client),
    });
    return { ...rendered, client };
  }

  it("zapis NAJPIERW odczytuje bieżący wiersz, POTEM zapisuje scalenie", async () => {
    // Kolejność jest tu regułą: bez ponownego odczytu wąski szkic nadpisałby
    // gałęzie, których panel nie pokazuje. Asercja na LICZBIE odczytów, bo to
    // ona odróżnia scalenie od nadpisania.
    rows.sekcja = { title: "Z bazy", header: { search: false, sticky: true } };
    const { result } = mount();
    await waitFor(() => expect(result.current.query.data).toBeTruthy());
    const readsBefore = readChains().length;

    await result.current.save.mutateAsync({ ...NESTED_DEFAULTS, title: "Nowy tytuł" });
    expect(readChains().length).toBe(readsBefore + 1);
    expect(upserts).toHaveLength(1);
  });

  it("SCALENIE zachowuje gałęzie, których szkic nie niesie", async () => {
    // Scenariusz z komentarza w kodzie: kilka paneli zapisuje `theme_options`
    // w WĄSKIM kształcie. Bez scalenia zapis z panelu ogólnego zdmuchnąłby
    // `buttons` ustawione w panelu wyglądu - i nikt by tego nie zauważył do
    // najbliższego renderu strony publicznej.
    rows.theme_options = {
      logo: { main: "https://example.org/logo.svg" },
      buttons: { radius: 8 },
      text_fields: { variant: "floating" },
    };
    interface NarrowLogo extends SettingsRecord {
      logo: { main: string };
    }
    const client = newClient();
    const { result } = renderHook(
      () => useSettings<NarrowLogo>("theme_options", { logo: { main: "" } }),
      { wrapper: wrapper(client) },
    );
    await waitFor(() => expect(result.current.query.data).toBeTruthy());

    await result.current.save.mutateAsync({ logo: { main: "https://example.org/nowe.svg" } });
    const saved = upserts[0].value;
    expect(saved).toMatchObject({
      logo: { main: "https://example.org/nowe.svg" },
      buttons: { radius: 8 },
      text_fields: { variant: "floating" },
    });
  });

  it("szkic WYGRYWA nad wartością w bazie - to on jest decyzją administratora", async () => {
    rows.sekcja = { title: "Stary", count: 5 };
    const { result } = mount();
    await waitFor(() => expect(result.current.query.data).toBeTruthy());
    await result.current.save.mutateAsync({ ...NESTED_DEFAULTS, title: "Nowy", count: 7 });
    expect(upserts[0].value).toMatchObject({ title: "Nowy", count: 7 });
  });

  it("wartość FAŁSZYWA w szkicu też wygrywa - zero i pustka są decyzją", async () => {
    // Gdyby scalanie traktowało `0`/`""` jako „brak", administrator nie mógłby
    // wyłączyć limitu ani wyczyścić pola tekstowego.
    rows.sekcja = { title: "Stary", count: 5, enabled: true };
    const { result } = mount();
    await waitFor(() => expect(result.current.query.data).toBeTruthy());
    await result.current.save.mutateAsync({
      ...NESTED_DEFAULTS,
      title: "",
      count: 0,
      enabled: false,
    });
    expect(upserts[0].value).toMatchObject({ title: "", count: 0, enabled: false });
  });

  it.each([
    { label: "brak wiersza", stored: undefined },
    { label: "łańcuch", stored: "nie obiekt" },
    { label: "tablica", stored: [1, 2] },
    { label: "`null`", stored: null },
  ])("zapis na wierszu NIEPRAWIDŁOWYM ($label) startuje od pustej podstawy", async ({ stored }) => {
    // Zamiast rzucać, zapis traktuje niepoprawny wiersz jako pusty - inaczej
    // jedna ręczna edycja jsonb blokowałaby panel na zawsze.
    if (stored !== undefined) rows.sekcja = stored;
    const { result } = mount();
    await waitFor(() => expect(result.current.query.data).toBeTruthy());
    await result.current.save.mutateAsync({ ...NESTED_DEFAULTS, title: "Naprawione" });
    expect(upserts[0].value).toMatchObject({ title: "Naprawione" });
  });

  it("zapis idzie z `onConflict` po NAJEMCY i kluczu - inaczej sekcje by się mieszały", async () => {
    // `site_settings` ma klucz złożony (najemca + klucz sekcji). `onConflict`
    // tylko po `key` scalałby konfiguracje różnych najemców w jeden wiersz.
    const { result } = mount();
    await waitFor(() => expect(result.current.query.data).toBeTruthy());
    await result.current.save.mutateAsync(NESTED_DEFAULTS);
    expect(upserts[0].options).toEqual({ onConflict: "tenant_id,key" });
    expect(upserts[0].key).toBe("sekcja");
  });

  it("powodzenie AKTUALIZUJE cache sekcji i wspólną mapę ustawień", async () => {
    // Dwa wpisy, bo dwie warstwy czytają te dane: panel (klucz sekcji)
    // i cała aplikacja (`siteSettingsQueryOptions`). Aktualizacja tylko
    // jednego zostawiałaby stronę publiczną z poprzednią konfiguracją do
    // najbliższego przeładowania.
    const { result, client } = mount();
    await waitFor(() => expect(result.current.query.data).toBeTruthy());
    await result.current.save.mutateAsync({ ...NESTED_DEFAULTS, title: "Po zapisie" });

    expect(client.getQueryData(["site_settings", "sekcja"])).toMatchObject({
      title: "Po zapisie",
    });
    const all = client.getQueryData(siteSettingsQueryOptions.queryKey);
    expect(all).toMatchObject({ sekcja: { title: "Po zapisie" } });
  });

  it("wspólna mapa ustawień NIE GUBI innych sekcji przy zapisie jednej", async () => {
    const client = cachingClient();
    client.setQueryData(siteSettingsQueryOptions.queryKey, { inna_sekcja: { x: 1 } });
    const { result } = renderHook(() => useSettings<NestedShape>("sekcja", NESTED_DEFAULTS), {
      wrapper: wrapper(client),
    });
    await waitFor(() => expect(result.current.query.data).toBeTruthy());
    await result.current.save.mutateAsync(NESTED_DEFAULTS);
    expect(client.getQueryData(siteSettingsQueryOptions.queryKey)).toMatchObject({
      inna_sekcja: { x: 1 },
      sekcja: expect.anything(),
    });
  });

  it("PUSTA wspólna mapa jest zakładana od zera, a nie pomijana", async () => {
    const { result, client } = mount();
    await waitFor(() => expect(result.current.query.data).toBeTruthy());
    await result.current.save.mutateAsync(NESTED_DEFAULTS);
    expect(client.getQueryData(siteSettingsQueryOptions.queryKey)).toBeTruthy();
  });

  it("powodzenie ROZGŁASZA zmianę do podglądu na żywo i potwierdza zapis", async () => {
    // Podgląd buildera nasłuchuje tego zdarzenia; bez niego administrator
    // zapisuje kolor i widzi stary aż do przeładowania edytora.
    const { result } = mount();
    await waitFor(() => expect(result.current.query.data).toBeTruthy());
    await result.current.save.mutateAsync(NESTED_DEFAULTS);
    expect(h.liveSyncEmits).toBe(1);
    expect(h.toastSuccess).toHaveBeenCalledTimes(1);
  });

  it("AWARIA PONOWNEGO ODCZYTU przerywa zapis - nic nie leci do bazy", async () => {
    // Zapis bez podstawy do scalenia nadpisałby wiersz wąskim szkicem. Lepszy
    // jest błąd niż cicha utrata gałęzi, których panel nie pokazuje.
    const { result } = mount();
    await waitFor(() => expect(result.current.query.data).toBeTruthy());
    readError = "statement timeout";
    await expect(result.current.save.mutateAsync(NESTED_DEFAULTS)).rejects.toThrow(
      "statement timeout",
    );
    expect(upserts).toHaveLength(0);
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(h.liveSyncEmits).toBe(0);
  });

  it("AWARIA ZAPISU pokazuje komunikat i NIE rozgłasza zmiany", async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.query.data).toBeTruthy());
    writeError = "permission denied for table site_settings";
    await expect(result.current.save.mutateAsync(NESTED_DEFAULTS)).rejects.toThrow(
      /permission denied/,
    );
    expect(h.toastError).toHaveBeenCalledWith("permission denied for table site_settings");
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(h.liveSyncEmits).toBe(0);
  });

  it("błąd BEZ komunikatu degraduje do zdania zastępczego, nie do pustego toasta", async () => {
    // `toast.error("")` renderuje pusty prostokąt - administrator nie wie, czy
    // zapis się udał.
    const { result } = mount();
    await waitFor(() => expect(result.current.query.data).toBeTruthy());
    writeError = "";
    await expect(result.current.save.mutateAsync(NESTED_DEFAULTS)).rejects.toThrow();
    expect(h.toastError).toHaveBeenCalledWith("Błąd zapisu");
  });

  it("hook WYSTAWIA stan zapisu - pasek zapisu ma czym się zablokować", async () => {
    // Bez tego stanu administrator może kliknąć „Zapisz" dwa razy i wysłać dwa
    // scalenia na tym samym wierszu - drugie z nich odczyta podstawę sprzed
    // pierwszego zapisu.
    //
    // Sprawdzamy tu WYŁĄCZNIE, że stan istnieje i wraca do spoczynku: atrapa
    // łańcucha PostgREST odpowiada synchronicznie (`TableResponder` z definicji
    // nie jest asynchroniczny), więc okno „w toku" zamyka się w tym samym
    // mikrozadaniu i nie da się go tu zaobserwować bez udawania zegara.
    // ZACHOWANIE paska zapisu przy trwającym zapisie pokrywa
    // `src/routes/__tests__/adminSettingsRoutes.test.tsx` („pasek zapisu
    // BLOKUJE się w trakcie zapisu", tabela po dwunastu panelach), gdzie stan
    // jest sterowany wprost.
    const { result } = mount();
    await waitFor(() => expect(result.current.query.data).toBeTruthy());
    expect(result.current.save.isPending).toBe(false);
    await result.current.save.mutateAsync(NESTED_DEFAULTS);
    await waitFor(() => expect(result.current.save.isPending).toBe(false));
    expect(upserts).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 3. SZKIC LOKALNY (`useDraft`).
// ---------------------------------------------------------------------------

describe("useDraft - lokalna wersja robocza panelu", () => {
  it("startuje jako `null`, dopóki dane się nie wczytają", () => {
    const { result } = renderHook(() => useDraft<NestedShape>(undefined));
    expect(result.current[0]).toBeNull();
  });

  it("przyjmuje wczytane dane RAZ - i nie nadpisuje ich przy kolejnym renderze", () => {
    // Autozapis w panelach ustawień byłby błędem: zmiana kolorów albo bannera
    // działa natychmiast na produkcji. Szkic jest lokalny, a przyjęcie danych
    // musi być JEDNORAZOWE - inaczej odświeżenie zapytania w tle wymazywałoby
    // niezapisane zmiany administratora w połowie edycji.
    const { result, rerender } = renderHook(
      ({ loaded }: { loaded: NestedShape | undefined }) => useDraft<NestedShape>(loaded),
      { initialProps: { loaded: undefined as NestedShape | undefined } },
    );
    expect(result.current[0]).toBeNull();

    rerender({ loaded: NESTED_DEFAULTS });
    expect(result.current[0]).toEqual(NESTED_DEFAULTS);

    // Świeży odczyt z bazy NIE MOŻE zdmuchnąć edycji.
    const edited = { ...NESTED_DEFAULTS, title: "Edytowane" };
    act(() => result.current[1](edited));
    rerender({ loaded: { ...NESTED_DEFAULTS, title: "Inny z bazy" } });
    expect(result.current[0]).toEqual(edited);
  });

  it("ustawienie szkicu na `null` PORZUCA zmiany i przywraca stan wczytany", () => {
    // To jest droga „porzuć zmiany". Uwaga na kolejność: efekt reaguje na
    // wyzerowanie szkicu NATYCHMIAST i przyjmuje wartość, która jest wczytana
    // W TEJ CHWILI - nie czeka na kolejny odczyt z bazy. Zapisujemy to jako
    // umowę, bo od niej zależy, czy „anuluj" pokazuje stan sprzed edycji
    // (tak jest) albo stan świeżo pobrany (tak NIE jest).
    const { result, rerender } = renderHook(
      ({ loaded }: { loaded: NestedShape | undefined }) => useDraft<NestedShape>(loaded),
      { initialProps: { loaded: NESTED_DEFAULTS as NestedShape | undefined } },
    );
    act(() => result.current[1]({ ...NESTED_DEFAULTS, title: "Edytowane" }));
    expect(result.current[0]?.title).toBe("Edytowane");

    act(() => result.current[1](null));
    expect(result.current[0]?.title).toBe("Domyślny tytuł");

    // Świeższy odczyt z bazy PO porzuceniu zmian już szkicu nie rusza.
    rerender({ loaded: { ...NESTED_DEFAULTS, title: "Świeże z bazy" } });
    expect(result.current[0]?.title).toBe("Domyślny tytuł");
  });

  it("dane, które nigdy nie doszły, zostawiają szkic na `null`", () => {
    const { result, rerender } = renderHook(
      ({ loaded }: { loaded: NestedShape | undefined }) => useDraft<NestedShape>(loaded),
      { initialProps: { loaded: undefined as NestedShape | undefined } },
    );
    rerender({ loaded: undefined });
    expect(result.current[0]).toBeNull();
  });
});
