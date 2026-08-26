// PANEL SUPERADMINA COMMUNITY - WARSTWA DANYCH (`src/lib/admin/community.ts`).
// 885 linii, 53 funkcje, 271 gałęzi, ZERO wykonanych linii przed tym plikiem.
//
// CO TEN PLIK DOWODZI. Przez tę warstwę idzie CAŁA redakcyjna praca nad czatem,
// wydarzeniami, Q&A, ankietami, programem współtwórców i powiadomieniami: to
// jedyne miejsce, w którym panel formułuje zapytania do bazy. Przedmiotem dowodu
// jest więc KSZTAŁT ZAPYTANIA, a nie to, czy baza je przepuści:
//
//   1. KSZTAŁT: nazwa tabeli, lista kolumn, filtry, KOLEJNOŚĆ ogniw łańcucha,
//      `limit`, `order`. Zapytanie o właściwym kształcie, ale bez `limit`,
//      ściąga panelowi całą tabelę; bez `eq` na sesji - pytania z obcej sesji;
//      z `select("*")` na `qa_questions` - kolumnę `user_id`, do której panel
//      nie ma grantu (anonimowość pytających), czyli 42501 na całym widoku.
//   2. TOGGLE MODUŁÓW (`site_settings.community_modules`): włączenie,
//      wyłączenie, BRAK WIERSZA i wartość NIEZNANA. Cztery różne stany, jeden
//      wynik - a `!== false` (moduły włączane domyślnie) i `=== true` (kluby
//      opt-in) czytają je odwrotnie. Pomyłka tutaj albo chowa wszystkim moduł,
//      albo pokazuje wszystkim ten, którego nikt nie włączył.
//   3. ODPORNOŚĆ ODCZYTU: `data: null` z PostgREST, pusty wynik, wiersz
//      z wartością FAŁSZYWĄ ALE PRAWIDŁOWĄ (`0`, `""`, `false`) oraz wartość
//      o złym TYPIE (napis w miejscu liczby) - jsonb i RPC nie mają tu schematu,
//      więc jedyną zaporą jest ten kod.
//   4. ŚCIEŻKA BŁĘDU: każda funkcja przy `pgError`/`fail(...)` MUSI rzucić,
//      a nie oddać pustą listę - cicha pustka w panelu moderacji znaczy
//      „nie ma nic do moderacji", czyli dokładnie odwrotność prawdy.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - AUTORYTETU BAZY (czy RLS `*_staff_*` przepuści redaktora, czy najemca jest
//   zawężony): `rls_tenant_isolation_test.sql`,
//   `security_definer_tenant_scope_test.sql`,
//   `chat_conversation_tenant_isolation_test.sql`, `community_events_test.sql`,
//   `community_qa_test.sql`, `community_qa_summary_test.sql`,
//   `community_polls_contrib_test.sql`, `push_and_digest_test.sql`.
//   Tu atrapa nie może „nie przepuścić” nikogo - w ogóle nie ma RLS.
// - SŁOWNIKÓW i18n: `src/lib/__tests__/i18nAdminCommunity.test.ts` oraz
//   `i18nAdminCommunityEvents.test.ts` sprawdzają, że wskazane klucze istnieją
//   w PL i EN. Tutaj asercje idą na KLUCZE, nigdy na napisy.
// - INTERFEJSU PANELI: testy tras `src/routes/__tests__/*`.
//
// RODO: żadnych realnych danych osobowych - adresy wyłącznie w `example.com`,
// identyfikatory umowne, zero adresów IP.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RecordedChain, SupabaseFromStub, SupabaseResult } from "@/test/supabaseChain";

/** Ustalona „teraz” - warstwa stempluje `answered_at`/`reviewed_at`/okno 24h. */
const BASE_NOW = new Date("2026-03-15T12:00:00.000Z");
/** BASE_NOW minus 24 h - okno, którego oczekuje `fetchNotificationStats`. */
const SINCE_24H = new Date("2026-03-14T12:00:00.000Z").toISOString();

const h = vi.hoisted(() => ({
  db: null as SupabaseFromStub | null,
  /** Wywołania RPC w kolejności: nazwa + argumenty. */
  rpcCalls: [] as { fn: string; args: unknown }[],
  /** Zaplanowane odpowiedzi RPC per nazwa funkcji bazy. */
  rpcResults: new Map<string, SupabaseResult>(),
  /** Tożsamość z sesji - `null` znaczy „brak sesji”. */
  sessionUserId: null as string | null,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (!h.db) throw new Error("test: atrapa bazy nieustawiona");
      return h.db.from(table);
    },
    rpc: (fn: string, args?: unknown) => {
      h.rpcCalls.push({ fn, args });
      const planned = h.rpcResults.get(fn);
      if (!planned) {
        // Brak planu to błąd testu, nie „puste dane”: ciche `null` udawałoby
        // poprawną odpowiedź funkcji, której test w ogóle nie przewidział.
        return Promise.resolve({
          data: null,
          error: new Error(`test: brak zaplanowanej odpowiedzi RPC "${fn}"`),
        });
      }
      return Promise.resolve(planned);
    },
  },
}));

// `createQaSession` importuje tożsamość dynamicznie (rozdzielenie chunków).
vi.mock("@/lib/auth/currentUser", () => ({
  currentUserIdFromSession: () => Promise.resolve(h.sessionUserId),
}));

import { fail, ok, okCount, supabaseFromStub } from "@/test/supabaseChain";
import { escapeLike } from "@/lib/admin/listFilters";
import {
  COMMUNITY_MODULES_DEFAULTS,
  COMMUNITY_MODULES_KEY,
  EVENT_KINDS,
  EVENT_KIND_LABEL_KEYS,
  EVENT_STATUSES,
  EVENT_STATUS_LABEL_KEYS,
  addEventSpeaker,
  createEventSpeakerPerson,
  cleanupFailedPushSubscriptions,
  createEvent,
  createPoll,
  createQaSession,
  deleteAdminSpeakerProfile,
  deleteConversation,
  deleteEvent,
  deletePoll,
  fetchAdminConversations,
  fetchAdminEvent,
  fetchAdminEvents,
  fetchAdminPolls,
  fetchAdminSpeakerProfile,
  fetchCommunityModules,
  fetchCommunityStats,
  fetchContributorSubmissions,
  fetchConversationMessages,
  fetchEngagementOverview,
  fetchEventSpeakers,
  fetchNotificationStats,
  fetchPollResults,
  fetchQaQuestions,
  fetchQaSessions,
  isEventKind,
  isEventStatus,
  moderateQaQuestion,
  publishQaSessionSummary,
  purgeExpiredMessages,
  removeEventSpeaker,
  reviewContributorSubmission,
  runEventReminders,
  setEventSpeakerOrder,
  softDeleteMessage,
  updateCommunityModules,
  updateEvent,
  updateEventStatus,
  updatePollStatus,
  updateQaSession,
  upsertAdminSpeakerProfile,
} from "@/lib/admin/community";

function db(): SupabaseFromStub {
  const value = h.db;
  if (!value) throw new Error("test: atrapa bazy nieustawiona");
  return value;
}

/** Ostatni łańcuch dla tabeli - z komunikatem, gdy zapytania w ogóle nie było. */
function chain(table: string): RecordedChain {
  const last = db().lastChain(table);
  if (!last) throw new Error(`test: brak zapytania do tabeli "${table}"`);
  return last;
}

/** Nazwy ogniw łańcucha w kolejności wywołania - dowód KSZTAŁTU zapytania. */
function links(table: string): string[] {
  return chain(table).calls.map((call) => call.method);
}

function setRpc(fn: string, result: SupabaseResult): void {
  h.rpcResults.set(fn, result);
}

/** Argumenty ostatniego wywołania danej funkcji bazy. */
function rpcArgs(fn: string): unknown {
  const call = h.rpcCalls.filter((entry) => entry.fn === fn).at(-1);
  if (!call) throw new Error(`test: RPC "${fn}" nie zostało wywołane`);
  return call.args;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(BASE_NOW);
  h.db = supabaseFromStub();
  h.rpcCalls.length = 0;
  h.rpcResults.clear();
  h.sessionUserId = "11111111-1111-4111-8111-111111111111";
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Metryki kokpitu
// ---------------------------------------------------------------------------

describe("fetchCommunityStats", () => {
  it("czyta wszystkie sześć metryk jednym round-tripem do admin_community_stats", async () => {
    setRpc(
      "admin_community_stats",
      ok({
        conversations_total: 12,
        messages_last_24h: 340,
        events_upcoming: 3,
        events_drafts: 1,
        qa_sessions_open: 2,
        qa_questions_pending: 7,
      }),
    );
    await expect(fetchCommunityStats()).resolves.toEqual({
      conversations_total: 12,
      messages_last_24h: 340,
      events_upcoming: 3,
      events_drafts: 1,
      qa_sessions_open: 2,
      qa_questions_pending: 7,
    });
    // Jedno wywołanie - metryki nie mogą rozjechać się na sześć zapytań.
    expect(h.rpcCalls.map((call) => call.fn)).toEqual(["admin_community_stats"]);
    expect(db().chains).toEqual([]);
  });

  it("liczby podane jako napisy sprowadza do liczb (jsonb nie ma schematu)", async () => {
    setRpc(
      "admin_community_stats",
      ok({
        conversations_total: "12",
        messages_last_24h: "0",
        events_upcoming: 3,
        events_drafts: "nie-liczba",
        qa_sessions_open: null,
        qa_questions_pending: undefined,
      }),
    );
    const stats = await fetchCommunityStats();
    expect(stats.conversations_total).toBe(12);
    // Zero jako NAPIS musi zostać zerem, a nie wpaść w ścieżkę „brak danych”.
    expect(stats.messages_last_24h).toBe(0);
    expect(stats.events_upcoming).toBe(3);
    // Napis nieliczbowy daje NaN - to jedyna gałąź, w której panel pokaże NaN.
    expect(Number.isNaN(stats.events_drafts)).toBe(true);
    // `null`/`undefined` idą przez `?? 0`, więc panel widzi zero.
    expect(stats.qa_sessions_open).toBe(0);
    expect(stats.qa_questions_pending).toBe(0);
  });

  it("brak zwrotki (data: null) daje same zera, a nie wyjątek", async () => {
    setRpc("admin_community_stats", ok(null));
    await expect(fetchCommunityStats()).resolves.toEqual({
      conversations_total: 0,
      messages_last_24h: 0,
      events_upcoming: 0,
      events_drafts: 0,
      qa_sessions_open: 0,
      qa_questions_pending: 0,
    });
  });

  it("błąd bazy podnosi wyjątek (kokpit nie może pokazać wyzerowanych metryk)", async () => {
    setRpc("admin_community_stats", fail("permission denied for function", "42501"));
    await expect(fetchCommunityStats()).rejects.toThrow("permission denied for function");
  });
});

// ---------------------------------------------------------------------------
// Toggle modułów społeczności (site_settings.community_modules)
// ---------------------------------------------------------------------------

/** Moduły włączane DOMYŚLNIE - czytane przez `!== false`. */
const OPT_OUT_MODULES = [
  "chat_enabled",
  "connections_enabled",
  "events_enabled",
  "qa_enabled",
  "polls_enabled",
  "contributor_program_enabled",
  "badges_enabled",
  "push_enabled",
  "expert_requests_enabled",
] as const;

/** Ustawia wiersz `site_settings` (albo jego brak) dla odczytu modułów. */
function wireModulesRow(value: unknown | undefined): void {
  db().setResponse("site_settings", (recorded) => {
    if (recorded.has("upsert")) return ok(null);
    return ok(value === undefined ? null : { value });
  });
}

describe("fetchCommunityModules - kształt zapytania", () => {
  it("czyta JEDEN wiersz po kluczu community_modules i tylko kolumnę value", async () => {
    wireModulesRow({});
    await fetchCommunityModules();
    expect(chain("site_settings").table).toBe("site_settings");
    expect(links("site_settings")).toEqual(["select", "eq", "maybeSingle"]);
    expect(chain("site_settings").argsOf("select")).toEqual(["value"]);
    expect(chain("site_settings").argsOf("eq")).toEqual(["key", COMMUNITY_MODULES_KEY]);
    // `maybeSingle`, nie `single`: brak wiersza to normalny stan świeżego
    // tenanta, a `single` zwróciłby wtedy błąd PGRST116 i wywalił panel.
    expect(chain("site_settings").has("single")).toBe(false);
  });

  it("błąd odczytu podnosi wyjątek", async () => {
    db().setResponse("site_settings", fail("boom", "42501"));
    await expect(fetchCommunityModules()).rejects.toThrow("boom");
  });
});

describe("fetchCommunityModules - cztery stany każdego przełącznika", () => {
  it("BRAK WIERSZA: moduły opt-out włączone, kluby wyłączone, TTL bez wartości", async () => {
    wireModulesRow(undefined);
    const modules = await fetchCommunityModules();
    expect(modules).toEqual(COMMUNITY_MODULES_DEFAULTS);
  });

  it("WIERSZ Z value: null zachowuje się jak brak wiersza", async () => {
    wireModulesRow(null);
    await expect(fetchCommunityModules()).resolves.toEqual(COMMUNITY_MODULES_DEFAULTS);
  });

  it("PUSTY OBIEKT: tak samo jak brak wiersza", async () => {
    wireModulesRow({});
    await expect(fetchCommunityModules()).resolves.toEqual(COMMUNITY_MODULES_DEFAULTS);
  });

  it.each(OPT_OUT_MODULES)("WYŁĄCZENIE: %s === false gasi tylko ten moduł", async (key) => {
    wireModulesRow({ [key]: false });
    const modules = await fetchCommunityModules();
    expect(modules[key]).toBe(false);
    for (const other of OPT_OUT_MODULES) {
      if (other === key) continue;
      expect(modules[other]).toBe(true);
    }
  });

  it.each(OPT_OUT_MODULES)("WŁĄCZENIE JAWNE: %s === true", async (key) => {
    wireModulesRow({ [key]: true });
    await expect(fetchCommunityModules()).resolves.toMatchObject({ [key]: true });
  });

  it.each([
    ["napis", "false"],
    ["zero", 0],
    ["pusty napis", ""],
    ["null", null],
    ["obiekt", {}],
  ])(
    "WARTOŚĆ NIEZNANA (%s) nie gasi modułu opt-out - gasi go wyłącznie `false`",
    async (_label, value) => {
      wireModulesRow({ chat_enabled: value });
      // Konsekwencja odwrotnej decyzji byłaby dotkliwa: napis "false"
      // w jsonb (najczęstszy błąd ręcznej edycji wiersza) gasiłby czat
      // wszystkim użytkownikom tenanta.
      await expect(fetchCommunityModules()).resolves.toMatchObject({ chat_enabled: true });
    },
  );

  it.each([
    ["true (jawne włączenie)", true, true],
    ["napis „true”", "true", false],
    ["jedynka", 1, false],
    ["false", false, false],
    ["null", null, false],
  ])("KLUBY są opt-in: %s => %s", async (_label, value, expected) => {
    wireModulesRow({ clubs_enabled: value });
    await expect(fetchCommunityModules()).resolves.toMatchObject({ clubs_enabled: expected });
  });

  it.each([
    ["liczba", 3600, 3600],
    ["ZERO (fałszywe, ale prawidłowe)", 0, 0],
    ["napis", "3600", null],
    ["null", null, null],
  ])("TTL wiadomości: %s => %s", async (_label, value, expected) => {
    wireModulesRow({ default_message_ttl_seconds: value });
    const modules = await fetchCommunityModules();
    // `0` znaczy „bez opóźnienia", a nie „brak ustawienia” - gdyby czytać to
    // przez prawdziwość, administrator nie mógłby ustawić zera.
    expect(modules.default_message_ttl_seconds).toBe(expected);
  });
});

describe("updateCommunityModules", () => {
  it("czyta stan bieżący, scala łatkę i zapisuje CAŁOŚĆ z onConflict tenant_id,key", async () => {
    const upserts: unknown[] = [];
    db().setResponse("site_settings", (recorded) => {
      if (recorded.has("upsert")) {
        upserts.push(recorded.argsOf("upsert"));
        return ok(null);
      }
      // Stan bieżący: czat już wyłączony, kluby włączone, TTL 60 s.
      return ok({
        value: { chat_enabled: false, clubs_enabled: true, default_message_ttl_seconds: 60 },
      });
    });

    const next = await updateCommunityModules({ events_enabled: false });

    // KOLEJNOŚĆ: najpierw odczyt, potem zapis. Zapis bez odczytu zdmuchnąłby
    // przełączniki, których panel w danym ekranie nie pokazuje.
    const shapes = db().chainsFor("site_settings");
    expect(shapes).toHaveLength(2);
    expect(shapes[0].has("select")).toBe(true);
    expect(shapes[1].has("upsert")).toBe(true);

    expect(upserts).toEqual([
      [
        {
          key: COMMUNITY_MODULES_KEY,
          value: {
            ...COMMUNITY_MODULES_DEFAULTS,
            chat_enabled: false,
            clubs_enabled: true,
            default_message_ttl_seconds: 60,
            events_enabled: false,
          },
        },
        { onConflict: "tenant_id,key" },
      ],
    ]);
    expect(next.events_enabled).toBe(false);
    expect(next.chat_enabled).toBe(false);
    expect(next.clubs_enabled).toBe(true);
  });

  it("pusta łatka zapisuje stan bieżący bez zmian", async () => {
    wireModulesRow({ qa_enabled: false });
    const next = await updateCommunityModules({});
    expect(next.qa_enabled).toBe(false);
    expect(db().chainsFor("site_settings")).toHaveLength(2);
  });

  it("błąd ODCZYTU przerywa całość - nie ma zapisu na niepełnym stanie", async () => {
    db().setResponse("site_settings", (recorded) =>
      recorded.has("upsert") ? ok(null) : fail("read denied", "42501"),
    );
    await expect(updateCommunityModules({ chat_enabled: false })).rejects.toThrow("read denied");
    // Dowód, że zapis się NIE odbył: tylko jeden łańcuch, ten odczytowy.
    expect(db().chainsFor("site_settings")).toHaveLength(1);
  });

  it("błąd ZAPISU podnosi wyjątek", async () => {
    db().setResponse("site_settings", (recorded) =>
      recorded.has("upsert") ? fail("write denied", "42501") : ok({ value: {} }),
    );
    await expect(updateCommunityModules({ chat_enabled: false })).rejects.toThrow("write denied");
  });
});

// ---------------------------------------------------------------------------
// Czat: lista rozmów, wiadomości, kasowanie
// ---------------------------------------------------------------------------

const CONV_A = { id: "conv-a", tenant_id: "tenant-1", last_message_preview: "Bruksela" };
const CONV_B = { id: "conv-b", tenant_id: "tenant-1", last_message_preview: null };

describe("fetchAdminConversations - kształt zapytania", () => {
  beforeEach(() => {
    db().setResponse("conversations", ok([]));
  });

  it("sortuje po last_message_at malejąco z nullsFirst: false i limituje domyślnie do 100", async () => {
    await fetchAdminConversations({});
    expect(links("conversations")).toEqual(["select", "order", "limit"]);
    expect(chain("conversations").argsOf("order")).toEqual([
      "last_message_at",
      { ascending: false, nullsFirst: false },
    ]);
    // Bez `limit` panel ściągnąłby całą tabelę rozmów tenanta.
    expect(chain("conversations").argsOf("limit")).toEqual([100]);
  });

  it("respektuje jawny limit (także taki, który wygląda na fałszywy)", async () => {
    await fetchAdminConversations({ limit: 5 });
    expect(chain("conversations").argsOf("limit")).toEqual([5]);
  });

  it('wybiera kolumny jawnie, bez `select("*")`', async () => {
    await fetchAdminConversations({});
    const columns = chain("conversations").argsOf("select")?.[0];
    expect(typeof columns).toBe("string");
    if (typeof columns !== "string") throw new Error("test: lista kolumn nie jest napisem");
    expect(columns).not.toContain("*");
    for (const column of ["id", "last_message_at", "last_message_preview", "message_ttl_seconds"]) {
      expect(columns.split(", ")).toContain(column);
    }
  });

  it.each([
    ["brak frazy", undefined],
    ["pusta fraza", ""],
    ["same spacje", "   "],
  ])("%s nie dokłada filtra ilike", async (_label, search) => {
    await fetchAdminConversations({ search });
    expect(chain("conversations").has("ilike")).toBe(false);
  });

  it("fraza jest przycinana i szuka po podglądzie ostatniej wiadomości", async () => {
    await fetchAdminConversations({ search: "  Bruksela  " });
    expect(links("conversations")).toEqual(["select", "order", "limit", "ilike"]);
    expect(chain("conversations").argsOf("ilike")).toEqual(["last_message_preview", "%Bruksela%"]);
  });

  it.fails(
    "DEFEKT: fraza z panelu nie przechodzi przez escapeLike - `%` z wejścia działa jak wildcard",
    async () => {
      // CO: `community.ts:115` wstawia frazę wprost do wzorca ILIKE
      // (`%${params.search.trim()}%`), choć ten sam katalog eksportuje
      // `escapeLike` (`src/lib/admin/listFilters.ts:7`) i używają go obie
      // pozostałe wyszukiwarki panelu (`postsListQuery.ts:167`,
      // `admin.pages.tsx:144`).
      // KONSEKWENCJA: szukanie frazy „100%” albo „a_b” daje wzorzec
      // z wildcardem - moderator dostaje wynik szerszy niż fraza, a przy
      // pustym rdzeniu (sama fraza „%") wszystkie rozmowy tenanta.
      // Naprawa to jedna linia w produkcji, dlatego test jest deklaratywny.
      await fetchAdminConversations({ search: "100%" });
      expect(chain("conversations").argsOf("ilike")).toEqual([
        "last_message_preview",
        `%${escapeLike("100%")}%`,
      ]);
    },
  );

  it("błąd odczytu rozmów podnosi wyjątek", async () => {
    db().setResponse("conversations", fail("conversations denied", "42501"));
    await expect(fetchAdminConversations({})).rejects.toThrow("conversations denied");
  });
});

describe("fetchAdminConversations - liczniki uczestników i wiadomości", () => {
  it("dolicza uczestników i NIEUSUNIĘTE wiadomości do właściwych rozmów", async () => {
    db().setResponse("conversations", ok([CONV_A, CONV_B]));
    db().setResponse(
      "conversation_participants",
      ok([
        { conversation_id: "conv-a" },
        { conversation_id: "conv-a" },
        { conversation_id: "conv-b" },
      ]),
    );
    db().setResponse("messages", ok([{ conversation_id: "conv-a" }]));

    const rows = await fetchAdminConversations({});

    expect(rows).toEqual([
      { ...CONV_A, participants_count: 2, messages_count: 1 },
      // Rozmowa bez ani jednej wiadomości musi pokazać 0, nie `undefined`.
      { ...CONV_B, participants_count: 1, messages_count: 0 },
    ]);
    // Liczniki jadą JEDNYM zapytaniem na tabelę, zawężonym do widocznych rozmów.
    expect(links("conversation_participants")).toEqual(["select", "in"]);
    expect(chain("conversation_participants").argsOf("in")).toEqual([
      "conversation_id",
      ["conv-a", "conv-b"],
    ]);
    expect(links("messages")).toEqual(["select", "in", "is"]);
    // `deleted_at is null` - moderator nie może liczyć wiadomości skasowanych
    // miękko, bo wtedy „wyczyszczona” rozmowa nadal wygląda na aktywną.
    expect(chain("messages").argsOf("is")).toEqual(["deleted_at", null]);
  });

  // GAŁĄŹ NIEOSIĄGALNA: `community.ts:138` ma drugie `(data ?? [])` w mapowaniu
  // wyniku. Przy `data: null` funkcja wychodzi wcześniej (`ids.length === 0`
  // w linii 120), więc prawe ramię tego `??` nie da się wykonać bez zmiany
  // kodu produkcyjnego. Nie naciągamy testu - to jedyna niepokryta gałąź pliku.
  it.each([
    ["pusta lista rozmów", ok([])],
    ["data: null z PostgREST", ok(null)],
  ])("%s: zwraca [] i NIE pyta o liczniki", async (_label, response) => {
    db().setResponse("conversations", response);
    await expect(fetchAdminConversations({})).resolves.toEqual([]);
    expect(db().chainsFor("conversation_participants")).toEqual([]);
    expect(db().chainsFor("messages")).toEqual([]);
  });

  it("brak wiersza w tabelach licznikowych (data: null) daje zera, nie wyjątek", async () => {
    db().setResponse("conversations", ok([CONV_A]));
    db().setResponse("conversation_participants", ok(null));
    db().setResponse("messages", ok(null));
    await expect(fetchAdminConversations({})).resolves.toEqual([
      { ...CONV_A, participants_count: 0, messages_count: 0 },
    ]);
  });

  it("odmowa na zapytaniu licznikowym pokazuje zera - liczniki są best-effort", async () => {
    // Ta asercja DOKUMENTUJE zachowanie, a nie je chwali: błąd zapytania
    // licznikowego jest pochłaniany (kod czyta tylko `.data`), więc panel
    // pokaże „0 uczestników” zamiast informacji o odmowie. Lista rozmów
    // pozostaje przy tym poprawna, dlatego to świadomy kompromis, a nie defekt.
    db().setResponse("conversations", ok([CONV_A]));
    db().setResponse("conversation_participants", fail("participants denied", "42501"));
    db().setResponse("messages", fail("messages denied", "42501"));
    await expect(fetchAdminConversations({})).resolves.toEqual([
      { ...CONV_A, participants_count: 0, messages_count: 0 },
    ]);
  });
});

describe("fetchConversationMessages", () => {
  it("czyta ostatnie 100 wiadomości JEDNEJ rozmowy, najnowsze pierwsze", async () => {
    db().setResponse("messages", ok([{ id: "msg-1" }]));
    await expect(fetchConversationMessages("conv-a")).resolves.toEqual([{ id: "msg-1" }]);
    expect(links("messages")).toEqual(["select", "eq", "order", "limit"]);
    expect(chain("messages").argsOf("select")).toEqual(["*"]);
    // Bez `eq` moderator zobaczyłby wiadomości z innych rozmów tenanta.
    expect(chain("messages").argsOf("eq")).toEqual(["conversation_id", "conv-a"]);
    expect(chain("messages").argsOf("order")).toEqual(["created_at", { ascending: false }]);
    expect(chain("messages").argsOf("limit")).toEqual([100]);
  });

  it("data: null daje pustą listę", async () => {
    db().setResponse("messages", ok(null));
    await expect(fetchConversationMessages("conv-a")).resolves.toEqual([]);
  });

  it("błąd podnosi wyjątek", async () => {
    db().setResponse("messages", fail("messages denied", "42501"));
    await expect(fetchConversationMessages("conv-a")).rejects.toThrow("messages denied");
  });
});

describe("deleteConversation", () => {
  it("kasuje dokładnie jeden wiersz po id", async () => {
    db().setResponse("conversations", ok(null));
    await deleteConversation("conv-a");
    expect(links("conversations")).toEqual(["delete", "eq"]);
    expect(chain("conversations").argsOf("eq")).toEqual(["id", "conv-a"]);
  });

  it("błąd podnosi wyjątek", async () => {
    db().setResponse("conversations", fail("delete denied", "42501"));
    await expect(deleteConversation("conv-a")).rejects.toThrow("delete denied");
  });
});

describe("softDeleteMessage", () => {
  it("idzie przez RPC admin_soft_delete_message, nie przez UPDATE z klienta", async () => {
    setRpc("admin_soft_delete_message", ok(null));
    await softDeleteMessage("msg-1");
    expect(rpcArgs("admin_soft_delete_message")).toEqual({ p_message_id: "msg-1" });
    // Żadnego zapytania tabelowego: kasowanie miękkie ma jednego właściciela.
    expect(db().chains).toEqual([]);
  });

  it("błąd podnosi wyjątek", async () => {
    setRpc("admin_soft_delete_message", fail("rpc denied", "42501"));
    await expect(softDeleteMessage("msg-1")).rejects.toThrow("rpc denied");
  });
});

describe("purgeExpiredMessages", () => {
  it.each([
    ["liczba skasowanych", 42, 42],
    ["ZERO (nic nie wygasło)", 0, 0],
    ["zwrotka nie-liczbowa", "12", 0],
    ["brak zwrotki", null, 0],
  ])("%s => %s", async (_label, data, expected) => {
    setRpc("chat_purge_expired_messages", ok(data));
    await expect(purgeExpiredMessages()).resolves.toBe(expected);
  });

  it("błąd podnosi wyjątek", async () => {
    setRpc("chat_purge_expired_messages", fail("purge denied", "42501"));
    await expect(purgeExpiredMessages()).rejects.toThrow("purge denied");
  });
});

// ---------------------------------------------------------------------------
// Wydarzenia
// ---------------------------------------------------------------------------

describe("słowniki wydarzeń (asercje na KLUCZACH i18n, nie na napisach)", () => {
  it("każdy rodzaj wydarzenia ma klucz w przestrzeni adminCommunityEvents.kinds", () => {
    expect(Object.keys(EVENT_KIND_LABEL_KEYS).sort()).toEqual([...EVENT_KINDS].sort());
    for (const kind of EVENT_KINDS) {
      expect(EVENT_KIND_LABEL_KEYS[kind]).toBe(`adminCommunityEvents.kinds.${kind}`);
    }
  });

  it("każdy status wydarzenia ma klucz w przestrzeni adminCommunityEvents.status", () => {
    expect(Object.keys(EVENT_STATUS_LABEL_KEYS).sort()).toEqual([...EVENT_STATUSES].sort());
    for (const status of EVENT_STATUSES) {
      expect(EVENT_STATUS_LABEL_KEYS[status]).toBe(`adminCommunityEvents.status.${status}`);
    }
  });

  it.each([
    ["webinar", true],
    ["hybrid", true],
    ["", false],
    ["Webinar", false],
    ["konferencja", false],
  ])("isEventKind(%s) === %s", (value, expected) => {
    expect(isEventKind(value)).toBe(expected);
  });

  it.each([
    ["draft", true],
    ["cancelled", true],
    ["", false],
    ["archived", false],
  ])("isEventStatus(%s) === %s", (value, expected) => {
    expect(isEventStatus(value)).toBe(expected);
  });
});

describe("fetchAdminEvents", () => {
  it.each([
    ["bez filtrów", {}, { p_status: null, p_q: null }],
    ["status all", { status: "all" as const }, { p_status: null, p_q: null }],
    ["status draft", { status: "draft" as const }, { p_status: "draft", p_q: null }],
    ["fraza z marginesem", { q: "  szczyt  " }, { p_status: null, p_q: "szczyt" }],
    ["fraza pusta", { q: "" }, { p_status: null, p_q: null }],
    ["fraza z samych spacji", { q: "   " }, { p_status: null, p_q: null }],
    [
      "status i fraza razem",
      { status: "published" as const, q: "szczyt" },
      { p_status: "published", p_q: "szczyt" },
    ],
  ])("%s => %o", async (_label, params, expected) => {
    setRpc("admin_list_events", ok([]));
    await fetchAdminEvents(params);
    expect(rpcArgs("admin_list_events")).toEqual(expected);
  });

  it("pełne wiersze (z join_url) czyta przez RPC, nie przez tabelę", async () => {
    setRpc("admin_list_events", ok([{ id: "ev-1", join_url: "https://example.com/live" }]));
    await expect(fetchAdminEvents({})).resolves.toEqual([
      { id: "ev-1", join_url: "https://example.com/live" },
    ]);
    expect(db().chains).toEqual([]);
  });

  it.each([
    ["data: null", null],
    ["zwrotka nie-tablicowa", { id: "ev-1" }],
  ])("%s daje pustą listę", async (_label, data) => {
    setRpc("admin_list_events", ok(data));
    await expect(fetchAdminEvents({})).resolves.toEqual([]);
  });

  it("błąd RPC podnosi wyjątek z komunikatem bazy", async () => {
    setRpc("admin_list_events", fail("events denied", "42501"));
    await expect(fetchAdminEvents({})).rejects.toThrow("events denied");
  });
});

describe("fetchAdminEvent", () => {
  it("oddaje pierwszy wiersz zwrotki", async () => {
    setRpc("admin_get_event", ok([{ id: "ev-1" }, { id: "ev-2" }]));
    await expect(fetchAdminEvent("ev-1")).resolves.toEqual({ id: "ev-1" });
    expect(rpcArgs("admin_get_event")).toEqual({ p_id: "ev-1" });
  });

  it.each([
    ["pusta tablica", []],
    ["data: null", null],
    ["zwrotka nie-tablicowa", { id: "ev-1" }],
  ])("%s daje null", async (_label, data) => {
    setRpc("admin_get_event", ok(data));
    await expect(fetchAdminEvent("ev-1")).resolves.toBeNull();
  });

  it("błąd RPC podnosi wyjątek", async () => {
    setRpc("admin_get_event", fail("event denied", "42501"));
    await expect(fetchAdminEvent("ev-1")).rejects.toThrow("event denied");
  });
});

describe("mutacje wydarzeń", () => {
  it("updateEventStatus zapisuje sam status po id", async () => {
    db().setResponse("events", ok(null));
    await updateEventStatus("ev-1", "published");
    expect(links("events")).toEqual(["update", "eq"]);
    expect(chain("events").argsOf("update")).toEqual([{ status: "published" }]);
    expect(chain("events").argsOf("eq")).toEqual(["id", "ev-1"]);
  });

  it("updateEvent przekazuje łatkę bez zmian (także pola zerowane)", async () => {
    db().setResponse("events", ok(null));
    await updateEvent("ev-1", { min_tier_rank: 0, recording_url: null, title_pl: "" });
    expect(chain("events").argsOf("update")).toEqual([
      { min_tier_rank: 0, recording_url: null, title_pl: "" },
    ]);
    expect(chain("events").argsOf("eq")).toEqual(["id", "ev-1"]);
  });

  it("deleteEvent kasuje po id", async () => {
    db().setResponse("events", ok(null));
    await deleteEvent("ev-1");
    expect(links("events")).toEqual(["delete", "eq"]);
    expect(chain("events").argsOf("eq")).toEqual(["id", "ev-1"]);
  });

  it.each([
    ["updateEventStatus", () => updateEventStatus("ev-1", "cancelled")],
    ["updateEvent", () => updateEvent("ev-1", { title_pl: "x" })],
    ["deleteEvent", () => deleteEvent("ev-1")],
  ])("%s: błąd podnosi wyjątek", async (_label, run) => {
    db().setResponse("events", fail("events write denied", "42501"));
    await expect(run()).rejects.toThrow("events write denied");
  });
});

describe("createEvent", () => {
  const INPUT = {
    slug: "szczyt-2026",
    title_pl: "Szczyt 2026",
    title_en: "Summit 2026",
    starts_at: "2026-04-01T09:00:00.000Z",
  };

  function wireInsert(): void {
    db().setResponse("events", ok({ id: "ev-new" }));
  }

  it("zakłada SZKIC z domyślnym rodzajem, widocznością i rangą 0, potem czyta pełny wiersz", async () => {
    wireInsert();
    setRpc("admin_get_event", ok([{ id: "ev-new", status: "draft" }]));

    await expect(createEvent(INPUT)).resolves.toEqual({ id: "ev-new", status: "draft" });

    expect(links("events")).toEqual(["insert", "select", "single"]);
    expect(chain("events").argsOf("insert")).toEqual([
      {
        ...INPUT,
        kind: "webinar",
        visibility: "public",
        min_tier_rank: 0,
        // Nowe wydarzenie NIGDY nie startuje jako opublikowane - inaczej
        // niedokończony wpis od razu trafia do publicznej agendy.
        status: "draft",
      },
    ]);
    // Insert oddaje samo `id`; treść czyta funkcja z bramką roli.
    expect(chain("events").argsOf("select")).toEqual(["id"]);
    expect(rpcArgs("admin_get_event")).toEqual({ p_id: "ev-new" });
  });

  it("respektuje jawny rodzaj, widoczność i rangę", async () => {
    wireInsert();
    setRpc("admin_get_event", ok([{ id: "ev-new" }]));
    await createEvent({ ...INPUT, kind: "roundtable", visibility: "members", min_tier_rank: 3 });
    expect(chain("events").argsOf("insert")).toEqual([
      {
        ...INPUT,
        kind: "roundtable",
        visibility: "members",
        min_tier_rank: 3,
        status: "draft",
      },
    ]);
  });

  it("błąd zapisu podnosi wyjątek i nie sięga po wiersz", async () => {
    db().setResponse("events", fail("insert denied", "42501"));
    await expect(createEvent(INPUT)).rejects.toThrow("insert denied");
    expect(h.rpcCalls).toEqual([]);
  });

  it("gdy wiersz po zapisie jest niewidoczny, zgłasza to jawnie", async () => {
    wireInsert();
    setRpc("admin_get_event", ok([]));
    // Cichy `null` przeciekłby do panelu jako „wydarzenie bez danych”.
    await expect(createEvent(INPUT)).rejects.toThrow("event_not_found_after_create");
  });
});

describe("runEventReminders", () => {
  it.each([
    ["liczba wysłanych", 7, 7],
    ["ZERO (nie było czego wysłać)", 0, 0],
    ["zwrotka nie-liczbowa", "7", 0],
    ["brak zwrotki", null, 0],
  ])("%s => %s", async (_label, data, expected) => {
    setRpc("run_event_reminders", ok(data));
    await expect(runEventReminders()).resolves.toBe(expected);
  });

  it("błąd podnosi wyjątek", async () => {
    setRpc("run_event_reminders", fail("reminders denied", "42501"));
    await expect(runEventReminders()).rejects.toThrow("reminders denied");
  });
});

// ---------------------------------------------------------------------------
// Prelegenci wydarzeń + profil prelegenta
// ---------------------------------------------------------------------------

describe("fetchEventSpeakers", () => {
  // STAN ZASTANY: dwa zapytania do TABEL (`event_speakers` + `profiles_public`)
  // i sklejanie w JS. Tamta tabela ma `user_id NOT NULL REFERENCES auth.users`,
  // wiec ta warstwa nie mogla oddac prelegenta BEZ KONTA - a to przypadek
  // typowy. Teraz jedno RPC (`admin_event_speakers_list`) sklada oba rejestry
  // w SQL-u: dedublowanie po stronie panelu rozjechalo by sie z definicja
  // publicznej projekcji.
  const row = (over: Record<string, unknown> = {}) => ({
    entry_id: "en-1",
    speaker_profile_id: "sp-1",
    user_id: null,
    person_id: "pe-1",
    display_name: "Lech K.",
    avatar_url: "https://example.com/l.png",
    job_title: "Profesor",
    company: "Uczelnia",
    email: "lech@example.com",
    is_public: true,
    sort_order: 0,
    is_legacy: false,
    ...over,
  });

  it("czyta liste JEDNYM RPC po p_event_id i NIE dotyka tabel", async () => {
    setRpc("admin_event_speakers_list", ok([row()]));

    const speakers = await fetchEventSpeakers("ev-1");

    expect(rpcArgs("admin_event_speakers_list")).toEqual({ p_event_id: "ev-1" });
    // Zero zapytan do tabel: caly odczyt idzie przez bramke
    // `assert_event_admin_tenant()`, nie przez RLS klienta.
    expect(db().chainsFor("event_speakers")).toEqual([]);
    expect(db().chainsFor("profiles_public")).toEqual([]);
    expect(speakers).toEqual([
      {
        entry_id: "en-1",
        speaker_profile_id: "sp-1",
        user_id: null,
        person_id: "pe-1",
        display_name: "Lech K.",
        avatar_url: "https://example.com/l.png",
        job_title: "Profesor",
        company: "Uczelnia",
        email: "lech@example.com",
        is_public: true,
        sort_order: 0,
        is_legacy: false,
      },
    ]);
  });

  it("sort_order 0 (pierwszy prelegent) nie gubi sie przy odczycie", async () => {
    setRpc("admin_event_speakers_list", ok([row({ sort_order: 0 })]));
    const speakers = await fetchEventSpeakers("ev-1");
    expect(speakers[0].sort_order).toBe(0);
  });

  it("puste kolumny oddaja null, nie undefined ani pusty napis", async () => {
    setRpc(
      "admin_event_speakers_list",
      ok([
        row({
          entry_id: null,
          person_id: null,
          user_id: "u-1",
          display_name: null,
          avatar_url: "",
          job_title: null,
          company: null,
          email: null,
          is_legacy: true,
        }),
      ]),
    );
    const [speaker] = await fetchEventSpeakers("ev-1");
    expect(speaker.entry_id).toBeNull();
    expect(speaker.person_id).toBeNull();
    expect(speaker.display_name).toBeNull();
    // Pusty napis z jsonb to tez BRAK: `avatar_url: ""` w `<img src>` to
    // zapytanie do biezacego adresu strony, nie brak obrazka.
    expect(speaker.avatar_url).toBeNull();
    expect(speaker.is_legacy).toBe(true);
  });

  it("is_public bez wartosci jest TRUE (nakladka domyslnie widoczna)", async () => {
    setRpc("admin_event_speakers_list", ok([row({ is_public: null })]));
    const [speaker] = await fetchEventSpeakers("ev-1");
    expect(speaker.is_public).toBe(true);
  });

  it("sort_order o zlym TYPIE nie wywala listy", async () => {
    setRpc("admin_event_speakers_list", ok([row({ sort_order: "trzy" })]));
    const [speaker] = await fetchEventSpeakers("ev-1");
    expect(speaker.sort_order).toBe(0);
  });

  it.each([
    ["brak prelegentow", ok([])],
    ["data: null", ok(null)],
    ["zwrotka nie-tablicowa", ok({})],
  ])("%s: zwraca []", async (_label, response) => {
    setRpc("admin_event_speakers_list", response);
    await expect(fetchEventSpeakers("ev-1")).resolves.toEqual([]);
  });

  it("blad podnosi wyjatek z TRESCIA bledu bazy", async () => {
    // Komunikat jest nazwany (`forbidden: admin role required`) i idzie na
    // ekran - zamiana go na jedno "nie udalo sie" kosztuje diagnostyke.
    setRpc("admin_event_speakers_list", fail("forbidden: admin role required", "42501"));
    await expect(fetchEventSpeakers("ev-1")).rejects.toThrow("forbidden: admin role required");
  });
});

describe("mutacje prelegentow", () => {
  it("createEventSpeakerPerson wysyla payload BEZ pustych kluczy", async () => {
    setRpc("admin_event_speaker_upsert", ok({ entry_id: "en-1", speaker_profile_id: "sp-1" }));

    await createEventSpeakerPerson({
      eventId: "ev-1",
      firstName: "Lech",
      lastName: "Kurklinski",
      email: "lech@example.com",
      jobTitle: "",
      phone: undefined,
      isPublic: true,
    });

    // Klucz nieobecny znaczy w SQL-u "zostaw kolumne", a pusty napis wysylany
    // w kazdym zapisie wymazywalby dane wpisane inna droga (rejestracja, skan).
    expect(rpcArgs("admin_event_speaker_upsert")).toEqual({
      p_payload: {
        event_id: "ev-1",
        first_name: "Lech",
        last_name: "Kurklinski",
        email: "lech@example.com",
        is_public: true,
      },
    });
  });

  it("createEventSpeakerPerson oddaje identyfikatory z jednego zapisu", async () => {
    setRpc(
      "admin_event_speaker_upsert",
      ok({ entry_id: "en-1", speaker_profile_id: "sp-1", person_id: "pe-1", user_id: null }),
    );
    await expect(
      createEventSpeakerPerson({ eventId: "ev-1", firstName: "A", lastName: "B" }),
    ).resolves.toEqual({
      entry_id: "en-1",
      speaker_profile_id: "sp-1",
      person_id: "pe-1",
      user_id: null,
    });
  });

  it("addEventSpeaker (tryb konta) wysyla WYLACZNIE event_id i user_id", async () => {
    setRpc("admin_event_speaker_upsert", ok({ speaker_profile_id: "sp-1", user_id: "u-1" }));
    await addEventSpeaker("ev-1", "u-1");
    // Kolejnosc LICZY BAZA: "na koniec listy" wymaga zobaczenia calej listy,
    // a klient widzi tylko swoja migawke sprzed sekundy.
    expect(rpcArgs("admin_event_speaker_upsert")).toEqual({
      p_payload: { event_id: "ev-1", user_id: "u-1" },
    });
  });

  it("removeEventSpeaker po koncie podaje OBA identyfikatory (rzad legacy)", async () => {
    setRpc("admin_event_speaker_remove", ok(true));
    await expect(
      removeEventSpeaker("ev-1", { speakerProfileId: "sp-1", userId: "u-1" }),
    ).resolves.toBe(true);
    expect(rpcArgs("admin_event_speaker_remove")).toEqual({
      p_payload: { event_id: "ev-1", speaker_profile_id: "sp-1", user_id: "u-1" },
    });
  });

  it("removeEventSpeaker dla osoby BEZ konta nie wysyla user_id", async () => {
    setRpc("admin_event_speaker_remove", ok(true));
    await removeEventSpeaker("ev-1", { speakerProfileId: "sp-1" });
    expect(rpcArgs("admin_event_speaker_remove")).toEqual({
      p_payload: { event_id: "ev-1", speaker_profile_id: "sp-1" },
    });
  });

  it("removeEventSpeaker: zwrotka inna niz true to NIE sukces", async () => {
    setRpc("admin_event_speaker_remove", ok(null));
    await expect(removeEventSpeaker("ev-1", { speakerProfileId: "sp-1" })).resolves.toBe(false);
  });

  it("setEventSpeakerOrder wysyla CALA liste w kolejnosci, nie pare wartosci", async () => {
    setRpc("admin_event_speaker_reorder", ok(2));
    const entry = (id: string, userId: string | null) => ({
      entry_id: null,
      speaker_profile_id: id,
      user_id: userId,
      person_id: null,
      display_name: null,
      avatar_url: null,
      job_title: null,
      company: null,
      email: null,
      is_public: true,
      sort_order: 0,
      is_legacy: false,
    });

    await expect(
      setEventSpeakerOrder("ev-1", [entry("sp-2", "u-2"), entry("sp-1", null)]),
    ).resolves.toBe(2);

    // `user_id` jedzie RAZEM z profilem, bo rzedy legacy trzymaja kolejnosc
    // w drugiej tabeli - bez niego przenumerowanie ich pomija.
    expect(rpcArgs("admin_event_speaker_reorder")).toEqual({
      p_payload: {
        event_id: "ev-1",
        items: [
          { speaker_profile_id: "sp-2", user_id: "u-2" },
          { speaker_profile_id: "sp-1", user_id: null },
        ],
      },
    });
  });

  it.each([
    [
      "createEventSpeakerPerson",
      "admin_event_speaker_upsert",
      () => createEventSpeakerPerson({ eventId: "ev-1", firstName: "A", lastName: "B" }),
    ],
    ["addEventSpeaker", "admin_event_speaker_upsert", () => addEventSpeaker("ev-1", "u-1")],
    [
      "removeEventSpeaker",
      "admin_event_speaker_remove",
      () => removeEventSpeaker("ev-1", { speakerProfileId: "sp-1" }),
    ],
    ["setEventSpeakerOrder", "admin_event_speaker_reorder", () => setEventSpeakerOrder("ev-1", [])],
  ])("%s: blad podnosi wyjatek", async (_label, fn, run) => {
    setRpc(fn, fail("forbidden: admin role required", "42501"));
    await expect(run()).rejects.toThrow("forbidden: admin role required");
  });
});

describe("fetchAdminSpeakerProfile", () => {
  it("czyta profil przez utwardzone RPC i normalizuje każde pole", async () => {
    setRpc(
      "admin_get_speaker_profile",
      ok([
        {
          user_id: "user-1",
          headline_pl: "Ekspertka",
          headline_en: "Expert",
          bio_pl: "Bio PL",
          bio_en: "Bio EN",
          topics_pl: ["energia", 42, null],
          topics_en: ["energy"],
          languages: ["pl", "en"],
          talks_count: 12,
          rating: 4.5,
          reviews_count: 3,
          is_public: true,
          crm_lead_id: "lead-1",
        },
      ]),
    );
    await expect(fetchAdminSpeakerProfile("user-1")).resolves.toEqual({
      user_id: "user-1",
      headline_pl: "Ekspertka",
      headline_en: "Expert",
      bio_pl: "Bio PL",
      bio_en: "Bio EN",
      // Elementy nie-napisowe wypadają z tablicy tematów.
      topics_pl: ["energia"],
      topics_en: ["energy"],
      languages: ["pl", "en"],
      talks_count: 12,
      rating: 4.5,
      reviews_count: 3,
      is_public: true,
      crm_lead_id: "lead-1",
    });
    expect(rpcArgs("admin_get_speaker_profile")).toEqual({ p_user_id: "user-1" });
    expect(db().chains).toEqual([]);
  });

  it("wiersz o złych typach schodzi do wartości bezpiecznych", async () => {
    setRpc(
      "admin_get_speaker_profile",
      ok([
        {
          user_id: null,
          headline_pl: 7,
          bio_pl: { pl: "x" },
          topics_pl: "energia",
          languages: null,
          talks_count: "12",
          rating: "nie-liczba",
          reviews_count: Number.POSITIVE_INFINITY,
          is_public: false,
          crm_lead_id: "",
        },
      ]),
    );
    await expect(fetchAdminSpeakerProfile("user-1")).resolves.toEqual({
      user_id: "",
      headline_pl: "",
      headline_en: "",
      bio_pl: "",
      bio_en: "",
      topics_pl: [],
      topics_en: [],
      languages: [],
      // Napis liczbowy przechodzi, napis nieliczbowy i nieskończoność - nie.
      talks_count: 12,
      rating: 0,
      reviews_count: 0,
      // `is_public: false` MUSI zostać false - inaczej panel „odpubliczniłby"
      // profil i nadal pokazywał go jako publiczny.
      is_public: false,
      // Puste id leada to brak powiązania z CRM, nie pusty napis.
      crm_lead_id: null,
    });
  });

  it("brak pola is_public znaczy „publiczny” (zgodnie z domyślną kolumną)", async () => {
    setRpc("admin_get_speaker_profile", ok([{ user_id: "user-1" }]));
    const profile = await fetchAdminSpeakerProfile("user-1");
    expect(profile?.is_public).toBe(true);
  });

  it.each([
    ["pusta tablica", []],
    ["data: null", null],
    ["zwrotka nie-tablicowa", { user_id: "user-1" }],
  ])("%s daje null", async (_label, data) => {
    setRpc("admin_get_speaker_profile", ok(data));
    await expect(fetchAdminSpeakerProfile("user-1")).resolves.toBeNull();
  });

  it("błąd RPC podnosi wyjątek", async () => {
    setRpc("admin_get_speaker_profile", fail("speaker denied", "42501"));
    await expect(fetchAdminSpeakerProfile("user-1")).rejects.toThrow("speaker denied");
  });
});

describe("upsertAdminSpeakerProfile", () => {
  const INPUT = {
    userId: "user-1",
    headlinePl: "Ekspertka",
    headlineEn: "Expert",
    bioPl: "Bio PL",
    bioEn: "Bio EN",
    topicsPl: ["energia"],
    topicsEn: ["energy"],
    languages: ["pl"],
    talksCount: 0,
    rating: 0,
    reviewsCount: 0,
    isPublic: false,
    syncCrm: false,
  };

  it("przekłada KAŻDE pole wejścia na parametr RPC (literówka = ciche zgubienie danych)", async () => {
    setRpc("admin_upsert_speaker_profile", ok({ id: "sp-1", crm_lead_id: "lead-1" }));
    await expect(upsertAdminSpeakerProfile(INPUT)).resolves.toEqual({
      id: "sp-1",
      crm_lead_id: "lead-1",
    });
    expect(rpcArgs("admin_upsert_speaker_profile")).toEqual({
      p_user_id: "user-1",
      p_headline_pl: "Ekspertka",
      p_headline_en: "Expert",
      p_bio_pl: "Bio PL",
      p_bio_en: "Bio EN",
      p_topics_pl: ["energia"],
      p_topics_en: ["energy"],
      p_languages: ["pl"],
      // Zera i `false` jadą jako zera i `false`, nie jako „brak wartości”.
      p_talks_count: 0,
      p_rating: 0,
      p_reviews_count: 0,
      p_is_public: false,
      p_sync_crm: false,
    });
    expect(db().chains).toEqual([]);
  });

  it.each([
    ["brak zwrotki", null],
    ["zwrotka bez pól", {}],
    ["puste napisy", { id: "", crm_lead_id: "" }],
  ])("%s daje oba identyfikatory jako null", async (_label, data) => {
    setRpc("admin_upsert_speaker_profile", ok(data));
    await expect(upsertAdminSpeakerProfile(INPUT)).resolves.toEqual({
      id: null,
      crm_lead_id: null,
    });
  });

  it("błąd RPC podnosi wyjątek", async () => {
    setRpc("admin_upsert_speaker_profile", fail("upsert denied", "42501"));
    await expect(upsertAdminSpeakerProfile(INPUT)).rejects.toThrow("upsert denied");
  });
});

describe("deleteAdminSpeakerProfile", () => {
  it.each([
    ["true", true, true],
    ["false", false, false],
    ["napis „true”", "true", false],
    ["brak zwrotki", null, false],
  ])("zwrotka %s => %s", async (_label, data, expected) => {
    setRpc("admin_delete_speaker_profile", ok(data));
    await expect(deleteAdminSpeakerProfile("user-1")).resolves.toBe(expected);
    expect(rpcArgs("admin_delete_speaker_profile")).toEqual({ p_user_id: "user-1" });
  });

  it("błąd RPC podnosi wyjątek", async () => {
    setRpc("admin_delete_speaker_profile", fail("delete denied", "42501"));
    await expect(deleteAdminSpeakerProfile("user-1")).rejects.toThrow("delete denied");
  });
});

// ---------------------------------------------------------------------------
// Q&A
// ---------------------------------------------------------------------------

describe("fetchQaSessions", () => {
  it.each([
    ["bez statusu", undefined, false],
    ["status all", "all" as const, false],
    ["status open", "open" as const, true],
  ])("%s: filtr eq obecny = %s", async (_label, status, expectEq) => {
    db().setResponse("qa_sessions", ok([]));
    await fetchQaSessions(status);
    expect(chain("qa_sessions").has("eq")).toBe(expectEq);
    if (expectEq) expect(chain("qa_sessions").argsOf("eq")).toEqual(["status", status]);
  });

  it("sortuje najnowsze pierwsze i limituje do 200", async () => {
    db().setResponse("qa_sessions", ok([{ id: "qa-1" }]));
    await expect(fetchQaSessions("open")).resolves.toEqual([{ id: "qa-1" }]);
    // `limit` jest ostatnim ogniwem - dokładany po filtrze statusu.
    expect(links("qa_sessions")).toEqual(["select", "order", "eq", "limit"]);
    expect(chain("qa_sessions").argsOf("order")).toEqual(["created_at", { ascending: false }]);
    expect(chain("qa_sessions").argsOf("limit")).toEqual([200]);
  });

  it("data: null daje pustą listę", async () => {
    db().setResponse("qa_sessions", ok(null));
    await expect(fetchQaSessions()).resolves.toEqual([]);
  });

  it("błąd podnosi wyjątek", async () => {
    db().setResponse("qa_sessions", fail("qa denied", "42501"));
    await expect(fetchQaSessions()).rejects.toThrow("qa denied");
  });
});

describe("updateQaSession", () => {
  it("zapisuje łatkę po id (także wartości zerujące)", async () => {
    db().setResponse("qa_sessions", ok(null));
    await updateQaSession("qa-1", { status: "closed", intro_pl: "", post_id: null });
    expect(links("qa_sessions")).toEqual(["update", "eq"]);
    expect(chain("qa_sessions").argsOf("update")).toEqual([
      { status: "closed", intro_pl: "", post_id: null },
    ]);
    expect(chain("qa_sessions").argsOf("eq")).toEqual(["id", "qa-1"]);
  });

  it("błąd podnosi wyjątek", async () => {
    db().setResponse("qa_sessions", fail("qa write denied", "42501"));
    await expect(updateQaSession("qa-1", { status: "closed" })).rejects.toThrow("qa write denied");
  });
});

describe("fetchQaQuestions", () => {
  it("NIE czyta kolumny user_id (anonimowość pytających) i limituje do 300", async () => {
    db().setResponse("qa_questions", ok([]));
    await fetchQaQuestions({});
    const columns = chain("qa_questions").argsOf("select")?.[0];
    if (typeof columns !== "string") throw new Error("test: lista kolumn nie jest napisem");
    // `select("*")` na tej tabeli KOŃCZY SIĘ BŁĘDEM: kolumna `user_id` jest
    // odebrana rolom anon/authenticated, więc panel moderacji przestałby działać.
    expect(columns).not.toContain("*");
    expect(columns.split(", ")).not.toContain("user_id");
    for (const column of ["id", "session_id", "author_display", "is_anonymous", "body", "status"]) {
      expect(columns.split(", ")).toContain(column);
    }
    expect(chain("qa_questions").argsOf("limit")).toEqual([300]);
    expect(chain("qa_questions").argsOf("order")).toEqual(["created_at", { ascending: false }]);
  });

  it.each([
    ["bez filtrów", {}, []],
    ["po sesji", { sessionId: "qa-1" }, [["session_id", "qa-1"]]],
    ["po statusie", { status: "pending" as const }, [["status", "pending"]]],
    ["status all pomijany", { status: "all" as const }, []],
    [
      "sesja i status razem",
      { sessionId: "qa-1", status: "answered" as const },
      [
        ["session_id", "qa-1"],
        ["status", "answered"],
      ],
    ],
  ])("%s", async (_label, params, expectedEqs) => {
    db().setResponse("qa_questions", ok([]));
    await fetchQaQuestions(params);
    const eqs = chain("qa_questions")
      .calls.filter((call) => call.method === "eq")
      .map((call) => call.args);
    expect(eqs).toEqual(expectedEqs);
  });

  it("data: null daje pustą listę", async () => {
    db().setResponse("qa_questions", ok(null));
    await expect(fetchQaQuestions({})).resolves.toEqual([]);
  });

  it("błąd podnosi wyjątek", async () => {
    db().setResponse("qa_questions", fail("questions denied", "42501"));
    await expect(fetchQaQuestions({})).rejects.toThrow("questions denied");
  });
});

describe("moderateQaQuestion", () => {
  beforeEach(() => {
    db().setResponse("qa_questions", ok(null));
  });

  it("odpowiedź zapisuje treść i STEMPEL CZASU jednym UPDATE", async () => {
    await moderateQaQuestion("q-1", "answered", "Odpowiedź redakcji");
    expect(links("qa_questions")).toEqual(["update", "eq"]);
    expect(chain("qa_questions").argsOf("update")).toEqual([
      {
        status: "answered",
        answer_body: "Odpowiedź redakcji",
        answered_at: BASE_NOW.toISOString(),
      },
    ]);
    expect(chain("qa_questions").argsOf("eq")).toEqual(["id", "q-1"]);
  });

  it("PUSTA odpowiedź to nadal odpowiedź (pusty napis nie jest brakiem)", async () => {
    await moderateQaQuestion("q-1", "answered", "");
    expect(chain("qa_questions").argsOf("update")).toEqual([
      { status: "answered", answer_body: "", answered_at: BASE_NOW.toISOString() },
    ]);
  });

  it("status „answered” bez treści nie stempluje czasu", async () => {
    await moderateQaQuestion("q-1", "answered");
    expect(chain("qa_questions").argsOf("update")).toEqual([{ status: "answered" }]);
  });

  it.each(["pending", "approved", "rejected"] as const)(
    "status %s zapisuje sam status, nawet gdy podano treść",
    async (status) => {
      await moderateQaQuestion("q-1", status, "treść bez znaczenia");
      expect(chain("qa_questions").argsOf("update")).toEqual([{ status }]);
    },
  );

  it("błąd podnosi wyjątek", async () => {
    db().setResponse("qa_questions", fail("moderate denied", "42501"));
    await expect(moderateQaQuestion("q-1", "approved")).rejects.toThrow("moderate denied");
  });
});

describe("publishQaSessionSummary", () => {
  it.each([
    [true, true],
    [false, false],
  ])("przekazuje sesję i flagę publikacji (%s)", async (publish, expected) => {
    setRpc(
      "publish_qa_session_summary",
      ok({ post_id: "post-1", slug: "qa-1", status: "published", questions: 5 }),
    );
    await expect(publishQaSessionSummary("qa-1", publish)).resolves.toEqual({
      post_id: "post-1",
      slug: "qa-1",
      status: "published",
      questions: 5,
    });
    expect(rpcArgs("publish_qa_session_summary")).toEqual({
      p_session_id: "qa-1",
      p_publish: expected,
    });
  });

  it.each([
    ["published", "published"],
    ["archived", "archived"],
    ["draft", "draft"],
    ["cokolwiek innego", "draft"],
    [null, "draft"],
  ])("status zwrotki %s => %s", async (status, expected) => {
    setRpc("publish_qa_session_summary", ok({ status }));
    const result = await publishQaSessionSummary("qa-1", false);
    expect(result.status).toBe(expected);
  });

  it.each([
    ["data: null", null],
    ["zwrotka tablicowa", [{ post_id: "post-1" }]],
    ["zwrotka napisowa", "post-1"],
  ])("%s schodzi do wartości pustych", async (_label, data) => {
    setRpc("publish_qa_session_summary", ok(data));
    await expect(publishQaSessionSummary("qa-1", true)).resolves.toEqual({
      post_id: "",
      slug: "",
      status: "draft",
      questions: 0,
    });
  });

  it("licznik pytań o złym typie schodzi do zera", async () => {
    setRpc("publish_qa_session_summary", ok({ questions: "5" }));
    const result = await publishQaSessionSummary("qa-1", true);
    expect(result.questions).toBe(0);
  });

  it("błąd RPC podnosi wyjątek", async () => {
    setRpc("publish_qa_session_summary", fail("summary denied", "42501"));
    await expect(publishQaSessionSummary("qa-1", true)).rejects.toThrow("summary denied");
  });
});

describe("createQaSession", () => {
  const INPUT = {
    slug: "qa-marzec",
    title_pl: "Q&A marzec",
    title_en: "March Q&A",
    opens_at: null,
    closes_at: null,
    status: "draft" as const,
  };

  it("dopisuje gospodarza z sesji i zamienia brakujące wstępy na null", async () => {
    db().setResponse("qa_sessions", ok({ id: "qa-new" }));
    await expect(createQaSession(INPUT)).resolves.toEqual({ id: "qa-new" });
    expect(links("qa_sessions")).toEqual(["insert", "select", "single"]);
    expect(chain("qa_sessions").argsOf("insert")).toEqual([
      {
        ...INPUT,
        intro_pl: null,
        intro_en: null,
        host_user_id: "11111111-1111-4111-8111-111111111111",
      },
    ]);
  });

  it("PUSTY wstęp zapisuje się jako pusty napis, nie jako null", async () => {
    db().setResponse("qa_sessions", ok({ id: "qa-new" }));
    await createQaSession({ ...INPUT, intro_pl: "", intro_en: "Intro" });
    expect(chain("qa_sessions").argsOf("insert")).toEqual([
      {
        ...INPUT,
        intro_pl: "",
        intro_en: "Intro",
        host_user_id: "11111111-1111-4111-8111-111111111111",
      },
    ]);
  });

  it("bez sesji odmawia PRZED zapisem", async () => {
    h.sessionUserId = null;
    await expect(createQaSession(INPUT)).rejects.toThrow("Not authenticated");
    // Dowód, że odmowa wyprzedziła pracę: żadnego zapytania do bazy.
    expect(db().chains).toEqual([]);
  });

  it("błąd zapisu podnosi wyjątek", async () => {
    db().setResponse("qa_sessions", fail("insert denied", "42501"));
    await expect(createQaSession(INPUT)).rejects.toThrow("insert denied");
  });
});

// ---------------------------------------------------------------------------
// Ankiety
// ---------------------------------------------------------------------------

describe("fetchAdminPolls", () => {
  it.each([
    ["bez statusu", undefined, false],
    ["status all", "all" as const, false],
    ["status open", "open" as const, true],
  ])("%s: filtr eq obecny = %s", async (_label, status, expectEq) => {
    db().setResponse("polls", ok([]));
    await fetchAdminPolls(status);
    expect(chain("polls").has("eq")).toBe(expectEq);
    if (expectEq) expect(chain("polls").argsOf("eq")).toEqual(["status", status]);
  });

  it("sortuje najnowsze pierwsze i limituje do 200", async () => {
    db().setResponse("polls", ok([{ id: "poll-1" }]));
    await expect(fetchAdminPolls()).resolves.toEqual([{ id: "poll-1" }]);
    expect(links("polls")).toEqual(["select", "order", "limit"]);
    expect(chain("polls").argsOf("order")).toEqual(["created_at", { ascending: false }]);
    expect(chain("polls").argsOf("limit")).toEqual([200]);
  });

  it("data: null daje pustą listę", async () => {
    db().setResponse("polls", ok(null));
    await expect(fetchAdminPolls()).resolves.toEqual([]);
  });

  it("błąd podnosi wyjątek", async () => {
    db().setResponse("polls", fail("polls denied", "42501"));
    await expect(fetchAdminPolls()).rejects.toThrow("polls denied");
  });
});

describe("mutacje ankiet", () => {
  it("updatePollStatus zapisuje sam status po id", async () => {
    db().setResponse("polls", ok(null));
    await updatePollStatus("poll-1", "closed");
    expect(links("polls")).toEqual(["update", "eq"]);
    expect(chain("polls").argsOf("update")).toEqual([{ status: "closed" }]);
    expect(chain("polls").argsOf("eq")).toEqual(["id", "poll-1"]);
  });

  it("deletePoll kasuje po id", async () => {
    db().setResponse("polls", ok(null));
    await deletePoll("poll-1");
    expect(links("polls")).toEqual(["delete", "eq"]);
  });

  it("createPoll zapisuje pytanie dwujęzycznie z opcjami i oddaje wiersz", async () => {
    db().setResponse("polls", ok({ id: "poll-new" }));
    const input = {
      question_pl: "Czy rozszerzenie UE?",
      question_en: "EU enlargement?",
      options: [{ label_pl: "Tak", label_en: "Yes" }],
      ends_at: null,
      status: "draft" as const,
    };
    await expect(createPoll(input)).resolves.toEqual({ id: "poll-new" });
    expect(links("polls")).toEqual(["insert", "select", "single"]);
    expect(chain("polls").argsOf("insert")).toEqual([
      {
        question_pl: "Czy rozszerzenie UE?",
        question_en: "EU enlargement?",
        options: [{ label_pl: "Tak", label_en: "Yes" }],
        ends_at: null,
        status: "draft",
      },
    ]);
  });

  it.each([
    ["updatePollStatus", () => updatePollStatus("poll-1", "open")],
    ["deletePoll", () => deletePoll("poll-1")],
    [
      "createPoll",
      () =>
        createPoll({
          question_pl: "P",
          question_en: "Q",
          options: [],
          ends_at: null,
          status: "draft" as const,
        }),
    ],
  ])("%s: błąd podnosi wyjątek", async (_label, run) => {
    db().setResponse("polls", fail("polls write denied", "42501"));
    await expect(run()).rejects.toThrow("polls write denied");
  });
});

describe("fetchPollResults", () => {
  it("zlicza głosy per indeks opcji, licząc też opcję ZEROWĄ", async () => {
    db().setResponse("poll_votes", ok([{ option_idx: 0 }, { option_idx: 0 }, { option_idx: 1 }]));
    await expect(fetchPollResults("poll-1")).resolves.toEqual({ "0": 2, "1": 1 });
    expect(links("poll_votes")).toEqual(["select", "eq"]);
    expect(chain("poll_votes").argsOf("select")).toEqual(["option_idx"]);
    // Bez `eq` panel zsumowałby głosy ze wszystkich ankiet tenanta.
    expect(chain("poll_votes").argsOf("eq")).toEqual(["poll_id", "poll-1"]);
  });

  it.each([
    ["brak głosów", ok([])],
    ["data: null", ok(null)],
  ])("%s daje pustą mapę", async (_label, response) => {
    db().setResponse("poll_votes", response);
    await expect(fetchPollResults("poll-1")).resolves.toEqual({});
  });

  it("błąd podnosi wyjątek", async () => {
    db().setResponse("poll_votes", fail("votes denied", "42501"));
    await expect(fetchPollResults("poll-1")).rejects.toThrow("votes denied");
  });
});

// ---------------------------------------------------------------------------
// Program współtwórców (mapowanie statusów UI <-> baza)
// ---------------------------------------------------------------------------

describe("fetchContributorSubmissions - filtry", () => {
  beforeEach(() => {
    db().setResponse("contributor_submissions", ok([]));
  });

  it("bez filtrów: sam sort i limit 200", async () => {
    await fetchContributorSubmissions();
    expect(links("contributor_submissions")).toEqual(["select", "order", "limit"]);
    expect(chain("contributor_submissions").argsOf("limit")).toEqual([200]);
  });

  it.each([
    ["pending", "pending" as const, ["submitted", "in_review"]],
    ["approved", "approved" as const, ["accepted"]],
    ["rejected", "rejected" as const, ["rejected"]],
  ])(
    "status UI %s pyta bazę o jej WŁASNE nazwy statusów %o",
    async (_label, status, dbStatuses) => {
      await fetchContributorSubmissions(status);
      // Panel zna 3 kategorie, baza 4 - to mapowanie jest jedynym miejscem,
      // w którym „pending” rozwija się na „submitted” ORAZ „in_review”.
      expect(chain("contributor_submissions").argsOf("in")).toEqual(["status", dbStatuses]);
    },
  );

  it("status all nie dokłada filtra", async () => {
    await fetchContributorSubmissions("all");
    expect(chain("contributor_submissions").has("in")).toBe(false);
  });

  it.each([
    ["pl", "pl" as const, true],
    ["en", "en" as const, true],
    ["all", "all" as const, false],
    ["brak", undefined, false],
  ])("język %s: filtr eq obecny = %s", async (_label, language, expectEq) => {
    await fetchContributorSubmissions("all", language);
    expect(chain("contributor_submissions").has("eq")).toBe(expectEq);
    if (expectEq) {
      expect(chain("contributor_submissions").argsOf("eq")).toEqual(["language", language]);
    }
  });

  it("oba filtry razem", async () => {
    await fetchContributorSubmissions("pending", "pl");
    expect(links("contributor_submissions")).toEqual(["select", "order", "limit", "in", "eq"]);
  });
});

describe("fetchContributorSubmissions - mapowanie statusów bazy na UI", () => {
  it.each([
    ["submitted", "pending"],
    ["in_review", "pending"],
    ["accepted", "approved"],
    ["rejected", "rejected"],
    // Status, którego mapa nie zna (np. dodany migracją), NIE MOŻE zniknąć
    // z listy - trafia do „pending", bo taki wpis wymaga decyzji redakcji.
    ["nowy_status_z_migracji", "pending"],
  ])("db_status %s => status UI %s", async (dbStatus, uiStatus) => {
    db().setResponse(
      "contributor_submissions",
      ok([{ id: "sub-1", status: dbStatus, language: "pl" }]),
    );
    const rows = await fetchContributorSubmissions();
    expect(rows).toEqual([{ id: "sub-1", status: uiStatus, db_status: dbStatus, language: "pl" }]);
  });

  it("data: null daje pustą listę", async () => {
    db().setResponse("contributor_submissions", ok(null));
    await expect(fetchContributorSubmissions()).resolves.toEqual([]);
  });

  it("błąd podnosi wyjątek", async () => {
    db().setResponse("contributor_submissions", fail("submissions denied", "42501"));
    await expect(fetchContributorSubmissions()).rejects.toThrow("submissions denied");
  });
});

describe("reviewContributorSubmission", () => {
  beforeEach(() => {
    db().setResponse("contributor_submissions", ok(null));
  });

  it.each([
    ["approved", "approved" as const, "accepted"],
    ["rejected", "rejected" as const, "rejected"],
  ])("decyzja %s zapisuje status bazy %s ze stemplem czasu", async (_label, ui, dbStatus) => {
    await reviewContributorSubmission("sub-1", ui);
    expect(links("contributor_submissions")).toEqual(["update", "eq"]);
    expect(chain("contributor_submissions").argsOf("update")).toEqual([
      { status: dbStatus, reviewed_at: BASE_NOW.toISOString() },
    ]);
    expect(chain("contributor_submissions").argsOf("eq")).toEqual(["id", "sub-1"]);
  });

  it("brak noty redakcyjnej nie dokłada kolumny editor_note", async () => {
    await reviewContributorSubmission("sub-1", "approved");
    const patch = chain("contributor_submissions").argsOf("update")?.[0];
    expect(patch).not.toHaveProperty("editor_note");
  });

  it("PUSTA nota redakcyjna jest zapisywana (czyszczenie poprzedniej noty)", async () => {
    await reviewContributorSubmission("sub-1", "rejected", "");
    expect(chain("contributor_submissions").argsOf("update")).toEqual([
      { status: "rejected", reviewed_at: BASE_NOW.toISOString(), editor_note: "" },
    ]);
  });

  it("nota redakcyjna trafia do wiersza", async () => {
    await reviewContributorSubmission("sub-1", "approved", "Dobry materiał");
    expect(chain("contributor_submissions").argsOf("update")).toEqual([
      {
        status: "accepted",
        reviewed_at: BASE_NOW.toISOString(),
        editor_note: "Dobry materiał",
      },
    ]);
  });

  it("błąd podnosi wyjątek", async () => {
    db().setResponse("contributor_submissions", fail("review denied", "42501"));
    await expect(reviewContributorSubmission("sub-1", "approved")).rejects.toThrow("review denied");
  });
});

// ---------------------------------------------------------------------------
// Powiadomienia i push
// ---------------------------------------------------------------------------

/** Sześć liczników; `null` udaje odpowiedź PostgREST bez pola `count`. */
interface CountPlan {
  active: number | null;
  failed: number | null;
  last24: number | null;
  unread: number | null;
  daily: number | null;
  weekly: number | null;
}

function countResult(value: number | null): SupabaseResult {
  return value === null ? { data: null, error: null, count: null } : okCount(value);
}

function wireNotificationCounts(plan: CountPlan): void {
  db().setResponse("push_subscriptions", (recorded) =>
    recorded.has("not") ? countResult(plan.failed) : countResult(plan.active),
  );
  db().setResponse("notifications", (recorded) =>
    recorded.has("gte") ? countResult(plan.last24) : countResult(plan.unread),
  );
  db().setResponse("notification_preferences", (recorded) =>
    recorded.argsOf("eq")?.[1] === "daily" ? countResult(plan.daily) : countResult(plan.weekly),
  );
}

describe("fetchNotificationStats", () => {
  it("liczy SZEŚĆ metryk zapytaniami liczącymi (head: true), bez ściągania wierszy", async () => {
    wireNotificationCounts({
      active: 120,
      failed: 4,
      last24: 0,
      unread: 37,
      daily: 12,
      weekly: 5,
    });

    await expect(fetchNotificationStats()).resolves.toEqual({
      push_subscriptions_active: 120,
      push_subscriptions_failed: 4,
      // Zero z bazy musi zostać zerem - to nie „brak danych”.
      notifications_last_24h: 0,
      notifications_unread: 37,
      digest_daily_users: 12,
      digest_weekly_users: 5,
    });

    const shapes = db().chains.map((recorded) => ({
      table: recorded.table,
      select: recorded.calls.find((call) => call.method === "select")?.args,
      links: recorded.calls.map((call) => call.method),
      filter: recorded.calls.filter((call) => call.method !== "select").map((call) => call.args),
    }));
    expect(shapes).toEqual([
      {
        table: "push_subscriptions",
        select: ["id", { count: "exact", head: true }],
        links: ["select", "is"],
        filter: [["failed_at", null]],
      },
      {
        table: "push_subscriptions",
        select: ["id", { count: "exact", head: true }],
        links: ["select", "not"],
        filter: [["failed_at", "is", null]],
      },
      {
        table: "notifications",
        select: ["id", { count: "exact", head: true }],
        links: ["select", "gte"],
        // Okno 24 h liczone od „teraz” - stąd ustalona data bazowa w teście.
        filter: [["created_at", SINCE_24H]],
      },
      {
        table: "notifications",
        select: ["id", { count: "exact", head: true }],
        links: ["select", "is"],
        filter: [["read_at", null]],
      },
      {
        table: "notification_preferences",
        select: ["user_id", { count: "exact", head: true }],
        links: ["select", "eq"],
        filter: [["email_digest", "daily"]],
      },
      {
        table: "notification_preferences",
        select: ["user_id", { count: "exact", head: true }],
        links: ["select", "eq"],
        filter: [["email_digest", "weekly"]],
      },
    ]);
  });

  it("brak licznika w odpowiedzi (count: null) pokazuje zero", async () => {
    wireNotificationCounts({
      active: null,
      failed: null,
      last24: null,
      unread: null,
      daily: null,
      weekly: null,
    });
    await expect(fetchNotificationStats()).resolves.toEqual({
      push_subscriptions_active: 0,
      push_subscriptions_failed: 0,
      notifications_last_24h: 0,
      notifications_unread: 0,
      digest_daily_users: 0,
      digest_weekly_users: 0,
    });
  });
});

describe("cleanupFailedPushSubscriptions", () => {
  it("kasuje TYLKO wpisy z niepustym failed_at i oddaje liczbę skasowanych", async () => {
    db().setResponse("push_subscriptions", ok([{ id: "sub-1" }, { id: "sub-2" }]));
    await expect(cleanupFailedPushSubscriptions()).resolves.toBe(2);
    expect(links("push_subscriptions")).toEqual(["delete", "not", "select"]);
    // `not(failed_at is null)` - bez tego filtra poleciałyby DZIAŁAJĄCE
    // subskrypcje push całego tenanta.
    expect(chain("push_subscriptions").argsOf("not")).toEqual(["failed_at", "is", null]);
    // `select("id")` po delete jest tu warunkiem policzenia czegokolwiek.
    expect(chain("push_subscriptions").argsOf("select")).toEqual(["id"]);
  });

  it.each([
    ["nic do skasowania", ok([])],
    ["data: null", ok(null)],
  ])("%s daje zero", async (_label, response) => {
    db().setResponse("push_subscriptions", response);
    await expect(cleanupFailedPushSubscriptions()).resolves.toBe(0);
  });

  it("błąd podnosi wyjątek", async () => {
    db().setResponse("push_subscriptions", fail("cleanup denied", "42501"));
    await expect(cleanupFailedPushSubscriptions()).rejects.toThrow("cleanup denied");
  });
});

// ---------------------------------------------------------------------------
// Przegląd zaangażowania (jeden round-trip, jsonb bez schematu)
// ---------------------------------------------------------------------------

const ZERO_OVERVIEW = {
  members_total: 0,
  members_new_30d: 0,
  active_7d: 0,
  active_30d: 0,
  subscriptions_active: 0,
  tier_distribution: {},
  push_optin: 0,
  digest_optin: 0,
  events_upcoming: 0,
  rsvps_upcoming: 0,
  qa_open_questions: 0,
  poll_votes_30d: 0,
  submissions_pending: 0,
  tracker_follows: 0,
  top_upcoming_events: [],
};

describe("fetchEngagementOverview", () => {
  it("czyta wszystkie liczniki, rozkład warstw i najbliższe wydarzenia", async () => {
    setRpc(
      "get_engagement_overview",
      ok({
        members_total: 500,
        members_new_30d: 25,
        active_7d: 80,
        active_30d: 210,
        subscriptions_active: 60,
        tier_distribution: { free: 400, pro: "80", vip: 20 },
        push_optin: 45,
        digest_optin: 120,
        events_upcoming: 3,
        rsvps_upcoming: 44,
        qa_open_questions: 6,
        poll_votes_30d: 90,
        submissions_pending: 2,
        tracker_follows: 15,
        top_upcoming_events: [
          {
            slug: "szczyt-2026",
            title_pl: "Szczyt 2026",
            title_en: "Summit 2026",
            starts_at: "2026-04-01T09:00:00.000Z",
            going: 30,
          },
        ],
      }),
    );

    const overview = await fetchEngagementOverview();

    expect(overview.members_total).toBe(500);
    // Napis liczbowy w rozkładzie warstw sprowadza się do liczby.
    expect(overview.tier_distribution).toEqual({ free: 400, pro: 80, vip: 20 });
    expect(overview.top_upcoming_events).toEqual([
      {
        slug: "szczyt-2026",
        title_pl: "Szczyt 2026",
        title_en: "Summit 2026",
        starts_at: "2026-04-01T09:00:00.000Z",
        going: 30,
      },
    ]);
    expect(h.rpcCalls.map((call) => call.fn)).toEqual(["get_engagement_overview"]);
    expect(db().chains).toEqual([]);
  });

  it("data: null daje same zera i puste kolekcje", async () => {
    setRpc("get_engagement_overview", ok(null));
    await expect(fetchEngagementOverview()).resolves.toEqual(ZERO_OVERVIEW);
  });

  it.each([
    ["tablica w miejscu obiektu", [1, 2]],
    ["napis", "free"],
    ["null", null],
  ])("rozkład warstw jako %s daje pustą mapę", async (_label, tierDistribution) => {
    setRpc("get_engagement_overview", ok({ tier_distribution: tierDistribution }));
    const overview = await fetchEngagementOverview();
    expect(overview.tier_distribution).toEqual({});
  });

  it("rozkład warstw z wartościami nie-liczbowymi zeruje TYLKO te wartości", async () => {
    setRpc("get_engagement_overview", ok({ tier_distribution: { free: null, pro: "x", vip: 0 } }));
    const overview = await fetchEngagementOverview();
    expect(overview.tier_distribution.free).toBe(0);
    expect(Number.isNaN(overview.tier_distribution.pro)).toBe(true);
    expect(overview.tier_distribution.vip).toBe(0);
  });

  it.each([
    ["pole nie-tablicowe", { top_upcoming_events: { slug: "x" } }],
    ["pole nieobecne", {}],
  ])("najbliższe wydarzenia: %s daje pustą listę", async (_label, payload) => {
    setRpc("get_engagement_overview", ok(payload));
    const overview = await fetchEngagementOverview();
    expect(overview.top_upcoming_events).toEqual([]);
  });

  it("pomija elementy, które nie są wydarzeniem, i zachowuje pozostałe", async () => {
    setRpc(
      "get_engagement_overview",
      ok({
        top_upcoming_events: [
          null,
          "szczyt",
          ["szczyt"],
          { title_pl: "Bez sluga", starts_at: "2026-04-01T09:00:00.000Z" },
          { slug: "bez-daty" },
          { slug: "bez-daty-2", starts_at: 1_775_000_000 },
          {
            slug: "poprawne",
            title_pl: 7,
            title_en: null,
            starts_at: "2026-04-02T09:00:00.000Z",
            going: "12",
          },
        ],
      }),
    );

    const overview = await fetchEngagementOverview();

    // Element bez `slug` albo bez `starts_at` jest bezużyteczny w kokpicie
    // (nie da się po nim ani nawigować, ani go umieścić na osi czasu).
    expect(overview.top_upcoming_events).toEqual([
      {
        slug: "poprawne",
        // Tytuł o złym typie schodzi do null, a nie do „7”.
        title_pl: null,
        title_en: null,
        starts_at: "2026-04-02T09:00:00.000Z",
        going: 12,
      },
    ]);
  });

  it("błąd RPC podnosi wyjątek", async () => {
    setRpc("get_engagement_overview", fail("overview denied", "42501"));
    await expect(fetchEngagementOverview()).rejects.toThrow("overview denied");
  });
});
