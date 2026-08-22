// PANEL ADMINA - SIEĆ KONTAKTÓW I KOLEJKA ZGŁOSZEŃ
// (`src/lib/admin/network.ts`). 38 linii, trzy funkcje, ZERO wykonanych linii
// przed tym plikiem.
//
// CO TEN PLIK DOWODZI. Ta warstwa jest cienkim transportem do trzech RPC, ale
// przechodzi przez nią KOLEJKA ZGŁOSZEŃ UŻYTKOWNIKÓW - jedyne miejsce, w którym
// redakcja widzi, że ktoś kogoś zgłosił, i jedyne, przez które zgłoszenie da
// się zamknąć. Cienki transport nie znaczy „nie ma czego dowodzić”:
//
//   1. ARGUMENTY. `p_status`, `p_limit`, `p_report_id`, `p_action`, `p_note` -
//      pomyłka w nazwie parametru nie jest błędem typu, bo PostgREST dostaje
//      obiekt JSON: RPC dostanie parametr o innej nazwie i użyje DOMYŚLNEGO,
//      czyli kolejka pokaże inny status niż wybrany, a rozstrzygnięcie
//      zapisze się bez noty.
//   2. ŚCIEŻKA BŁĘDU RZUCA ORYGINALNY OBIEKT (`throw error`, nie
//      `new Error(...)`). Panel czyta z niego `code` (np. `42501` = brak
//      uprawnień), więc opakowanie błędu w nowy `Error` zabiera mu tę
//      informację. Asercja idzie na TOŻSAMOŚĆ obiektu.
//   3. PUSTKA NIE JEST BŁĘDEM: `data: null` z PostgREST daje pustą listę
//      (`?? []`) i `null` dla metryk (`data?.[0] ?? null`) - inaczej panel
//      moderacji wywalałby się na pustej kolejce.
//   4. ODCZYT METRYK NIE MA ARGUMENTÓW - zakres jest w RPC (`is_staff()` we
//      własnym najemcy), nie w parametrze. Gdyby parametr się pojawił, byłby
//      drogą do metryk innej redakcji.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - AUTORYTETU BAZY: że `admin_network_stats`, `admin_list_user_reports`
//   i `admin_resolve_user_report` są SECURITY DEFINER i wymagają `is_staff()`
//   we własnym najemcy - `security_definer_tenant_scope_test.sql`,
//   `rls_tenant_isolation_test.sql`, `tenant_isolation_three_tenants_test.sql`,
//   `connections_network_test.sql`, `network_event_notifications_test.sql`.
//   Na atrapie nie ma RLS, więc żaden test tutaj nie może o tym mówić.
// - KONTRAKTU PARAMETRÓW RPC (nazwy i typy): bramki `check:rpc-contract`
//   i `check:db-contract`. Tutaj dowodzimy, co KOD do nich wysyła.
// - INTERFEJSU PANELU (`admin.community.index.tsx`) i okna zgłoszenia
//   (`src/components/network/__tests__/ReportUserDialog.test.tsx`).
//
// RODO: fixture'y zgłoszeń zawierają wyłącznie umowne imiona i identyfikatory,
// bez adresów e-mail i bez adresów IP - moduł żadnych nie przenosi.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  /** Wywołania RPC w kolejności: nazwa + argumenty. */
  rpcCalls: [] as { name: string; args: unknown }[],
  /** Zaplanowane odpowiedzi per nazwa funkcji bazy. */
  rpcResults: new Map<string, { data: unknown; error: unknown }>(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args?: unknown) => {
      h.rpcCalls.push({ name, args });
      const planned = h.rpcResults.get(name);
      if (!planned) {
        // Brak planu to błąd testu, nie „puste dane”.
        return Promise.resolve({
          data: null,
          error: new Error(`test: brak zaplanowanej odpowiedzi RPC "${name}"`),
        });
      }
      return Promise.resolve(planned);
    },
    // Warstwa MA chodzić wyłącznie przez RPC. Każde `from(...)` oblewa test.
    from: (table: string) => {
      throw new Error(`test: warstwa sięgnęła wprost do tabeli "${table}"`);
    },
  },
}));

import { pgError } from "@/test/supabaseChain";
import { fetchNetworkStats, fetchUserReports, resolveUserReport } from "@/lib/admin/network";

const REPORT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

/** Strażnik runtime zamiast rzutowania. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Argumenty ostatniego wywołania RPC, zawężone strażnikiem. */
function rpcArgs(): Record<string, unknown> {
  const last = h.rpcCalls.at(-1);
  if (!last || !isRecord(last.args)) throw new Error("test: RPC nie dostało obiektu argumentów");
  return last.args;
}

/** Metryki sieci w kształcie, w jakim oddaje je RPC. */
function statsRow(): Record<string, number> {
  return {
    accepted_30d: 12,
    avg_hours_to_accept_30d: 8.5,
    connections_total: 340,
    invites_30d: 25,
    members_with_connection: 88,
    pending_total: 7,
    responded_30d: 20,
  };
}

/** Wiersz kolejki zgłoszeń - bez danych osobowych, patrz nagłówek. */
function reportRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: REPORT_ID,
    created_at: "2026-03-15T12:00:00.000Z",
    reason: "spam",
    details: "Powtarzające się wiadomości reklamowe.",
    reported_id: "22222222-2222-4222-8222-222222222222",
    reported_name: "Konto Zgłoszone",
    reporter_id: "11111111-1111-4111-8111-111111111111",
    reporter_name: "Konto Zgłaszające",
    resolution_note: "",
    resolved_at: "",
    status: "open",
    total_count: 1,
    ...overrides,
  };
}

beforeEach(() => {
  h.rpcCalls = [];
  h.rpcResults = new Map();
});

// ---------------------------------------------------------------------------
// 1. `fetchNetworkStats`.
// ---------------------------------------------------------------------------

describe("sieć kontaktów - fetchNetworkStats", () => {
  it("woła `admin_network_stats` BEZ ARGUMENTÓW", async () => {
    // Brak argumentu jest tu własnością bezpieczeństwa: zakres bierze RPC
    // z sesji (`is_staff()` w najemcy wywołującego). Parametr najemcy byłby
    // drogą do metryk innej redakcji.
    h.rpcResults.set("admin_network_stats", { data: [statsRow()], error: null });
    await fetchNetworkStats();
    expect(h.rpcCalls).toHaveLength(1);
    expect(h.rpcCalls[0]?.name).toBe("admin_network_stats");
    expect(h.rpcCalls[0]?.args).toBeUndefined();
  });

  it("oddaje PIERWSZY wiersz metryk", async () => {
    const row = statsRow();
    h.rpcResults.set("admin_network_stats", { data: [row, statsRow()], error: null });
    expect(await fetchNetworkStats()).toBe(row);
  });

  const EMPTY: readonly { label: string; data: unknown }[] = [
    { label: "pusta lista", data: [] },
    { label: "`null` z PostgREST", data: null },
    { label: "`undefined`", data: undefined },
    { label: "lista z `null` na pierwszej pozycji", data: [null] },
  ];

  it.each(EMPTY)("$label daje `null`, nie wyjątek", async ({ data }) => {
    // `data?.[0] ?? null`. Kokpit sieci renderuje się na świeżej instalacji,
    // w której nie ma jeszcze ani jednego połączenia - wyjątek zamiast `null`
    // zabrałby wtedy całą stronę, nie tylko jedną kartę.
    h.rpcResults.set("admin_network_stats", { data, error: null });
    expect(await fetchNetworkStats()).toBeNull();
  });

  it("zerowe metryki przechodzą jako zera, nie jako brak danych", async () => {
    // Wartość FAŁSZYWA, ale PRAWIDŁOWA: „zero zaproszeń w 30 dni” to wynik.
    // Zgubienie zera pokazałoby w kokpicie puste miejsce zamiast liczby.
    const row = { ...statsRow(), invites_30d: 0, connections_total: 0 };
    h.rpcResults.set("admin_network_stats", { data: [row], error: null });
    const result = await fetchNetworkStats();
    expect(result).toBe(row);
    expect(row.invites_30d).toBe(0);
  });

  it("błąd RPC rzuca ORYGINALNY obiekt błędu - z kodem `42501`", async () => {
    // `throw error`, nie `throw new Error(error.message)`. Panel pokazuje
    // inny komunikat dla braku uprawnień niż dla awarii, a rozpoznaje to po
    // `code` - opakowanie w nowy `Error` zabrałoby mu tę informację.
    const error = pgError("permission denied for function admin_network_stats", "42501");
    h.rpcResults.set("admin_network_stats", { data: null, error });
    await expect(fetchNetworkStats()).rejects.toBe(error);
  });
});

// ---------------------------------------------------------------------------
// 2. `fetchUserReports`.
// ---------------------------------------------------------------------------

describe("sieć kontaktów - fetchUserReports", () => {
  const STATUSES: readonly { label: string; status: string }[] = [
    { label: "otwarte", status: "open" },
    { label: "rozstrzygnięte", status: "resolved" },
    { label: "odrzucone", status: "dismissed" },
    { label: "status PUSTY (wartość FAŁSZYWA, ale PRAWIDŁOWA)", status: "" },
    { label: "status spoza słownika", status: "nie-ma-takiego-statusu" },
  ];

  it.each(STATUSES)("$label jedzie do RPC dosłownie", async ({ status }) => {
    // Warstwa nie filtruje ani nie normalizuje statusu - decyzję podejmuje
    // RPC. Test przypina to wprost, żeby nikt nie zakładał tu walidacji
    // słownika (pusty napis też przejdzie i po prostu nic nie dopasuje).
    h.rpcResults.set("admin_list_user_reports", { data: [], error: null });
    await fetchUserReports(status);
    expect(rpcArgs().p_status).toBe(status);
  });

  it("stan faktyczny: limit jest STAŁY (50) i NIE MA parametru przesunięcia", async () => {
    // Świadome przypięcie z ostrzeżeniem, nie pochwała. Kolejka zgłoszeń jest
    // ucięta na 50 wierszach, a wiersz niesie `total_count`, którego panel nie
    // pokazuje - przy 51 otwartych zgłoszeniach moderator nie ma ani jak
    // zobaczyć resztę, ani skąd wiedzieć, że coś zostało. Zmiana tego to
    // stronicowanie w panelu (osobna praca), a nie poprawka w tej linii.
    h.rpcResults.set("admin_list_user_reports", { data: [], error: null });
    await fetchUserReports("open");
    expect(rpcArgs()).toEqual({ p_status: "open", p_limit: 50 });
    expect(Object.keys(rpcArgs())).not.toContain("p_offset");
  });

  it("oddaje wiersze NIETKNIĘTE", async () => {
    // Zgłoszenie jest materiałem moderacyjnym - żadnego mapowania po drodze.
    const rows = [reportRow(), reportRow({ id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" })];
    h.rpcResults.set("admin_list_user_reports", { data: rows, error: null });
    expect(await fetchUserReports("open")).toBe(rows);
  });

  it.each([
    { label: "pusta lista", data: [] },
    { label: "`null` z PostgREST", data: null },
    { label: "`undefined`", data: undefined },
  ])("$label daje pustą tablicę", async ({ data }) => {
    // `?? []`. `null` w miejscu listy wywala mapowanie w tabeli kolejki.
    h.rpcResults.set("admin_list_user_reports", { data, error: null });
    expect(await fetchUserReports("open")).toEqual([]);
  });

  it("błąd RPC rzuca ORYGINALNY obiekt błędu", async () => {
    // Pusta kolejka przy odmowie znaczyłaby „nie ma nic do moderacji”, czyli
    // odwrotność prawdy - błąd musi wyjść na wierzch.
    const error = pgError("not_authorized", "P0001");
    h.rpcResults.set("admin_list_user_reports", { data: null, error });
    await expect(fetchUserReports("open")).rejects.toBe(error);
  });
});

// ---------------------------------------------------------------------------
// 3. `resolveUserReport`.
// ---------------------------------------------------------------------------

describe("sieć kontaktów - resolveUserReport", () => {
  const ACTIONS: readonly ("resolved" | "dismissed")[] = ["resolved", "dismissed"];

  it.each(ACTIONS)("akcja `%s` jedzie do RPC z identyfikatorem zgłoszenia", async (action) => {
    // Dwie różne decyzje moderacyjne - „rozstrzygnięte” i „odrzucone” - muszą
    // dojść rozróżnione. Ich zamiana zmienia znaczenie wpisu w historii
    // moderacji.
    h.rpcResults.set("admin_resolve_user_report", { data: null, error: null });
    await resolveUserReport(REPORT_ID, action, "sprawdzone");
    expect(h.rpcCalls[0]?.name).toBe("admin_resolve_user_report");
    expect(rpcArgs()).toEqual({
      p_report_id: REPORT_ID,
      p_action: action,
      p_note: "sprawdzone",
    });
  });

  const NOTES: readonly { label: string; note: string | undefined; sent: unknown }[] = [
    { label: "nota podana", note: "zgłoszenie potwierdzone", sent: "zgłoszenie potwierdzone" },
    { label: "brak noty", note: undefined, sent: undefined },
    { label: "nota PUSTA (wartość FAŁSZYWA, ale PRAWIDŁOWA)", note: "", sent: "" },
  ];

  it.each(NOTES)("$label", async ({ note, sent }) => {
    // Nota jest opcjonalnym parametrem RPC. `undefined` MUSI zostać
    // `undefined` (PostgREST usuwa je z ciała żądania, więc baza użyje
    // wartości domyślnej), a PUSTY napis jest wartością i zapisze się jako
    // pusta nota - to dwie różne rzeczy w historii moderacji.
    h.rpcResults.set("admin_resolve_user_report", { data: null, error: null });
    await resolveUserReport(REPORT_ID, "resolved", note);
    expect(rpcArgs().p_note).toBe(sent);
    // Klucz jest wysyłany ZAWSZE - to `JSON.stringify` usuwa `undefined`,
    // nie ten kod. Asercja pilnuje, że nikt nie zaczął tu budować obiektu
    // warunkowo (co zmieniłoby kształt żądania).
    expect(Object.keys(rpcArgs()).sort()).toEqual(["p_action", "p_note", "p_report_id"]);
  });

  it("nie oddaje żadnej wartości - wynik czyta się z odświeżenia listy", async () => {
    h.rpcResults.set("admin_resolve_user_report", { data: null, error: null });
    expect(await resolveUserReport(REPORT_ID, "resolved")).toBeUndefined();
  });

  it("błąd RPC rzuca ORYGINALNY obiekt błędu", async () => {
    // Ciche przełknięcie błędu jest tu najgroźniejsze: moderator widzi, że
    // zgłoszenie „zniknęło” z kolejki po odświeżeniu, a ono nadal jest
    // otwarte - albo odwrotnie, klika drugi raz w to samo.
    const error = pgError("report not found", "P0002");
    h.rpcResults.set("admin_resolve_user_report", { data: null, error });
    await expect(resolveUserReport(REPORT_ID, "dismissed")).rejects.toBe(error);
  });
});
