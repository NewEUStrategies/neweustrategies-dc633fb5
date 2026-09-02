// PO CO TEN PLIK. `src/lib/analytics/footerAnalytics.functions.ts` (124 linie,
// jedna server fn) wchodzi tu z ZEREM wykonanych linii, a zasila zakładkę
// „stopka" w panelu admin/analytics. Cała jego wartość to AGREGACJA: z surowych
// wierszy `analytics_events` robi totale, ranking linków i szereg dzienny.
// Każdy z tych trzech wyników jest liczbą, którą ktoś zobaczy i na jej
// podstawie przestawi nawigację - błąd w kluczu kubelka albo w mapowaniu nazwy
// zdarzenia nie wywala niczego, tylko cicho oddaje NIEPRAWDĘ.
//
// Klasy defektów, które te testy łapią:
//
//  1. ODCZYT SPOZA NAJEMCY. Tabela `analytics_events` NIE ma tu filtra
//     `tenant_id` w zapytaniu - polityka RLS `analytics_events_admin_read`
//     (migracja 20260730085737) zawężają do `current_tenant_id()`, a to działa
//     WYŁĄCZNIE wtedy, gdy zapytanie leci klientem NAJEMCY z kontekstu
//     middleware. Podmiana `context.supabase` na `supabaseAdmin` (service role
//     omija RLS) wyglądałaby w diffie jak optymalizacja, a oddałaby adminowi
//     najemcy A kliknięcia najemcy B. Dowodzimy więc DWÓCH rzeczy naraz:
//     że odczyt idzie klientem z kontekstu (dwa konteksty = dwa rozłączne
//     zbiory) i że klient service role nie jest tu tknięty ANI RAZU.
//  2. ZBYT SZEROKIE ZAPYTANIE. `.in("event_name", …)` musi wymieniać dokładnie
//     cztery zdarzenia `footer_*`; dorzucenie piątego (albo zgubienie filtra)
//     zmieszałoby dashboard stopki z innymi CTA - i to jest w komentarzu modułu
//     obiecane wprost.
//  3. GRANICE OKNA I WALIDATOR: 1..180 dni, całkowite, domyślnie 30, `since`
//     liczone od `Date.now()`.
//  4. MAPOWANIE KUBELKÓW: klucz `nazwa::href`, fallbacki `href` (meta -> encja
//     -> „-"), `label` (meta -> href), `group` (meta -> „unknown"), `last_at`
//     jako MAKSIMUM, ranking malejąco z limitem 100, szereg dzienny rosnąco,
//     a `footer_newsletter_signup` liczony jako konwersja, nie kliknięcie.
//  5. AWARIA ODCZYTU jako błąd, a nie cicha zerówka.
//
// CZEGO TEN PLIK NIE UDAJE. Harness nie uruchamia middleware, więc „obcy nie
// wejdzie" nie jest tu dowodzone zachowaniem - jest dowodzone DEKLARACJĄ
// `requireAdmin` (test strukturalny) plus bramka statyczna
// `check:authz-snapshot`; sama polityka RLS to domena pgTAP.
//
// RODO: żadnych prawdziwych danych - adresy wyłącznie w domenie example.com,
// zero identyfikatorów osób.
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

import { fail, ok, supabaseFromStub, type SupabaseResult } from "@/test/supabaseChain";
import {
  callServerFn,
  serverFnMiddlewareNames,
  validateServerFnInput,
  type ServerFnContext,
} from "@/test/serverFnHarness";

vi.mock("@tanstack/react-start", async () => {
  const { serverFnStubModule } = await import("@/test/serverFnHarness");
  return serverFnStubModule();
});
vi.mock("@/integrations/supabase/require-staff", () => ({
  requireAdmin: { name: "requireAdmin" },
}));

/**
 * Licznik sięgnięć po klienta SERVICE ROLE. Handler nie ma prawa go dotknąć -
 * ten klient omija RLS, więc każde jego użycie tutaj to wyciek między najemcami.
 */
const h = vi.hoisted(() => ({ adminTouches: [] as string[] }));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      h.adminTouches.push(table);
      throw new Error(`test: handler siegnal po service role dla tabeli "${table}"`);
    },
  },
}));

import { getFooterAnalytics, type FooterAnalyticsResult } from "../footerAnalytics.functions";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";

/** Zamrożony „teraz" - `since` i szereg dzienny muszą być deterministyczne. */
const NOW = new Date("2026-03-15T12:00:00.000Z");

interface EventRow {
  tenant_id: string;
  event_name: string;
  meta: Record<string, unknown> | null;
  created_at: string;
  entity_id: string | null;
}

/** „Baza" obu najemców naraz - brak zawężenia widać natychmiast w liczbach. */
let zdarzenia: EventRow[] = [];

const stub = supabaseFromStub();

/**
 * Klient NAJEMCY: odtwarza to, co robi RLS - oddaje wyłącznie wiersze tego
 * najemcy, do którego należy wołający. Filtry `in`/`gte`/`limit` z łańcucha są
 * stosowane wiernie, żeby test czytał skutki zapytania, a nie zamiar.
 */
function klientNajemcy(tenantId: string): ServerFnContext["supabase"] {
  const from = stub.from;
  stub.setResponse("analytics_events", (chain): SupabaseResult => {
    const inArgs = chain.argsOf("in");
    const gte = chain.argsOf("gte");
    const limit = chain.argsOf("limit");
    let rows = zdarzenia.filter((r) => r.tenant_id === tenantId);
    if (inArgs && inArgs[0] === "event_name" && Array.isArray(inArgs[1])) {
      const nazwy = new Set(inArgs[1].map(String));
      rows = rows.filter((r) => nazwy.has(r.event_name));
    }
    if (gte && gte[0] === "created_at") rows = rows.filter((r) => r.created_at >= String(gte[1]));
    rows.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    if (typeof limit?.[0] === "number") rows = rows.slice(0, limit[0]);
    return ok(rows.map(({ tenant_id: _t, ...rest }) => rest));
  });
  return { from };
}

function kontekst(tenantId: string): ServerFnContext {
  return {
    supabase: klientNajemcy(tenantId),
    userId: "99999999-9999-4999-8999-999999999999",
    claims: { sub: "99999999-9999-4999-8999-999999999999" },
  };
}

async function wywolaj(tenantId: string, data?: unknown): Promise<FooterAnalyticsResult> {
  return callServerFn<FooterAnalyticsResult>(getFooterAnalytics, {
    data,
    context: kontekst(tenantId),
  });
}

/** Znacznik czasu przesunięty o `hours` godzin wstecz od zamrożonego „teraz". */
function godzinTemu(hours: number): string {
  return new Date(NOW.getTime() - hours * 3_600_000).toISOString();
}

function klik(over: Partial<EventRow> = {}): EventRow {
  return {
    tenant_id: TENANT_A,
    event_name: "footer_link_click",
    meta: { href: "/analizy", label: "Analizy", group: "editorial" },
    created_at: godzinTemu(1),
    entity_id: "/analizy",
    ...over,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  stub.reset();
  h.adminTouches.length = 0;
  zdarzenia = [];
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("getFooterAnalytics - obudowa server fn", () => {
  it("deklaruje bramkę requireAdmin, metodę POST i walidator", () => {
    expect(serverFnMiddlewareNames(getFooterAnalytics)).toEqual(["requireAdmin"]);
    expect(Reflect.get(getFooterAnalytics as object, "method")).toBe("POST");
    expect(validateServerFnInput(getFooterAnalytics, {})).toEqual({ days: 30 });
  });
});

describe("getFooterAnalytics - walidator okna", () => {
  it("brak wejścia oznacza 30 dni", () => {
    expect(validateServerFnInput(getFooterAnalytics, undefined)).toEqual({ days: 30 });
    expect(validateServerFnInput(getFooterAnalytics, null)).toEqual({ days: 30 });
  });

  it("przyjmuje skrajne dopuszczalne okna 1 i 180", () => {
    expect(validateServerFnInput(getFooterAnalytics, { days: 1 })).toEqual({ days: 1 });
    expect(validateServerFnInput(getFooterAnalytics, { days: 180 })).toEqual({ days: 180 });
  });

  it.each([
    ["zero", 0],
    ["ujemne", -7],
    ["ponad polrocze", 181],
    ["ulamkowe", 30.5],
  ])("odrzuca okno %s", (_nazwa, days) => {
    expect(() => validateServerFnInput(getFooterAnalytics, { days })).toThrow();
  });

  it("odrzuca liczbę podaną jako tekst", () => {
    expect(() => validateServerFnInput(getFooterAnalytics, { days: "30" })).toThrow();
  });
});

describe("getFooterAnalytics - kształt zapytania", () => {
  it("czyta wyłącznie cztery zdarzenia stopki, w oknie, malejąco, z limitem 10 000", async () => {
    await wywolaj(TENANT_A, { days: 30 });
    const chain = stub.lastChain("analytics_events");

    expect(chain?.argsOf("select")).toEqual(["event_name, meta, created_at, entity_id"]);
    expect(chain?.argsOf("in")).toEqual([
      "event_name",
      [
        "footer_link_click",
        "footer_legal_click",
        "footer_newsletter_click",
        "footer_newsletter_signup",
      ],
    ]);
    expect(chain?.argsOf("gte")).toEqual([
      "created_at",
      new Date(NOW.getTime() - 30 * 86_400_000).toISOString(),
    ]);
    expect(chain?.argsOf("order")).toEqual(["created_at", { ascending: false }]);
    expect(chain?.argsOf("limit")).toEqual([10_000]);
  });

  it("okno przesuwa `since` - wiersz starszy o godzinę od granicy wypada", async () => {
    zdarzenia = [
      klik({ created_at: godzinTemu(7 * 24 - 1), meta: { href: "/w-oknie" }, entity_id: null }),
      klik({ created_at: godzinTemu(7 * 24 + 1), meta: { href: "/poza-oknem" }, entity_id: null }),
    ];
    const wynik = await wywolaj(TENANT_A, { days: 7 });
    expect(wynik.windowDays).toBe(7);
    expect(wynik.totals.total).toBe(1);
    expect(wynik.rows.map((r) => r.href)).toEqual(["/w-oknie"]);
  });
});

describe("getFooterAnalytics - izolacja najemców", () => {
  beforeEach(() => {
    zdarzenia = [
      klik({ tenant_id: TENANT_A, meta: { href: "/a-only", label: "A", group: "editorial" } }),
      klik({ tenant_id: TENANT_A, meta: { href: "/a-only", label: "A", group: "editorial" } }),
      klik({ tenant_id: TENANT_B, meta: { href: "/b-only", label: "B", group: "topics" } }),
      klik({
        tenant_id: TENANT_B,
        event_name: "footer_newsletter_signup",
        meta: { href: "/b-news", label: "B news", group: "community" },
      }),
    ];
  });

  it("admin najemcy A nie widzi ANI JEDNEGO kliknięcia najemcy B", async () => {
    const a = await wywolaj(TENANT_A, { days: 30 });
    expect(a.totals).toEqual({
      total: 2,
      link_clicks: 2,
      legal_clicks: 0,
      newsletter_clicks: 0,
      newsletter_signups: 0,
    });
    expect(a.rows.map((r) => r.href)).toEqual(["/a-only"]);
    expect(a.rows.map((r) => r.href)).not.toContain("/b-only");
  });

  it("admin najemcy B widzi wyłącznie swoje - ta sama atrapa, inny kontekst", async () => {
    const b = await wywolaj(TENANT_B, { days: 30 });
    expect(b.totals).toMatchObject({ total: 2, link_clicks: 1, newsletter_signups: 1 });
    expect(b.rows.map((r) => r.href).sort()).toEqual(["/b-news", "/b-only"]);
  });

  it("odczyt idzie klientem z kontekstu, a klient service role nie jest tknięty", async () => {
    await wywolaj(TENANT_A, { days: 30 });
    // Zapytanie NIE niesie własnego filtra tenant_id - granica najemcy stoi
    // wyłącznie na RLS klienta z kontekstu, więc sięgnięcie po service role
    // (który RLS omija) byłoby tu natychmiastowym wyciekiem.
    expect(stub.lastChain("analytics_events")?.has("eq")).toBe(false);
    expect(h.adminTouches).toEqual([]);
  });
});

describe("getFooterAnalytics - totale wg nazwy zdarzenia", () => {
  it("każde z czterech zdarzeń ładunkuje własny licznik, a `total` liczy wszystkie", async () => {
    zdarzenia = [
      klik({ event_name: "footer_link_click", meta: { href: "/1" } }),
      klik({ event_name: "footer_link_click", meta: { href: "/2" } }),
      klik({ event_name: "footer_legal_click", meta: { href: "/polityka-prywatnosci" } }),
      klik({ event_name: "footer_newsletter_click", meta: { href: "/newsletter" } }),
      klik({ event_name: "footer_newsletter_click", meta: { href: "/newsletter" } }),
      klik({ event_name: "footer_newsletter_signup", meta: { href: "/newsletter" } }),
    ];
    const wynik = await wywolaj(TENANT_A);
    expect(wynik.totals).toEqual({
      total: 6,
      link_clicks: 2,
      legal_clicks: 1,
      newsletter_clicks: 2,
      newsletter_signups: 1,
    });
  });
});

describe("getFooterAnalytics - kubelki linków", () => {
  it("kubelek jest wspólny dla pary nazwa+href, a różny href to różne wiersze", async () => {
    zdarzenia = [
      klik({ meta: { href: "/analizy", label: "Analizy", group: "editorial" } }),
      klik({ meta: { href: "/analizy", label: "Analizy", group: "editorial" } }),
      klik({ meta: { href: "/eksperci", label: "Eksperci", group: "community" } }),
    ];
    const wynik = await wywolaj(TENANT_A);
    expect(wynik.rows).toEqual([
      {
        event_name: "footer_link_click",
        href: "/analizy",
        label: "Analizy",
        group: "editorial",
        clicks: 2,
        last_at: godzinTemu(1),
      },
      {
        event_name: "footer_link_click",
        href: "/eksperci",
        label: "Eksperci",
        group: "community",
        clicks: 1,
        last_at: godzinTemu(1),
      },
    ]);
  });

  it("ten sam href pod inną nazwą zdarzenia to OSOBNY kubelek", async () => {
    zdarzenia = [
      klik({ event_name: "footer_link_click", meta: { href: "/newsletter" } }),
      klik({ event_name: "footer_newsletter_click", meta: { href: "/newsletter" } }),
    ];
    const wynik = await wywolaj(TENANT_A);
    expect(wynik.rows).toHaveLength(2);
    expect(wynik.rows.map((r) => r.event_name).sort()).toEqual([
      "footer_link_click",
      "footer_newsletter_click",
    ]);
  });

  it("`last_at` to MAKSIMUM znaczników kubelka, nie ostatni przetworzony wiersz", async () => {
    zdarzenia = [
      klik({ created_at: godzinTemu(50) }),
      klik({ created_at: godzinTemu(2) }),
      klik({ created_at: godzinTemu(30) }),
    ];
    const wynik = await wywolaj(TENANT_A, { days: 30 });
    expect(wynik.rows[0].clicks).toBe(3);
    expect(wynik.rows[0].last_at).toBe(godzinTemu(2));
  });

  it("ranking jest malejący po liczbie kliknięć", async () => {
    zdarzenia = [
      klik({ meta: { href: "/rzadki" } }),
      klik({ meta: { href: "/czesty" } }),
      klik({ meta: { href: "/czesty" } }),
      klik({ meta: { href: "/czesty" } }),
      klik({ meta: { href: "/sredni" } }),
      klik({ meta: { href: "/sredni" } }),
    ];
    const wynik = await wywolaj(TENANT_A);
    expect(wynik.rows.map((r) => [r.href, r.clicks])).toEqual([
      ["/czesty", 3],
      ["/sredni", 2],
      ["/rzadki", 1],
    ]);
  });

  it("ranking jest przycięty do stu wierszy mimo stu dwudziestu linków", async () => {
    zdarzenia = Array.from({ length: 120 }, (_v, i) => klik({ meta: { href: `/link-${i}` } }));
    const wynik = await wywolaj(TENANT_A);
    expect(wynik.rows).toHaveLength(100);
    expect(wynik.totals.total).toBe(120);
  });
});

describe("getFooterAnalytics - fallbacki metadanych", () => {
  it("brak meta.href spada na entity_id, a jego brak na „-”", async () => {
    zdarzenia = [klik({ meta: null, entity_id: "/z-encji" }), klik({ meta: {}, entity_id: null })];
    const wynik = await wywolaj(TENANT_A);
    const wgHref = Object.fromEntries(wynik.rows.map((r) => [r.href, r]));
    expect(wgHref["/z-encji"]).toMatchObject({ label: "/z-encji", group: "unknown", clicks: 1 });
    expect(wgHref["-"]).toMatchObject({ label: "-", group: "unknown", clicks: 1 });
  });

  it("meta o złym typie jest traktowana jak brak, a nie wpychana do raportu", async () => {
    zdarzenia = [
      klik({
        meta: { href: 42, label: ["Analizy"], group: { pl: "editorial" } },
        entity_id: "/z-encji",
      }),
    ];
    const wynik = await wywolaj(TENANT_A);
    expect(wynik.rows[0]).toMatchObject({
      href: "/z-encji",
      label: "/z-encji",
      group: "unknown",
    });
  });

  it("pusty label spada na href, a pusta grupa na „unknown”", async () => {
    zdarzenia = [klik({ meta: { href: "https://example.com/partner", label: "", group: "" } })];
    const wynik = await wywolaj(TENANT_A);
    expect(wynik.rows[0]).toMatchObject({
      href: "https://example.com/partner",
      label: "https://example.com/partner",
      group: "unknown",
    });
  });
});

describe("getFooterAnalytics - szereg dzienny", () => {
  it("konwersje newslettera nie wchodzą do słupka kliknięć i rosną osobno", async () => {
    zdarzenia = [
      klik({ created_at: "2026-03-15T09:00:00.000Z" }),
      klik({ created_at: "2026-03-15T10:00:00.000Z", event_name: "footer_newsletter_signup" }),
      klik({ created_at: "2026-03-13T08:00:00.000Z", event_name: "footer_legal_click" }),
      klik({ created_at: "2026-03-14T08:00:00.000Z", event_name: "footer_newsletter_click" }),
      klik({ created_at: "2026-03-14T09:00:00.000Z", event_name: "footer_newsletter_signup" }),
    ];
    const wynik = await wywolaj(TENANT_A, { days: 30 });
    expect(wynik.daily).toEqual([
      { date: "2026-03-13", clicks: 1, signups: 0 },
      { date: "2026-03-14", clicks: 1, signups: 1 },
      { date: "2026-03-15", clicks: 1, signups: 1 },
    ]);
  });

  it("szereg wychodzi rosnąco nawet gdy wiersze przyjdą w dowolnej kolejności", async () => {
    // `daily` jest sortowane PO agregacji, więc nie może zależeć od kolejności
    // odczytu. Ten przypadek celowo omija `order` z łańcucha: gdyby ktoś usunął
    // końcowe sortowanie „bo baza i tak sortuje", wykres dzienny zacząłby
    // rysować dni od tyłu i nikt by tego nie złapał na uporządkowanym odczycie.
    const wiersze = [
      klik({ created_at: "2026-03-11T09:00:00.000Z" }),
      klik({ created_at: "2026-03-14T09:00:00.000Z" }),
      klik({ created_at: "2026-03-09T09:00:00.000Z" }),
      klik({ created_at: "2026-03-13T09:00:00.000Z" }),
    ];
    const context: ServerFnContext = {
      supabase: {
        from: () => {
          stub.setResponse("analytics_events", () =>
            ok(wiersze.map(({ tenant_id: _t, ...rest }) => rest)),
          );
          return stub.from("analytics_events");
        },
      },
      userId: "99999999-9999-4999-8999-999999999999",
    };
    const wynik = await callServerFn<FooterAnalyticsResult>(getFooterAnalytics, {
      data: { days: 30 },
      context,
    });
    expect(wynik.daily.map((d) => d.date)).toEqual([
      "2026-03-09",
      "2026-03-11",
      "2026-03-13",
      "2026-03-14",
    ]);
  });

  it("szereg zawiera wyłącznie dni z ruchem - dziury nie są zerowane", async () => {
    zdarzenia = [
      klik({ created_at: "2026-03-15T09:00:00.000Z" }),
      klik({ created_at: "2026-03-10T09:00:00.000Z" }),
    ];
    const wynik = await wywolaj(TENANT_A, { days: 30 });
    expect(wynik.daily.map((d) => d.date)).toEqual(["2026-03-10", "2026-03-15"]);
  });
});

describe("getFooterAnalytics - brzegi odczytu", () => {
  it("puste okno oddaje zera i puste kolekcje, a nie null", async () => {
    const wynik = await wywolaj(TENANT_A, { days: 3 });
    expect(wynik).toEqual({
      totals: {
        total: 0,
        link_clicks: 0,
        legal_clicks: 0,
        newsletter_clicks: 0,
        newsletter_signups: 0,
      },
      rows: [],
      daily: [],
      windowDays: 3,
    });
  });

  it("`data: null` z PostgREST to puste okno, a nie wyjątek", async () => {
    const context: ServerFnContext = {
      supabase: {
        from: () => {
          stub.setResponse("analytics_events", () => ok(null));
          return stub.from("analytics_events");
        },
      },
      userId: "99999999-9999-4999-8999-999999999999",
    };
    const wynik = await callServerFn<FooterAnalyticsResult>(getFooterAnalytics, {
      data: { days: 3 },
      context,
    });
    expect(wynik.totals.total).toBe(0);
    expect(wynik.rows).toEqual([]);
  });

  it("awaria odczytu jest błędem z komunikatem bazy, a nie cichą zerówką", async () => {
    const context: ServerFnContext = {
      supabase: {
        from: () => {
          stub.setResponse("analytics_events", () =>
            fail("permission denied for analytics_events"),
          );
          return stub.from("analytics_events");
        },
      },
      userId: "99999999-9999-4999-8999-999999999999",
    };
    await expect(callServerFn(getFooterAnalytics, { data: { days: 3 }, context })).rejects.toThrow(
      "permission denied for analytics_events",
    );
  });
});

describe("getFooterAnalytics - defekt: `totals.total` nie jest totalem okna", () => {
  // `totals.total` to `events.length`, a `events` pochodzi z odczytu z twardym
  // `limit(10_000)`. Pole nazwane „total" przestaje więc być totalem dokładnie
  // wtedy, gdy jest najbardziej potrzebne - przy dużym ruchu. Wynik nie niesie
  // przy tym ŻADNEJ flagi przycięcia (inaczej niż `getAudienceSegments`, które
  // oddaje `truncated`), więc zaniżony total wygląda w panelu identycznie jak
  // realny spadek kliknięć w stopce.
  it.fails("`totals.total` liczy wszystkie zdarzenia okna, nie tylko pierwsze 10 000", async () => {
    zdarzenia = Array.from({ length: 10_050 }, (_v, i) =>
      klik({ meta: { href: `/link-${i % 50}` }, created_at: godzinTemu(1 + (i % 600)) }),
    );
    const wynik = await wywolaj(TENANT_A, { days: 30 });
    expect(wynik.totals.total).toBe(10_050);
  });
});
