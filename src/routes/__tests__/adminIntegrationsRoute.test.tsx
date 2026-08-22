// PANEL „Integracje wychodzące” (`/admin/integrations`, 625 linii, 0% przed tą
// zmianą) - jedyny ekran, z którego konfiguruje się USŁUGI ZEWNĘTRZNE: adres
// odbiorcy, adapter formatu i KLUCZ podpisujący, którego platforma nigdy nie
// zwraca z Vault do przeglądarki.
//
// CO TEN PLIK DOWODZI - I DLACZEGO NIE JEST FARMĄ POKRYCIA.
// `adminRouteAuthority.gate.test.ts` argumentuje wprost, że render-testowanie
// tras panelu DLA POKRYCIA jest farmą: ryzyko w trasie panelu to DOSTĘP, a ten
// jest egzekwowany w trzech miejscach (layout `/admin`, sama trasa, RLS/RPC).
// Tutaj ryzyko jest inne i renderu wymaga: panel konfiguracji integracji
// KŁAMIE TANIO. Endpoint bez klucza wygląda dokładnie tak samo jak endpoint
// z kluczem, nieudany odczyt kolejki wygląda dokładnie tak samo jak kolejka
// pusta, a operator dowiaduje się o obu dopiero z ciszy po stronie odbiorcy.
// Dlatego przedmiotem dowodu jest tu SIEDEM rzeczy:
//
//   1. KLUCZ NIEUSTAWIONY jest powiedziany WPROST (osobna, ostrzegawcza plakietka)
//      - dla `secret_id = null` ORAZ dla wartości fałszywej ale prawidłowej
//      (`""`), bo to drugie powstaje z ręcznej edycji wiersza i wygląda
//      niewinnie.
//   2. KLUCZ NIEPRAWIDŁOWY (RPC Vault odrzuca zapis sekretu) daje komunikat
//      Z KLUCZA i18n, a okno edycji NIE ZNIKA - inaczej operator traci wpisaną
//      konfigurację razem z informacją, co poprawić.
//   3. AWARIA USŁUGI (dispatcher rzuca `HTTP 503`) i TIMEOUT (przerwane żądanie)
//      degradują się do komunikatu błędu, bez toastu sukcesu. Deterministycznie:
//      atrapa server fn odrzuca NATYCHMIAST, w teście nie ma ani jednego
//      `setTimeout`.
//   4. ŁADUNEK KAŻDEJ MUTACJI: co dokładnie leci do `integration_endpoints`
//      (insert/update/delete) i do RPC `integration_endpoint_set_secret`.
//      Sekret idzie WYŁĄCZNIE przez RPC i nigdy nie ląduje w kolumnie.
//   5. ODCZYT KONFIGURACJI w obu ramionach każdego `??`/`?:` - w szczególności
//      wartość fałszywa ale prawidłowa (`0`, `""`, `false`).
//   6. STAN PUSTY vs STAN BŁĘDU - rozdzielone (a gdzie nie są, stoi `it.fails`
//      z opisem konsekwencji).
//   7. BRAMKA ZAPISU: pole martwe (nazwa < 2 znaków, adres bez https) nie
//      przechodzi, a zapis w toku blokuje przycisk.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - ADAPTERÓW FORMATU: `src/lib/integrations/__tests__/formats.test.ts` ma
//   Block Kit, HubSpot upsert, partnera CRM i normalizację rodzaju. Tutaj
//   `normalizeIntegrationKind` jest używany PRAWDZIWY (nie atrapa), bo dowodem
//   jest to, że panel nie wysyła do bazy rodzaju spoza enumu.
// - DISPATCHERA: `src/lib/integrations/__tests__/dispatch.functions.test.ts`
//   dowodzi claimu, podpisu HMAC, 5xx, timeoutu i raportu dostawy. Tutaj server
//   fn jest atrapą i dowodzimy WYŁĄCZNIE tego, co panel do niej wysyła i co
//   robi z jej odpowiedzią oraz odmową.
// - AUTORYTETU: zapis do `integration_endpoints` pilnuje polityka
//   „integration_endpoints_staff_all” (tenant + rola staff), a odczyt sekretu
//   jest zamknięty dla wszystkich poza service_role - pgTAP i bramka
//   `check:authz-snapshot`. Render niczego o tym nie dowodzi i nie udaje, że
//   dowodzi.
// - WIDŻETU Radix `Select`: podmieniony na natywny `<select>` (ten sam wzorzec
//   co w `adminRedirectsRoute.test.tsx`). Regułą panelu jest to, CO robi
//   z wybraną wartością, nie mechanika listy rozwijanej.
//
// BEZPIECZEŃSTWO TESTU: żaden test nie wychodzi do sieci (globalny `fetch` jest
// atrapą, która RZUCA, a `afterEach` pilnuje, że nikt jej nie tknął) i nie
// zawiera prawdziwego sekretu - klucze w fixture'ach są jawnie fałszywe
// (`test-key-not-real`), adresy wyłącznie w domenach `example.com`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { RecordedChain, SupabaseFromStub, SupabaseResult } from "@/test/supabaseChain";

/** Ustalona data bazowa - `updated_at` w ładunkach musi być powtarzalne. */
const BASE_ISO = "2026-08-21T09:30:00.000Z";

/** Jawnie fałszywy klucz - nigdy w formacie realnego tokena dostawcy. */
const FAKE_SECRET = "test-key-not-real";

const h = vi.hoisted(() => ({
  /** Atrapa łańcucha PostgREST - powstaje w fabryce `vi.mock`. */
  db: null as SupabaseFromStub | null,
  /** Tabele, których odczyt NIGDY się nie rozwiązuje (stan „wczytywanie"). */
  pendingTables: new Set<string>(),
  /** Wywołania RPC klienta: nazwa + argumenty (sekret idzie właśnie tędy). */
  rpcCalls: [] as { name: string; args: unknown }[],
  /**
   * Błąd RPC `integration_endpoint_set_secret`. `unknown`, bo Vault potrafi
   * odrzucić zapis wartością bez `message` - a to OSOBNA gałąź w obsłudze
   * błędu panelu (`e instanceof Error ? e.message : String(e)`).
   */
  rpcError: null as unknown,
  /** Odpowiedź atrapy server fn dispatchera. */
  dispatch: vi.fn(),
  /** Ile razy trasa zarejestrowała swój słownik i18n. */
  i18nRegistrations: 0,
  /** Odpowiedź `window.confirm` + zapisane pytania. */
  confirmAnswer: true,
  confirmMessages: [] as string[],
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  /** Globalny `fetch` - atrapa, która RZUCA. Panel nie ma prawa jej tknąć. */
  fetch: vi.fn(),
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("sonner", () => ({
  toast: { success: h.toastSuccess, error: h.toastError },
  Toaster: () => null,
}));

// Słownik trasy rejestruje się w chunku KOMPONENTU (patrz komentarz przy
// `ensureI18n`); atrapa liczy wywołania, bo brak rejestracji = panel bez napisów.
vi.mock("@/lib/i18n-admin-integrations", () => ({
  ensureI18n: () => {
    h.i18nRegistrations += 1;
  },
}));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const db = supabaseFromStub();
  h.db = db;
  /**
   * Łańcuch, który nigdy się nie rozwiązuje - jedyny deterministyczny sposób
   * na utrzymanie stanu „wczytywanie” (atrapa `supabaseFromStub` odpowiada
   * natychmiast, więc bez tego stan wczytywania byłby nie do zaobserwowania
   * inaczej niż wyścigiem z mikrozadaniami).
   */
  const neverSettling = (): Record<string, unknown> => {
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "insert", "update", "delete", "eq", "order", "limit"]) {
      builder[method] = () => builder;
    }
    for (const method of ["single", "maybeSingle"]) {
      builder[method] = () => new Promise(() => undefined);
    }
    builder.then = () => new Promise(() => undefined);
    return builder;
  };
  return {
    supabase: {
      from: (table: string) => (h.pendingTables.has(table) ? neverSettling() : db.from(table)),
      rpc: (name: string, args: unknown) => {
        h.rpcCalls.push({ name, args });
        return Promise.resolve({ data: null, error: h.rpcError });
      },
    },
  };
});

// Server fn dispatchera jako atrapa; `useServerFn` w produkcji oddaje wołalny
// wrapper tej samej funkcji, więc tożsamość wywołania jest wierna.
vi.mock("@/lib/integrations/dispatch.functions", () => ({
  dispatchIntegrationDeliveries: h.dispatch,
}));
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useServerFn: (fn: unknown) => fn,
}));

// Radix `Select` na natywny `<select>`: dzięki temu WSZYSTKIE opcje adaptera
// istnieją w DOM (czyli każda gałąź `kindLabel` jest naprawdę renderowana),
// a wybór idzie tą samą drogą co w produkcji - przez `onValueChange`.
vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value?: string;
    onValueChange?: (v: string) => void;
    children?: ReactNode;
  }) => (
    <select value={value} onChange={(event) => onValueChange?.(event.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children?: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children?: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));

import { renderRoute, routeMeta } from "@/test/routeHarness";
import { Route as IntegrationsRoute } from "@/routes/admin.integrations";
import { fail, ok } from "@/test/supabaseChain";
// Rodzaje integracji BIERZEMY Z PRODUKCJI: przepisana z ręki lista rozjechałaby
// się z enumem bazy bez żadnego sygnału.
import { INTEGRATION_KINDS } from "@/lib/integrations/formats";

const PATH = "/admin/integrations";
const ENDPOINTS = "integration_endpoints";
const DELIVERIES = "integration_deliveries";

/** Atrapa klienta - STRAŻNIK zamiast rzutowania stanu z `vi.hoisted`. */
function db(): SupabaseFromStub {
  const value = h.db;
  if (!value) throw new Error("test: atrapa klienta Supabase nie została zainicjowana");
  return value;
}

interface EndpointFixture {
  id: string;
  name: string;
  integration: string;
  url: string;
  event_types: string[];
  enabled: boolean;
  secret_id: string | null;
  created_at: string;
  updated_at: string;
}

function endpoint(overrides: Partial<EndpointFixture> = {}): EndpointFixture {
  return {
    id: "ep-1",
    name: "Zapier - kampanie",
    integration: "webhook",
    url: "https://receiver.example.com/webhooks/nes",
    event_types: ["post.published.v1"],
    enabled: true,
    secret_id: "vault-1111-2222",
    created_at: "2026-08-01T10:00:00.000Z",
    updated_at: "2026-08-02T10:00:00.000Z",
    ...overrides,
  };
}

/** Plan odpowiedzi tabel: lista, insert, update i delete osobno. */
interface Plan {
  list: SupabaseResult;
  insert: SupabaseResult;
  write: SupabaseResult;
  deliveries: SupabaseResult;
}

let plan: Plan;

function planFor(chain: RecordedChain): SupabaseResult {
  if (chain.has("insert")) return plan.insert;
  if (chain.has("update") || chain.has("delete")) return plan.write;
  return plan.list;
}

async function renderPanel(): Promise<void> {
  await renderRoute({
    route: IntegrationsRoute,
    path: PATH,
    initialEntry: PATH,
    queryClient: new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }),
  });
  await waitFor(() =>
    expect(screen.getByText("adminIntegrations.outgoingIntegrations")).toBeInTheDocument(),
  );
}

/** Panel po rozwiązaniu OBU odczytów - punkt wyjścia większości asercji. */
async function renderReady(): Promise<void> {
  await renderPanel();
  await waitFor(() => expect(db().chainsFor(ENDPOINTS).length).toBeGreaterThan(0));
  await waitFor(() => expect(db().chainsFor(DELIVERIES).length).toBeGreaterThan(0));
}

/** Odczyty listy (bez mutacji) - do liczenia unieważnień cache. */
function listReads(): RecordedChain[] {
  return db()
    .chainsFor(ENDPOINTS)
    .filter((chain) => !chain.has("insert") && !chain.has("update") && !chain.has("delete"));
}

function writeChains(method: "insert" | "update" | "delete"): RecordedChain[] {
  return db()
    .chainsFor(ENDPOINTS)
    .filter((chain) => chain.has(method));
}

function secretRpcCalls(): { name: string; args: unknown }[] {
  return h.rpcCalls.filter((call) => call.name === "integration_endpoint_set_secret");
}

/** Wartość karty statystyki - etykieta i liczba są rodzeństwem w `CardHeader`. */
function statValue(labelKey: string): string {
  const label = screen.getByText(labelKey);
  const value = label.parentElement?.lastElementChild;
  if (!(value instanceof HTMLElement)) throw new Error(`test: karta ${labelKey} bez wartości`);
  return value.textContent ?? "";
}

function dialog(): HTMLElement {
  return screen.getByRole("dialog");
}

function passwordInput(): HTMLInputElement {
  const input = dialog().querySelector('input[type="password"]');
  if (!(input instanceof HTMLInputElement)) throw new Error("test: brak pola sekretu");
  return input;
}

function clearSecretCheckbox(): HTMLInputElement {
  const input = dialog().querySelector('input[type="checkbox"]');
  if (!(input instanceof HTMLInputElement)) throw new Error("test: brak pola „wyczyść sekret”");
  return input;
}

/** Pole tekstowe po etykiecie - STRAŻNIK, bo `value` czytamy z WŁAŚCIWOŚCI. */
function inputByLabel(label: string): HTMLInputElement {
  const element = screen.getByLabelText(label);
  if (!(element instanceof HTMLInputElement)) {
    throw new Error(`test: pole „${label}” nie jest polem tekstowym`);
  }
  return element;
}

function textareaByLabel(label: string): HTMLTextAreaElement {
  const element = screen.getByLabelText(label);
  if (!(element instanceof HTMLTextAreaElement)) {
    throw new Error(`test: pole „${label}” nie jest polem wieloliniowym`);
  }
  return element;
}

function saveButton(): HTMLElement {
  return within(dialog()).getByRole("button", { name: "adminIntegrations.save" });
}

function adapterSelect(): HTMLSelectElement {
  const select = within(dialog()).getByRole("combobox");
  if (!(select instanceof HTMLSelectElement)) throw new Error("test: brak listy adapterów");
  return select;
}

/** Otwiera okno nowego endpointu. */
function openNew(): void {
  fireEvent.click(screen.getByRole("button", { name: "adminIntegrations.newEndpoint" }));
}

/** Wypełnia okno minimalnym POPRAWNYM zestawem (nazwa + https). */
function fillValid(values: { name?: string; url?: string; events?: string } = {}): void {
  fireEvent.change(screen.getByLabelText("adminIntegrations.name"), {
    target: { value: values.name ?? "Odbiorca testowy" },
  });
  fireEvent.change(screen.getByLabelText("URL"), {
    target: { value: values.url ?? "https://receiver.example.com/hook" },
  });
  if (values.events !== undefined) {
    fireEvent.change(screen.getByLabelText("adminIntegrations.eventsCommaSpaceSeparated"), {
      target: { value: values.events },
    });
  }
}

/** Ładunek zapisu jako rekord - STRAŻNIK zamiast rzutowania argumentów ogniwa. */
function payloadOf(
  chain: RecordedChain | undefined,
  method: "insert" | "update",
): Record<string, unknown> {
  const args = chain?.argsOf(method);
  const first = args?.[0];
  if (first === null || typeof first !== "object" || Array.isArray(first)) {
    throw new Error(`test: ogniwo ${method} bez ładunku obiektowego`);
  }
  return { ...first };
}

beforeEach(() => {
  // Datę zamrażamy BEZ podmiany timerów - `waitFor` musi dalej tykać realnie,
  // a `updated_at` w ładunku ma być powtarzalne.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(BASE_ISO));
  db().reset();
  h.pendingTables = new Set();
  h.rpcCalls = [];
  h.rpcError = null;
  h.i18nRegistrations = 0;
  h.confirmAnswer = true;
  h.confirmMessages = [];
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
  h.dispatch.mockReset();
  h.dispatch.mockResolvedValue({ claimed: 0, delivered: 0, failed: 0 });
  h.fetch.mockReset();
  h.fetch.mockImplementation(() => {
    throw new Error("test: panel integracji NIE MA PRAWA wyjść do sieci");
  });
  vi.stubGlobal("fetch", h.fetch);
  plan = {
    list: ok([]),
    insert: ok({ id: "ep-new" }),
    write: ok(null),
    deliveries: ok([]),
  };
  db().setResponse(ENDPOINTS, planFor);
  db().setResponse(DELIVERIES, () => plan.deliveries);
  // happy-dom nie implementuje `window.confirm`, a panel pyta nim przed
  // usunięciem endpointu. Definiujemy WŁASNOŚĆ okna - tak brzmi wywołanie
  // w produkcji, więc `vi.stubGlobal` by w nie nie trafił.
  Object.defineProperty(window, "confirm", {
    configurable: true,
    writable: true,
    value: (message?: string) => {
      h.confirmMessages.push(message ?? "");
      return h.confirmAnswer;
    },
  });
});

afterEach(() => {
  // Mechaniczna gwarancja: ŻADEN test tego pliku nie wychodzi do sieci.
  expect(h.fetch, "panel tknął globalny fetch").not.toHaveBeenCalled();
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// 1. ODCZYT: kontrakt zapytań, stan pusty, stan wczytywania, stan błędu.
// ---------------------------------------------------------------------------

describe("panel integracji - odczyt konfiguracji", () => {
  it("czyta DOKŁADNIE kolumny panelu i od najnowszego endpointu", async () => {
    // Kolumny są kontraktem z bazą: sekret NIE MA tu prawa się pojawić (siedzi
    // w Vault), a kolejność od najnowszej pozwala zobaczyć świeżo dodany wpis.
    await renderReady();

    const chain = listReads().at(0);
    expect(chain?.argsOf("select")).toEqual([
      "id,name,integration,url,event_types,enabled,secret_id,created_at,updated_at",
    ]);
    expect(chain?.argsOf("order")).toEqual(["created_at", { ascending: false }]);
    const columns = String(chain?.argsOf("select")?.[0] ?? "");
    expect(columns).not.toMatch(/secret\b(?!_id)/);
  });

  it("podsumowanie kolejki czyta SAM status, z limitem partii", async () => {
    await renderReady();

    const chain = db().lastChain(DELIVERIES);
    expect(chain?.argsOf("select")).toEqual(["status"]);
    expect(chain?.argsOf("limit")).toEqual([1000]);
  });

  it("rejestruje słownik trasy - panel bez napisów byłby nieczytelny", async () => {
    await renderReady();

    expect(h.i18nRegistrations).toBeGreaterThan(0);
  });

  it("odczyt W TOKU pokazuje wczytywanie, a nie „brak endpointów”", async () => {
    // Puste miejsce zamiast wczytywania czyta się jako „nic nie ma” - operator
    // dodaje drugi endpoint do tego samego odbiorcy.
    h.pendingTables.add(ENDPOINTS);
    await renderPanel();

    await waitFor(() => expect(screen.getByText("adminIntegrations.loading")).toBeInTheDocument());
    expect(screen.queryByText("adminIntegrations.endpointsYetAddOneStart")).not.toBeInTheDocument();
  });

  it("BRAK endpointów mówi wprost, że lista jest pusta", async () => {
    await renderReady();

    expect(screen.getByText("adminIntegrations.endpointsYetAddOneStart")).toBeInTheDocument();
  });

  it("`data: null` z bazy nie wywala panelu - lista pusta, nagłówek zostaje", async () => {
    // Prawe ramię `data ?? []`: PostgREST oddaje `null` przy pustym wyniku
    // niektórych zapytań, a panel musi to znieść bez wyjątku w renderze.
    plan.list = ok(null);
    plan.deliveries = ok(null);
    await renderReady();

    expect(screen.getByText("adminIntegrations.endpointsYetAddOneStart")).toBeInTheDocument();
    expect(statValue("adminIntegrations.delivered")).toBe("0");
  });

  it.fails(
    "DEFEKT: nieudany odczyt endpointów pokazuje „brak endpointów” zamiast błędu",
    async () => {
      // CO: `src/routes/admin.integrations.tsx:362-370` rozgałęzia się wyłącznie
      // na `isLoading` i `rows.length === 0`. `endpointsQ.isError` nie ma tu
      // żadnego ramienia, a `rows` przy błędzie jest `[]` (linia 296).
      // KONSEKWENCJA: odmowa RLS albo padnięty odczyt wyglądają IDENTYCZNIE jak
      // tenant bez integracji. Operator widzi „dodaj pierwszy endpoint",
      // zakłada nową konfigurację obok istniejącej i dubluje dostawy do
      // odbiorcy - albo uznaje, że ktoś skasował mu integracje.
      plan.list = fail("permission denied for table integration_endpoints", "42501");
      await renderReady();

      expect(
        screen.queryByText("adminIntegrations.endpointsYetAddOneStart"),
        "stan błędu jest nieodróżnialny od stanu pustego",
      ).not.toBeInTheDocument();
    },
  );

  it.fails("DEFEKT: nieudany odczyt kolejki raportuje CZWÓRKĘ ZER", async () => {
    // CO: `admin.integrations.tsx:297-302` - `deliveriesQ.data ?? {}` i cztery
    // `counts[...] ?? 0`. Błąd odczytu nie ma tu ramienia.
    // KONSEKWENCJA: padnięty odczyt kolejki wygląda jak „zero martwych dostaw,
    // zero błędów" - czyli jak zdrowy system. To jest fałszywy sukces na
    // ekranie, po którym nikt nie sprawdza, dlaczego odbiorca milczy.
    plan.deliveries = fail("statement timeout", "57014");
    await renderReady();

    expect(statValue("adminIntegrations.dead"), "zero z awarii odczytu").not.toBe("0");
  });

  it("liczniki statusów zliczają wiersze, sumują `queued`+`delivering` i IGNORUJĄ nieznane", async () => {
    // Oba ramiona `counts[r.status] ?? 0` w akumulacji: pierwszy wiersz statusu
    // wchodzi w gałąź `undefined`, drugi w gałąź z liczbą.
    plan.deliveries = ok([
      { status: "delivered" },
      { status: "delivered" },
      { status: "queued" },
      { status: "delivering" },
      { status: "failed" },
      { status: "dead" },
      { status: "dead" },
      { status: "cokolwiek_z_przyszlej_migracji" },
    ]);
    await renderReady();

    expect(statValue("adminIntegrations.delivered")).toBe("2");
    expect(statValue("adminIntegrations.pending")).toBe("2");
    expect(statValue("adminIntegrations.failed")).toBe("1");
    expect(statValue("adminIntegrations.dead")).toBe("2");
  });

  it("statusy NIEOBECNE w kolejce dają zero, a nie puste miejsce", async () => {
    // Prawe ramię każdego `counts[...] ?? 0`: karta bez liczby sugerowałaby,
    // że panel nie potrafi policzyć - a nie że nic tam nie ma.
    plan.deliveries = ok([{ status: "delivered" }]);
    await renderReady();

    expect(statValue("adminIntegrations.delivered")).toBe("1");
    expect(statValue("adminIntegrations.pending")).toBe("0");
    expect(statValue("adminIntegrations.failed")).toBe("0");
    expect(statValue("adminIntegrations.dead")).toBe("0");
  });
});

// ---------------------------------------------------------------------------
// 2. KLUCZ PODPISUJĄCY - najdroższa pomyłka tego ekranu.
// ---------------------------------------------------------------------------

describe("panel integracji - klucz podpisujący na liście", () => {
  it("klucz NIEUSTAWIONY (`secret_id: null`) jest powiedziany wprost", async () => {
    // Endpoint bez klucza wysyła dostawy BEZ podpisu - odbiorca nie umie
    // odróżnić ich od cudzych. Panel nie może tego przemilczeć.
    plan.list = ok([endpoint({ secret_id: null })]);
    await renderReady();

    expect(screen.getByText("adminIntegrations.secret")).toBeInTheDocument();
    expect(screen.queryByText("adminIntegrations.secretSet")).not.toBeInTheDocument();
  });

  it('klucz „ustawiony” pustym łańcuchem (`""`) też jest NIEUSTAWIONY', async () => {
    // Wartość fałszywa ale prawidłowa: `secret_id = ""` powstaje z ręcznej
    // edycji wiersza albo z migracji. Gdyby panel czytał samą OBECNOŚĆ kolumny,
    // pokazałby „ustawiony” dla endpointu, którego dispatcher wyśle bez podpisu.
    plan.list = ok([endpoint({ secret_id: "" })]);
    await renderReady();

    expect(screen.getByText("adminIntegrations.secret")).toBeInTheDocument();
    expect(screen.queryByText("adminIntegrations.secretSet")).not.toBeInTheDocument();
  });

  it("klucz USTAWIONY pokazuje plakietkę „ustawiony” - i ani znaku sekretu", async () => {
    plan.list = ok([endpoint({ secret_id: "vault-9999" })]);
    await renderReady();

    expect(screen.getByText("adminIntegrations.secretSet")).toBeInTheDocument();
    expect(screen.queryByText("adminIntegrations.secret")).not.toBeInTheDocument();
    // Identyfikator z Vault to nie sekret, ale i on nie ma po co być na ekranie.
    expect(document.body.textContent).not.toContain("vault-9999");
  });

  it("wiersz pokazuje nazwę, surowy rodzaj z bazy, adres i typy zdarzeń", async () => {
    plan.list = ok([
      endpoint({ integration: "slack", event_types: ["post.published.v1", "comment.created.v1"] }),
    ]);
    await renderReady();

    expect(screen.getByText("Zapier - kampanie")).toBeInTheDocument();
    // Plakietka niesie WARTOŚĆ Z BAZY (nie znormalizowaną) - inaczej wiersz
    // z rodzajem spoza enumu wyglądałby jak poprawny webhook.
    expect(screen.getByText("slack")).toBeInTheDocument();
    expect(screen.getByText("https://receiver.example.com/webhooks/nes")).toBeInTheDocument();
    expect(screen.getByText("post.published.v1")).toBeInTheDocument();
    expect(screen.getByText("comment.created.v1")).toBeInTheDocument();
    expect(screen.queryByText("adminIntegrations.allEvents")).not.toBeInTheDocument();
  });

  it("PUSTA lista zdarzeń mówi „wszystkie zdarzenia”, a nie nic", async () => {
    // `event_types: []` to najszerszy możliwy filtr - milczenie w tym miejscu
    // czytałoby się jako „endpoint nic nie dostaje”.
    plan.list = ok([endpoint({ event_types: [] })]);
    await renderReady();

    expect(screen.getByText("adminIntegrations.allEvents")).toBeInTheDocument();
  });

  it.each([
    { enabled: true, label: "adminIntegrations.enabled", other: "adminIntegrations.disabled" },
    { enabled: false, label: "adminIntegrations.disabled", other: "adminIntegrations.enabled" },
  ])(
    "stan włączenia `$enabled` jest nazwany słowem, nie samym przełącznikiem",
    async ({ enabled, label, other }) => {
      plan.list = ok([endpoint({ enabled })]);
      await renderReady();

      const row = screen.getByText("Zapier - kampanie").closest("li");
      if (!(row instanceof HTMLElement)) throw new Error("test: brak wiersza endpointu");
      expect(within(row).getByText(label)).toBeInTheDocument();
      expect(within(row).queryByText(other)).not.toBeInTheDocument();
      expect(within(row).getByRole("switch").getAttribute("aria-checked")).toBe(String(enabled));
    },
  );
});

// ---------------------------------------------------------------------------
// 3. OKNO EDYCJI - bramka zapisu i podpowiedzi zależne od adaptera.
// ---------------------------------------------------------------------------

describe("panel integracji - okno endpointu", () => {
  it("nowy endpoint startuje z pustej karty: webhook, włączony, bez sekretu", async () => {
    await renderReady();
    openNew();

    expect(within(dialog()).getByText("adminIntegrations.newEndpoint")).toBeInTheDocument();
    expect(adapterSelect().value).toBe("webhook");
    expect(within(dialog()).getByRole("switch").getAttribute("aria-checked")).toBe("true");
    expect(passwordInput().value).toBe("");
    expect(clearSecretCheckbox().checked).toBe(false);
  });

  it.each([
    { name: "", url: "https://receiver.example.com/hook", why: "nazwa pusta", canSave: false },
    {
      name: "a",
      url: "https://receiver.example.com/hook",
      why: "nazwa jednoznakowa",
      canSave: false,
    },
    {
      name: "  a  ",
      url: "https://receiver.example.com/hook",
      why: "nazwa jednoznakowa po obcięciu",
      canSave: false,
    },
    { name: "Odbiorca", url: "", why: "adres pusty", canSave: false },
    {
      name: "Odbiorca",
      url: "http://receiver.example.com/hook",
      why: "adres bez https",
      canSave: false,
    },
    {
      name: "Odbiorca",
      url: "receiver.example.com/hook",
      why: "adres bez schematu",
      canSave: false,
    },
    {
      name: "Odbiorca",
      url: "  https://x.example.com  ",
      why: "adres poprawny po obcięciu",
      canSave: true,
    },
    {
      name: "  ab  ",
      url: "HTTPS://x.example.com",
      why: "schemat wielkimi literami",
      canSave: true,
    },
  ])("bramka zapisu: $why", async ({ name, url, canSave }) => {
    // Pole martwe: zapis endpointu bez adresu https to konfiguracja, której
    // dispatcher nigdy nie wyśle (bramka SSRF wymaga https), a operator
    // dowiedziałby się o tym z ciszy odbiorcy.
    await renderReady();
    openNew();
    fillValid({ name, url });

    expect(saveButton().hasAttribute("disabled")).toBe(!canSave);
  });

  it("anulowanie zamyka okno i NIE zapisuje niczego", async () => {
    await renderReady();
    openNew();
    fillValid();
    fireEvent.click(within(dialog()).getByRole("button", { name: "adminIntegrations.cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(writeChains("insert")).toHaveLength(0);
  });

  it.each([
    {
      kind: "webhook",
      label: "adminIntegrations.webhookGenericJsonHmac",
      hint: "adminIntegrations.receiverGetsFullEventEnvelope",
      placeholder: "https://example.com/webhooks/nes",
    },
    {
      kind: "slack",
      // Nazwa produktu, nie napis do tłumaczenia - `kindLabel` trzyma ją
      // dosłownie (`admin.integrations.tsx:127`).
      label: "Slack (Block Kit)",
      hint: "adminIntegrations.pasteSlackIncomingWebhookUrl",
      placeholder: "https://hooks.slack.com/services/T000/B000/XXXX",
    },
    {
      kind: "hubspot",
      label: "HubSpot (CRM v3, kontakty)",
      hint: "adminIntegrations.urlApiBaseUsuallyHttps",
      placeholder: "https://api.hubapi.com",
    },
    {
      kind: "gcal",
      label: "adminIntegrations.googleCalendarGenericJson",
      hint: "adminIntegrations.receiverGetsFullEventEnvelope",
      placeholder: "https://example.com/webhooks/nes",
    },
    {
      kind: "confluence",
      label: "adminIntegrations.confluenceGenericJson",
      hint: "adminIntegrations.receiverGetsFullEventEnvelope",
      placeholder: "https://example.com/webhooks/nes",
    },
    {
      kind: "crm_partner",
      label: "adminIntegrations.crmPartnerLeadsConsents",
      hint: "adminIntegrations.crmPartnerEndpointLeadEvents",
      placeholder: "https://example.com/webhooks/nes",
    },
  ])(
    "adapter $kind: etykieta, podpowiedź i wzór adresu są jego własne",
    async ({ kind, label, hint, placeholder }) => {
      // Podpowiedź nie jest kosmetyką: dla Slacka adresem jest incoming webhook,
      // dla HubSpota BAZA API. Zła podpowiedź to endpoint, który nigdy nie
      // dostarczy - i pół dnia zgadywania po stronie operatora.
      await renderReady();
      openNew();
      fireEvent.change(adapterSelect(), { target: { value: kind } });

      expect(adapterSelect().value).toBe(kind);
      expect(within(dialog()).getByRole("option", { name: label })).toBeInTheDocument();
      expect(within(dialog()).getByText(hint)).toBeInTheDocument();
      expect(inputByLabel("URL").getAttribute("placeholder")).toBe(placeholder);
    },
  );

  it("lista adapterów pokrywa CAŁY enum produkcyjny - ani mniej, ani więcej", async () => {
    await renderReady();
    openNew();

    const values = Array.from(adapterSelect().options).map((option) => option.value);
    expect(values).toEqual([...INTEGRATION_KINDS]);
  });

  it("HubSpot nazywa sekret TOKENEM, pozostałe adaptery kluczem HMAC", async () => {
    // Te same pole i to samo RPC, ale zupełnie inna treść: token prywatnej
    // aplikacji vs klucz podpisujący. Zła etykieta to wklejony zły sekret.
    await renderReady();
    openNew();

    expect(within(dialog()).getByText("adminIntegrations.hmacSigningSecret")).toBeInTheDocument();
    expect(within(dialog()).getByText("adminIntegrations.secretLivesInVault")).toBeInTheDocument();
    expect(passwordInput().getAttribute("placeholder")).toBe("adminIntegrations.newSecret16Chars");

    fireEvent.change(adapterSelect(), { target: { value: "hubspot" } });

    expect(within(dialog()).getByText("adminIntegrations.accessTokenBearer")).toBeInTheDocument();
    expect(
      within(dialog()).getByText("adminIntegrations.hubspotPrivateAppTokenLives"),
    ).toBeInTheDocument();
    expect(passwordInput().getAttribute("placeholder")).toBe("pat-eu1-…");
  });

  it("pole sekretu jest polem HASŁA bez autouzupełniania - i nie trafia do listy", async () => {
    await renderReady();
    openNew();
    fireEvent.change(passwordInput(), { target: { value: FAKE_SECRET } });

    expect(passwordInput().getAttribute("type")).toBe("password");
    expect(passwordInput().getAttribute("autocomplete")).toBe("new-password");
    // Sekret istnieje WYŁĄCZNIE jako wartość pola - nigdzie w treści ekranu.
    expect(screen.queryByText(FAKE_SECRET)).not.toBeInTheDocument();
  });

  it("„wyczyść sekret” wyłącza pole wpisywania (i odwrotnie)", async () => {
    // Wzajemne wykluczenie: inaczej dałoby się jednym zapisem zażądać
    // „ustaw nowy” i „wyczyść” naraz, a wygrywałoby wyczyszczenie.
    await renderReady();
    openNew();
    fireEvent.change(passwordInput(), { target: { value: FAKE_SECRET } });
    fireEvent.click(clearSecretCheckbox());

    expect(clearSecretCheckbox().checked).toBe(true);
    expect(passwordInput().hasAttribute("disabled")).toBe(true);
    expect(passwordInput().value).toBe("");

    fireEvent.click(clearSecretCheckbox());
    fireEvent.change(passwordInput(), { target: { value: FAKE_SECRET } });

    expect(clearSecretCheckbox().checked).toBe(false);
    expect(passwordInput().value).toBe(FAKE_SECRET);
  });

  it("edycja wypełnia okno wierszem z bazy - typy zdarzeń jako lista po przecinku", async () => {
    plan.list = ok([
      endpoint({ event_types: ["post.published.v1", "crm_lead.created.v1"], enabled: false }),
    ]);
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "adminIntegrations.edit" }));

    expect(within(dialog()).getByText("adminIntegrations.editEndpoint")).toBeInTheDocument();
    expect(inputByLabel("adminIntegrations.name").value).toBe("Zapier - kampanie");
    expect(textareaByLabel("adminIntegrations.eventsCommaSpaceSeparated").value).toBe(
      "post.published.v1, crm_lead.created.v1",
    );
    expect(within(dialog()).getByRole("switch").getAttribute("aria-checked")).toBe("false");
    // Pole sekretu startuje PUSTE także przy edycji - panel nie zna plaintextu.
    expect(passwordInput().value).toBe("");
  });

  it("rodzaj SPOZA enumu z bazy otwiera się jako `webhook` - nieznana wartość nie wraca do bazy", async () => {
    // Wiersz z `integration = "zapier"` (ręczna edycja, starsza wersja
    // aplikacji) MUSI dać się otworzyć i poprawić. Lista wyboru bez zaznaczenia
    // wysłałaby do bazy pustkę albo nieznaną wartość.
    plan.list = ok([endpoint({ integration: "zapier" })]);
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "adminIntegrations.edit" }));

    expect(adapterSelect().value).toBe("webhook");

    fireEvent.click(saveButton());
    await waitFor(() => expect(writeChains("update")).toHaveLength(1));
    expect(payloadOf(writeChains("update").at(0), "update").integration).toBe("webhook");
  });
});

// ---------------------------------------------------------------------------
// 4. ŁADUNKI MUTACJI - co dokładnie leci do bazy i do Vault.
// ---------------------------------------------------------------------------

describe("panel integracji - ładunek zapisu", () => {
  it("NOWY endpoint: insert z obciętymi napisami, rozbitą listą zdarzeń i zwrotem `id`", async () => {
    await renderReady();
    openNew();
    fillValid({
      name: "  Odbiorca testowy  ",
      url: "  https://receiver.example.com/hook  ",
      events: " post.published.v1,  crm_lead.created.v1\ncrm_task.due.v1 ",
    });
    fireEvent.click(saveButton());

    await waitFor(() => expect(writeChains("insert")).toHaveLength(1));
    const chain = writeChains("insert").at(0);
    expect(payloadOf(chain, "insert")).toEqual({
      name: "Odbiorca testowy",
      integration: "webhook",
      url: "https://receiver.example.com/hook",
      event_types: ["post.published.v1", "crm_lead.created.v1", "crm_task.due.v1"],
      enabled: true,
    });
    // Wiersz zakłada trigger bazy (tenant_id/created_by) - panel NIE MA prawa
    // ich podawać, a `id` musi odczytać, żeby dołożyć sekret w Vault.
    expect(payloadOf(chain, "insert")).not.toHaveProperty("tenant_id");
    expect(payloadOf(chain, "insert")).not.toHaveProperty("created_by");
    expect(chain?.argsOf("select")).toEqual(["id"]);
    expect(chain?.has("single")).toBe(true);
    expect(secretRpcCalls()).toHaveLength(0);
  });

  it("PUSTA lista zdarzeń zapisuje się jako `[]` - najszerszy filtr, nie `null`", async () => {
    await renderReady();
    openNew();
    fillValid({ events: "   " });
    fireEvent.click(saveButton());

    await waitFor(() => expect(writeChains("insert")).toHaveLength(1));
    expect(payloadOf(writeChains("insert").at(0), "insert").event_types).toEqual([]);
  });

  it("endpoint WYŁĄCZONY zapisuje `enabled: false` - wartość fałszywa musi dojechać", async () => {
    // Klasyczny błąd paneli konfiguracji: `value || default` gubi `false`.
    await renderReady();
    openNew();
    fillValid();
    fireEvent.click(within(dialog()).getByRole("switch"));
    fireEvent.click(saveButton());

    await waitFor(() => expect(writeChains("insert")).toHaveLength(1));
    expect(payloadOf(writeChains("insert").at(0), "insert").enabled).toBe(false);
  });

  it("NOWY endpoint z sekretem: RPC Vault dostaje `id` z insertu i plaintext", async () => {
    plan.insert = ok({ id: "ep-created-42" });
    await renderReady();
    openNew();
    fillValid();
    fireEvent.change(passwordInput(), { target: { value: FAKE_SECRET } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(secretRpcCalls()).toHaveLength(1));
    expect(secretRpcCalls().at(0)?.name).toBe("integration_endpoint_set_secret");
    expect(secretRpcCalls().at(0)?.args).toEqual({
      _endpoint_id: "ep-created-42",
      _plaintext: FAKE_SECRET,
    });
    // Sekret NIE MA prawa jechać w kolumnie razem z resztą wiersza.
    expect(JSON.stringify(payloadOf(writeChains("insert").at(0), "insert"))).not.toContain(
      FAKE_SECRET,
    );
    expect(h.toastSuccess).toHaveBeenCalledWith("adminIntegrations.saved");
  });

  it("EDYCJA: update z `updated_at` i zawężeniem do jednego `id`, bez insertu", async () => {
    plan.list = ok([endpoint({ id: "ep-77" })]);
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "adminIntegrations.edit" }));
    fireEvent.change(screen.getByLabelText("adminIntegrations.name"), {
      target: { value: "Odbiorca po zmianie" },
    });
    fireEvent.click(saveButton());

    await waitFor(() => expect(writeChains("update")).toHaveLength(1));
    const chain = writeChains("update").at(0);
    expect(payloadOf(chain, "update")).toEqual({
      name: "Odbiorca po zmianie",
      integration: "webhook",
      url: "https://receiver.example.com/webhooks/nes",
      event_types: ["post.published.v1"],
      enabled: true,
      updated_at: BASE_ISO,
    });
    // Brak `.eq("id", ...)` to zapis na WSZYSTKICH endpointach tenanta.
    expect(chain?.argsOf("eq")).toEqual(["id", "ep-77"]);
    expect(writeChains("insert")).toHaveLength(0);
  });

  it("EDYCJA bez zmiany sekretu NIE woła RPC Vault - klucz zostaje jaki jest", async () => {
    plan.list = ok([endpoint()]);
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "adminIntegrations.edit" }));
    fireEvent.click(saveButton());

    await waitFor(() => expect(writeChains("update")).toHaveLength(1));
    expect(secretRpcCalls()).toHaveLength(0);
  });

  it("EDYCJA z zaznaczonym „wyczyść”: RPC dostaje PUSTY plaintext", async () => {
    // Puste `_plaintext` to umowa z RPC: usuń sekret z Vault. Wysłanie tam
    // czegokolwiek innego zostawiłoby endpoint z kluczem, który nikt nie zna.
    plan.list = ok([endpoint({ id: "ep-88" })]);
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "adminIntegrations.edit" }));
    fireEvent.click(clearSecretCheckbox());
    fireEvent.click(saveButton());

    await waitFor(() => expect(secretRpcCalls()).toHaveLength(1));
    expect(secretRpcCalls().at(0)?.args).toEqual({ _endpoint_id: "ep-88", _plaintext: "" });
  });

  it("sekret z samych spacji NIE jest zmianą sekretu", async () => {
    // Prawe ramię `d.new_secret.trim().length > 0`: spacje to pomyłka, nie
    // rotacja klucza - RPC Vault nie może dostać nic do zapisania.
    plan.list = ok([endpoint()]);
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "adminIntegrations.edit" }));
    fireEvent.change(passwordInput(), { target: { value: "   " } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(writeChains("update")).toHaveLength(1));
    expect(secretRpcCalls()).toHaveLength(0);
  });

  it("udany zapis zamyka okno, potwierdza i ODŚWIEŻA listę", async () => {
    await renderReady();
    const readsBefore = listReads().length;
    openNew();
    fillValid();
    fireEvent.click(saveButton());

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(h.toastSuccess).toHaveBeenCalledWith("adminIntegrations.saved");
    await waitFor(() => expect(listReads().length).toBeGreaterThan(readsBefore));
  });

  it("zapis w toku BLOKUJE przycisk - drugie kliknięcie tworzyłoby duplikat endpointu", async () => {
    // Odczyt tabeli wisi, więc mutacja zostaje w stanie „w toku” bez żadnego
    // `setTimeout`: `insert` nigdy się nie rozwiązuje.
    await renderReady();
    h.pendingTables.add(ENDPOINTS);
    openNew();
    fillValid();
    fireEvent.click(saveButton());

    await waitFor(() => expect(saveButton().hasAttribute("disabled")).toBe(true));
  });
});

// ---------------------------------------------------------------------------
// 5. ODMOWY ZAPISU - komunikat z klucza i18n, okno zostaje otwarte.
// ---------------------------------------------------------------------------

describe("panel integracji - odmowa zapisu", () => {
  it("odmowa bazy przy INSERCIE: komunikat z klucza i18n, okno NIE znika", async () => {
    plan.insert = fail("new row violates row-level security policy", "42501");
    await renderReady();
    openNew();
    fillValid();
    fireEvent.click(saveButton());

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith(
        "adminIntegrations.error(message=new row violates row-level security policy)",
      ),
    );
    // Zamknięcie okna zabrałoby operatorowi wpisaną konfigurację razem
    // z informacją, co poprawić.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("KLUCZ NIEPRAWIDŁOWY: odmowa RPC Vault daje komunikat z klucza i18n", async () => {
    // Najczęstsza odmowa tego RPC to sekret za krótki albo bez uprawnień do
    // tenanta. Panel musi to powiedzieć - „zapisano” po nieudanym zapisie
    // sekretu zostawia integrację, która wysyła bez podpisu.
    h.rpcError = new Error("integration secret must be at least 16 characters");
    await renderReady();
    openNew();
    fillValid();
    fireEvent.change(passwordInput(), { target: { value: FAKE_SECRET } });
    fireEvent.click(saveButton());

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith(
        "adminIntegrations.error(message=integration secret must be at least 16 characters)",
      ),
    );
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("odmowa BEZ `message` (kształt spoza `Error`) też ma komunikat, nie „[object Object]”", async () => {
    // Prawe ramię `e instanceof Error ? e.message : String(e)`. Vault/PostgREST
    // potrafi oddać wartość, która nie jest `Error` - a komunikat i tak musi
    // dojść do operatora.
    h.rpcError = "vault: forbidden";
    await renderReady();
    openNew();
    fillValid();
    fireEvent.change(passwordInput(), { target: { value: FAKE_SECRET } });
    fireEvent.click(saveButton());

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith(
        "adminIntegrations.error(message=vault: forbidden)",
      ),
    );
  });

  it("nieudany zapis sekretu NIE cofa utworzonego endpointu (kontrakt, nie życzenie)", async () => {
    // Panel nie ma transakcji obejmującej insert + RPC. Endpoint zostaje
    // utworzony BEZ klucza, więc następne wejście musi go pokazać jako
    // „sekret nieustawiony” - i pokazuje (plakietka ostrzegawcza wyżej).
    h.rpcError = new Error("permission denied for function integration_endpoint_set_secret");
    await renderReady();
    openNew();
    fillValid();
    fireEvent.change(passwordInput(), { target: { value: FAKE_SECRET } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(writeChains("insert")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 6. WIERSZ LISTY - przełącznik i usunięcie.
// ---------------------------------------------------------------------------

describe("panel integracji - przełącznik i usuwanie", () => {
  it("przełącznik wysyła `enabled` z `updated_at` i zawężeniem do wiersza", async () => {
    plan.list = ok([endpoint({ id: "ep-33", enabled: true })]);
    await renderReady();
    fireEvent.click(screen.getByRole("switch"));

    await waitFor(() => expect(writeChains("update")).toHaveLength(1));
    const chain = writeChains("update").at(0);
    expect(payloadOf(chain, "update")).toEqual({ enabled: false, updated_at: BASE_ISO });
    expect(chain?.argsOf("eq")).toEqual(["id", "ep-33"]);
  });

  it("wyłączony endpoint można włączyć z powrotem - `enabled: true` w ładunku", async () => {
    plan.list = ok([endpoint({ enabled: false })]);
    await renderReady();
    fireEvent.click(screen.getByRole("switch"));

    await waitFor(() => expect(writeChains("update")).toHaveLength(1));
    expect(payloadOf(writeChains("update").at(0), "update").enabled).toBe(true);
  });

  it("udane przełączenie ODŚWIEŻA listę - inaczej ekran kłamie do następnego wejścia", async () => {
    plan.list = ok([endpoint()]);
    await renderReady();
    const readsBefore = listReads().length;
    fireEvent.click(screen.getByRole("switch"));

    await waitFor(() => expect(listReads().length).toBeGreaterThan(readsBefore));
  });

  it("NIEUDANE przełączenie: żądanie poszło, a panel nie potwierdza sukcesu", async () => {
    // Zachowanie obserwowane (i tu udokumentowane): mutacja przełącznika nie ma
    // `onSuccess` z toastem, więc brak potwierdzenia jest normą - ale brak
    // KOMUNIKATU BŁĘDU normą nie jest, patrz `it.fails` niżej.
    plan.list = ok([endpoint()]);
    plan.write = fail("permission denied for table integration_endpoints", "42501");
    await renderReady();
    fireEvent.click(screen.getByRole("switch"));

    await waitFor(() => expect(writeChains("update")).toHaveLength(1));
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it.fails("DEFEKT: nieudane przełączenie MILCZY - brak `onError` w mutacji", async () => {
    // CO: `src/routes/admin.integrations.tsx:265-276` - `toggleEnabled` ma
    // wyłącznie `onSuccess`. Odmowa RLS nie daje ANI toastu, ANI śladu w UI.
    // KONSEKWENCJA: operator przestawia przełącznik, widzi krótkie mrugnięcie
    // i wraca do stanu poprzedniego bez słowa wyjaśnienia. Endpoint zostaje
    // włączony (dostawy dalej wychodzą) w przekonaniu, że został wyłączony -
    // przy wyłączaniu integracji po incydencie to jest różnica krytyczna.
    plan.list = ok([endpoint()]);
    plan.write = fail("permission denied for table integration_endpoints", "42501");
    await renderReady();
    fireEvent.click(screen.getByRole("switch"));
    await waitFor(() => expect(writeChains("update")).toHaveLength(1));

    expect(h.toastError, "nieudane przełączenie bez żadnego komunikatu").toHaveBeenCalled();
  });

  it("usunięcie PYTA o potwierdzenie z nazwą endpointu i dopiero potem kasuje", async () => {
    plan.list = ok([endpoint({ id: "ep-55", name: "Zapier - kampanie" })]);
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "adminIntegrations.delete" }));

    expect(h.confirmMessages).toEqual([
      "adminIntegrations.confirmDeleteEndpoint(name=Zapier - kampanie)",
    ]);
    await waitFor(() => expect(writeChains("delete")).toHaveLength(1));
    expect(writeChains("delete").at(0)?.argsOf("eq")).toEqual(["id", "ep-55"]);
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("adminIntegrations.endpointRemoved"),
    );
  });

  it("ODMOWA w oknie potwierdzenia nie kasuje niczego", async () => {
    h.confirmAnswer = false;
    plan.list = ok([endpoint()]);
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "adminIntegrations.delete" }));

    expect(h.confirmMessages).toHaveLength(1);
    expect(writeChains("delete")).toHaveLength(0);
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("nieudane usunięcie mówi o błędzie z klucza i18n", async () => {
    plan.list = ok([endpoint()]);
    plan.write = fail("update or delete on table violates foreign key constraint", "23503");
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "adminIntegrations.delete" }));

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith(
        "adminIntegrations.error(message=update or delete on table violates foreign key constraint)",
      ),
    );
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("odmowa usunięcia BEZ `message` też daje komunikat", async () => {
    // Prawe ramię `e instanceof Error ? e.message : String(e)` w `remove`.
    // Atrapa łańcucha ODRZUCA wartością spoza `Error` - dokładnie tak, jak
    // potrafi zrobić transport PostgREST.
    plan.list = ok([endpoint()]);
    db().setResponse(ENDPOINTS, (chain) => {
      if (chain.has("delete")) throw "postgrest: connection closed";
      return planFor(chain);
    });
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "adminIntegrations.delete" }));

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith(
        "adminIntegrations.error(message=postgrest: connection closed)",
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// 7. DISPATCHER Z PANELU - degradacja przy awarii usługi.
// ---------------------------------------------------------------------------

describe("panel integracji - ręczny dispatch", () => {
  it("wysyła partię o USTALONYM rozmiarze i raportuje wszystkie trzy liczby", async () => {
    h.dispatch.mockResolvedValue({ claimed: 5, delivered: 3, failed: 2 });
    await renderReady();
    const deliveryReadsBefore = db().chainsFor(DELIVERIES).length;
    fireEvent.click(screen.getByRole("button", { name: "adminIntegrations.runDispatcher" }));

    await waitFor(() => expect(h.dispatch).toHaveBeenCalledWith({ data: { limit: 50 } }));
    // Liczba nieudanych dostaw MUSI być w komunikacie - „wysłano 3” bez „błędy:
    // 2" byłoby fałszywym sukcesem.
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith(
        "adminIntegrations.dispatchSummary(claimed=5,delivered=3,failed=2)",
      ),
    );
    await waitFor(() =>
      expect(db().chainsFor(DELIVERIES).length).toBeGreaterThan(deliveryReadsBefore),
    );
  });

  it("pusta kolejka to też wynik: zera w komunikacie, bez błędu", async () => {
    h.dispatch.mockResolvedValue({ claimed: 0, delivered: 0, failed: 0 });
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "adminIntegrations.runDispatcher" }));

    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith(
        "adminIntegrations.dispatchSummary(claimed=0,delivered=0,failed=0)",
      ),
    );
    expect(h.toastError).not.toHaveBeenCalled();
  });

  it("dispatch W TOKU blokuje przycisk - równoległe partie biją się o te same dostawy", async () => {
    // Obietnica, która nigdy się nie rozwiązuje - stan „w toku” bez timerów.
    h.dispatch.mockImplementation(() => new Promise(() => undefined));
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "adminIntegrations.runDispatcher" }));

    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: "adminIntegrations.runDispatcher" })
          .hasAttribute("disabled"),
      ).toBe(true),
    );
  });

  it.each([
    {
      why: "usługa odpowiada 5xx",
      error: new Error("integration dispatch: claim failed (HTTP 503 upstream)"),
      message: "integration dispatch: claim failed (HTTP 503 upstream)",
    },
    {
      why: "żądanie przerwane po przekroczeniu czasu",
      error: (() => {
        const err = new Error("The operation was aborted");
        err.name = "AbortError";
        return err;
      })(),
      message: "The operation was aborted",
    },
    {
      why: "odmowa bez `message`",
      error: "dispatcher unavailable",
      message: "dispatcher unavailable",
    },
  ])(
    "awaria dispatchera ($why) degraduje się do komunikatu, BEZ toastu sukcesu",
    async ({ error, message }) => {
      // Deterministycznie: atrapa transportu odrzuca NATYCHMIAST. W tym pliku nie
      // ma ani jednego `setTimeout` - „timeout” to odrzucenie, nie czekanie.
      h.dispatch.mockRejectedValue(error);
      await renderReady();
      fireEvent.click(screen.getByRole("button", { name: "adminIntegrations.runDispatcher" }));

      await waitFor(() =>
        expect(h.toastError).toHaveBeenCalledWith(
          `adminIntegrations.dispatcherError(message=${message})`,
        ),
      );
      expect(h.toastSuccess).not.toHaveBeenCalled();
      // Przycisk wraca do stanu gotowości - awaria nie może zablokować ekranu.
      await waitFor(() =>
        expect(
          screen
            .getByRole("button", { name: "adminIntegrations.runDispatcher" })
            .hasAttribute("disabled"),
        ).toBe(false),
      );
    },
  );

  it("awaria dispatchera NIE unieważnia podsumowania kolejki", async () => {
    // Kontrakt: przy błędzie liczniki zostają takie, jakie były - odświeżenie
    // po nieudanym dispatchu udawałoby, że coś się jednak przeliczyło.
    h.dispatch.mockRejectedValue(new Error("HTTP 500"));
    await renderReady();
    const before = db().chainsFor(DELIVERIES).length;
    fireEvent.click(screen.getByRole("button", { name: "adminIntegrations.runDispatcher" }));

    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(db().chainsFor(DELIVERIES).length).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// 8. NAGŁÓWEK TRASY.
// ---------------------------------------------------------------------------

describe("panel integracji - nagłówek trasy", () => {
  it("panel jest `noindex, nofollow` i ma tytuł panelu, nie tytuł publiczny", async () => {
    // Adresy endpointów i nazwy odbiorców to mapa integracji tenanta - ekran
    // zaindeksowany oddaje ją wyszukiwarce.
    const meta = await routeMeta(IntegrationsRoute);
    const robots = meta.find((entry) => entry.name === "robots");
    expect(robots?.content).toBe("noindex, nofollow");
    const titles = meta
      .map((entry) => entry.title)
      .filter((title): title is string => typeof title === "string");
    expect(titles).toHaveLength(1);
    expect(titles[0]).toMatch(/Admin/);
  });
});

// ---------------------------------------------------------------------------
// GAŁĘZIE NIEOSIĄGALNE Z INTERFEJSU - udokumentowane, nie naciągane.
//
// 1. `nullifyEmpty(draft.name) ?? ""` (`admin.integrations.tsx:625`): prawe
//    ramię `??` (i fałszywe ramię `t.length > 0 ? t : null` w `nullifyEmpty`,
//    linia 112) wymaga PUSTEJ nazwy w chwili kliknięcia „Zapisz”. Bramka
//    `canSave` (linia 502) wymaga jednak nazwy o długości >= 2 po obcięciu,
//    a wyłączony przycisk nie wywołuje `onSave`. Ta gałąź jest nieosiągalna
//    z interfejsu i pozostaje bez testu świadomie - test wywołujący `onSave`
//    w obejściu bramki dowodziłby zachowania, którego użytkownik nie ma jak
//    wywołać.
// 2. `onOpenChange={(o) => (o ? undefined : setDraft(null))}` (linia 505):
//    ramię `o === true` wymaga otwarcia okna PRZEZ komponent Radiksa
//    (`DialogTrigger`), a to okno jest w pełni sterowane stanem trasy i żadnego
//    triggera nie ma. Zamknięcie (`o === false`) jest pokryte testem
//    anulowania.
// ---------------------------------------------------------------------------
