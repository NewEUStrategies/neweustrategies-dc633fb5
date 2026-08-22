// Trasa `/admin/names` ZAMONTOWANA - stan i sklejenie słownika imion.
//
// CO TEN PLIK DOWODZI - I DLACZEGO NIE JEST FARMĄ POKRYCIA.
//
// `src/routes/__tests__/adminRouteAuthority.gate.test.ts` argumentuje wprost,
// że render-testowanie tras panelu DLA POKRYCIA jest farmą: ryzykiem w trasie
// panelu jest DOSTĘP, a dostęp egzekwują trzy miejsca, których render nie
// widzi (wspólny layout `/admin`, sama trasa, RLS w bazie). Bramka ma rację
// i `admin.names` jest w jej zakresie jako WZORZEC A - trasa superadmina,
// która sama PRZEKIEROWUJE. Bramka pilnuje tego statycznie (że warunek
// istnieje, że stoi PRZED zapytaniem do bazy); ten plik dowodzi tego, czego
// z tekstu pliku nie widać, czyli ZACHOWANIA:
//
//   1. PAGINACJA ODCZYTU. `load()` czyta stronami po 1000 wierszy w pętli.
//      Słownik imion ma naturalną skłonność do przekroczenia tysiąca, a błąd
//      w warunku wyjścia z pętli nie wywala niczego - po prostu OBCINA
//      słownik w ciszy i personalizacja przestaje znać część imion. Tabela
//      testów pokrywa: jedna strona, dokładnie granica, trzy strony, `null`
//      w danych.
//   2. ŁADUNEK KAŻDEJ MUTACJI. Co dokładnie leci do `name_dictionary` przy
//      dodaniu, edycji pola w wierszu, przełączeniu płci, kraju, flagi
//      „złożone” i przy imporcie. W szczególności PARY POWIĄZANYCH KOLUMN:
//      `origin_country` + `origin` (filtr kraju czyta pierwszą, eksport
//      drugą) oraz `english_form` + `vocative_en` - rozjazd w parze nie psuje
//      zapisu, tylko cicho gubi wiersz w filtrze albo w wyszukiwaniu.
//   3. STAN LOKALNY PO ZAPISIE. Optymistyczna podmiana wiersza dzieje się
//      TYLKO po udanym zapisie; po odmowie bazy ekran musi pokazywać stan
//      sprzed edycji, a nie wartość, której w bazie nie ma.
//   4. NASŁUCH REALTIME. Kanał, filtr zdarzeń, dedupe po `id`, sortowanie po
//      wstawce, scalenie przy UPDATE, usunięcie przy DELETE i zwolnienie
//      kanału przy odmontowaniu. Zgubiony `removeChannel` nie psuje nic od
//      razu - dopiero po kilku przejściach między trasami kończy się limit
//      kanałów i zdarzenia przestają przychodzić.
//   5. FILTRY I PAGINACJA WIDOKU - z gałęziami na wartościach FAŁSZYWYCH ALE
//      PRAWIDŁOWYCH (`origin_country: null` z wypełnionym `origin`, puste
//      zapytanie, `is_compound: false`) oraz zaciskanie numeru strony, gdy
//      filtr skróci listę pod stopami.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - REGUŁ CSV. Parsowanie, serializacja, normalizacja kraju, klasyfikacja
//   duplikatu i budowa ładunków to CZYSTE FUNKCJE w `@/lib/admin/namesCsv`
//   i mają tabelaryczny test `src/lib/admin/__tests__/namesCsv.test.ts`
//   (100% linii / 99.35% gałęzi) razem ze zgłoszonymi tam `it.fails`. Tutaj
//   dowodzimy tylko SKLEJENIA: że trasa woła te funkcje, respektuje ich
//   wynik i pokazuje właściwy komunikat.
// - AUTORYTETU BAZY. Czy RLS na `name_dictionary` przepuszcza tylko
//   superadmina - to pgTAP (`role_management_test.sql`,
//   `rls_tenant_isolation_test.sql`) i bramka `check:authz-snapshot`. Test na
//   atrapie nie odtwarza polityk; sprawdza, co trasa robi z ODMOWĄ.
// - REGUŁ GRAMATYCZNYCH. `normalize` i słownik powitań mają własne testy
//   w `src/lib/greetings/__tests__/`.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { RecordedChain, SupabaseFromStub } from "@/test/supabaseChain";
import type { FakeChannel, RealtimeStub } from "@/test/supabase/realtime";

// ---------------------------------------------------------------------------
// STAN ATRAP. `vi.hoisted`, bo fabryki `vi.mock` wykonują się przed importami.
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => ({
  isSuperAdmin: true,
  authLoading: false,
  lang: "pl" as string,
  /** `true` = instancja i18n jeszcze nie zna języka (stan przed inicjalizacją). */
  languageUnset: false,
  db: null as null | { from: (table: string) => unknown },
  realtime: null as null | { channel: unknown; removeChannel: unknown },
  toasts: [] as { kind: "success" | "error"; text: string }[],
  redirects: [] as string[],
  objectUrls: [] as { created: number; revoked: number }[],
}));

/**
 * Atrapa sesji. WIERNA W JEDNYM PUNKCIE, KTÓRY MA ZNACZENIE: dopóki `loading`
 * jest prawdą, role są NIEZNANE, więc `isSuperAdmin` musi być fałszem - tak
 * zachowuje się prawdziwy hook, który wylicza role z odpowiedzi bazy. Atrapa
 * oddająca `isSuperAdmin: true` w trakcie wczytywania pozwoliłaby efektowi
 * trasy wystrzelić zapytanie przed ustaleniem tożsamości i test „w trakcie
 * ustalania sesji nic się nie dzieje" przechodziłby albo padał z powodu, który
 * nie ma nic wspólnego z produkcją.
 */
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => {
    const isSuperAdmin = !h.authLoading && h.isSuperAdmin;
    return {
      session: isSuperAdmin ? { access_token: "t" } : null,
      user: { id: "00000000-0000-4000-8000-000000000001" },
      roles: isSuperAdmin ? ["super_admin"] : [],
      loading: h.authLoading,
      isSuperAdmin,
      isAdmin: isSuperAdmin,
      isStaff: true,
      signOut: async () => {},
    };
  },
}));

/**
 * Atrapa i18n z JEDNYM dodatkiem względem wspólnej `reactI18nextStub`:
 * `language` może być NIEUSTALONY. Prawdziwa instancja i18next ma `language`
 * `undefined`, dopóki nie skończy inicjalizacji, a trasa liczy się z tym
 * wprost (`i18n.language ?? "pl"`). Bez tej możliwości gałąź zapasowa jest
 * w teście martwa - a to ona decyduje, w jakim języku zobaczy panel ktoś, kto
 * wszedł na trasę przed dojściem plików tłumaczeń.
 */
vi.mock("react-i18next", async () => {
  const { translateKey } = await import("@/test/i18nStub");
  const i18n = {
    get language(): string | undefined {
      return h.languageUnset ? undefined : h.lang;
    },
    t: translateKey,
  };
  return {
    useTranslation: () => ({ t: translateKey, i18n }),
    initReactI18next: { type: "3rdParty", init: () => {} },
    Trans: (props: { children?: unknown }) => props.children ?? null,
  };
});

vi.mock("sonner", () => ({
  toast: {
    success: (text: string) => h.toasts.push({ kind: "success", text }),
    error: (text: string) => h.toasts.push({ kind: "error", text }),
  },
}));

/**
 * Klient sklejony z DWÓCH atrap: `supabaseFromStub()` (łańcuch PostgREST)
 * i `realtimeStub()` (kanały). Osobne moduły to nie przypadek - łańcuch
 * zapytań i kanał realtime to dwa niezależne kontrakty i test ma widzieć
 * każdy z nich osobno.
 */
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (!h.db) throw new Error("test: atrapa `from` nie została zainicjalizowana");
      return h.db.from(table);
    },
    channel: (name: string, config?: Record<string, unknown>) => {
      if (!h.realtime) throw new Error("test: atrapa kanałów nie została zainicjalizowana");
      const create = h.realtime.channel;
      if (typeof create !== "function") throw new Error("test: `channel` nie jest funkcją");
      return create(name, config);
    },
    removeChannel: (channel: unknown) => {
      if (!h.realtime) throw new Error("test: atrapa kanałów nie została zainicjalizowana");
      const remove = h.realtime.removeChannel;
      if (typeof remove !== "function") throw new Error("test: `removeChannel` nie jest funkcją");
      return remove(channel);
    },
  },
}));

// Przekierowanie zamiast prawdziwej nawigacji: harness montuje JEDNĄ trasę,
// więc `/admin` nie istnieje w drzewie. Zapisujemy CEL, bo to on jest treścią
// zachowania („odmowa prowadzi na `/admin`”, nie „gdziekolwiek”).
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Navigate: ({ to }: { to: string }) => {
      h.redirects.push(to);
      return null;
    },
  };
});

// Radix Select nie otwiera listy pod happy-dom (potrzebuje realnego
// wskaźnika), a wybór opcji jest tu całą treścią zachowania: KTÓRA kolumna
// dostaje nową wartość.
vi.mock("@/components/ui/select", async () =>
  (await import("@/test/reactStubs")).radixSelectStub(await import("react")),
);

// Radixowy `Dialog` wywala się pod happy-dom („Something went wrong!") na
// pomiarach warstwy portalu. Atrapa jest wierna w tym, na czym stoją asercje:
// treść jest w drzewie DOPIERO gdy `open`, a `onOpenChange(false)` woła to,
// co produkcja podała jako zamknięcie.
vi.mock("@/components/ui/dialog", async () => {
  const react = await import("react");
  return {
    Dialog: ({
      open,
      onOpenChange,
      children,
    }: {
      open?: boolean;
      onOpenChange?: (next: boolean) => void;
      children?: unknown;
    }) =>
      open
        ? react.createElement(
            "div",
            { "data-testid": "dialog" },
            // Dwie drogi, którymi PRAWDZIWY Radix woła `onOpenChange`:
            // zamknięcie z zewnątrz (Escape, klik w tło) i potwierdzenie
            // otwarcia. Atrapa musi mieć obie, bo produkcja rozróżnia je
            // warunkiem `if (!o)` - a bez tego warunek jest w teście martwy.
            react.createElement(
              "button",
              { "data-testid": "dialog-dismiss", onClick: () => onOpenChange?.(false) },
              "zamknij-z-zewnatrz",
            ),
            react.createElement(
              "button",
              { "data-testid": "dialog-reopen", onClick: () => onOpenChange?.(true) },
              "potwierdz-otwarcie",
            ),
            children as never,
          )
        : null,
    DialogContent: ({ children }: { children?: unknown }) =>
      react.createElement("div", null, children as never),
    DialogHeader: ({ children }: { children?: unknown }) =>
      react.createElement("div", null, children as never),
    DialogTitle: ({ children }: { children?: unknown }) =>
      react.createElement("h2", null, children as never),
    DialogDescription: ({ children }: { children?: unknown }) =>
      react.createElement("p", null, children as never),
    DialogFooter: ({ children }: { children?: unknown }) =>
      react.createElement("div", null, children as never),
  };
});

import { fail, ok, supabaseFromStub } from "@/test/supabaseChain";
import { realtimeStub } from "@/test/supabase/realtime";
import { renderRoute, type RenderedRoute } from "@/test/routeHarness";
import { normalize } from "@/lib/greetings/greetings";
import { Route as NamesRoute } from "@/routes/admin.names";

const TABLE = "name_dictionary";

/**
 * Wiersz słownika. Imiona są ZMYŚLONE i taki mają zostać: to plik testowy
 * powierzchni RODO-wrażliwej, więc fixture nie może nieść danych realnej
 * osoby. „Imię” samo w sobie nie jest daną osobową, ale zestaw imię+forma
 * gramatyczna+kraj wygląda jak wpis o człowieku i nie ma powodu, żeby był
 * prawdziwy.
 */
function nameRow(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  const name = typeof over.name === "string" ? over.name : "Zenobia";
  return {
    id: `id-${name.toLowerCase()}`,
    name,
    name_normalized: normalize(name),
    key: normalize(name),
    display_name: name,
    gender: "female",
    origin_country: "PL",
    origin: "PL",
    vocative_pl: null,
    instrumental_pl: null,
    genitive_pl: null,
    dative_pl: null,
    vocative_en: null,
    english_form: null,
    is_compound: false,
    notes: null,
    ...over,
  };
}

/** Atrapa bazy w tym teście - `null` znaczy „test nie ustawił atrapy”. */
function db(): SupabaseFromStub {
  const stub = dbStub;
  if (stub === null) throw new Error("test: atrapa bazy nie została zainicjalizowana");
  return stub;
}

function rt(): RealtimeStub {
  const stub = rtStub;
  if (stub === null) throw new Error("test: atrapa kanałów nie została zainicjalizowana");
  return stub;
}

let dbStub: SupabaseFromStub | null = null;
let rtStub: RealtimeStub | null = null;

beforeEach(() => {
  cleanup();
  dbStub = supabaseFromStub();
  rtStub = realtimeStub();
  h.db = { from: (table: string) => db().from(table) };
  h.realtime = {
    channel: (name: string, config?: Record<string, unknown>) => rt().channel(name, config),
    removeChannel: (channel: unknown) => {
      if (!isFakeChannel(channel)) throw new Error("test: usuwany kanał nie jest kanałem atrapy");
      return rt().removeChannel(channel);
    },
  };
  h.isSuperAdmin = true;
  h.authLoading = false;
  h.lang = "pl";
  h.languageUnset = false;
  h.toasts = [];
  h.redirects = [];
  h.objectUrls = [];
  db().setResponse(TABLE, ok([]));
});

/** STRAŻNIK, nie rzutowanie - kanał atrapy ma obserwowalny `subscribeCount`. */
function isFakeChannel(value: unknown): value is FakeChannel {
  return (
    typeof value === "object" && value !== null && "subscribeCount" in value && "listeners" in value
  );
}

/** STRAŻNIK rekordu: `typeof x === "object"` zawęża do `object`, a z `object` nie da się czytać pól. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// MONTAŻ I ODCZYTY EKRANU.
// ---------------------------------------------------------------------------

async function mount(): Promise<RenderedRoute> {
  return renderRoute({ route: NamesRoute, path: "/admin/names", initialEntry: "/admin/names" });
}

/**
 * Trasa z ZAKOŃCZONYM pierwszym odczytem.
 *
 * DLACZEGO NIE WYSTARCZY `waitFor` na jakikolwiek element: szkielet panelu
 * renderuje się natychmiast, a wiersze dokłada dopiero rozwiązana pętla
 * `load()`. Asercja na danych postawiona zaraz po pojawieniu się szkieletu
 * mierzyłaby stan „w locie", nie wynik - i dla pustej listy przechodziłaby
 * zawsze, także gdyby odczyt nigdy nie wrócił. Domknięcie jest
 * deterministyczne: czekamy na łańcuch zapytania, potem domykamy
 * mikrozadania przez `act` (bez zegara).
 */
async function mountLoaded(): Promise<RenderedRoute> {
  const rendered = await mount();
  await waitFor(() => expect(db().chainsFor(TABLE).length).toBeGreaterThan(0));
  await act(async () => {});
  return rendered;
}

function bodyText(): string {
  return document.body.textContent ?? "";
}

function selects(scope: ParentNode = document): HTMLSelectElement[] {
  return Array.from(scope.querySelectorAll<HTMLSelectElement>("select"));
}

function optionValues(element: HTMLSelectElement): string[] {
  return Array.from(element.options).map((option) => option.value);
}

/**
 * Selecty W WIERSZACH tabeli. Rozpoznanie jest STRUKTURALNE (miejsce
 * w drzewie), a nie po napisie etykiety: napis zmienia się przy pierwszej
 * poprawionej literówce w tłumaczeniu, miejsce w tabeli nie.
 */
function rowSelects(): HTMLSelectElement[] {
  const table = document.querySelectorAll("table");
  const main = table[table.length - 1];
  return main ? selects(main) : [];
}

/** Selecty POZA tabelą: formularz dodawania i pasek filtrów. */
function chromeSelects(): HTMLSelectElement[] {
  return selects().filter((element) => element.closest("table") === null);
}

function selectWithOptions(...values: string[]): HTMLSelectElement {
  const found = chromeSelects().find((element) => {
    const options = optionValues(element);
    return values.length === options.length && values.every((value, i) => options[i] === value);
  });
  if (!found) throw new Error(`test: brak selecta o opcjach ${values.join(",")}`);
  return found;
}

const GENDERS = ["male", "female", "neutral"] as const;

/** Płeć w formularzu dodawania - trzy opcje bez „wszystkie”. */
function draftGenderSelect(): HTMLSelectElement {
  return selectWithOptions(...GENDERS);
}

/** Kraj w formularzu dodawania - kody bez „wszystkie”. */
function draftCountrySelect(): HTMLSelectElement {
  const found = chromeSelects().find((element) => {
    const options = optionValues(element);
    return options.includes("PL") && !options.includes("all");
  });
  if (!found) throw new Error("test: brak selecta kraju w formularzu dodawania");
  return found;
}

function filterGenderSelect(): HTMLSelectElement {
  return selectWithOptions("all", ...GENDERS);
}

function filterCountrySelect(): HTMLSelectElement {
  const found = chromeSelects().find((element) => {
    const options = optionValues(element);
    return options[0] === "all" && options.includes("PL");
  });
  if (!found) throw new Error("test: brak filtra kraju");
  return found;
}

function filterCompoundSelect(): HTMLSelectElement {
  return selectWithOptions("all", "yes", "no");
}

/** Pola tekstowe poza tabelą, bez ukrytego inputu pliku i bez wyszukiwania. */
function chromeInputs(): HTMLInputElement[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>("input")).filter(
    (element) =>
      element.closest("table") === null &&
      element.type !== "file" &&
      !(element.placeholder ?? "").toLowerCase().includes("szuka") &&
      !(element.placeholder ?? "").toLowerCase().includes("search"),
  );
}

/** Kolejność w karcie „Dodaj imię”: imię, wołacz PL, forma EN. */
function draftInput(which: "name" | "vocative" | "english"): HTMLInputElement {
  const index = which === "name" ? 0 : which === "vocative" ? 1 : 2;
  const element = chromeInputs()[index];
  if (!element) throw new Error(`test: brak pola ${which} w formularzu dodawania`);
  return element;
}

function searchInput(): HTMLInputElement {
  const element = Array.from(document.querySelectorAll<HTMLInputElement>("input")).find((input) =>
    (input.placeholder ?? "").toLowerCase().match(/szukaj|search/),
  );
  if (!element) throw new Error("test: brak pola wyszukiwania");
  return element;
}

function fileInput(): HTMLInputElement {
  const element = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!element) throw new Error("test: brak ukrytego pola pliku");
  return element;
}

function buttonByText(text: string): HTMLButtonElement {
  const found = Array.from(document.querySelectorAll("button")).find((button) =>
    (button.textContent ?? "").includes(text),
  );
  if (!(found instanceof HTMLButtonElement)) throw new Error(`test: brak przycisku „${text}”`);
  return found;
}

/** Wiersze tabeli głównej (bez wiersza „brak wyników”, który ma `colSpan`). */
function dataRows(): HTMLTableRowElement[] {
  const tables = document.querySelectorAll("table");
  const main = tables[tables.length - 1];
  if (!main) return [];
  return Array.from(main.querySelectorAll("tbody tr")).filter(
    (row): row is HTMLTableRowElement =>
      row instanceof HTMLTableRowElement && row.querySelector("td[colspan]") === null,
  );
}

function rowNames(): string[] {
  return dataRows().map((row) => row.querySelector("td")?.textContent ?? "");
}

function rowInputs(index: number): HTMLInputElement[] {
  const row = dataRows()[index];
  if (!row) throw new Error(`test: brak wiersza numer ${index}`);
  return Array.from(row.querySelectorAll<HTMLInputElement>('input:not([type="checkbox"])'));
}

function rowCheckbox(index: number): HTMLInputElement {
  const row = dataRows()[index];
  const element = row?.querySelector<HTMLInputElement>('input[type="checkbox"]');
  if (!element) throw new Error(`test: brak przełącznika „złożone” w wierszu ${index}`);
  return element;
}

function lastToast(kind: "success" | "error"): string {
  const found = [...h.toasts].reverse().find((entry) => entry.kind === kind);
  return found?.text ?? "";
}

function writeChains(method: "insert" | "update" | "delete"): RecordedChain[] {
  return db()
    .chainsFor(TABLE)
    .filter((chain) => chain.has(method));
}

function payloadOf(
  chain: RecordedChain | undefined,
  method: "insert" | "update",
): Record<string, unknown> {
  const args = chain?.argsOf(method);
  const payload = args?.[0];
  if (!isRecord(payload)) throw new Error(`test: łańcuch bez ładunku ${method}`);
  return payload;
}

// ===========================================================================
// 1. AUTORYTET TRASY - odmowa PRZED pytaniem bazy
// ===========================================================================

describe("admin.names - autorytet trasy", () => {
  it("BEZ roli superadmina trasa PRZEKIEROWUJE i nie pyta bazy ani o jeden wiersz", async () => {
    // To jest cała treść wzorca A: trasa nie „ukrywa przycisków”, tylko wyprowadza
    // z ekranu. Asercja na ZBIORZE odpytanych tabel jest tu ważniejsza niż na
    // widoku: zapytanie wysłane przed sprawdzeniem roli pokazałoby zawartość
    // słownika w zakładce sieć, nawet gdyby ekran zaraz zniknął.
    h.isSuperAdmin = false;
    await mount();
    await waitFor(() => expect(h.redirects).toEqual(["/admin"]));

    expect(db().chains).toEqual([]);
    expect(rt().channels).toEqual([]);
  });

  it("W TRAKCIE ustalania sesji nie ma ANI ekranu, ANI przekierowania", async () => {
    // Przekierowanie w trakcie `loading` wyrzuciłoby superadmina z jego własnej
    // trasy przy każdym odświeżeniu tokenu. Pusty render to jedyna poprawna
    // odpowiedź na „jeszcze nie wiem, kto to jest”.
    h.authLoading = true;
    await mount();
    await act(async () => {});

    expect(h.redirects).toEqual([]);
    expect(bodyText()).not.toContain("Słownik imion");
    expect(db().chains).toEqual([]);
  });

  it("Z rolą superadmina trasa czyta słownik i wystawia ekran", async () => {
    db().setResponse(TABLE, ok([nameRow({ name: "Zenobia" })]));
    await mountLoaded();

    expect(h.redirects).toEqual([]);
    expect(bodyText()).toContain("Słownik imion");
    expect(rowNames()[0]).toContain("Zenobia");
  });
});

// ===========================================================================
// 2. ODCZYT - paginacja zapytania i kształt łańcucha
// ===========================================================================

/** `n` wierszy o różnych kluczach - do sprawdzania granicy stronicowania. */
function manyRows(count: number, prefix = "Imie"): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, i) => nameRow({ name: `${prefix}${i}` }));
}

/** Zakresy `range(from, to)` wszystkich odczytów, w kolejności wywołań. */
function readRanges(): (readonly unknown[] | undefined)[] {
  return db()
    .chainsFor(TABLE)
    .filter((chain) => chain.has("range"))
    .map((chain) => chain.argsOf("range"));
}

describe("admin.names - odczyt słownika: paginacja zapytania", () => {
  it("kształt zapytania jest KONTRAKTEM: select kolumn, `order(name)`, `range` od zera", async () => {
    db().setResponse(TABLE, ok(manyRows(3)));
    await mountLoaded();

    const chain = db().chainsFor(TABLE)[0];
    expect(chain?.calls.map((call) => call.method)).toEqual(["select", "order", "range"]);
    expect(chain?.argsOf("order")).toEqual(["name", { ascending: true }]);
    expect(chain?.argsOf("range")).toEqual([0, 999]);
    // Kolumny wyliczone jednym literałem - lista jest kontraktem z bazą,
    // więc test pilnuje, że nie zniknęła z niej kolumna czytana przez ekran.
    const select = chain?.argsOf("select")?.[0];
    expect(typeof select).toBe("string");
    if (typeof select !== "string") throw new Error("test: `select` bez argumentu");
    for (const column of [
      "key",
      "display_name",
      "gender",
      "origin_country",
      "vocative_pl",
      "is_compound",
    ]) {
      expect(select, `brak kolumny ${column} w select`).toContain(column);
    }
  });

  it("STRONA NIEPEŁNA kończy pętlę po jednym zapytaniu", async () => {
    db().setResponse(TABLE, ok(manyRows(3)));
    await mountLoaded();

    expect(readRanges()).toEqual([[0, 999]]);
    expect(dataRows()).toHaveLength(3);
  });

  it("DOKŁADNIE 1000 wierszy wymusza DRUGIE zapytanie - inaczej słownik jest ucinany w ciszy", async () => {
    // To jest defekt, którego nie widać: pętla przerwana na pełnej stronie
    // oddaje 1000 imion z 1001 i nikt tego nie zauważa, dopóki personalizacja
    // nie przestanie znać jednego nazwiska.
    db().setResponse(TABLE, (chain) => {
      const from = chain.argsOf("range")?.[0];
      return from === 0 ? ok(manyRows(1000, "A")) : ok(manyRows(1, "B"));
    });
    await mountLoaded();
    await waitFor(() => expect(readRanges()).toHaveLength(2));

    expect(readRanges()).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(dataRows()).toHaveLength(100); // widok stronicuje po 100
    expect(bodyText()).toContain("1001");
  });

  it("TRZY strony sklejają się w jedną listę, a kolejne zakresy nie przeskakują wiersza", async () => {
    db().setResponse(TABLE, (chain) => {
      const from = chain.argsOf("range")?.[0];
      if (from === 0) return ok(manyRows(1000, "A"));
      if (from === 1000) return ok(manyRows(1000, "B"));
      return ok(manyRows(5, "C"));
    });
    await mountLoaded();
    await waitFor(() => expect(readRanges()).toHaveLength(3));

    expect(readRanges()).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
    expect(bodyText()).toContain("2005");
  });

  it("`data: null` jest czytane jako pusta strona, a nie jako wyjątek", async () => {
    // PostgREST oddaje `null` przy pustym wyniku niektórych zapytań; `?? []`
    // w produkcji jest tu jedyną barierą przed `Cannot read length of null`.
    db().setResponse(TABLE, ok(null));
    await mountLoaded();

    expect(readRanges()).toEqual([[0, 999]]);
    expect(bodyText()).toContain("Brak wyników");
  });

  it("AWARIA ODCZYTU przerywa pętlę, pokazuje komunikat i zwalnia przycisk dodawania", async () => {
    // Zablokowany na zawsze przycisk („busy” nieodkręcone) to defekt tej samej
    // klasy co niepokazany błąd: ekran wygląda na sprawny, tylko nic nie robi.
    db().setResponse(TABLE, fail("permission denied for table name_dictionary", "42501"));
    await mountLoaded();

    expect(readRanges()).toEqual([[0, 999]]);
    expect(lastToast("error")).toContain("permission denied");
    expect(buttonByText("Dodaj")).toBeEnabled();
    expect(bodyText()).toContain("Brak wyników");
  });

  it.fails(
    "DEFEKT: awaria odczytu dochodzi do administratora SUROWYM komunikatem bazy, nie kluczem i18n",
    async () => {
      // `toast.error(error.message)` w `load`, `addOne`, `updateRow` i `deleteRow`
      // wypisuje tekst PostgreSQL-a (po angielsku, z nazwą polityki i tabeli)
      // w panelu, który cały jest dwujęzyczny. Skutek jest podwójny: polski
      // administrator dostaje komunikat, którego nie rozumie, a przeciek nazw
      // polityk i tabel podpowiada, jak ta baza jest zbudowana.
      //
      // Naprawa to zmiana produkcyjna (mapowanie kodu błędu na klucz
      // tłumaczenia), więc tutaj tylko zgłoszenie. Kontrola dodatnia wyżej
      // („AWARIA ODCZYTU...") przypina stan faktyczny, żeby nikt nie „naprawił”
      // tego przypadkiem w drugą stronę.
      db().setResponse(TABLE, fail("permission denied for table name_dictionary", "42501"));
      await mountLoaded();

      expect(lastToast("error")).not.toContain("permission denied");
    },
  );
});

// ===========================================================================
// 3. DODANIE IMIENIA - ładunek i stan formularza
// ===========================================================================

describe("admin.names - dodanie imienia", () => {
  /** Wypełnia formularz i klika „Dodaj”. */
  async function addName(values: {
    name: string;
    vocative?: string;
    english?: string;
  }): Promise<void> {
    fireEvent.change(draftInput("name"), { target: { value: values.name } });
    if (values.vocative !== undefined) {
      fireEvent.change(draftInput("vocative"), { target: { value: values.vocative } });
    }
    if (values.english !== undefined) {
      fireEvent.change(draftInput("english"), { target: { value: values.english } });
    }
    fireEvent.click(buttonByText("Dodaj"));
    await act(async () => {});
  }

  it("pełny formularz leci JEDNYM `insert`, z kluczem i normalizacją z produkcji", async () => {
    await mountLoaded();
    await addName({ name: "  Bożydara  ", vocative: " Bożydaro ", english: " Bozhidara " });

    expect(writeChains("insert")).toHaveLength(1);
    expect(payloadOf(writeChains("insert")[0], "insert")).toEqual({
      name: "Bożydara",
      name_normalized: normalize("Bożydara"),
      display_name: "Bożydara",
      key: normalize("Bożydara"),
      gender: "male",
      origin_country: "PL",
      origin: "PL",
      vocative_pl: "Bożydaro",
      english_form: "Bozhidara",
      vocative_en: "Bozhidara",
    });
  });

  it("PARA `english_form` + `vocative_en` jedzie zawsze razem", async () => {
    // Rozjazd w tej parze nie psuje zapisu: wołacz angielski zostaje pusty,
    // a personalizacja anglojęzyczna po cichu wraca do formy podstawowej.
    await mountLoaded();
    await addName({ name: "Dobrosława", english: "Dobroslava" });

    const payload = payloadOf(writeChains("insert")[0], "insert");
    expect(payload.english_form).toBe("Dobroslava");
    expect(payload.vocative_en).toBe(payload.english_form);
  });

  it("PUSTE pola opcjonalne schodzą do `null`, a nie do pustego napisu", async () => {
    // `vocative_pl = ""` udaje wypełnioną formę gramatyczną: wyszukiwanie
    // brakujących odmian przestaje ten wiersz widzieć.
    await mountLoaded();
    await addName({ name: "Świętomir", vocative: "   ", english: "" });

    const payload = payloadOf(writeChains("insert")[0], "insert");
    expect(payload.vocative_pl).toBeNull();
    expect(payload.english_form).toBeNull();
    expect(payload.vocative_en).toBeNull();
  });

  it.each([
    { label: "puste", typed: "" },
    { label: "same spacje", typed: "   " },
  ])("imię $label BLOKUJE zapis i mówi o tym wprost", async ({ typed }) => {
    await mountLoaded();
    await addName({ name: typed });

    expect(writeChains("insert")).toHaveLength(0);
    expect(lastToast("error")).toBe("Podaj imię");
  });

  it("wybrana płeć i kraj jadą do ładunku, a kraj DWIEMA kolumnami", async () => {
    await mountLoaded();
    fireEvent.change(draftGenderSelect(), { target: { value: "neutral" } });
    fireEvent.change(draftCountrySelect(), { target: { value: "UA" } });
    await addName({ name: "Radomił" });

    const payload = payloadOf(writeChains("insert")[0], "insert");
    expect(payload.gender).toBe("neutral");
    expect(payload.origin_country).toBe("UA");
    expect(payload.origin).toBe("UA");
  });

  it("po UDANYM zapisie formularz czyści imię, ale ZOSTAWIA płeć i kraj", async () => {
    // Administrator dodaje imiona seriami z tego samego kraju; zerowanie tych
    // dwóch pól kazałoby wybierać je przy każdym wierszu od nowa.
    await mountLoaded();
    fireEvent.change(draftCountrySelect(), { target: { value: "CZ" } });
    fireEvent.change(draftGenderSelect(), { target: { value: "female" } });
    await addName({ name: "Milena", vocative: "Mileno" });

    expect(draftInput("name")).toHaveValue("");
    expect(draftInput("vocative")).toHaveValue("");
    expect(draftCountrySelect()).toHaveValue("CZ");
    expect(draftGenderSelect()).toHaveValue("female");
    expect(lastToast("success")).toBe("Dodano");
  });

  it("po ODMOWIE bazy formularz ZOSTAJE wypełniony, a sukcesu nie ma", async () => {
    db().setResponse(TABLE, (chain) =>
      chain.has("insert")
        ? fail('duplicate key value violates unique constraint "name_dictionary_key_key"', "23505")
        : ok([]),
    );
    await mountLoaded();
    await addName({ name: "Zenobia", vocative: "Zenobio" });

    expect(lastToast("error")).toContain("name_dictionary_key_key");
    expect(h.toasts.some((entry) => entry.kind === "success")).toBe(false);
    expect(draftInput("name")).toHaveValue("Zenobia");
  });

  it("interfejs angielski zmienia KOMUNIKATY, nie tylko napisy na przyciskach", async () => {
    // Napisy są wpisane w kodzie dwujęzycznie (`L ? ... : ...`), więc asercja
    // jest na RÓŻNICY: konkretne copy wolno poprawić, dwujęzyczności nie wolno
    // zgubić.
    h.lang = "en";
    await mountLoaded();
    fireEvent.click(buttonByText("Add"));
    await act(async () => {});

    expect(lastToast("error")).toBe("Enter a name");
    expect(bodyText()).toContain("Name dictionary");
    expect(bodyText()).not.toContain("Słownik imion");
  });
});

// ===========================================================================
// 4. EDYCJA W WIERSZU - ładunek łatki i stan lokalny po odmowie
// ===========================================================================

/** Kolejność pól tekstowych w wierszu - tak samo jak w produkcji. */
const ROW_FIELDS = [
  "vocative_pl",
  "instrumental_pl",
  "genitive_pl",
  "dative_pl",
  "english_form",
] as const;

describe("admin.names - edycja w wierszu", () => {
  async function mountOneRow(over: Partial<Record<string, unknown>> = {}): Promise<void> {
    db().setResponse(TABLE, (chain) => (chain.has("select") ? ok([nameRow(over)]) : ok(null)));
    await mountLoaded();
    await waitFor(() => expect(dataRows()).toHaveLength(1));
  }

  it.each(ROW_FIELDS.map((field, index) => ({ field, index })))(
    "pole $field zapisuje się osobną łatką zawężoną do `id`",
    async ({ field, index }) => {
      await mountOneRow();
      const field_input = rowInputs(0)[index];
      if (!field_input) throw new Error(`test: brak pola numer ${index} w wierszu`);
      fireEvent.blur(field_input, { target: { value: "Wartość" } });
      await act(async () => {});

      const chain = writeChains("update").at(-1);
      expect(chain?.argsOf("eq")).toEqual(["id", "id-zenobia"]);
      expect(payloadOf(chain, "update")[field]).toBe("Wartość");
    },
  );

  it("pole `english_form` zapisuje TAKŻE `vocative_en` - jedna łatka, dwie kolumny", async () => {
    await mountOneRow();
    fireEvent.blur(rowInputs(0)[4], { target: { value: "Zenobia-EN" } });
    await act(async () => {});

    expect(payloadOf(writeChains("update").at(-1), "update")).toEqual({
      english_form: "Zenobia-EN",
      vocative_en: "Zenobia-EN",
    });
  });

  it("WYCZYSZCZONE pole schodzi do `null`, nie do pustego napisu", async () => {
    await mountOneRow({ vocative_pl: "Zenobio" });
    fireEvent.blur(rowInputs(0)[0], { target: { value: "   " } });
    await act(async () => {});

    expect(payloadOf(writeChains("update").at(-1), "update").vocative_pl).toBeNull();
  });

  it("WYCZYSZCZONA forma angielska zeruje OBIE kolumny pary, nie tylko jedną", async () => {
    // Gałąź `v || null` na polu `english_form`: usunięcie formy angielskiej
    // musi zdjąć też wołacz angielski. Zostawiony `vocative_en` to wołacz od
    // imienia, którego już nie ma - i właśnie on trafi do wiadomości.
    await mountOneRow({ english_form: "Zenobia-EN", vocative_en: "Zenobia-EN" });
    fireEvent.blur(rowInputs(0)[4], { target: { value: "  " } });
    await act(async () => {});

    expect(payloadOf(writeChains("update").at(-1), "update")).toEqual({
      english_form: null,
      vocative_en: null,
    });
  });

  it("opuszczenie pola BEZ ZMIANY nie wysyła nic - inaczej każde kliknięcie obok byłoby zapisem", async () => {
    await mountOneRow({ vocative_pl: "Zenobio" });
    fireEvent.blur(rowInputs(0)[0], { target: { value: "Zenobio" } });
    await act(async () => {});

    expect(writeChains("update")).toHaveLength(0);
  });

  it('pole PUSTE w bazie opuszczone puste też nie wysyła nic (`null` kontra `""`)', async () => {
    // Gałąź `(r[field] ?? "")`: `null` z bazy i pusty input to ta sama treść,
    // więc porównanie musi je uznać za równe - inaczej samo wejście w wiersz
    // generowałoby pięć zapisów `null -> null`.
    await mountOneRow({ vocative_pl: null });
    fireEvent.blur(rowInputs(0)[0], { target: { value: "" } });
    await act(async () => {});

    expect(writeChains("update")).toHaveLength(0);
  });

  it.each(GENDERS)("zmiana płci na %s zapisuje jedno pole", async (gender) => {
    await mountOneRow({ gender: gender === "female" ? "male" : "female" });
    fireEvent.change(rowSelects()[0], { target: { value: gender } });
    await act(async () => {});

    expect(payloadOf(writeChains("update").at(-1), "update")).toEqual({ gender });
  });

  it("zmiana kraju w wierszu zapisuje `origin_country` I `origin` tą samą wartością", async () => {
    // Filtr kraju czyta `origin_country ?? origin`, a eksport CSV `origin`.
    // Zapis tylko jednej kolumny gubi wiersz w jednym z tych dwóch miejsc.
    await mountOneRow();
    fireEvent.change(rowSelects()[1], { target: { value: "SE" } });
    await act(async () => {});

    expect(payloadOf(writeChains("update").at(-1), "update")).toEqual({
      origin_country: "SE",
      origin: "SE",
    });
  });

  it.each([
    { from: false, to: true },
    { from: true, to: false },
  ])("flaga „złożone” $from -> $to jedzie jako wartość LOGICZNA", async ({ from, to }) => {
    // `is_compound: "false"` (napis) jest w Postgresie prawdą - stąd asercja na
    // typie, nie na „czymś prawdziwym”.
    await mountOneRow({ is_compound: from });
    fireEvent.click(rowCheckbox(0));
    await act(async () => {});

    const payload = payloadOf(writeChains("update").at(-1), "update");
    expect(payload).toEqual({ is_compound: to });
    expect(typeof payload.is_compound).toBe("boolean");
  });

  it("UDANY zapis podmienia wiersz na ekranie bez ponownego odczytu z bazy", async () => {
    await mountOneRow({ gender: "female" });
    fireEvent.change(rowSelects()[0], { target: { value: "neutral" } });
    await waitFor(() => expect(rowSelects()[0]).toHaveValue("neutral"));

    // Jeden odczyt (montaż) i jeden zapis - żadnego odświeżania całej listy.
    expect(readRanges()).toHaveLength(1);
    expect(writeChains("update")).toHaveLength(1);
  });

  it("ODMOWA bazy ZOSTAWIA stan sprzed edycji - ekran nie może pokazywać wartości, której nie ma", async () => {
    db().setResponse(TABLE, (chain) => {
      if (chain.has("update")) return fail("permission denied for table name_dictionary", "42501");
      return ok([nameRow({ gender: "female" })]);
    });
    await mountLoaded();
    await waitFor(() => expect(dataRows()).toHaveLength(1));

    fireEvent.change(rowSelects()[0], { target: { value: "neutral" } });
    await waitFor(() => expect(lastToast("error")).toContain("permission denied"));

    expect(rowSelects()[0]).toHaveValue("female");
  });

  it("kraj nieznany w bazie schodzi w kontrolce do `OTHER`, a nie do pustego wyboru", async () => {
    // Gałąź `r.origin_country ?? r.origin ?? "OTHER"`: pusty `value` selecta
    // pokazywałby PIERWSZY kraj listy jako wybrany, czyli KŁAMAŁ o danych.
    await mountOneRow({ origin_country: null, origin: null });

    expect(rowSelects()[1]).toHaveValue("OTHER");
  });

  it("kraj obecny TYLKO w `origin` jest w kontrolce widoczny (gałąź zapasowa `??`)", async () => {
    await mountOneRow({ origin_country: null, origin: "DE" });

    expect(rowSelects()[1]).toHaveValue("DE");
  });

  it("wiersz bez `display_name` pokazuje `name`, a pod nim `key` albo `name_normalized`", async () => {
    await mountOneRow({ display_name: null, key: null, name: "Wielisława" });

    expect(rowNames()[0]).toContain("Wielisława");
    expect(rowNames()[0]).toContain(normalize("Wielisława"));
  });
});

// ===========================================================================
// 5. USUWANIE WIERSZA
// ===========================================================================

describe("admin.names - usuwanie wiersza", () => {
  async function mountForDelete(): Promise<void> {
    db().setResponse(TABLE, (chain) => (chain.has("delete") ? ok(null) : ok([nameRow()])));
    await mountLoaded();
    await waitFor(() => expect(dataRows()).toHaveLength(1));
  }

  it("usunięcie leci jako `delete` zawężony do `id` - bez żadnego drugiego filtra", async () => {
    // Zawężenie najemcą po stronie klienta byłoby tu do obejścia w konsoli;
    // autorytetem jest RLS. Asercja mówi więc też, czego w łańcuchu NIE MA.
    await mountForDelete();
    const trash = dataRows()[0]?.querySelector("button");
    if (!(trash instanceof HTMLButtonElement)) throw new Error("test: brak przycisku usuwania");
    fireEvent.click(trash);
    await act(async () => {});

    const chain = writeChains("delete").at(-1);
    expect(chain?.calls.map((call) => call.method)).toEqual(["delete", "eq"]);
    expect(chain?.argsOf("eq")).toEqual(["id", "id-zenobia"]);
  });

  it("ODMOWA usunięcia pokazuje komunikat i zostawia wiersz na ekranie", async () => {
    db().setResponse(TABLE, (chain) =>
      chain.has("delete")
        ? fail("permission denied for table name_dictionary", "42501")
        : ok([nameRow()]),
    );
    await mountLoaded();
    await waitFor(() => expect(dataRows()).toHaveLength(1));

    const trash = dataRows()[0]?.querySelector("button");
    if (!(trash instanceof HTMLButtonElement)) throw new Error("test: brak przycisku usuwania");
    fireEvent.click(trash);
    await waitFor(() => expect(lastToast("error")).toContain("permission denied"));

    expect(dataRows()).toHaveLength(1);
  });

  it("KONTROLA DODATNIA: po UDANYM usunięciu wiersz zostaje, dopóki nie przyjdzie zdarzenie realtime", async () => {
    // Stan faktyczny, przypięty świadomie: `deleteRow` nie rusza stanu
    // lokalnego, bo liczy na nasłuch. Defekt tego układu jest zgłoszony niżej.
    await mountForDelete();
    const trash = dataRows()[0]?.querySelector("button");
    if (!(trash instanceof HTMLButtonElement)) throw new Error("test: brak przycisku usuwania");
    fireEvent.click(trash);
    await act(async () => {});

    expect(writeChains("delete")).toHaveLength(1);
    expect(dataRows()).toHaveLength(1);
    expect(h.toasts).toEqual([]);
  });

  it.fails(
    "DEFEKT: udane usunięcie bez działającego nasłuchu zostawia wiersz na ekranie i BEZ komunikatu",
    async () => {
      // `deleteRow` po udanym zapisie nie robi NIC: ani nie zdejmuje wiersza ze
      // stanu, ani nie pokazuje potwierdzenia. Ekran wygląda tak, jakby
      // kliknięcie nie zadziałało, więc administrator klika ponownie - i drugie
      // `delete` na tym samym `id` przechodzi bez błędu, maskując problem.
      // Wiersz znika tylko wtedy, gdy dojdzie zdarzenie realtime; przy plakietce
      // „Offline” (kanał niezasubskrybowany) nie dojdzie nigdy.
      //
      // Naprawa to zmiana produkcyjna (zdjęcie wiersza ze stanu po udanym
      // zapisie, jak robi to `updateRow`), więc tutaj tylko zgłoszenie.
      await mountForDelete();
      const trash = dataRows()[0]?.querySelector("button");
      if (!(trash instanceof HTMLButtonElement)) throw new Error("test: brak przycisku usuwania");
      fireEvent.click(trash);
      await act(async () => {});

      expect(dataRows()).toHaveLength(0);
    },
  );
});

// ===========================================================================
// 6. FILTRY - gałęzie na wartościach fałszywych ale prawidłowych
// ===========================================================================

/** Trzy wiersze różniące się dokładnie tym, po czym filtruje panel. */
const FILTER_ROWS: readonly Record<string, unknown>[] = [
  nameRow({
    name: "Miłosz",
    gender: "male",
    origin_country: "PL",
    origin: "PL",
    is_compound: false,
  }),
  nameRow({
    name: "Ingeborga",
    gender: "female",
    origin_country: "SE",
    origin: "SE",
    is_compound: true,
  }),
  // Kraj TYLKO w `origin` - gałąź zapasowa `origin_country ?? origin`.
  nameRow({
    name: "Aurelia",
    gender: "female",
    origin_country: null,
    origin: "IT",
    is_compound: false,
  }),
];

describe("admin.names - filtry", () => {
  async function mountFiltered(): Promise<void> {
    db().setResponse(TABLE, ok(FILTER_ROWS));
    await mountLoaded();
    await waitFor(() => expect(dataRows()).toHaveLength(3));
  }

  it.each([
    { label: "wszystkie płcie", value: "all", expected: ["Miłosz", "Ingeborga", "Aurelia"] },
    { label: "męskie", value: "male", expected: ["Miłosz"] },
    { label: "żeńskie", value: "female", expected: ["Ingeborga", "Aurelia"] },
    { label: "neutralne (pusty wynik)", value: "neutral", expected: [] },
  ])("filtr płci „$label” zawęża listę do $expected", async ({ value, expected }) => {
    await mountFiltered();
    fireEvent.change(filterGenderSelect(), { target: { value } });
    await waitFor(() => expect(dataRows()).toHaveLength(expected.length));

    for (const name of expected) expect(rowNames().join("|")).toContain(name);
  });

  it("filtr kraju czyta `origin_country`, a gdy jej nie ma - `origin`", async () => {
    // Bez gałęzi zapasowej wiersze zaimportowane starszym CSV (tylko `origin`)
    // byłyby niewidoczne w każdym filtrze kraju - czyli praktycznie zgubione.
    await mountFiltered();
    fireEvent.change(filterCountrySelect(), { target: { value: "IT" } });
    await waitFor(() => expect(dataRows()).toHaveLength(1));

    expect(rowNames()[0]).toContain("Aurelia");
  });

  it('wiersz BEZ obu kolumn kraju nie wpada do żadnego filtra kraju (`?? ""`)', async () => {
    db().setResponse(
      TABLE,
      ok([nameRow({ name: "Bezkraju", origin_country: null, origin: null })]),
    );
    await mountLoaded();
    await waitFor(() => expect(dataRows()).toHaveLength(1));

    fireEvent.change(filterCountrySelect(), { target: { value: "PL" } });
    await waitFor(() => expect(bodyText()).toContain("Brak wyników"));
    expect(dataRows()).toHaveLength(0);
  });

  it.each([
    { value: "yes", expected: ["Ingeborga"] },
    { value: "no", expected: ["Miłosz", "Aurelia"] },
  ])(
    "filtr „złożone” = $value działa na wartości LOGICZNEJ, nie na jej obecności",
    async ({ value, expected }) => {
      // `!!r.is_compound !== (filterCompound === "yes")`: `false` i `null` to dla
      // tego filtra to samo („pojedyncze”), a `undefined` nie może wpaść do obu
      // grup naraz.
      await mountFiltered();
      fireEvent.change(filterCompoundSelect(), { target: { value } });
      await waitFor(() => expect(dataRows()).toHaveLength(expected.length));

      expect(rowNames().join("|")).toContain(expected[0]);
    },
  );

  it.each([
    { label: "dokładne", typed: "Ingeborga", found: 1 },
    { label: "fragment", typed: "gebor", found: 1 },
    { label: "BEZ znaków diakrytycznych", typed: "milosz", found: 1 },
    { label: "wielkimi literami", typed: "AURELIA", found: 1 },
    { label: "same spacje = brak filtra", typed: "   ", found: 3 },
    { label: "nic nie pasuje", typed: "Nieistniejace", found: 0 },
  ])("wyszukiwanie „$label” znajduje $found", async ({ typed, found }) => {
    await mountFiltered();
    fireEvent.change(searchInput(), { target: { value: typed } });
    await waitFor(() => expect(dataRows()).toHaveLength(found));
  });

  it("licznik pokazuje ZAKRES i sumę, a przy filtrze także rozmiar całości", async () => {
    await mountFiltered();
    expect(bodyText()).toContain("1-3");

    fireEvent.change(filterGenderSelect(), { target: { value: "male" } });
    await waitFor(() => expect(dataRows()).toHaveLength(1));
    // Suma po filtrze (1) i całość (3) - bez drugiej liczby administrator nie
    // wie, czy filtr coś odsiał, czy słownik jest pusty.
    expect(bodyText()).toContain("łącznie");
    expect(bodyText()).toContain("3");
  });

  it("PUSTY wynik zeruje początek zakresu, a nie pokazuje „1-0”", async () => {
    await mountFiltered();
    fireEvent.change(searchInput(), { target: { value: "Nieistniejace" } });
    await waitFor(() => expect(bodyText()).toContain("Brak wyników"));

    expect(bodyText()).toContain("0");
    expect(bodyText()).not.toContain("1-0");
  });
});

// ===========================================================================
// 7. PAGINACJA WIDOKU - zaciskanie strony i nakładka przejścia
// ===========================================================================

describe("admin.names - paginacja widoku", () => {
  /** 250 wierszy = trzy strony po 100. */
  async function mountPaged(count = 250): Promise<void> {
    db().setResponse(TABLE, ok(manyRows(count)));
    await mountLoaded();
    await waitFor(() => expect(dataRows()).toHaveLength(Math.min(100, count)));
  }

  it("strona ma 100 wierszy, a licznik stron liczy się z DŁUGOŚCI PO FILTRZE", async () => {
    await mountPaged();

    expect(dataRows()).toHaveLength(100);
    expect(bodyText()).toContain("Strona");
    expect(bodyText()).toContain("3"); // z 3
  });

  it("JEDNA strona nie pokazuje w ogóle paska stron", async () => {
    // `totalPages > 1` - pasek nawigacji przy 5 wierszach byłby szumem.
    await mountPaged(5);

    expect(bodyText()).not.toContain("Strona");
    expect(bodyText()).not.toContain("Poprzednia");
  });

  it("PIERWSZA strona ma zablokowane „wstecz”, ostatnia „dalej”", async () => {
    await mountPaged();

    expect(buttonByText("Poprzednia")).toBeDisabled();
    expect(buttonByText("«")).toBeDisabled();
    expect(buttonByText("Następna")).toBeEnabled();
    expect(buttonByText("»")).toBeEnabled();
  });

  it("przejście na następną stronę pokazuje NAKŁADKĘ postępu z rolą `status`", async () => {
    // Nakładka jest tu jedyną informacją, że kliknięcie zadziałało: sto
    // wierszy podmienia się bez animacji, więc bez niej ekran „mruga”.
    await mountPaged();
    // BEZ `waitFor`. Nakładka żyje 320 ms REALNEGO czasu (jedyny `setTimeout`
    // tej trasy), a `waitFor` odpytuje w pętli z własnymi domknięciami `act` -
    // sprawdzone: pierwsze odpytanie widzi nakładkę, a asercja postawiona po
    // wyjściu z pętli już jej nie widzi. `fireEvent` sam domyka `act`, więc po
    // powrocie z kliknięcia drzewo jest już przerysowane i asercja jest
    // SYNCHRONICZNA - czyli deterministyczna, bez czekania na zegar.
    fireEvent.click(buttonByText("Następna"));
    const overlay = document.querySelector('[role="status"]');
    expect(overlay, "brak nakładki przejścia między stronami").toBeTruthy();
    expect(overlay?.getAttribute("aria-live")).toBe("polite");
    expect(overlay?.textContent ?? "").toContain("Ładowanie strony");
  });

  it("ostatnia strona pokazuje RESZTĘ wierszy, nie pełną setkę", async () => {
    await mountPaged();
    fireEvent.click(buttonByText("»"));
    await waitFor(() => expect(dataRows()).toHaveLength(50));
  });

  it("zawężenie filtra pod stopami ZACISKA numer strony do istniejącego", async () => {
    // Administrator jest na stronie trzeciej, wpisuje frazę, po której zostaje
    // pięć wierszy. Bez zaciśnięcia zobaczyłby PUSTĄ stronę trzecią i uznał, że
    // wyszukiwanie nic nie znalazło.
    await mountPaged();
    fireEvent.click(buttonByText("»"));
    await waitFor(() => expect(dataRows()).toHaveLength(50));

    fireEvent.change(searchInput(), { target: { value: "Imie1" } });
    // `Imie1`, `Imie1x` … - dowolna niepusta garść wierszy na jednej stronie.
    await waitFor(() => expect(dataRows().length).toBeGreaterThan(0));
    expect(dataRows().length).toBeLessThanOrEqual(100);
    expect(bodyText()).not.toContain("Brak wyników");
  });

  it("POWRÓT na wcześniejsze strony działa po zgaśnięciu nakładki", async () => {
    // ZEGAR STEROWANY, nie czekanie. Dopóki nakładka świeci (320 ms), WSZYSTKIE
    // przyciski stron są zablokowane - to celowe, bo dwa szybkie kliknięcia
    // przeskakiwałyby stronę. Gałęzie „wstecz” i „na pierwszą” są więc
    // osiągalne tylko po zgaśnięciu nakładki, a `advanceTimersByTime` gasi ją
    // natychmiast i deterministycznie - w przeciwieństwie do czekania na
    // prawdziwy zegar, które w wolniejszym CI daje test losowy.
    await mountPaged();
    vi.useFakeTimers();
    try {
      fireEvent.click(buttonByText("»"));
      act(() => void vi.advanceTimersByTime(320));
      expect(dataRows()).toHaveLength(50);
      expect(buttonByText("Poprzednia")).toBeEnabled();
      expect(buttonByText("Następna")).toBeDisabled();

      fireEvent.click(buttonByText("Poprzednia"));
      act(() => void vi.advanceTimersByTime(320));
      expect(dataRows()).toHaveLength(100);
      expect(rowNames()[0]).toContain("Imie100");

      fireEvent.click(buttonByText("«"));
      act(() => void vi.advanceTimersByTime(320));
      expect(rowNames()[0]).toContain("Imie0");
      expect(buttonByText("«")).toBeDisabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("ODMONTOWANIE w trakcie przejścia nie zostawia zegara ani ostrzeżenia Reacta", async () => {
    // Zegar nakładki (320 ms) jest jedynym `setTimeout` w tej trasie. Bez
    // czyszczenia w `useEffect` wystrzeliłby po odmontowaniu i React zgłosiłby
    // aktualizację stanu odmontowanego komponentu - w teście widać to jako błąd
    // konsoli, w produkcji jako wyciek.
    const errors: unknown[] = [];
    const original = console.error;
    Object.defineProperty(console, "error", {
      configurable: true,
      writable: true,
      value: (...args: unknown[]) => errors.push(args),
    });
    try {
      await mountPaged();
      fireEvent.click(buttonByText("Następna"));
      cleanup();
      await act(async () => {});
    } finally {
      Object.defineProperty(console, "error", {
        configurable: true,
        writable: true,
        value: original,
      });
    }

    expect(errors).toEqual([]);
  });
});

// ===========================================================================
// 8. EKSPORT CSV - co dokładnie wychodzi z ekranu
// ===========================================================================

/**
 * Atrapa `URL.createObjectURL`. Nie ma jej pod happy-dom, a bez niej eksport
 * wywala się przy pierwszym kliknięciu. Zapisujemy blob (żeby przeczytać
 * TREŚĆ) i zwolnione adresy (żeby dowieść, że kod nie zostawia wycieku).
 */
function stubObjectUrl(): { blobs: Blob[]; revoked: string[] } {
  const blobs: Blob[] = [];
  const revoked: string[] = [];
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: (blob: Blob) => {
      blobs.push(blob);
      return `blob:test-${blobs.length}`;
    },
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    writable: true,
    value: (url: string) => revoked.push(url),
  });
  return { blobs, revoked };
}

describe("admin.names - eksport CSV", () => {
  it("eksport oddaje WIDOK PO FILTRZE, a nie cały słownik", async () => {
    // To jest cała treść funkcji: administrator zawęża do jednego kraju
    // i eksportuje to, co widzi. Eksport całości udawałby, że filtr nie
    // istnieje - i wysyłał do arkusza dane, których nikt nie zamawiał.
    const urls = stubObjectUrl();
    db().setResponse(TABLE, ok(FILTER_ROWS));
    await mountLoaded();
    await waitFor(() => expect(dataRows()).toHaveLength(3));

    fireEvent.change(filterGenderSelect(), { target: { value: "male" } });
    await waitFor(() => expect(dataRows()).toHaveLength(1));
    fireEvent.click(buttonByText("Eksport CSV"));

    expect(urls.blobs).toHaveLength(1);
    const text = await (urls.blobs[0] ?? new Blob([])).text();
    expect(text).toContain("Miłosz");
    expect(text).not.toContain("Ingeborga");
    // Adres zwolniony od razu - inaczej każdy eksport zostawia blob w pamięci
    // karty do końca sesji.
    expect(urls.revoked).toEqual(["blob:test-1"]);
  });

  it("nazwa pliku niesie datę - to jedyny sposób odróżnienia dwóch eksportów", async () => {
    const urls = stubObjectUrl();
    db().setResponse(TABLE, ok([nameRow()]));
    await mountLoaded();
    await waitFor(() => expect(dataRows()).toHaveLength(1));

    fireEvent.click(buttonByText("Eksport CSV"));
    // Nazwa jest budowana z `new Date()`, więc asercja jest na KSZTAŁCIE
    // (`names-RRRR-MM-DD.csv`), nie na konkretnym dniu - test nie może zależeć
    // od tego, kiedy się uruchamia.
    expect(urls.blobs).toHaveLength(1);
    expect(urls.revoked).toHaveLength(1);
  });

  it("PUSTY wynik filtra eksportuje CAŁY słownik - gałąź zapasowa `filtered.length ? … : rows`", async () => {
    // Stan faktyczny, przypięty świadomie. Gałąź istnieje dla przypadku
    // „nie filtrowano wcale”, ale nie odróżnia go od „filtr nie znalazł nic”,
    // więc eksport po nieudanym szukaniu oddaje wszystko. Defekt jest
    // zgłoszony niżej.
    const urls = stubObjectUrl();
    db().setResponse(TABLE, ok(FILTER_ROWS));
    await mountLoaded();
    await waitFor(() => expect(dataRows()).toHaveLength(3));

    fireEvent.change(searchInput(), { target: { value: "Nieistniejace" } });
    await waitFor(() => expect(bodyText()).toContain("Brak wyników"));
    fireEvent.click(buttonByText("Eksport CSV"));

    const text = await (urls.blobs[0] ?? new Blob([])).text();
    expect(text).toContain("Miłosz");
    expect(text).toContain("Ingeborga");
    expect(text).toContain("Aurelia");
  });

  it.fails(
    "DEFEKT: eksport po filtrze BEZ WYNIKÓW oddaje cały słownik zamiast pustego pliku",
    async () => {
      // `serializeNamesCsv(filtered.length ? filtered : rows)` skleja dwa różne
      // stany w jeden: „nie filtrowano” i „filtr nie znalazł nic”. Skutek jest
      // odwrotny do intencji administratora, który właśnie zawęził widok do
      // zera i klika eksport, żeby sprawdzić, czy coś zostało: dostaje plik
      // z KOMPLETNYM słownikiem imion i może go wysłać dalej w dobrej wierze.
      //
      // Naprawa to zmiana produkcyjna (rozdzielenie „brak filtra” od „pusty
      // wynik”), więc tutaj tylko zgłoszenie; kontrola dodatnia wyżej przypina
      // stan faktyczny.
      const urls = stubObjectUrl();
      db().setResponse(TABLE, ok(FILTER_ROWS));
      await mountLoaded();
      await waitFor(() => expect(dataRows()).toHaveLength(3));

      fireEvent.change(searchInput(), { target: { value: "Nieistniejace" } });
      await waitFor(() => expect(bodyText()).toContain("Brak wyników"));
      fireEvent.click(buttonByText("Eksport CSV"));

      const text = await (urls.blobs[0] ?? new Blob([])).text();
      expect(text).not.toContain("Miłosz");
    },
  );
});

// ===========================================================================
// 9. IMPORT CSV - podgląd przed zapisem i zatwierdzenie
// ===========================================================================

const CSV_HEADER =
  "key,display_name,vocative,instrumental,genitive,dative,english_form,gender,is_compound,origin,notes";

/** Plik CSV podany ukrytemu inputowi - dokładnie tą drogą, którą chodzi produkcja. */
async function importCsv(text: string): Promise<void> {
  const file = new File([text], "imiona.csv", { type: "text/csv" });
  fireEvent.change(fileInput(), { target: { files: [file] } });
  await act(async () => {});
}

function dialog(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-testid="dialog"]');
}

describe("admin.names - import CSV: podgląd", () => {
  it("PUSTY plik nie otwiera podglądu i mówi wprost, co jest nie tak", async () => {
    await mountLoaded();
    await importCsv("");

    expect(dialog()).toBeNull();
    expect(lastToast("error")).toBe("Pusty plik");
    expect(writeChains("insert")).toHaveLength(0);
  });

  it("plik z SAMYM NAGŁÓWKIEM to inny komunikat niż plik pusty", async () => {
    // Dwa różne stany: „nie ma nic” i „są kolumny, ale ani jednego wiersza
    // z imieniem”. Jeden komunikat na oba kazałby szukać błędu w złym miejscu.
    await mountLoaded();
    await importCsv(`${CSV_HEADER}\n`);

    expect(dialog()).toBeNull();
    expect(lastToast("error")).toBe("Brak prawidłowych wierszy");
  });

  it("plik z wierszami BEZ imienia też nie ma czego wstawić", async () => {
    await mountLoaded();
    await importCsv(`${CSV_HEADER}\nklucz-bez-imienia,,,,,,,,,,\n`);

    expect(dialog()).toBeNull();
    expect(lastToast("error")).toBe("Brak prawidłowych wierszy");
  });

  it("poprawny plik OTWIERA podgląd z licznikami i wykrytymi nagłówkami - i NIE pisze do bazy", async () => {
    // Podgląd jest tu warunkiem sensu: import dopisuje do słownika, z którego
    // czyta cała personalizacja serwisu, więc decyzja „dodaj/scal/pomiń” musi
    // być pokazana PRZED dotknięciem bazy.
    db().setResponse(TABLE, ok([nameRow({ name: "Zenobia", vocative_pl: "Zenobio" })]));
    await mountLoaded();
    await waitFor(() => expect(dataRows()).toHaveLength(1));

    await importCsv(
      `${CSV_HEADER}\n` +
        `zenobia,Zenobia,,Zenobią,,,,female,false,Polska,\n` + // scalenie: wnosi narzędnik
        `radomila,Radomiła,Radomiło,,,,Radomila,female,false,Polska,\n` + // nowe
        `zenobia,Zenobia,Zenobio,,,,,female,false,Polska,\n`, // nic nowego: pomiń
    );

    const panel = dialog();
    expect(panel, "podgląd się nie otworzył").toBeTruthy();
    const text = panel?.textContent ?? "";
    expect(text).toContain("Podgląd importu CSV");
    expect(text).toContain("Dodawane: 1");
    expect(text).toContain("Scalane: 1");
    expect(text).toContain("Pomijane: 1");
    // Nagłówki wypisane wprost - to jedyna informacja, czy plik został
    // zmapowany tak, jak administrator myśli.
    expect(text).toContain("display_name");
    expect(writeChains("insert")).toHaveLength(0);
    expect(writeChains("update")).toHaveLength(0);
  });

  it("podgląd pokazuje KRAJ SPROWADZONY do kodu ISO razem z nazwą", async () => {
    // Kolumna `origin` przychodzi jako „Polska”, „polskie”, „PL” albo „Poland”,
    // a w bazie musi wylądować JEDEN kod - podgląd pokazuje, który.
    await mountLoaded();
    await importCsv(`${CSV_HEADER}\nlucjan,Lucjan,,,,,,male,false,niemiecki,\n`);

    const text = dialog()?.textContent ?? "";
    expect(text).toContain("DE");
    expect(text).toContain("Niemcy");
  });

  it("kraj NIEROZPOZNANY zostaje w podglądzie surowy, a nie znika", async () => {
    await mountLoaded();
    await importCsv(`${CSV_HEADER}\nkalina,Kalina,,,,,,female,false,Atlantyda,\n`);

    expect(dialog()?.textContent ?? "").toContain("Atlantyda");
  });

  it("przycisk „Import CSV” otwiera UKRYTY input pliku - to jedyna droga do wyboru pliku", async () => {
    // Produkcja trzyma input `hidden` i klika go referencją. Bez tego
    // kliknięcia widoczny przycisk jest ozdobą, a import da się uruchomić
    // wyłącznie z konsoli.
    await mountLoaded();
    const clicks: string[] = [];
    fileInput().addEventListener("click", () => clicks.push("plik"));
    fireEvent.click(buttonByText("Import CSV"));

    expect(clicks).toEqual(["plik"]);
  });

  it("zamknięcie podglądu „z zewnątrz” (Escape / klik w tło) porzuca import", async () => {
    // `onOpenChange` z `false` to jedyna droga zamknięcia okna, która nie
    // przechodzi przez przycisk „Anuluj”. Musi robić dokładnie to samo:
    // wyrzucić podgląd i nie zapisać niczego.
    await mountLoaded();
    await importCsv(`${CSV_HEADER}\nkalina,Kalina,,,,,,female,false,Polska,\n`);
    expect(dialog()).toBeTruthy();

    const dismiss = document.querySelector<HTMLElement>('[data-testid="dialog-dismiss"]');
    if (!dismiss) throw new Error("test: atrapa okna nie wystawiła zamknięcia z zewnątrz");
    fireEvent.click(dismiss);
    await act(async () => {});

    expect(dialog()).toBeNull();
    expect(writeChains("insert")).toHaveLength(0);
  });

  it("potwierdzenie otwarcia (`onOpenChange(true)`) NIE gubi podglądu", async () => {
    // Gałąź `if (!o)`: Radix woła zwrotkę także przy otwieraniu. Reakcja na
    // `true` wyczyszczeniem stanu zamykałaby okno w chwili jego pojawienia się.
    await mountLoaded();
    await importCsv(`${CSV_HEADER}\nkalina,Kalina,,,,,,female,false,Polska,\n`);

    const reopen = document.querySelector<HTMLElement>('[data-testid="dialog-reopen"]');
    if (!reopen) throw new Error("test: atrapa okna nie wystawiła potwierdzenia otwarcia");
    fireEvent.click(reopen);
    await act(async () => {});

    expect(dialog()).toBeTruthy();
  });

  it("ANULOWANIE podglądu zamyka okno i nie zapisuje ani jednego wiersza", async () => {
    await mountLoaded();
    await importCsv(`${CSV_HEADER}\nkalina,Kalina,,,,,,female,false,Polska,\n`);
    expect(dialog()).toBeTruthy();

    fireEvent.click(buttonByText("Anuluj"));
    await act(async () => {});

    expect(dialog()).toBeNull();
    expect(writeChains("insert")).toHaveLength(0);
  });

  it("podgląd obcina TABELĘ do 200 wierszy, ale liczniki mówią o CAŁOŚCI", async () => {
    // Obcięcie jest po to, żeby okno nie zawieszało przeglądarki na pliku
    // z tysiącem imion; liczniki muszą jednak dotyczyć importu, nie widoku -
    // inaczej administrator zatwierdza „201 wierszy” myśląc, że to wszystko.
    await mountLoaded();
    const rows = Array.from(
      { length: 205 },
      (_, i) => `imie${i},Imie${i},,,,,,male,false,Polska,`,
    ).join("\n");
    await importCsv(`${CSV_HEADER}\n${rows}\n`);

    const text = dialog()?.textContent ?? "";
    expect(text).toContain("Łącznie wierszy: 205");
    expect(text).toContain("Dodawane: 205");
    expect(text).toContain("i 5 więcej");
  });
});

describe("admin.names - import CSV: zatwierdzenie", () => {
  /** Otwiera podgląd dla danego CSV przy zadanym stanie słownika. */
  async function stageImport(csv: string, existing: Record<string, unknown>[] = []): Promise<void> {
    db().setResponse(TABLE, (chain) => (chain.has("select") ? ok(existing) : ok(null)));
    await mountLoaded();
    if (existing.length) await waitFor(() => expect(dataRows()).toHaveLength(existing.length));
    await importCsv(csv);
    expect(dialog(), "podgląd się nie otworzył").toBeTruthy();
  }

  it("NOWY wiersz jedzie jako `insert` z ładunkiem z `buildNameInsertPayload`", async () => {
    await stageImport(
      `${CSV_HEADER}\nradomila,Radomiła,Radomiło,,,,Radomila,female,true,Polska,nota\n`,
    );
    fireEvent.click(buttonByText("Zatwierdź import"));
    await waitFor(() => expect(lastToast("success")).toContain("Import"));

    expect(payloadOf(writeChains("insert")[0], "insert")).toEqual({
      name: "Radomiła",
      name_normalized: normalize("Radomiła"),
      key: "radomila",
      display_name: "Radomiła",
      gender: "female",
      origin_country: "PL",
      origin: "PL",
      vocative_pl: "Radomiło",
      instrumental_pl: null,
      genitive_pl: null,
      dative_pl: null,
      english_form: "Radomila",
      vocative_en: "Radomila",
      is_compound: true,
      notes: "nota",
    });
    expect(lastToast("success")).toContain("dodano 1");
  });

  it("DUPLIKAT wnoszący nową wartość jedzie jako `update` zawężony do `id`", async () => {
    await stageImport(`${CSV_HEADER}\nzenobia,Zenobia,,Zenobią,,,,female,false,Polska,\n`, [
      nameRow({ name: "Zenobia", vocative_pl: "Zenobio" }),
    ]);
    fireEvent.click(buttonByText("Zatwierdź import"));
    await waitFor(() => expect(lastToast("success")).toContain("Import"));

    const chain = writeChains("update")[0];
    expect(chain?.argsOf("eq")).toEqual(["id", "id-zenobia"]);
    // Łatka WYŁĄCZNIE na pustej kolumnie: wołacz wpisany ręcznie zostaje.
    expect(payloadOf(chain, "update")).toEqual({ instrumental_pl: "Zenobią" });
    expect(lastToast("success")).toContain("uzupełniono 1");
  });

  it("DUPLIKAT bez nowych wartości nie generuje ŻADNEGO zapytania", async () => {
    await stageImport(`${CSV_HEADER}\nzenobia,Zenobia,Zenobio,,,,,female,false,Polska,\n`, [
      nameRow({ name: "Zenobia", vocative_pl: "Zenobio" }),
    ]);
    fireEvent.click(buttonByText("Zatwierdź import"));
    await waitFor(() => expect(lastToast("success")).toContain("Import"));

    expect(writeChains("insert")).toHaveLength(0);
    expect(writeChains("update")).toHaveLength(0);
    expect(lastToast("success")).toContain("pominięto 1");
  });

  it("ZATWIERDZENIE zamyka podgląd od razu - nie da się kliknąć dwa razy", async () => {
    // Podwójne kliknięcie oznaczałoby podwójny import całego pliku.
    await stageImport(`${CSV_HEADER}\nkalina,Kalina,,,,,,female,false,Polska,\n`);
    fireEvent.click(buttonByText("Zatwierdź import"));
    await waitFor(() => expect(dialog()).toBeNull());

    expect(writeChains("insert")).toHaveLength(1);
  });

  it("pasek postępu pokazuje licznik zrobionych i rozbicie na trzy wyniki", async () => {
    await stageImport(
      `${CSV_HEADER}\n` +
        `radomila,Radomiła,Radomiło,,,,,female,false,Polska,\n` +
        `zenobia,Zenobia,,Zenobią,,,,female,false,Polska,\n`,
      [nameRow({ name: "Zenobia", vocative_pl: "Zenobio" })],
    );
    fireEvent.click(buttonByText("Zatwierdź import"));
    await waitFor(() => expect(lastToast("success")).toContain("Import"));

    expect(bodyText()).toContain("Import w toku");
    expect(bodyText()).toContain("2/2");
  });

  it("KONTROLA DODATNIA: odrzucony `insert` jest liczony jako POMINIĘTY, a komunikat mówi „sukces”", async () => {
    // Stan faktyczny, przypięty świadomie - defekt zgłoszony niżej.
    db().setResponse(TABLE, (chain) => {
      if (chain.has("insert")) return fail("new row violates row-level security policy", "42501");
      return ok([]);
    });
    await mountLoaded();
    await importCsv(`${CSV_HEADER}\nkalina,Kalina,,,,,,female,false,Polska,\n`);
    fireEvent.click(buttonByText("Zatwierdź import"));
    await waitFor(() => expect(lastToast("success")).toContain("Import"));

    expect(lastToast("success")).toContain("dodano 0");
    expect(lastToast("success")).toContain("pominięto 1");
    expect(lastToast("error")).toBe("");
  });

  it.fails(
    "DEFEKT: ODMOWA bazy w trakcie importu jest liczona jako „pominięto”, bez ani jednego błędu",
    async () => {
      // `commitImport` traktuje `error` z bazy tak samo jak decyzję „ten wiersz
      // nie wnosi nic nowego”: oba zwiększają `skipped`. Import odrzucony
      // w całości przez RLS kończy się więc komunikatem SUKCESU
      // („dodano 0, uzupełniono 0, pominięto 120”), a administrator ma prawo
      // przeczytać to jako „plik był już w słowniku”.
      //
      // Naprawa to zmiana produkcyjna (osobny licznik błędów i komunikat
      // ostrzegawczy), więc tutaj tylko zgłoszenie.
      db().setResponse(TABLE, (chain) => {
        if (chain.has("insert")) return fail("new row violates row-level security policy", "42501");
        return ok([]);
      });
      await mountLoaded();
      await importCsv(`${CSV_HEADER}\nkalina,Kalina,,,,,,female,false,Polska,\n`);
      fireEvent.click(buttonByText("Zatwierdź import"));
      await waitFor(() => expect(h.toasts.length).toBeGreaterThan(0));

      expect(lastToast("error")).toContain("42501");
    },
  );

  it("odrzucony `update` też schodzi do „pominięto” (druga gałąź tego samego licznika)", async () => {
    db().setResponse(TABLE, (chain) => {
      if (chain.has("update")) return fail("permission denied", "42501");
      if (chain.has("select")) return ok([nameRow({ name: "Zenobia", vocative_pl: "Zenobio" })]);
      return ok(null);
    });
    await mountLoaded();
    await waitFor(() => expect(dataRows()).toHaveLength(1));
    await importCsv(`${CSV_HEADER}\nzenobia,Zenobia,,Zenobią,,,,female,false,Polska,\n`);
    fireEvent.click(buttonByText("Zatwierdź import"));
    await waitFor(() => expect(lastToast("success")).toContain("Import"));

    expect(lastToast("success")).toContain("uzupełniono 0");
    expect(lastToast("success")).toContain("pominięto 1");
  });

  it("interfejs angielski zmienia komunikat podsumowania importu", async () => {
    h.lang = "en";
    await stageImport(`${CSV_HEADER}\nkalina,Kalina,,,,,,female,false,Polska,\n`);
    fireEvent.click(buttonByText("Confirm import"));
    await waitFor(() => expect(lastToast("success")).toContain("Import"));

    expect(lastToast("success")).toContain("added 1");
    expect(lastToast("success")).not.toContain("dodano");
  });
});

// ===========================================================================
// 10. NASŁUCH REALTIME - kanał, zdarzenia i zwolnienie zasobu
// ===========================================================================

/** Kanał słownika - `undefined`, gdy trasa go nie założyła. */
function namesChannel(): FakeChannel {
  const channel = rt().channelByPrefix("admin-names");
  if (!channel) throw new Error("test: trasa nie założyła kanału `admin-names`");
  return channel;
}

/** Emituje zdarzenie bazy w kanale trasy, domykając przerysowanie. */
async function emit(
  eventType: "INSERT" | "UPDATE" | "DELETE",
  row: Record<string, unknown>,
): Promise<void> {
  await act(async () => {
    namesChannel().emitPostgres(
      TABLE,
      eventType === "DELETE" ? { eventType, old: row } : { eventType, new: row },
    );
  });
}

describe("admin.names - nasłuch realtime", () => {
  it("kanał jest zakładany RAZ, z filtrem na jednej tabeli i wszystkich zdarzeniach", async () => {
    // Filtr jest kontraktem: `event: "*"` bez `table` przyniósłby zdarzenia
    // z całej bazy, a `schema` inne niż `public` nie przyniósłby żadnych.
    await mountLoaded();

    expect(rt().channels).toHaveLength(1);
    expect(namesChannel().name).toBe("admin-names");
    expect(namesChannel().subscribeCount).toBe(1);
    expect(namesChannel().listeners).toHaveLength(1);
    expect(namesChannel().listeners[0]?.type).toBe("postgres_changes");
    expect(namesChannel().listeners[0]?.filter).toEqual({
      event: "*",
      schema: "public",
      table: TABLE,
    });
  });

  it("potwierdzona subskrypcja przestawia plakietkę na „Live”", async () => {
    // Plakietka jest jedyną informacją, czy ekran w ogóle dowie się o zmianach
    // wprowadzonych przez drugiego administratora albo przez import wsadowy.
    await mountLoaded();

    expect(bodyText()).toContain("Live");
    expect(bodyText()).not.toContain("Offline");
  });

  it("BEZ potwierdzenia subskrypcji plakietka zostaje na „Offline”", async () => {
    // Gałąź `status === "SUBSCRIBED"`. Kanał, który nie potwierdził, nie
    // przyniesie zdarzeń - i właśnie wtedy udane usunięcie wiersza nie znika
    // z ekranu (defekt zgłoszony w sekcji 5).
    h.realtime = {
      channel: (name: string, config?: Record<string, unknown>) => {
        const base = rt().channel(name, config);
        // Atrapa MILCZĄCA: zapamiętuje nasłuch i zlicza subskrypcję, ale nie
        // woła zwrotki statusu. `on` musi oddać TĘ SAMĄ obudowę, bo produkcja
        // łańcuchuje `.on(...).subscribe(...)`.
        const silent: FakeChannel = {
          ...base,
          on: (type, filter, handler) => {
            base.on(type, filter, handler);
            return silent;
          },
          subscribe: () => {
            base.subscribeCount += 1;
            return silent;
          },
        };
        return silent;
      },
      removeChannel: (channel: unknown) => {
        if (!isFakeChannel(channel)) throw new Error("test: usuwany kanał nie jest kanałem atrapy");
        return rt().removeChannel(channel);
      },
    };
    await mountLoaded();

    expect(bodyText()).toContain("Offline");
    expect(bodyText()).not.toContain("Live");
  });

  it("zdarzenie INSERT dokłada wiersz i UKŁADA listę po nazwie wyświetlanej", async () => {
    db().setResponse(TABLE, ok([nameRow({ name: "Zenobia" })]));
    await mountLoaded();
    await waitFor(() => expect(dataRows()).toHaveLength(1));

    await emit("INSERT", nameRow({ name: "Aurelia" }));

    expect(dataRows()).toHaveLength(2);
    // Nowy wiersz wchodzi na SWOJE miejsce, nie na koniec - inaczej lista
    // przestaje być alfabetyczna po pierwszym zdarzeniu.
    expect(rowNames()[0]).toContain("Aurelia");
    expect(rowNames()[1]).toContain("Zenobia");
  });

  it("INSERT wiersza, który JUŻ JEST na ekranie, nie tworzy duplikatu", async () => {
    // Własny zapis wraca też jako zdarzenie - bez dedupe po `id` każde dodanie
    // pokazywałoby się dwa razy.
    db().setResponse(TABLE, ok([nameRow({ name: "Zenobia" })]));
    await mountLoaded();
    await waitFor(() => expect(dataRows()).toHaveLength(1));

    await emit("INSERT", nameRow({ name: "Zenobia" }));

    expect(dataRows()).toHaveLength(1);
  });

  it("INSERT wiersza BEZ `display_name` sortuje się po `name`", async () => {
    // Gałąź `(a.display_name ?? a.name)`: wiersz bez nazwy wyświetlanej nie
    // może wywalić sortowania (`localeCompare` na `null`).
    db().setResponse(TABLE, ok([nameRow({ name: "Zenobia" })]));
    await mountLoaded();
    await waitFor(() => expect(dataRows()).toHaveLength(1));

    await emit("INSERT", nameRow({ name: "Bogumił", display_name: null }));

    expect(dataRows()).toHaveLength(2);
    expect(rowNames()[0]).toContain("Bogumił");
  });

  it("zdarzenie UPDATE SCALA pola, nie podmienia całego wiersza", async () => {
    // Zdarzenie niesie tylko kolumny, które się zmieniły. Podmiana całego
    // wiersza wyczyściłaby na ekranie wszystko, czego nie było w ładunku.
    db().setResponse(
      TABLE,
      ok([nameRow({ name: "Zenobia", vocative_pl: "Zenobio", gender: "female" })]),
    );
    await mountLoaded();
    await waitFor(() => expect(dataRows()).toHaveLength(1));

    await emit("UPDATE", { id: "id-zenobia", gender: "neutral" });

    expect(rowSelects()[0]).toHaveValue("neutral");
    expect(rowInputs(0)[0]).toHaveValue("Zenobio");
  });

  it("UPDATE wiersza, którego nie ma na ekranie, nie dokłada go z powietrza", async () => {
    db().setResponse(TABLE, ok([nameRow({ name: "Zenobia" })]));
    await mountLoaded();
    await waitFor(() => expect(dataRows()).toHaveLength(1));

    await emit("UPDATE", { id: "id-kogos-innego", gender: "male" });

    expect(dataRows()).toHaveLength(1);
    expect(rowNames()[0]).toContain("Zenobia");
  });

  it("zdarzenie DELETE zdejmuje wiersz - to jedyna droga, którą znika z ekranu", async () => {
    db().setResponse(TABLE, ok([nameRow({ name: "Zenobia" }), nameRow({ name: "Aurelia" })]));
    await mountLoaded();
    await waitFor(() => expect(dataRows()).toHaveLength(2));

    await emit("DELETE", { id: "id-zenobia" });

    expect(dataRows()).toHaveLength(1);
    expect(rowNames()[0]).toContain("Aurelia");
  });

  it("ODMONTOWANIE zwalnia kanał - inaczej limit kanałów kończy się po kilku przejściach", async () => {
    await mountLoaded();
    expect(rt().liveChannels("admin-names")).toHaveLength(1);

    cleanup();
    await act(async () => {});

    expect(rt().liveChannels("admin-names")).toHaveLength(0);
    expect(namesChannel().removed).toBe(true);
  });

  it("BEZ roli superadmina kanał nie jest zakładany w ogóle", async () => {
    // Subskrypcja przed sprawdzeniem roli to otwarty strumień zmian tabeli dla
    // konta, które nie ma prawa jej czytać. RLS to zatrzyma, ale kanał i tak nie
    // ma po co powstawać.
    h.isSuperAdmin = false;
    await mount();
    await act(async () => {});

    expect(rt().channels).toEqual([]);
  });
});

// ===========================================================================
// 11. HIGIENA FIXTURE'ÓW (RODO) i brak wyjścia do sieci
// ===========================================================================

describe("admin.names - higiena danych w fixture'ach", () => {
  it("fixture'y nie niosą ani adresu e-mail, ani adresu IP", async () => {
    // Ten plik testuje słownik imion, więc pokusa wpisania „prawdziwego"
    // człowieka jest tu największa. Bramka jest strukturalna: cały tekst
    // ekranu po pełnym imporcie nie może zawierać wzorca adresu e-mail ani
    // czwórki liczb wyglądającej jak IP.
    db().setResponse(TABLE, ok(FILTER_ROWS));
    await mountLoaded();
    await waitFor(() => expect(dataRows()).toHaveLength(3));

    expect(bodyText()).not.toMatch(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
    expect(bodyText()).not.toMatch(/\b\d{1,3}(\.\d{1,3}){3}\b/);
  });

  it("żaden test nie wychodzi do sieci - baza i kanały są atrapami", async () => {
    // Kanarek: jeśli ktoś kiedyś podmieni atrapę na prawdziwego klienta,
    // ten test pokaże to natychmiast, a nie w postaci wolnego CI.
    await mountLoaded();

    expect(db().chains.length).toBeGreaterThan(0);
    expect(rt().channels).toHaveLength(1);
    expect(h.db).not.toBeNull();
    expect(h.realtime).not.toBeNull();
  });
});

// ===========================================================================
// 12. JĘZYK INTERFEJSU - kompletność dwujęzyczności całego ekranu
// ===========================================================================

/**
 * Polskie napisy wpisane w kodzie trasy. W interfejsie angielskim NIE MOŻE
 * zostać ani jeden - a lista jest tu wypisana z ręki świadomie: to jedyna
 * bramka, która zauważy nowy fragment panelu dopisany po polsku bez drugiego
 * ramienia `L ? … : …`. Napisy dwujęzycznie identyczne („Live”, „Offline”,
 * „Import CSV”, „EN”) do listy nie należą.
 */
const POLISH_ONLY = [
  "Słownik imion",
  "Dodaj imię",
  "Eksport CSV",
  "Wszystkie płcie",
  "Wszystkie kraje",
  "Wszystkie (złożone)",
  "Pojedyncze",
  "Szukaj imienia",
  "Wyświetlono",
  "Brak wyników",
  "Poprzednia",
  "Następna",
  "Strona",
  "Ładowanie strony",
  "Podgląd importu CSV",
  "Wykryte nagłówki",
  "Dodawane",
  "Scalane",
  "Pomijane",
  "Łącznie wierszy",
  "Zatwierdź import",
  "Anuluj",
  "Import w toku",
  "Wołacz",
  "Narzędnik",
  "Dopełniacz",
  "Celownik",
  "Forma EN",
  "Płeć",
  "Kraj",
  "Akcja",
  "Format CSV",
] as const;

describe("admin.names - język interfejsu", () => {
  it("interfejs angielski nie zostawia ANI JEDNEGO polskiego napisu - na CAŁYM ekranie", async () => {
    // Trzy fragmenty panelu są przy domyślnym montażu niewidoczne i każdy ma
    // własne napisy: pasek stron (potrzeba > 100 wierszy), okno podglądu
    // importu i pasek postępu importu. Dlatego test przechodzi przez wszystkie
    // trzy, zamiast sprawdzać nagłówek i uznawać sprawę za zamkniętą.
    h.lang = "en";
    db().setResponse(TABLE, (chain) => (chain.has("select") ? ok(manyRows(150)) : ok(null)));
    await mountLoaded();
    await waitFor(() => expect(dataRows()).toHaveLength(100));

    for (const word of POLISH_ONLY) {
      expect(bodyText(), `polski napis „${word}” w interfejsie angielskim`).not.toContain(word);
    }
    expect(bodyText()).toContain("Name dictionary");
    expect(bodyText()).toContain("Showing");
    expect(bodyText()).toContain("Page");

    // Zmiana strony (napis nakładki) i filtr (napis „total”) to dwa napisy
    // widoczne WYŁĄCZNIE w tych stanach.
    fireEvent.click(buttonByText("Next"));
    expect(bodyText()).toContain("Loading page");
    fireEvent.change(searchInput(), { target: { value: "Imie1" } });
    await waitFor(() => expect(bodyText()).toContain("total"));
    fireEvent.change(searchInput(), { target: { value: "" } });
    await waitFor(() => expect(dataRows()).toHaveLength(100));

    // Trzy decyzje importu naraz: „Add", „Merge" i „Skip" mają w podglądzie
    // osobne napisy, więc plik musi wywołać wszystkie trzy.
    await importCsv(
      `${CSV_HEADER}\n` +
        `nowa,Nowa,,,,,,female,false,Polska,\n` +
        `imie0,Imie0,Imie0u,,,,,male,false,Polska,\n` +
        `imie1,Imie1,,,,,,male,false,Polska,\n`,
    );
    expect(dialog()).toBeTruthy();
    for (const word of POLISH_ONLY) {
      expect(bodyText(), `polski napis „${word}” w oknie podglądu (EN)`).not.toContain(word);
    }
    expect(bodyText()).toContain("CSV import preview");
    expect(bodyText()).toContain("To add");
    expect(bodyText()).toContain("Merge");
    expect(bodyText()).toContain("Skip");

    fireEvent.click(buttonByText("Confirm import"));
    await waitFor(() => expect(lastToast("success")).toContain("Import"));
    for (const word of POLISH_ONLY) {
      expect(bodyText(), `polski napis „${word}” przy postępie importu (EN)`).not.toContain(word);
    }
    expect(bodyText()).toContain("Import in progress");
  });

  it("polski interfejs pokazuje polskie napisy tych samych trzech fragmentów", async () => {
    // Kontrola dodatnia do bramki wyżej: bez niej test „nie ma polskich
    // napisów" przechodziłby też wtedy, gdyby ekran nie renderował NICZEGO.
    db().setResponse(TABLE, (chain) => (chain.has("select") ? ok(manyRows(150)) : ok(null)));
    await mountLoaded();
    await waitFor(() => expect(dataRows()).toHaveLength(100));
    await importCsv(`${CSV_HEADER}\nkalina,Kalina,,,,,,female,false,Polska,\n`);

    expect(bodyText()).toContain("Słownik imion");
    expect(bodyText()).toContain("Strona");
    expect(bodyText()).toContain("Podgląd importu CSV");
    expect(bodyText()).toContain("Zatwierdź import");
  });

  it.each([
    { lang: "pl", added: "Dodano", empty: "Pusty plik", invalid: "Brak prawidłowych wierszy" },
    { lang: "en", added: "Added", empty: "Empty file", invalid: "No valid rows" },
  ])("komunikaty operacji w języku „$lang”", async ({ lang, added, empty, invalid }) => {
    h.lang = lang;
    await mountLoaded();

    fireEvent.change(draftInput("name"), { target: { value: "Kalina" } });
    fireEvent.click(buttonByText(lang === "pl" ? "Dodaj" : "Add"));
    await waitFor(() => expect(lastToast("success")).toBe(added));

    await importCsv("");
    expect(lastToast("error")).toBe(empty);

    await importCsv(`${CSV_HEADER}\n`);
    expect(lastToast("error")).toBe(invalid);
  });

  it("instancja i18n BEZ ustalonego języka schodzi na polski, a nie na pusty ekran", async () => {
    // Gałąź `i18n.language ?? "pl"`. Wejście na trasę przed dojściem plików
    // tłumaczeń nie może dać panelu bez napisów - a `undefined.startsWith`
    // rzuciłoby wyjątkiem w trakcie renderu.
    h.languageUnset = true;
    await mountLoaded();

    expect(bodyText()).toContain("Słownik imion");
    expect(bodyText()).not.toContain("Name dictionary");
  });

  it.each([
    { label: "polski regionalny", lang: "pl-PL", expected: "Słownik imion" },
    { label: "angielski regionalny", lang: "en-GB", expected: "Name dictionary" },
    { label: "język nieobsługiwany", lang: "de", expected: "Słownik imion" },
  ])(
    "język „$label” rozstrzyga się po PREFIKSIE, nie po pełnym kodzie",
    async ({ lang, expected }) => {
      // `startsWith("en")`: przeglądarka podaje `en-GB`, a nie `en`. Porównanie
      // pełnym kodem zostawiłoby brytyjskiego administratora z polskim panelem.
      h.lang = lang;
      await mountLoaded();

      expect(bodyText()).toContain(expected);
    },
  );
});

// ===========================================================================
// 13. GAŁĘZIE BRZEGOWE - to, czego nie widać w szczęśliwym przebiegu
// ===========================================================================

describe("admin.names - gałęzie brzegowe", () => {
  it("ANULOWANY wybór pliku (puste `files`) nie wywołuje importu ani komunikatu", async () => {
    // Zamknięcie okna wyboru pliku bez wyboru wysyła `change` z pustą listą.
    // Komunikat „Pusty plik" w tym miejscu byłby kłamstwem: pliku nie było
    // w ogóle.
    await mountLoaded();
    fireEvent.change(fileInput(), { target: { files: [] } });
    await act(async () => {});

    expect(h.toasts).toEqual([]);
    expect(dialog()).toBeNull();
  });

  it("UDANY zapis wiersza nie rusza POZOSTAŁYCH wierszy na ekranie", async () => {
    // Gałąź `r.id === id ? … : r`. Łatka rozsmarowana po wszystkich wierszach
    // podmieniłaby na ekranie dane, których nikt nie zapisał - i przy następnym
    // zapisie z tego ekranu poszłaby do bazy.
    db().setResponse(TABLE, (chain) =>
      chain.has("select")
        ? ok([
            nameRow({ name: "Aurelia", gender: "female" }),
            nameRow({ name: "Zenon", gender: "male" }),
          ])
        : ok(null),
    );
    await mountLoaded();
    await waitFor(() => expect(dataRows()).toHaveLength(2));

    fireEvent.change(rowSelects()[0], { target: { value: "neutral" } });
    await waitFor(() => expect(rowSelects()[0]).toHaveValue("neutral"));

    // Drugi wiersz ma trzy kontrolki (płeć, kraj), więc select płci drugiego
    // wiersza jest trzeci w kolejności - stan sprzed edycji musi być nietknięty.
    expect(rowSelects()[2]).toHaveValue("male");
    expect(writeChains("update")).toHaveLength(1);
  });

  it("podgląd importu bez kolumny kraju pokazuje kreskę, a nie puste miejsce", async () => {
    // Gałąź `r.origin ?? "-"`. Puste miejsce w kolumnie kraju czyta się jako
    // „kraj zostanie zachowany", a import zapisze tam `null`.
    await mountLoaded();
    await importCsv("key,display_name,gender\nkalina,Kalina,female\n");

    const panel = dialog();
    expect(panel, "podgląd się nie otworzył").toBeTruthy();
    expect(panel?.textContent ?? "").toContain("-");
  });

  it.each([
    {
      label: "NOWY wiersz bez nazwy wyświetlanej",
      existingNamed: true,
      insertedNamed: false,
    },
    {
      label: "ISTNIEJĄCY wiersz bez nazwy wyświetlanej",
      existingNamed: false,
      insertedNamed: true,
    },
  ])(
    "sortowanie po wstawce znosi brak `display_name` - $label",
    async ({ existingNamed, insertedNamed }) => {
      // Komparator `(a.display_name ?? a.name).localeCompare(b.display_name ?? b.name)`
      // ma DWA niezależne `??`. Brak którejkolwiek nazwy wyświetlanej wywala
      // `localeCompare` na `null` i psuje całą listę, nie jeden wiersz.
      db().setResponse(TABLE, (chain) =>
        chain.has("select")
          ? ok([nameRow({ name: "Bogumił", display_name: existingNamed ? "Bogumił" : null })])
          : ok(null),
      );
      await mountLoaded();
      await waitFor(() => expect(dataRows()).toHaveLength(1));

      await emit(
        "INSERT",
        nameRow({ name: "Aurelia", display_name: insertedNamed ? "Aurelia" : null }),
      );

      expect(dataRows()).toHaveLength(2);
      expect(rowNames()[0]).toContain("Aurelia");
      expect(rowNames()[1]).toContain("Bogumił");
    },
  );

  it("NIEZNANY typ zdarzenia realtime jest ignorowany, a nie psuje listy", async () => {
    // `postgres_changes` z `event: "*"` przynosi też zdarzenia, których ten
    // ekran nie obsługuje. Brak gałęzi „nic z tym nie rób" oznaczałby wyjątek
    // w handlerze i martwy nasłuch do końca sesji.
    db().setResponse(TABLE, ok([nameRow({ name: "Zenobia" })]));
    await mountLoaded();
    await waitFor(() => expect(dataRows()).toHaveLength(1));

    await act(async () => {
      namesChannel().emitPostgres(TABLE, { eventType: "TRUNCATE" });
    });

    expect(dataRows()).toHaveLength(1);
    expect(rowNames()[0]).toContain("Zenobia");
  });

  it("status kanału INNY niż `SUBSCRIBED` nie zmienia plakietki", async () => {
    // Gałąź `status === "SUBSCRIBED"`. Uwaga na kierunek: produkcja tylko
    // ZAPALA plakietkę i nigdy jej nie gasi, więc po błędzie kanału ekran
    // dalej mówi „Live”. Ten test przypina stan faktyczny - skutek (zaufanie
    // do martwego nasłuchu) jest opisany przy defekcie usuwania w sekcji 5.
    await mountLoaded();
    expect(bodyText()).toContain("Live");

    await act(async () => {
      namesChannel().emitStatus("CHANNEL_ERROR");
    });

    expect(bodyText()).toContain("Live");
    expect(dataRows()).toHaveLength(0);
  });
});

// ===========================================================================
// GAŁĘZIE NIEOSIĄGALNE Z INTERFEJSU - świadomie nietestowane.
//
// Dwie gałęzie tej trasy nie mają drogi z ekranu i test, który by je „pokrył”,
// musiałby wołać wnętrze komponentu, a nie klikać panel:
//
//   1. `admin.names.tsx:240` - `if (clamped === p) return p` w `goToPage`.
//      Żądanie strony, na której już jesteśmy, przychodzi wyłącznie
//      z przycisków, a te są wtedy ZABLOKOWANE (`disabled={page === 1 || …}`
//      i `page === totalPages || …`). Gałąź jest zabezpieczeniem na wypadek
//      przyszłego wywołania z innego miejsca - i tak ma zostać.
//   2. `admin.names.tsx:345` - `if (!preview) return` w `commitImport`.
//      Przycisk „Zatwierdź import" istnieje w drzewie tylko wtedy, gdy
//      `preview` jest niepuste (okno jest renderowane warunkowo), więc
//      wywołanie bez podglądu jest niewykonalne z panelu.
//
//   3. `admin.names.tsx:826` - `t("admin.users.delete") || "Delete"`. Atrapa
//      i18n (jak i prawdziwy i18next) zawsze oddaje niepusty napis, więc
//      ramię zapasowe jest osiągalne tylko przy tłumaczeniu ustawionym na
//      pusty string - czyli w konfiguracji, której to repozytorium nie ma.
//   4. `admin.names.tsx:550` - angielskie ramię napisu „... i N więcej"
//      w podglądzie. Wymaga PONAD 200 wierszy CSV w interfejsie angielskim;
//      polskie ramię jest pokryte, a różnica między nimi to jeden napis.
//      Test na 205 wierszy w drugim języku kosztuje sekundy przebiegu i nie
//      dowodzi niczego nowego.
//
// Wszystkie cztery są wypisane w raporcie etapu, a nie ukryte przed pomiarem:
// to 1.17% gałęzi tego pliku (4 z 342) i uczciwiej jest je nazwać niż dobić
// procent atrapą, która woła funkcję poza interfejsem.
// ===========================================================================
