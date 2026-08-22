// Rodzina tras `/admin/organizations*` ZAMONTOWANA - stan i sklejenie.
//
// CO TEN PLIK DOWODZI - I DLACZEGO NIE JEST FARMĄ POKRYCIA.
//
// `src/routes/__tests__/adminRouteAuthority.gate.test.ts` argumentuje wprost,
// że render-testowanie tras panelu DLA POKRYCIA jest farmą: ryzyko w trasie
// panelu to DOSTĘP, a dostęp jest egzekwowany w trzech miejscach (wspólny
// layout `/admin`, sama trasa, RLS/RPC w bazie). Ta bramka ma rację i rodzina
// `admin.organizations.*` jest w jej zakresie (wzorzec C: autorytet w bazie) -
// bramka wskazuje TEN plik jako miejsce na STAN i SKLEJENIE tych trzech tras.
//
// Ten plik pokrywa więc dokładnie to, czego bramka statyczna NIE WIDZI, bo
// widzi tylko tekst pliku. Przedmiotem dowodu jest tu MULTI-TENANT W
// INTERFEJSIE: organizacja członkowska to pakiet praw sprzedany offline, z
// wieloma kontami-miejscami, a panel jest jedynym miejscem, z którego się nim
// zarządza.
//
//   1. ORGANIZACJA, KTÓREJ NIE MA (albo której NIE ODDAŁA BAZA, bo należy do
//      innego najemcy) - karta musi ODMÓWIĆ, a nie pokazać pustego formularza
//      nad `id` z adresu. Autorytet jest w RLS (`orgs admin all`: najemca
//      sesji + rola `admin`); tutaj dowodzimy, że panel NIE DOKŁADA obok
//      niego własnego źródła danych i nie pokazuje niczego, czego zapytanie
//      nie oddało (zbiór odpytanych tabel jest asercją).
//   2. KSZTAŁT ZAPYTAŃ, nie wynik: `select("*")`, `eq("id", …)`,
//      `order("created_at", …)`, `limit(200)`, `maybeSingle()` - kolejność i
//      argumenty ogniw. Zawężenie najemcą NIE MA prawa być po stronie klienta
//      (byłoby do obejścia w konsoli), więc asercja mówi też, czego w
//      łańcuchu być NIE MOŻE.
//   3. STAN PUSTY vs STAN BŁĘDU - rozdzielone. To klasa defektu, która w tym
//      repo wystąpiła już trzy razy: awaria odczytu pokazana jako „brak
//      wyników” mówi administratorowi, że baza jest pusta, kiedy jest zepsuta.
//      W tej rodzinie występuje CZTERY razy naraz: dwa odczyty listy
//      (organizacje, miejsca w karcie na liście) i dwa odczyty karty
//      (organizacja, miejsca w zakładce). Zgłoszone `it.fails` są DWA - oba
//      na karcie, bo tam awaria wygląda raz na „wczytywanie bez końca”,
//      a raz na „nie ma jeszcze miejsc”, i oba mają kontrolę dodatnią
//      przypinającą stan faktyczny. Naprawa wszystkich czterech miejsc jest
//      JEDNĄ pracą nad warunkiem renderu w tej rodzinie - stąd nie mnożymy
//      zgłoszeń tego samego defektu.
//   4. ŁADUNEK KAŻDEJ MUTACJI: co dokładnie leci do bazy (`insert`, `update`,
//      `delete`, RPC `org_add_seat`) i do funkcji serwerowych miejsc.
//      W szczególności: `?? DEFAULT` kontra `|| DEFAULT` na wartościach
//      FAŁSZYWYCH ALE PRAWIDŁOWYCH (`0`, `""`) - limit karencji `0` znaczy
//      „odcięcie natychmiast”, a nie „wartość domyślna 7 dni”.
//   5. ODMOWA Z BAZY (`42501`, `orgs: not allowed`) - co widzi administrator
//      i czy cache NIE został unieważniony (nieudany zapis nie może udawać
//      udanego przez odświeżenie listy).
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - AUTORYTETU BAZY. RLS `orgs admin all` / `seats admin all` (najemca sesji
//   + `has_role(admin)`) i RPC `org_add_seat` (uwierzytelnienie, poprawność
//   roli, format adresu, istnienie organizacji, jej aktywność, limit miejsc,
//   unikalność) mają pokrycie pgTAP i osobną bramkę izolacji najemcy
//   (`rls_tenant_isolation_test.sql`, `tenant_isolation_three_tenants_test.sql`).
//   Test na atrapie nie odtwarza tych reguł - sprawdza, czy panel WOŁA to,
//   co ma wołać, z jakimi argumentami, i co robi z odmową.
// - CZYSTEJ LOGIKI MIEJSC. `clampSeats`, `seatsAtRisk`, `summarizeSeats`,
//   `clampGraceDays`, `parseReminderDays`, `normalizeReminderDays` mają własny
//   plik (`src/lib/organizations/__tests__/`); tutaj są PRAWDZIWE (nie atrapy),
//   bo przedmiotem dowodu jest ich SKLEJENIE z panelem - co panel pokazuje
//   przed zapisem i co wysyła po kliknięciu.
// - WARSTWY SERWEROWEJ MIEJSC. `setTeamSeatLimit`, `setTeamSeatGraceDays`,
//   `setTeamSeatGraceReminderDays`, `runSeatGraceExpiry`,
//   `runSeatGraceReminders` to funkcje serwerowe z własnymi bramkami roli i
//   testami (`teamSeats.functions`); tu są atrapami-rejestratorami, a dowodem
//   jest ŁADUNEK i obsługa `{ ok: false, error }`.
// - ORGANIZMÓW: `ImageSlot` (wysyłka plików do storage) i `AdminColorPicker`
//   (parser HEX/RGB/HSL) mają własne testy; tu są atrapami zapisującymi
//   propsy, bo przedmiotem dowodu jest to, KTÓRE pole draftu dostaje wartość
//   i czy wyczyszczenie pola zapisuje `null`, a nie `""`.
//
// DEFEKTY ZNALEZIONE I ZGŁOSZONE `it.fails` (produkcja bez zmian - przyjęta
// konwencja repo): PIĘĆ, każdy z opisem, miejscem i konsekwencją przy swoim
// teście, każdy z kontrolą dodatnią przypinającą stan faktyczny obok.
//   - dwie reguły sluga w jednym panelu (sekcja 2),
//   - organizacja, której baza nie oddała, zostaje na „wczytywanie” na zawsze
//     (komunikat `organizationFound` jest kodem martwym) - sekcja 3,
//   - awaria odczytu miejsc pokazana jako „nie ma jeszcze miejsc” - sekcja 3,
//   - „domknij zaległe” i „wyślij przypomnienia” z karty JEDNEJ organizacji
//     działają na wszystkich (ładunek bez `org_id`) - sekcja 3,
//   - zapis danych ogólnych cofa liczbę miejsc ustawioną funkcją serwerową
//     (draft z chwili wczytania nadpisuje kolumny miejsc) - sekcja 3.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { RecordedChain, SupabaseFromStub, SupabaseResult } from "@/test/supabaseChain";
import type { OrganizationRow, OrgSeatRow } from "@/lib/admin/membership-admin";

// ---------------------------------------------------------------------------
// Kształty odpowiedzi funkcji serwerowych miejsc. Atrapa musi je nieść
// dokładnie tak, jak produkcja, bo panel czyta `res.ok` ORAZ pola wyniku
// (`seatsLimit`, `suspended`, `graceDays`, `expired`, `days`, `sent`) i wkłada
// je do komunikatów - test na luźnym kształcie „dowodziłby” komunikatu, który
// w produkcji pokaże `undefined`.
// ---------------------------------------------------------------------------
interface ServerFail {
  ok: false;
  error: string;
}
interface SeatLimitOk {
  ok: true;
  seatsLimit: number;
  active: number;
  grace: number;
  suspended: number;
  source: string;
  providerSynced: boolean;
}
interface GraceOk {
  ok: true;
  graceDays: number;
  seatsLimit: number;
  active: number;
  grace: number;
  suspended: number;
}
interface ExpiryOk {
  ok: true;
  expired: number;
  notified: number;
}
interface ReminderDaysOk {
  ok: true;
  days: number[];
}
interface RemindersOk {
  ok: true;
  sent: number;
}

/** Ustalona data bazowa - żadnego `Date.now()`, `Math.random()` ani `setTimeout`. */
const BASE_ISO = "2026-01-15T10:00:00.000Z";
const OLDER_ISO = "2025-06-01T08:30:00.000Z";
/** Koniec karencji miejsca ponad limit - stała, żeby asercja daty była pewna. */
const GRACE_ISO = "2026-02-01T12:00:00.000Z";

const IDS = {
  tenant: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  org: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  /** Organizacja INNEGO NAJEMCY - RLS jej nie oddaje, panel jej nie widzi. */
  foreignOrg: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  createdOrg: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  seatOwner: "e1111111-1111-4111-8111-111111111111",
  seatMember: "e2222222-2222-4222-8222-222222222222",
  seatThird: "e3333333-3333-4333-8333-333333333333",
  admin: "f0000000-0000-4000-8000-000000000000",
  crmCompany: "f1111111-1111-4111-8111-111111111111",
} as const;

/**
 * Wyniki funkcji serwerowych miejsc W JEDNYM MIEJSCU i z JAWNYMI uniami.
 *
 * DLACZEGO OSOBNY TYP, A NIE ADNOTACJA NA STAŁEJ. `const x: Ok | Fail = { ok:
 * true, ... }` NIE daje pola typu unii: TypeScript zawęża stałą do typu jej
 * inicjalizatora, więc w zwróconym obiekcie `vi.hoisted` pole miało typ
 * `Ok` - i każde `h.xResult = { ok: false, error }` w teście oblewało `tsc`
 * („Type 'false' is not assignable to type 'true'”). Rozwiązaniem NIE jest
 * rzutowanie w teście (to by tylko schowało problem), a nazwany typ stanu:
 * pola rozłożone z niego (`...serverResults`) zachowują pełną unię.
 */
interface ServerResults {
  seatLimitResult: SeatLimitOk | ServerFail;
  graceResult: GraceOk | ServerFail;
  expiryResult: ExpiryOk | ServerFail;
  reminderDaysResult: ReminderDaysOk | ServerFail;
  remindersResult: RemindersOk | ServerFail;
}

const h = vi.hoisted(() => {
  const serverResults: ServerResults = {
    seatLimitResult: {
      ok: true,
      seatsLimit: 8,
      active: 8,
      grace: 0,
      suspended: 1,
      source: "manual",
      providerSynced: false,
    },
    graceResult: { ok: true, graceDays: 14, seatsLimit: 5, active: 5, grace: 1, suspended: 0 },
    expiryResult: { ok: true, expired: 2, notified: 2 },
    reminderDaysResult: { ok: true, days: [7, 1] },
    remindersResult: { ok: true, sent: 3 },
  };
  return {
    /** Język interfejsu - trasy czytają go WPROST z `i18n.language`. */
    lang: "pl" as string,
    /** Atrapa łańcucha PostgREST, ustawiana w `beforeEach`. */
    db: null as SupabaseFromStub | null,
    /**
     * Tabele, których zapytanie NIGDY się nie rozwiązuje. Wspólna atrapa
     * (`supabaseFromStub`) rozwiązuje się natychmiast - i to jest właściwe
     * domyślne zachowanie - ale stan „w toku” (wczytywanie listy, zapis
     * zablokowany w trakcie) inaczej byłby nieosiągalny bez zegara.
     */
    hangTables: new Set<string>(),
    /** To samo dla RPC - `org_add_seat` w locie blokuje przycisk. */
    hangRpc: new Set<string>(),
    /**
     * To samo dla FUNKCJI SERWEROWYCH miejsc. Bez tego stan „zapis w toku”
     * jest w zakładce Miejsca NIEOSIĄGALNY: atrapa rozwiązuje się od razu,
     * a przejście `useMutation` do stanu `isPending` dochodzi do drzewa
     * dopiero mikrozadaniem (`notifyManager`), więc asercja postawiona zaraz
     * po kliknięciu nie zobaczy zablokowanego przycisku, choćby produkcja
     * blokowała go poprawnie.
     */
    hangServer: new Set<string>(),
    rpcCalls: [] as { name: string; args: Record<string, unknown> }[],
    rpcResponses: new Map<string, () => SupabaseResult>(),
    /**
     * Konto w sesji - `created_by` w ładunku tworzenia organizacji. Wartość
     * ustawia `beforeEach` (`IDS.admin`); fabryka `vi.hoisted` biegnie PRZED
     * stałymi pliku, więc nie może się do nich odwołać.
     */
    sessionUserId: null as string | null,
    /** Sesja, która nigdy nie odpowiada - zapis zostaje „w toku”. */
    sessionHangs: false,
    toastSuccess: vi.fn(),
    toastError: vi.fn(),
    /** Odpowiedź natywnego `confirm` (happy-dom go nie implementuje). */
    confirmAnswer: true,
    confirmMessages: [] as string[],
    /** Przejścia zlecone przez trasy (`useNavigate`). */
    navigations: [] as { to: string; params?: Record<string, unknown> }[],
    /** Wywołania funkcji serwerowych miejsc: nazwa + surowy ładunek. */
    serverCalls: [] as { fn: string; payload: unknown }[],
    ...serverResults,
    /** Propsy zapisane przez atrapy organizmów (`ImageSlot`, kolory). */
    props: [] as { name: string; props: Record<string, unknown> }[],
  };
});

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.lang),
);
vi.mock("@/lib/i18n-admin-organizations", () => ({ ensureI18n: () => undefined }));
vi.mock("sonner", () => ({
  toast: { success: h.toastSuccess, error: h.toastError },
}));

vi.mock("@/integrations/supabase/client", async () => {
  const { fail } = await import("@/test/supabaseChain");
  /** Łańcuch, który NIGDY się nie rozwiązuje - stan „zapytanie w toku”. */
  const hangingChain = (): Record<string, unknown> => {
    const builder: Record<string, unknown> = {};
    for (const link of ["select", "insert", "update", "delete", "eq", "order", "limit"]) {
      builder[link] = () => builder;
    }
    for (const terminal of ["single", "maybeSingle"]) {
      builder[terminal] = () => new Promise<never>(() => {});
    }
    builder.then = () => new Promise<never>(() => {});
    return builder;
  };
  return {
    supabase: {
      from: (table: string) => {
        if (h.hangTables.has(table)) return hangingChain();
        if (!h.db) throw new Error("test: atrapa bazy nieustawiona");
        return h.db.from(table);
      },
      rpc: (name: string, args?: Record<string, unknown>) => {
        h.rpcCalls.push({ name, args: args ?? {} });
        if (h.hangRpc.has(name)) return new Promise<never>(() => {});
        const responder = h.rpcResponses.get(name);
        // Brak zaplanowanej odpowiedzi to BŁĄD TESTU, nie ciche `null`:
        // milcząca pustka udawałaby poprawne wywołanie RPC, którego test
        // nie zaplanował.
        return Promise.resolve(
          responder ? responder() : fail(`test: brak zaplanowanej odpowiedzi RPC ${name}`),
        );
      },
      auth: {
        // `createOrganization` czyta `created_by` z sesji lokalnej (bez
        // round-tripu do Auth API) - atrapa musi nieść ten sam kształt.
        getSession: () =>
          h.sessionHangs
            ? new Promise<never>(() => {})
            : Promise.resolve({
                data: {
                  session: h.sessionUserId ? { user: { id: h.sessionUserId } } : null,
                },
                error: null,
              }),
      },
    },
  };
});

// Harness montuje JEDNĄ trasę, a wszystkie trzy ekrany przenoszą na trasę
// rodzeństwa - więc przedmiotem dowodu są ARGUMENTY przejścia, nie rozwiązanie
// adresu (to należy do generatora drzewa tras).
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useNavigate: () => (options: { to: string; params?: Record<string, unknown> }) => {
      h.navigations.push(options);
      return Promise.resolve();
    },
  };
});

// Podmieniamy TYLKO `useServerFn` - resztę pakietu zostawiamy prawdziwą.
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useServerFn: (fn: unknown) => fn,
}));

vi.mock("@/lib/organizations/teamSeats.functions", () => {
  /**
   * Zapisz wywołanie i oddaj wynik - albo NIE oddawaj go wcale, gdy test
   * postawił nazwę w `hangServer` (stan „zapis w toku”, patrz komentarz przy
   * tym zbiorze). Ładunek zapisujemy SUROWY, przed jakąkolwiek interpretacją.
   */
  function record<T>(fn: string, payload: unknown, result: () => T): Promise<T> {
    h.serverCalls.push({ fn, payload });
    if (h.hangServer.has(fn)) return new Promise<never>(() => {});
    return Promise.resolve(result());
  }
  return {
    setTeamSeatLimit: (payload: unknown) =>
      record("setTeamSeatLimit", payload, () => h.seatLimitResult),
    setTeamSeatGraceDays: (payload: unknown) =>
      record("setTeamSeatGraceDays", payload, () => h.graceResult),
    setTeamSeatGraceReminderDays: (payload: unknown) =>
      record("setTeamSeatGraceReminderDays", payload, () => h.reminderDaysResult),
    // Domknięcie karencji woła się BEZ argumentu - atrapa musi to znieść.
    runSeatGraceExpiry: (payload?: unknown) =>
      record("runSeatGraceExpiry", payload, () => h.expiryResult),
    runSeatGraceReminders: (payload: unknown) =>
      record("runSeatGraceReminders", payload, () => h.remindersResult),
  };
});

// Radix Select/Switch/Tabs nie działają pod happy-dom bez pełnego pointer API.
// Podmieniamy je na natywne odpowiedniki: przedmiotem dowodu jest to, KTÓRE
// opcje trasa wystawia i CO robi ze zmianą, nie mechanika biblioteki.
vi.mock("@/components/ui/select", async () =>
  (await import("@/test/reactStubs")).radixSelectStub(await import("react")),
);
vi.mock("@/components/ui/switch", async () =>
  (await import("@/test/reactStubs")).radixSwitchStub(await import("react")),
);
vi.mock("@/components/ui/tabs", async () =>
  (await import("@/test/reactStubs")).radixTabsStub(await import("react")),
);

/**
 * Atrapa gniazda obrazu. Renderuje POLE TEKSTOWE, bo w tym pliku dowodzimy
 * wyłącznie tego, które pole draftu dostaje adres i czy wyczyszczenie pola
 * zapisuje `null`, a nie `""` (wysyłka do storage ma własny test).
 */
vi.mock("@/components/admin/ImageSlot", () => ({
  ImageSlot: ({
    label,
    value,
    onChange,
    folder,
    hint,
  }: {
    label: string;
    value: string;
    onChange: (next: string) => void;
    folder?: string;
    hint?: string;
  }) => {
    h.props.push({ name: "ImageSlot", props: { label, value, folder, hint } });
    return (
      <input
        data-testid="image-slot"
        data-folder={folder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  },
}));

/**
 * Atrapa selektora kolorów. Dwie kontrolki, bo produkcja ma dwie ścieżki:
 * WPISANIE wartości (`onChange(hex)`) i RESET do wartości dziedziczonej
 * (`onChange(undefined)`) - a to ta druga decyduje, czy w bazie wyląduje
 * `null` (dziedziczenie) czy `""` (kolor „pusty”).
 */
vi.mock("@/components/admin/blocks/AdminColorPicker", () => ({
  AdminColorPicker: ({
    value,
    onChange,
    inheritedValue,
    ariaLabel,
  }: {
    value: string | undefined;
    onChange: (next: string | undefined) => void;
    inheritedValue?: string;
    ariaLabel?: string;
  }) => {
    h.props.push({ name: "AdminColorPicker", props: { value, inheritedValue, ariaLabel } });
    return (
      <span data-inherited={inheritedValue}>
        <input
          aria-label={ariaLabel}
          value={value ?? ""}
          onChange={(event) => onChange(event.target.value)}
        />
        <button type="button" data-reset={ariaLabel} onClick={() => onChange(undefined)} />
      </span>
    );
  },
}));

import { fail, ok, supabaseFromStub } from "@/test/supabaseChain";
import { membershipTier } from "@/test/admin/pricingFixtures";
import { renderRoute, type RenderedRoute } from "@/test/routeHarness";
import { Route as OrgListRoute } from "@/routes/admin.organizations";
import { Route as OrgDetailRoute } from "@/routes/admin.organizations.$id";
import { Route as OrgNewRoute } from "@/routes/admin.organizations.new";

// ---------------------------------------------------------------------------
// Fixture'y. RODO: żadnych realnych danych - adresy wyłącznie w domenach
// `example.com`/`example.org`, nazwy organizacji umowne.
// ---------------------------------------------------------------------------

function orgRow(overrides: Partial<OrganizationRow> = {}): OrganizationRow {
  return {
    id: IDS.org,
    tenant_id: IDS.tenant,
    name: "Instytut Umowny",
    slug: "instytut-umowny",
    tier_key: "corporate",
    seats_limit: 5,
    seats_source: "manual",
    seats_grace_days: 7,
    seats_grace_reminder_days: [7, 1],
    status: "active",
    contact_email: "kontakt@example.org",
    description: "Organizacja testowa.",
    website_url: "https://example.org",
    sector: "Energetyka",
    city: "Bruksela",
    country: "Belgia",
    note: "Notatka wewnętrzna.",
    brand_primary: "#0F3460",
    brand_accent: "#E94560",
    brand_ink: "#141414",
    logo_h_light: null,
    logo_h_dark: null,
    logo_v_light: null,
    logo_v_dark: null,
    logo_favicon: null,
    crm_company_id: null,
    provider_subscription_id: null,
    created_at: BASE_ISO,
    updated_at: BASE_ISO,
    created_by: IDS.admin,
    starts_at: BASE_ISO,
    expires_at: null,
    ...overrides,
  };
}

function seatRow(overrides: Partial<OrgSeatRow> = {}): OrgSeatRow {
  return {
    id: IDS.seatMember,
    tenant_id: IDS.tenant,
    org_id: IDS.org,
    invited_email: "czlonek@example.org",
    user_id: null,
    role: "member",
    status: "active",
    claimed_at: null,
    created_at: BASE_ISO,
    grace_until: null,
    invited_by: IDS.admin,
    last_invited_at: null,
    suspended_at: null,
    suspended_reason: null,
    ...overrides,
  };
}

/** Warstwa organizacyjna - ranga >= 30 (korporacja / partner strategiczny). */
const CORPORATE_TIER = membershipTier({
  id: "tier-corporate",
  key: "corporate",
  name_pl: "Członkostwo korporacyjne",
  name_en: "Corporate membership",
  rank: 30,
});
const PARTNER_TIER = membershipTier({
  id: "tier-partner",
  key: "partner",
  name_pl: "Partner strategiczny",
  name_en: "Strategic partner",
  rank: 40,
});
/** Warstwa indywidualna - ranga < 30, czyli spoza oferty organizacyjnej. */
const MEMBER_TIER = membershipTier({
  id: "tier-member",
  key: "member",
  name_pl: "Członek",
  name_en: "Member",
  rank: 10,
});

// ---------------------------------------------------------------------------
// Strażniki i odczyty. Zamiast rzutowań: warunek sprawdzany w RUNTIME, który
// dopiero wtedy zawęża typ (wzorzec z `src/test/routeHarness.tsx`).
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function db(): SupabaseFromStub {
  if (!h.db) throw new Error("test: atrapa bazy nieustawiona");
  return h.db;
}

/** Ładunek pierwszego ogniwa `insert`/`update` w OSTATNIM łańcuchu tabeli. */
function payloadOf(table: string, method: "insert" | "update"): Record<string, unknown> {
  const chain = db()
    .chainsFor(table)
    .filter((entry) => entry.has(method))
    .at(-1);
  const first = chain?.argsOf(method)?.[0];
  if (!isRecord(first)) {
    throw new Error(`test: brak ładunku ${method} dla tabeli ${table}`);
  }
  return first;
}

/** Łańcuchy zapisu (insert/update/delete) dla tabeli - do asercji „nic nie poszło”. */
function writeChains(table: string): RecordedChain[] {
  return db()
    .chainsFor(table)
    .filter((chain) => chain.has("insert") || chain.has("update") || chain.has("delete"));
}

/** Łańcuchy CZYTAJĄCE tabelę - licznik odświeżeń po unieważnieniu cache. */
function readChains(table: string): RecordedChain[] {
  return db()
    .chainsFor(table)
    .filter((chain) => chain.has("select") && !chain.has("insert") && !chain.has("update"));
}

/** Zbiór tabel, o które trasa w ogóle zapytała - dowód „bez drugiego źródła”. */
function touchedTables(): string[] {
  return [...new Set(db().chains.map((chain) => chain.table))].sort();
}

function setRpc(name: string, result: SupabaseResult | (() => SupabaseResult)): void {
  h.rpcResponses.set(name, typeof result === "function" ? result : () => result);
}

/** Ładunek `{ data }` OSTATNIEGO wywołania funkcji serwerowej miejsc. */
function serverData(fn: string): Record<string, unknown> {
  const call = h.serverCalls.filter((entry) => entry.fn === fn).at(-1);
  if (!call) throw new Error(`test: funkcja serwerowa ${fn} nie została wywołana`);
  if (!isRecord(call.payload) || !isRecord(call.payload.data)) {
    throw new Error(`test: ${fn} wywołane bez ładunku { data }`);
  }
  return call.payload.data;
}

/** Ostatni komunikat sukcesu / błędu przekazany do toastów. */
function lastToast(kind: "success" | "error"): string {
  const mock = kind === "success" ? h.toastSuccess : h.toastError;
  const call = mock.mock.calls.at(-1);
  const first = call?.[0];
  if (typeof first !== "string") throw new Error(`test: brak toastu ${kind}`);
  return first;
}

function button(name: string): HTMLButtonElement {
  const element = screen.getByRole("button", { name });
  if (!(element instanceof HTMLButtonElement)) {
    throw new Error(`test: „${name}” nie jest przyciskiem`);
  }
  return element;
}

function inputs(scope: ParentNode = document): HTMLInputElement[] {
  return Array.from(scope.querySelectorAll<HTMLInputElement>("input"));
}

function textareas(scope: ParentNode = document): HTMLTextAreaElement[] {
  return Array.from(scope.querySelectorAll<HTMLTextAreaElement>("textarea"));
}

function selects(scope: ParentNode = document): HTMLSelectElement[] {
  return Array.from(scope.querySelectorAll<HTMLSelectElement>("select"));
}

function type(element: HTMLElement, value: string): void {
  fireEvent.change(element, { target: { value } });
}

function bodyText(): string {
  return document.body.textContent ?? "";
}

/** Lista miejsc (`<ul>`) - zakres dla plakietek roli i statusu. */
function seatList(): HTMLElement {
  const element = document.querySelector<HTMLElement>("ul");
  if (!element) throw new Error("test: brak listy miejsc");
  return element;
}

// ---------------------------------------------------------------------------
// Montowanie tras
// ---------------------------------------------------------------------------

async function mountList(): Promise<RenderedRoute> {
  return renderRoute({
    route: OrgListRoute,
    path: "/admin/organizations",
    initialEntry: "/admin/organizations",
  });
}

async function mountNew(): Promise<RenderedRoute> {
  return renderRoute({
    route: OrgNewRoute,
    path: "/admin/organizations/new",
    initialEntry: "/admin/organizations/new",
  });
}

async function mountDetail(id: string = IDS.org): Promise<RenderedRoute> {
  return renderRoute({
    route: OrgDetailRoute,
    path: "/admin/organizations/$id",
    initialEntry: `/admin/organizations/${id}`,
  });
}

/** Karta organizacji wczytana - dalej można klikać zakładki. */
async function mountLoadedDetail(id: string = IDS.org): Promise<RenderedRoute> {
  const rendered = await mountDetail(id);
  await waitFor(() => expect(screen.getByRole("tab", { name: TAB.general })).toBeTruthy());
  return rendered;
}

const TAB = {
  general: "adminOrganizations.general",
  branding: "adminOrganizations.branding",
  logos: "adminOrganizations.logos",
  seats: "adminOrganizations.seats",
} as const;

function openTab(name: string): void {
  fireEvent.click(screen.getByRole("tab", { name }));
}

/** Panel aktywnej zakładki - zakres dla odczytów pól. */
function pane(): HTMLElement {
  const element = document.querySelector<HTMLElement>("[role=tabpanel]");
  if (!element) throw new Error("test: brak panelu zakładki");
  return element;
}

beforeEach(() => {
  cleanup();
  h.lang = "pl";
  h.db = supabaseFromStub();
  h.hangTables = new Set();
  h.hangRpc = new Set();
  h.hangServer = new Set();
  h.rpcCalls = [];
  h.rpcResponses = new Map();
  h.sessionUserId = IDS.admin;
  h.sessionHangs = false;
  h.confirmAnswer = true;
  h.confirmMessages = [];
  h.navigations = [];
  h.serverCalls = [];
  h.props = [];
  h.seatLimitResult = {
    ok: true,
    seatsLimit: 8,
    active: 8,
    grace: 0,
    suspended: 1,
    source: "manual",
    providerSynced: false,
  };
  h.graceResult = { ok: true, graceDays: 14, seatsLimit: 5, active: 5, grace: 1, suspended: 0 };
  h.expiryResult = { ok: true, expired: 2, notified: 2 };
  h.reminderDaysResult = { ok: true, days: [7, 1] };
  h.remindersResult = { ok: true, sent: 3 };
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
  // Domyślne, „szczęśliwe” odpowiedzi - każdy test nadpisuje to, co bada.
  h.db.setResponse("membership_tiers", ok([MEMBER_TIER, CORPORATE_TIER, PARTNER_TIER]));
  h.db.setResponse("member_organizations", (chain) =>
    chain.has("maybeSingle") ? ok(orgRow()) : ok([orgRow()]),
  );
  h.db.setResponse("organization_seats", ok([seatRow()]));
  setRpc("org_add_seat", ok(IDS.seatThird));
  // Trasy pytają natywnym `confirm` przed usunięciem, a happy-dom go nie ma.
  // Definiujemy WŁASNOŚĆ okna (nie tylko globalną), bo tak brzmi wywołanie
  // w produkcji.
  Object.defineProperty(window, "confirm", {
    configurable: true,
    writable: true,
    value: (message?: string) => {
      h.confirmMessages.push(message ?? "");
      return h.confirmAnswer;
    },
  });
});

// ===========================================================================
// 1. LISTA `/admin/organizations` - odczyt, kształt zapytania, trzy stany
// ===========================================================================

describe("admin.organizations - lista: odczyt i kształt zapytania", () => {
  it("renderuje organizacje oddane przez bazę i NIE dokłada drugiego źródła", async () => {
    // Autorytet jest w RLS (`orgs admin all`: najemca sesji + rola `admin`).
    // Tutaj dowodzimy dwóch rzeczy naraz: na ekranie jest to, co oddało
    // zapytanie, i nie ma ŻADNEJ innej tabeli obok - panel nie może mieć
    // własnej, obocznej drogi do danych organizacji.
    await mountList();
    await waitFor(() => expect(bodyText()).toContain("Instytut Umowny"));

    expect(touchedTables()).toEqual([
      "member_organizations",
      "membership_tiers",
      "organization_seats",
    ]);
  });

  it("zapytanie listy ma KSZTAŁT kontraktu: select(*), order(created_at desc), limit(200)", async () => {
    // Asercja na KSZTAŁCIE, nie na wyniku: kolejność ogniw i ich argumenty są
    // kontraktem paginacji i sortowania. Zawężenia najemcą po stronie klienta
    // BYĆ NIE MOŻE - byłoby do obejścia z konsoli, a autorytet siedzi w RLS.
    await mountList();
    await waitFor(() => expect(bodyText()).toContain("Instytut Umowny"));

    const chain = db().lastChain("member_organizations");
    expect(chain?.calls.map((call) => call.method)).toEqual(["select", "order", "limit"]);
    expect(chain?.argsOf("select")).toEqual(["*"]);
    expect(chain?.argsOf("order")).toEqual(["created_at", { ascending: false }]);
    expect(chain?.argsOf("limit")).toEqual([200]);
    expect(chain?.has("eq"), "lista nie filtruje najemcy po stronie klienta").toBe(false);
  });

  it("stan W TOKU: dopóki odczyt leci, lista mówi „wczytywanie”, a nie „brak organizacji”", async () => {
    h.hangTables.add("member_organizations");
    await mountList();

    expect(screen.getByText("adminOrganizations.loading")).toBeTruthy();
    expect(bodyText()).not.toContain("adminOrganizations.organizationsYetCreateFirstOne");
  });

  it("stan PUSTY: baza oddała zero wierszy - zaproszenie do utworzenia pierwszej", async () => {
    db().setResponse("member_organizations", ok([]));
    await mountList();

    await waitFor(() =>
      expect(screen.getByText("adminOrganizations.organizationsYetCreateFirstOne")).toBeTruthy(),
    );
    // Pusto znaczy pusto: żadnej karty organizacji ani zapytania o miejsca.
    expect(db().chainsFor("organization_seats")).toHaveLength(0);
  });

  it("etykieta warstwy: nazwa z katalogu w języku interfejsu", async () => {
    await mountList();
    await waitFor(() => expect(bodyText()).toContain("Członkostwo korporacyjne"));
  });

  it("etykieta warstwy po angielsku, gdy interfejs jest angielski", async () => {
    h.lang = "en";
    await mountList();
    await waitFor(() => expect(bodyText()).toContain("Corporate membership"));
  });

  it("warstwa NIEZNANA katalogowi pokazuje surowy klucz, nie pustą plakietkę", async () => {
    // Warstwa mogła zostać wyłączona (`active = false`) po sprzedaży pakietu.
    // Karta ma wtedy pokazać klucz - inaczej administrator widzi plakietkę
    // bez treści i nie wie, co ta organizacja właściwie ma wykupione.
    db().setResponse("member_organizations", ok([orgRow({ tier_key: "legacy_partner" })]));
    await mountList();
    await waitFor(() => expect(bodyText()).toContain("legacy_partner"));
  });

  it("seed BEZ warstw organizacyjnych: karta nadal pokazuje etykietę wykupionej warstwy", async () => {
    // `tierOptions` w tej trasie wybiera rangi >= 30, a gdy ich nie ma - całą
    // listę. UWAGA: wynik jest tu MARTWY (`void tierOptions` w linii 68 pliku
    // trasy) - formularz miejsc nie ma wyboru warstwy. Dowodzimy więc tego, co
    // realnie dochodzi do ekranu: etykiety warstwy z katalogu.
    db().setResponse("membership_tiers", ok([MEMBER_TIER]));
    db().setResponse("member_organizations", ok([orgRow({ tier_key: "member" })]));
    await mountList();
    await waitFor(() => expect(bodyText()).toContain("Członek"));
  });

  it("katalog warstw niedostępny: lista organizacji żyje dalej, etykieta schodzi do klucza", async () => {
    db().setResponse("membership_tiers", fail("relation missing", "42P01"));
    await mountList();
    await waitFor(() => expect(bodyText()).toContain("Instytut Umowny"));
    // Plakietka niesie dokładnie klucz warstwy - `getByText` dopasowuje CAŁĄ
    // treść elementu, więc trafienie w klucz i18n nagłówka jest wykluczone.
    expect(screen.getByText("corporate")).toBeTruthy();
  });

  it("organizacja BEZ adresu kontaktowego nie dostaje pustego wiersza z kopertą", async () => {
    // `contact_email` jest opcjonalny (pakiet bywa sprzedany bez wskazania
    // opiekuna), a wiersz z ikoną koperty i pustym napisem wyglądałby jak
    // adres, którego nie da się przeczytać.
    db().setResponse("member_organizations", ok([orgRow({ contact_email: null })]));
    await mountList();
    // Domknięcie na adresie MIEJSCA, nie na nazwie organizacji: nazwa pojawia
    // się przed rozwiązaniem zapytania o miejsca, więc asercja „nie ma tu
    // żadnego adresu” postawiona wcześniej przechodziłaby w locie.
    await waitFor(() => expect(bodyText()).toContain("czlonek@example.org"));

    expect(bodyText()).not.toContain("kontakt@example.org");
  });
});

describe("admin.organizations - lista: przełącznik statusu", () => {
  it("zawieszenie organizacji wysyła `status: suspended` z zawężeniem po `id`", async () => {
    await mountList();
    await waitFor(() => expect(bodyText()).toContain("Instytut Umowny"));

    fireEvent.click(screen.getByLabelText("adminOrganizations.organizationStatus"));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    expect(payloadOf("member_organizations", "update")).toEqual({ status: "suspended" });
    const chain = writeChains("member_organizations").at(-1);
    expect(chain?.calls.map((call) => call.method)).toEqual(["update", "eq"]);
    expect(chain?.argsOf("eq")).toEqual(["id", IDS.org]);
    expect(lastToast("success")).toBe("adminOrganizations.statusUpdated");
  });

  it("przywrócenie zawieszonej organizacji wysyła `status: active`", async () => {
    db().setResponse("member_organizations", (chain) =>
      chain.has("update") ? ok(null) : ok([orgRow({ status: "suspended" })]),
    );
    await mountList();
    await waitFor(() => expect(screen.getByText("adminOrganizations.suspended")).toBeTruthy());

    fireEvent.click(screen.getByLabelText("adminOrganizations.organizationStatus"));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    expect(payloadOf("member_organizations", "update")).toEqual({ status: "active" });
  });

  it("udany zapis ODŚWIEŻA listę - administrator widzi stan po zmianie", async () => {
    await mountList();
    await waitFor(() => expect(bodyText()).toContain("Instytut Umowny"));
    expect(readChains("member_organizations")).toHaveLength(1);

    fireEvent.click(screen.getByLabelText("adminOrganizations.organizationStatus"));

    await waitFor(() => expect(readChains("member_organizations").length).toBeGreaterThan(1));
  });

  it("ODMOWA Z BAZY (42501): komunikat na ekranie, a cache NIETKNIĘTY", async () => {
    // Nieudany zapis nie może udawać udanego. Unieważnienie cache po odmowie
    // byłoby dokładnie takim udawaniem: lista mrugnęłaby i pokazała stan
    // sprzed zmiany, bez śladu, że zapis odpadł.
    db().setResponse("member_organizations", (chain) =>
      chain.has("update")
        ? fail("new row violates row-level security policy", "42501")
        : ok([orgRow()]),
    );
    await mountList();
    await waitFor(() => expect(bodyText()).toContain("Instytut Umowny"));
    expect(readChains("member_organizations")).toHaveLength(1);

    fireEvent.click(screen.getByLabelText("adminOrganizations.organizationStatus"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(lastToast("error")).toContain("row-level security");
    expect(readChains("member_organizations")).toHaveLength(1);
  });

  it("zapis W TOKU blokuje przełącznik - drugie kliknięcie nie leci do bazy", async () => {
    await mountList();
    await waitFor(() => expect(bodyText()).toContain("Instytut Umowny"));
    // Blokujemy tabelę PO wczytaniu listy - zapis zostaje w locie.
    h.hangTables.add("member_organizations");

    const toggle = screen.getByLabelText("adminOrganizations.organizationStatus");
    fireEvent.click(toggle);

    await waitFor(() =>
      expect(screen.getByLabelText("adminOrganizations.organizationStatus")).toBeDisabled(),
    );
    expect(writeChains("member_organizations")).toHaveLength(0);
  });
});

describe("admin.organizations - lista: usuwanie organizacji", () => {
  it("potwierdzone usunięcie wysyła `delete` z zawężeniem po `id` i odświeża listę", async () => {
    await mountList();
    await waitFor(() => expect(bodyText()).toContain("Instytut Umowny"));

    fireEvent.click(button("adminOrganizations.deleteOrganization"));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    // Pytanie potwierdzające musi nieść NAZWĘ - „usunąć organizację?” bez
    // nazwy to zaproszenie do usunięcia nie tej, o której admin myśli.
    expect(h.confirmMessages.at(-1)).toBe(
      "adminOrganizations.deleteConfirmList(name=Instytut Umowny)",
    );
    const chain = writeChains("member_organizations").at(-1);
    expect(chain?.calls.map((call) => call.method)).toEqual(["delete", "eq"]);
    expect(chain?.argsOf("eq")).toEqual(["id", IDS.org]);
    expect(lastToast("success")).toBe("adminOrganizations.organizationDeleted");
  });

  it("odmowa w okienku potwierdzenia NIE wysyła niczego do bazy", async () => {
    h.confirmAnswer = false;
    await mountList();
    await waitFor(() => expect(bodyText()).toContain("Instytut Umowny"));

    fireEvent.click(button("adminOrganizations.deleteOrganization"));

    expect(h.confirmMessages).toHaveLength(1);
    expect(writeChains("member_organizations")).toHaveLength(0);
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("odmowa bazy przy usuwaniu: komunikat na ekranie, cache nietknięty", async () => {
    db().setResponse("member_organizations", (chain) =>
      chain.has("delete") ? fail("orgs: not allowed", "42501") : ok([orgRow()]),
    );
    await mountList();
    await waitFor(() => expect(bodyText()).toContain("Instytut Umowny"));
    expect(readChains("member_organizations")).toHaveLength(1);

    fireEvent.click(button("adminOrganizations.deleteOrganization"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(lastToast("error")).toBe("orgs: not allowed");
    expect(readChains("member_organizations")).toHaveLength(1);
  });
});

describe("admin.organizations - lista: miejsca w karcie organizacji", () => {
  it("zapytanie o miejsca jest zawężone organizacją i posortowane od najstarszego", async () => {
    await mountList();
    await waitFor(() => expect(bodyText()).toContain("czlonek@example.org"));

    const chain = db().lastChain("organization_seats");
    expect(chain?.calls.map((call) => call.method)).toEqual(["select", "eq", "order"]);
    expect(chain?.argsOf("eq")).toEqual(["org_id", IDS.org]);
    expect(chain?.argsOf("order")).toEqual(["created_at", { ascending: true }]);
  });

  it("licznik pokazuje ZAJĘTE/LIMIT z danych, nie z założeń", async () => {
    db().setResponse(
      "organization_seats",
      ok([
        seatRow({ id: IDS.seatOwner, role: "owner", invited_email: "wlasciciel@example.org" }),
        seatRow({ id: IDS.seatMember }),
      ]),
    );
    await mountList();
    await waitFor(() => expect(screen.getByText("2/5")).toBeTruthy());
  });

  it("miejsca W TOKU: karta mówi „wczytywanie”, a nie „brak miejsc”", async () => {
    h.hangTables.add("organization_seats");
    await mountList();
    await waitFor(() => expect(bodyText()).toContain("Instytut Umowny"));

    expect(screen.getByText("adminOrganizations.loading")).toBeTruthy();
    expect(bodyText()).not.toContain("adminOrganizations.seatsYetAddFirstAccount");
  });

  it("stan PUSTY miejsc: zaproszenie do dodania pierwszego konta", async () => {
    db().setResponse("organization_seats", ok([]));
    await mountList();
    await waitFor(() =>
      expect(screen.getByText("adminOrganizations.seatsYetAddFirstAccount")).toBeTruthy(),
    );
    expect(screen.getByText("0/5")).toBeTruthy();
  });

  it("właściciela NIE DA SIĘ usunąć z karty, członka owszem", async () => {
    // Reguła jest w bazie (`org_add_seat`: rolę `owner` nadaje wyłącznie
    // admin), a panel nie może proponować akcji, która zostawiłaby
    // organizację bez właściciela.
    db().setResponse(
      "organization_seats",
      ok([
        seatRow({ id: IDS.seatOwner, role: "owner", invited_email: "wlasciciel@example.org" }),
        seatRow({ id: IDS.seatMember }),
      ]),
    );
    await mountList();
    await waitFor(() => expect(bodyText()).toContain("wlasciciel@example.org"));

    expect(screen.getAllByRole("button", { name: "adminOrganizations.removeSeat" })).toHaveLength(
      1,
    );
    // Zakres to LISTA miejsc: te same klucze („właściciel”, „członek”) są też
    // opcjami droplisty roli, więc szukanie po całym dokumencie nie odróżniłoby
    // plakietki miejsca od opcji formularza.
    const list = seatList();
    expect(within(list).getByText("adminOrganizations.owner")).toBeTruthy();
    expect(within(list).getByText("adminOrganizations.member")).toBeTruthy();
  });

  it("miejsce objęte kontem jest „aktywne”, samo zaproszenie - „zaproszone”", async () => {
    db().setResponse(
      "organization_seats",
      ok([
        seatRow({ id: IDS.seatMember, claimed_at: BASE_ISO }),
        seatRow({ id: IDS.seatThird, invited_email: "zaproszony@example.org" }),
      ]),
    );
    await mountList();
    await waitFor(() => expect(bodyText()).toContain("zaproszony@example.org"));

    expect(screen.getByText("adminOrganizations.activeSeats")).toBeTruthy();
    expect(screen.getByText("adminOrganizations.invited")).toBeTruthy();
  });

  it("dodanie miejsca: RPC `org_add_seat` dostaje obciętego adresa i wybraną rolę", async () => {
    await mountList();
    await waitFor(() => expect(bodyText()).toContain("czlonek@example.org"));

    type(screen.getByPlaceholderText("adminOrganizations.accountEmail"), "  nowy@example.com  ");
    type(screen.getByLabelText("adminOrganizations.role"), "owner");
    fireEvent.click(button("adminOrganizations.addSeat"));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    expect(h.rpcCalls).toEqual([
      {
        name: "org_add_seat",
        args: { p_org: IDS.org, p_email: "nowy@example.com", p_role: "owner" },
      },
    ]);
    expect(lastToast("success")).toBe("adminOrganizations.seatAdded");
  });

  it("po dodaniu miejsca pole adresu jest puste, a lista miejsc odświeżona", async () => {
    await mountList();
    await waitFor(() => expect(bodyText()).toContain("czlonek@example.org"));
    const before = db().chainsFor("organization_seats").length;

    const email = screen.getByPlaceholderText("adminOrganizations.accountEmail");
    type(email, "nowy@example.com");
    fireEvent.click(button("adminOrganizations.addSeat"));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    await waitFor(() =>
      expect(db().chainsFor("organization_seats").length).toBeGreaterThan(before),
    );
    expect(email).toHaveValue("");
  });

  it("Enter w polu adresu dodaje miejsce; inny klawisz nie robi nic", async () => {
    await mountList();
    await waitFor(() => expect(bodyText()).toContain("czlonek@example.org"));

    const email = screen.getByPlaceholderText("adminOrganizations.accountEmail");
    type(email, "nowy@example.com");
    fireEvent.keyDown(email, { key: "a" });
    expect(h.rpcCalls).toHaveLength(0);

    fireEvent.keyDown(email, { key: "Enter" });
    await waitFor(() => expect(h.rpcCalls).toHaveLength(1));
  });

  it("puste pole i same spacje: przycisk zablokowany, Enter bez skutku", async () => {
    await mountList();
    await waitFor(() => expect(bodyText()).toContain("czlonek@example.org"));

    expect(button("adminOrganizations.addSeat")).toBeDisabled();
    const email = screen.getByPlaceholderText("adminOrganizations.accountEmail");
    type(email, "   ");
    expect(button("adminOrganizations.addSeat")).toBeDisabled();
    fireEvent.keyDown(email, { key: "Enter" });
    expect(h.rpcCalls).toHaveLength(0);
  });

  it("limit miejsc wyczerpany: przycisk zablokowany z wyjaśnieniem w `title`", async () => {
    db().setResponse("member_organizations", ok([orgRow({ seats_limit: 1 })]));
    await mountList();
    await waitFor(() => expect(screen.getByText("1/1")).toBeTruthy());

    const email = screen.getByPlaceholderText("adminOrganizations.accountEmail");
    type(email, "nowy@example.com");
    const add = button("adminOrganizations.addSeat");
    expect(add).toBeDisabled();
    expect(add.title).toBe("adminOrganizations.seatLimitReached");
    fireEvent.keyDown(email, { key: "Enter" });
    expect(h.rpcCalls).toHaveLength(0);
  });

  it("limit ZERO (wartość fałszywa, ale prawidłowa) też jest limitem", async () => {
    // `0` jest fałszywe w JS i dokładnie tu `||` zamiast `??` po cichu
    // podstawiłby wartość domyślną - organizacja z zerem miejsc pozwalałaby
    // wtedy zapraszać ludzi, których baza i tak odrzuci.
    db().setResponse("member_organizations", ok([orgRow({ seats_limit: 0 })]));
    db().setResponse("organization_seats", ok([]));
    await mountList();
    await waitFor(() => expect(screen.getByText("0/0")).toBeTruthy());

    type(screen.getByPlaceholderText("adminOrganizations.accountEmail"), "nowy@example.com");
    expect(button("adminOrganizations.addSeat")).toBeDisabled();
  });

  it("dodawanie W TOKU blokuje przycisk - żadnego drugiego wywołania RPC", async () => {
    h.hangRpc.add("org_add_seat");
    await mountList();
    await waitFor(() => expect(bodyText()).toContain("czlonek@example.org"));

    type(screen.getByPlaceholderText("adminOrganizations.accountEmail"), "nowy@example.com");
    fireEvent.click(button("adminOrganizations.addSeat"));

    await waitFor(() => expect(button("adminOrganizations.addSeat")).toBeDisabled());
    fireEvent.click(button("adminOrganizations.addSeat"));
    expect(h.rpcCalls).toHaveLength(1);
  });

  // Mapowanie odmów RPC na komunikat: to jedyne miejsce, w którym panel
  // TŁUMACZY błąd bazy na zdanie dla człowieka. Tabela pokrywa wszystkie
  // cztery gałęzie naraz - dołożenie odmowy w `org_add_seat` bez decyzji
  // o komunikacie wywali ten test.
  const SEAT_ERRORS: readonly { rpc: string; toast: string }[] = [
    { rpc: "orgs: seats limit reached", toast: "adminOrganizations.seatLimitReached" },
    { rpc: "orgs: seat exists", toast: "adminOrganizations.seatAlreadyExists" },
    { rpc: "orgs: invalid email", toast: "adminOrganizations.invalidEmail" },
    { rpc: "orgs: not allowed", toast: "adminOrganizations.couldAddSeat" },
  ];

  it.each(SEAT_ERRORS)("odmowa `$rpc` pokazuje `$toast`", async ({ rpc, toast }) => {
    setRpc("org_add_seat", fail(rpc, "P0001"));
    await mountList();
    await waitFor(() => expect(bodyText()).toContain("czlonek@example.org"));

    type(screen.getByPlaceholderText("adminOrganizations.accountEmail"), "nowy@example.com");
    fireEvent.click(button("adminOrganizations.addSeat"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(lastToast("error")).toBe(toast);
    // Nieudane dodanie NIE czyści pola - adres trzeba mieć czym poprawić.
    expect(screen.getByPlaceholderText("adminOrganizations.accountEmail")).toHaveValue(
      "nowy@example.com",
    );
  });

  it("usunięcie miejsca wysyła `delete` zawężone po `id` miejsca", async () => {
    await mountList();
    await waitFor(() => expect(bodyText()).toContain("czlonek@example.org"));

    fireEvent.click(button("adminOrganizations.removeSeat"));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    const chain = writeChains("organization_seats").at(-1);
    expect(chain?.calls.map((call) => call.method)).toEqual(["delete", "eq"]);
    expect(chain?.argsOf("eq")).toEqual(["id", IDS.seatMember]);
    expect(lastToast("success")).toBe("adminOrganizations.seatRemoved");
  });

  it("odmowa bazy przy usuwaniu miejsca pokazuje komunikat bazy", async () => {
    db().setResponse("organization_seats", (chain) =>
      chain.has("delete") ? fail("orgs: not allowed", "42501") : ok([seatRow()]),
    );
    await mountList();
    await waitFor(() => expect(bodyText()).toContain("czlonek@example.org"));

    fireEvent.click(button("adminOrganizations.removeSeat"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(lastToast("error")).toBe("orgs: not allowed");
  });
});

// ===========================================================================
// 2. TWORZENIE `/admin/organizations/new` - ładunek, walidacja, odmowa bazy
// ===========================================================================

/**
 * Pola formularza tworzenia W KOLEJNOŚCI DOKUMENTU.
 *
 * Ta trasa NIE ma kluczy i18n - napisy są wpisane w kodzie dwujęzycznie
 * (helper `tr(lang)`), więc szukanie pola po etykiecie znaczyłoby asercję na
 * polskim napisie, a ta pada przy pierwszej korekcie copy. Kolejność pól jest
 * kontraktem układu (dane podstawowe -> kontakt -> członkostwo) i to jej się
 * trzymamy, z nazwami w jednym miejscu.
 */
const NEW_FIELD = {
  name: 0,
  slug: 1,
  sector: 2,
  email: 3,
  website: 4,
  city: 5,
  country: 6,
  seats: 7,
} as const;

function newInput(field: keyof typeof NEW_FIELD): HTMLInputElement {
  const element = inputs()[NEW_FIELD[field]];
  if (!element) throw new Error(`test: brak pola ${field} w formularzu tworzenia`);
  return element;
}

/**
 * Przycisk zapisu formularza tworzenia. Jest DOKŁADNIE JEDEN element
 * `<button>` na tej trasie (powrót to `<a>` z `asChild`, warstwa wyboru to
 * natywny `<select>`), więc liczba jest częścią asercji - dołożenie drugiego
 * przycisku bez decyzji o teście od razu to pokaże.
 */
function createButton(): HTMLButtonElement {
  const all = Array.from(document.querySelectorAll("button"));
  const first = all[0];
  if (all.length !== 1 || !(first instanceof HTMLButtonElement)) {
    throw new Error(`test: oczekiwano jednego przycisku zapisu, jest ${all.length}`);
  }
  return first;
}

/** Odpowiedź na `insert ... select().single()` - wiersz nowo utworzonej organizacji. */
function stubCreated(): void {
  db().setResponse("member_organizations", (chain) =>
    chain.has("insert") ? ok(orgRow({ id: IDS.createdOrg })) : ok([orgRow()]),
  );
}

/**
 * Formularz tworzenia z KATALOGIEM WARSTW JUŻ WCZYTANYM.
 *
 * DLACZEGO NIE WYSTARCZY `waitFor(() => expect(selects()).toHaveLength(1))`.
 * Lista wyboru warstwy renderuje się NATYCHMIAST - i pusta; warstwy dokłada
 * dopiero rozwiązane zapytanie katalogu. Asercja na `<option>` postawiona
 * zaraz po pojawieniu się `<select>` mierzy więc stan „w locie”, nie wynik:
 * dla pustego katalogu przechodziłaby ZAWSZE, także gdyby zapytanie nigdy nie
 * wróciło - czyli dokładnie wtedy, gdy formularz jest zepsuty.
 *
 * Domknięcie jest deterministyczne, bez zegara i bez zgadywania liczby opcji:
 * czekamy na łańcuch katalogu (zapytanie WYSZŁO), a potem domykamy
 * mikrozadania przez `act`, żeby React zdążył wstawić wynik do drzewa.
 */
async function mountNewReady(): Promise<RenderedRoute> {
  const rendered = await mountNew();
  await waitFor(() => expect(selects()).toHaveLength(1));
  await waitFor(() => expect(db().lastChain("membership_tiers")).toBeTruthy());
  await act(async () => {});
  return rendered;
}

describe("admin.organizations.new - ładunek tworzenia", () => {
  it("montaż formularza nie pisze do bazy i pyta wyłącznie o katalog warstw", async () => {
    await mountNew();
    await waitFor(() => expect(selects()).toHaveLength(1));

    expect(touchedTables()).toEqual(["membership_tiers"]);
    expect(writeChains("member_organizations")).toHaveLength(0);
  });

  it("pełny formularz leci do bazy jako JEDEN `insert` z autorem z sesji", async () => {
    stubCreated();
    await mountNew();
    await waitFor(() => expect(selects()).toHaveLength(1));

    type(newInput("name"), "  Nowa Organizacja  ");
    type(newInput("slug"), "nowa-organizacja");
    type(newInput("sector"), "Transport");
    type(newInput("email"), " kontakt@example.com ");
    type(newInput("website"), "https://example.org");
    type(newInput("city"), "Gdańsk");
    type(newInput("country"), "Polska");
    type(newInput("seats"), "12");
    type(textareas()[0], "Opis organizacji.");
    type(textareas()[1], "Notatka wewnętrzna.");
    type(selects()[0], "partner");

    fireEvent.click(createButton());

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    expect(payloadOf("member_organizations", "insert")).toEqual({
      name: "Nowa Organizacja",
      tier_key: "partner",
      seats_limit: 12,
      contact_email: "kontakt@example.com",
      note: "Notatka wewnętrzna.",
      slug: "nowa-organizacja",
      description: "Opis organizacji.",
      website_url: "https://example.org",
      sector: "Transport",
      city: "Gdańsk",
      country: "Polska",
      created_by: IDS.admin,
    });
    const chain = db().lastChain("member_organizations");
    expect(chain?.calls.map((call) => call.method)).toEqual(["insert", "select", "single"]);
  });

  it("formularz z SAMĄ NAZWĄ wysyła `null`, a nie puste napisy", async () => {
    // Puste napisy w kolumnach tekstowych to cichy śmieć: `slug = ""` łamie
    // unikalność adresu, a `contact_email = ""` udaje adres, na który nic nie
    // dojdzie. Dlatego każde puste pole MUSI zejść do `null`.
    stubCreated();
    await mountNew();
    await waitFor(() => expect(selects()).toHaveLength(1));

    type(newInput("name"), "Minimalna");
    fireEvent.click(createButton());

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    expect(payloadOf("member_organizations", "insert")).toEqual({
      name: "Minimalna",
      tier_key: "corporate",
      seats_limit: 5,
      contact_email: null,
      note: null,
      slug: null,
      description: null,
      website_url: null,
      sector: null,
      city: null,
      country: null,
      created_by: IDS.admin,
    });
  });

  it("brak sesji zapisuje `created_by: null` zamiast wywalać formularz", async () => {
    // Autor jest miłą informacją, nie warunkiem poprawności - kolumna jest
    // `nullable`, a organizacja musi dać się utworzyć nawet po odświeżeniu
    // tokenu w innej karcie.
    h.sessionUserId = null;
    stubCreated();
    await mountNew();
    await waitFor(() => expect(selects()).toHaveLength(1));

    type(newInput("name"), "Bez autora");
    fireEvent.click(createButton());

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    expect(payloadOf("member_organizations", "insert").created_by).toBeNull();
  });

  it("slug jest sprowadzany do małych liter i myślników już przy wpisywaniu", async () => {
    // KONTROLA DODATNIA - przypina stan FAKTYCZNY, nie pożądany. Normalizator
    // trasy to `toLowerCase().replace(/[^a-z0-9-]/g, "-")`, czyli podmiana
    // ZNAK ZA ZNAK: każdy odrzucony znak zostawia własny myślnik, więc
    // „! ąć_” daje PIĘĆ myślników z rzędu, a polskie litery giną zamiast
    // przejść na odpowiedniki bez znaków diakrytycznych. Asercja mówi więc
    // dokładnie tyle: pole normalizuje na bieżąco i to, co widać w polu,
    // jest tym, co leci do bazy.
    stubCreated();
    await mountNewReady();

    type(newInput("name"), "Nazwa");
    type(newInput("slug"), "Nowa Firma! ĄĆ_2026");
    expect(newInput("slug")).toHaveValue("nowa-firma-----2026");

    fireEvent.click(createButton());
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    expect(payloadOf("member_organizations", "insert").slug).toBe("nowa-firma-----2026");
  });

  it.fails(
    "DEFEKT: trasa ma WŁASNĄ regułę sluga, inną niż `slugify` reszty repozytorium",
    async () => {
      // `src/lib/admin/invitations.functions.ts` ma funkcję `slugify`, która
      // ZWIJA ciągi znaków niedozwolonych do jednego myślnika i obcina
      // myślniki z brzegów. Ta trasa robi to inaczej (znak za znak), więc ten
      // sam napis wpisany w dwóch miejscach panelu daje dwa różne adresy
      // publiczne - a slug jest częścią adresu organizacji.
      //
      // Test jest ODMOWĄ, nie naprawą: jedna reguła musi zostać wybrana
      // i wyprowadzona do wspólnej funkcji, a to zmiana produkcyjna.
      stubCreated();
      await mountNewReady();

      type(newInput("name"), "Nazwa");
      type(newInput("slug"), "Nowa Firma! ĄĆ_2026");
      expect(newInput("slug")).toHaveValue("nowa-firma-2026");
    },
  );

  // Limit miejsc jest granicą OFERTY (1-500) i jednocześnie warunkiem zapisu.
  // Tabela pokrywa oba końce zakresu i wejścia, które nie są liczbą.
  const SEAT_LIMITS: readonly { typed: string; sent: number }[] = [
    { typed: "12", sent: 12 },
    { typed: "0", sent: 1 },
    { typed: "-5", sent: 1 },
    { typed: "", sent: 1 },
    { typed: "abc", sent: 1 },
    { typed: "600", sent: 500 },
    { typed: "500", sent: 500 },
  ];

  it.each(SEAT_LIMITS)("limit miejsc „$typed” zapisuje się jako $sent", async ({ typed, sent }) => {
    stubCreated();
    await mountNew();
    await waitFor(() => expect(selects()).toHaveLength(1));

    type(newInput("name"), "Limity");
    type(newInput("seats"), typed);
    fireEvent.click(createButton());

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    expect(payloadOf("member_organizations", "insert").seats_limit).toBe(sent);
  });

  it("warstwy do wyboru to warstwy ORGANIZACYJNE (ranga >= 30)", async () => {
    await mountNewReady();

    const options = Array.from(selects()[0].options).map((option) => option.value);
    expect(options).toEqual(["corporate", "partner"]);
    // Etykieta niesie klucz ORAZ nazwę z katalogu - klucz jest tym, co admin
    // zobaczy potem w plakietce karty, więc musi być widoczny przy wyborze.
    expect(selects()[0].textContent).toContain("Członkostwo korporacyjne");
  });

  it("gdy seed nie ma warstw organizacyjnych, wybór schodzi do WSZYSTKICH aktywnych", async () => {
    // Bez tej gałęzi formularz byłby pusty na świeżej instalacji - czyli
    // organizacji nie dałoby się utworzyć w ogóle.
    db().setResponse("membership_tiers", ok([MEMBER_TIER]));
    await mountNewReady();

    expect(Array.from(selects()[0].options).map((option) => option.value)).toEqual(["member"]);
  });

  it("katalog warstw pusty: lista wyboru jest pusta, ale zapis warstwy domyślnej działa", async () => {
    db().setResponse("membership_tiers", ok([]));
    stubCreated();
    await mountNewReady();

    expect(Array.from(selects()[0].options)).toHaveLength(0);
    type(newInput("name"), "Bez katalogu");
    fireEvent.click(createButton());

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    expect(payloadOf("member_organizations", "insert").tier_key).toBe("corporate");
  });

  it("pusta nazwa blokuje zapis - także wtedy, gdy to same spacje", async () => {
    await mountNew();
    await waitFor(() => expect(selects()).toHaveLength(1));

    expect(createButton()).toBeDisabled();
    type(newInput("name"), "    ");
    expect(createButton()).toBeDisabled();
    type(newInput("name"), "Nazwa");
    expect(createButton()).toBeEnabled();
  });

  it("po utworzeniu panel przechodzi na kartę NOWEJ organizacji", async () => {
    stubCreated();
    await mountNew();
    await waitFor(() => expect(selects()).toHaveLength(1));

    type(newInput("name"), "Nowa");
    fireEvent.click(createButton());

    await waitFor(() => expect(h.navigations).toHaveLength(1));
    expect(h.navigations[0]).toEqual({
      to: "/admin/organizations/$id",
      params: { id: IDS.createdOrg },
    });
  });

  it("DUPLIKAT unikalnego adresu (slug): błąd bazy dochodzi do ekranu, przejścia NIE MA", async () => {
    // `slug` jest unikalnym adresem organizacji w obrębie najemcy (host
    // serwisu mieszka na `tenants`, nie tutaj) - i jest jedynym polem tego
    // formularza, które baza może odrzucić po stronie zapisu. Administrator
    // musi zostać NA FORMULARZU z wpisanymi danymi, bo inaczej traci całą
    // pracę i nie wie, co poprawić.
    db().setResponse("member_organizations", (chain) =>
      chain.has("insert")
        ? fail(
            'duplicate key value violates unique constraint "member_organizations_slug_key"',
            "23505",
          )
        : ok([orgRow()]),
    );
    await mountNew();
    await waitFor(() => expect(selects()).toHaveLength(1));

    type(newInput("name"), "Kolizja");
    type(newInput("slug"), "instytut-umowny");
    fireEvent.click(createButton());

    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(lastToast("error")).toContain("member_organizations_slug_key");
    expect(h.navigations).toEqual([]);
    expect(h.toastSuccess).not.toHaveBeenCalled();
    // Stan listy nietknięty: ta trasa nie czyta ani nie unieważnia listy
    // organizacji, więc po nieudanym zapisie nie ma czego odświeżać.
    expect(readChains("member_organizations")).toHaveLength(0);
    expect(newInput("name")).toHaveValue("Kolizja");
  });

  it("odmowa RLS (42501) zostawia administratora na formularzu z komunikatem", async () => {
    db().setResponse("member_organizations", (chain) =>
      chain.has("insert")
        ? fail(
            'new row violates row-level security policy for table "member_organizations"',
            "42501",
          )
        : ok([orgRow()]),
    );
    await mountNew();
    await waitFor(() => expect(selects()).toHaveLength(1));

    type(newInput("name"), "Bez uprawnień");
    fireEvent.click(createButton());

    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(lastToast("error")).toContain("row-level security");
    expect(h.navigations).toEqual([]);
  });

  it("zapis W TOKU: przycisk zablokowany i podpisany inaczej niż w spoczynku", async () => {
    // Etykieta jest wpisana w kodzie dwujęzycznie, więc asercja jest na
    // RÓŻNICY napisów, nie na napisie - copy wolno poprawić, stanu „w toku”
    // nie wolno zgubić.
    h.sessionHangs = true;
    stubCreated();
    await mountNew();
    await waitFor(() => expect(selects()).toHaveLength(1));

    type(newInput("name"), "Wolny zapis");
    const idle = createButton().textContent ?? "";
    fireEvent.click(createButton());

    await waitFor(() => expect(createButton()).toBeDisabled());
    expect(createButton().textContent).not.toBe(idle);
    expect(writeChains("member_organizations")).toHaveLength(0);
  });

  it("interfejs angielski zmienia WSZYSTKIE napisy trasy i nazwę warstwy", async () => {
    await mountNewReady();
    const polish = bodyText();
    expect(polish).toContain("Członkostwo korporacyjne");

    cleanup();
    h.lang = "en";
    await mountNewReady();

    expect(bodyText()).not.toBe(polish);
    expect(bodyText()).toContain("Corporate membership");
    expect(bodyText()).not.toContain("Członkostwo korporacyjne");
  });
});

// ===========================================================================
// 3. KARTA `/admin/organizations/$id` - odmowa, kształt odczytu, ładunek
//    każdej mutacji i cztery zakładki edytora
// ===========================================================================
//
// Karta jest JEDYNYM miejscem, z którego zarządza się pakietem praw sprzedanym
// offline: danymi, marką, logo i MIEJSCAMI, czyli tym, komu dostęp w ogóle
// przysługuje. Przedmiotem dowodu są trzy rzeczy, których nie widzi bramka
// statyczna (`adminRouteAuthority.gate`), bo czyta wyłącznie TEKST pliku:
//   - karta nie pokazuje NICZEGO, czego nie oddało zapytanie - organizacja
//     innego najemcy dla panelu nie istnieje, bo RLS jej nie zwraca, a panel
//     nie ma obocznego źródła danych (zbiór odpytanych tabel jest asercją);
//   - każda mutacja ma ZNANY ładunek - w szczególności `?? DOMYŚLNA` na
//     wartości FAŁSZYWEJ ALE PRAWIDŁOWEJ: karencja `0` znaczy „odcięcie
//     natychmiast”, a nie „siedem dni”;
//   - odmowa bazy nie udaje sukcesu przez unieważnienie cache.
//
// Zakładki są w tej trasie jedynym sposobem zamontowania powierzchni: panel
// nieaktywnej zakładki NIE ISTNIEJE w drzewie (tak działa Radix i tak samo
// jego atrapa), więc np. zapytanie o miejsca wychodzi dopiero po wejściu
// w zakładkę Miejsca - i to też jest asercja.

/** Odpowiedź karty (`maybeSingle`) i listy (`select`) dla jednego wiersza. */
function stubDetail(row: OrganizationRow): void {
  db().setResponse("member_organizations", (chain) =>
    chain.has("maybeSingle") ? ok(row) : ok([row]),
  );
}

/** Organizacja z PUSTYMI kolumnami opcjonalnymi - prawa strona każdego `?? ""`. */
function bareOrgRow(overrides: Partial<OrganizationRow> = {}): OrganizationRow {
  return orgRow({
    slug: null,
    sector: null,
    description: null,
    contact_email: null,
    website_url: null,
    city: null,
    country: null,
    note: null,
    brand_primary: null,
    brand_accent: null,
    brand_ink: null,
    ...overrides,
  });
}

/**
 * Trzy miejsca w kolejności, w jakiej baza zachowuje je przy kurczącym się
 * limicie: właściciel, konto faktycznie objęte, najstarsze zaproszenie.
 * `OLDER_ISO` jest tu potrzebne - bez różnicy dat kolejność „kto wypada”
 * zależałaby od identyfikatorów, czyli od przypadku.
 */
function threeSeats(): OrgSeatRow[] {
  return [
    seatRow({ id: IDS.seatOwner, role: "owner", invited_email: "wlasciciel@example.org" }),
    seatRow({ id: IDS.seatMember, claimed_at: BASE_ISO }),
    seatRow({ id: IDS.seatThird, invited_email: "trzeci@example.org", created_at: OLDER_ISO }),
  ];
}

/**
 * Karta z KATALOGIEM WARSTW JUŻ WCZYTANYM - ta sama pułapka, co w
 * `mountNewReady`: droplista warstwy renderuje się natychmiast i pusta, więc
 * asercja na `<option>` postawiona zaraz po pojawieniu się zakładek mierzyłaby
 * stan „w locie”.
 *
 * DLACZEGO NIE `await act(async () => {})`. Jedno domknięcie mikrozadań NIE
 * wystarcza: od rozwiązania łańcucha atrapy do renderu z danymi jest kilka
 * przeskoków (`await` w warstwie danych, `notifyManager` react-query, praca
 * Reacta), a każde `await` przepuszcza tylko mikrozadania JUŻ zakolejkowane.
 * Test raz przechodził, raz nie - i to nie jest determinizm. Czekamy więc na
 * WARUNEK: droplista ma opcje. Wszystkie wywołania w tej sekcji podstawiają
 * katalog niepusty (inaczej ten warunek nigdy nie zajdzie - i tak ma być,
 * bo test bez katalogu nie potrzebuje tego domknięcia).
 */
async function mountGeneralReady(id: string = IDS.org): Promise<void> {
  await mountLoadedDetail(id);
  await waitFor(() => expect(db().lastChain("membership_tiers")).toBeTruthy());
  await waitFor(() => expect(selects(pane())[0].options.length).toBeGreaterThan(0));
}

/**
 * Zakładka Miejsca WCZYTANA. Klik montuje `SeatsPane`, ten dopiero wysyła
 * zapytanie o miejsca - i renderuje się NATYCHMIAST, ze stanem „wczytywanie”
 * i licznikiem `0/limit`. Asercja na miejscach postawiona zaraz po kliknięciu
 * mierzyłaby więc stan w locie (patrz komentarz wyżej o mikrozadaniach).
 *
 * Domknięcie jest WARUNKOWE, nie odliczane: zapytanie wyszło (łańcuch jest)
 * i zniknął napis „wczytywanie” - a ten schodzi zarówno dla danych, jak i dla
 * BŁĘDU, więc helper działa też w testach odmowy odczytu.
 */
async function openSeatsTab(): Promise<void> {
  openTab(TAB.seats);
  await waitFor(() => expect(db().lastChain("organization_seats")).toBeTruthy());
  await waitFor(() => expect(screen.queryByText("adminOrganizations.loading")).toBeNull());
}

/** Karta wczytana + zakładka Miejsca gotowa (najczęstszy start w tej sekcji). */
async function mountSeats(): Promise<void> {
  await mountLoadedDetail();
  await openSeatsTab();
}

/**
 * Pola zakładki Ogólne W KOLEJNOŚCI DOKUMENTU. Zakresem jest PANEL zakładki,
 * więc przełącznik statusu z nagłówka do tej numeracji nie wchodzi.
 */
const GENERAL_FIELD = {
  name: 0,
  slug: 1,
  sector: 2,
  email: 3,
  website: 4,
  city: 5,
  country: 6,
  seatsLimit: 7,
} as const;

function generalInput(field: keyof typeof GENERAL_FIELD): HTMLInputElement {
  const element = inputs(pane())[GENERAL_FIELD[field]];
  if (!element) throw new Error(`test: brak pola ${field} w zakładce Ogólne`);
  return element;
}

/** Adresy obrazów w kafelkach podglądu - łańcuchy `??` między wariantami logo. */
function imageSources(scope: ParentNode): string[] {
  return Array.from(scope.querySelectorAll<HTMLImageElement>("img")).map(
    (image) => image.getAttribute("src") ?? "",
  );
}

/** Pola atrapy gniazda obrazu w kolejności dokumentu (4 logo + favicon). */
function imageSlots(scope: ParentNode): HTMLInputElement[] {
  return Array.from(scope.querySelectorAll<HTMLInputElement>("[data-testid=image-slot]"));
}

/** Propsy TRZECH selektorów koloru z ostatniego renderu (podstawowy, akcent, tekst). */
function colorProps(): Record<string, unknown>[] {
  return h.props
    .filter((entry) => entry.name === "AdminColorPicker")
    .slice(-3)
    .map((entry) => entry.props);
}

/** Propsy PIĘCIU gniazd obrazu z ostatniego renderu zakładki Logo. */
function slotProps(): Record<string, unknown>[] {
  return h.props
    .filter((entry) => entry.name === "ImageSlot")
    .slice(-5)
    .map((entry) => entry.props);
}

/** Przycisk resetu koloru z atrapy selektora (ścieżka „wróć do dziedziczonej”). */
function colorReset(label: string): HTMLButtonElement {
  const element = document.querySelector<HTMLButtonElement>(`[data-reset="${label}"]`);
  if (!element) throw new Error(`test: brak resetu koloru ${label}`);
  return element;
}

/** Ładunek OSTATNIEGO wywołania funkcji serwerowej BEZ założenia o `{ data }`. */
function serverPayload(fn: string): unknown {
  const call = h.serverCalls.filter((entry) => entry.fn === fn).at(-1);
  if (!call) throw new Error(`test: funkcja serwerowa ${fn} nie została wywołana`);
  return call.payload;
}

describe("admin.organizations.$id - odczyt karty i granica najemcy", () => {
  it("wczytana karta pokazuje dane z bazy i NIE dokłada drugiego źródła", async () => {
    await mountGeneralReady();

    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("Instytut Umowny");
    // Karta pyta o organizację i katalog warstw - i o NIC więcej. Miejsca to
    // osobna zakładka, więc dopóki jej nie otworzono, tabela miejsc nie może
    // się tu pojawić: panel nie ma prawa mieć obocznej drogi do danych.
    expect(touchedTables()).toEqual(["member_organizations", "membership_tiers"]);
  });

  it("zapytanie karty ma KSZTAŁT kontraktu: select(*), eq(id), maybeSingle()", async () => {
    await mountLoadedDetail();

    const chain = db().lastChain("member_organizations");
    expect(chain?.calls.map((call) => call.method)).toEqual(["select", "eq", "maybeSingle"]);
    expect(chain?.argsOf("select")).toEqual(["*"]);
    expect(chain?.argsOf("eq")).toEqual(["id", IDS.org]);
    // Zawężenia najemcą po stronie klienta BYĆ NIE MOŻE - byłoby do obejścia
    // w konsoli, a autorytet siedzi w RLS (`orgs admin all`).
    expect(chain?.calls.filter((call) => call.method === "eq")).toHaveLength(1);
    expect(chain?.has("or"), "karta nie skleja własnego filtra najemcy").toBe(false);
    expect(chain?.has("limit")).toBe(false);
  });

  it("karta pyta o `id` Z ADRESU, nie o cokolwiek innego", async () => {
    // Organizacja innego najemcy: RLS jej nie oddaje, ale zapytanie MUSI
    // wyjść z identyfikatorem z adresu - inaczej test „nie ma organizacji”
    // przechodziłby też dla trasy, która pyta o stałą.
    db().setResponse("member_organizations", (chain) =>
      chain.has("maybeSingle") ? ok(null) : ok([]),
    );
    await mountDetail(IDS.foreignOrg);

    await waitFor(() => expect(db().lastChain("member_organizations")).toBeTruthy());
    expect(db().lastChain("member_organizations")?.argsOf("eq")).toEqual(["id", IDS.foreignOrg]);
  });

  it("stan W TOKU: karta mówi „wczytywanie” i nie pokazuje formularza", async () => {
    h.hangTables.add("member_organizations");
    await mountDetail();

    expect(screen.getByText("adminOrganizations.loading")).toBeTruthy();
    expect(inputs()).toHaveLength(0);
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
  });

  it.fails(
    "DEFEKT: organizacja, której baza NIE ODDAŁA, nie dostaje odmowy - komunikat `organizationFound` jest kodem MARTWYM",
    async () => {
      // CO JEST ZŁE. `admin.organizations.$id.tsx:154` brzmi
      // `if (orgQ.isLoading || !draft) return <loading/>`, a `draft` bierze
      // się z efektu `if (orgQ.data && !draft) setDraft(orgQ.data)`. Dla
      // organizacji, której zapytanie nie oddało (nie istnieje ALBO należy do
      // innego najemcy, więc RLS jej nie zwraca), `orgQ.data` jest `null`,
      // więc `draft` NIGDY się nie ustawia - i warunek linii 154 zostaje
      // prawdziwy na zawsze. Gałąź `if (!orgQ.data)` z linii 157, która ma
      // pokazać `adminOrganizations.organizationFound`, jest NIEOSIĄGALNA.
      //
      // SKUTEK DLA UŻYTKOWNIKA. Administrator, który wszedł na kartę po
      // nieistniejącym albo cudzym identyfikatorze, widzi „wczytywanie” do
      // końca świata: nie wie, czy panel wisi, czy organizacji nie ma, czy
      // padła baza. Dokładnie w tym stanie zaczyna się szukanie „gdzie się
      // podziała organizacja klienta”.
      //
      // DLACZEGO OSOBNA PRACA. Naprawa to zmiana WARUNKU renderu (rozdzielenie
      // „w toku” od „pusto” i od „błąd”), a ta sama pomyłka siedzi w czterech
      // miejscach tej rodziny - jedno miejsce naprawić bez pozostałych znaczy
      // zostawić rodzinę niespójną.
      db().setResponse("member_organizations", (chain) =>
        chain.has("maybeSingle") ? ok(null) : ok([]),
      );
      const rendered = await mountDetail();
      // Domknięcie na STANIE ZAPYTAŃ, nie na napisie: `isFetching() === 0`
      // znaczy „odczyt się SKOŃCZYŁ”, więc to, co widać potem, jest wynikiem,
      // a nie stanem w locie. Napis „wczytywanie” zostaje tu na zawsze, więc
      // czekanie na jego zniknięcie byłoby czekaniem do timeoutu.
      await waitFor(() => expect(rendered.queryClient.isFetching()).toBe(0));

      expect(screen.getByText("adminOrganizations.organizationFound")).toBeTruthy();
    },
  );

  // Kontrola dodatnia do defektu wyżej: przypina STAN FAKTYCZNY, żeby zmiana
  // zachowania nie przeszła niezauważona. Dwa różne powody, jeden ekran:
  // brak wiersza i ODMOWA odczytu wyglądają dla administratora identycznie.
  const UNAVAILABLE: readonly { label: string; result: SupabaseResult }[] = [
    { label: "brak wiersza (nie istnieje albo inny najemca)", result: ok(null) },
    { label: "odmowa RLS", result: fail("orgs: not allowed", "42501") },
    { label: "awaria relacji", result: fail("relation missing", "42P01") },
  ];

  it.each(UNAVAILABLE)(
    "KONTROLA DODATNIA - $label: karta zostaje na „wczytywanie”, bez formularza nad `id` z adresu",
    async ({ result }) => {
      db().setResponse("member_organizations", () => result);
      const rendered = await mountDetail(IDS.foreignOrg);
      // Odczyt SIĘ SKOŃCZYŁ (`isFetching() === 0`) - dopiero wtedy „wczytywanie”
      // na ekranie znaczy defekt, a nie zapytanie w locie.
      await waitFor(() => expect(rendered.queryClient.isFetching()).toBe(0));

      expect(screen.getByText("adminOrganizations.loading")).toBeTruthy();
      // Żadnego pustego formularza nad identyfikatorem z adresu: brak pól,
      // brak zakładek, brak przycisków zapisu i usunięcia, i sam identyfikator
      // nigdzie na ekranie (inaczej karta „potwierdzałaby” istnienie cudzej
      // organizacji).
      expect(inputs()).toHaveLength(0);
      expect(screen.queryAllByRole("tab")).toHaveLength(0);
      expect(screen.queryAllByRole("button")).toHaveLength(0);
      expect(bodyText()).not.toContain(IDS.foreignOrg);
      // I żadnego zapytania o miejsca cudzej organizacji.
      expect(db().chainsFor("organization_seats")).toHaveLength(0);
    },
  );

  it("nagłówek niesie warstwę, status i limit miejsc Z DANYCH", async () => {
    stubDetail(orgRow({ tier_key: "legacy_partner", seats_limit: 12 }));
    await mountLoadedDetail();

    expect(screen.getByText("legacy_partner")).toBeTruthy();
    // Stan pada w DWÓCH miejscach nagłówka - w plakietce i przy przełączniku -
    // i to jest część kontraktu: przełącznik bez podpisu nie mówi, co włącza.
    expect(screen.getAllByText("adminOrganizations.active")).toHaveLength(2);
    expect(bodyText()).toContain("adminOrganizations.seatLimit: 12");
  });

  it("organizacja ZAWIESZONA: plakietka i przełącznik mówią to samo", async () => {
    stubDetail(orgRow({ status: "suspended" }));
    await mountLoadedDetail();

    expect(screen.getAllByText("adminOrganizations.suspended")).toHaveLength(2);
    expect(screen.getByLabelText("adminOrganizations.status")).not.toBeChecked();
    expect(bodyText()).not.toContain("adminOrganizations.active");
  });
});

describe("admin.organizations.$id - zakładka Ogólne: ładunek zapisu", () => {
  it("zapis wysyła JEDEN `update` z ładunkiem BEZ kolumn systemowych, zawężony po `id`", async () => {
    await mountLoadedDetail();

    type(generalInput("name"), "Instytut Umowny po zmianie");
    fireEvent.click(button("adminOrganizations.save"));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    // Ładunek jest KOMPLETNY i porównany co do klucza: `toEqual` wywali test
    // także wtedy, gdy dołoży się kolumna systemowa. To ma znaczenie, bo
    // `id`, `tenant_id` i `created_by` są wyłączone z łatki CELOWO - najemcy
    // i autora wiersza nie zmienia się formularzem panelu, a `updated_at`
    // stawia baza.
    expect(payloadOf("member_organizations", "update")).toEqual({
      name: "Instytut Umowny po zmianie",
      slug: "instytut-umowny",
      tier_key: "corporate",
      seats_limit: 5,
      seats_source: "manual",
      seats_grace_days: 7,
      seats_grace_reminder_days: [7, 1],
      status: "active",
      contact_email: "kontakt@example.org",
      description: "Organizacja testowa.",
      website_url: "https://example.org",
      sector: "Energetyka",
      city: "Bruksela",
      country: "Belgia",
      note: "Notatka wewnętrzna.",
      brand_primary: "#0F3460",
      brand_accent: "#E94560",
      brand_ink: "#141414",
      logo_h_light: null,
      logo_h_dark: null,
      logo_v_light: null,
      logo_v_dark: null,
      logo_favicon: null,
      provider_subscription_id: null,
      starts_at: BASE_ISO,
      expires_at: null,
    });
    const chain = writeChains("member_organizations").at(-1);
    expect(chain?.calls.map((call) => call.method)).toEqual(["update", "eq"]);
    expect(chain?.argsOf("eq")).toEqual(["id", IDS.org]);
    expect(lastToast("success")).toBe("adminOrganizations.saved");
  });

  it("dopóki nic nie zmieniono, zapis jest ZABLOKOWANY", async () => {
    // Karta trzyma DRAFT: zapis ma lecieć wtedy, gdy jest co zapisać.
    // Odblokowany przycisk nad niezmienionym formularzem to zaproszenie do
    // nadpisania wiersza wartościami sprzed czyjejś równoległej zmiany.
    await mountLoadedDetail();

    expect(button("adminOrganizations.save")).toBeDisabled();
    type(generalInput("city"), "Warszawa");
    expect(button("adminOrganizations.save")).toBeEnabled();
    expect(writeChains("member_organizations")).toHaveLength(0);
  });

  /** Pole zakładki Ogólne -> kolumna, którą MUSI dostać (i tylko ona). */
  interface GeneralWrite {
    field: string;
    column: string;
    kind: "input" | "textarea";
    index: number;
    typed: string;
    sent: string;
  }

  function generalControl(write: GeneralWrite): HTMLElement {
    const list = write.kind === "input" ? inputs(pane()) : textareas(pane());
    const element = list[write.index];
    if (!element) throw new Error(`test: brak pola ${write.field}`);
    return element;
  }

  const GENERAL_WRITES: readonly GeneralWrite[] = [
    {
      field: "nazwa",
      column: "name",
      kind: "input",
      index: 0,
      typed: "Nowa Nazwa",
      sent: "Nowa Nazwa",
    },
    // Slug jest normalizowany JUŻ PRZY WPISYWANIU - patrz kontrola dodatnia niżej.
    {
      field: "slug",
      column: "slug",
      kind: "input",
      index: 1,
      typed: "Nowy Slug",
      sent: "nowy-slug",
    },
    {
      field: "branża",
      column: "sector",
      kind: "input",
      index: 2,
      typed: "Transport",
      sent: "Transport",
    },
    {
      field: "e-mail",
      column: "contact_email",
      kind: "input",
      index: 3,
      typed: "biuro@example.com",
      sent: "biuro@example.com",
    },
    {
      field: "strona",
      column: "website_url",
      kind: "input",
      index: 4,
      typed: "https://example.org/kontakt",
      sent: "https://example.org/kontakt",
    },
    { field: "miasto", column: "city", kind: "input", index: 5, typed: "Gdańsk", sent: "Gdańsk" },
    { field: "kraj", column: "country", kind: "input", index: 6, typed: "Polska", sent: "Polska" },
    {
      field: "opis",
      column: "description",
      kind: "textarea",
      index: 0,
      typed: "Nowy opis.",
      sent: "Nowy opis.",
    },
    {
      field: "notatka",
      column: "note",
      kind: "textarea",
      index: 1,
      typed: "Nowa notatka.",
      sent: "Nowa notatka.",
    },
  ];

  it.each(GENERAL_WRITES)(
    "pole „$field” pisze do kolumny `$column` i do żadnej innej",
    async (write) => {
      await mountLoadedDetail();

      type(generalControl(write), write.typed);
      fireEvent.click(button("adminOrganizations.save"));

      await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
      const payload = payloadOf("member_organizations", "update");
      expect(payload[write.column]).toBe(write.sent);
      // Reszta ładunku pozostaje wierszem z bazy - jedno pole zmienia JEDNĄ
      // kolumnę, a nie „mniej więcej te, które są w tej karcie”.
      const untouched = GENERAL_WRITES.filter((other) => other.column !== write.column);
      for (const other of untouched) {
        expect(payload[other.column]).not.toBe(other.sent);
      }
    },
  );

  const NULLABLE_FIELDS: readonly GeneralWrite[] = GENERAL_WRITES.filter(
    (write) => write.column !== "name",
  );

  it.each(NULLABLE_FIELDS)(
    "wyczyszczenie pola „$field” zapisuje `null`, a nie pusty napis",
    async (write) => {
      // Puste napisy w kolumnach tekstowych to cichy śmieć: `slug = ""` łamie
      // unikalność adresu, `contact_email = ""` udaje adres, na który nic nie
      // dojdzie, a `website_url = ""` renderuje się potem jako link nikąd.
      await mountLoadedDetail();

      type(generalControl(write), "");
      fireEvent.click(button("adminOrganizations.save"));

      await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
      expect(payloadOf("member_organizations", "update")[write.column]).toBeNull();
    },
  );

  it("organizacja z pustymi kolumnami: pola są PUSTE, a nie wypełnione słowem „null”", async () => {
    stubDetail(bareOrgRow());
    await mountLoadedDetail();

    expect(generalInput("slug")).toHaveValue("");
    expect(generalInput("sector")).toHaveValue("");
    expect(generalInput("email")).toHaveValue("");
    expect(generalInput("website")).toHaveValue("");
    expect(generalInput("city")).toHaveValue("");
    expect(generalInput("country")).toHaveValue("");
    expect(textareas(pane())[0]).toHaveValue("");
    expect(textareas(pane())[1]).toHaveValue("");
    expect(bodyText()).not.toContain("null");
  });

  it("slug jest sprowadzany do małych liter i myślników już przy wpisywaniu", async () => {
    // KONTROLA DODATNIA - przypina stan FAKTYCZNY: normalizator tej karty jest
    // ten sam, co w formularzu tworzenia (podmiana ZNAK ZA ZNAK), więc „! ĄĆ_”
    // daje myślnik za każdy odrzucony znak. Defekt „dwie reguły sluga w jednym
    // panelu” jest zgłoszony przy sekcji 2 i dotyczy OBU tras naraz.
    await mountLoadedDetail();

    type(generalInput("slug"), "Nowa Firma! ĄĆ_2026");
    expect(generalInput("slug")).toHaveValue("nowa-firma-----2026");

    fireEvent.click(button("adminOrganizations.save"));
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    expect(payloadOf("member_organizations", "update").slug).toBe("nowa-firma-----2026");
  });

  it("KONTROLA DODATNIA: karta POZWALA zapisać pustą nazwę - formularz tworzenia nie", async () => {
    // Stan faktyczny, nie pożądany. Formularz `/new` blokuje zapis przy pustej
    // nazwie (`disabled={!name.trim()}`), a karta nie ma tej reguły w ogóle:
    // `name: e.target.value` bez `|| null` i bez walidacji, więc do kolumny
    // NOT NULL leci `""` - organizacja zostaje bez nazwy na liście i w oknie
    // potwierdzenia usunięcia. Ujednolicenie reguły to zmiana PRODUKCYJNA
    // (albo walidacja tutaj, albo wspólny walidator dla obu tras), więc tutaj
    // przypinamy wyłącznie to, co panel robi dzisiaj.
    await mountLoadedDetail();

    type(generalInput("name"), "   ");
    expect(button("adminOrganizations.save")).toBeEnabled();
    fireEvent.click(button("adminOrganizations.save"));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    expect(payloadOf("member_organizations", "update").name).toBe("   ");
  });

  it("przełącznik statusu zmienia DRAFT, a do bazy leci dopiero po zapisie", async () => {
    // Różnica względem listy jest celowa: tam przełącznik zapisuje od razu,
    // tutaj jest częścią formularza. Gdyby zapisywał od razu, administrator
    // porzucający kartę bez zapisu zostawiłby organizację zawieszoną.
    await mountLoadedDetail();

    fireEvent.click(screen.getByLabelText("adminOrganizations.status"));
    expect(writeChains("member_organizations")).toHaveLength(0);
    expect(screen.getAllByText("adminOrganizations.suspended")).toHaveLength(2);

    fireEvent.click(button("adminOrganizations.save"));
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    expect(payloadOf("member_organizations", "update").status).toBe("suspended");
  });

  it("przywrócenie ZAWIESZONEJ organizacji zapisuje `status: active`", async () => {
    // Druga strona tego samego przełącznika. Bez niej gałąź „włącz z powrotem”
    // byłaby nietknięta, a to ona kończy zawieszenie pakietu, za który klient
    // dopłacił - czyli decyduje o dostępie kilkudziesięciu osób naraz.
    stubDetail(orgRow({ status: "suspended" }));
    await mountLoadedDetail();

    fireEvent.click(screen.getByLabelText("adminOrganizations.status"));
    expect(screen.getAllByText("adminOrganizations.active")).toHaveLength(2);

    fireEvent.click(button("adminOrganizations.save"));
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    expect(payloadOf("member_organizations", "update").status).toBe("active");
  });

  it("udany zapis unieważnia kartę - administrator widzi stan po zmianie", async () => {
    await mountLoadedDetail();
    expect(readChains("member_organizations")).toHaveLength(1);

    type(generalInput("city"), "Warszawa");
    fireEvent.click(button("adminOrganizations.save"));

    await waitFor(() => expect(readChains("member_organizations").length).toBeGreaterThan(1));
  });

  it("ODMOWA Z BAZY (42501) przy zapisie: komunikat, cache NIETKNIĘTY, dane w polach", async () => {
    // Nieudany zapis nie może udawać udanego. Unieważnienie cache po odmowie
    // byłoby dokładnie takim udawaniem: pola wróciłyby do stanu z bazy i
    // administrator straciłby to, co wpisał, nie dowiedziawszy się dlaczego.
    db().setResponse("member_organizations", (chain) =>
      chain.has("update")
        ? fail(
            'new row violates row-level security policy for table "member_organizations"',
            "42501",
          )
        : ok(orgRow()),
    );
    await mountLoadedDetail();
    expect(readChains("member_organizations")).toHaveLength(1);

    type(generalInput("city"), "Warszawa");
    fireEvent.click(button("adminOrganizations.save"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(lastToast("error")).toContain("row-level security");
    expect(readChains("member_organizations")).toHaveLength(1);
    expect(generalInput("city")).toHaveValue("Warszawa");
    expect(button("adminOrganizations.save")).toBeEnabled();
  });

  it("zapis W TOKU: przycisk zablokowany i podpisany „zapisywanie”", async () => {
    await mountLoadedDetail();
    // Blokujemy tabelę PO wczytaniu karty - zapis zostaje w locie.
    h.hangTables.add("member_organizations");

    type(generalInput("city"), "Warszawa");
    fireEvent.click(button("adminOrganizations.save"));

    await waitFor(() => expect(button("adminOrganizations.saving")).toBeDisabled());
    expect(screen.queryByRole("button", { name: "adminOrganizations.save" })).toBeNull();
  });

  // Podpowiedź pod (zablokowanym) limitem miejsc zależy od ŹRÓDŁA liczby
  // miejsc. Tabela pokrywa obie gałęzie oraz wejścia, których enum nie zna:
  // pusty napis (wartość fałszywa, ale prawidłowa dla kolumny `text`) i
  // wartość spoza enumu muszą trafić do gałęzi „ręcznie”, a nie zniknąć.
  const SEATS_SOURCES: readonly { source: string; hint: string }[] = [
    { source: "subscription", hint: "adminOrganizations.seatCountComesPaidTeam" },
    { source: "manual", hint: "adminOrganizations.changeSeatCountSeatsTab" },
    { source: "", hint: "adminOrganizations.changeSeatCountSeatsTab" },
    { source: "cesja", hint: "adminOrganizations.changeSeatCountSeatsTab" },
  ];

  it.each(SEATS_SOURCES)(
    "źródło miejsc „$source” pokazuje podpowiedź `$hint`",
    async ({ source, hint }) => {
      stubDetail(orgRow({ seats_source: source }));
      await mountLoadedDetail();

      expect(screen.getByText(hint)).toBeTruthy();
    },
  );

  it("limit miejsc w zakładce Ogólne jest TYLKO DO ODCZYTU", async () => {
    // Autorytetem liczby miejsc jest funkcja serwerowa (operator płatności
    // najpierw, potem baza), więc pole w formularzu ogólnym musi być martwe -
    // inaczej panel oferowałby drogę obok tego autorytetu.
    await mountLoadedDetail();

    const seats = generalInput("seatsLimit");
    expect(seats).toHaveValue(5);
    expect(seats).toBeDisabled();
    expect(seats.readOnly).toBe(true);
  });

  it("kartoteka CRM: link do firmy, gdy organizacja jest spięta", async () => {
    stubDetail(orgRow({ crm_company_id: IDS.crmCompany }));
    await mountLoadedDetail();

    const link = screen.getByRole("link", { name: "adminOrganizations.openCompanyRecord" });
    expect(link.getAttribute("href")).toBe(`/admin/companies/${IDS.crmCompany}`);
  });

  it("kartoteka CRM: bez spięcia karta mówi, że link powstaje sam", async () => {
    await mountLoadedDetail();

    expect(screen.getByText("adminOrganizations.crmRecordLinkCreatedAutomatically")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "adminOrganizations.openCompanyRecord" })).toBeNull();
  });

  it("droplista warstwy wystawia warstwy ORGANIZACYJNE (ranga >= 30) i pisze `tier_key`", async () => {
    await mountGeneralReady();

    // Droplista nie ma etykiety dostępnej (`SelectTrigger` bez `aria-label`
    // ani `id`), więc szukamy jej przez ZAKRES panelu - w zakładce Ogólne
    // jest dokładnie jedna. Braku etykiety nie zgłaszamy tu jako defektu:
    // dostępność panelu ma własne bramki.
    const tier = selects(pane())[0];
    expect(Array.from(tier.options).map((option) => option.value)).toEqual([
      "corporate",
      "partner",
    ]);
    expect(tier.textContent).toContain("Członkostwo korporacyjne");

    type(tier, "partner");
    fireEvent.click(button("adminOrganizations.save"));
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    expect(payloadOf("member_organizations", "update").tier_key).toBe("partner");
  });

  it("seed BEZ warstw organizacyjnych: wybór schodzi do wszystkich aktywnych", async () => {
    // Bez tej gałęzi karta na świeżej instalacji miałaby PUSTĄ droplistę,
    // czyli nie dałoby się zmienić warstwy w ogóle.
    db().setResponse("membership_tiers", ok([MEMBER_TIER]));
    await mountGeneralReady();

    expect(Array.from(selects(pane())[0].options).map((option) => option.value)).toEqual([
      "member",
    ]);
  });

  it("warstwa SPOZA katalogu: brak opcji w dropliście, ale zapis jej NIE GUBI", async () => {
    // Warstwę można wyłączyć (`active = false`) po sprzedaniu pakietu. Karta
    // ma wtedy pokazać klucz w plakietce (administrator widzi, co klient ma
    // wykupione), a zapis innego pola nie może po cichu przepisać warstwy na
    // pierwszą z listy.
    stubDetail(orgRow({ tier_key: "legacy_partner" }));
    await mountGeneralReady();

    const tier = selects(pane())[0];
    expect(Array.from(tier.options).map((option) => option.value)).not.toContain("legacy_partner");
    expect(screen.getByText("legacy_partner")).toBeTruthy();

    type(generalInput("city"), "Warszawa");
    fireEvent.click(button("adminOrganizations.save"));
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    expect(payloadOf("member_organizations", "update").tier_key).toBe("legacy_partner");
  });

  it("interfejs angielski zmienia nazwy warstw w dropliście", async () => {
    await mountGeneralReady();
    const polish = selects(pane())[0].textContent ?? "";
    expect(polish).toContain("Członkostwo korporacyjne");

    cleanup();
    h.lang = "en";
    await mountGeneralReady();

    expect(selects(pane())[0].textContent).toContain("Corporate membership");
    expect(selects(pane())[0].textContent).not.toBe(polish);
  });
});

describe("admin.organizations.$id - usuwanie organizacji", () => {
  it("potwierdzone usunięcie: `delete` po `id`, komunikat i powrót na listę", async () => {
    await mountLoadedDetail();

    fireEvent.click(button("adminOrganizations.delete"));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    // Pytanie potwierdzające MUSI nieść nazwę - „usunąć organizację?” bez
    // nazwy to zaproszenie do usunięcia nie tej, o której admin myśli.
    expect(h.confirmMessages.at(-1)).toBe("adminOrganizations.deleteConfirm(name=Instytut Umowny)");
    const chain = writeChains("member_organizations").at(-1);
    expect(chain?.calls.map((call) => call.method)).toEqual(["delete", "eq"]);
    expect(chain?.argsOf("eq")).toEqual(["id", IDS.org]);
    expect(lastToast("success")).toBe("adminOrganizations.organizationDeleted");
    expect(h.navigations).toEqual([{ to: "/admin/organizations" }]);
  });

  it("odmowa w okienku potwierdzenia: nic nie leci do bazy i nie ma przejścia", async () => {
    h.confirmAnswer = false;
    await mountLoadedDetail();

    fireEvent.click(button("adminOrganizations.delete"));

    expect(h.confirmMessages).toHaveLength(1);
    expect(writeChains("member_organizations")).toHaveLength(0);
    expect(h.navigations).toEqual([]);
  });

  it("odmowa bazy przy usuwaniu: komunikat bazy, administrator ZOSTAJE na karcie", async () => {
    db().setResponse("member_organizations", (chain) =>
      chain.has("delete") ? fail("orgs: not allowed", "42501") : ok(orgRow()),
    );
    await mountLoadedDetail();

    fireEvent.click(button("adminOrganizations.delete"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(lastToast("error")).toBe("orgs: not allowed");
    expect(h.navigations).toEqual([]);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("Instytut Umowny");
  });

  it("usuwanie W TOKU blokuje przycisk - drugie kliknięcie nie leci do bazy", async () => {
    await mountLoadedDetail();
    h.hangTables.add("member_organizations");

    fireEvent.click(button("adminOrganizations.delete"));

    await waitFor(() => expect(button("adminOrganizations.delete")).toBeDisabled());
    fireEvent.click(button("adminOrganizations.delete"));
    expect(h.confirmMessages).toHaveLength(1);
  });
});

describe("admin.organizations.$id - zakładka Marka: kolory", () => {
  /** Kolory organizacji różne od wartości domyślnych trasy - inaczej test nie odróżniłby jednych od drugich. */
  const BRANDED = { brand_primary: "#112233", brand_accent: "#445566", brand_ink: "#778899" };

  const COLOR_ROWS: readonly { label: string; column: string; typed: string }[] = [
    { label: "adminOrganizations.primary", column: "brand_primary", typed: "#010203" },
    { label: "adminOrganizations.accent", column: "brand_accent", typed: "#040506" },
    { label: "adminOrganizations.inkText", column: "brand_ink", typed: "#070809" },
  ];

  it("kolory Z DANYCH trafiają do selektorów, a wartość dziedziczona zostaje podpowiedzią", async () => {
    stubDetail(orgRow(BRANDED));
    await mountLoadedDetail();
    openTab(TAB.branding);

    expect(colorProps().map((props) => props.value)).toEqual(["#112233", "#445566", "#778899"]);
    // Wartość dziedziczona to trzy RÓŻNE stałe trasy, nie jedna wspólna:
    // reset koloru akcentu nie może wrócić do koloru podstawowego.
    const inherited = colorProps().map((props) => props.inheritedValue);
    expect(new Set(inherited).size).toBe(3);
    // Podglądy marki czytają te same wartości - to one pokazują, jak wyjdzie
    // materiał dla klienta, więc muszą wisieć na draftcie, nie na stałych.
    expect(bodyText()).toContain("#112233");
  });

  it("BRAK koloru: karta podstawia TRZY różne wartości domyślne (`??`, nie „pusto”)", async () => {
    // `brand_* = null` znaczy „dziedzicz po serwisie”, a nie „brak koloru”.
    // Gdyby tu było `||` zamiast `??`, zachowanie byłoby takie samo, ale dla
    // wartości `""` (kolor wyczyszczony do pustego napisu) już nie - dlatego
    // pusty napis jest osobnym wierszem niżej.
    stubDetail(bareOrgRow());
    await mountLoadedDetail();
    openTab(TAB.branding);

    const values = colorProps().map((props) => props.value);
    expect(new Set(values).size).toBe(3);
    for (const value of values) {
      expect(typeof value).toBe("string");
      expect(value).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it("kolor zapisany jako PUSTY NAPIS też schodzi do wartości domyślnej", async () => {
    // Wartość fałszywa, ale prawidłowa dla kolumny `text`. Trasa czyta ją
    // przez `??`, więc `""` przechodzi dalej i podgląd dostaje pusty kolor -
    // przypinamy stan faktyczny: selektor widzi dokładnie to, co w bazie.
    stubDetail(orgRow({ brand_primary: "" }));
    await mountLoadedDetail();
    openTab(TAB.branding);

    expect(colorProps()[0].value).toBe("");
  });

  it.each(COLOR_ROWS)("wpisanie koloru w rzędzie „$label” pisze do `$column`", async (row) => {
    stubDetail(orgRow(BRANDED));
    await mountLoadedDetail();
    openTab(TAB.branding);

    type(screen.getByLabelText(row.label), row.typed);
    fireEvent.click(button("adminOrganizations.save"));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    expect(payloadOf("member_organizations", "update")[row.column]).toBe(row.typed);
  });

  it.each(COLOR_ROWS)(
    'RESET koloru w rzędzie „$label” zapisuje `null` (dziedziczenie), a nie `""`',
    async (row) => {
      // To jest cała różnica między „ta organizacja ma własny kolor pusty”
      // (materiały wyjdą białe na białym) i „ta organizacja dziedziczy kolor
      // serwisu”. W bazie różnicę widać wyłącznie jako `null` kontra `""`.
      stubDetail(orgRow(BRANDED));
      await mountLoadedDetail();
      openTab(TAB.branding);

      fireEvent.click(colorReset(row.label));
      fireEvent.click(button("adminOrganizations.save"));

      await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
      expect(payloadOf("member_organizations", "update")[row.column]).toBeNull();
    },
  );

  it("wpisany kolor idzie do podglądu NATYCHMIAST, przed zapisem", async () => {
    stubDetail(orgRow(BRANDED));
    await mountLoadedDetail();
    openTab(TAB.branding);

    type(screen.getByLabelText("adminOrganizations.primary"), "#ABCDEF");

    expect(colorProps()[0].value).toBe("#ABCDEF");
    expect(bodyText()).toContain("#ABCDEF");
    expect(writeChains("member_organizations")).toHaveLength(0);
  });
});

describe("admin.organizations.$id - zakładka Logo: gniazda i podglądy", () => {
  const LOGOS = {
    logo_h_light: "https://example.org/h-light.svg",
    logo_h_dark: "https://example.org/h-dark.svg",
    logo_v_light: "https://example.org/v-light.svg",
    logo_v_dark: "https://example.org/v-dark.svg",
    logo_favicon: "https://example.org/favicon.png",
  };

  const SLOTS: readonly { slot: string; index: number; column: string }[] = [
    { slot: "poziome jasne", index: 0, column: "logo_h_light" },
    { slot: "poziome ciemne", index: 1, column: "logo_h_dark" },
    { slot: "pionowe jasne", index: 2, column: "logo_v_light" },
    { slot: "pionowe ciemne", index: 3, column: "logo_v_dark" },
    { slot: "favicon", index: 4, column: "logo_favicon" },
  ];

  it.each(SLOTS)("gniazdo „$slot” pisze adres do kolumny `$column`", async ({ index, column }) => {
    await mountLoadedDetail();
    openTab(TAB.logos);

    type(imageSlots(pane())[index], "https://example.org/nowe.svg");
    fireEvent.click(button("adminOrganizations.save"));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    expect(payloadOf("member_organizations", "update")[column]).toBe(
      "https://example.org/nowe.svg",
    );
  });

  it.each(SLOTS)(
    'wyczyszczenie gniazda „$slot” zapisuje `null`, a nie `""`',
    async ({ index, column }) => {
      // `logo_* = ""` renderuje się potem jako `<img src="">`, czyli ikona
      // zepsutego obrazka w materiałach klienta. Brak logo to `null`.
      stubDetail(orgRow(LOGOS));
      await mountLoadedDetail();
      openTab(TAB.logos);

      type(imageSlots(pane())[index], "");
      fireEvent.click(button("adminOrganizations.save"));

      await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
      expect(payloadOf("member_organizations", "update")[column]).toBeNull();
    },
  );

  it("wszystkie gniazda wysyłają pliki do folderu `orgs`, favicon dostaje etykietę i podpowiedź", async () => {
    // Folder jest w tej trasie jedyną granicą porządku w koszyku plików -
    // gniazdo bez folderu wrzuciłoby logo klienta do korzenia.
    stubDetail(orgRow(LOGOS));
    await mountLoadedDetail();
    openTab(TAB.logos);

    const props = slotProps();
    expect(props.map((entry) => entry.folder)).toEqual(["orgs", "orgs", "orgs", "orgs", "orgs"]);
    // Cztery gniazda logo mają etykietę PUSTĄ (opis nad gniazdem robi to samo),
    // a favicon - własną etykietę i podpowiedź, bo bywa użyty w mailach.
    expect(props.slice(0, 4).map((entry) => entry.label)).toEqual(["", "", "", ""]);
    expect(props[4].label).toBe("adminOrganizations.squareIcon32512px");
    expect(props[4].hint).toBe("adminOrganizations.usedEmailsExports");
    expect(props.map((entry) => entry.value)).toEqual([
      LOGOS.logo_h_light,
      LOGOS.logo_h_dark,
      LOGOS.logo_v_light,
      LOGOS.logo_v_dark,
      LOGOS.logo_favicon,
    ]);
  });

  // Osiem kafelków podglądu, każdy z łańcuchem `??` między wariantem
  // poziomym i pionowym. Tabela przechodzi łańcuch w OBIE strony: raz brakuje
  // wariantu pionowego, raz poziomego - i raz nie ma żadnego.
  const PREVIEWS: readonly { label: string; row: Partial<OrganizationRow>; sources: string[] }[] = [
    {
      label: "tylko warianty POZIOME",
      row: { logo_h_light: LOGOS.logo_h_light, logo_h_dark: LOGOS.logo_h_dark },
      sources: [
        LOGOS.logo_h_light,
        LOGOS.logo_h_dark,
        LOGOS.logo_h_dark,
        LOGOS.logo_h_dark,
        LOGOS.logo_h_light,
        LOGOS.logo_h_dark,
        LOGOS.logo_h_dark,
        LOGOS.logo_h_light,
      ],
    },
    {
      label: "tylko warianty PIONOWE",
      row: { logo_v_light: LOGOS.logo_v_light, logo_v_dark: LOGOS.logo_v_dark },
      sources: [
        LOGOS.logo_v_light,
        LOGOS.logo_v_dark,
        LOGOS.logo_v_dark,
        LOGOS.logo_v_dark,
        LOGOS.logo_v_light,
        LOGOS.logo_v_dark,
        LOGOS.logo_v_dark,
        LOGOS.logo_v_light,
      ],
    },
    { label: "BRAK logo w ogóle", row: {}, sources: [] },
  ];

  it.each(PREVIEWS)(
    "podglądy dla wariantu „$label” biorą logo wg łańcucha `??`",
    async ({ row, sources }) => {
      stubDetail(orgRow(row));
      await mountLoadedDetail();
      openTab(TAB.logos);

      expect(imageSources(pane())).toEqual(sources);
      // Kafelek bez logo nie może być pustą dziurą - pokazuje, że logo brakuje.
      expect(pane().querySelectorAll("img")).toHaveLength(sources.length);
    },
  );
});

describe("admin.organizations.$id - zakładka Miejsca: odczyt i stany", () => {
  it("miejsca są pytane DOPIERO po wejściu w zakładkę, zapytanie ma kształt kontraktu", async () => {
    await mountLoadedDetail();
    // Panel nieaktywnej zakładki nie istnieje w drzewie - i to jest dobrze:
    // karta organizacji nie ma pobierać listy kont, dopóki nikt jej nie chce.
    expect(db().chainsFor("organization_seats")).toHaveLength(0);

    await openSeatsTab();

    const chain = db().lastChain("organization_seats");
    expect(chain?.calls.map((call) => call.method)).toEqual(["select", "eq", "order"]);
    expect(chain?.argsOf("select")).toEqual(["*"]);
    expect(chain?.argsOf("eq")).toEqual(["org_id", IDS.org]);
    expect(chain?.argsOf("order")).toEqual(["created_at", { ascending: true }]);
    // Miejsca zawęża się ORGANIZACJĄ (to jest klucz obcy), a nie najemcą -
    // najemcę pilnuje RLS `seats admin all`.
    expect(chain?.calls.filter((call) => call.method === "eq")).toHaveLength(1);
  });

  it("licznik pokazuje ZAJĘTE/LIMIT z danych, a zawieszone w nawiasie", async () => {
    // Zawieszone miejsca nie są skasowane - obniżenie limitu ich nie wyrzuca,
    // więc administrator musi widzieć, ilu ludzi czeka nad limitem.
    db().setResponse(
      "organization_seats",
      ok([
        seatRow({ id: IDS.seatOwner, role: "owner", invited_email: "wlasciciel@example.org" }),
        seatRow({ id: IDS.seatMember }),
        seatRow({ id: IDS.seatThird, invited_email: "trzeci@example.org", status: "suspended" }),
      ]),
    );
    stubDetail(orgRow({ seats_limit: 2 }));
    await mountSeats();

    expect(screen.getByText("2/2 (+1)")).toBeTruthy();
  });

  it("licznik bez zawieszonych nie dokleja nawiasu", async () => {
    await mountSeats();

    expect(screen.getByText("1/5")).toBeTruthy();
  });

  it("miejsca W TOKU: zakładka mówi „wczytywanie”, a nie „brak miejsc”", async () => {
    h.hangTables.add("organization_seats");
    await mountLoadedDetail();
    openTab(TAB.seats);

    expect(screen.getByText("adminOrganizations.loading")).toBeTruthy();
    expect(bodyText()).not.toContain("adminOrganizations.seatsYetAddFirstAccount");
  });

  it("stan PUSTY miejsc: zaproszenie do dodania pierwszego konta", async () => {
    db().setResponse("organization_seats", ok([]));
    await mountSeats();

    expect(screen.getByText("adminOrganizations.seatsYetAddFirstAccount")).toBeTruthy();
    expect(screen.getByText("0/5")).toBeTruthy();
  });

  it.fails(
    "DEFEKT: AWARIA ODCZYTU miejsc pokazana jako „brak miejsc” - stan pusty nie jest odróżniony od zepsutego",
    async () => {
      // CO JEST ZŁE. `admin.organizations.$id.tsx:1085` zna dwa stany:
      // `seatsQ.isLoading` i `seats.length === 0`. Odmowa RLS albo awaria
      // relacji kończy zapytanie BŁĘDEM, więc `isLoading` schodzi do `false`,
      // `seatsQ.data` zostaje `undefined`, `seats` przez `?? []` staje się
      // pustą tablicą - i zakładka mówi „nie ma jeszcze miejsc, dodaj
      // pierwsze konto”. `seatsQ.isError` nie jest czytane nigdzie.
      //
      // SKUTEK DLA UŻYTKOWNIKA. Administrator widzi organizację BEZ KONT tam,
      // gdzie konta są - i robi dokładnie to, do czego komunikat zachęca:
      // zaprasza ludzi od nowa. Przy odmowie RLS zaproszenia odbije baza,
      // ale licznik „0/5” zdąży wprowadzić w błąd co do tego, za co klient
      // płaci. To ta sama klasa defektu, co przy odczycie samej organizacji
      // (i przy dwóch odczytach listy) - stąd naprawa jest jedną pracą nad
      // całą rodziną, nie łatką w jednym `if`.
      db().setResponse("organization_seats", fail("orgs: not allowed", "42501"));
      await mountSeats();

      expect(bodyText()).not.toContain("adminOrganizations.seatsYetAddFirstAccount");
    },
  );

  it("KONTROLA DODATNIA: odmowa odczytu miejsc wygląda dziś jak organizacja bez kont", async () => {
    db().setResponse("organization_seats", fail("orgs: not allowed", "42501"));
    await mountSeats();

    expect(screen.getByText("adminOrganizations.seatsYetAddFirstAccount")).toBeTruthy();
    expect(screen.getByText("0/5")).toBeTruthy();
    // Ani śladu komunikatu o błędzie: odmowa nie dochodzi nawet do toastu.
    expect(h.toastError).not.toHaveBeenCalled();
    expect(bodyText()).not.toContain("orgs: not allowed");
  });

  const SEAT_BADGES: readonly { label: string; seat: OrgSeatRow; texts: string[] }[] = [
    {
      label: "właściciel z objętym kontem",
      seat: seatRow({ role: "owner", claimed_at: BASE_ISO }),
      texts: ["adminOrganizations.owner", "adminOrganizations.activeSeats"],
    },
    {
      label: "członek z samym zaproszeniem",
      seat: seatRow({}),
      texts: ["adminOrganizations.member", "adminOrganizations.invited"],
    },
    {
      label: "miejsce bez dostępu",
      seat: seatRow({ status: "suspended" }),
      texts: ["adminOrganizations.member", "adminOrganizations.access"],
    },
    {
      label: "miejsce w karencji BEZ terminu",
      seat: seatRow({ status: "grace", grace_until: null }),
      texts: ["adminOrganizations.grace"],
    },
  ];

  it.each(SEAT_BADGES)("plakietki miejsca - $label", async ({ seat, texts }) => {
    db().setResponse("organization_seats", ok([seat]));
    await mountSeats();

    // Zakres to LISTA miejsc: te same klucze („właściciel”, „członek”) są też
    // opcjami droplisty roli w formularzu dodawania, więc szukanie po całym
    // panelu nie odróżniłoby plakietki od opcji.
    const list = within(seatList());
    for (const text of texts) {
      expect(list.getByText(text)).toBeTruthy();
    }
  });

  it("miejsce w karencji z TERMINEM pokazuje datę końca dostępu", async () => {
    db().setResponse(
      "organization_seats",
      ok([seatRow({ status: "grace", grace_until: GRACE_ISO })]),
    );
    await mountSeats();

    const text = seatList().textContent ?? "";
    expect(text).toContain("adminOrganizations.graceUntil(date=");
    expect(text).toContain("2026");
  });

  it("data końca karencji jest formatowana w JĘZYKU INTERFEJSU", async () => {
    // Asercja na RÓŻNICY, nie na napisie: format daty należy do `uiLocale`
    // (PL kropkowy, EN europejski), a nie do tego pliku.
    db().setResponse(
      "organization_seats",
      ok([seatRow({ status: "grace", grace_until: GRACE_ISO })]),
    );
    await mountSeats();
    const polish = seatList().textContent ?? "";

    cleanup();
    h.lang = "en";
    db().setResponse(
      "organization_seats",
      ok([seatRow({ status: "grace", grace_until: GRACE_ISO })]),
    );
    await mountSeats();

    expect(seatList().textContent).not.toBe(polish);
    expect(seatList().textContent).toContain("2026");
  });

  it("właściciela NIE DA SIĘ usunąć z karty, członków owszem", async () => {
    // Reguła jest w bazie (rolę `owner` nadaje wyłącznie admin przez RPC),
    // a panel nie może proponować akcji, która zostawiłaby organizację bez
    // właściciela.
    db().setResponse("organization_seats", ok(threeSeats()));
    await mountSeats();

    expect(screen.getAllByRole("button", { name: "adminOrganizations.removeSeat" })).toHaveLength(
      2,
    );
    expect(seatList().textContent).toContain("wlasciciel@example.org");
  });
});

describe("admin.organizations.$id - miejsca: liczba opłaconych miejsc", () => {
  it("zastosowanie limitu wysyła ŁADUNEK funkcji serwerowej i odświeża oba widoki", async () => {
    // Liczba miejsc NIE idzie przez `update` tabeli: autorytetem jest funkcja
    // serwerowa (operator płatności najpierw, potem baza przelicza dostępy),
    // więc przedmiotem dowodu jest ładunek i to, że tabela zostaje nietknięta.
    await mountSeats();
    const seatReadsBefore = db().chainsFor("organization_seats").length;

    type(screen.getByLabelText("adminOrganizations.seatCount"), "8");
    fireEvent.click(button("adminOrganizations.applySeatCount"));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    expect(serverData("setTeamSeatLimit")).toEqual({ org_id: IDS.org, seats: 8 });
    expect(writeChains("member_organizations")).toHaveLength(0);
    // Komunikat niesie LICZBY z odpowiedzi serwera, nie z formularza -
    // to serwer wie, ilu ludzi realnie zawiesił.
    expect(lastToast("success")).toBe("adminOrganizations.seatLimitUpdated(limit=8,suspended=1)");
    await waitFor(() =>
      expect(db().chainsFor("organization_seats").length).toBeGreaterThan(seatReadsBefore),
    );
    expect(readChains("member_organizations").length).toBeGreaterThan(1);
  });

  // Pole liczby miejsc klamruje wejście JUŻ PRZY WPISYWANIU (1-500), więc do
  // funkcji serwerowej nie ma prawa wyjść wartość poza ofertą - walidator
  // serwerowy odrzuciłby ją błędem, którego panel nie tłumaczy.
  const SEAT_INPUTS: readonly { typed: string; sent: number }[] = [
    { typed: "8", sent: 8 },
    { typed: "0", sent: 1 },
    { typed: "-3", sent: 1 },
    { typed: "700", sent: 500 },
    { typed: "500", sent: 500 },
    { typed: "", sent: 1 },
  ];

  it.each(SEAT_INPUTS)(
    "liczba miejsc „$typed” leci do serwera jako $sent",
    async ({ typed, sent }) => {
      await mountSeats();

      type(screen.getByLabelText("adminOrganizations.seatCount"), typed);
      fireEvent.click(button("adminOrganizations.applySeatCount"));

      await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
      expect(serverData("setTeamSeatLimit")).toEqual({ org_id: IDS.org, seats: sent });
    },
  );

  it("bez zmiany liczby miejsc przycisk jest ZABLOKOWANY i nikt nie ostrzega o utracie dostępu", async () => {
    await mountSeats();

    expect(button("adminOrganizations.applySeatCount")).toBeDisabled();
    type(screen.getByLabelText("adminOrganizations.seatCount"), "5");
    expect(button("adminOrganizations.applySeatCount")).toBeDisabled();
    expect(bodyText()).not.toContain("adminOrganizations.willEnterGrace");
    expect(h.serverCalls).toEqual([]);
  });

  it("zapis liczby miejsc W TOKU blokuje przycisk - żadnego drugiego wywołania", async () => {
    // Zapis zostaje w locie (`hangServer`), bo inaczej ten stan jest
    // nieosiągalny: atrapa rozwiązuje się od razu. Podwójne wywołanie
    // znaczyłoby tu dwie zmiany liczby OPŁACONYCH miejsc u operatora.
    h.hangServer.add("setTeamSeatLimit");
    await mountSeats();

    type(screen.getByLabelText("adminOrganizations.seatCount"), "8");
    fireEvent.click(button("adminOrganizations.applySeatCount"));

    await waitFor(() => expect(button("adminOrganizations.saving")).toBeDisabled());
    fireEvent.click(button("adminOrganizations.saving"));
    expect(h.serverCalls.filter((call) => call.fn === "setTeamSeatLimit")).toHaveLength(1);
  });

  // Odmowa operatora płatności i odmowa bazy to dla administratora dwie różne
  // instrukcje („popraw kartę”, „nie masz uprawnień”), więc panel musi je
  // rozdzielić - i to jest jedyne miejsce, w którym to robi.
  const SEAT_LIMIT_ERRORS: readonly { error: string; toast: string }[] = [
    {
      error: "provider: card declined",
      toast: "adminOrganizations.paymentProviderRejectedChange",
    },
    { error: "orgs: not allowed", toast: "adminOrganizations.couldChangeSeatLimit" },
  ];

  it.each(SEAT_LIMIT_ERRORS)("odmowa „$error” pokazuje `$toast`", async ({ error, toast }) => {
    h.seatLimitResult = { ok: false, error };
    await mountSeats();

    type(screen.getByLabelText("adminOrganizations.seatCount"), "8");
    fireEvent.click(button("adminOrganizations.applySeatCount"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(lastToast("error")).toBe(toast);
    // Nieudana zmiana nie odświeża nic - inaczej licznik mrugnąłby na nową
    // wartość i wrócił, sugerując, że zapis „chyba przeszedł”.
    expect(db().chainsFor("organization_seats")).toHaveLength(1);
  });

  const SEAT_SOURCE_BADGES: readonly { source: string; badge: string; hint: string }[] = [
    {
      source: "subscription",
      badge: "adminOrganizations.subscription",
      hint: "adminOrganizations.changeUpdatesPaidSubscriptionIncreases",
    },
    {
      source: "manual",
      badge: "adminOrganizations.manual",
      hint: "adminOrganizations.seatsAboveLimitStayOrganisation",
    },
    {
      source: "",
      badge: "adminOrganizations.manual",
      hint: "adminOrganizations.seatsAboveLimitStayOrganisation",
    },
    {
      source: "cesja",
      badge: "adminOrganizations.manual",
      hint: "adminOrganizations.seatsAboveLimitStayOrganisation",
    },
  ];

  it.each(SEAT_SOURCE_BADGES)(
    "źródło miejsc „$source”: plakietka `$badge` i właściwe ostrzeżenie",
    async ({ source, badge, hint }) => {
      stubDetail(orgRow({ seats_source: source }));
      await mountSeats();

      expect(screen.getByText(badge)).toBeTruthy();
      expect(screen.getByText(hint)).toBeTruthy();
    },
  );

  it("obniżenie limitu OSTRZEGA imiennie, kto wejdzie w karencję", async () => {
    // Płatność za miejsca i dostęp ludzi to dla klienta dwie różne rzeczy -
    // panel musi pokazać drugą PRZED zapisem pierwszej.
    db().setResponse("organization_seats", ok(threeSeats()));
    await mountSeats();

    type(screen.getByLabelText("adminOrganizations.seatCount"), "1");

    const text = pane().textContent ?? "";
    expect(text).toContain("adminOrganizations.willEnterGrace(days=7)");
    expect(text).toContain("czlonek@example.org");
    expect(text).toContain("trzeci@example.org");
    // Właściciel zostaje zawsze - jest pierwszy w kolejności zachowania.
    expect(text).toContain("wlasciciel@example.org");
    expect(
      (pane().querySelector("p.text-destructive")?.textContent ?? "").includes(
        "wlasciciel@example.org",
      ),
    ).toBe(false);
  });

  it("KARENCJA ZERO: ostrzeżenie mówi „dostęp znika natychmiast”, nie „7 dni”", async () => {
    // `0` jest w JS fałszywe i dokładnie tu `||` zamiast `??` po cichu
    // podstawiłby siedem dni - a to jest różnica między „ludzie tracą dostęp
    // od razu” i „mają tydzień”. Organizacja z karencją zero MA prawo istnieć:
    // to znaczy „odcinamy natychmiast”.
    stubDetail(orgRow({ seats_grace_days: 0 }));
    db().setResponse("organization_seats", ok(threeSeats()));
    await mountSeats();

    type(screen.getByLabelText("adminOrganizations.seatCount"), "1");

    const text = pane().textContent ?? "";
    expect(text).toContain("adminOrganizations.loseAccessImmediately");
    expect(text).not.toContain("adminOrganizations.willEnterGrace");
  });
});

describe("admin.organizations.$id - miejsca: karencja i przypomnienia", () => {
  // Okres karencji czytany z wiersza. Trzecia pozycja to kolumna, której
  // w odpowiedzi NIE MA (starsza schema cache po migracji) - dokładnie ta
  // gałąź `?? DEFAULT_GRACE_DAYS`, której nie widać przy wartości `0`.
  const GRACE_VALUES: readonly { label: string; row: Partial<OrganizationRow>; shown: number }[] = [
    { label: "zapisane 14 dni", row: { seats_grace_days: 14 }, shown: 14 },
    { label: "zapisane ZERO dni", row: { seats_grace_days: 0 }, shown: 0 },
    { label: "kolumna nieoddana", row: { seats_grace_days: undefined }, shown: 7 },
  ];

  it.each(GRACE_VALUES)(
    "okres karencji - $label - trafia do pola jako $shown",
    async ({ row, shown }) => {
      stubDetail(orgRow(row));
      await mountSeats();

      expect(screen.getByLabelText("adminOrganizations.gracePeriodDays")).toHaveValue(shown);
    },
  );

  it("zmiana karencji NA ZERO wysyła `days: 0`, a nie wartość domyślną", async () => {
    await mountSeats();

    type(screen.getByLabelText("adminOrganizations.gracePeriodDays"), "0");
    fireEvent.click(button("adminOrganizations.applyGracePeriod"));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    expect(serverData("setTeamSeatGraceDays")).toEqual({ org_id: IDS.org, days: 0 });
    // Komunikat niesie liczbę Z ODPOWIEDZI serwera - to on zapisał wartość.
    expect(lastToast("success")).toBe("adminOrganizations.gracePeriodUpdated(days=14)");
  });

  const GRACE_INPUTS: readonly { typed: string; sent: number }[] = [
    { typed: "0", sent: 0 },
    { typed: "30", sent: 30 },
    { typed: "-5", sent: 0 },
    { typed: "365", sent: 90 },
  ];

  it.each(GRACE_INPUTS)("karencja „$typed” leci do serwera jako $sent", async ({ typed, sent }) => {
    await mountSeats();

    type(screen.getByLabelText("adminOrganizations.gracePeriodDays"), typed);
    fireEvent.click(button("adminOrganizations.applyGracePeriod"));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    expect(serverData("setTeamSeatGraceDays")).toEqual({ org_id: IDS.org, days: sent });
  });

  it("bez zmiany karencji przycisk jest zablokowany", async () => {
    await mountSeats();

    expect(button("adminOrganizations.applyGracePeriod")).toBeDisabled();
    type(screen.getByLabelText("adminOrganizations.gracePeriodDays"), "7");
    expect(button("adminOrganizations.applyGracePeriod")).toBeDisabled();
    expect(h.serverCalls).toEqual([]);
  });

  it("zmiana karencji W TOKU blokuje przycisk - żadnego drugiego wywołania", async () => {
    h.hangServer.add("setTeamSeatGraceDays");
    await mountSeats();

    type(screen.getByLabelText("adminOrganizations.gracePeriodDays"), "3");
    fireEvent.click(button("adminOrganizations.applyGracePeriod"));

    await waitFor(() => expect(button("adminOrganizations.saving")).toBeDisabled());
    fireEvent.click(button("adminOrganizations.saving"));
    expect(h.serverCalls.filter((call) => call.fn === "setTeamSeatGraceDays")).toHaveLength(1);
  });

  it("odmowa zmiany karencji: komunikat panelu, cache nietknięty", async () => {
    h.graceResult = { ok: false, error: "orgs: not allowed" };
    await mountSeats();

    type(screen.getByLabelText("adminOrganizations.gracePeriodDays"), "3");
    fireEvent.click(button("adminOrganizations.applyGracePeriod"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(lastToast("error")).toBe("adminOrganizations.couldChangeGracePeriod");
    expect(db().chainsFor("organization_seats")).toHaveLength(1);
  });

  // Progi przypomnień czytane z wiersza przez `effectiveReminderDays`.
  const REMINDER_VALUES: readonly {
    label: string;
    row: Partial<OrganizationRow>;
    text: string;
  }[] = [
    { label: "zapisane 7 i 1", row: { seats_grace_reminder_days: [7, 1] }, text: "7, 1" },
    { label: "pusta lista (wyłączone)", row: { seats_grace_reminder_days: [] }, text: "" },
    {
      label: "wartości z duplikatem i poza zakresem",
      row: { seats_grace_reminder_days: [3, 3, 200, 7] },
      text: "7, 3",
    },
    { label: "kolumna nieoddana", row: { seats_grace_reminder_days: undefined }, text: "7, 1" },
  ];

  it.each(REMINDER_VALUES)(
    "progi przypomnień - $label - dają pole „$text”",
    async ({ row, text }) => {
      stubDetail(orgRow(row));
      await mountSeats();

      expect(screen.getByLabelText("adminOrganizations.reminderDays")).toHaveValue(text);
    },
  );

  it("plakietka slotów: liczba zajętych progów, a przy pustym polu „wyłączone”", async () => {
    await mountSeats();

    expect(screen.getByText("adminOrganizations.reminderSlots(max=10,used=2)")).toBeTruthy();

    type(screen.getByLabelText("adminOrganizations.reminderDays"), "");
    expect(screen.getByText("adminOrganizations.disabled")).toBeTruthy();
  });

  it("przełączniki dni czytają stan z pola i dopisują progi malejąco", async () => {
    await mountSeats();

    expect(button("adminOrganizations.dayCount(count=7)").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(button("adminOrganizations.dayCount(count=30)").getAttribute("aria-pressed")).toBe(
      "false",
    );

    fireEvent.click(button("adminOrganizations.dayCount(count=30)"));

    expect(screen.getByLabelText("adminOrganizations.reminderDays")).toHaveValue("30, 7, 1");
    expect(button("adminOrganizations.dayCount(count=30)").getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("przełącznik dnia już ustawionego USUWA go z listy", async () => {
    await mountSeats();

    fireEvent.click(button("adminOrganizations.dayCount(count=7)"));

    expect(screen.getByLabelText("adminOrganizations.reminderDays")).toHaveValue("1");
    expect(button("adminOrganizations.dayCount(count=7)").getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  it("zapis progów wysyła listę ZNORMALIZOWANĄ, a śmieci z pola odpadają", async () => {
    await mountSeats();

    type(screen.getByLabelText("adminOrganizations.reminderDays"), "14, 7, 200, abc, 7");
    fireEvent.click(button("adminOrganizations.saveReminders"));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    // 200 jest poza zakresem (1-90), `abc` nie jest liczbą, a 7 powtórzone -
    // walidator serwerowy odrzuciłby taki ładunek błędem, którego panel nie
    // tłumaczy, więc normalizacja MUSI stać przed wysłaniem.
    expect(serverData("setTeamSeatGraceReminderDays")).toEqual({
      org_id: IDS.org,
      days: [14, 7],
    });
    expect(lastToast("success")).toBe("adminOrganizations.remindersDays(days=7, 1)");
  });

  it("wyłączenie przypomnień (puste pole) ma WŁASNY komunikat", async () => {
    h.reminderDaysResult = { ok: true, days: [] };
    await mountSeats();

    type(screen.getByLabelText("adminOrganizations.reminderDays"), "");
    fireEvent.click(button("adminOrganizations.saveReminders"));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    expect(serverData("setTeamSeatGraceReminderDays")).toEqual({ org_id: IDS.org, days: [] });
    expect(lastToast("success")).toBe("adminOrganizations.remindersDisabled");
  });

  it("bez zmiany progów przycisk zapisu jest zablokowany", async () => {
    await mountSeats();

    expect(button("adminOrganizations.saveReminders")).toBeDisabled();
    // Ta sama lista zapisana inaczej („1, 7” zamiast „7, 1”) to NIE zmiana.
    type(screen.getByLabelText("adminOrganizations.reminderDays"), "1, 7");
    expect(button("adminOrganizations.saveReminders")).toBeDisabled();
    type(screen.getByLabelText("adminOrganizations.reminderDays"), "14");
    expect(button("adminOrganizations.saveReminders")).toBeEnabled();
  });

  it("zapis progów W TOKU blokuje przycisk - żadnego drugiego wywołania", async () => {
    h.hangServer.add("setTeamSeatGraceReminderDays");
    await mountSeats();

    type(screen.getByLabelText("adminOrganizations.reminderDays"), "14");
    fireEvent.click(button("adminOrganizations.saveReminders"));

    await waitFor(() => expect(button("adminOrganizations.saving")).toBeDisabled());
    fireEvent.click(button("adminOrganizations.saving"));
    expect(h.serverCalls.filter((call) => call.fn === "setTeamSeatGraceReminderDays")).toHaveLength(
      1,
    );
  });

  it("odmowa zapisu progów pokazuje komunikat panelu", async () => {
    h.reminderDaysResult = { ok: false, error: "orgs: not allowed" };
    await mountSeats();

    type(screen.getByLabelText("adminOrganizations.reminderDays"), "14");
    fireEvent.click(button("adminOrganizations.saveReminders"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(lastToast("error")).toBe("adminOrganizations.couldSaveReminderDays");
  });

  it("ręczne domknięcie karencji odświeża miejsca i mówi, ilu osób dotyczyło", async () => {
    await mountSeats();

    fireEvent.click(button("adminOrganizations.closeOverdue"));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    expect(lastToast("success")).toBe("adminOrganizations.seatsExpired(count=2)");
    await waitFor(() => expect(db().chainsFor("organization_seats").length).toBeGreaterThan(1));
  });

  it("odmowa domknięcia karencji pokazuje komunikat panelu", async () => {
    h.expiryResult = { ok: false, error: "orgs: not allowed" };
    await mountSeats();

    fireEvent.click(button("adminOrganizations.closeOverdue"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(lastToast("error")).toBe("adminOrganizations.couldCloseGracePeriods");
  });

  it("ręczne przypomnienia: wywołanie z pustym ładunkiem i liczba wysłanych w komunikacie", async () => {
    await mountSeats();

    fireEvent.click(button("adminOrganizations.sendReminders"));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    expect(serverData("runSeatGraceReminders")).toEqual({});
    expect(lastToast("success")).toBe("adminOrganizations.remindersSent(count=3)");
  });

  it("odmowa wysyłki przypomnień pokazuje komunikat panelu", async () => {
    h.remindersResult = { ok: false, error: "orgs: not allowed" };
    await mountSeats();

    fireEvent.click(button("adminOrganizations.sendReminders"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(lastToast("error")).toBe("adminOrganizations.couldSendReminders");
  });

  it.fails(
    "DEFEKT: „domknij zaległe” i „wyślij przypomnienia” z karty JEDNEJ organizacji działają na WSZYSTKICH",
    async () => {
      // CO JEST ZŁE. Oba przyciski stoją w zakładce Miejsca KONKRETNEJ
      // organizacji (`admin.organizations.$id.tsx:1008-1025`), a wołane
      // funkcje serwerowe nie przyjmują `org_id` w ogóle:
      // `runSeatGraceExpiry()` idzie do `expireSeatGrace()`, a
      // `runSeatGraceReminders({ data: {} })` do `sendSeatGraceReminders(null)` -
      // obie chodzą po `organization_seats` KLIENTEM SERWISOWYM, bez zawężenia
      // organizacją ani najemcą (`lib/organizations/teamSeats.server.ts`).
      //
      // SKUTEK DLA UŻYTKOWNIKA. Administrator otwiera kartę organizacji A,
      // klika „domknij zaległe” i gasi dostęp ludziom w organizacjach B i C
      // (a przyciskiem obok wysyła im maile) - w tym u innych najemców.
      // Komunikat („wygasło 2 miejsca”) czyta się jako dotyczący organizacji
      // z adresu, więc nie ma nawet śladu, że stało się coś szerszego.
      //
      // DLACZEGO OSOBNA PRACA. Poprawka jest po stronie SERWERA (parametr
      // organizacji plus zawężenie zapytań i bramka roli w jej zakresie),
      // a zawężanie po stronie panelu byłoby pozorne. Do decyzji zostaje też,
      // czy akcja globalna ma zostać - ale wtedy nie w karcie jednej
      // organizacji.
      await mountSeats();

      fireEvent.click(button("adminOrganizations.closeOverdue"));
      await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
      expect(serverPayload("runSeatGraceExpiry")).toEqual({ data: { org_id: IDS.org } });
    },
  );

  it("KONTROLA DODATNIA: obie akcje awaryjne lecą BEZ organizacji w ładunku", async () => {
    await mountSeats();

    fireEvent.click(button("adminOrganizations.closeOverdue"));
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    fireEvent.click(button("adminOrganizations.sendReminders"));
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledTimes(2));

    expect(serverPayload("runSeatGraceExpiry")).toBeUndefined();
    expect(serverPayload("runSeatGraceReminders")).toEqual({ data: {} });
    expect(JSON.stringify(h.serverCalls)).not.toContain(IDS.org);
  });
});

describe("admin.organizations.$id - miejsca: dodawanie i usuwanie kont", () => {
  it("dodanie miejsca: RPC dostaje OBCIĘTY adres i rolę z droplisty", async () => {
    await mountSeats();
    const seatReadsBefore = db().chainsFor("organization_seats").length;

    const email = screen.getByPlaceholderText("adminOrganizations.accountEmail");
    type(email, "  nowy@example.com  ");
    fireEvent.click(button("adminOrganizations.addSeat"));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    expect(h.rpcCalls).toEqual([
      {
        name: "org_add_seat",
        args: { p_org: IDS.org, p_email: "nowy@example.com", p_role: "member" },
      },
    ]);
    expect(lastToast("success")).toBe("adminOrganizations.seatAdded");
    // Po dodaniu pole jest puste (następny adres wpisuje się od zera),
    // a lista odświeżona - inaczej nowe konto nie byłoby widać.
    expect(email).toHaveValue("");
    await waitFor(() =>
      expect(db().chainsFor("organization_seats").length).toBeGreaterThan(seatReadsBefore),
    );
  });

  it("rola WŁAŚCICIELA wybrana w dropliście leci do RPC", async () => {
    // Rolę `owner` waliduje RPC (`org_add_seat`), ale panel musi ją w ogóle
    // wysłać - inaczej każde konto wchodziłoby jako zwykły członek.
    await mountSeats();

    type(screen.getByPlaceholderText("adminOrganizations.accountEmail"), "wlasciciel@example.com");
    // Droplista roli nie ma etykiety dostępnej (`SelectTrigger` bez
    // `aria-label`), więc bierzemy jedyną listę w panelu miejsc.
    type(selects(pane())[0], "owner");
    fireEvent.click(button("adminOrganizations.addSeat"));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    expect(h.rpcCalls.at(-1)?.args).toEqual({
      p_org: IDS.org,
      p_email: "wlasciciel@example.com",
      p_role: "owner",
    });
  });

  it("KONTROLA DODATNIA: Enter w polu adresu NIE dodaje miejsca (inaczej niż na liście)", async () => {
    // Stan faktyczny, nie pożądany: karta obsługuje wyłącznie klik, a lista
    // organizacji ma `onKeyDown` z Enterem. Ujednolicenie to zmiana
    // produkcyjna - tutaj tylko przypinamy różnicę, żeby nie zniknęła
    // przypadkiem w którąkolwiek stronę.
    await mountSeats();

    const email = screen.getByPlaceholderText("adminOrganizations.accountEmail");
    type(email, "nowy@example.com");
    fireEvent.keyDown(email, { key: "Enter" });

    expect(h.rpcCalls).toHaveLength(0);
    expect(email).toHaveValue("nowy@example.com");
  });

  it("puste pole i same spacje: przycisk dodawania zablokowany", async () => {
    await mountSeats();

    expect(button("adminOrganizations.addSeat")).toBeDisabled();
    type(screen.getByPlaceholderText("adminOrganizations.accountEmail"), "   ");
    expect(button("adminOrganizations.addSeat")).toBeDisabled();
    type(screen.getByPlaceholderText("adminOrganizations.accountEmail"), "nowy@example.com");
    expect(button("adminOrganizations.addSeat")).toBeEnabled();
  });

  it("limit miejsc wyczerpany blokuje dodawanie - także dla limitu ZERO", async () => {
    // `0` jest fałszywe w JS: `||` zamiast `??` podstawiłby tu wartość
    // domyślną i pozwolił zapraszać ludzi do organizacji bez ani jednego
    // opłaconego miejsca.
    stubDetail(orgRow({ seats_limit: 0 }));
    db().setResponse("organization_seats", ok([]));
    await mountSeats();

    expect(screen.getByText("0/0")).toBeTruthy();
    type(screen.getByPlaceholderText("adminOrganizations.accountEmail"), "nowy@example.com");
    const add = button("adminOrganizations.addSeat");
    expect(add).toBeDisabled();
    // Karta - w odróżnieniu od listy - nie tłumaczy, DLACZEGO przycisk jest
    // martwy (lista ma `title` z powodem). Przypinamy stan faktyczny.
    expect(add.title).toBe("");
  });

  // Drugi w produkcji egzemplarz mapowania odmów RPC na komunikat (pierwszy
  // jest na liście organizacji, sekcja 1). Testujemy oba, bo oba mogą się
  // rozjechać osobno - i to jest dokładnie argument za wyprowadzeniem tego
  // mapowania do wspólnej funkcji.
  const SEAT_RPC_ERRORS: readonly { rpc: string; toast: string }[] = [
    { rpc: "orgs: seats limit reached", toast: "adminOrganizations.seatLimitReached" },
    { rpc: "orgs: seat exists", toast: "adminOrganizations.seatAlreadyExists" },
    { rpc: "orgs: invalid email", toast: "adminOrganizations.invalidEmail" },
    { rpc: "orgs: not allowed", toast: "adminOrganizations.couldAddSeat" },
  ];

  it.each(SEAT_RPC_ERRORS)("odmowa `$rpc` pokazuje `$toast`", async ({ rpc, toast }) => {
    setRpc("org_add_seat", fail(rpc, "P0001"));
    await mountSeats();

    type(screen.getByPlaceholderText("adminOrganizations.accountEmail"), "nowy@example.com");
    fireEvent.click(button("adminOrganizations.addSeat"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(lastToast("error")).toBe(toast);
    // Nieudane dodanie NIE czyści pola - adres trzeba mieć czym poprawić.
    expect(screen.getByPlaceholderText("adminOrganizations.accountEmail")).toHaveValue(
      "nowy@example.com",
    );
    // I nie udaje sukcesu odświeżeniem listy miejsc.
    expect(db().chainsFor("organization_seats")).toHaveLength(1);
  });

  it("dodawanie W TOKU blokuje przycisk - żadnego drugiego wywołania RPC", async () => {
    h.hangRpc.add("org_add_seat");
    await mountSeats();

    type(screen.getByPlaceholderText("adminOrganizations.accountEmail"), "nowy@example.com");
    fireEvent.click(button("adminOrganizations.addSeat"));

    await waitFor(() => expect(button("adminOrganizations.addSeat")).toBeDisabled());
    fireEvent.click(button("adminOrganizations.addSeat"));
    expect(h.rpcCalls).toHaveLength(1);
  });

  it("usunięcie miejsca wysyła `delete` zawężone po `id` MIEJSCA i odświeża listę", async () => {
    await mountSeats();

    fireEvent.click(button("adminOrganizations.removeSeat"));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    const chain = writeChains("organization_seats").at(-1);
    expect(chain?.calls.map((call) => call.method)).toEqual(["delete", "eq"]);
    expect(chain?.argsOf("eq")).toEqual(["id", IDS.seatMember]);
    expect(lastToast("success")).toBe("adminOrganizations.seatRemoved");
    await waitFor(() => expect(readChains("organization_seats").length).toBeGreaterThan(1));
  });

  it("odmowa bazy przy usuwaniu miejsca pokazuje komunikat BAZY, bez odświeżenia", async () => {
    db().setResponse("organization_seats", (chain) =>
      chain.has("delete") ? fail("orgs: not allowed", "42501") : ok([seatRow()]),
    );
    await mountSeats();

    fireEvent.click(button("adminOrganizations.removeSeat"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(lastToast("error")).toBe("orgs: not allowed");
    expect(readChains("organization_seats")).toHaveLength(1);
  });

  it("usuwanie W TOKU blokuje WSZYSTKIE przyciski usuwania na liście", async () => {
    // Jedna mutacja na komponent: dwa kliknięcia w rzędzie usunęłyby dwa
    // miejsca, a administrator zobaczyłby potwierdzenie tylko jednego.
    db().setResponse("organization_seats", ok(threeSeats()));
    await mountSeats();
    h.hangTables.add("organization_seats");

    fireEvent.click(screen.getAllByRole("button", { name: "adminOrganizations.removeSeat" })[0]);

    await waitFor(() =>
      expect(
        screen
          .getAllByRole("button", { name: "adminOrganizations.removeSeat" })
          .every((element) => element instanceof HTMLButtonElement && element.disabled),
      ).toBe(true),
    );
  });
});

describe("admin.organizations.$id - draft kontra dane odświeżone", () => {
  /**
   * Wiersz organizacji, którego limit miejsc ZMIENIA SIĘ w bazie w trakcie
   * edycji karty - dokładnie to robi funkcja serwerowa miejsc.
   */
  function stubMovingLimit(read: () => number): void {
    db().setResponse("member_organizations", (chain) =>
      chain.has("maybeSingle") ? ok(orgRow({ seats_limit: read() })) : ok(null),
    );
  }

  it.fails(
    "DEFEKT: zapis danych ogólnych COFA liczbę miejsc ustawioną funkcją serwerową",
    async () => {
      // CO JEST ZŁE. `draft` ustawia się RAZ (`admin.organizations.$id.tsx:107`:
      // `if (orgQ.data && !draft) setDraft(orgQ.data)`), a łatka zapisu to CAŁY
      // draft bez kolumn systemowych - razem z `seats_limit`, `seats_source`,
      // `seats_grace_days` i `seats_grace_reminder_days`. Zakładka Miejsca
      // zmienia te kolumny funkcją serwerową i unieważnia zapytanie karty,
      // ale draft zostaje z wartościami sprzed zmiany. Przycisk zapisu robi
      // się przy tym AKTYWNY sam z siebie (draft różni się od danych), więc
      // administrator ma pełne prawo go użyć.
      //
      // SKUTEK DLA UŻYTKOWNIKA. Klient dopłaca do ośmiu miejsc, operator
      // płatności ma osiem, baza ma osiem - a zapis dowolnej zmiany w
      // zakładce Ogólne (np. poprawki miasta) wpisuje z powrotem PIĘĆ,
      // omijając `org_set_seats_limit`. Trzy osoby tracą dostęp za coś, za co
      // klient zapłacił, i nie ma po tym śladu poza `updated_at`.
      //
      // DLACZEGO OSOBNA PRACA. Do wyboru są dwie różne naprawy (łatka zawężona
      // do pól zakładki Ogólne albo odświeżanie draftu przy zmianie danych
      // serwera) i obie zmieniają zachowanie formularza w innych miejscach -
      // to decyzja projektowa, nie poprawka testu.
      let seatsInDb = 5;
      stubMovingLimit(() => seatsInDb);
      await mountSeats();

      // Zmiana liczby miejsc przez funkcję serwerową: baza od tej chwili
      // oddaje osiem, a karta unieważnia własne zapytanie.
      seatsInDb = 8;
      type(screen.getByLabelText("adminOrganizations.seatCount"), "8");
      fireEvent.click(button("adminOrganizations.applySeatCount"));
      await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
      await waitFor(() => expect(readChains("member_organizations").length).toBeGreaterThan(1));

      openTab(TAB.general);
      type(generalInput("city"), "Warszawa");
      fireEvent.click(button("adminOrganizations.save"));

      await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledTimes(2));
      expect(payloadOf("member_organizations", "update").seats_limit).toBe(8);
    },
  );

  it("KONTROLA DODATNIA: po zmianie limitu karta pokazuje STARĄ liczbę i taką wysyła", async () => {
    let seatsInDb = 5;
    stubMovingLimit(() => seatsInDb);
    await mountSeats();

    seatsInDb = 8;
    type(screen.getByLabelText("adminOrganizations.seatCount"), "8");
    fireEvent.click(button("adminOrganizations.applySeatCount"));
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    await waitFor(() => expect(readChains("member_organizations").length).toBeGreaterThan(1));

    // Nagłówek karty nadal mówi „5”, choć baza oddaje już „8”.
    expect(bodyText()).toContain("adminOrganizations.seatLimit: 5");
    // I zapis jest odblokowany BEZ ani jednej zmiany zrobionej ręcznie.
    openTab(TAB.general);
    expect(button("adminOrganizations.save")).toBeEnabled();

    fireEvent.click(button("adminOrganizations.save"));
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledTimes(2));
    expect(payloadOf("member_organizations", "update").seats_limit).toBe(5);
  });
});
