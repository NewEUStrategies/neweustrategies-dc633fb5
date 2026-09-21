// Profile aktorów powiadomień - warstwa łącząca `href` wiersza z kontaktem.
//
// PO CO TEN PLIK. `useActorProfiles.ts` miał ZERO pokrycia (0/19 linii,
// 0/11 funkcji), a odpowiada za trzy rzeczy, których żadna z nich nie widać
// w typach: STABILNOŚĆ KLUCZA CACHE (dwie różne kolejności wejścia muszą dać
// ten sam klucz, inaczej dzwonek i skrzynka odpytują bazę osobno), FILTR
// WYNIKU do zbioru realnie potrzebnych id (bez niego mapa puchnie o wszystkie
// kontakty użytkownika) i RÓWNOLEGŁOŚĆ trzech RPC (sekwencyjne `await`
// potroiłoby opóźnienie awatarów w dzwonku).
import { describe, expect, it, vi, beforeEach } from "vitest";
import { waitFor } from "@testing-library/react";
import { renderHookWithQueryClient } from "@/test/renderWithQueryClient";
import { fail, ok, type SupabaseRpcStub } from "@/test/supabase";
import type { Database } from "@/integrations/supabase/types";

type NotificationRowShape = Database["public"]["Tables"]["notifications"]["Row"];

const TENANT_ID = "99999999-8888-4777-8666-555555555555";
const UID = "11111111-2222-4333-8444-555555555555";
const ACTOR_A = "aaaaaaaa-1111-4111-8111-111111111111";
const ACTOR_B = "bbbbbbbb-2222-4222-8222-222222222222";
const ACTOR_C = "cccccccc-3333-4333-8333-333333333333";

const stubs = vi.hoisted(() => ({ rpc: null as SupabaseRpcStub | null }));

// Licznik RÓWNOLEGŁOŚCI. Zapisuje, ile wywołań RPC było jednocześnie „w locie".
// To jedyny sposób odróżnienia `Promise.all([a(), b(), c()])` od trzech
// kolejnych `await` - rejestr wywołań atrapy wygląda w obu przypadkach
// IDENTYCZNIE (te same nazwy, ta sama kolejność), więc sama atrapa tego nie
// dowiedzie.
const probe = vi.hoisted(() => ({ inFlight: 0, maxInFlight: 0 }));

vi.mock("@/integrations/supabase/client", async () => {
  const fixtures = await import("@/test/supabase");
  const rpcStub = fixtures.supabaseRpcStub();
  stubs.rpc = rpcStub;
  return {
    supabase: {
      // Opakowanie, nie zamiennik: całe zapisywanie nazw i argumentów nadal
      // robi wspólna atrapa `supabaseRpcStub`.
      rpc: async (name: string, args?: Record<string, unknown>) => {
        probe.inFlight += 1;
        probe.maxInFlight = Math.max(probe.maxInFlight, probe.inFlight);
        try {
          return await rpcStub.rpc(name, args);
        } finally {
          probe.inFlight -= 1;
        }
      },
    },
  };
});

import { useNotificationActorProfiles } from "../useActorProfiles";

function rpc(): SupabaseRpcStub {
  if (!stubs.rpc) throw new Error("test: atrapa `rpc` nie została utworzona");
  return stubs.rpc;
}

function notificationRow(over: Partial<NotificationRowShape> = {}): NotificationRowShape {
  return {
    body_en: null,
    body_pl: null,
    created_at: "2026-03-14T12:00:00.000Z",
    href: null,
    icon: null,
    id: "n-1",
    kind: "message",
    read_at: null,
    tenant_id: TENANT_ID,
    title_en: null,
    title_pl: "Nowa wiadomość",
    user_id: UID,
    ...over,
  };
}

/** Wiersz prowadzący do rozmowy z danym aktorem. */
function rowFor(actorId: string, id: string): NotificationRowShape {
  return notificationRow({ id, href: `/messages?c=${actorId}` });
}

interface ActorProfileFixture {
  connection_id: string;
  avatar_url: string | null;
  display_name: string;
}

/** Wiersz zwracany przez `my_connections` / `my_connection_requests`. */
function profile(
  over: Partial<ActorProfileFixture> & { connection_id: string },
): ActorProfileFixture {
  return { avatar_url: null, display_name: "Anna Kowalska", ...over };
}

/** Domyślne zwrotki: kontakty niosą dane, oba kierunki próśb są puste. */
function planConnections(rows: ActorProfileFixture[]): void {
  rpc().setResponse("my_connections", ok(rows));
  rpc().setResponse("my_connection_requests", ok([]));
}

beforeEach(() => {
  rpc().reset();
  probe.inFlight = 0;
  probe.maxInFlight = 0;
});

describe("useNotificationActorProfiles - klucz cache", () => {
  it("deduplikuje i SORTUJE identyfikatory aktorów", async () => {
    // Klucz cache to sama tablica id, więc bez sortowania każda kolejność
    // wierszy w skrzynce dawałaby INNY wpis cache - a kolejność zmienia się
    // przy każdym nowym powiadomieniu.
    planConnections([]);
    const items = [
      rowFor(ACTOR_C, "n-1"),
      rowFor(ACTOR_A, "n-2"),
      rowFor(ACTOR_C, "n-3"),
      rowFor(ACTOR_B, "n-4"),
      notificationRow({ id: "n-5", href: "/settings" }),
      notificationRow({ id: "n-6", href: null }),
    ];
    const { queryClient } = renderHookWithQueryClient(() =>
      useNotificationActorProfiles(items, true),
    );

    await waitFor(() => expect(rpc().calls.length).toBe(3));
    expect(queryClient.getQueryCache().getAll()[0]?.queryKey).toEqual([
      "notifications",
      "actor-profiles",
      [ACTOR_A, ACTOR_B, ACTOR_C],
    ]);
  });

  it("DWIE różne kolejności wejścia dają TEN SAM klucz - jeden wpis cache", async () => {
    // Dzwonek i skrzynka dostają te same powiadomienia w różnej kolejności.
    // Bez stabilnego klucza obie powierzchnie odpytałyby bazę osobno, mimo
    // że pytają o dokładnie ten sam zbiór profili.
    planConnections([]);
    const bellItems = [rowFor(ACTOR_B, "n-1"), rowFor(ACTOR_A, "n-2")];
    const centerItems = [rowFor(ACTOR_A, "n-3"), rowFor(ACTOR_B, "n-4")];
    const { queryClient } = renderHookWithQueryClient(() => ({
      bell: useNotificationActorProfiles(bellItems, true),
      center: useNotificationActorProfiles(centerItems, true),
    }));

    await waitFor(() => expect(rpc().calls.length).toBe(3));
    expect(queryClient.getQueryCache().getAll()).toHaveLength(1);
    // Trzy wywołania, nie sześć - dowód, że oba hooki trafiły w jeden slot.
    expect(rpc().calls).toHaveLength(3);
  });
});

describe("useNotificationActorProfiles - bramka `enabled`", () => {
  it("`enabled: false` wstrzymuje WSZYSTKIE trzy RPC", async () => {
    planConnections([]);
    renderHookWithQueryClient(() => useNotificationActorProfiles([rowFor(ACTOR_A, "n-1")], false));
    await Promise.resolve();

    expect(rpc().calls).toHaveLength(0);
  });

  it("PUSTA lista aktorów nie generuje żadnego zapytania", async () => {
    // Skrzynka bez powiadomień z rozmów (albo z samymi powiadomieniami
    // systemowymi) nie ma o co pytać - trzy RPC byłyby tu czystym kosztem.
    planConnections([]);
    renderHookWithQueryClient(() =>
      useNotificationActorProfiles([notificationRow({ href: "/settings" })], true),
    );
    await Promise.resolve();

    expect(rpc().calls).toHaveLength(0);
  });

  it("zwraca PUSTĄ mapę, dopóki dane nie dojadą", () => {
    planConnections([profile({ connection_id: ACTOR_A })]);
    const { result } = renderHookWithQueryClient(() =>
      useNotificationActorProfiles([rowFor(ACTOR_A, "n-1")], true),
    );

    // Komponent renderuje się PRZED odpowiedzią bazy - `q.data` jest wtedy
    // `undefined`, a mapa musi być pusta, a nie `undefined`.
    expect(result.current.size).toBe(0);
  });
});

describe("useNotificationActorProfiles - trzy RPC", () => {
  it("woła kontakty ORAZ oba kierunki próśb, z pełnymi argumentami", async () => {
    // Aktor powiadomienia nie musi być jeszcze kontaktem: prośba wysłana
    // i otrzymana też ma awatar oraz nazwę, a bez nich wiersz w dzwonku
    // pokazuje inicjał z pustki.
    planConnections([]);
    renderHookWithQueryClient(() => useNotificationActorProfiles([rowFor(ACTOR_A, "n-1")], true));

    await waitFor(() => expect(rpc().calls.length).toBe(3));
    expect(rpc().names()).toEqual([
      "my_connections",
      "my_connection_requests",
      "my_connection_requests",
    ]);
    expect(rpc().callsFor("my_connections")[0]?.args).toEqual({
      p_limit: 100,
      p_offset: 0,
      p_query: "",
    });
    expect(rpc().callsFor("my_connection_requests")[0]?.args).toEqual({
      p_direction: "in",
      p_limit: 100,
      p_offset: 0,
    });
    expect(rpc().callsFor("my_connection_requests")[1]?.args).toEqual({
      p_direction: "out",
      p_limit: 100,
      p_offset: 0,
    });
  });

  it("wysyła wszystkie trzy RÓWNOLEGLE, a nie jedno po drugim", async () => {
    // Trzy sekwencyjne `await` to trzykrotne opóźnienie awatarów w dzwonku.
    // `maxInFlight === 3` może zajść WYŁĄCZNIE przy `Promise.all`.
    planConnections([]);
    renderHookWithQueryClient(() => useNotificationActorProfiles([rowFor(ACTOR_A, "n-1")], true));

    await waitFor(() => expect(rpc().calls.length).toBe(3));
    expect(probe.maxInFlight).toBe(3);
  });
});

describe("useNotificationActorProfiles - kształt wyniku", () => {
  it("kluczuje mapę po `connection_id`", async () => {
    planConnections([
      profile({ connection_id: ACTOR_A, display_name: "Anna Kowalska" }),
      profile({ connection_id: ACTOR_B, display_name: "Bartosz Nowak" }),
    ]);
    const items = [rowFor(ACTOR_A, "n-1"), rowFor(ACTOR_B, "n-2")];
    const { result } = renderHookWithQueryClient(() => useNotificationActorProfiles(items, true));

    await waitFor(() => expect(result.current.size).toBe(2));
    expect(result.current.get(ACTOR_A)?.display_name).toBe("Anna Kowalska");
    expect(result.current.get(ACTOR_B)?.display_name).toBe("Bartosz Nowak");
  });

  it("ODRZUCA profile spoza zbioru aktorów z widocznych powiadomień", async () => {
    // `my_connections` zwraca do stu kontaktów. Bez filtra mapa niosłaby
    // wszystkie, a konsument i tak pyta ją wyłącznie o widoczne wiersze -
    // czyli byłaby to pamięć zajęta bez powodu i szersza ekspozycja danych
    // kontaktów niż wymaga widok.
    planConnections([
      profile({ connection_id: ACTOR_A }),
      profile({ connection_id: ACTOR_C, display_name: "Ktoś spoza listy" }),
    ]);
    const { result } = renderHookWithQueryClient(() =>
      useNotificationActorProfiles([rowFor(ACTOR_A, "n-1")], true),
    );

    await waitFor(() => expect(result.current.size).toBe(1));
    expect(result.current.has(ACTOR_C)).toBe(false);
  });

  it("scala kontakty z obiema stronami próśb o połączenie", async () => {
    rpc().setResponse("my_connections", ok([profile({ connection_id: ACTOR_A })]));
    rpc().setResponse("my_connection_requests", (call) =>
      call.arg("p_direction") === "in"
        ? ok([profile({ connection_id: ACTOR_B, display_name: "Prośba przychodząca" })])
        : ok([profile({ connection_id: ACTOR_C, display_name: "Prośba wychodząca" })]),
    );
    const items = [rowFor(ACTOR_A, "n-1"), rowFor(ACTOR_B, "n-2"), rowFor(ACTOR_C, "n-3")];
    const { result } = renderHookWithQueryClient(() => useNotificationActorProfiles(items, true));

    await waitFor(() => expect(result.current.size).toBe(3));
    expect(result.current.get(ACTOR_B)?.display_name).toBe("Prośba przychodząca");
    expect(result.current.get(ACTOR_C)?.display_name).toBe("Prośba wychodząca");
  });

  it("normalizuje PUSTY `avatar_url` do null", async () => {
    // Pusty napis w `<img src="">` każe przeglądarce pobrać BIEŻĄCĄ stronę
    // jako obrazek. Konsument rysuje inicjały tylko dla `null`, więc to jest
    // różnica między zastępczym awatarem a zepsutym żądaniem.
    planConnections([
      profile({ connection_id: ACTOR_A, avatar_url: "" }),
      profile({ connection_id: ACTOR_B, avatar_url: "https://example.com/a.png" }),
    ]);
    const items = [rowFor(ACTOR_A, "n-1"), rowFor(ACTOR_B, "n-2")];
    const { result } = renderHookWithQueryClient(() => useNotificationActorProfiles(items, true));

    await waitFor(() => expect(result.current.size).toBe(2));
    expect(result.current.get(ACTOR_A)?.avatar_url).toBeNull();
    expect(result.current.get(ACTOR_B)?.avatar_url).toBe("https://example.com/a.png");
  });

  it("zachowuje `avatar_url` równy null bez zmiany", async () => {
    planConnections([profile({ connection_id: ACTOR_A, avatar_url: null })]);
    const { result } = renderHookWithQueryClient(() =>
      useNotificationActorProfiles([rowFor(ACTOR_A, "n-1")], true),
    );

    await waitFor(() => expect(result.current.size).toBe(1));
    expect(result.current.get(ACTOR_A)?.avatar_url).toBeNull();
  });
});

describe("useNotificationActorProfiles - błędy", () => {
  /** Stan zapytania profili - jedyne miejsce, w którym widać błąd (hook zwraca Mapę). */
  async function expectQueryError(plan: () => void, expectedMessage: string): Promise<void> {
    plan();
    const { result, queryClient } = renderHookWithQueryClient(() =>
      useNotificationActorProfiles([rowFor(ACTOR_A, "n-1")], true),
    );

    await waitFor(() => {
      const query = queryClient.getQueryCache().getAll()[0];
      expect(query?.state.status).toBe("error");
      expect(query?.state.error?.message).toContain(expectedMessage);
    });
    // Błąd nie może udawać „brak profili" wypełnioną mapą z poprzedniej próby.
    expect(result.current.size).toBe(0);
  }

  it("RZUCA, gdy odmówi `my_connections`", async () => {
    await expectQueryError(() => {
      rpc().setResponse("my_connections", fail("permission denied", "42501"));
      rpc().setResponse("my_connection_requests", ok([]));
    }, "permission denied");
  });

  it("RZUCA, gdy odmówi prośba PRZYCHODZĄCA", async () => {
    // Błąd drugiego z trzech RPC jest najłatwiejszy do przeoczenia: pierwsze
    // zapytanie zwróciło dane, więc mapa nie jest pusta i widok „działa".
    await expectQueryError(() => {
      rpc().setResponse("my_connections", ok([profile({ connection_id: ACTOR_A })]));
      rpc().setResponse("my_connection_requests", (call) =>
        call.arg("p_direction") === "in" ? fail("in direction failed") : ok([]),
      );
    }, "in direction failed");
  });

  it("RZUCA, gdy odmówi prośba WYCHODZĄCA", async () => {
    await expectQueryError(() => {
      rpc().setResponse("my_connections", ok([profile({ connection_id: ACTOR_A })]));
      rpc().setResponse("my_connection_requests", (call) =>
        call.arg("p_direction") === "out" ? fail("out direction failed") : ok([]),
      );
    }, "out direction failed");
  });

  it("brak danych z któregokolwiek RPC to pusty wkład, nie wyjątek", async () => {
    // `data: null` przy `error: null` zdarza się dla RPC zwracającego SETOF
    // bez wierszy - `?? []` musi to przeżyć, bo inaczej spread rzuca.
    rpc().setResponse("my_connections", ok(null));
    rpc().setResponse("my_connection_requests", ok(null));
    const { result, queryClient } = renderHookWithQueryClient(() =>
      useNotificationActorProfiles([rowFor(ACTOR_A, "n-1")], true),
    );

    await waitFor(() =>
      expect(queryClient.getQueryCache().getAll()[0]?.state.status).toBe("success"),
    );
    expect(result.current.size).toBe(0);
  });
});
