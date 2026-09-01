// Warstwa danych POWIADOMIEŃ - kontrakt z bazą, nie implementacja react-query.
//
// Testujemy: kształt zapytań PostgREST (zakres stron, filtry, kolejność),
// normalizację klucza cache (dzwonek i skrzynka MAJĄ dzielić jeden request),
// ścieżkę zmaterializowanego licznika z fallbackiem na COUNT(*), argumenty
// każdej mutacji i RPC, ZAKRES UNIEWAŻNIEŃ po sukcesie, bramkę wielotenantową
// przy zapisie preferencji oraz kanały realtime wraz ze zwolnieniem kanału
// przy odmontowaniu.
//
// UWAGA DO CZYTELNIKA. Mutacje w TYM module mają WYŁĄCZNIE `onSuccess` -
// nie ma tu `onMutate` ani `onError`, więc nie ma czego testować pod kątem
// optymistycznych aktualizacji i rollbacku. Optymistyka żyje w osobnych,
// lokalnych mutacjach `NotificationsCenter.tsx` (`markMany`, `unreadMany`,
// `deleteGroup`) i to tam - a nie tutaj - jest jej miejsce testowe.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, waitFor } from "@testing-library/react";
import type { QueryClient } from "@tanstack/react-query";
import { renderHookWithQueryClient } from "@/test/renderWithQueryClient";
import {
  fail,
  ok,
  okCount,
  type SupabaseFromStub,
  type SupabaseRpcStub,
  type RealtimeStub,
} from "@/test/supabase";
import type { Database } from "@/integrations/supabase/types";

type NotificationRowShape = Database["public"]["Tables"]["notifications"]["Row"];

const UID = "11111111-2222-4333-8444-555555555555";
const TENANT_ID = "99999999-8888-4777-8666-555555555555";

const h = vi.hoisted(() => ({
  auth: { uid: "11111111-2222-4333-8444-555555555555" as string | null, loading: false },
}));

// Atrapy modułowe muszą powstać w fabryce `vi.mock` (hoisting), więc trzymamy
// je w kontenerze `vi.hoisted`. Pola są TYPOWANE na `… | null`, żeby dostęp do
// nich nie wymagał ani jednego rzutowania.
const stubs = vi.hoisted(() => ({
  from: null as SupabaseFromStub | null,
  rpc: null as SupabaseRpcStub | null,
  realtime: null as RealtimeStub | null,
}));

vi.mock("@/integrations/supabase/client", async () => {
  const fixtures = await import("@/test/supabase");
  const from = fixtures.supabaseFromStub();
  const rpc = fixtures.supabaseRpcStub();
  const realtime = fixtures.realtimeStub();
  stubs.from = from;
  stubs.rpc = rpc;
  stubs.realtime = realtime;
  return {
    supabase: {
      from: from.from,
      rpc: rpc.rpc,
      channel: realtime.channel,
      removeChannel: realtime.removeChannel,
    },
  };
});

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: h.auth.uid === null ? null : { id: h.auth.uid },
    loading: h.auth.loading,
  }),
}));

import { activeChannelCount } from "@/lib/realtime/tableChannelHub";
import { invalidationKeysForNotificationKind } from "../kindInvalidation";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "../preferences";
import {
  NOTIFICATIONS_PAGE_SIZE,
  useDeleteNotification,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useMarkNotificationUnread,
  useMarkNotificationsRead,
  useMarkNotificationsUnread,
  useNotificationPreferences,
  useNotificationPreferencesRealtime,
  useNotifications,
  useNotificationsInfinite,
  useNotificationsRealtime,
  useUnreadCount,
  useUpdateNotificationPreferences,
} from "../useNotifications";

/** Dostęp do atrap bez rzutowań - brak atrapy to błąd konfiguracji testu. */
function db(): SupabaseFromStub {
  if (!stubs.from) throw new Error("test: atrapa `from` nie została utworzona");
  return stubs.from;
}
function rpc(): SupabaseRpcStub {
  if (!stubs.rpc) throw new Error("test: atrapa `rpc` nie została utworzona");
  return stubs.rpc;
}
function rt(): RealtimeStub {
  if (!stubs.realtime) throw new Error("test: atrapa realtime nie została utworzona");
  return stubs.realtime;
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

/** Klucze cache w kształcie, w jakim buduje je moduł (`countKey`/`prefsKey`). */
const COUNT_KEY = ["notifications", "unread-count", UID];
const PREFS_KEY = ["notifications", "preferences", UID];

function spyOnInvalidate(client: QueryClient) {
  return vi.spyOn(client, "invalidateQueries");
}
type InvalidateSpy = ReturnType<typeof spyOnInvalidate>;

/** Klucze, które mutacja realnie unieważniła - sedno asercji „co się odświeży". */
function invalidatedKeys(spy: InvalidateSpy): unknown[] {
  return spy.mock.calls.map((call) => call[0]?.queryKey);
}

beforeEach(() => {
  h.auth.uid = UID;
  h.auth.loading = false;
  db().reset();
  rpc().reset();
  rt().reset();
});

afterEach(() => {
  // `tableChannelHub` trzyma mapę kanałów w stanie MODUŁOWYM, wspólnym dla
  // wszystkich testów w pliku. Niezwolniony kanał wyciekłby do następnego
  // testu i cicho zmienił jego wynik, więc refcount musi wracać do zera.
  expect(activeChannelCount()).toBe(0);
});

describe("useNotificationsInfinite - bramka `enabled`", () => {
  it("NIE odpytuje bazy, dopóki AuthProvider nie zamknie handshake'u", async () => {
    // `loading: true` znaczy „sesja jeszcze się materializuje". Zapytanie
    // wystrzelone teraz poleciałoby anonimowo i i tak zostałoby powtórzone po
    // odzyskaniu sesji - czyli dublowany request przy każdym wejściu.
    h.auth.loading = true;
    db().setResponse("notifications", ok([]));
    const { queryClient } = renderHookWithQueryClient(() => useNotificationsInfinite());
    await Promise.resolve();

    expect(db().chainsFor("notifications")).toHaveLength(0);
    const busy = queryClient
      .getQueryCache()
      .getAll()
      .filter((query) => query.state.fetchStatus !== "idle");
    expect(busy).toHaveLength(0);
  });

  it("NIE odpytuje bazy bez zalogowanego użytkownika", async () => {
    h.auth.uid = null;
    db().setResponse("notifications", ok([]));
    renderHookWithQueryClient(() => useNotificationsInfinite());
    await Promise.resolve();

    expect(db().chainsFor("notifications")).toHaveLength(0);
  });
});

describe("useNotificationsInfinite - klucz cache", () => {
  it("`{}` i `{ onlyUnread: false }` trafiają do JEDNEGO slotu cache", async () => {
    // To jest powód, dla którego dzwonek i skrzynka robią JEDEN request zamiast
    // dwóch: `normalizeFilter` sprowadza brak pola i `false` do tej samej
    // wartości. Rozjazd tej normalizacji nie psuje żadnego widoku - tylko cicho
    // podwaja ruch po każdym zalogowaniu.
    db().setResponse("notifications", ok([notificationRow()]));
    const { result, queryClient } = renderHookWithQueryClient(() => ({
      bell: useNotificationsInfinite({}),
      center: useNotificationsInfinite({ onlyUnread: false }),
    }));

    await waitFor(() => expect(result.current.bell.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.center.isSuccess).toBe(true));

    expect(queryClient.getQueryCache().getAll()).toHaveLength(1);
    expect(db().chainsFor("notifications")).toHaveLength(1);
  });

  it("normalizuje klucz do (uid, onlyUnread, kind, pageSize)", async () => {
    db().setResponse("notifications", ok([]));
    const { result, queryClient } = renderHookWithQueryClient(() => useNotificationsInfinite({}));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryClient.getQueryCache().getAll()[0]?.queryKey).toEqual([
      "notifications",
      UID,
      { onlyUnread: false, kind: null, pageSize: NOTIFICATIONS_PAGE_SIZE },
    ]);
  });

  it("RÓŻNY filtr to RÓŻNY slot cache i osobny request", async () => {
    db().setResponse("notifications", ok([]));
    const { result, queryClient } = renderHookWithQueryClient(() => ({
      all: useNotificationsInfinite({}),
      unread: useNotificationsInfinite({ onlyUnread: true }),
    }));

    await waitFor(() => expect(result.current.all.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.unread.isSuccess).toBe(true));
    expect(queryClient.getQueryCache().getAll()).toHaveLength(2);
    expect(db().chainsFor("notifications")).toHaveLength(2);
  });
});

describe("useNotificationsInfinite - kształt zapytania", () => {
  it("czyta stronę przez `.range()` policzony z `pageSize` i sortuje malejąco", async () => {
    db().setResponse("notifications", ok([]));
    const { result } = renderHookWithQueryClient(() => useNotificationsInfinite({ pageSize: 10 }));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const chain = db().lastChain("notifications");
    expect(chain?.argsOf("range")).toEqual([0, 9]);
    expect(chain?.argsOf("order")).toEqual(["created_at", { ascending: false }]);
    expect(chain?.argsOf("select")).toEqual(["*"]);
  });

  it("dokłada `.is('read_at', null)` TYLKO przy `onlyUnread`", async () => {
    db().setResponse("notifications", ok([]));
    const { result } = renderHookWithQueryClient(() =>
      useNotificationsInfinite({ onlyUnread: true }),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(db().lastChain("notifications")?.argsOf("is")).toEqual(["read_at", null]);
  });

  it("NIE dokłada `.is()` przy `onlyUnread: false`", async () => {
    // Zbłąkane `.is("read_at", null)` na zakładce „Wszystkie" ukryłoby
    // wszystkie przeczytane wiersze - defekt niewidoczny w typach.
    db().setResponse("notifications", ok([]));
    const { result } = renderHookWithQueryClient(() =>
      useNotificationsInfinite({ onlyUnread: false }),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(db().lastChain("notifications")?.has("is")).toBe(false);
  });

  it("dokłada `.eq('kind', …)` TYLKO przy podanym rodzaju", async () => {
    db().setResponse("notifications", ok([]));
    const { result } = renderHookWithQueryClient(() => ({
      typed: useNotificationsInfinite({ kind: "connection" }),
    }));

    await waitFor(() => expect(result.current.typed.isSuccess).toBe(true));
    expect(db().lastChain("notifications")?.argsOf("eq")).toEqual(["kind", "connection"]);
  });

  it("NIE dokłada `.eq('kind', …)` bez rodzaju", async () => {
    db().setResponse("notifications", ok([]));
    const { result } = renderHookWithQueryClient(() => useNotificationsInfinite({}));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(db().lastChain("notifications")?.has("eq")).toBe(false);
  });

  it("propaguje błąd PostgREST zamiast udawać pustą skrzynkę", async () => {
    // Cicha pusta lista przy odmowie RLS wygląda jak „brak powiadomień",
    // więc użytkownik nie ma jak zauważyć, że nic nie dostaje.
    db().setResponse("notifications", fail("permission denied for table notifications", "42501"));
    const { result } = renderHookWithQueryClient(() => useNotificationsInfinite({}));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toContain("permission denied");
  });
});

describe("useNotificationsInfinite - paginacja", () => {
  it("PEŁNA strona daje kolejny indeks strony, a `.range()` przesuwa się o pageSize", async () => {
    let served = 0;
    db().setResponse("notifications", () => {
      served += 1;
      return served === 1
        ? ok([notificationRow({ id: "n-1" }), notificationRow({ id: "n-2" })])
        : ok([notificationRow({ id: "n-3" })]);
    });
    const { result } = renderHookWithQueryClient(() => useNotificationsInfinite({ pageSize: 2 }));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(true);

    await act(async () => {
      await result.current.fetchNextPage();
    });
    // Druga strona to indeks 1, czyli wiersze 2..3 - liczone z `pageSize`,
    // a nie z liczby wierszy już wczytanych (to rozróżnienie psuje się przy
    // pierwszej optymalizacji „liczmy od długości danych").
    expect(db().lastChain("notifications")?.argsOf("range")).toEqual([2, 3]);
    await waitFor(() =>
      expect(result.current.data?.pages.map((page) => page.length)).toEqual([2, 1]),
    );
  });

  it("strona KRÓTSZA niż pageSize kończy paginację", async () => {
    db().setResponse("notifications", ok([notificationRow({ id: "n-1" })]));
    const { result } = renderHookWithQueryClient(() => useNotificationsInfinite({ pageSize: 2 }));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(false);
  });

  it("brak danych z bazy to pusta strona, nie wyjątek", async () => {
    db().setResponse("notifications", ok(null));
    const { result } = renderHookWithQueryClient(() => useNotificationsInfinite({}));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.pages).toEqual([[]]);
  });
});

describe("useNotifications", () => {
  it("spłaszcza strony do JEDNEJ tablicy", async () => {
    let served = 0;
    db().setResponse("notifications", () => {
      served += 1;
      return served === 1
        ? ok([notificationRow({ id: "n-1" }), notificationRow({ id: "n-2" })])
        : ok([notificationRow({ id: "n-3" })]);
    });
    const { result } = renderHookWithQueryClient(() => ({
      flat: useNotifications({ pageSize: 2 }),
      infinite: useNotificationsInfinite({ pageSize: 2 }),
    }));

    await waitFor(() => expect(result.current.flat.isSuccess).toBe(true));
    await act(async () => {
      await result.current.infinite.fetchNextPage();
    });
    await waitFor(() =>
      expect(result.current.flat.data?.map((row) => row.id)).toEqual(["n-1", "n-2", "n-3"]),
    );
  });

  it("DZIELI cache z `useNotificationsInfinite` - jeden request, nie dwa", async () => {
    db().setResponse("notifications", ok([notificationRow()]));
    const { result, queryClient } = renderHookWithQueryClient(() => ({
      flat: useNotifications({}),
      infinite: useNotificationsInfinite({}),
    }));

    await waitFor(() => expect(result.current.flat.isSuccess).toBe(true));
    expect(queryClient.getQueryCache().getAll()).toHaveLength(1);
    expect(db().chainsFor("notifications")).toHaveLength(1);
  });
});

describe("useUnreadCount", () => {
  it("czyta ZMATERIALIZOWANY licznik i NIE dotyka tabeli notifications", async () => {
    // Badge odświeża się przy każdej zmianie skrzynki. COUNT(*) po
    // `notifications` byłby tu skanem na każde odświeżenie - stąd licznik
    // utrzymywany triggerami. Test pilnuje, że fallback nie stał się ścieżką
    // podstawową.
    db().setResponse("user_pending_counters", ok({ value: 7 }));
    const { result } = renderHookWithQueryClient(() => useUnreadCount());

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(7);
    const chain = db().lastChain("user_pending_counters");
    expect(chain?.argsOf("select")).toEqual(["value"]);
    expect(chain?.argsOf("eq")).toEqual(["counter_key", "notifications_unread"]);
    expect(chain?.has("maybeSingle")).toBe(true);
    expect(db().chainsFor("notifications")).toHaveLength(0);
  });

  it("spada na COUNT(*) po `notifications`, gdy wiersza licznika NIE MA", async () => {
    // Konta sprzed seedu liczników nie mają wiersza w `user_pending_counters`.
    db().setResponse("user_pending_counters", ok(null));
    db().setResponse("notifications", okCount(3));
    const { result } = renderHookWithQueryClient(() => useUnreadCount());

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(3);
    const chain = db().lastChain("notifications");
    expect(chain?.argsOf("select")).toEqual(["id", { count: "exact", head: true }]);
    expect(chain?.argsOf("is")).toEqual(["read_at", null]);
  });

  it("spada na COUNT(*) także wtedy, gdy odczyt licznika zwrócił BŁĄD", async () => {
    db().setResponse("user_pending_counters", fail("relation does not exist", "42P01"));
    db().setResponse("notifications", okCount(5));
    const { result } = renderHookWithQueryClient(() => useUnreadCount());

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(5);
  });

  it("brak licznika w odpowiedzi COUNT to zero, nie undefined", async () => {
    db().setResponse("user_pending_counters", ok(null));
    db().setResponse("notifications", ok(null));
    const { result } = renderHookWithQueryClient(() => useUnreadCount());

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(0);
  });

  it("błąd COUNT(*) RZUCA - badge nie pokazuje wyssanego zera", async () => {
    db().setResponse("user_pending_counters", ok(null));
    db().setResponse("notifications", fail("permission denied", "42501"));
    const { result } = renderHookWithQueryClient(() => useUnreadCount());

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("nie odpytuje bazy bez zalogowanego użytkownika", async () => {
    h.auth.uid = null;
    db().setResponse("user_pending_counters", ok({ value: 1 }));
    renderHookWithQueryClient(() => useUnreadCount());
    await Promise.resolve();

    expect(db().chainsFor("user_pending_counters")).toHaveLength(0);
  });
});

describe("useMarkNotificationRead", () => {
  it("aktualizuje TYLKO wskazany, jeszcze nieprzeczytany wiersz", async () => {
    // `.is("read_at", null)` w warunku jest istotne: bez niego ponowne
    // kliknięcie przesuwałoby znacznik przeczytania na „teraz", a skrzynka
    // sortuje po nim historię.
    db().setResponse("notifications", ok(null));
    const { result } = renderHookWithQueryClient(() => useMarkNotificationRead());

    await act(async () => {
      await result.current.mutateAsync("n-7");
    });
    const chain = db().lastChain("notifications");
    expect(chain?.has("update")).toBe(true);
    expect(chain?.argsOf("eq")).toEqual(["id", "n-7"]);
    expect(chain?.argsOf("is")).toEqual(["read_at", null]);
  });

  it("stempluje `read_at` znacznikiem ISO", async () => {
    db().setResponse("notifications", ok(null));
    const { result } = renderHookWithQueryClient(() => useMarkNotificationRead());

    await act(async () => {
      await result.current.mutateAsync("n-7");
    });
    const patch = db().lastChain("notifications")?.argsOf("update")?.[0];
    expect(patch).toEqual({ read_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) });
  });

  it("unieważnia listy ORAZ licznik nieprzeczytanych", async () => {
    db().setResponse("notifications", ok(null));
    const { result, queryClient } = renderHookWithQueryClient(() => useMarkNotificationRead());
    const spy = spyOnInvalidate(queryClient);

    await act(async () => {
      await result.current.mutateAsync("n-7");
    });
    expect(invalidatedKeys(spy)).toEqual([["notifications"], COUNT_KEY]);
  });

  it("RZUCA przy odmowie bazy i wtedy niczego nie unieważnia", async () => {
    db().setResponse("notifications", fail("permission denied", "42501"));
    const { result, queryClient } = renderHookWithQueryClient(() => useMarkNotificationRead());
    const spy = spyOnInvalidate(queryClient);

    await act(async () => {
      await expect(result.current.mutateAsync("n-7")).rejects.toThrow("permission denied");
    });
    expect(invalidatedKeys(spy)).toEqual([]);
  });
});

describe("useMarkNotificationsRead / useMarkNotificationsUnread (wsad)", () => {
  it("woła RPC `mark_notifications_read` z tablicą identyfikatorów", async () => {
    rpc().setData("mark_notifications_read", 2);
    const { result } = renderHookWithQueryClient(() => useMarkNotificationsRead());

    await act(async () => {
      await expect(result.current.mutateAsync(["n-1", "n-2"])).resolves.toBe(2);
    });
    expect(rpc().lastCall("mark_notifications_read")?.args).toEqual({ p_ids: ["n-1", "n-2"] });
  });

  it("PUSTA lista nie woła RPC i zwraca zero", async () => {
    // Skrzynka woła wsad z zaznaczenia, a puste zaznaczenie zdarza się przy
    // każdym „zaznacz wszystko" na pustej zakładce. Wysłanie `p_ids: []`
    // byłoby żądaniem bez skutku, więc gałąź musi zostać.
    const { result } = renderHookWithQueryClient(() => useMarkNotificationsRead());

    await act(async () => {
      await expect(result.current.mutateAsync([])).resolves.toBe(0);
    });
    expect(rpc().calls).toHaveLength(0);
  });

  it("brak zwrotki z RPC to zero, nie null", async () => {
    rpc().setData("mark_notifications_read", null);
    const { result } = renderHookWithQueryClient(() => useMarkNotificationsRead());

    await act(async () => {
      await expect(result.current.mutateAsync(["n-1"])).resolves.toBe(0);
    });
  });

  it("wsadowe oznaczenie jako przeczytane unieważnia listy i licznik", async () => {
    rpc().setData("mark_notifications_read", 1);
    const { result, queryClient } = renderHookWithQueryClient(() => useMarkNotificationsRead());
    const spy = spyOnInvalidate(queryClient);

    await act(async () => {
      await result.current.mutateAsync(["n-1"]);
    });
    expect(invalidatedKeys(spy)).toEqual([["notifications"], COUNT_KEY]);
  });

  it("RZUCA, gdy RPC `mark_notifications_read` odmówi", async () => {
    rpc().setError("mark_notifications_read", "not owner of notification");
    const { result } = renderHookWithQueryClient(() => useMarkNotificationsRead());

    await act(async () => {
      await expect(result.current.mutateAsync(["n-1"])).rejects.toThrow("not owner");
    });
  });

  it("woła RPC `mark_notifications_unread` z tablicą identyfikatorów", async () => {
    rpc().setData("mark_notifications_unread", 3);
    const { result, queryClient } = renderHookWithQueryClient(() => useMarkNotificationsUnread());
    const spy = spyOnInvalidate(queryClient);

    await act(async () => {
      await expect(result.current.mutateAsync(["n-1", "n-2", "n-3"])).resolves.toBe(3);
    });
    expect(rpc().lastCall("mark_notifications_unread")?.args).toEqual({
      p_ids: ["n-1", "n-2", "n-3"],
    });
    expect(invalidatedKeys(spy)).toEqual([["notifications"], COUNT_KEY]);
  });

  it("PUSTA lista nie woła RPC odznaczania", async () => {
    const { result } = renderHookWithQueryClient(() => useMarkNotificationsUnread());

    await act(async () => {
      await expect(result.current.mutateAsync([])).resolves.toBe(0);
    });
    expect(rpc().calls).toHaveLength(0);
  });

  it("RZUCA, gdy RPC `mark_notifications_unread` odmówi", async () => {
    rpc().setError("mark_notifications_unread", "not owner of notification");
    const { result } = renderHookWithQueryClient(() => useMarkNotificationsUnread());

    await act(async () => {
      await expect(result.current.mutateAsync(["n-1"])).rejects.toThrow("not owner");
    });
  });
});

describe("useMarkNotificationUnread (pojedynczy)", () => {
  it("woła RPC `mark_notification_unread` z identyfikatorem wiersza", async () => {
    rpc().setData("mark_notification_unread", null);
    const { result, queryClient } = renderHookWithQueryClient(() => useMarkNotificationUnread());
    const spy = spyOnInvalidate(queryClient);

    await act(async () => {
      await result.current.mutateAsync("n-9");
    });
    expect(rpc().lastCall("mark_notification_unread")?.args).toEqual({ p_id: "n-9" });
    expect(invalidatedKeys(spy)).toEqual([["notifications"], COUNT_KEY]);
  });

  it("RZUCA przy odmowie RPC", async () => {
    rpc().setError("mark_notification_unread", "row not found");
    const { result } = renderHookWithQueryClient(() => useMarkNotificationUnread());

    await act(async () => {
      await expect(result.current.mutateAsync("n-9")).rejects.toThrow("row not found");
    });
  });
});

describe("useMarkAllNotificationsRead", () => {
  it("zawęża UPDATE do WŁASNYCH, nieprzeczytanych wierszy", async () => {
    // `.eq("user_id", uid)` obok RLS nie jest nadmiarem: to jedyne zawężenie
    // widoczne w zapytaniu, więc jego utrata przy refaktorze nie zapaliłaby
    // niczego aż do audytu bazy.
    db().setResponse("notifications", ok(null));
    const { result } = renderHookWithQueryClient(() => useMarkAllNotificationsRead());

    await act(async () => {
      await result.current.mutateAsync();
    });
    const chain = db().lastChain("notifications");
    expect(chain?.has("update")).toBe(true);
    expect(chain?.argsOf("eq")).toEqual(["user_id", UID]);
    expect(chain?.argsOf("is")).toEqual(["read_at", null]);
  });

  it("BEZ zalogowanego użytkownika nie wysyła żadnego zapytania", async () => {
    h.auth.uid = null;
    db().setResponse("notifications", ok(null));
    const { result } = renderHookWithQueryClient(() => useMarkAllNotificationsRead());

    await act(async () => {
      await result.current.mutateAsync();
    });
    expect(db().chainsFor("notifications")).toHaveLength(0);
  });

  it("unieważnia listy i licznik po sukcesie", async () => {
    db().setResponse("notifications", ok(null));
    const { result, queryClient } = renderHookWithQueryClient(() => useMarkAllNotificationsRead());
    const spy = spyOnInvalidate(queryClient);

    await act(async () => {
      await result.current.mutateAsync();
    });
    expect(invalidatedKeys(spy)).toEqual([["notifications"], COUNT_KEY]);
  });

  it("RZUCA przy odmowie bazy", async () => {
    db().setResponse("notifications", fail("permission denied", "42501"));
    const { result } = renderHookWithQueryClient(() => useMarkAllNotificationsRead());

    await act(async () => {
      await expect(result.current.mutateAsync()).rejects.toThrow("permission denied");
    });
  });
});

describe("useDeleteNotification", () => {
  it("usuwa wiersz po identyfikatorze", async () => {
    db().setResponse("notifications", ok(null));
    const { result, queryClient } = renderHookWithQueryClient(() => useDeleteNotification());
    const spy = spyOnInvalidate(queryClient);

    await act(async () => {
      await result.current.mutateAsync("n-3");
    });
    const chain = db().lastChain("notifications");
    expect(chain?.has("delete")).toBe(true);
    expect(chain?.argsOf("eq")).toEqual(["id", "n-3"]);
    expect(invalidatedKeys(spy)).toEqual([["notifications"], COUNT_KEY]);
  });

  it("RZUCA przy odmowie bazy", async () => {
    db().setResponse("notifications", fail("permission denied", "42501"));
    const { result } = renderHookWithQueryClient(() => useDeleteNotification());

    await act(async () => {
      await expect(result.current.mutateAsync("n-3")).rejects.toThrow("permission denied");
    });
  });
});

describe("useNotificationPreferences", () => {
  it("dokleja wartości domyślne do wiersza z bazy", async () => {
    // Wiersz w bazie ma tylko te kolumny, które użytkownik kiedykolwiek
    // zapisał. Bez sklejenia z domyślnymi nowa flaga wracałaby jako
    // `undefined` i przełącznik renderowałby się jako wyłączony.
    db().setResponse("notification_preferences", ok({ enabled_message: false }));
    const { result } = renderHookWithQueryClient(() => useNotificationPreferences());

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      enabled_message: false,
    });
    expect(db().lastChain("notification_preferences")?.argsOf("eq")).toEqual(["user_id", UID]);
  });

  it("brak wiersza to komplet wartości domyślnych", async () => {
    db().setResponse("notification_preferences", ok(null));
    const { result } = renderHookWithQueryClient(() => useNotificationPreferences());

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
  });

  it("RZUCA przy odmowie bazy zamiast podstawiać domyślne", async () => {
    db().setResponse("notification_preferences", fail("permission denied", "42501"));
    const { result } = renderHookWithQueryClient(() => useNotificationPreferences());

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("nie odpytuje bazy bez zalogowanego użytkownika", async () => {
    h.auth.uid = null;
    db().setResponse("notification_preferences", ok(null));
    renderHookWithQueryClient(() => useNotificationPreferences());
    await Promise.resolve();

    expect(db().chainsFor("notification_preferences")).toHaveLength(0);
  });
});

describe("useUpdateNotificationPreferences - bramka wielotenantowa", () => {
  it("bez użytkownika odmawia z `Not authenticated` i nie czyta profilu", async () => {
    h.auth.uid = null;
    const { result } = renderHookWithQueryClient(() => useUpdateNotificationPreferences());

    await act(async () => {
      await expect(result.current.mutateAsync({ enabled_message: false })).rejects.toThrow(
        "Not authenticated",
      );
    });
    expect(db().chainsFor("profiles")).toHaveLength(0);
  });

  it("bez `tenant_id` w profilu odmawia z `Profile tenant not found` i NIE zapisuje", async () => {
    // To jest bramka WIELOTENANTOWA. `notification_preferences.tenant_id` jest
    // NOT NULL i wchodzi w politykę RLS - zapis bez tenanta albo odpadłby na
    // bazie, albo (gdyby kolumna kiedyś zwiotczała) osadził wiersz preferencji
    // POZA tenantem, gdzie nie widziałby go ani właściciel, ani administrator.
    db().setResponse("profiles", ok({ tenant_id: null }));
    const { result } = renderHookWithQueryClient(() => useUpdateNotificationPreferences());

    await act(async () => {
      await expect(result.current.mutateAsync({ enabled_message: false })).rejects.toThrow(
        "Profile tenant not found",
      );
    });
    expect(db().chainsFor("notification_preferences")).toHaveLength(0);
  });

  it("brak wiersza profilu też blokuje zapis", async () => {
    db().setResponse("profiles", ok(null));
    const { result } = renderHookWithQueryClient(() => useUpdateNotificationPreferences());

    await act(async () => {
      await expect(result.current.mutateAsync({ enabled_message: false })).rejects.toThrow(
        "Profile tenant not found",
      );
    });
    expect(db().chainsFor("notification_preferences")).toHaveLength(0);
  });

  it("błąd odczytu profilu propaguje się i wstrzymuje zapis", async () => {
    db().setResponse("profiles", fail("permission denied for table profiles", "42501"));
    const { result } = renderHookWithQueryClient(() => useUpdateNotificationPreferences());

    await act(async () => {
      await expect(result.current.mutateAsync({ enabled_message: false })).rejects.toThrow(
        "permission denied",
      );
    });
    expect(db().chainsFor("notification_preferences")).toHaveLength(0);
  });

  it("upsert niesie `user_id`, `tenant_id` Z PROFILU i patch, z `onConflict: user_id`", async () => {
    db().setResponse("profiles", ok({ tenant_id: TENANT_ID }));
    db().setResponse("notification_preferences", ok(null));
    const { result, queryClient } = renderHookWithQueryClient(() =>
      useUpdateNotificationPreferences(),
    );
    const spy = spyOnInvalidate(queryClient);

    await act(async () => {
      await result.current.mutateAsync({ enabled_message: false, enabled_club: true });
    });
    const args = db().lastChain("notification_preferences")?.argsOf("upsert");
    expect(args?.[0]).toEqual({
      user_id: UID,
      tenant_id: TENANT_ID,
      enabled_message: false,
      enabled_club: true,
    });
    // `onConflict` jest warunkiem IDEMPOTENCJI: bez niego drugi zapis tych
    // samych preferencji łamie unikalność `user_id` zamiast nadpisać wiersz.
    expect(args?.[1]).toEqual({ onConflict: "user_id" });
    expect(db().lastChain("profiles")?.argsOf("eq")).toEqual(["id", UID]);
    // Zapis preferencji NIE unieważnia list ani licznika - tylko preferencje.
    expect(invalidatedKeys(spy)).toEqual([PREFS_KEY]);
  });

  it("RZUCA, gdy upsert odpadnie na bazie", async () => {
    db().setResponse("profiles", ok({ tenant_id: TENANT_ID }));
    db().setResponse("notification_preferences", fail("new row violates policy", "42501"));
    const { result } = renderHookWithQueryClient(() => useUpdateNotificationPreferences());

    await act(async () => {
      await expect(result.current.mutateAsync({ enabled_message: false })).rejects.toThrow(
        "violates policy",
      );
    });
  });
});

describe("useNotificationsRealtime", () => {
  const CHANNEL_PREFIX = "hub:public|notifications|";

  it("subskrybuje kanał ZAWĘŻONY filtrem `user_id=eq.<uid>`", () => {
    // RLS i tak tnie cudze wiersze, ale bez filtra serwer rozsyła KAŻDĄ zmianę
    // tabeli do każdego klienta - to firehose między tenantami na łączu, nie
    // dziura w izolacji. Filtr jest jedynym, co go zamyka.
    const { unmount } = renderHookWithQueryClient(() => useNotificationsRealtime());

    const channel = rt().channelByPrefix(CHANNEL_PREFIX);
    expect(channel?.subscribeCount).toBe(1);
    expect(channel?.listeners[0]?.filter).toEqual({
      event: "*",
      schema: "public",
      table: "notifications",
      filter: `user_id=eq.${UID}`,
    });
    unmount();
  });

  it("NIE zakłada kanału bez zalogowanego użytkownika", () => {
    h.auth.uid = null;
    const { unmount } = renderHookWithQueryClient(() => useNotificationsRealtime());

    expect(rt().channels).toHaveLength(0);
    expect(activeChannelCount()).toBe(0);
    unmount();
  });

  it("INSERT unieważnia listy, licznik ORAZ klucze modułu wskazane przez rodzaj", () => {
    const { queryClient, unmount } = renderHookWithQueryClient(() => useNotificationsRealtime());
    const spy = spyOnInvalidate(queryClient);

    act(() => {
      rt()
        .channelByPrefix(CHANNEL_PREFIX)
        ?.emitPostgres("notifications", {
          eventType: "INSERT",
          new: notificationRow({ kind: "connection" }),
        });
    });

    const keys = invalidatedKeys(spy);
    expect(keys.slice(0, 2)).toEqual([["notifications"], COUNT_KEY]);
    // Reguła „co odświeżyć" mieszka w `kindInvalidation`; test czyta ją stamtąd,
    // żeby dopisanie rodzaju nie wymagało edycji dwóch list.
    expect(keys.slice(2)).toEqual([...invalidationKeysForNotificationKind("connection")]);
    unmount();
  });

  it("rodzaj BEZ skutków ubocznych odświeża wyłącznie skrzynkę i licznik", () => {
    const { queryClient, unmount } = renderHookWithQueryClient(() => useNotificationsRealtime());
    const spy = spyOnInvalidate(queryClient);

    act(() => {
      rt()
        .channelByPrefix(CHANNEL_PREFIX)
        ?.emitPostgres("notifications", {
          eventType: "INSERT",
          new: notificationRow({ kind: "system" }),
        });
    });

    expect(invalidatedKeys(spy)).toEqual([["notifications"], COUNT_KEY]);
    unmount();
  });

  it("DELETE (puste `new`) NIE sięga do mapy rodzajów", () => {
    // Przy DELETE Supabase przysyła pusty `new`. Odczyt `kind` z pustego
    // obiektu musi skończyć się cichym wyjściem, a nie wywołaniem mapy
    // z `undefined` - to jest gałąź, którą łatwo zgubić przy refaktorze.
    const { queryClient, unmount } = renderHookWithQueryClient(() => useNotificationsRealtime());
    const spy = spyOnInvalidate(queryClient);

    act(() => {
      rt()
        .channelByPrefix(CHANNEL_PREFIX)
        ?.emitPostgres("notifications", { eventType: "DELETE", new: {}, old: { id: "n-1" } });
    });

    expect(invalidatedKeys(spy)).toEqual([["notifications"], COUNT_KEY]);
    unmount();
  });

  it("ODMONTOWANIE zwalnia kanał - refcount hubu wraca do zera", () => {
    // Kanały są zliczane referencyjnie w stanie MODUŁOWYM. Zgubiony
    // `removeChannel` nie psuje żadnego widoku od razu: dopiero po kilku
    // przejściach między trasami kończy się limit kanałów i zdarzenia
    // przestają przychodzić w ogóle.
    const { unmount } = renderHookWithQueryClient(() => useNotificationsRealtime());
    const channel = rt().channelByPrefix(CHANNEL_PREFIX);
    expect(activeChannelCount()).toBe(1);

    unmount();
    expect(channel?.removed).toBe(true);
    expect(activeChannelCount()).toBe(0);
    expect(rt().liveChannels(CHANNEL_PREFIX)).toHaveLength(0);
  });

  it("DWÓCH konsumentów dzieli JEDEN kanał websocketowy", () => {
    // Dzwonek, skrzynka i /messages montują ten sam hook. Kanał per konsument
    // zwielokrotniłby ruch i szybciej domknął limit po stronie Supabase.
    const { unmount } = renderHookWithQueryClient(() => {
      useNotificationsRealtime();
      useNotificationsRealtime();
    });

    expect(activeChannelCount()).toBe(1);
    expect(rt().liveChannels(CHANNEL_PREFIX)).toHaveLength(1);
    unmount();
    expect(activeChannelCount()).toBe(0);
  });
});

describe("useNotificationPreferencesRealtime", () => {
  const CHANNEL_PREFIX = "hub:public|notification_preferences|";

  it("subskrybuje własny wiersz preferencji przez filtr `user_id=eq.<uid>`", () => {
    const { unmount } = renderHookWithQueryClient(() => useNotificationPreferencesRealtime());

    expect(rt().channelByPrefix(CHANNEL_PREFIX)?.listeners[0]?.filter).toEqual({
      event: "*",
      schema: "public",
      table: "notification_preferences",
      filter: `user_id=eq.${UID}`,
    });
    unmount();
  });

  it("zmiana wiersza unieważnia WYŁĄCZNIE klucz preferencji", () => {
    // Przełącznik zmieniony w innej karcie ma dojechać tutaj bez F5, ale nie
    // ma powodu przeładowywać całej skrzynki ani licznika.
    const { queryClient, unmount } = renderHookWithQueryClient(() =>
      useNotificationPreferencesRealtime(),
    );
    const spy = spyOnInvalidate(queryClient);

    act(() => {
      rt()
        .channelByPrefix(CHANNEL_PREFIX)
        ?.emitPostgres("notification_preferences", {
          eventType: "UPDATE",
          new: { user_id: UID, enabled_message: false },
        });
    });

    expect(invalidatedKeys(spy)).toEqual([PREFS_KEY]);
    unmount();
  });

  it("NIE zakłada kanału bez zalogowanego użytkownika", () => {
    h.auth.uid = null;
    const { unmount } = renderHookWithQueryClient(() => useNotificationPreferencesRealtime());

    expect(rt().channels).toHaveLength(0);
    unmount();
  });

  it("ODMONTOWANIE zwalnia kanał preferencji", () => {
    const { unmount } = renderHookWithQueryClient(() => useNotificationPreferencesRealtime());
    const channel = rt().channelByPrefix(CHANNEL_PREFIX);
    expect(activeChannelCount()).toBe(1);

    unmount();
    expect(channel?.removed).toBe(true);
    expect(activeChannelCount()).toBe(0);
  });
});
