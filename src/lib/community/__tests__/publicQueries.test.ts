// @vitest-environment node
//
// CO DOWODZI TEN PLIK
//
// `src/lib/community/publicQueries.ts` jest publicznym CZYTNIKIEM treści
// społeczności: listy wydarzeń, ankiet, sesji Q&A, teasery podsumowań i
// biblioteka materiałów schodzą stąd do SSR i do przeglądarki. Wchodząc, plik
// miał 20,8% linii i 6,7% gałęzi. To nie jest zwykła luka w pokryciu - tędy
// biegnie publiczna ścieżka odczytu platformy WIELOTENANTOWEJ, a nieprzykryta
// gałąź na tej ścieżce jest nieprzykrytą powierzchnią izolacji najemcy.
//
// ── GDZIE NAPRAWDĘ STOI GRANICA NAJEMCY (ustalone, nie założone) ─────────────
//
// Pytanie brzmiało: czy ten plik wiąże najemcę przez host i `public_tenant_id()`
// po stronie RLS, przez jawny `tenant_id` w zapytaniu, czy przez
// `src/lib/community/tenant.ts`. Odpowiedź jest jednoznaczna i warto ją mieć
// zapisaną, bo z samego kodu tego pliku NIE WIDAĆ NIC:
//
//   1. `publicQueries.ts` nie przekazuje `tenant_id` w ŻADNYM z siedmiu zapytań
//      tabelarycznych ani w żadnym z dziewięciu wywołań RPC. Nie importuje też
//      `community/tenant.ts` - jedynym importerem tego modułu w całym repo jest
//      `src/routes/qa.$slug.tsx` (`grep -rn "community/tenant" src`), i to na
//      ścieżce ZAPISU (INSERT głosu do `qa_question_votes`), nie odczytu.
//   2. Dla WSZYSTKICH pięciu czytanych tabel granicę stawia wyłącznie RLS przez
//      `public_tenant_id()`, czyli funkcję, która wyprowadza najemcę z hosta
//      żądania PO STRONIE BAZY. Stan końcowy polityk (zweryfikowany
//      `extractLatestPolicies`, plik `publicReadTenantPolicies.gate.test.ts`
//      obok trzyma to jako bramkę):
//        * `events`           -> "events public read" (anon) + "events member read"
//        * `polls`            -> "polls public read"
//        * `qa_sessions`      -> "qa sessions public read"
//        * `posts`            -> "public reads published posts"
//        * `member_resources` -> "resources public read"
//      Każda z nich niesie `tenant_id = (SELECT public.public_tenant_id())`.
//   3. DRUGĄ, niezależną warstwą jest `edgeTtlCache`: na serwerze kluczuje wpisy
//      po hoście najemcy, więc wpis rozgrzany na domenie A nie może zostać wydany
//      na domenie B. To pas obok szelek, nie zamiennik RLS - i jest osobno
//      dowiedziony w `publicQueriesEdgeCache.test.ts` (kontrakt wywołania stąd)
//      oraz w `src/lib/__tests__/ssrCacheHostScope.test.ts` (sam mechanizm).
//
// Wniosek praktyczny: w tym pliku nie ma czego "poprawić" pod kątem najemcy.
// Ryzyko siedzi gdzie indziej - w tym, że filtry i lista kolumn wysłane do
// PostgREST rozjadą się z tym, co polityki i granty naprawdę przepuszczają.
// I to jest przedmiotem dowodu niżej.
//
// ── CZEGO TEN PLIK DOWIEŚĆ NIE MOŻE ─────────────────────────────────────────
//
// Atrapa klienta Supabase nie ma ani RLS, ani `public_tenant_id()`, ani grantów
// kolumnowych. Test na atrapie widzi WYŁĄCZNIE to, co kod WYSŁAŁ do PostgREST -
// nigdy tego, co baza odesłała. Nie dowodzi więc ani izolacji najemcy, ani
// bramki warstwy, ani tego, że `status='published'` naprawdę odcina szkice.
// Klient filtruje po statusie dla POPRAWNOŚCI WIDOKU; poufność egzekwuje baza.
// Dowodem na tamtą stronę są: polityki w stanie końcowym
// (`publicReadTenantPolicies.gate.test.ts`), harness runtime
// `scripts/tenant-isolation-harness/` i plan pgTAP.
//
// ── CO JEST TU ATRAPOWANE I DLACZEGO ────────────────────────────────────────
//
//   * `@/integrations/supabase/client` - `supabaseFromStub()` + `supabaseRpcStub()`
//     ze wspólnego harnessu `@/test/supabase`. Ten moduł rozmawia z bazą OBIEMA
//     drogami naraz (łańcuch `from(...)` dla tabel, `rpc(...)` dla funkcji
//     SECURITY DEFINER), więc potrzebne są obie atrapy. Brak zaplanowanej
//     odpowiedzi jest w nich BŁĘDEM, nie cichą pustką - test nie może przypadkiem
//     "dowieść" odczytu tabeli, której nie zaplanował.
//   * `@/lib/ssrCache` - rejestrator `edgeTtlCache`, żeby zobaczyć KLUCZ i TTL
//     podane w miejscu wywołania i potwierdzić, że fetcher naprawdę zostaje
//     zawołany. Zachowanie samego cache'u (host scope, serve-stale) jest cudzym
//     kontraktem i ma własny plik.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RecordedChain, SupabaseFromStub, SupabaseRpcStub } from "@/test/supabase";

const ssr = vi.hoisted(() => ({ calls: [] as Array<{ key: string; ttlMs: number }> }));
const sb = vi.hoisted(() => ({
  from: null as SupabaseFromStub | null,
  rpc: null as SupabaseRpcStub | null,
}));

vi.mock("@/lib/ssrCache", () => ({
  edgeTtlCache: <T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> => {
    ssr.calls.push({ key, ttlMs });
    return fetcher();
  },
  invalidateEdgeTtlCache: () => Promise.resolve(),
  clearEdgeTtlCache: () => undefined,
}));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub, supabaseRpcStub } = await import("@/test/supabase");
  const fromStub = supabaseFromStub();
  const rpcStub = supabaseRpcStub();
  sb.from = fromStub;
  sb.rpc = rpcStub;
  return { supabase: { from: fromStub.from, rpc: rpcStub.rpc } };
});

import { ok, fail } from "@/test/supabase";
import { publicEventRow } from "@/test/events/publicEventRow";
import { eventPageHeaderRow } from "@/test/events/eventPageHeaderRow";
import { invalidationKeysFor } from "@/lib/realtime/eventInvalidationMap";
import type { DomainEventRow } from "@/lib/realtime/domainEvents";
import {
  askQaQuestion,
  fetchEventAccess,
  fetchEventPageHeader,
  fetchEventRsvpCounts,
  fetchEventWaitlistPosition,
  fetchLibraryResources,
  fetchPollResults,
  fetchPublicEventBySlug,
  fetchPublicPolls,
  fetchPublicQaQuestions,
  fetchPublicQaSessionBySlug,
  fetchPublicQaSessions,
  fetchQaSummaryPost,
  eventPageHeaderQueryOptions,
  libraryResourcesQueryOptions,
  pollResultsQueryOptions,
  publicEventBySlugQueryOptions,
  publicEventsQueryOptions,
  publicPollsQueryOptions,
  rsvpEvent,
  votePoll,
  type PublicResource,
} from "@/lib/community/publicQueries";

// ---------------------------------------------------------------------------
// Narzędzia testu
// ---------------------------------------------------------------------------

function db(): SupabaseFromStub {
  if (sb.from === null) throw new Error("atrapa `from` nie została utworzona");
  return sb.from;
}

function rpc(): SupabaseRpcStub {
  if (sb.rpc === null) throw new Error("atrapa `rpc` nie została utworzona");
  return sb.rpc;
}

/** Uruchamia `queryFn` opcji tak, jak zrobiłby to react-query. */
function runQueryFn<T>(options: { queryFn?: unknown }): Promise<T> {
  return (options.queryFn as () => Promise<T>)();
}

function chainOf(table: string): RecordedChain {
  const chain = db().lastChain(table);
  if (chain === undefined) throw new Error(`nie było żadnego zapytania do "${table}"`);
  return chain;
}

/** Lista kolumn z `select("a, b, c")` - rozbita i przycięta. */
function selectedColumns(chain: RecordedChain): string[] {
  const raw = chain.argsOf("select")?.[0];
  if (typeof raw !== "string") throw new Error("select() bez listy kolumn");
  return raw
    .split(",")
    .map((column) => column.trim())
    .filter((column) => column !== "");
}

/** Argumenty WSZYSTKICH wystąpień ogniwa (`argsOf` oddaje tylko pierwsze). */
function allArgsOf(chain: RecordedChain, method: string): ReadonlyArray<ReadonlyArray<unknown>> {
  return chain.calls.filter((call) => call.method === method).map((call) => call.args);
}

/** Zdarzenie domenowe w pełnym kształcie wiersza - bez rzutowań. */
function domainEvent(eventType: string): DomainEventRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    tenant_id: "22222222-2222-4222-8222-222222222222",
    aggregate_type: eventType.split(".")[0],
    aggregate_id: "33333333-3333-4333-8333-333333333333",
    event_type: eventType,
    payload: {},
    actor_id: null,
    correlation_id: null,
    created_at: "2026-09-01T10:00:00.000Z",
  };
}

/** Dopasowanie TanStack Query: klucz pasuje po PRZEDROSTKU. */
function matchedByPrefix(keys: ReadonlyArray<ReadonlyArray<unknown>>, key: readonly unknown[]) {
  return keys.some((prefix) => prefix.every((part, index) => Object.is(key[index], part)));
}

function resourceRow(overrides: Partial<PublicResource> = {}): PublicResource {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    title_pl: "Kompendium regulacji cyfrowych",
    title_en: "Digital regulation compendium",
    description_pl: "Zestawienie aktów i terminów.",
    description_en: "Acts and deadlines at a glance.",
    category: "briefing",
    file_name: "kompendium.pdf",
    file_size: 204_800,
    mime_type: "application/pdf",
    min_tier_rank: 1,
    download_count: 12,
    created_at: "2026-08-20T09:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  db().reset();
  rpc().reset();
  ssr.calls.length = 0;
});

// ---------------------------------------------------------------------------
// Lista /events
// ---------------------------------------------------------------------------

describe("lista wydarzeń: co idzie do bazy i czego baza nie zdąży odmówić", () => {
  it("czyta WYŁĄCZNIE opublikowane, najwyżej 200, najpóźniejsze najpierw", async () => {
    db().setResponse("events", ok([publicEventRow()]));

    await runQueryFn<unknown>(publicEventsQueryOptions());

    const chain = chainOf("events");
    expect(chain.argsOf("eq")).toEqual(["status", "published"]);
    expect(chain.argsOf("order")).toEqual(["starts_at", { ascending: false }]);
    expect(chain.argsOf("limit")).toEqual([200]);
    // Odczyt listy nie ma prawa użyć ogniwa terminalnego - `maybeSingle` na
    // liście oddałby błąd PGRST116 przy drugim wydarzeniu.
    expect(chain.has("maybeSingle")).toBe(false);
  });

  it("EVENT_COLUMNS pokrywa się CO DO POLA z typem PublicEvent", async () => {
    // DLACZEGO TO JEST TEST, A NIE KOSMETYKA. `events` ma jawną allowlistę
    // kolumn czytelnych dla `anon` i `authenticated` (migracja 20260803191905
    // odebrała tabelowy SELECT). Kolumna dopisana ALTER-em NIE wchodzi do
    // allowlisty sama: `select` na nią kończy się ODMOWĄ UPRAWNIEŃ dla CAŁEGO
    // zapytania, więc lista /events i strona wydarzenia przestają się wczytywać
    // W CAŁOŚCI - to nie jest puste pole, to jest biała strona. Rozjazd w drugą
    // stronę (pole w typie bez kolumny w select) daje `undefined` udające dane.
    // Zgodność listy z grantem sprawdza `publicReadTenantPolicies.gate.test.ts`.
    db().setResponse("events", ok([]));

    await runQueryFn<unknown>(publicEventsQueryOptions());

    expect(selectedColumns(chainOf("events")).sort()).toEqual(Object.keys(publicEventRow()).sort());
  });

  it("NIE pobiera join_url ani recording_url - jedyną drogą jest get_event_access", async () => {
    db().setResponse("events", ok([]));

    await runQueryFn<unknown>(publicEventsQueryOptions());

    const columns = selectedColumns(chainOf("events"));
    expect(columns).not.toContain("join_url");
    expect(columns).not.toContain("recording_url");
  });

  it("pusta odpowiedź bazy daje pustą listę, nie wyjątek", async () => {
    db().setResponse("events", ok(null));

    await expect(runQueryFn<unknown[]>(publicEventsQueryOptions())).resolves.toEqual([]);
  });

  it("odmowa bazy leci dalej jako błąd - lista nie udaje pustej", async () => {
    db().setResponse("events", fail("permission denied for column languages", "42501"));

    await expect(runQueryFn<unknown>(publicEventsQueryOptions())).rejects.toThrow(
      "permission denied for column languages",
    );
  });

  it("odczyt SSR idzie przez per-hostowy TTL cache z kluczem listy", async () => {
    db().setResponse("events", ok([]));

    await runQueryFn<unknown>(publicEventsQueryOptions());

    expect(ssr.calls).toEqual([{ key: "public:events-list", ttlMs: 60_000 }]);
  });

  it("opcje niosą klucz listy i okna świeżości współdzielone z loaderem SSR", () => {
    const options = publicEventsQueryOptions();

    expect(options.queryKey).toEqual(["public-events"]);
    expect(options.staleTime).toBe(60_000);
    expect(options.gcTime).toBe(600_000);
  });
});

// ---------------------------------------------------------------------------
// Sklejenie z mapą inwalidacji realtime
// ---------------------------------------------------------------------------

describe("sklejenie kluczy z eventInvalidationMap (unieważnianie na żywo)", () => {
  // Mapa inwalidacji trzyma LITERAŁY (["public-events"], ["public-event"]), bo
  // import fabryk wciągnąłby React Query do pliku czytanego przez szynę zdarzeń.
  // Literał milczy: przemianowanie klucza tutaj nie oblewa ani typów, ani builda,
  // a publikacja wydarzenia po prostu przestaje odświeżać stronę. Ten test pyta
  // z DRUGIEJ strony niż `lib/realtime/__tests__/eventRealtimeKeys.test.ts` -
  // bierze klucz z FABRYKI i sprawdza, czy mapa go trafia.
  const context = { userId: undefined };

  it("publikacja wydarzenia unieważnia klucz listy", () => {
    const keys = invalidationKeysFor(domainEvent("event.published.v1"), context);

    expect(matchedByPrefix(keys, publicEventsQueryOptions().queryKey)).toBe(true);
  });

  it("publikacja wydarzenia unieważnia klucz KAŻDEJ strony wydarzenia", () => {
    const keys = invalidationKeysFor(domainEvent("event.published.v1"), context);

    for (const slug of ["kongres-strategii", "brukselskie-sniadanie"]) {
      expect(matchedByPrefix(keys, publicEventBySlugQueryOptions(slug).queryKey)).toBe(true);
    }
  });

  it("odwołanie wydarzenia unieważnia te same dwa klucze", () => {
    const keys = invalidationKeysFor(domainEvent("event.cancelled.v1"), context);

    expect(matchedByPrefix(keys, publicEventsQueryOptions().queryKey)).toBe(true);
    expect(matchedByPrefix(keys, publicEventBySlugQueryOptions("kongres-strategii").queryKey)).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// Strona wydarzenia po slugu
// ---------------------------------------------------------------------------

describe("wydarzenie po slugu: filtr publikacji jest częścią zapytania", () => {
  it("filtruje po slugu I po statusie, pojedynczym wierszem", async () => {
    db().setResponse("events", ok(publicEventRow({ slug: "kongres-strategii" })));

    await runQueryFn<unknown>(publicEventBySlugQueryOptions("kongres-strategii"));

    const chain = chainOf("events");
    expect(allArgsOf(chain, "eq")).toEqual([
      ["slug", "kongres-strategii"],
      ["status", "published"],
    ]);
    expect(chain.has("maybeSingle")).toBe(true);
  });

  it("czyta tę samą listę kolumn co lista - jeden grant, jeden kontrakt", async () => {
    db().setResponse("events", ok(null));
    await fetchPublicEventBySlug("kongres-strategii");
    const bySlug = selectedColumns(chainOf("events"));

    db().reset();
    db().setResponse("events", ok([]));
    await runQueryFn<unknown>(publicEventsQueryOptions());

    expect(bySlug).toEqual(selectedColumns(chainOf("events")));
  });

  it("brak wiersza to null, a nie wyjątek (miękkie 404 trasy)", async () => {
    db().setResponse("events", ok(null));

    await expect(fetchPublicEventBySlug("nie-ma-takiego")).resolves.toBeNull();
  });

  it("odmowa bazy leci dalej jako błąd", async () => {
    db().setResponse("events", fail("relation events does not exist", "42P01"));

    await expect(fetchPublicEventBySlug("kongres-strategii")).rejects.toThrow(
      "relation events does not exist",
    );
  });

  it("klucz i wpis TTL cache są PER SLUG - dwie strony nie dzielą jednej migawki", async () => {
    db().setResponse("events", ok(null));

    await runQueryFn<unknown>(publicEventBySlugQueryOptions("kongres-strategii"));
    await runQueryFn<unknown>(publicEventBySlugQueryOptions("brukselskie-sniadanie"));

    expect(publicEventBySlugQueryOptions("kongres-strategii").queryKey).toEqual([
      "public-event",
      "kongres-strategii",
    ]);
    expect(ssr.calls).toEqual([
      { key: "public:event:kongres-strategii", ttlMs: 60_000 },
      { key: "public:event:brukselskie-sniadanie", ttlMs: 60_000 },
    ]);
  });

  it("okna świeżości są te same, co na liście", () => {
    const options = publicEventBySlugQueryOptions("kongres-strategii");

    expect(options.staleTime).toBe(60_000);
    expect(options.gcTime).toBe(600_000);
  });
});

// ---------------------------------------------------------------------------
// Nagłówek strony wydarzenia
// ---------------------------------------------------------------------------

describe("nagłówek strony wydarzenia: odpowiedź PERSONALIZOWANA", () => {
  it("woła event_page_header po slugu i oddaje pierwszy wiersz", async () => {
    rpc().setData("event_page_header", [eventPageHeaderRow({ slug: "kongres-strategii" })]);

    const header = await fetchEventPageHeader("kongres-strategii");

    expect(rpc().lastCall("event_page_header")?.arg("p_slug")).toBe("kongres-strategii");
    expect(header?.slug).toBe("kongres-strategii");
  });

  it("pusty zbiór to null - i to jedyne poprawne wejście dla notFound()", async () => {
    rpc().setData("event_page_header", []);

    await expect(fetchEventPageHeader("nie-ma-takiego")).resolves.toBeNull();
  });

  it("brak danych (null) też daje null, a nie wybuch na indeksowaniu", async () => {
    rpc().setData("event_page_header", null);

    await expect(fetchEventPageHeader("nie-ma-takiego")).resolves.toBeNull();
  });

  it("odmowa RPC leci dalej jako błąd", async () => {
    rpc().setError("event_page_header", "function does not exist", "42883");

    await expect(fetchEventPageHeader("kongres-strategii")).rejects.toThrow(
      "function does not exist",
    );
  });

  it("WIDZ JEST CZĘŚCIĄ KLUCZA - wpis jednego czytelnika nie wyjdzie drugiemu", () => {
    // RPC personalizuje odpowiedź (`my_*`, `tier_locked`, `chatham_house_locked`),
    // więc klucz bez tożsamości wołającego wydałby stan jednego widza drugiemu.
    const anon = eventPageHeaderQueryOptions("kongres-strategii", "anon");
    const member = eventPageHeaderQueryOptions("kongres-strategii", "user-1");

    expect(anon.queryKey).toEqual(["event-page-header", "kongres-strategii", "anon"]);
    expect(member.queryKey).toEqual(["event-page-header", "kongres-strategii", "user-1"]);
    expect(anon.queryKey).not.toEqual(member.queryKey);
  });

  it("ŚWIADOMIE bez edgeTtlCache - cache po hoście nie widzi tożsamości widza", async () => {
    rpc().setData("event_page_header", [eventPageHeaderRow()]);

    await runQueryFn<unknown>(eventPageHeaderQueryOptions("kongres-strategii", "user-1"));

    expect(ssr.calls).toEqual([]);
    expect(rpc().names()).toEqual(["event_page_header"]);
  });
});

// ---------------------------------------------------------------------------
// Dostęp do transmisji i nagrania
// ---------------------------------------------------------------------------

describe("dostęp do transmisji i nagrania (get_event_access)", () => {
  const access = {
    can_join: true,
    join_url: "https://stream.example.test/abc",
    can_watch: false,
    recording_url: null,
    reason: "ok",
    watch_reason: "none",
  };

  it("oddaje pierwszy wiersz, gdy RPC zwraca TABLICĘ", async () => {
    rpc().setData("get_event_access", [access]);

    await expect(fetchEventAccess("event-1")).resolves.toEqual(access);
    expect(rpc().lastCall("get_event_access")?.arg("p_event_id")).toBe("event-1");
  });

  it("oddaje wiersz wprost, gdy RPC zwraca OBIEKT (kształt skalarny)", async () => {
    rpc().setData("get_event_access", access);

    await expect(fetchEventAccess("event-1")).resolves.toEqual(access);
  });

  it("pusta tablica i null dają null - strona rysuje wtedy bramkę, nie link", async () => {
    rpc().setData("get_event_access", []);
    await expect(fetchEventAccess("event-1")).resolves.toBeNull();

    rpc().setData("get_event_access", null);
    await expect(fetchEventAccess("event-1")).resolves.toBeNull();
  });

  it("odmowa RPC leci dalej jako błąd", async () => {
    rpc().setError("get_event_access", "forbidden", "P0001");

    await expect(fetchEventAccess("event-1")).rejects.toThrow("forbidden");
  });
});

// ---------------------------------------------------------------------------
// Liczniki RSVP
// ---------------------------------------------------------------------------

describe("liczniki RSVP: mapa po event_id", () => {
  it("PUSTA lista identyfikatorów nie idzie do bazy wcale", async () => {
    const counts = await fetchEventRsvpCounts([]);

    expect(counts.size).toBe(0);
    expect(rpc().calls).toEqual([]);
    expect(db().chains).toEqual([]);
  });

  it("indeksuje wiersze po event_id", async () => {
    rpc().setData("get_event_rsvp_counts", [
      { event_id: "e1", going: 12, interested: 3, waitlist: 1 },
      { event_id: "e2", going: 0, interested: 0, waitlist: 0 },
    ]);

    const counts = await fetchEventRsvpCounts(["e1", "e2"]);

    expect(rpc().lastCall("get_event_rsvp_counts")?.arg("p_event_ids")).toEqual(["e1", "e2"]);
    expect(counts.get("e1")?.going).toBe(12);
    expect(counts.get("e2")?.waitlist).toBe(0);
    expect(counts.size).toBe(2);
  });

  it("brak danych daje pustą mapę, a nie wyjątek", async () => {
    rpc().setData("get_event_rsvp_counts", null);

    await expect(fetchEventRsvpCounts(["e1"])).resolves.toEqual(new Map());
  });

  it("odmowa RPC leci dalej jako błąd", async () => {
    rpc().setError("get_event_rsvp_counts", "statement timeout", "57014");

    await expect(fetchEventRsvpCounts(["e1"])).rejects.toThrow("statement timeout");
  });
});

// ---------------------------------------------------------------------------
// RSVP
// ---------------------------------------------------------------------------

describe("RSVP: serwer rozstrzyga status, klient go tylko czyta", () => {
  it("przekazuje wydarzenie i żądany status", async () => {
    rpc().setData("rsvp_event", {
      status: "going",
      going: 5,
      waitlist: 0,
      waitlist_position: null,
    });

    await rsvpEvent("event-1", "going");

    const call = rpc().lastCall("rsvp_event");
    expect(call?.arg("p_event_id")).toBe("event-1");
    expect(call?.arg("p_status")).toBe("going");
  });

  it("KOMPLET MIEJSC: serwerowa degradacja do listy rezerwowej dochodzi do klienta", async () => {
    rpc().setData("rsvp_event", {
      status: "waitlist",
      going: 100,
      waitlist: 4,
      waitlist_position: 4,
    });

    await expect(rsvpEvent("event-1", "going")).resolves.toEqual({
      status: "waitlist",
      going: 100,
      waitlist: 4,
      waitlist_position: 4,
    });
  });

  it("NIEZNANY status z serwera cofa się do żądanego, nie do pustki", async () => {
    // Nowszy backend ze statusem, którego ten bundle nie zna, nie może wywrócić
    // przycisku w stan bez znaczenia - klient zakłada wtedy własne żądanie.
    rpc().setData("rsvp_event", { status: "pending_payment", going: 7, waitlist: 0 });

    await expect(rsvpEvent("event-1", "interested")).resolves.toMatchObject({
      status: "interested",
      going: 7,
    });
  });

  it("BRAKUJĄCE pola liczbowe schodzą do zer, a pozycja do null", async () => {
    rpc().setData("rsvp_event", { status: "cancelled" });

    await expect(rsvpEvent("event-1", "cancelled")).resolves.toEqual({
      status: "cancelled",
      going: 0,
      waitlist: 0,
      waitlist_position: null,
    });
  });

  it("pola o ZŁYM TYPIE traktowane są jak brak, nie przepisywane na ślepo", async () => {
    rpc().setData("rsvp_event", {
      status: "going",
      going: "12",
      waitlist: null,
      waitlist_position: "4",
    });

    await expect(rsvpEvent("event-1", "going")).resolves.toEqual({
      status: "going",
      going: 0,
      waitlist: 0,
      waitlist_position: null,
    });
  });

  it("odpowiedź NIE-OBIEKTOWA (null, napis) nie wywraca parsera", async () => {
    rpc().setData("rsvp_event", null);
    await expect(rsvpEvent("event-1", "going")).resolves.toEqual({
      status: "going",
      going: 0,
      waitlist: 0,
      waitlist_position: null,
    });

    rpc().setData("rsvp_event", "ok");
    await expect(rsvpEvent("event-1", "interested")).resolves.toMatchObject({
      status: "interested",
    });
  });

  it("odmowa RPC (rate limit, brak miejsc, bramka warstwy) leci dalej", async () => {
    rpc().setError("rsvp_event", "rate_limited", "P0001");

    await expect(rsvpEvent("event-1", "going")).rejects.toThrow("rate_limited");
  });
});

describe("pozycja na liście rezerwowej", () => {
  it("liczba dochodzi bez zmian", async () => {
    rpc().setData("get_event_waitlist_position", 3);

    await expect(fetchEventWaitlistPosition("event-1")).resolves.toBe(3);
    expect(rpc().lastCall("get_event_waitlist_position")?.arg("p_event_id")).toBe("event-1");
  });

  it("poza kolejką (null) i wartość nie-liczbowa dają null", async () => {
    rpc().setData("get_event_waitlist_position", null);
    await expect(fetchEventWaitlistPosition("event-1")).resolves.toBeNull();

    rpc().setData("get_event_waitlist_position", "3");
    await expect(fetchEventWaitlistPosition("event-1")).resolves.toBeNull();
  });

  it("odmowa RPC leci dalej jako błąd", async () => {
    rpc().setError("get_event_waitlist_position", "forbidden", "P0001");

    await expect(fetchEventWaitlistPosition("event-1")).rejects.toThrow("forbidden");
  });
});

// ---------------------------------------------------------------------------
// Ankiety
// ---------------------------------------------------------------------------

describe("ankiety publiczne: kształt zapytania i normalizacja opcji", () => {
  const pollRow = {
    id: "p1",
    question_pl: "Czy pakiet klimatyczny wymaga rewizji?",
    question_en: "Does the climate package need a revision?",
    options: [{ pl: "Tak", en: "Yes" }],
    status: "open",
    ends_at: null,
  };

  it("czyta tylko ankiety otwarte i zamknięte, najnowsze pierwsze, do 100", async () => {
    db().setResponse("polls", ok([pollRow]));

    await fetchPublicPolls();

    const chain = chainOf("polls");
    expect(chain.argsOf("in")).toEqual(["status", ["open", "closed"]]);
    expect(chain.argsOf("order")).toEqual(["created_at", { ascending: false }]);
    expect(chain.argsOf("limit")).toEqual([100]);
    expect(selectedColumns(chain)).toEqual([
      "id",
      "question_pl",
      "question_en",
      "options",
      "status",
      "ends_at",
    ]);
  });

  it("opcje przychodzą jako tablica i przechodzą bez zmian", async () => {
    db().setResponse("polls", ok([pollRow]));

    const polls = await fetchPublicPolls();

    expect(polls[0].options).toEqual([{ pl: "Tak", en: "Yes" }]);
  });

  it("opcje NIE-TABLICOWE (JSON z panelu) schodzą do pustej listy", async () => {
    // `options` to kolumna jsonb - wiersz z obiektem zamiast tablicy nie może
    // wywrócić renderu listy na `.map` po nie-tablicy.
    db().setResponse("polls", ok([{ ...pollRow, options: { pl: "Tak" } }]));

    const polls = await fetchPublicPolls();

    expect(polls[0].options).toEqual([]);
  });

  it("brak danych daje pustą listę", async () => {
    db().setResponse("polls", ok(null));

    await expect(fetchPublicPolls()).resolves.toEqual([]);
  });

  it("odmowa bazy leci dalej jako błąd", async () => {
    db().setResponse("polls", fail("permission denied for table polls", "42501"));

    await expect(fetchPublicPolls()).rejects.toThrow("permission denied for table polls");
  });

  it("queryFn listy ankiet czyta tabelę BEZ pośrednictwa TTL cache", async () => {
    db().setResponse("polls", ok([]));

    await runQueryFn<unknown>(publicPollsQueryOptions());

    expect(db().chainsFor("polls")).toHaveLength(1);
    expect(ssr.calls).toEqual([]);
  });
});

describe("wyniki ankiet: anti-anchoring jest DOMYŚLNY", () => {
  it("PUSTA lista identyfikatorów nie idzie do bazy wcale", async () => {
    const results = await fetchPollResults([]);

    expect(results.size).toBe(0);
    expect(rpc().calls).toEqual([]);
  });

  it("indeksuje wyniki po poll_id i parsuje każdy wiersz", async () => {
    rpc().setData("get_poll_results_bulk", [
      { poll_id: "p1", result: { visible: true, my_vote: 1, total: 9, counts: [4, 5] } },
      { poll_id: "p2", result: { visible: false } },
    ]);

    const results = await fetchPollResults(["p1", "p2"]);

    expect(rpc().lastCall("get_poll_results_bulk")?.arg("p_poll_ids")).toEqual(["p1", "p2"]);
    expect(results.get("p1")).toEqual({ visible: true, my_vote: 1, total: 9, counts: [4, 5] });
    expect(results.get("p2")).toEqual({ visible: false, my_vote: null, total: 0, counts: [] });
  });

  it("visible zapala się TYLKO na literalnym true - nic prawdziwościowego", async () => {
    // Rozkład głosów przed oddaniem własnego zakotwicza wybór. Gdyby parser
    // przyjmował wartości prawdziwościowe, `visible: 1` albo `"true"` z jednego
    // starszego wiersza odsłoniłby liczby wbrew regule serwera.
    rpc().setData("get_poll_results_bulk", [
      { poll_id: "p1", result: { visible: 1, total: 9, counts: [4, 5] } },
      { poll_id: "p2", result: { visible: "true" } },
    ]);

    const results = await fetchPollResults(["p1", "p2"]);

    expect(results.get("p1")?.visible).toBe(false);
    expect(results.get("p2")?.visible).toBe(false);
  });

  it("wynik nie-obiektowy schodzi do stanu zamkniętego, nie do wybuchu", async () => {
    rpc().setData("get_poll_results_bulk", [{ poll_id: "p1", result: null }]);

    expect((await fetchPollResults(["p1"])).get("p1")).toEqual({
      visible: false,
      my_vote: null,
      total: 0,
      counts: [],
    });
  });

  it("counts o złym typie schodzą do pustej tablicy", async () => {
    rpc().setData("get_poll_results_bulk", [
      { poll_id: "p1", result: { visible: true, counts: "4,5", total: "9", my_vote: "1" } },
    ]);

    expect((await fetchPollResults(["p1"])).get("p1")).toEqual({
      visible: true,
      my_vote: null,
      total: 0,
      counts: [],
    });
  });

  it("brak danych daje pustą mapę", async () => {
    rpc().setData("get_poll_results_bulk", null);

    await expect(fetchPollResults(["p1"])).resolves.toEqual(new Map());
  });

  it("odmowa RPC leci dalej jako błąd", async () => {
    rpc().setError("get_poll_results_bulk", "forbidden", "P0001");

    await expect(fetchPollResults(["p1"])).rejects.toThrow("forbidden");
  });

  it("queryFn wyników czyta RPC i NIGDY nie zapieka rozkładu w TTL cache", async () => {
    rpc().setData("get_poll_results_bulk", []);

    await runQueryFn<unknown>(pollResultsQueryOptions(["p1"], "user-1"));

    expect(rpc().names()).toEqual(["get_poll_results_bulk"]);
    expect(ssr.calls).toEqual([]);
  });
});

describe("głosowanie", () => {
  it("przekazuje ankietę i indeks opcji, oddaje świeże wyniki", async () => {
    rpc().setData("vote_poll", { visible: true, my_vote: 0, total: 1, counts: [1, 0] });

    const results = await votePoll("p1", 0);

    const call = rpc().lastCall("vote_poll");
    expect(call?.arg("p_poll_id")).toBe("p1");
    expect(call?.arg("p_option_idx")).toBe(0);
    expect(results).toEqual({ visible: true, my_vote: 0, total: 1, counts: [1, 0] });
  });

  it("odmowa (zamknięte okno, zła opcja) leci dalej jako błąd", async () => {
    rpc().setError("vote_poll", "poll_closed", "P0001");

    await expect(votePoll("p1", 0)).rejects.toThrow("poll_closed");
  });

  it("odpowiedź bez pól schodzi do stanu zamkniętego", async () => {
    rpc().setData("vote_poll", {});

    await expect(votePoll("p1", 1)).resolves.toEqual({
      visible: false,
      my_vote: null,
      total: 0,
      counts: [],
    });
  });
});

// ---------------------------------------------------------------------------
// Sesje Q&A
// ---------------------------------------------------------------------------

describe("sesje Q&A: szkic redakcyjny nie wchodzi do listy", () => {
  const sessionRow = {
    id: "s1",
    slug: "pytania-o-budzet",
    title_pl: "Pytania o budżet",
    title_en: "Budget questions",
    intro_pl: null,
    intro_en: null,
    status: "open",
    opens_at: "2026-09-10T08:00:00.000Z",
    closes_at: null,
    host_user_id: null,
    post_id: null,
  };

  it("lista pomija szkice, sortuje po otwarciu i tnie na 100", async () => {
    db().setResponse("qa_sessions", ok([sessionRow]));

    await fetchPublicQaSessions();

    const chain = chainOf("qa_sessions");
    expect(chain.argsOf("neq")).toEqual(["status", "draft"]);
    expect(chain.argsOf("order")).toEqual(["opens_at", { ascending: false, nullsFirst: false }]);
    expect(chain.argsOf("limit")).toEqual([100]);
    expect(selectedColumns(chain)).toEqual([
      "id",
      "slug",
      "title_pl",
      "title_en",
      "intro_pl",
      "intro_en",
      "status",
      "opens_at",
      "closes_at",
      "host_user_id",
      "post_id",
    ]);
  });

  it("brak danych daje pustą listę", async () => {
    db().setResponse("qa_sessions", ok(null));

    await expect(fetchPublicQaSessions()).resolves.toEqual([]);
  });

  it("odmowa bazy na liście leci dalej jako błąd", async () => {
    db().setResponse("qa_sessions", fail("permission denied for table qa_sessions", "42501"));

    await expect(fetchPublicQaSessions()).rejects.toThrow(
      "permission denied for table qa_sessions",
    );
  });

  it("pojedyncza sesja filtruje po slugu I po nie-szkicu", async () => {
    db().setResponse("qa_sessions", ok(sessionRow));

    await fetchPublicQaSessionBySlug("pytania-o-budzet");

    const chain = chainOf("qa_sessions");
    expect(chain.argsOf("eq")).toEqual(["slug", "pytania-o-budzet"]);
    expect(chain.argsOf("neq")).toEqual(["status", "draft"]);
    expect(chain.has("maybeSingle")).toBe(true);
  });

  it("nieznany slug daje null", async () => {
    db().setResponse("qa_sessions", ok(null));

    await expect(fetchPublicQaSessionBySlug("nie-ma")).resolves.toBeNull();
  });

  it("odmowa bazy na pojedynczej sesji leci dalej jako błąd", async () => {
    db().setResponse("qa_sessions", fail("PGRST116", "PGRST116"));

    await expect(fetchPublicQaSessionBySlug("pytania-o-budzet")).rejects.toThrow("PGRST116");
  });

  it("lista i sesja po slugu czytają IDENTYCZNĄ listę kolumn", async () => {
    db().setResponse("qa_sessions", ok(null));
    await fetchPublicQaSessionBySlug("pytania-o-budzet");
    const bySlug = selectedColumns(chainOf("qa_sessions"));

    db().reset();
    db().setResponse("qa_sessions", ok([]));
    await fetchPublicQaSessions();

    expect(bySlug).toEqual(selectedColumns(chainOf("qa_sessions")));
  });
});

describe("teaser podsumowania sesji: szkic z kolejki redakcyjnej nie wycieka", () => {
  it("filtruje po identyfikatorze, statusie 'published' I braku skasowania", async () => {
    // Trzy filtry w JEDNYM zapytaniu. `deleted_at IS NULL` jest tu tak samo
    // ważny jak status: wpis skasowany miękko zostaje w tabeli, więc bez tego
    // ogniwa link "przeczytaj podsumowanie" prowadziłby do treści wycofanej.
    db().setResponse("posts", ok({ slug: "budzet-podsumowanie", title_pl: "P", title_en: "S" }));

    await fetchQaSummaryPost("post-1");

    const chain = chainOf("posts");
    expect(allArgsOf(chain, "eq")).toEqual([
      ["id", "post-1"],
      ["status", "published"],
    ]);
    expect(chain.argsOf("is")).toEqual(["deleted_at", null]);
    expect(chain.has("maybeSingle")).toBe(true);
  });

  it("czyta TYLKO trzy kolumny teasera - bez treści wpisu", async () => {
    db().setResponse("posts", ok(null));

    await fetchQaSummaryPost("post-1");

    expect(selectedColumns(chainOf("posts"))).toEqual(["slug", "title_pl", "title_en"]);
  });

  it("szkic (brak dopasowania) daje null, a nie pusty teaser", async () => {
    db().setResponse("posts", ok(null));

    await expect(fetchQaSummaryPost("post-1")).resolves.toBeNull();
  });

  it("odmowa bazy leci dalej jako błąd", async () => {
    db().setResponse("posts", fail("permission denied for table posts", "42501"));

    await expect(fetchQaSummaryPost("post-1")).rejects.toThrow("permission denied for table posts");
  });
});

describe("pytania sesji Q&A (porządek serwerowy)", () => {
  it("woła list_qa_questions po sesji i oddaje wiersze bez przetwarzania", async () => {
    const question = {
      id: "q1",
      session_id: "s1",
      author_display: null,
      is_anonymous: true,
      body: "Jak wygląda harmonogram?",
      status: "approved",
      answer_body: null,
      answered_at: null,
      created_at: "2026-09-01T09:00:00.000Z",
      votes: 2,
      is_priority: false,
      my_vote: false,
    };
    rpc().setData("list_qa_questions", [question]);

    await expect(fetchPublicQaQuestions("s1")).resolves.toEqual([question]);
    expect(rpc().lastCall("list_qa_questions")?.arg("p_session_id")).toBe("s1");
  });

  it("brak danych daje pustą listę", async () => {
    rpc().setData("list_qa_questions", null);

    await expect(fetchPublicQaQuestions("s1")).resolves.toEqual([]);
  });

  it("odmowa RPC leci dalej jako błąd", async () => {
    rpc().setError("list_qa_questions", "session_not_found", "P0001");

    await expect(fetchPublicQaQuestions("s1")).rejects.toThrow("session_not_found");
  });
});

describe("zadanie pytania", () => {
  it("przekazuje sesję, treść i flagę anonimowości - nic więcej", async () => {
    rpc().setData("ask_qa_question", "q-new");

    await expect(
      askQaQuestion({ sessionId: "s1", body: "Czy będzie transmisja?", anonymous: true }),
    ).resolves.toBe("q-new");

    const call = rpc().lastCall("ask_qa_question");
    expect(call?.keys().sort()).toEqual(["p_anonymous", "p_body", "p_session_id"]);
    expect(call?.arg("p_session_id")).toBe("s1");
    expect(call?.arg("p_body")).toBe("Czy będzie transmisja?");
    expect(call?.arg("p_anonymous")).toBe(true);
  });

  it("pytanie podpisane przekazuje anonymous=false, a nie brak klucza", async () => {
    rpc().setData("ask_qa_question", "q-new");

    await askQaQuestion({ sessionId: "s1", body: "Pytanie", anonymous: false });

    expect(rpc().lastCall("ask_qa_question")?.arg("p_anonymous")).toBe(false);
  });

  it("odmowa (rate limit 5/h, sesja zamknięta) leci dalej jako błąd", async () => {
    rpc().setError("ask_qa_question", "rate_limited", "P0001");

    await expect(
      askQaQuestion({ sessionId: "s1", body: "Pytanie", anonymous: false }),
    ).rejects.toThrow("rate_limited");
  });
});

// ---------------------------------------------------------------------------
// Biblioteka materiałów
// ---------------------------------------------------------------------------

describe("biblioteka materiałów: metadane publiczne, plik za bramką", () => {
  it("czyta tylko opublikowane, w kolejności redakcyjnej, do 300", async () => {
    db().setResponse("member_resources", ok([resourceRow()]));

    await fetchLibraryResources();

    const chain = chainOf("member_resources");
    expect(chain.argsOf("eq")).toEqual(["published", true]);
    expect(allArgsOf(chain, "order")).toEqual([
      ["sort_order", { ascending: true }],
      ["created_at", { ascending: false }],
    ]);
    expect(chain.argsOf("limit")).toEqual([300]);
  });

  it("NIE wybiera file_path - kolumna wskazuje plik w PRYWATNYM buckecie", async () => {
    // Sam plik wymaga RPC `authorize_resource_download` (bramka rangi), więc
    // ścieżka nie ma po co opuszczać bazy. Uwaga na granicę dowodu: to jest
    // decyzja KLIENTA, nie granica bazy - `member_resources` ma grant TABELOWY
    // dla `anon`, więc dowolny inny klient tę kolumnę odczyta. Kontrakt grantu
    // jest opisany w `publicReadTenantPolicies.gate.test.ts`.
    db().setResponse("member_resources", ok([]));

    await fetchLibraryResources();

    const columns = selectedColumns(chainOf("member_resources"));
    expect(columns).not.toContain("file_path");
    expect(columns.sort()).toEqual(Object.keys(resourceRow()).sort());
  });

  it("brak danych daje pustą listę", async () => {
    db().setResponse("member_resources", ok(null));

    await expect(fetchLibraryResources()).resolves.toEqual([]);
  });

  it("odmowa bazy leci dalej jako błąd", async () => {
    db().setResponse("member_resources", fail("permission denied", "42501"));

    await expect(fetchLibraryResources()).rejects.toThrow("permission denied");
  });

  it("queryFn biblioteki czyta tabelę BEZ pośrednictwa TTL cache", async () => {
    db().setResponse("member_resources", ok([resourceRow()]));

    const resources = await runQueryFn<PublicResource[]>(libraryResourcesQueryOptions());

    expect(resources).toHaveLength(1);
    expect(db().chainsFor("member_resources")).toHaveLength(1);
    expect(ssr.calls).toEqual([]);
  });
});
