// CO DOWODZI TEN PLIK
//
// Warstwa danych grafu powiązań między modułami (`cross_references` /
// `get_linked_items`) - dwa pliki, 18 LOC razem, oba dziś na ZERZE. Panele
// „Powiązane" w CRM, w komentarzach i w newsletterze czytają wyłącznie przez
// nie, więc każda z trzech rzeczy poniżej jest jedynym miejscem, w którym
// mieszka:
//
//   1. FLAGA `enabled` - zapytanie NIE MOŻE lecieć bez zalogowanego
//      użytkownika ani bez identyfikatora encji. `get_linked_items` jest RPC,
//      więc wywołanie bez sensu i tak zapali licznik funkcji w logach i wróci
//      błędem, którego nikt nie zobaczy (panel pokaże pustkę).
//   2. MAPOWANIE WIERSZA - `snake_case` z bazy na `camelCase` w UI oraz
//      zawężenie `direction` do dwóch wartości. Wiersz o nieznanym kierunku
//      NIE MOŻE przeciec do UI jako trzeci stan.
//   3. `linkedItemHref` - adres panelu dla powiązanej encji. `null` znaczy
//      „brak nawigacji" i to jest kontrakt: wiersz bez adresu ma się renderować
//      jako tekst, nie jako martwy odnośnik.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE
//
// * AUTORYTETU RPC `get_linked_items` - to należy do pgTAP, nie do vitest.
//   Ten plik nie odtwarza reguł widoczności na atrapie; dowodzi wyłącznie, że
//   warstwa danych o nie PYTA i poprawnie czyta odpowiedź.
// * MECHANIKI HUBA REALTIME (`tableChannelHub`) - współdzielenie kanału,
//   losowy sufiks nazwy, odliczanie subskrybentów. Tutaj dowodzimy tylko, że
//   hook subskrybuje właściwą tabelę i unieważnia właściwy klucz cache.
// * `e2e/seo.spec.ts` nie dotyka tej powierzchni w żadnym ze swoich 15 testów -
//   graf powiązań nie ma reprezentacji na stronie publicznej, więc styku nie
//   ma i nie ma tu czego dublować.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import { renderHookWithQueryClient } from "@/test/renderWithQueryClient";
import { pgError } from "@/test/supabaseChain";

const h = vi.hoisted(() => ({
  /** Zalogowany użytkownik (null = gość). */
  user: { id: "u-1" } as { id: string } | null,
  /** Wiersze oddawane przez RPC. */
  rows: [] as Array<Record<string, unknown>>,
  /** Błąd RPC (null = sukces). */
  rpcError: null as Error | null,
  /** Czy RPC ma oddać `data: null` zamiast tablicy (osobny przypadek od `[]`). */
  nullData: false,
  /** Argumenty KAŻDEGO wywołania RPC - `enabled` jest tu dowodem. */
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  /** Subskrypcje realtime zlecone przez hook. */
  subscriptions: [] as Array<{ table: string }>,
  /** Liczba wywołań funkcji odsubskrybowania. */
  unsubscribes: 0,
  /** Handler przekazany hubowi - test wywołuje go, żeby udać zdarzenie z bazy. */
  handler: null as (() => void) | null,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args: Record<string, unknown>) => {
      h.rpcCalls.push({ name, args });
      if (h.rpcError) return Promise.resolve({ data: null, error: h.rpcError });
      return Promise.resolve({ data: h.nullData ? null : h.rows, error: null });
    },
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: h.user }),
}));

vi.mock("@/lib/realtime/tableChannelHub", () => ({
  subscribeToTable: (spec: { table: string }, handler: () => void) => {
    h.subscriptions.push({ table: spec.table });
    h.handler = handler;
    return () => {
      h.unsubscribes += 1;
    };
  },
}));

const { linkedItemHref, useLinkedItems, useLinkedItemsRealtime } =
  await import("@/lib/links/useLinkedItems");
const { linkedItemsKeys } = await import("@/lib/links/keys");

/** Wiersz w kształcie, w jakim oddaje go RPC (snake_case, bez zawężeń). */
function dbRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    reference_id: "ref-1",
    direction: "outgoing",
    item_type: "crm_lead",
    item_id: "lead-1",
    relation: "mentions",
    label: "Lead: Kowalski",
    created_at: "2026-02-03T10:15:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  h.user = { id: "u-1" };
  h.rows = [];
  h.rpcError = null;
  h.nullData = false;
  h.rpcCalls = [];
  h.subscriptions = [];
  h.unsubscribes = 0;
  h.handler = null;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("linkedItemsKeys - klucze cache", () => {
  it("klucz zbiorczy jest PREFIKSEM klucza pozycji - inaczej unieważnienie grafu nic nie robi", () => {
    // `useLinkedItemsRealtime` unieważnia po `all`; gdyby `item` nie zaczynał
    // się tym samym segmentem, zdarzenie z bazy nie odświeżyłoby żadnego panelu.
    const item = linkedItemsKeys.item("post", "p-1");
    expect(item.slice(0, linkedItemsKeys.all.length)).toEqual([...linkedItemsKeys.all]);
  });

  it("klucz pozycji rozróżnia typ i identyfikator", () => {
    expect(linkedItemsKeys.item("post", "p-1")).toEqual(["linked-items", "post", "p-1"]);
    expect(linkedItemsKeys.item("post", "p-2")).not.toEqual(linkedItemsKeys.item("post", "p-1"));
    expect(linkedItemsKeys.item("page", "p-1")).not.toEqual(linkedItemsKeys.item("post", "p-1"));
  });
});

describe("linkedItemHref - adres panelu powiązanej encji", () => {
  it.each([
    ["crm_lead", "lead-9", "/admin/crm?lead=lead-9"],
    ["newsletter_subscriber", "sub-3", "/admin/newsletter/subscribers"],
  ])("%s -> %s", (itemType, itemId, expected) => {
    expect(
      linkedItemHref({
        referenceId: "r",
        direction: "outgoing",
        itemType,
        itemId,
        relation: "mentions",
        label: null,
        createdAt: "2026-02-03T10:15:00.000Z",
      }),
    ).toBe(expected);
  });

  it.each(["post", "page", "comment", "crm_note", "profile", "message", "nieznany_typ"])(
    "%s -> null (brak nawigacji, wiersz renderuje się jako tekst)",
    (itemType) => {
      expect(
        linkedItemHref({
          referenceId: "r",
          direction: "incoming",
          itemType,
          itemId: "x-1",
          relation: "mentions",
          label: null,
          createdAt: "2026-02-03T10:15:00.000Z",
        }),
      ).toBeNull();
    },
  );

  it("identyfikator leada trafia do adresu bez modyfikacji", () => {
    // Gdyby kod kiedyś zaczął go kodować albo obcinać, panel CRM otwierałby
    // pusty widok - a to jest jedyny odnośnik prowadzący z grafu do leada.
    const href = linkedItemHref({
      referenceId: "r",
      direction: "outgoing",
      itemType: "crm_lead",
      itemId: "7f3c9d1e-0000-4000-8000-000000000001",
      relation: "mentions",
      label: null,
      createdAt: "2026-02-03T10:15:00.000Z",
    });
    expect(href).toBe("/admin/crm?lead=7f3c9d1e-0000-4000-8000-000000000001");
  });
});

describe("useLinkedItems - flaga enabled", () => {
  it("GOŚĆ (brak użytkownika) NIE odpytuje RPC", async () => {
    h.user = null;
    const { queryClient } = renderHookWithQueryClient(() => useLinkedItems("post", "p-1"));
    // Cache jest dowodem: zapytanie zgaszone nie zostawia w nim wpisu z danymi.
    await waitFor(() => {
      expect(h.rpcCalls, "RPC nie może polecieć dla gościa").toHaveLength(0);
    });
    expect(queryClient.getQueryData(linkedItemsKeys.item("post", "p-1"))).toBeUndefined();
  });

  it.each([null, undefined, ""])("BRAK identyfikatora (%s) NIE odpytuje RPC", async (itemId) => {
    renderHookWithQueryClient(() => useLinkedItems("post", itemId));
    await waitFor(() => {
      expect(h.rpcCalls).toHaveLength(0);
    });
  });

  it("zalogowany użytkownik z identyfikatorem odpytuje RPC z parametrami encji", async () => {
    h.rows = [dbRow()];
    const { result } = renderHookWithQueryClient(() => useLinkedItems("crm_lead", "lead-1"));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(h.rpcCalls).toHaveLength(1);
    expect(h.rpcCalls[0]).toEqual({
      name: "get_linked_items",
      args: { p_item_type: "crm_lead", p_item_id: "lead-1" },
    });
  });

  it("klucz cache zawiera 'none' zamiast pustego identyfikatora - dwie encje bez id nie zlewają się z realną", async () => {
    const { queryClient } = renderHookWithQueryClient(() => useLinkedItems("post", null));
    await waitFor(() => expect(h.rpcCalls).toHaveLength(0));
    // Gdyby kod użył `itemId` wprost, kluczem byłby `[..., "post", null]`, co
    // React Query serializuje inaczej niż `"none"` - a to jest właśnie ten
    // wpis, który miałby kolidować z prawdziwym odczytem.
    expect(
      queryClient.getQueryCache().find({ queryKey: linkedItemsKeys.item("post", "none") }),
    ).toBeDefined();
  });
});

describe("useLinkedItems - obrona wewnątrz zapytania", () => {
  it("wymuszony `refetch()` bez identyfikatora wysyła pusty napis, nie `null`", async () => {
    // Ta gałąź (`itemId ?? ""`) wygląda na nieosiągalną, bo `enabled` gasi
    // zapytanie przy braku identyfikatora - ale `refetch()` uruchamia `queryFn`
    // NAWET dla zapytania zgaszonego. Gdyby obrony nie było, do RPC poszłoby
    // `p_item_id: null`, a `get_linked_items` odrzuciłoby wywołanie błędem
    // typu, nie pustym wynikiem. Test dowodzi, że obrona ma realne wejście.
    const { result } = renderHookWithQueryClient(() => useLinkedItems("post", null));
    await waitFor(() => expect(h.rpcCalls).toHaveLength(0));
    await result.current.refetch();
    expect(h.rpcCalls).toHaveLength(1);
    expect(h.rpcCalls[0]?.args).toEqual({ p_item_type: "post", p_item_id: "" });
  });
});

describe("useLinkedItems - mapowanie wiersza", () => {
  it("przepisuje snake_case na camelCase w całości", async () => {
    h.rows = [dbRow()];
    const { result } = renderHookWithQueryClient(() => useLinkedItems("post", "p-1"));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([
      {
        referenceId: "ref-1",
        direction: "outgoing",
        itemType: "crm_lead",
        itemId: "lead-1",
        relation: "mentions",
        label: "Lead: Kowalski",
        createdAt: "2026-02-03T10:15:00.000Z",
      },
    ]);
  });

  it.each([
    ["incoming", "incoming"],
    ["outgoing", "outgoing"],
    ["OUTGOING", "outgoing"],
    ["cokolwiek", "outgoing"],
    ["", "outgoing"],
  ])("kierunek %j z bazy zawęża się do %s", async (raw, expected) => {
    // Zawężenie jest tu jedyną obroną: UI rysuje strzałkę wg tego pola, więc
    // trzecia wartość dałaby wiersz bez kierunku.
    h.rows = [dbRow({ direction: raw })];
    const { result } = renderHookWithQueryClient(() => useLinkedItems("post", "p-1"));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]?.direction).toBe(expected);
  });

  it("etykieta `null` (POWIĄZANIE DO USUNIĘTEGO WPISU) przechodzi jako null, nie jako pusty napis", async () => {
    // Baza rozwiązuje etykiety w RPC; `null` znaczy „encji już nie ma".
    // Pusty napis wyglądałby w UI jak istniejący wpis bez nazwy.
    h.rows = [dbRow({ label: null })];
    const { result } = renderHookWithQueryClient(() => useLinkedItems("post", "p-1"));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]?.label).toBeNull();
  });

  it("pusta tablica z RPC daje pustą listę", async () => {
    h.rows = [];
    const { result } = renderHookWithQueryClient(() => useLinkedItems("post", "p-1"));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it("`data: null` z RPC daje pustą listę, nie wywalenie na `.map`", async () => {
    // To NIE to samo co pusta tablica: PostgREST oddaje `null` przy funkcji,
    // która nic nie zwróciła, a `null.map` wywaliłoby cały panel „Powiązane".
    // Gałąź `?? []` jest jedyną obroną i bez tego przypadku stała niepokryta.
    h.nullData = true;
    const { result } = renderHookWithQueryClient(() => useLinkedItems("post", "p-1"));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it("wiele wierszy zachowuje kolejność z bazy", async () => {
    h.rows = [
      dbRow({ reference_id: "a", direction: "incoming" }),
      dbRow({ reference_id: "b", direction: "outgoing" }),
    ];
    const { result } = renderHookWithQueryClient(() => useLinkedItems("post", "p-1"));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map((r) => r.referenceId)).toEqual(["a", "b"]);
  });

  it("BŁĄD RPC trafia do stanu błędu - panel ma czym odróżnić awarię od pustki", async () => {
    h.rpcError = pgError("permission denied for function get_linked_items", "42501");
    const { result } = renderHookWithQueryClient(() => useLinkedItems("post", "p-1"));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
    expect((result.current.error as Error).message).toContain("permission denied");
    expect(result.current.data).toBeUndefined();
  });
});

describe("useLinkedItemsRealtime - unieważnienie cache", () => {
  it("subskrybuje `cross_references` dla zalogowanego użytkownika", () => {
    renderHookWithQueryClient(() => useLinkedItemsRealtime());
    expect(h.subscriptions).toEqual([{ table: "cross_references" }]);
  });

  it("GOŚĆ nie subskrybuje niczego", () => {
    h.user = null;
    renderHookWithQueryClient(() => useLinkedItemsRealtime());
    expect(h.subscriptions).toHaveLength(0);
  });

  it("zdarzenie z bazy unieważnia CAŁY graf, nie jedną pozycję", async () => {
    const { queryClient } = renderHookWithQueryClient(() => useLinkedItemsRealtime());
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    expect(h.handler, "hub musi dostać handler").not.toBeNull();
    h.handler?.();
    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: linkedItemsKeys.all });
    });
  });

  it("odmontowanie ODSUBSKRYBUJE - inaczej każdy powrót do panelu dokłada kanał", () => {
    const { unmount } = renderHookWithQueryClient(() => useLinkedItemsRealtime());
    expect(h.unsubscribes).toBe(0);
    unmount();
    expect(h.unsubscribes).toBe(1);
  });
});
