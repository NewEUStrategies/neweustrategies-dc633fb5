// HOOKI POPUPÓW BUILDERA - warstwa danych, której nikt dotąd nie wywołał.
//
// CO TU JEST PRZEDMIOTEM DOWODU. `popups.test.ts` obok trzyma reguły czyste
// (parsowanie ustawień, dopasowanie ścieżek, karencja). Ten plik dotyka trzech
// funkcji, które w produkcji DECYDUJĄ, czy odwiedzający zobaczy modal i czy
// praca redaktora dojedzie do bazy, a które nie miały ani jednego wywołania:
//
//   1. `useActivePopups` - jedyne źródło popupów dla publicznego hosta.
//      Zapytanie MUSI filtrować `status = "active"`, bo szkic ("draft") lub
//      archiwum wyświetlone anonimowemu odwiedzającemu to publikacja treści,
//      której nikt nie zatwierdził. Błąd bazy MUSI dawać pustą listę, a nie
//      wyjątek - awaria odczytu popupu nie może wywrócić strony publicznej.
//   2. `usePopupsAdmin` - lista i mutacje panelu. Każda mutacja MUSI unieważnić
//      trzy korzenie cache i rozesłać sygnał między kartami; bez tego redaktor
//      widzi po zapisie stan sprzed zmiany i "poprawia" go drugi raz.
//   3. `usePopupEditor` - zapis pojedynczego popupu. Pusty patch NIE MOŻE
//      wysyłać UPDATE (nadpisanie niczym też jest zapisem), a nieudany zapis
//      NIE MOŻE unieważniać cache, bo wtedy edytor pokazałby dane serwera jako
//      "zapisane" i praca redaktora zniknęłaby z ekranu bez śladu.
//
// DETERMINIZM. Czas jest ZAMROŻONY na 2026-08-22T10:00:00Z (`toFake: ["Date"]`
// - liczniki `waitFor` zostają prawdziwe, patrz clubNetworkScreens.test.tsx).
// Reguły karencji liczą się z `Date.now()`, więc bez zamrożenia test
// przechodziłby dziś i padał jutro.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { RecordedChain, SupabaseFromStub, SupabaseResult } from "@/test/supabaseChain";

/** Zamrożona teraźniejszość - wszystkie terminy liczą się względem niej. */
const NOW_ISO = "2026-08-22T10:00:00.000Z";
const NOW_MS = Date.parse(NOW_ISO);
const DAY_MS = 86_400_000;

const h = vi.hoisted(() => ({
  db: null as SupabaseFromStub | null,
  /** `null` = jeszcze nie wiemy, w którym obszarze roboczym jesteśmy. */
  tenantId: null as string | null,
  /** Sesja oddawana przez `supabase.auth.getSession()`. */
  session: null as { user: { id: string } } | null,
  emitInvalidate: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (!h.db) throw new Error("test: atrapa bazy nie została zainicjalizowana");
      return h.db.from(table);
    },
    auth: {
      getSession: async () => ({ data: { session: h.session }, error: null }),
    },
  },
}));

// Podmieniamy WYŁĄCZNIE hook tenanta - jego droga do `profiles` ma własny test,
// a tutaj liczy się to, co warstwa popupów robi ze stanem "tenant nieznany".
vi.mock("@/lib/tenant", () => ({
  useCurrentTenantId: () => h.tenantId,
}));

// Sygnał między kartami jest zdarzeniem `window`; atrapa pozwala sprawdzić, czy
// w ogóle poszedł, bez nasłuchiwania na globalnym obiekcie.
vi.mock("@/lib/builder/widgetCacheInvalidation", () => ({
  emitWidgetCacheInvalidate: h.emitInvalidate,
}));

import { fail, ok, supabaseFromStub } from "@/test/supabaseChain";
import { WIDGET_QUERY_ROOTS } from "@/lib/builder/queryKeys";
import {
  isPopupFrequencyOk,
  markPopupDismissed,
  parsePopupSettings,
  useActivePopups,
  usePopupEditor,
  usePopupsAdmin,
  type BuilderPopup,
} from "@/lib/builder/popups";

const TABLE = "builder_popups";
const TENANT = "11111111-1111-4111-8111-111111111111";

function db(): SupabaseFromStub {
  const stub = h.db;
  if (stub === null) throw new Error("test: atrapa bazy nie została zainicjalizowana");
  return stub;
}

/** Wiersz w kształcie, jaki oddaje PostgREST dla `POPUP_COLUMNS`. */
function popupRow(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: "pop-1",
    name: "Zapis do newslettera",
    status: "active",
    builder_data: { version: 1, sections: [] },
    settings: { trigger: "delay", frequencyDays: 7 },
    created_at: NOW_ISO,
    updated_at: NOW_ISO,
    ...over,
  };
}

/**
 * Jedna odpowiedź dla tabeli popupów rozdzielana po OGNIWIE łańcucha: lista,
 * insert (`.select("id").single()`), update i delete idą tą samą tabelą.
 */
function respondPopups(parts: {
  list?: SupabaseResult;
  single?: SupabaseResult;
  write?: SupabaseResult;
}) {
  db().setResponse(TABLE, (chain: RecordedChain) => {
    if (chain.has("insert")) return parts.single ?? ok({ id: "pop-new" });
    if (chain.has("update") || chain.has("delete")) return parts.write ?? ok(null);
    return parts.list ?? ok([]);
  });
}

function harness() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, invalidateSpy, wrapper };
}

/** Wywołania szpiega w kształcie, którego dotyczy odczyt klucza cache. */
type InvalidateSpy = { mock: { calls: ReadonlyArray<ReadonlyArray<unknown>> } };

/** Klucze cache, w które trafiło unieważnienie (pierwszy człon każdego klucza). */
function invalidatedRoots(spy: InvalidateSpy): string[] {
  return spy.mock.calls
    .map((call) => {
      const arg = call[0] as { queryKey?: unknown } | undefined;
      const key = Array.isArray(arg?.queryKey) ? arg.queryKey : [];
      return typeof key[0] === "string" ? key[0] : "";
    })
    .filter(Boolean);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW_ISO));
  h.db = supabaseFromStub();
  h.tenantId = TENANT;
  h.session = { user: { id: "user-9" } };
  h.emitInvalidate.mockClear();
  window.localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  h.db?.reset();
});

// ---------------------------------------------------------------------------
describe("useActivePopups - co zobaczy anonimowy odwiedzający", () => {
  it("bez włączenia hosta nie pyta bazy w ogóle", async () => {
    const { wrapper } = harness();
    const view = renderHook(() => useActivePopups(false), { wrapper });

    await waitFor(() => expect(view.result.current.fetchStatus).toBe("idle"));
    expect(db().chainsFor(TABLE)).toHaveLength(0);
    expect(view.result.current.data).toBeUndefined();
  });

  it("dopóki odpowiedź nie wróci, host nie ma czego pokazać", () => {
    respondPopups({ list: ok([popupRow()]) });
    const { wrapper } = harness();
    const view = renderHook(() => useActivePopups(true), { wrapper });

    expect(view.result.current.isLoading).toBe(true);
    expect(view.result.current.data).toBeUndefined();
  });

  it("pusta tabela daje pustą listę, a nie brak wyniku", async () => {
    respondPopups({ list: ok([]) });
    const { wrapper } = harness();
    const view = renderHook(() => useActivePopups(true), { wrapper });

    await waitFor(() => expect(view.result.current.data).toEqual([]));
  });

  it("czyta wyłącznie popupy aktywne, najnowsze najpierw i najwyżej dwadzieścia", async () => {
    respondPopups({ list: ok([popupRow()]) });
    const { wrapper } = harness();
    const view = renderHook(() => useActivePopups(true), { wrapper });

    await waitFor(() => expect(view.result.current.data).toHaveLength(1));
    const chain = db().lastChain(TABLE);
    // Szkic wyświetlony anonimowemu odwiedzającemu to publikacja bez akceptacji.
    expect(chain?.argsOf("eq")).toEqual(["status", "active"]);
    expect(chain?.argsOf("order")).toEqual(["created_at", { ascending: false }]);
    expect(chain?.argsOf("limit")).toEqual([20]);
  });

  it("popup dojeżdża z rozparsowanym dokumentem i pełnymi ustawieniami", async () => {
    respondPopups({
      list: ok([popupRow({ builder_data: "nie-dokument", settings: { trigger: "scroll" } })]),
    });
    const { wrapper } = harness();
    const view = renderHook(() => useActivePopups(true), { wrapper });

    await waitFor(() => expect(view.result.current.data).toHaveLength(1));
    const popup = view.result.current.data?.[0] as BuilderPopup;
    // Zepsuty dokument daje pusty szkielet, a nie wyjątek w renderze modalu.
    expect(popup.builder_data).toEqual({ version: 1, sections: [] });
    expect(popup.settings.trigger).toBe("scroll");
    // Reszta ustawień jest uzupełniona domyślnymi - host nie czyta `undefined`.
    expect(popup.settings.frequencyDays).toBe(7);
    expect(popup.settings.devices).toEqual({ desktop: true, tablet: true, mobile: true });
  });

  it("nieznany status wiersza schodzi do szkicu, znane statusy przechodzą wprost", async () => {
    respondPopups({
      list: ok([
        popupRow({ id: "a", status: "active" }),
        popupRow({ id: "b", status: "archived" }),
        popupRow({ id: "c", status: "cokolwiek" }),
      ]),
    });
    const { wrapper } = harness();
    const view = renderHook(() => useActivePopups(true), { wrapper });

    await waitFor(() => expect(view.result.current.data).toHaveLength(3));
    expect(view.result.current.data?.map((p) => p.status)).toEqual(["active", "archived", "draft"]);
  });

  it("odmowa bazy nie wywraca strony publicznej - lista jest pusta", async () => {
    respondPopups({ list: fail("permission denied for table builder_popups", "42501") });
    const { wrapper } = harness();
    const view = renderHook(() => useActivePopups(true), { wrapper });

    await waitFor(() => expect(view.result.current.isSuccess).toBe(true));
    expect(view.result.current.data).toEqual([]);
    expect(view.result.current.error).toBeNull();
  });

  it("null zamiast tablicy też daje pustą listę", async () => {
    respondPopups({ list: ok(null) });
    const { wrapper } = harness();
    const view = renderHook(() => useActivePopups(true), { wrapper });

    await waitFor(() => expect(view.result.current.data).toEqual([]));
  });

  it("popup wyłączony w trakcie sesji znika po odświeżeniu, a nie dopiero po przeładowaniu", async () => {
    respondPopups({ list: ok([popupRow({ id: "pop-1" })]) });
    const { wrapper } = harness();
    const view = renderHook(() => useActivePopups(true), { wrapper });

    await waitFor(() => expect(view.result.current.data).toHaveLength(1));

    // Redaktor archiwizuje popup w innej karcie - RLS przestaje go oddawać.
    respondPopups({ list: ok([]) });
    await act(async () => {
      await view.result.current.refetch();
    });

    await waitFor(() => expect(view.result.current.data).toEqual([]));
  });
});

// ---------------------------------------------------------------------------
describe("usePopupsAdmin - lista i mutacje panelu", () => {
  it("dopóki obszar roboczy nie jest znany, panel nie pyta bazy i nie kręci spinnerem", async () => {
    h.tenantId = null;
    respondPopups({ list: ok([popupRow()]) });
    const { wrapper } = harness();
    const view = renderHook(() => usePopupsAdmin(), { wrapper });

    await waitFor(() => expect(view.result.current.loading).toBe(false));
    expect(view.result.current.items).toEqual([]);
    expect(db().chainsFor(TABLE)).toHaveLength(0);
  });

  it("lista jest zawężona do obszaru roboczego i uporządkowana od najnowszych", async () => {
    respondPopups({ list: ok([popupRow()]) });
    const { wrapper } = harness();
    const view = renderHook(() => usePopupsAdmin(), { wrapper });

    await waitFor(() => expect(view.result.current.items).toHaveLength(1));
    const chain = db().lastChain(TABLE);
    // Filtr po tenancie jest DRUGĄ bramką obok RLS - chroni przed pomyłką klucza cache.
    expect(chain?.argsOf("eq")).toEqual(["tenant_id", TENANT]);
    expect(chain?.argsOf("limit")).toEqual([200]);
  });

  it("null zamiast tablicy nie wywraca listy panelu", async () => {
    respondPopups({ list: ok(null) });
    const { wrapper } = harness();
    const view = renderHook(() => usePopupsAdmin(), { wrapper });

    await waitFor(() => expect(view.result.current.loading).toBe(false));
    expect(view.result.current.items).toEqual([]);
  });

  it("odmowa bazy zostawia panel z pustą listą zamiast z cudzymi danymi", async () => {
    respondPopups({ list: fail("permission denied", "42501") });
    const { wrapper } = harness();
    const view = renderHook(() => usePopupsAdmin(), { wrapper });

    await waitFor(() => expect(view.result.current.loading).toBe(false));
    expect(view.result.current.items).toEqual([]);
  });

  it("nowy popup dostaje pusty dokument, domyślne ustawienia i autora z sesji", async () => {
    respondPopups({ list: ok([]), single: ok({ id: "pop-new" }) });
    const { wrapper, invalidateSpy } = harness();
    const view = renderHook(() => usePopupsAdmin(), { wrapper });
    await waitFor(() => expect(view.result.current.loading).toBe(false));

    let created: string | null = null;
    await act(async () => {
      created = await view.result.current.create("Wiosenna kampania");
    });

    expect(created).toBe("pop-new");
    const insert = db()
      .chainsFor(TABLE)
      .find((c) => c.has("insert"));
    const payload = insert?.argsOf("insert")?.[0] as Record<string, unknown>;
    expect(payload.name).toBe("Wiosenna kampania");
    expect(payload.builder_data).toEqual({ version: 1, sections: [] });
    expect(payload.created_by).toBe("user-9");
    expect((payload.settings as { frequencyDays: number }).frequencyDays).toBe(7);
    // Bez unieważnienia redaktor wróciłby na listę bez świeżo utworzonego popupu.
    expect(invalidatedRoots(invalidateSpy)).toEqual(
      expect.arrayContaining([
        "builder-popups-admin",
        WIDGET_QUERY_ROOTS.popupsActive,
        "builder-popup",
      ]),
    );
    expect(h.emitInvalidate).toHaveBeenCalled();
  });

  it("bez sesji autor zostaje pusty, a popup i tak powstaje", async () => {
    h.session = null;
    respondPopups({ list: ok([]), single: ok({ id: "pop-new" }) });
    const { wrapper } = harness();
    const view = renderHook(() => usePopupsAdmin(), { wrapper });
    await waitFor(() => expect(view.result.current.loading).toBe(false));

    await act(async () => {
      await view.result.current.create("Bez autora");
    });

    const insert = db()
      .chainsFor(TABLE)
      .find((c) => c.has("insert"));
    expect((insert?.argsOf("insert")?.[0] as Record<string, unknown>).created_by).toBeNull();
  });

  it("odrzucony zapis nie udaje sukcesu i nie czyści cache", async () => {
    respondPopups({ list: ok([]), single: fail("duplicate key value", "23505") });
    const { wrapper, invalidateSpy } = harness();
    const view = renderHook(() => usePopupsAdmin(), { wrapper });
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    invalidateSpy.mockClear();

    let created: string | null = "coś";
    await act(async () => {
      created = await view.result.current.create("Duplikat");
    });

    // `null` to jedyny sygnał dla panelu, że nie ma dokąd nawigować.
    expect(created).toBeNull();
    expect(invalidatedRoots(invalidateSpy)).toEqual([]);
    expect(h.emitInvalidate).not.toHaveBeenCalled();
  });

  it("zmiana statusu trafia w jeden popup po identyfikatorze", async () => {
    respondPopups({ list: ok([]) });
    const { wrapper, invalidateSpy } = harness();
    const view = renderHook(() => usePopupsAdmin(), { wrapper });
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    invalidateSpy.mockClear();

    await act(async () => {
      await view.result.current.setStatus("pop-1", "archived");
    });

    const chain = db()
      .chainsFor(TABLE)
      .find((c) => c.has("update"));
    expect(chain?.argsOf("update")).toEqual([{ status: "archived" }]);
    expect(chain?.argsOf("eq")).toEqual(["id", "pop-1"]);
    expect(invalidatedRoots(invalidateSpy)).toContain(WIDGET_QUERY_ROOTS.popupsActive);
  });

  it("zmiana nazwy nie dotyka pozostałych kolumn", async () => {
    respondPopups({ list: ok([]) });
    const { wrapper } = harness();
    const view = renderHook(() => usePopupsAdmin(), { wrapper });
    await waitFor(() => expect(view.result.current.loading).toBe(false));

    await act(async () => {
      await view.result.current.rename("pop-1", "Nowa nazwa");
    });

    const chain = db()
      .chainsFor(TABLE)
      .find((c) => c.has("update"));
    expect(chain?.argsOf("update")).toEqual([{ name: "Nowa nazwa" }]);
  });

  it("usunięcie kasuje dokładnie jeden wiersz i odświeża publiczną listę", async () => {
    respondPopups({ list: ok([]) });
    const { wrapper, invalidateSpy } = harness();
    const view = renderHook(() => usePopupsAdmin(), { wrapper });
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    invalidateSpy.mockClear();

    await act(async () => {
      await view.result.current.remove("pop-1");
    });

    const chain = db()
      .chainsFor(TABLE)
      .find((c) => c.has("delete"));
    expect(chain?.argsOf("eq")).toEqual(["id", "pop-1"]);
    // Bez tego usunięty popup dalej wyskakiwałby odwiedzającym z cache.
    expect(invalidatedRoots(invalidateSpy)).toContain(WIDGET_QUERY_ROOTS.popupsActive);
  });

  it("kopia zachowuje treść i ustawienia oryginału, a nazwę oznacza jako kopię", async () => {
    respondPopups({ list: ok([]), single: ok({ id: "pop-copy" }) });
    const { wrapper } = harness();
    const view = renderHook(() => usePopupsAdmin(), { wrapper });
    await waitFor(() => expect(view.result.current.loading).toBe(false));

    const source: BuilderPopup = {
      id: "pop-1",
      name: "Kampania",
      status: "active",
      builder_data: { version: 1, sections: [] },
      settings: { ...parsePopupSettings({ frequencyDays: 3 }) },
      created_at: NOW_ISO,
      updated_at: NOW_ISO,
    };
    let copied: string | null = null;
    await act(async () => {
      copied = await view.result.current.duplicate(source);
    });

    expect(copied).toBe("pop-copy");
    const insert = db()
      .chainsFor(TABLE)
      .find((c) => c.has("insert"));
    const payload = insert?.argsOf("insert")?.[0] as Record<string, unknown>;
    expect(payload.name).toBe("Kampania (kopia)");
    expect((payload.settings as { frequencyDays: number }).frequencyDays).toBe(3);
  });

  it("kopia bez sesji powstaje bez autora, zamiast paść na braku użytkownika", async () => {
    h.session = null;
    respondPopups({ list: ok([]), single: ok({ id: "pop-copy" }) });
    const { wrapper } = harness();
    const view = renderHook(() => usePopupsAdmin(), { wrapper });
    await waitFor(() => expect(view.result.current.loading).toBe(false));

    const source: BuilderPopup = {
      id: "pop-1",
      name: "Kampania",
      status: "active",
      builder_data: { version: 1, sections: [] },
      settings: parsePopupSettings(null),
      created_at: NOW_ISO,
      updated_at: NOW_ISO,
    };
    await act(async () => {
      await view.result.current.duplicate(source);
    });

    const insert = db()
      .chainsFor(TABLE)
      .find((c) => c.has("insert"));
    expect((insert?.argsOf("insert")?.[0] as Record<string, unknown>).created_by).toBeNull();
  });

  it("nieudana kopia nie zostawia panelu z identyfikatorem, którego nie ma", async () => {
    respondPopups({ list: ok([]), single: fail("insert or update violates", "23503") });
    const { wrapper } = harness();
    const view = renderHook(() => usePopupsAdmin(), { wrapper });
    await waitFor(() => expect(view.result.current.loading).toBe(false));

    const source: BuilderPopup = {
      id: "pop-1",
      name: "Kampania",
      status: "draft",
      builder_data: { version: 1, sections: [] },
      settings: parsePopupSettings(null),
      created_at: NOW_ISO,
      updated_at: NOW_ISO,
    };
    let copied: string | null = "coś";
    await act(async () => {
      copied = await view.result.current.duplicate(source);
    });

    expect(copied).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("usePopupEditor - zapis pojedynczego popupu", () => {
  it("bez identyfikatora edytor nie pyta bazy i nie ma popupu", async () => {
    const { wrapper } = harness();
    const view = renderHook(() => usePopupEditor(null), { wrapper });

    await waitFor(() => expect(view.result.current.loading).toBe(false));
    expect(view.result.current.popup).toBeNull();
    expect(db().chainsFor(TABLE)).toHaveLength(0);
  });

  it("odczyt jest zawężony i po tenancie, i po identyfikatorze", async () => {
    db().setResponse(TABLE, () => ok(popupRow({ id: "pop-7", name: "Edytowany" })));
    const { wrapper } = harness();
    const view = renderHook(() => usePopupEditor("pop-7"), { wrapper });

    await waitFor(() => expect(view.result.current.popup?.name).toBe("Edytowany"));
    const chain = db().lastChain(TABLE);
    expect(chain?.calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([
      ["tenant_id", TENANT],
      ["id", "pop-7"],
    ]);
    expect(chain?.has("maybeSingle")).toBe(true);
  });

  it("popup spoza obszaru roboczego jest nieodróżnialny od nieistniejącego", async () => {
    db().setResponse(TABLE, () => ok(null));
    const { wrapper } = harness();
    const view = renderHook(() => usePopupEditor("pop-obcy"), { wrapper });

    await waitFor(() => expect(view.result.current.loading).toBe(false));
    expect(view.result.current.popup).toBeNull();
  });

  it("odmowa odczytu nie podstawia pustego popupu pod edycję", async () => {
    db().setResponse(TABLE, () => fail("permission denied", "42501"));
    const { wrapper } = harness();
    const view = renderHook(() => usePopupEditor("pop-7"), { wrapper });

    await waitFor(() => expect(view.result.current.loading).toBe(false));
    expect(view.result.current.popup).toBeNull();
  });

  it("zapis bez identyfikatora zwraca porażkę zamiast cicho przejść", async () => {
    const { wrapper } = harness();
    const view = renderHook(() => usePopupEditor(null), { wrapper });

    let saved = true;
    await act(async () => {
      saved = await view.result.current.save({ name: "Cokolwiek" });
    });

    expect(saved).toBe(false);
    expect(db().chainsFor(TABLE)).toHaveLength(0);
  });

  it("pusty patch nie wysyła UPDATE - nadpisanie niczym też jest zapisem", async () => {
    db().setResponse(TABLE, () => ok(popupRow()));
    const { wrapper, invalidateSpy } = harness();
    const view = renderHook(() => usePopupEditor("pop-1"), { wrapper });
    await waitFor(() => expect(view.result.current.popup).not.toBeNull());
    invalidateSpy.mockClear();

    let saved = false;
    await act(async () => {
      saved = await view.result.current.save({});
    });

    expect(saved).toBe(true);
    expect(
      db()
        .chainsFor(TABLE)
        .some((c) => c.has("update")),
    ).toBe(false);
    expect(invalidatedRoots(invalidateSpy)).toEqual([]);
  });

  it("zapis niesie dokładnie te pola, które redaktor zmienił", async () => {
    db().setResponse(TABLE, () => ok(popupRow()));
    const { wrapper } = harness();
    const view = renderHook(() => usePopupEditor("pop-1"), { wrapper });
    await waitFor(() => expect(view.result.current.popup).not.toBeNull());

    await act(async () => {
      await view.result.current.save({ name: "Po zmianie", status: "active" });
    });

    const chain = db()
      .chainsFor(TABLE)
      .find((c) => c.has("update"));
    expect(chain?.argsOf("update")).toEqual([{ name: "Po zmianie", status: "active" }]);
    expect(chain?.argsOf("eq")).toEqual(["id", "pop-1"]);
  });

  it("zapis dokumentu i ustawień idzie do bazy jako JSON, nie jako instancja klasy", async () => {
    db().setResponse(TABLE, () => ok(popupRow()));
    const { wrapper, invalidateSpy } = harness();
    const view = renderHook(() => usePopupEditor("pop-1"), { wrapper });
    await waitFor(() => expect(view.result.current.popup).not.toBeNull());
    invalidateSpy.mockClear();

    const settings = parsePopupSettings({ frequencyDays: 30, trigger: "exit-intent" });
    await act(async () => {
      await view.result.current.save({
        builder_data: { version: 1, sections: [] },
        settings,
      });
    });

    const chain = db()
      .chainsFor(TABLE)
      .find((c) => c.has("update"));
    const payload = chain?.argsOf("update")?.[0] as Record<string, unknown>;
    expect(payload.builder_data).toEqual({ version: 1, sections: [] });
    expect((payload.settings as { trigger: string }).trigger).toBe("exit-intent");
    // Trzy korzenie: edytor, lista panelu i to, co widzi odwiedzający.
    expect(invalidatedRoots(invalidateSpy)).toEqual(
      expect.arrayContaining([
        "builder-popup",
        "builder-popups-admin",
        WIDGET_QUERY_ROOTS.popupsActive,
      ]),
    );
    expect(h.emitInvalidate).toHaveBeenCalled();
  });

  it("odrzucony zapis nie unieważnia cache - inaczej praca redaktora znika z ekranu", async () => {
    db().setResponse(TABLE, (chain: RecordedChain) =>
      chain.has("update") ? fail("permission denied", "42501") : ok(popupRow()),
    );
    const { wrapper, invalidateSpy } = harness();
    const view = renderHook(() => usePopupEditor("pop-1"), { wrapper });
    await waitFor(() => expect(view.result.current.popup).not.toBeNull());
    invalidateSpy.mockClear();
    h.emitInvalidate.mockClear();

    let saved = true;
    await act(async () => {
      saved = await view.result.current.save({ name: "Nie przejdzie" });
    });

    expect(saved).toBe(false);
    expect(invalidatedRoots(invalidateSpy)).toEqual([]);
    expect(h.emitInvalidate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Reguły terminów liczone na ZAMROŻONEJ dacie - bez tego test przeszedłby dziś
// i padł jutro. `popups.test.ts` sprawdza szczęśliwy przebieg; tu chodzi
// o przypadki, w których popup wyskakuje ODWIEDZAJĄCEMU, który go już odrzucił.
describe("karencja popupu na zamrożonej dacie 2026-08-22", () => {
  it("popup odrzucony wczoraj nie wraca przed upływem siedmiu dni", () => {
    window.localStorage.setItem("cms_popup_last:pop-1", String(NOW_MS - DAY_MS));
    expect(isPopupFrequencyOk("pop-1", 7)).toBe(false);
  });

  it("popup po terminie karencji wraca dokładnie raz - dzień po oknie", () => {
    window.localStorage.setItem("cms_popup_last:pop-1", String(NOW_MS - 8 * DAY_MS));
    expect(isPopupFrequencyOk("pop-1", 7)).toBe(true);
  });

  it("moment zamknięcia jest zapisany zamrożonym zegarem, nie zegarem maszyny CI", () => {
    markPopupDismissed("pop-1");
    expect(window.localStorage.getItem("cms_popup_last:pop-1")).toBe(String(NOW_MS));
  });

  it("uszkodzony znacznik czasu przepuszcza popup zamiast go zablokować na zawsze", () => {
    // Wartość spoza formatu (ręczna edycja, migracja, inny build) nie może
    // trwale wyciszyć popupu - lepszy jeden pokaz za dużo niż nigdy.
    window.localStorage.setItem("cms_popup_last:pop-1", "wczoraj-po-południu");
    expect(isPopupFrequencyOk("pop-1", 7)).toBe(true);
  });

  it("zablokowany magazyn przeglądarki nie blokuje popupu", () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("SecurityError: storage is disabled");
    });
    expect(isPopupFrequencyOk("pop-1", 7)).toBe(true);
  });

  it("zablokowany magazyn nie wywala zamknięcia popupu", () => {
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => markPopupDismissed("pop-1")).not.toThrow();
  });

  it("na serwerze popup nie jest pokazywany - o karencji decyduje przeglądarka", () => {
    // Render serwerowy nie ma localStorage; gdyby funkcja zwracała `true`,
    // SSR wypluwałby modal każdemu, kto już go kiedyś zamknął.
    vi.stubGlobal("window", undefined);
    try {
      expect(isPopupFrequencyOk("pop-1", 7, NOW_MS)).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

// ---------------------------------------------------------------------------
describe("parsePopupSettings - kolor przesłony", () => {
  it("pusty lub nietekstowy kolor przesłony wraca do domyślnego przyciemnienia", () => {
    // Pusty string dałby przezroczystą przesłonę - modal bez tła nad treścią.
    expect(parsePopupSettings({ overlayColor: "" }).overlayColor).toBe("rgba(0,0,0,0.7)");
    expect(parsePopupSettings({ overlayColor: 0 }).overlayColor).toBe("rgba(0,0,0,0.7)");
    expect(parsePopupSettings({ overlayColor: "#000a" }).overlayColor).toBe("#000a");
  });
});
