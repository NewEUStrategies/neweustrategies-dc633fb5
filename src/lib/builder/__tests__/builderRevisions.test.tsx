// Historia wersji elementów buildera (widgety globalne i popupy):
// `src/lib/builder/revisions.ts` - 18,5% linii, 3 z 9 funkcji przed tą zmianą.
//
// Migawki zapisuje wyzwalacz bazy, więc tutaj liczy się TYLKO odczyt
// i przywracanie. Dwie rzeczy, których złamanie jest ciche i kosztowne:
//
//   1. ROZJAZD TYPU ENCJI. Payload widgetu globalnego i payload popupu mają
//      RÓŻNE kształty (`{type, content, ...}` vs `{builder_data, settings}`).
//      Przywracanie wybiera tabelę i parser po `entityType`. Pomyłka tutaj albo
//      rzuca „invalid_revision_payload" (użytkownik widzi „nie udało się"),
//      albo - gorzej - wpisuje payload jednego rodzaju do tabeli drugiego.
//   2. INWALIDACJE PO PRZYWRÓCENIU. Widget globalny jest osadzony na WIELU
//      stronach publicznych i cache'owany per klucz. Bez pełnego zestawu
//      inwalidacji przywrócona wersja jest w bazie, ale odwiedzający nadal
//      widzi starą - a redaktor dostał komunikat o sukcesie.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fail, ok, type RecordedChain, type SupabaseFromStub } from "@/test/supabaseChain";

const h = vi.hoisted(() => ({ emitInvalidate: null as unknown }));
const stubs = vi.hoisted(() => ({ from: null as unknown }));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const from = supabaseFromStub();
  stubs.from = from;
  return { supabase: { from: from.from } };
});

vi.mock("@/lib/builder/widgetCacheInvalidation", async () => {
  const { vi: v } = await import("vitest");
  h.emitInvalidate = v.fn();
  return { emitWidgetCacheInvalidate: h.emitInvalidate };
});

import {
  builderRevisionsKey,
  parseGlobalWidgetRevision,
  parsePopupRevision,
  useBuilderRevisions,
  useRestoreBuilderRevision,
  type BuilderRevision,
} from "@/lib/builder/revisions";
import { WIDGET_QUERY_ROOTS } from "@/lib/builder/queryKeys";

const db = stubs.from as SupabaseFromStub;
const emitInvalidate = () => h.emitInvalidate as ReturnType<typeof vi.fn>;

const WIDGET_ID = "widget-1";
const POPUP_ID = "popup-1";

function revision(overrides: Partial<BuilderRevision> = {}): BuilderRevision {
  return {
    id: "rev-1",
    entity_type: "global_widget",
    entity_id: WIDGET_ID,
    name: "Stopka newslettera",
    data: { type: "heading", content: { text_pl: "Zapisz się" } },
    note: null,
    created_by: "user-1",
    created_at: "2026-08-18T10:00:00.000Z",
    ...overrides,
  };
}

function harness() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

beforeEach(() => {
  db.reset();
  emitInvalidate().mockReset();
});

// ---------------------------------------------------------------------------
// Klucz cache
// ---------------------------------------------------------------------------

describe("builderRevisionsKey", () => {
  it("rozdziela historie po TYPIE encji i po id", () => {
    // Wspólny klucz dla widgetu i popupu o tym samym id pokazałby historię
    // jednego elementu pod drugim.
    expect(builderRevisionsKey("global_widget", WIDGET_ID)).toEqual([
      "admin",
      "builder-revisions",
      "global_widget",
      WIDGET_ID,
    ]);
    expect(builderRevisionsKey("popup", WIDGET_ID)).not.toEqual(
      builderRevisionsKey("global_widget", WIDGET_ID),
    );
  });

  it("brak id daje pusty segment, nie `null` w kluczu", () => {
    // `null` w tablicy klucza react-query jest legalny, ale mieszałby się
    // z brakiem elementu; pusty string jest jednoznaczny.
    expect(builderRevisionsKey("popup", null)).toEqual(["admin", "builder-revisions", "popup", ""]);
  });
});

// ---------------------------------------------------------------------------
// Parsery migawek
// ---------------------------------------------------------------------------

describe("parsePopupRevision", () => {
  it("rozkłada migawkę na dokument i ustawienia", () => {
    const parsed = parsePopupRevision({
      builder_data: { version: 1, sections: [] },
      settings: { trigger: "exit_intent" },
    });
    expect(parsed.builder_data).toMatchObject({ version: 1 });
    expect(parsed.settings).toBeTypeOf("object");
  });

  it("zdeformowana migawka NIE wysypuje podglądu - daje pusty dokument", () => {
    // Wiersz zapisany starszą wersją schematu nadal musi dać się otworzyć,
    // żeby redaktor mógł zobaczyć, że tej wersji nie da się użyć.
    for (const raw of [null, undefined, "tekst", 42, []]) {
      const parsed = parsePopupRevision(raw);
      expect(parsed.builder_data).toBeTypeOf("object");
      expect(parsed.settings).toBeTypeOf("object");
    }
  });
});

describe("parseGlobalWidgetRevision", () => {
  it("przepuszcza payload ZNANEGO typu widgetu", () => {
    const parsed = parseGlobalWidgetRevision({
      type: "heading",
      content: { text_pl: "Nagłówek" },
    });
    expect(parsed).toMatchObject({ type: "heading" });
  });

  it("odrzuca payload BEZ typu i o typie nieznanym silnikowi", () => {
    // To jest dokładnie ta bramka, która odrzuca migawkę POPUPU podaną
    // ścieżką widgetu: `{builder_data, settings}` nie ma klucza `type`.
    expect(parseGlobalWidgetRevision({ builder_data: {}, settings: {} })).toBeNull();
    expect(parseGlobalWidgetRevision({ type: "nie-ma-takiego-widgetu" })).toBeNull();
    expect(parseGlobalWidgetRevision(null)).toBeNull();
    expect(parseGlobalWidgetRevision("tekst")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Odczyt historii
// ---------------------------------------------------------------------------

describe("useBuilderRevisions", () => {
  it("czyta historię elementu: filtry po typie i id, od najnowszej, limit 50", async () => {
    const { wrapper } = harness();
    db.setResponse("builder_revisions", ok([revision()]));

    const { result } = renderHook(() => useBuilderRevisions("global_widget", WIDGET_ID), {
      wrapper,
    });
    await waitFor(() => expect(result.current.data).toHaveLength(1));

    const chain = db.lastChain("builder_revisions") as RecordedChain;
    const eqs = chain.calls.filter((c) => c.method === "eq").map((c) => c.args);
    expect(eqs).toEqual([
      ["entity_type", "global_widget"],
      ["entity_id", WIDGET_ID],
    ]);
    expect(chain.argsOf("order")).toEqual(["created_at", { ascending: false }]);
    // Ograniczenie ładunku: migawki widgetów bywają duże.
    expect(chain.argsOf("limit")).toEqual([50]);
  });

  it("wybiera JAWNĄ listę kolumn, nie `*`", async () => {
    const { wrapper } = harness();
    db.setResponse("builder_revisions", ok([]));
    const { result } = renderHook(() => useBuilderRevisions("popup", POPUP_ID), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [projection] = (db.lastChain("builder_revisions")?.argsOf("select") ?? []) as [string];
    expect(projection).not.toBe("*");
    expect(projection).toContain("data");
    expect(projection).toContain("created_at");
  });

  it("bez id NIE odpytuje tabeli (zapytanie zwróciłoby cudze wiersze)", async () => {
    const { wrapper } = harness();
    const { result } = renderHook(() => useBuilderRevisions("global_widget", null), { wrapper });

    // `enabled: Boolean(entityId)` - zapytanie nie startuje.
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(db.chainsFor("builder_revisions")).toHaveLength(0);
  });

  it("`data: null` daje pustą listę, nie null", async () => {
    const { wrapper } = harness();
    db.setResponse("builder_revisions", { data: null, error: null });
    const { result } = renderHook(() => useBuilderRevisions("popup", POPUP_ID), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual([]));
  });

  it("błąd zapytania jest zgłoszony, nie zamieniony w pustą historię", async () => {
    // Pusta historia wyglądałaby jak „ten element nie ma wersji" - redaktor
    // uznałby, że nie ma do czego wracać.
    const { wrapper } = harness();
    db.setResponse("builder_revisions", fail("revisions denied"));
    const { result } = renderHook(() => useBuilderRevisions("popup", POPUP_ID), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

// ---------------------------------------------------------------------------
// Przywracanie
// ---------------------------------------------------------------------------

describe("useRestoreBuilderRevision - widget globalny", () => {
  it("zapisuje payload widgetu do builder_global_widgets po id ELEMENTU", async () => {
    // Kluczowe: `eq("id", revision.entity_id)`, nie `revision.id`. Pomyłka
    // nadpisałaby element o id równym id migawki - czyli zwykle żaden, więc
    // przywracanie „udałoby się" bez żadnego skutku.
    const { wrapper } = harness();
    db.setResponse("builder_global_widgets", ok(null));

    const { result } = renderHook(() => useRestoreBuilderRevision("global_widget"), { wrapper });
    await result.current.mutateAsync(revision());

    const chain = db.lastChain("builder_global_widgets") as RecordedChain;
    expect(chain.argsOf("eq")).toEqual(["id", WIDGET_ID]);
    const [patch] = (chain.argsOf("update") ?? []) as [Record<string, unknown>];
    expect(patch.data).toMatchObject({ type: "heading" });
  });

  it("zdeformowany payload ODRZUCA przywracanie zamiast pisać śmieci", async () => {
    const { wrapper } = harness();
    db.setResponse("builder_global_widgets", ok(null));

    const { result } = renderHook(() => useRestoreBuilderRevision("global_widget"), { wrapper });
    await expect(
      result.current.mutateAsync(revision({ data: { builder_data: {}, settings: {} } })),
    ).rejects.toThrow("invalid_revision_payload");

    // Nic nie poszło do bazy.
    expect(db.chainsFor("builder_global_widgets")).toHaveLength(0);
  });

  it("błąd zapisu propaguje (redaktor nie dostaje fałszywego sukcesu)", async () => {
    const { wrapper } = harness();
    db.setResponse("builder_global_widgets", fail("rls denied"));

    const { result } = renderHook(() => useRestoreBuilderRevision("global_widget"), { wrapper });
    await expect(result.current.mutateAsync(revision())).rejects.toThrow("rls denied");
  });
});

describe("useRestoreBuilderRevision - popup", () => {
  const popupRevision = () =>
    revision({
      entity_type: "popup",
      entity_id: POPUP_ID,
      data: { builder_data: { version: 1, sections: [] }, settings: { trigger: "delay" } },
    });

  it("zapisuje DOKUMENT i USTAWIENIA popupu do builder_popups", async () => {
    // Dwie kolumny, nie jedna: sam dokument bez ustawień przywróciłby treść
    // popupu, ale zostawił stare warunki wyświetlania (kiedy i komu się pokaże).
    const { wrapper } = harness();
    db.setResponse("builder_popups", ok(null));

    const { result } = renderHook(() => useRestoreBuilderRevision("popup"), { wrapper });
    await result.current.mutateAsync(popupRevision());

    const chain = db.lastChain("builder_popups") as RecordedChain;
    expect(chain.argsOf("eq")).toEqual(["id", POPUP_ID]);
    const [patch] = (chain.argsOf("update") ?? []) as [Record<string, unknown>];
    expect(patch).toHaveProperty("builder_data");
    expect(patch).toHaveProperty("settings");
  });

  it("ścieżka popupu NIE dotyka tabeli widgetów globalnych", async () => {
    const { wrapper } = harness();
    db.setResponse("builder_popups", ok(null));

    const { result } = renderHook(() => useRestoreBuilderRevision("popup"), { wrapper });
    await result.current.mutateAsync(popupRevision());

    expect(db.chainsFor("builder_global_widgets")).toHaveLength(0);
  });

  it("zdeformowana migawka popupu przechodzi (parser ma domyślne wartości)", async () => {
    // Świadoma asymetria wobec widgetu: popup NIE MA bramki odrzucającej, bo
    // `parsePopupRevision` zawsze zwraca poprawny kształt. Przywrócenie
    // uszkodzonej migawki daje więc PUSTY popup, nie błąd - test to zapisuje,
    // żeby zmiana tej decyzji była widoczna.
    const { wrapper } = harness();
    db.setResponse("builder_popups", ok(null));

    const { result } = renderHook(() => useRestoreBuilderRevision("popup"), { wrapper });
    await expect(
      result.current.mutateAsync(revision({ entity_type: "popup", data: "śmieci" })),
    ).resolves.toBeUndefined();

    const [patch] = (db.lastChain("builder_popups")?.argsOf("update") ?? []) as [
      Record<string, unknown>,
    ];
    expect(patch).toHaveProperty("builder_data");
  });

  it("błąd zapisu popupu propaguje", async () => {
    const { wrapper } = harness();
    db.setResponse("builder_popups", fail("popup denied"));

    const { result } = renderHook(() => useRestoreBuilderRevision("popup"), { wrapper });
    await expect(result.current.mutateAsync(popupRevision())).rejects.toThrow("popup denied");
  });
});

describe("useRestoreBuilderRevision - inwalidacje po sukcesie", () => {
  it("odświeża historię, listy widgetów, KONKRETNY widget i popupy oraz emituje sygnał", async () => {
    // Widget globalny jest osadzony na WIELU stronach publicznych i cache'owany
    // per klucz. Brak któregokolwiek z tych czterech kluczy zostawia
    // odwiedzającego ze starą wersją, mimo że baza ma już nową - a redaktor
    // widzi „przywrócono".
    const { client, wrapper } = harness();
    db.setResponse("builder_global_widgets", ok(null));
    const spy = vi.spyOn(client, "invalidateQueries");

    const { result } = renderHook(() => useRestoreBuilderRevision("global_widget"), { wrapper });
    await result.current.mutateAsync(revision());
    await waitFor(() => expect(spy).toHaveBeenCalled());

    const keys = spy.mock.calls.map((c) =>
      JSON.stringify((c[0] as { queryKey: unknown }).queryKey),
    );
    expect(keys).toContain(JSON.stringify(builderRevisionsKey("global_widget", WIDGET_ID)));
    expect(keys).toContain(JSON.stringify([WIDGET_QUERY_ROOTS.globalWidgets]));
    expect(keys).toContain(JSON.stringify([WIDGET_QUERY_ROOTS.globalWidget, WIDGET_ID]));
    expect(keys).toContain(JSON.stringify(["builder-popups-admin"]));
    // Sygnał między kartami/instancjami - bez niego otwarty drugi panel
    // pokazywałby starą wersję do końca sesji.
    expect(emitInvalidate()).toHaveBeenCalledTimes(1);
  });

  it("NIEUDANE przywrócenie nie inwalidauje niczego i nie emituje sygnału", async () => {
    const { client, wrapper } = harness();
    db.setResponse("builder_global_widgets", fail("denied"));
    const spy = vi.spyOn(client, "invalidateQueries");

    const { result } = renderHook(() => useRestoreBuilderRevision("global_widget"), { wrapper });
    await expect(result.current.mutateAsync(revision())).rejects.toThrow();

    expect(spy).not.toHaveBeenCalled();
    expect(emitInvalidate()).not.toHaveBeenCalled();
  });
});
