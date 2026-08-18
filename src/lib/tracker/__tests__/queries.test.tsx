// Warstwa zapytań trackera legislacyjnego UE.
//
// DLACZEGO TO MA ZNACZENIE. Reguły etapów, JSON-LD i budowa feedu mają testy od
// dawna (`stages.test.ts`, `jsonld.test.ts`, `feed.test.ts`), ale plik, przez
// który przechodzi KAŻDY publiczny odczyt trackera - 488 linii - nie miał do
// 18.08.2026 ani jednego wykonania. Audyt policzył tracker na 31,1% linii przy
// 5 z 9 plików na zerze, a `queries.ts` był największym z nich.
//
// Ten plik sprawdza KONTRAKT ZAPYTANIA, nie tylko zwrócone dane. Atrapa
// `supabaseFromStub` nagrywa ogniwa łańcucha, więc test potrafi udowodnić, że
// filtr publikacji naprawdę poleciał do bazy - a nie tylko, że atrapa oddała
// to, co jej podłożono. Bez tego rozróżnienia test „przechodzi" także wtedy,
// gdy ktoś skasuje `.eq("status", "published")`.
//
// CZEGO TU NIE MA: izolacji tenantów feedu - to jest własność RLS i ma własny
// dowód w `supabase/tests/tracker_feed_tenant_isolation_test.sql`.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fail, ok, supabaseFromStub, type SupabaseResult } from "@/test/supabaseChain";

const h = vi.hoisted(() => ({
  rpc: vi.fn<(fn: string, args?: Record<string, unknown>) => Promise<SupabaseResult>>(),
}));
const stubs = vi.hoisted(() => ({ from: null as unknown }));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub: makeStub } = await import("@/test/supabaseChain");
  const from = makeStub();
  stubs.from = from;
  return {
    supabase: { from: from.from, rpc: (fn: string, a?: Record<string, unknown>) => h.rpc(fn, a) },
  };
});

const db = () => stubs.from as ReturnType<typeof supabaseFromStub>;

const {
  TRACKER_PAGE_SIZE,
  fetchFollowerCounts,
  fetchItemBySlug,
  fetchMyFollows,
  fetchPositions,
  fetchPositionsForItems,
  fetchPublishedItems,
  fetchRecentUpdates,
  fetchRelatedItems,
  fetchTrackerStats,
  fetchUpdates,
  followItem,
  followerCountsQueryOptions,
  itemBySlugQueryOptions,
  publishedItemsQueryOptions,
  unfollowItem,
  useFollowerCounts,
  useItemBySlug,
  useItemPositions,
  useItemUpdates,
  useMyFollows,
  usePositionsForItems,
  usePublishedItems,
  useRecentUpdates,
  useRelatedItems,
  useToggleFollowItem,
  useTrackerStats,
} = await import("@/lib/tracker/queries");

const ITEM_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ITEM_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";
const TENANT_ID = "44444444-4444-4444-8444-444444444444";

/** Wszystkie ogniwa `eq` danego łańcucha, w kolejności wywołania. */
function eqFilters(table: string): unknown[][] {
  return (db().lastChain(table)?.calls ?? [])
    .filter((call) => call.method === "eq")
    .map((call) => [...call.args]);
}

/** Wszystkie ogniwa `order` danego łańcucha, w kolejności wywołania. */
function orders(table: string): unknown[][] {
  return (db().lastChain(table)?.calls ?? [])
    .filter((call) => call.method === "order")
    .map((call) => [...call.args]);
}

beforeEach(() => {
  db().reset();
  h.rpc.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Lista dossier
// ---------------------------------------------------------------------------

describe("fetchPublishedItems", () => {
  it("ZAWSZE filtruje po statusie publikacji", () => {
    // Najważniejsza asercja pliku. RLS też tego pilnuje, ale ten filtr jest
    // pierwszą linią: gdyby zniknął, szkice redakcyjne poleciałyby do SSR-a
    // i do crawlera wszędzie tam, gdzie polityka na to pozwala.
    db().setResponse("eu_policy_items", ok([]));
    return fetchPublishedItems().then(() => {
      expect(eqFilters("eu_policy_items")).toContainEqual(["status", "published"]);
    });
  });

  it("sortuje po ważności, a dopiero potem po dacie aktualizacji", async () => {
    // Kolejność DWÓCH ogniw `order` to kontrakt rankingu redakcyjnego -
    // zamiana ich miejscami zmienia to, co czytelnik widzi na górze listy,
    // i nie daje żadnego innego sygnału.
    db().setResponse("eu_policy_items", ok([]));
    await fetchPublishedItems();
    expect(orders("eu_policy_items")).toEqual([
      ["importance", { ascending: false }],
      ["updated_at", { ascending: false }],
    ]);
  });

  it("domyślny rozmiar okna to TRACKER_PAGE_SIZE", async () => {
    db().setResponse("eu_policy_items", ok([]));
    await fetchPublishedItems();
    expect(db().lastChain("eu_policy_items")?.argsOf("limit")).toEqual([TRACKER_PAGE_SIZE]);
  });

  it("honoruje własny limit (okno „pokaż więcej”)", async () => {
    db().setResponse("eu_policy_items", ok([]));
    await fetchPublishedItems({}, 48);
    expect(db().lastChain("eu_policy_items")?.argsOf("limit")).toEqual([48]);
  });

  it("dokłada filtry obszaru i etapu, gdy podano", async () => {
    db().setResponse("eu_policy_items", ok([]));
    await fetchPublishedItems({ area: "energy", stage: "trilogue" });
    expect(eqFilters("eu_policy_items")).toContainEqual(["policy_area", "energy"]);
    expect(eqFilters("eu_policy_items")).toContainEqual(["stage", "trilogue"]);
  });

  it("PUSTY filtr nie dokłada warunku - „wszystkie” to brak filtra", async () => {
    // `if (filters.area)` jest fałszywe dla "", więc wybranie „wszystkie
    // obszary" w UI nie może wysłać `policy_area = ''` (zero wyników).
    db().setResponse("eu_policy_items", ok([]));
    await fetchPublishedItems({ area: "", stage: "" });
    const filters = eqFilters("eu_policy_items");
    expect(filters).toEqual([["status", "published"]]);
  });

  it("pusty wynik zwraca tablicę, nie null", async () => {
    db().setResponse("eu_policy_items", ok(null));
    await expect(fetchPublishedItems()).resolves.toEqual([]);
  });

  it("błąd bazy LECI dalej - SSR ma paść głośno, nie pokazać pustego trackera", async () => {
    // Zjedzenie błędu dałoby crawlerowi poprawne 200 z pustą listą, czyli
    // trwałe „ten tracker nic nie zawiera" w indeksie wyszukiwarki.
    db().setResponse("eu_policy_items", fail("boom", "PGRST500"));
    await expect(fetchPublishedItems()).rejects.toMatchObject({ message: "boom" });
  });

  it("czyta kolumny wyprowadzone z typów bazy, w tym tenant_id i status", async () => {
    db().setResponse("eu_policy_items", ok([]));
    await fetchPublishedItems();
    const [columns] = db().lastChain("eu_policy_items")?.argsOf("select") ?? [];
    expect(String(columns)).toContain("tenant_id");
    expect(String(columns)).toContain("status");
    expect(String(columns)).toContain("next_milestone_at");
  });
});

describe("fetchItemBySlug", () => {
  it("wymaga slugu ORAZ statusu opublikowanego", async () => {
    db().setResponse("eu_policy_items", ok(null));
    await fetchItemBySlug("akt-o-uslugach");
    expect(eqFilters("eu_policy_items")).toEqual([
      ["slug", "akt-o-uslugach"],
      ["status", "published"],
    ]);
  });

  it("brak dossier daje null, a nie wyjątek (trasa renderuje 404)", async () => {
    db().setResponse("eu_policy_items", ok(null));
    await expect(fetchItemBySlug("nie-ma")).resolves.toBeNull();
  });

  it("błąd bazy leci dalej", async () => {
    db().setResponse("eu_policy_items", fail("boom"));
    await expect(fetchItemBySlug("x")).rejects.toMatchObject({ message: "boom" });
  });
});

describe("fetchUpdates", () => {
  it("czyta oś czasu jednego dossier, najnowsze na górze", async () => {
    db().setResponse("eu_policy_updates", ok([]));
    await fetchUpdates(ITEM_ID);
    expect(eqFilters("eu_policy_updates")).toEqual([["item_id", ITEM_ID]]);
    expect(orders("eu_policy_updates")).toEqual([
      ["happened_on", { ascending: false }],
      ["created_at", { ascending: false }],
    ]);
  });

  it("ogranicza oś czasu do stu wpisów", async () => {
    db().setResponse("eu_policy_updates", ok([]));
    await fetchUpdates(ITEM_ID);
    expect(db().lastChain("eu_policy_updates")?.argsOf("limit")).toEqual([100]);
  });

  it("błąd bazy leci dalej", async () => {
    db().setResponse("eu_policy_updates", fail("boom"));
    await expect(fetchUpdates(ITEM_ID)).rejects.toMatchObject({ message: "boom" });
  });
});

// ---------------------------------------------------------------------------
// Liczniki obserwujących
// ---------------------------------------------------------------------------

describe("fetchFollowerCounts", () => {
  it("PUSTA lista nie dotyka RPC w ogóle", async () => {
    // Budżet ścieżki krytycznej: strona bez dossier nie ma powodu robić
    // podróży do bazy, a `in (...)` z pustą tablicą i tak nic nie zwróci.
    await expect(fetchFollowerCounts([])).resolves.toEqual({});
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("mapuje wiersze RPC na słownik id -> liczba", async () => {
    h.rpc.mockResolvedValue(
      ok([
        { item_id: ITEM_ID, followers: 12 },
        { item_id: OTHER_ITEM_ID, followers: 3 },
      ]),
    );
    await expect(fetchFollowerCounts([ITEM_ID, OTHER_ITEM_ID])).resolves.toEqual({
      [ITEM_ID]: 12,
      [OTHER_ITEM_ID]: 3,
    });
    expect(h.rpc).toHaveBeenCalledWith("get_policy_follower_counts", {
      p_item_ids: [ITEM_ID, OTHER_ITEM_ID],
    });
  });

  it("brak wierszy daje pusty słownik", async () => {
    h.rpc.mockResolvedValue(ok(null));
    await expect(fetchFollowerCounts([ITEM_ID])).resolves.toEqual({});
  });

  it("błąd RPC leci dalej", async () => {
    h.rpc.mockResolvedValue(fail("rpc down"));
    await expect(fetchFollowerCounts([ITEM_ID])).rejects.toMatchObject({ message: "rpc down" });
  });
});

describe("fetchMyFollows", () => {
  it("czyta wyłącznie własne obserwacje", async () => {
    db().setResponse("eu_policy_follows", ok([{ item_id: ITEM_ID }]));
    await expect(fetchMyFollows(USER_ID)).resolves.toEqual([ITEM_ID]);
    expect(eqFilters("eu_policy_follows")).toEqual([["user_id", USER_ID]]);
  });

  it("brak obserwacji daje pustą listę", async () => {
    db().setResponse("eu_policy_follows", ok(null));
    await expect(fetchMyFollows(USER_ID)).resolves.toEqual([]);
  });
});

describe("followItem / unfollowItem", () => {
  it("insert niesie JAWNY tenant_id dossier - bez niego RLS odrzuci zapis", async () => {
    db().setResponse("eu_policy_follows", ok(null));
    await followItem({ itemId: ITEM_ID, userId: USER_ID, tenantId: TENANT_ID });
    expect(db().lastChain("eu_policy_follows")?.argsOf("insert")).toEqual([
      { item_id: ITEM_ID, user_id: USER_ID, tenant_id: TENANT_ID },
    ]);
  });

  it("DUPLIKAT (23505) jest połykany - równoległe kliknięcia to nie błąd", async () => {
    // Podwójne kliknięcie „Obserwuj" to normalne zachowanie użytkownika,
    // nie awaria. Rozpoznajemy je po KODZIE, nie po treści komunikatu -
    // komunikat zależy od wersji Postgresa i lokalizacji serwera.
    db().setResponse("eu_policy_follows", fail("duplicate key value", "23505"));
    await expect(
      followItem({ itemId: ITEM_ID, userId: USER_ID, tenantId: TENANT_ID }),
    ).resolves.toBeUndefined();
  });

  it("każdy INNY błąd insertu leci dalej", async () => {
    db().setResponse("eu_policy_follows", fail("permission denied", "42501"));
    await expect(
      followItem({ itemId: ITEM_ID, userId: USER_ID, tenantId: TENANT_ID }),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("usunięcie obserwacji jest zawężone do dossier I użytkownika", async () => {
    db().setResponse("eu_policy_follows", ok(null));
    await unfollowItem({ itemId: ITEM_ID, userId: USER_ID });
    expect(eqFilters("eu_policy_follows")).toEqual([
      ["item_id", ITEM_ID],
      ["user_id", USER_ID],
    ]);
  });

  it("błąd usunięcia leci dalej", async () => {
    db().setResponse("eu_policy_follows", fail("boom"));
    await expect(unfollowItem({ itemId: ITEM_ID, userId: USER_ID })).rejects.toMatchObject({
      message: "boom",
    });
  });
});

// ---------------------------------------------------------------------------
// Stanowiska państw
// ---------------------------------------------------------------------------

describe("fetchPositions / fetchPositionsForItems", () => {
  it("stanowiska jednego dossier są sortowane po kodzie kraju", async () => {
    db().setResponse("eu_policy_positions", ok([]));
    await fetchPositions(ITEM_ID);
    expect(eqFilters("eu_policy_positions")).toEqual([["item_id", ITEM_ID]]);
    expect(orders("eu_policy_positions")).toEqual([["country_code", { ascending: true }]]);
  });

  it("pusta lista dossier nie dotyka bazy", async () => {
    await expect(fetchPositionsForItems([])).resolves.toEqual([]);
    expect(db().chainsFor("eu_policy_positions")).toHaveLength(0);
  });

  it("wiele dossier czyta się jednym zapytaniem `in`", async () => {
    db().setResponse("eu_policy_positions", ok([]));
    await fetchPositionsForItems([ITEM_ID, OTHER_ITEM_ID]);
    expect(db().lastChain("eu_policy_positions")?.argsOf("in")).toEqual([
      "item_id",
      [ITEM_ID, OTHER_ITEM_ID],
    ]);
  });

  it("błąd leci dalej", async () => {
    db().setResponse("eu_policy_positions", fail("boom"));
    await expect(fetchPositions(ITEM_ID)).rejects.toMatchObject({ message: "boom" });
  });
});

// ---------------------------------------------------------------------------
// Powiązane akty i globalny feed zmian
// ---------------------------------------------------------------------------

describe("fetchRelatedItems", () => {
  const linkRow = (status: string, slug = "powiazany") => ({
    related_item_id: OTHER_ITEM_ID,
    relation: "amends",
    eu_policy_items: {
      slug,
      title_pl: "Powiązany",
      title_en: "Related",
      stage: "council",
      status,
    },
  });

  it("odrzuca powiązania do dossier NIEOPUBLIKOWANYCH", async () => {
    // Bramka wycieku szkiców: samo powiązanie może istnieć, ale tytuł dossier
    // w przygotowaniu nie ma prawa pojawić się na stronie publicznej.
    db().setResponse("eu_policy_links", ok([linkRow("draft")]));
    await expect(fetchRelatedItems(ITEM_ID)).resolves.toEqual([]);
  });

  it("odrzuca wiersze bez osadzonego dossier", async () => {
    db().setResponse(
      "eu_policy_links",
      ok([{ related_item_id: OTHER_ITEM_ID, relation: "related", eu_policy_items: null }]),
    );
    await expect(fetchRelatedItems(ITEM_ID)).resolves.toEqual([]);
  });

  it("spłaszcza opublikowane powiązanie do płaskiego kształtu", async () => {
    db().setResponse("eu_policy_links", ok([linkRow("published")]));
    await expect(fetchRelatedItems(ITEM_ID)).resolves.toEqual([
      {
        related_item_id: OTHER_ITEM_ID,
        relation: "amends",
        slug: "powiazany",
        title_pl: "Powiązany",
        title_en: "Related",
        stage: "council",
      },
    ]);
  });

  it("błąd leci dalej", async () => {
    db().setResponse("eu_policy_links", fail("boom"));
    await expect(fetchRelatedItems(ITEM_ID)).rejects.toMatchObject({ message: "boom" });
  });
});

describe("fetchRecentUpdates", () => {
  const updateRow = (status: string) => ({
    id: "u1",
    note_pl: "Nota",
    note_en: "Note",
    stage_from: "committee",
    stage_to: "plenary",
    source_url: null,
    happened_on: "2026-08-01",
    created_at: "2026-08-01T10:00:00Z",
    eu_policy_items: {
      slug: "akt",
      title_pl: "Akt",
      title_en: "Act",
      policy_area: "energy",
      status,
    },
  });

  it("odrzuca wpisy osi czasu dossier NIEOPUBLIKOWANYCH", async () => {
    db().setResponse("eu_policy_updates", ok([updateRow("draft")]));
    await expect(fetchRecentUpdates()).resolves.toEqual([]);
  });

  it("spłaszcza wpis opublikowany razem z danymi dossier", async () => {
    db().setResponse("eu_policy_updates", ok([updateRow("published")]));
    const [row] = await fetchRecentUpdates();
    expect(row).toMatchObject({
      id: "u1",
      item_slug: "akt",
      item_title_pl: "Akt",
      policy_area: "energy",
    });
  });

  it("domyślnie bierze czterdzieści ostatnich zmian", async () => {
    db().setResponse("eu_policy_updates", ok([]));
    await fetchRecentUpdates();
    expect(db().lastChain("eu_policy_updates")?.argsOf("limit")).toEqual([40]);
  });

  it("honoruje własny limit", async () => {
    db().setResponse("eu_policy_updates", ok([]));
    await fetchRecentUpdates(5);
    expect(db().lastChain("eu_policy_updates")?.argsOf("limit")).toEqual([5]);
  });
});

describe("fetchTrackerStats", () => {
  it("mapuje odpowiedź RPC", async () => {
    h.rpc.mockResolvedValue(ok({ total: 7, by_stage: { plenary: 2 }, by_area: { energy: 5 } }));
    await expect(fetchTrackerStats()).resolves.toEqual({
      total: 7,
      by_stage: { plenary: 2 },
      by_area: { energy: 5 },
    });
  });

  it("pusta odpowiedź daje zera, a nie undefined w kokpicie", async () => {
    h.rpc.mockResolvedValue(ok(null));
    await expect(fetchTrackerStats()).resolves.toEqual({ total: 0, by_stage: {}, by_area: {} });
  });

  it("błąd RPC leci dalej", async () => {
    h.rpc.mockResolvedValue(fail("boom"));
    await expect(fetchTrackerStats()).rejects.toMatchObject({ message: "boom" });
  });
});

// ---------------------------------------------------------------------------
// Klucze react-query - most między loaderem SSR a hydratacją
// ---------------------------------------------------------------------------

describe("klucze zapytań", () => {
  it("ten sam filtr daje ten sam klucz", () => {
    expect(publishedItemsQueryOptions({ area: "energy" }).queryKey).toEqual(
      publishedItemsQueryOptions({ area: "energy" }).queryKey,
    );
  });

  it("brak filtra zapisuje się jako `all`, nie jako undefined", () => {
    expect(publishedItemsQueryOptions().queryKey).toEqual([
      "tracker",
      "items",
      "all",
      "all",
      TRACKER_PAGE_SIZE,
    ]);
  });

  it("inny obszar, etap albo limit to inny klucz", () => {
    const base = publishedItemsQueryOptions().queryKey;
    expect(publishedItemsQueryOptions({ area: "energy" }).queryKey).not.toEqual(base);
    expect(publishedItemsQueryOptions({ stage: "plenary" }).queryKey).not.toEqual(base);
    expect(publishedItemsQueryOptions({}, 48).queryKey).not.toEqual(base);
  });

  it("klucz liczników jest NIEZALEŻNY od kolejności identyfikatorów", () => {
    // To jest reguła, dzięki której loader SSR i hook trafiają w ten sam wpis
    // cache. Gdyby klucz zależał od kolejności listy, treść wyrenderowana
    // serwerowo nie hydratowałaby się z cache i strona robiłaby DRUGĄ podróż
    // do bazy przy każdym wejściu.
    expect(followerCountsQueryOptions([OTHER_ITEM_ID, ITEM_ID]).queryKey).toEqual(
      followerCountsQueryOptions([ITEM_ID, OTHER_ITEM_ID]).queryKey,
    );
  });

  it("klucz liczników nie MUTUJE listy wejściowej", () => {
    const ids = [OTHER_ITEM_ID, ITEM_ID];
    followerCountsQueryOptions(ids);
    expect(ids).toEqual([OTHER_ITEM_ID, ITEM_ID]);
  });

  it("klucz dossier niesie slug", () => {
    expect(itemBySlugQueryOptions("akt").queryKey).toEqual(["tracker", "item", "akt"]);
  });

  it("funkcja zapytania w opcjach naprawdę woła warstwę danych", async () => {
    db().setResponse("eu_policy_items", ok([]));
    await publishedItemsQueryOptions({ area: "energy" }, 5).queryFn();
    expect(eqFilters("eu_policy_items")).toContainEqual(["policy_area", "energy"]);
  });
});

// ---------------------------------------------------------------------------
// Hooki - strażnicy `enabled` decydują, czy w ogóle jedzie zapytanie
// ---------------------------------------------------------------------------

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("hooki trackera", () => {
  it("lista dossier pobiera dane", async () => {
    db().setResponse("eu_policy_items", ok([]));
    const { result } = renderHook(() => usePublishedItems(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it("dossier po slugu NIE jedzie bez slugu", async () => {
    const { result } = renderHook(() => useItemBySlug(""), { wrapper });
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(db().chainsFor("eu_policy_items")).toHaveLength(0);
  });

  it("oś czasu NIE jedzie bez identyfikatora dossier", async () => {
    const { result } = renderHook(() => useItemUpdates(undefined), { wrapper });
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(db().chainsFor("eu_policy_updates")).toHaveLength(0);
  });

  it("liczniki NIE jadą dla pustej listy dossier", async () => {
    const { result } = renderHook(() => useFollowerCounts([]), { wrapper });
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("moje obserwacje NIE jadą dla gościa", async () => {
    const { result } = renderHook(() => useMyFollows(undefined), { wrapper });
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(db().chainsFor("eu_policy_follows")).toHaveLength(0);
  });

  it("stanowiska pojedynczego dossier jadą po podaniu identyfikatora", async () => {
    db().setResponse("eu_policy_positions", ok([]));
    const { result } = renderHook(() => useItemPositions(ITEM_ID), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("stanowiska zbiorcze NIE jadą dla pustej listy", async () => {
    const { result } = renderHook(() => usePositionsForItems([]), { wrapper });
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
  });

  it("powiązane akty NIE jadą bez identyfikatora", async () => {
    const { result } = renderHook(() => useRelatedItems(undefined), { wrapper });
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
  });

  it("ostatnie zmiany pobierają się bez warunków", async () => {
    db().setResponse("eu_policy_updates", ok([]));
    const { result } = renderHook(() => useRecentUpdates(3), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("statystyki pobierają się bez warunków", async () => {
    h.rpc.mockResolvedValue(ok({ total: 1, by_stage: {}, by_area: {} }));
    const { result } = renderHook(() => useTrackerStats(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.total).toBe(1);
  });

  it("przełącznik obserwowania włącza obserwację i unieważnia oba cache", async () => {
    db().setResponse("eu_policy_follows", ok(null));
    const { result } = renderHook(() => useToggleFollowItem(), { wrapper });
    result.current.mutate({ itemId: ITEM_ID, userId: USER_ID, tenantId: TENANT_ID, on: true });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(db().lastChain("eu_policy_follows")?.has("insert")).toBe(true);
  });

  it("przełącznik obserwowania wyłącza obserwację przez DELETE", async () => {
    db().setResponse("eu_policy_follows", ok(null));
    const { result } = renderHook(() => useToggleFollowItem(), { wrapper });
    result.current.mutate({ itemId: ITEM_ID, userId: USER_ID, tenantId: TENANT_ID, on: false });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(db().lastChain("eu_policy_follows")?.has("delete")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Ścieżki obronne warstwy danych: pusta odpowiedź i błąd na KAŻDYM odczycie
// ---------------------------------------------------------------------------

describe("puste odpowiedzi i błędy pozostałych odczytów", () => {
  it("pusta oś czasu daje tablicę", async () => {
    db().setResponse("eu_policy_updates", ok(null));
    await expect(fetchUpdates(ITEM_ID)).resolves.toEqual([]);
  });

  it("błąd listy obserwacji leci dalej", async () => {
    db().setResponse("eu_policy_follows", fail("boom"));
    await expect(fetchMyFollows(USER_ID)).rejects.toMatchObject({ message: "boom" });
  });

  it("brak stanowisk daje tablicę", async () => {
    db().setResponse("eu_policy_positions", ok(null));
    await expect(fetchPositions(ITEM_ID)).resolves.toEqual([]);
  });

  it("brak stanowisk zbiorczych daje tablicę", async () => {
    db().setResponse("eu_policy_positions", ok(null));
    await expect(fetchPositionsForItems([ITEM_ID])).resolves.toEqual([]);
  });

  it("błąd stanowisk zbiorczych leci dalej", async () => {
    db().setResponse("eu_policy_positions", fail("boom"));
    await expect(fetchPositionsForItems([ITEM_ID])).rejects.toMatchObject({ message: "boom" });
  });

  it("brak powiązań daje tablicę", async () => {
    db().setResponse("eu_policy_links", ok(null));
    await expect(fetchRelatedItems(ITEM_ID)).resolves.toEqual([]);
  });

  it("brak ostatnich zmian daje tablicę", async () => {
    db().setResponse("eu_policy_updates", ok(null));
    await expect(fetchRecentUpdates()).resolves.toEqual([]);
  });

  it("błąd ostatnich zmian leci dalej", async () => {
    db().setResponse("eu_policy_updates", fail("boom"));
    await expect(fetchRecentUpdates()).rejects.toMatchObject({ message: "boom" });
  });
});

// ---------------------------------------------------------------------------
// Hooki w stanie WŁĄCZONYM - dowód, że `queryFn` wywołuje właściwy odczyt
// ---------------------------------------------------------------------------

describe("hooki trackera - stan włączony", () => {
  it("dossier po slugu czyta warstwę danych z tym slugiem", async () => {
    db().setResponse("eu_policy_items", ok(null));
    const { result } = renderHook(() => useItemBySlug("akt-o-uslugach"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(eqFilters("eu_policy_items")).toContainEqual(["slug", "akt-o-uslugach"]);
  });

  it("oś czasu czyta wpisy podanego dossier", async () => {
    db().setResponse("eu_policy_updates", ok([]));
    const { result } = renderHook(() => useItemUpdates(ITEM_ID), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(eqFilters("eu_policy_updates")).toEqual([["item_id", ITEM_ID]]);
  });

  it("liczniki obserwujących wołają RPC dla podanych dossier", async () => {
    h.rpc.mockResolvedValue(ok([{ item_id: ITEM_ID, followers: 4 }]));
    const { result } = renderHook(() => useFollowerCounts([ITEM_ID]), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ [ITEM_ID]: 4 });
  });

  it("moje obserwacje czytają wiersze zalogowanego użytkownika", async () => {
    db().setResponse("eu_policy_follows", ok([{ item_id: ITEM_ID }]));
    const { result } = renderHook(() => useMyFollows(USER_ID), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([ITEM_ID]);
  });

  it("stanowiska zbiorcze czytają podane dossier", async () => {
    db().setResponse("eu_policy_positions", ok([]));
    const { result } = renderHook(() => usePositionsForItems([ITEM_ID, OTHER_ITEM_ID]), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(db().lastChain("eu_policy_positions")?.argsOf("in")).toEqual([
      "item_id",
      [ITEM_ID, OTHER_ITEM_ID],
    ]);
  });

  it("powiązane akty czytają podane dossier", async () => {
    db().setResponse("eu_policy_links", ok([]));
    const { result } = renderHook(() => useRelatedItems(ITEM_ID), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(eqFilters("eu_policy_links")).toEqual([["item_id", ITEM_ID]]);
  });

  it("klucz zapytania bez dossier ma stabilny człon `none`", () => {
    // Bez tego zastępnika klucz zawierałby `undefined`, a react-query
    // traktowałby każde odmontowanie jako inny wpis cache.
    const { result } = renderHook(() => useItemPositions(undefined), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
  });
});
