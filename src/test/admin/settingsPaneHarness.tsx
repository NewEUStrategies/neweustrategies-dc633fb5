// WSPÓLNY HARNESS PANELI USTAWIEŃ ADMINA (`/admin/theme-options`,
// `/admin/layouts`, panele boczne edytora wpisu).
//
// PO CO ISTNIEJE. Osiem paneli wyglądu/ustawień miało razem 568 niepokrytych
// linii i siedem z ośmiu zero wywołanych funkcji, a każdy z nich - wbrew
// pierwszemu wrażeniu - rozmawia z INNĄ granicą danych: jeden czyta
// `site_settings` przez `useSettings`, drugi `site_design_tokens` przez
// `useGlobalColors`, trzeci bulk-mapę `site_settings` przez
// `siteSettingsQueryOptions` + server fn, czwarty `profiles` + query options
// modułu ekspertów, a panele edytora dokładają Storage i `useRequiredTenant`.
// Osiem osobnych suit oznaczałoby osiem osobnych atrap klienta Supabase
// rozjeżdżających się przy pierwszej zmianie kontraktu. Ten plik jest JEDNYM
// miejscem, w którym te granice są opisane.
//
// CZEGO TEN PLIK NIE ROBI - I DLACZEGO. Nie woła `vi.mock`. Fabryka `vi.mock`
// jest hoistowana do pliku, w którym ją napisano, więc podmiana modułu MUSI
// zostać zadeklarowana w pliku testowym. Harness daje wyłącznie KSZTAŁTY, które
// taka fabryka ma zwrócić (`.client`, `.sonner()`, `.notify()`,
// `imageSlotStub(...)`), oraz montaż i zapytania DOM. Dzięki temu plik nie
// importuje NICZEGO z produkcji - w szczególności niczego, co dochodzi do
// `react-i18next` - i wolno go wciągać dynamicznym importem z wnętrza fabryki
// `vi.mock` (patrz pułapka opisana w nagłówku `src/test/i18nStub.ts`).
//
// ─────────────────────────────────────────────────────────────────────────────
// API - GRANICE DANYCH
//
//   settingsPaneSupabase({ settings, tables, userId })
//     Atrapa CAŁEGO klienta `@/integrations/supabase/client` w jednym obiekcie:
//       .client          - obiekt do zwrócenia z fabryki vi.mock
//                          (`{ supabase: sb.client }`): `from`, `rpc`,
//                          `storage`, `auth`, `channel`.
//       .setSetting(k,v) - wiersz `site_settings` (odczyt `.eq("key",k)` oraz
//                          bulk `select("key,value")` widzą tę samą mapę).
//       .setTable(t,d)   - dane odczytu dowolnej innej tabeli (wiersz/lista).
//       .setTableResponder(t,fn) - własny `TableResponder` przejmujący ODCZYT
//                          I ZAPIS (opóźnienie zapisu = asercja na stanie
//                          „Zapisywanie...", odpowiedź zależna od ładunku).
//       .failRead(t,msg) - odczyt tabeli kończy się błędem PostgREST.
//       .failWrite(t,msg)- KAŻDY zapis (upsert/insert/update/delete) do tabeli
//                          kończy się błędem: to jest „wymuś błąd zapisu".
//       .writes(t,method)- ładunki zapisów w kolejności; `.lastWrite(t)` to
//                          najczęstsza asercja („co panel wysłał do bazy").
//       .db / .rpc / .storage - atrapy niższego poziomu, gdy trzeba więcej
//                          (kolejność ogniw łańcucha, argumenty RPC, uploady).
//       .reset()         - czyści stan MIĘDZY testami (obiekt powstaje raz, w
//                          fabryce vi.mock, więc `beforeEach` musi go zerować).
//
//   paneToastSpies()
//     Trzy powierzchnie powiadomień, których używają te panele, w jednym
//     komplecie: `.sonner()` -> `vi.mock("sonner", ...)`, `.notify()` ->
//     `vi.mock("@/lib/notify", ...)`, `.toastErrorModule()` ->
//     `vi.mock("@/lib/toastError", ...)`. Spy: `.success`, `.error`,
//     `.notifySuccess`, `.notifyError`, `.toastError`.
//
//   requiredTenantStub(tenantId)
//     Kształt dla `vi.mock("@/hooks/useAuth", ...)` - panele edytora wpisu
//     (AudioPicker, CoverImagePicker) wołają `useRequiredTenant()` W RENDERZE
//     i bez tego wywracają cały panel (incydent 2026-07-23, patrz
//     `ThemeOptionsPane.regression.test.tsx`).
//
// API - MONTAŻ
//
//   mountSettingsPane(ui, { seed, wrapper })
//     Render w ŚWIEŻYM `QueryClient` bez ponowień. `seed` zasiewa cache PRZED
//     renderem (`[{ queryKey, data }]`) - tak podaje się „wartości zapisane"
//     panelom, które czytają przez `queryOptions` ze `staleTime` i nie muszą
//     wtedy w ogóle dotykać atrapy klienta. `wrapper` owija drzewo WEWNĄTRZ
//     providera zapytań (np. prawdziwym `ThemeProvider`, gdy panel czyta
//     `useTheme`). Zwraca wynik RTL + `queryClient` + `rerenderPane(ui)`
//     (zwykłe `rerender` z RTL zgubiłoby providery).
//
//   stubBrowserPageFetch(html?)
//     Odcina happy-doma od sieci: `<iframe src>` i każdy inny fetch okna
//     dostaje lokalną odpowiedź zamiast gniazda. Zwraca funkcję przywracającą
//     poprzedni stan - wołaj ją w `afterEach`.
//
// API - ATRAPY DZIECI I ZAPYTANIA DOM
//
//   propRecorder<P>()            - rejestrator propów (`.last()`, `.calls`).
//   imageSlotStub(rec)           - `@/components/admin/ImageSlot`.
//   colorPickerStub(rec)         - `@/components/admin/blocks/AdminColorPicker`.
//   childPaneStub(name, rec)     - dowolny panel-dziecko (`data-testid=name`).
//   rowFor / controlFor / switchFor / selectWithOption / colorPickerInputs
//                                - patrz komentarze przy definicjach.
import { createElement, type ReactElement, type ReactNode } from "react";
import { render, type RenderResult } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { vi, type Mock } from "vitest";
import {
  fail,
  ok,
  supabaseFromStub,
  supabaseRpcStub,
  type RecordedChain,
  type SupabaseFromStub,
  type SupabaseResult,
  type SupabaseRpcStub,
  type TableResponder,
} from "@/test/supabase";

// ─── granica danych: klient Supabase ─────────────────────────────────────────

/** Ogniwa, których obecność w łańcuchu znaczy ZAPIS (a nie odczyt). */
const WRITE_METHODS = ["upsert", "insert", "update", "delete"] as const;
export type WriteMethod = (typeof WRITE_METHODS)[number];

/** Wymuszony błąd bazy: komunikat + opcjonalny kod SQLSTATE/PostgREST. */
interface ForcedFailure {
  message: string;
  code?: string;
}

/** Atrapa `supabase.storage` z uploadem - kontrakt ImageSlot/AudioPicker. */
export interface PaneStorageStub {
  /** `supabase.storage.from(bucket)`. */
  from: Mock;
  upload: Mock;
  remove: Mock;
  getPublicUrl: Mock;
  createSignedUrl: Mock;
  /** Kubełki, do których panel sięgnął (w kolejności). */
  buckets: string[];
  /** Ustaw błąd uploadu (kolejne `upload()` zwraca ten błąd). */
  failUpload(message: string): void;
  reset(): void;
}

function paneStorageStub(publicUrlBase: string): PaneStorageStub {
  let uploadFailure: ForcedFailure | null = null;
  const buckets: string[] = [];
  const upload = vi.fn(async (path: string) =>
    uploadFailure
      ? { data: null, error: new Error(uploadFailure.message) }
      : { data: { path }, error: null },
  );
  const remove = vi.fn(async () => ({ data: [], error: null }));
  const getPublicUrl = vi.fn((path: string) => ({
    data: { publicUrl: `${publicUrlBase}/${path}` },
  }));
  const createSignedUrl = vi.fn(async (path: string) => ({
    data: { signedUrl: `${publicUrlBase}/signed/${path}` },
    error: null,
  }));
  const stub: PaneStorageStub = {
    from: vi.fn((bucket: string) => {
      buckets.push(bucket);
      return { upload, remove, getPublicUrl, createSignedUrl };
    }),
    upload,
    remove,
    getPublicUrl,
    createSignedUrl,
    buckets,
    failUpload(message) {
      uploadFailure = { message };
    },
    reset() {
      uploadFailure = null;
      buckets.length = 0;
      upload.mockClear();
      remove.mockClear();
      getPublicUrl.mockClear();
      createSignedUrl.mockClear();
      stub.from.mockClear();
    },
  };
  return stub;
}

/** Klient w kształcie, w jakim czyta go produkcja (`supabase.*`). */
export interface SupabaseClientStub {
  from: (table: string) => unknown;
  rpc: (name: string, args?: Record<string, unknown>) => Promise<SupabaseResult>;
  storage: PaneStorageStub;
  auth: {
    getUser(): Promise<{ data: { user: { id: string } | null }; error: null }>;
    getSession(): Promise<{ data: { session: { user: { id: string } } | null }; error: null }>;
    onAuthStateChange(): { data: { subscription: { unsubscribe: () => void } } };
  };
  channel: () => {
    on: () => unknown;
    subscribe: () => unknown;
    unsubscribe: () => void;
  };
}

export interface SettingsPaneSupabaseOptions {
  /** Wiersze `site_settings` widziane przez panel: klucz -> zapisana wartość. */
  settings?: Record<string, unknown>;
  /** Odczyty innych tabel: nazwa -> wiersz / lista / własny responder. */
  tables?: Record<string, unknown>;
  /** Zalogowany użytkownik; `null` = gość (domyślnie "user-test"). */
  userId?: string | null;
  /** Prefiks publicznych URL-i Storage (atrapa, NIGDY prawdziwy host). */
  publicUrlBase?: string;
}

export interface SettingsPaneSupabase {
  /** Do zwrócenia z fabryki: `{ supabase: sb.client }`. */
  client: SupabaseClientStub;
  db: SupabaseFromStub;
  rpc: SupabaseRpcStub;
  storage: PaneStorageStub;
  /** Wartość wiersza `site_settings` pod danym kluczem. */
  setSetting(key: string, value: unknown): void;
  /** Aktualna mapa `site_settings` (po zapisach panelu). */
  settings(): Record<string, unknown>;
  /** Dane odczytu tabeli: pojedynczy wiersz albo lista wierszy. */
  setTable(table: string, data: unknown): void;
  /**
   * Własny responder tabeli - przejmuje ODCZYT I ZAPIS. Osobna metoda (a nie
   * przeciążenie `setTable`) daje funkcji kontekstowy typ `TableResponder`,
   * więc parametr `chain` nie wymaga adnotacji po stronie testu.
   */
  setTableResponder(table: string, responder: TableResponder): void;
  /** Odczyt tabeli kończy się błędem PostgREST. */
  failRead(table: string, message: string, code?: string): void;
  /** Każdy zapis do tabeli kończy się błędem PostgREST. */
  failWrite(table: string, message: string, code?: string): void;
  /** Ładunki zapisów do tabeli (domyślnie `upsert`), w kolejności. */
  writes(table: string, method?: WriteMethod): unknown[];
  /** Ostatni ładunek zapisu - najczęstsza asercja. */
  lastWrite(table: string, method?: WriteMethod): unknown;
  /** Łańcuchy zapisane dla tabeli (kolejność ogniw). */
  chainsFor(table: string): RecordedChain[];
  reset(options?: SettingsPaneSupabaseOptions): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Atrapa klienta Supabase dla paneli ustawień.
 *
 * `site_settings` ma responder WBUDOWANY, bo to jedyna tabela, którą panele
 * czytają w DWÓCH kształtach naraz (`select("value").eq("key",k).maybeSingle()`
 * w `useSettings` i bulk `select("key,value")` w `siteSettingsQueryOptions`) i
 * do której zapisują `upsert({ key, value })`. Zapis wchodzi do tej samej mapy,
 * więc odczyt PO zapisie widzi nową wartość - bez tego test „zapisz i sprawdź,
 * co panel czyta ponownie" mierzyłby atrapę, a nie panel.
 */
export function settingsPaneSupabase(
  options: SettingsPaneSupabaseOptions = {},
): SettingsPaneSupabase {
  const db = supabaseFromStub();
  const rpc = supabaseRpcStub();
  const storage = paneStorageStub(options.publicUrlBase ?? "https://storage.example.test");
  const settingsRows = new Map<string, unknown>();
  const tableData = new Map<string, unknown>();
  const readFailures = new Map<string, ForcedFailure>();
  const writeFailures = new Map<string, ForcedFailure>();
  let userId: string | null = options.userId === undefined ? "user-test" : options.userId;

  const isWrite = (chain: RecordedChain) => WRITE_METHODS.some((m) => chain.has(m));

  const siteSettings: TableResponder = (chain) => {
    if (isWrite(chain)) {
      const forced = writeFailures.get("site_settings");
      if (forced) return fail(forced.message, forced.code);
      const payload = chain.argsOf("upsert")?.[0];
      if (isRecord(payload) && typeof payload.key === "string") {
        settingsRows.set(payload.key, payload.value);
      }
      return ok(null);
    }
    const forced = readFailures.get("site_settings");
    if (forced) return fail(forced.message, forced.code);
    const eqArgs = chain.argsOf("eq");
    if (eqArgs && eqArgs[0] === "key") {
      const key = String(eqArgs[1]);
      if (!settingsRows.has(key)) return ok(null);
      return ok({ value: settingsRows.get(key) });
    }
    return ok([...settingsRows].map(([key, value]) => ({ key, value })));
  };

  const generic =
    (table: string): TableResponder =>
    (chain) => {
      // Własny responder przejmuje ODCZYT I ZAPIS - to jedyny sposób na
      // opóźnienie zapisu (asercja na stanie „Zapisywanie...") albo na
      // odpowiedź zależną od ładunku.
      const planned = tableData.get(table);
      if (typeof planned === "function") return (planned as TableResponder)(chain);
      if (isWrite(chain)) {
        const forced = writeFailures.get(table);
        return forced ? fail(forced.message, forced.code) : ok(null);
      }
      const forced = readFailures.get(table);
      if (forced) return fail(forced.message, forced.code);
      return ok(planned ?? null);
    };

  const install = (next: SettingsPaneSupabaseOptions) => {
    settingsRows.clear();
    tableData.clear();
    readFailures.clear();
    writeFailures.clear();
    for (const [key, value] of Object.entries(next.settings ?? {})) settingsRows.set(key, value);
    db.setResponse("site_settings", siteSettings);
    for (const [table, data] of Object.entries(next.tables ?? {})) {
      tableData.set(table, data);
      db.setResponse(table, generic(table));
    }
    userId = next.userId === undefined ? "user-test" : next.userId;
  };

  install(options);

  const client: SupabaseClientStub = {
    from: db.from,
    rpc: rpc.rpc,
    storage,
    auth: {
      async getUser() {
        return { data: { user: userId === null ? null : { id: userId } }, error: null };
      },
      async getSession() {
        return {
          data: { session: userId === null ? null : { user: { id: userId } } },
          error: null,
        };
      },
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    channel: () => ({
      on() {
        return this;
      },
      subscribe() {
        return this;
      },
      unsubscribe: () => {},
    }),
  };

  return {
    client,
    db,
    rpc,
    storage,
    setSetting(key, value) {
      settingsRows.set(key, value);
    },
    settings: () => Object.fromEntries(settingsRows),
    setTable(table, data) {
      tableData.set(table, data);
      db.setResponse(table, generic(table));
    },
    setTableResponder(table, responder) {
      tableData.set(table, responder);
      db.setResponse(table, generic(table));
    },
    failRead(table, message, code) {
      readFailures.set(table, { message, code });
      if (!db.chainsFor(table).length && !tableData.has(table)) {
        db.setResponse(table, table === "site_settings" ? siteSettings : generic(table));
      }
    },
    failWrite(table, message, code) {
      writeFailures.set(table, { message, code });
      if (table !== "site_settings" && !tableData.has(table)) {
        db.setResponse(table, generic(table));
      }
    },
    writes(table, method = "upsert") {
      return db
        .chainsFor(table)
        .filter((chain) => chain.has(method))
        .map((chain) => chain.argsOf(method)?.[0]);
    },
    lastWrite(table, method = "upsert") {
      const all = db
        .chainsFor(table)
        .filter((chain) => chain.has(method))
        .map((chain) => chain.argsOf(method)?.[0]);
      return all.at(-1);
    },
    chainsFor: (table) => db.chainsFor(table),
    reset(next = options) {
      db.reset();
      rpc.reset();
      storage.reset();
      install(next);
    },
  };
}

// ─── granica danych: powiadomienia ───────────────────────────────────────────

/** Kształt `toast` z sonnera: wołalny obiekt z wariantami. */
interface SonnerToast {
  (message: string): void;
  success: Mock<(message: string) => void>;
  error: Mock<(message: string) => void>;
  info: Mock<(message: string) => void>;
  warning: Mock<(message: string) => void>;
  message: Mock<(message: string) => void>;
  loading: Mock<(message: string) => void>;
  dismiss: Mock<(id?: unknown) => void>;
}

export interface PaneToastSpies {
  success: Mock<(message: string) => void>;
  error: Mock<(message: string) => void>;
  notifySuccess: Mock<(message: string) => void>;
  notifyError: Mock<(message: string) => void>;
  toastError: Mock<(error: unknown, kind?: string) => void>;
  /** Zwróć z fabryki `vi.mock("sonner", ...)`. */
  sonner(): { toast: SonnerToast; Toaster: () => null };
  /** Zwróć z fabryki `vi.mock("@/lib/notify", ...)`. */
  notify(): {
    notifySuccess: Mock<(message: string) => void>;
    notifyError: Mock<(message: string) => void>;
  };
  /** Zwróć z fabryki `vi.mock("@/lib/toastError", ...)`. */
  toastErrorModule(): { toastError: Mock<(error: unknown, kind?: string) => void> };
  /** Wszystkie komunikaty przekazane do JAKIEGOKOLWIEK kanału błędu. */
  errorMessages(): string[];
  reset(): void;
}

export function paneToastSpies(): PaneToastSpies {
  const success = vi.fn<(message: string) => void>();
  const error = vi.fn<(message: string) => void>();
  const info = vi.fn<(message: string) => void>();
  const warning = vi.fn<(message: string) => void>();
  const message = vi.fn<(message: string) => void>();
  const loading = vi.fn<(message: string) => void>();
  const dismiss = vi.fn<(id?: unknown) => void>();
  const notifySuccess = vi.fn<(message: string) => void>();
  const notifyError = vi.fn<(message: string) => void>();
  const toastError = vi.fn<(error: unknown, kind?: string) => void>();

  const toast = Object.assign(vi.fn<(m: string) => void>(), {
    success,
    error,
    info,
    warning,
    message,
    loading,
    dismiss,
  }) as unknown as SonnerToast;

  return {
    success,
    error,
    notifySuccess,
    notifyError,
    toastError,
    sonner: () => ({ toast, Toaster: () => null }),
    notify: () => ({ notifySuccess, notifyError }),
    toastErrorModule: () => ({ toastError }),
    errorMessages: () =>
      [...error.mock.calls, ...notifyError.mock.calls].map(([text]) => String(text)),
    reset() {
      success.mockClear();
      error.mockClear();
      info.mockClear();
      warning.mockClear();
      message.mockClear();
      loading.mockClear();
      dismiss.mockClear();
      notifySuccess.mockClear();
      notifyError.mockClear();
      toastError.mockClear();
    },
  };
}

/**
 * Kształt `@/hooks/useAuth` dla paneli, które wołają `useRequiredTenant()`
 * w renderze. Zwracamy WSZYSTKIE trzy hooki naraz, bo panele edytora wpisu
 * mieszają je w jednym drzewie.
 */
export function requiredTenantStub(tenantId = "tenant-test", userId = "user-test") {
  return {
    useRequiredTenant: () => tenantId,
    useTenant: () => tenantId,
    useAuth: () => ({
      user: { id: userId },
      session: { user: { id: userId } },
      loading: false,
      tenantId,
    }),
  };
}

// ─── montaż ──────────────────────────────────────────────────────────────────

/** Jeden wpis do zasiania w cache react-query przed renderem. */
export interface SeededQuery {
  queryKey: readonly unknown[];
  data: unknown;
}

export interface MountSettingsPaneOptions {
  /** Cache zasiany PRZED renderem - „wartości zapisane" bez ruchu do atrapy. */
  seed?: ReadonlyArray<SeededQuery>;
  /** Dodatkowy provider WEWNĄTRZ QueryClientProvider (np. ThemeProvider). */
  wrapper?: (children: ReactNode) => ReactElement;
}

export interface MountedSettingsPane extends RenderResult {
  queryClient: QueryClient;
  /** Ponowny render z zachowaniem providerów (RTL `rerender` je gubi). */
  rerenderPane(ui: ReactElement): void;
}

export function mountSettingsPane(
  ui: ReactElement,
  options: MountSettingsPaneOptions = {},
): MountedSettingsPane {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  for (const entry of options.seed ?? []) queryClient.setQueryData(entry.queryKey, entry.data);
  const wrap = (node: ReactElement): ReactElement =>
    createElement(
      QueryClientProvider,
      { client: queryClient },
      options.wrapper ? options.wrapper(node) : node,
    );
  const result = render(wrap(ui));
  return {
    ...result,
    queryClient,
    rerenderPane: (next) => result.rerender(wrap(next)),
  };
}

/**
 * ODCINA HAPPY-DOM OD SIECI NA CZAS TESTU.
 *
 * happy-dom implementuje `<iframe src>` PRAWDZIWYM żądaniem HTTP: podgląd
 * publikacji (`ExpertLayoutPreview`) montujący ramkę z relatywnym adresem
 * wychodzi wtedy na `http://localhost:3000/...` i zostawia po teście
 * `NetworkError` / `AbortError` w logu - czyli test wychodzi do sieci, choć
 * nikt tego nie chciał.
 *
 * Zamiast WYŁĄCZAĆ ładowanie ramek (co daje w logu `DOMException` na każdą
 * ramkę i zostawia `contentWindow` pusty) podstawiamy INTERCEPTOR fetcha
 * happy-doma: każde żądanie dostaje lokalną odpowiedź HTML bez otwierania
 * gniazda. Ramka „ładuje się" normalnie, więc `onLoad` panelu odpala się jak
 * w przeglądarce i widać, co panel robi z dokumentem ramki.
 *
 * Zwraca funkcję przywracającą poprzedni interceptor - wołaj ją w `afterEach`.
 */
export function stubBrowserPageFetch(
  html = "<!doctype html><html><body></body></html>",
): () => void {
  const scope = globalThis as unknown as {
    happyDOM?: { settings?: { fetch?: { interceptor?: unknown } } };
    Response?: new (
      body: string,
      init: { status: number; headers: Record<string, string> },
    ) => unknown;
  };
  const fetchSettings = scope.happyDOM?.settings?.fetch;
  const ResponseCtor = scope.Response;
  if (!fetchSettings || !ResponseCtor) return () => {};
  const previous = fetchSettings.interceptor;
  fetchSettings.interceptor = {
    beforeAsyncRequest: async () =>
      new ResponseCtor(html, { status: 200, headers: { "content-type": "text/html" } }),
  };
  return () => {
    fetchSettings.interceptor = previous;
  };
}

// ─── atrapy dzieci ───────────────────────────────────────────────────────────

/** Rejestrator propów przekazanych atrapie dziecka. */
export interface PropRecorder<P> {
  calls: P[];
  last(): P | undefined;
  reset(): void;
}

export function propRecorder<P>(): PropRecorder<P> {
  const calls: P[] = [];
  return {
    calls,
    last: () => calls.at(-1),
    reset: () => {
      calls.length = 0;
    },
  };
}

/** Propy, które panele przekazują `ImageSlot`. */
export interface ImageSlotStubProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  folder?: string;
  bucket?: string;
  previewMode?: "auto" | "light" | "dark";
  icon?: ReactNode;
}

/**
 * Atrapa `@/components/admin/ImageSlot`: pole tekstowe zamiast uploadera.
 * Etykieta trafia na `aria-label`, więc slot znajduje się dokładnie tak, jak
 * w produkcji, a wpisanie URL-a wywołuje `onChange` panelu.
 */
export function imageSlotStub(recorder: PropRecorder<ImageSlotStubProps>): {
  ImageSlot: (props: ImageSlotStubProps) => ReactElement;
} {
  return {
    ImageSlot: (props: ImageSlotStubProps) => {
      recorder.calls.push(props);
      return createElement("input", {
        "data-image-slot": props.label,
        "data-preview-mode": props.previewMode ?? "auto",
        "data-folder": props.folder ?? "",
        "aria-label": props.label,
        value: props.value,
        onChange: (event: { target: { value: string } }) => props.onChange(event.target.value),
      });
    },
  };
}

/** Propy, które panele przekazują `AdminColorPicker`. */
export interface ColorPickerStubProps {
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  inheritedValue?: string;
  allowTransparent?: boolean;
  allowReset?: boolean;
  ariaLabel?: string;
}

/**
 * Atrapa `@/components/admin/blocks/AdminColorPicker`. Oprócz pola wartości
 * daje PRZYCISK RESETU wołający `onChange(undefined)` - to jedyna droga do
 * gałęzi `v ?? ""` / `v ?? "#ffffff"` w panelach, a te gałęzie decydują, czy
 * po resecie do bazy poleci pusty string, czy `undefined`.
 */
export function colorPickerStub(recorder: PropRecorder<ColorPickerStubProps>): {
  AdminColorPicker: (props: ColorPickerStubProps) => ReactElement;
} {
  return {
    AdminColorPicker: (props: ColorPickerStubProps) => {
      recorder.calls.push(props);
      return createElement(
        "span",
        { "data-color-picker": props.ariaLabel ?? "" },
        createElement("input", {
          "data-color-input": true,
          "aria-label": props.ariaLabel,
          "data-inherited": props.inheritedValue ?? "",
          value: props.value ?? "",
          onChange: (event: { target: { value: string } }) => props.onChange(event.target.value),
        }),
        createElement(
          "button",
          {
            type: "button",
            "data-color-reset": true,
            onClick: () => props.onChange(undefined),
          },
          "reset",
        ),
      );
    },
  };
}

/**
 * Atrapa panelu-dziecka (`GlobalColorsEditor`, `ThemeDesignPane`,
 * `ThemeFontSizesPane`, `ThemeBackgroundsPane` wewnątrz `ThemeOptionsPane`).
 * Renderuje `<div data-testid={name}>`, a propy ląduje w rejestratorze - dzięki
 * temu test dowodzi, KTÓRĄ grupę kolorów panel nadrzędny zamówił.
 */
export function childPaneStub<P extends object>(
  name: string,
  recorder: PropRecorder<P>,
): (props: P) => ReactElement {
  return (props: P) => {
    recorder.calls.push(props);
    return createElement("div", { "data-testid": name });
  };
}

// ─── zapytania DOM ───────────────────────────────────────────────────────────

function labelElement(container: HTMLElement, text: string): HTMLElement {
  const labels = [...container.querySelectorAll("label")].filter(
    (node) => node.textContent?.trim() === text,
  );
  if (labels.length === 0) throw new Error(`test: brak etykiety "${text}" w drzewie panelu`);
  return labels[0];
}

/**
 * Wiersz formularza (`Row`) dla etykiety. Panele adminowe NIE wiążą etykiety
 * z kontrolką przez `htmlFor`, więc `getByLabelText` tu nie działa - a wiersz
 * jest jedyną strukturą, która etykietę i kontrolkę trzyma razem.
 */
export function rowFor(container: HTMLElement, label: string): HTMLElement {
  let node: HTMLElement | null = labelElement(container, label);
  while (node && node !== container) {
    const parent: HTMLElement | null = node.parentElement;
    if (!parent) break;
    if (parent.querySelector("input, select, textarea, button")) return parent;
    node = parent;
  }
  throw new Error(`test: wiersz etykiety "${label}" nie zawiera żadnej kontrolki`);
}

/** Kontrolka z wiersza etykiety (domyślnie `input`). */
export function controlFor<T extends Element = HTMLInputElement>(
  container: HTMLElement,
  label: string,
  selector = "input",
): T {
  const node = rowFor(container, label).querySelector(selector);
  if (!node) throw new Error(`test: brak kontrolki "${selector}" przy etykiecie "${label}"`);
  return node as T;
}

/** Przełącznik (atrapa Radix Switch) z wiersza etykiety. */
export function switchFor(container: HTMLElement, label: string): HTMLInputElement {
  return controlFor<HTMLInputElement>(container, label, 'input[role="switch"]');
}

/**
 * `<select>` (atrapa Radix Select) zawierający daną opcję. Trigger Radixa
 * w tych panelach nie ma ani `id`, ani `aria-label`, więc atrapa nie ma z czego
 * zbudować dostępnej nazwy - jedynym STABILNYM identyfikatorem listy jest
 * zestaw jej opcji, czyli kontrakt, o który w tych polach chodzi.
 */
export function selectWithOption(container: HTMLElement, optionValue: string): HTMLSelectElement {
  const found = [...container.querySelectorAll("select")].find((select) =>
    [...select.options].some((option) => option.value === optionValue),
  );
  if (!found) throw new Error(`test: brak listy z opcją "${optionValue}"`);
  return found;
}

/** Wszystkie pola atrapy `AdminColorPicker` w kolejności renderu. */
export function colorPickerInputs(container: HTMLElement): HTMLInputElement[] {
  return [...container.querySelectorAll<HTMLInputElement>("input[data-color-input]")];
}

/** Wszystkie przyciski resetu atrapy `AdminColorPicker` w kolejności renderu. */
export function colorPickerResets(container: HTMLElement): HTMLButtonElement[] {
  return [...container.querySelectorAll<HTMLButtonElement>("button[data-color-reset]")];
}
