// ŁATKA WIELU KLUCZY = WŁASNY KROK HISTORII BUILDERA (przegląd końcowy PR2).
//
// `updateWidget` zwija edycje widgetu kluczem `w:<id>`, żeby seria naciśnięć
// w polu tytułu była jednym krokiem. Arkusz danych wykresu i mapy zapisuje
// jednak przez `setContentPatch` DZIAŁANIA (zatwierdzona komórka, wklejony
// zakres, wstawiony wiersz) - a pod tym samym kluczem każde z nich wpadało
// w krok poprzedniego, więc Ctrl+Z w arkuszu cofał naraz wszystkie edycje
// arkusza i jeszcze wcześniejszą zmianę tytułu. Plik przypina oba końce:
//   1. hak operacji: `updateWidget(..., { coalesce: false })` nie niesie
//      klucza zwijania, a z prawdziwą historią każda łatka to osobny krok;
//   2. panel: `setContentPatch` woła `onChange` z prośbą o własny krok,
//      a zwykłe `setContent` - bez niej (zwijanie pisania zostaje).
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, renderHook, screen } from "@testing-library/react";
import { useState } from "react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { useHistory } from "@/hooks/useHistory";
import type { BuilderDocument, ColumnNode, WidgetNode } from "@/lib/builder/types";
import type { ContentPatch, SchemaField } from "@/lib/builder/schemas";
import { contentPatchMutation } from "@/lib/builder/contentPatch";
import type { Selection } from "../ui/organisms/builder/types";
import { useBuilderOperations } from "../ui/hooks/useBuilderOperations";

vi.mock("react-i18next", async () => {
  const { reactI18nextStub } = await import("@/test/i18nStub");
  return reactI18nextStub();
});
vi.mock("@/lib/appDialogs", () => ({ promptDialog: vi.fn(async () => "Nazwa") }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/builder/templates", () => ({
  useSectionTemplates: () => ({ items: [], loading: false, save: vi.fn(async () => true) }),
}));
vi.mock("@/lib/builder/globalWidgets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/builder/globalWidgets")>();
  return { ...actual, useGlobalWidgets: () => ({ items: [], save: vi.fn(async () => "g") }) };
});
vi.mock("@/lib/builder/experiments", () => ({
  useExperimentsAdmin: () => ({ items: [], create: vi.fn(), setStatus: vi.fn() }),
}));
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
// Atrapa pola: przycisk łatki (jak arkusz) i przycisk zwykłego zapisu (jak pole tytułu).
vi.mock("../ui/molecules/SchemaFieldControl", () => ({
  SchemaFieldControl: ({
    field,
    setContent,
    setContentPatch,
  }: {
    field: SchemaField;
    setContent: (k: string, v: unknown) => void;
    setContentPatch?: (patch: ContentPatch) => void;
  }) =>
    field.key === "kind" ? (
      <>
        <button type="button" onClick={() => setContentPatch?.({ data: "; A\n2024; 1" })}>
          łatka
        </button>
        <button type="button" onClick={() => setContent("unit", "%")}>
          pole
        </button>
      </>
    ) : null,
}));

import { WidgetProperties } from "../WidgetProperties";

function wykres(): WidgetNode {
  return {
    id: "w1",
    kind: "widget",
    type: "chart",
    content: { kind: "bar", data: "; A\n2024; 0", title_pl: "Tytuł" },
  };
}

function dokument(): BuilderDocument {
  const kolumna: ColumnNode = {
    id: "c1",
    kind: "column",
    span: { desktop: 12 },
    children: [wykres()],
  };
  return { version: 1, sections: [{ id: "s1", kind: "section", children: [kolumna] }] };
}

/** Prawdziwa historia + prawdziwy hak operacji, jak w `Builder.tsx`. */
function useBuilder() {
  const history = useHistory<BuilderDocument>(dokument());
  const [selection, setSelection] = useState<Selection>({ kind: null, id: null });
  const ops = useBuilderOperations({
    history,
    doc: history.state,
    selection,
    setSelection,
    device: "desktop",
  });
  return { history, ops };
}

const tresc = (d: BuilderDocument) =>
  ((d.sections[0].children[0] as ColumnNode).children[0] as WidgetNode).content;

describe("updateWidget - łatka arkusza to własny krok historii", () => {
  it("dwie łatki po edycji tytułu: trzy kroki cofnięcia, każdy cofa jedno działanie", () => {
    const { result } = renderHook(() => useBuilder());
    act(() => result.current.ops.updateWidget("w1", (w) => (w.content.title_pl = "Nowy")));
    act(() =>
      result.current.ops.updateWidget("w1", contentPatchMutation({ data: "; A\n2024; 1" }), {
        coalesce: false,
      }),
    );
    act(() =>
      result.current.ops.updateWidget("w1", contentPatchMutation({ data: "; A\n2024; 2" }), {
        coalesce: false,
      }),
    );
    expect(tresc(result.current.history.state).data).toBe("; A\n2024; 2");

    act(() => result.current.history.undo());
    expect(tresc(result.current.history.state).data).toBe("; A\n2024; 1");
    expect(tresc(result.current.history.state).title_pl).toBe("Nowy");

    act(() => result.current.history.undo());
    expect(tresc(result.current.history.state).data).toBe("; A\n2024; 0");
    expect(tresc(result.current.history.state).title_pl).toBe("Nowy");

    act(() => result.current.history.undo());
    expect(tresc(result.current.history.state).title_pl).toBe("Tytuł");
    expect(result.current.history.canUndo).toBe(false);
  });

  it("zwykła edycja właściwości nadal zwija się w jeden krok", () => {
    const { result } = renderHook(() => useBuilder());
    act(() => result.current.ops.updateWidget("w1", (w) => (w.content.title_pl = "N")));
    act(() => result.current.ops.updateWidget("w1", (w) => (w.content.title_pl = "No")));
    act(() => result.current.history.undo());
    expect(tresc(result.current.history.state).title_pl).toBe("Tytuł");
    expect(result.current.history.canUndo).toBe(false);
  });
});

describe("panel właściwości - łatka prosi o własny krok, pole o zwijanie", () => {
  it("`setContentPatch` woła `onChange` z `coalesce: false`, `setContent` - bez opcji", () => {
    const onChange = vi.fn<(mut: (w: WidgetNode) => void, opts?: { coalesce?: boolean }) => void>();
    renderWithQueryClient(
      <WidgetProperties widget={wykres()} lang="pl" device="desktop" onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "łatka" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][1]).toEqual({ coalesce: false });

    fireEvent.click(screen.getByRole("button", { name: "pole" }));
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange.mock.calls[1][1]).toBeUndefined();
  });
});
