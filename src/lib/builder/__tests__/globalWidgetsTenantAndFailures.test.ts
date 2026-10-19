// WIDGETY GLOBALNE - najemca z sesji i rozróżnialne porażki (kontrakty
// wprowadzone 2026-10-18 przy naprawie dawnych `it.fails`).
//
// Siostrzany globalWidgets.test.ts pilnuje reguł czystych, kształtu zapytań
// i porażek. Ten plik domyka to, czego tam nie ma:
//   1. SUKCES MUTACJI JEST WYNIKIEM. `rename`/`remove` oddają `true` i dopiero
//      wtedy unieważniają cache - bez tego panel nie odróżni sukcesu od odmowy.
//   2. BEZ NAJEMCY ŻADNA MUTACJA NIE LECI. Lista jest w tym stanie wyłączona,
//      więc zapis w ciemno trafiłby w obszar roboczy, którego kod nie zna.
//   3. NIEUDANY REFETCH NIE KASUJE DOBRYCH DANYCH. Odkąd błąd odczytu jest
//      błędem zapytania (a nie sukcesem `null`), React Query trzyma ostatni
//      poprawny payload - instancje nie wracają do starej migawki po jednej
//      mignięciu sieci.
//
// Granice: atrapa klienta Supabase (@/test/supabase), atrapa hooka najemcy
// i sygnału między kartami; prawdziwy QueryClient bez ponowień.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { RecordedChain, SupabaseFromStub, SupabaseResult } from "@/test/supabase";

const h = vi.hoisted(() => ({
  db: null as SupabaseFromStub | null,
  tenantId: null as string | null,
  emitInvalidate: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (!h.db) throw new Error("test: atrapa bazy nie zostala zainicjalizowana");
      return h.db.from(table);
    },
    auth: {
      getSession: async () => ({ data: { session: { user: { id: "user-9" } } }, error: null }),
    },
  },
}));

vi.mock("@/lib/tenant", () => ({
  useCurrentTenantId: () => h.tenantId,
}));

vi.mock("@/lib/builder/widgetCacheInvalidation", () => ({
  emitWidgetCacheInvalidate: h.emitInvalidate,
}));

import { fail, ok, supabaseFromStub } from "@/test/supabase";
import { globalWidgetKey, useGlobalWidgetNode, useGlobalWidgets } from "../globalWidgets";
import type { WidgetNode } from "../types";

const TABLE = "builder_global_widgets";
const TENANT = "11111111-1111-4111-8111-111111111111";
const GID = "g1";

const widget: WidgetNode = {
  id: "w1",
  kind: "widget",
  type: "button",
  content: { label_pl: "Kup" },
};

function db(): SupabaseFromStub {
  if (!h.db) throw new Error("test: atrapa bazy nie zostala zainicjalizowana");
  return h.db;
}

function respond(parts: { list?: SupabaseResult; row?: SupabaseResult; write?: SupabaseResult }) {
  db().setResponse(TABLE, (chain: RecordedChain) => {
    if (chain.has("insert")) return parts.write ?? ok({ id: "g-new" });
    if (chain.has("update") || chain.has("delete")) return parts.write ?? ok(null);
    if (chain.has("maybeSingle")) return parts.row ?? ok(null);
    return parts.list ?? ok([]);
  });
}

function harness() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  return { client, invalidateSpy, wrapper };
}

beforeEach(() => {
  h.db = supabaseFromStub();
  h.tenantId = TENANT;
  h.emitInvalidate.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
  h.db?.reset();
});

describe("useGlobalWidgets - wynik mutacji", () => {
  it("udana zmiana nazwy i usunięcie oddają true i odświeżają widoki", async () => {
    respond({ list: ok([]), write: ok(null) });
    const { wrapper, invalidateSpy } = harness();
    const view = renderHook(() => useGlobalWidgets(), { wrapper });
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    invalidateSpy.mockClear();

    const wyniki: boolean[] = [];
    await act(async () => {
      wyniki.push(await view.result.current.rename(GID, "Stopka 2026"));
      wyniki.push(await view.result.current.remove(GID));
    });

    expect(wyniki).toEqual([true, true]);
    // Trzy korzenie cache na każdą z dwóch udanych mutacji + sygnał między kartami.
    expect(invalidateSpy).toHaveBeenCalledTimes(6);
    expect(h.emitInvalidate).toHaveBeenCalledTimes(2);
  });

  it("bez znanego najemcy zapis, zmiana nazwy i usunięcie odmawiają bez zapytania", async () => {
    h.tenantId = null;
    respond({ list: ok([]), write: ok(null) });
    const { wrapper, invalidateSpy } = harness();
    const view = renderHook(() => useGlobalWidgets(), { wrapper });
    await waitFor(() => expect(view.result.current.loading).toBe(false));

    let zapis: string | null = "nie-ustawione";
    const wyniki: boolean[] = [];
    await act(async () => {
      zapis = await view.result.current.save("Zapis w ciemno", widget);
      wyniki.push(await view.result.current.rename(GID, "Nowa"));
      wyniki.push(await view.result.current.remove(GID));
    });

    expect(zapis).toBeNull();
    expect(wyniki).toEqual([false, false]);
    expect(db().chainsFor(TABLE)).toHaveLength(0);
    expect(invalidateSpy).not.toHaveBeenCalled();
    expect(h.emitInvalidate).not.toHaveBeenCalled();
  });

  it("insert bez zwróconego wiersza (i bez błędu) jest porażką, a nie id `undefined`", async () => {
    respond({ list: ok([]), write: ok(null) });
    const { wrapper } = harness();
    const view = renderHook(() => useGlobalWidgets(), { wrapper });
    await waitFor(() => expect(view.result.current.loading).toBe(false));

    let zapis: string | null = "nie-ustawione";
    await act(async () => {
      zapis = await view.result.current.save("Pusty wynik", widget);
    });

    expect(zapis).toBeNull();
    expect(h.emitInvalidate).not.toHaveBeenCalled();
  });
});

describe("useGlobalWidgetNode - nieudane odświeżenie", () => {
  it("odmowa przy odświeżeniu zostawia ostatni poprawny payload zamiast migawki", async () => {
    let odmowa = false;
    db().setResponse(TABLE, () =>
      odmowa
        ? fail("connection reset", "08006")
        : ok({ data: { type: "button", content: { label_pl: "Nowa treść" } } }),
    );
    const { client, wrapper } = harness();
    const view = renderHook(() => useGlobalWidgetNode(GID), { wrapper });
    await waitFor(() => expect(view.result.current).not.toBeNull());

    odmowa = true;
    await act(async () => {
      await client.refetchQueries({ queryKey: globalWidgetKey(GID) });
    });

    expect(client.getQueryState(globalWidgetKey(GID))?.status).toBe("error");
    // Wcześniej odmowa nadpisywała dane sukcesem `null`, a instancja wracała
    // do starszej migawki z dokumentu.
    expect(view.result.current).toEqual({ type: "button", content: { label_pl: "Nowa treść" } });
  });
});
