// ZAPIS WIELU KLUCZY TREŚCI = JEDEN KROK HISTORII BUILDERA.
//
// PO CO. Edytory wykresu i mapy (PR2) zmieniają kilka kluczy naraz: dane razem
// z kolorami serii, serią wyróżnioną i kategorią wyróżnioną. Gdyby szły
// kolejnymi `setContent`, każde byłoby osobnym `onChange` - osobnym
// `history.set` - i jedno cofnięcie zostawiałoby dokument w stanie pośrednim
// (dane nowe, akcent wskazujący serię, której już nie ma). Ten plik przypina
// trzy warstwy tej obietnicy:
//   1. czysta mutacja (`applyContentPatch`): nadpisuje, `undefined` USUWA klucz,
//      wejście zostaje nietknięte;
//   2. historia (`useHistory`): jeden zapis łatki = jeden krok cofnięcia, który
//      przywraca WSZYSTKIE klucze naraz;
//   3. panel (`WidgetProperties`): `setContentPatch` dojeżdża do kontrolki pola
//      i woła `onChange` DOKŁADNIE raz.
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, renderHook, screen } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { useHistory } from "@/hooks/useHistory";
import type { WidgetNode } from "@/lib/builder/types";
import type { ContentPatch, SchemaField } from "@/lib/builder/schemas";
import { applyContentPatch, contentPatchMutation } from "@/lib/builder/contentPatch";

vi.mock("react-i18next", async () => {
  const { reactI18nextStub } = await import("@/test/i18nStub");
  return reactI18nextStub();
});
vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const { radixSelectStub } = await import("@/test/reactStubs");
  return radixSelectStub(React);
});
vi.mock("@/components/ui/tabs", async () => {
  const React = await import("react");
  const { radixTabsStub } = await import("@/test/builder/panels");
  return radixTabsStub(React);
});
vi.mock("@/components/ui/switch", async () => {
  const React = await import("react");
  const { radixSwitchStub } = await import("@/test/reactStubs");
  return radixSwitchStub(React);
});
vi.mock("@/hooks/useAuth", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useRequiredTenant: () => "tenant-test",
    useCurrentTenantId: () => "tenant-test",
  };
});
vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const { serverFnStubModule } = await import("@/test/serverFnHarness");
  return { ...actual, ...serverFnStubModule(), useServerFn: () => async () => ({}) };
});
vi.mock("@/lib/media.functions", () => ({
  bulkMoveMedia: async () => ({ moved: 0 }),
  bulkDeleteMedia: async () => ({ deleted: 0 }),
  createMediaFolder: async () => ({}),
  registerMediaUpload: async () => ({}),
  updateMediaMeta: async () => ({}),
}));
vi.mock("../ui/organisms/WidgetLivePreview", () => ({
  WidgetLivePreview: () => <div data-testid="podglad" />,
}));
// Kontrolka pola jest tu ATRAPĄ: interesuje nas wyłącznie to, czy panel podaje
// jej `setContentPatch` i co się dzieje po jego wywołaniu - nie to, jak
// wygląda pole. Pierwsze pole schematu dostaje przycisk wołający łatkę.
const PATCH: ContentPatch = { data: "; A\n2024; 1", accentSeries: 1, unit: undefined };
vi.mock("../ui/molecules/SchemaFieldControl", () => ({
  SchemaFieldControl: ({
    field,
    setContentPatch,
  }: {
    field: SchemaField;
    setContentPatch?: (patch: ContentPatch) => void;
  }) =>
    field.key === "kind" ? (
      <button type="button" onClick={() => setContentPatch?.(PATCH)}>
        łatka
      </button>
    ) : null,
}));

import { WidgetProperties } from "../WidgetProperties";

function chartWidget(): WidgetNode {
  return {
    id: "w-chart",
    kind: "widget",
    type: "chart",
    content: { kind: "bar", data: "; S\nX; 5", unit: "%", accentSeries: 0 },
  };
}

describe("1. applyContentPatch - czysta mutacja treści", () => {
  it("nadpisuje podane klucze, zostawia pozostałe, a `undefined` usuwa klucz", () => {
    const before = { a: 1, b: "x", c: true };
    expect(applyContentPatch(before, { a: 2, d: null, c: undefined })).toEqual({
      a: 2,
      b: "x",
      d: null,
    });
  });

  it("nie mutuje wejścia i znosi brak treści", () => {
    const before = { a: 1 };
    applyContentPatch(before, { a: 3 });
    expect(before).toEqual({ a: 1 });
    expect(applyContentPatch(undefined, { a: 1, b: undefined })).toEqual({ a: 1 });
  });

  it("mutacja panelu podmienia treść węzła jednym przypisaniem", () => {
    const node = chartWidget();
    contentPatchMutation(PATCH)(node);
    expect(node.content).toEqual({ kind: "bar", data: "; A\n2024; 1", accentSeries: 1 });
  });
});

describe("2. historia - łatka to JEDEN krok cofnięcia", () => {
  /** Zapis jak w `useBuilderOperations`: świeży klon, mutacja, `history.set`. */
  const commit =
    (history: { set: (next: (prev: WidgetNode) => WidgetNode) => void }) =>
    (mut: (w: WidgetNode) => void) =>
      history.set((prev) => {
        const next = JSON.parse(JSON.stringify(prev)) as WidgetNode;
        mut(next);
        return next;
      });

  it("jedno cofnięcie przywraca WSZYSTKIE klucze łatki naraz", () => {
    const { result } = renderHook(() => useHistory<WidgetNode>(chartWidget()));
    act(() => commit(result.current)(contentPatchMutation(PATCH)));
    expect(result.current.state.content).toEqual({
      kind: "bar",
      data: "; A\n2024; 1",
      accentSeries: 1,
    });

    act(() => result.current.undo());
    expect(result.current.state.content).toEqual(chartWidget().content);
    // Nie ma drugiego kroku: łatka nie zostawiła stanu pośredniego.
    expect(result.current.canUndo).toBe(false);
  });

  it("dla porównania: te same klucze kolejnymi zapisami to tyle kroków, ile kluczy", () => {
    const { result } = renderHook(() => useHistory<WidgetNode>(chartWidget()));
    act(() => commit(result.current)((w) => (w.content.data = "; A\n2024; 1")));
    act(() => commit(result.current)((w) => (w.content.accentSeries = 1)));
    act(() => result.current.undo());
    // Po jednym cofnięciu dane są nowe, a akcent stary - stan pośredni.
    expect(result.current.state.content.data).toBe("; A\n2024; 1");
    expect(result.current.state.content.accentSeries).toBe(0);
    expect(result.current.canUndo).toBe(true);
  });
});

describe("3. panel właściwości - `setContentPatch` dojeżdża do pola", () => {
  it("łatka z kontrolki pola to DOKŁADNIE jedno `onChange` z całą zmianą", () => {
    const onChange = vi.fn<(mut: (w: WidgetNode) => void) => void>();
    renderWithQueryClient(
      <WidgetProperties widget={chartWidget()} lang="pl" device="desktop" onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "łatka" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const node = chartWidget();
    onChange.mock.calls[0][0](node);
    expect(node.content).toEqual({ kind: "bar", data: "; A\n2024; 1", accentSeries: 1 });
  });
});
