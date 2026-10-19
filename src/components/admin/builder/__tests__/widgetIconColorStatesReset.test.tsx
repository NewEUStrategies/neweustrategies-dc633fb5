// Panel właściwości - trzy stany koloru ikon (domyślny / po najechaniu /
// aktywny) i ich reset w BIEŻĄCYM trybie.
//
// `widgetPropertiesPanel` sprawdza reset koloru tła/tekstu/obramowania i to,
// że sekcja ikon ma trzy osobne pola. Tu domykamy kontrakt resetu dla ikon:
// każdy stan to osobny klucz stylu, więc reset jednego nie może ruszyć
// pozostałych, a reset w trybie jasnym zdejmuje TYLKO nadpisanie jasne
// (ciemne zostaje); wartość płaska (historyczna, wspólna dla obu trybów)
// znika w całości.
//
// Granice: jak w `widgetPropertiesPanel` - atrapy Radix (Select, Tabs,
// Switch), i18n jako echo klucza, Supabase z `@/test/supabaseChain`, server
// fny i tenant z pomocników repo, podgląd na żywo jako atrapa (renderuje
// prawdziwy widget z własnymi zapytaniami - poza przedmiotem testu).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import { fireEvent, screen, within } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { ok, supabaseFromStub, type SupabaseFromStub } from "@/test/supabaseChain";
import type { WidgetNode } from "@/lib/builder/types";
import { WidgetProperties } from "../WidgetProperties";

const db: { current: SupabaseFromStub } = { current: supabaseFromStub() };

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
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => db.current.from(table),
    auth: { getSession: async () => ({ data: { session: { user: { id: "u-1" } } }, error: null }) },
  },
}));
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

const ICON_STYLE = {
  iconColor: { light: "#111111", dark: "#eeeeee" },
  iconHoverColor: { light: "#222222" },
  iconActiveColor: "#333333",
} as unknown as WidgetNode["style"];

function renderPanel() {
  const seen: WidgetNode[] = [];
  function Host() {
    const [node, setNode] = useState<WidgetNode>({
      id: "w1",
      kind: "widget",
      type: "social-icons",
      content: {},
      style: ICON_STYLE,
    });
    const [mode, setMode] = useState<"light" | "dark">("light");
    return (
      <WidgetProperties
        widget={node}
        lang="pl"
        device="desktop"
        mode={mode}
        onModeChange={setMode}
        onChange={(mut) => {
          setNode((prev) => {
            const next = JSON.parse(JSON.stringify(prev)) as WidgetNode;
            mut(next);
            seen.push(next);
            return next;
          });
        }}
      />
    );
  }
  renderWithQueryClient(<Host />);
  return { style: () => (seen.at(-1)?.style ?? {}) as Record<string, unknown> };
}

/** Przyciski resetu w sekcji ikon, w kolejności: domyślny, hover, aktywny. */
const iconResets = (): HTMLElement[] => {
  const section = screen
    .getByText("Kolory ikon SVG: domyślny, po najechaniu i aktywny (bieżąca strona).")
    .closest("section");
  if (!section) throw new Error("test: brak sekcji ikon");
  return within(section).getAllByTitle("builder.widgetProps.restoreGlobal");
};

beforeEach(() => {
  db.current = supabaseFromStub();
  db.current.setResponse("builder_global_widgets", ok([]));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("WidgetProperties - reset stanów koloru ikon", () => {
  const openStyle = () =>
    fireEvent.click(screen.getByRole("tab", { name: /builder\.widgetProps\.tabStyle/ }));

  it("każdy nadpisany stan ma własny przycisk resetu", () => {
    renderPanel();
    openStyle();
    expect(iconResets()).toHaveLength(3);
  });

  it("reset koloru domyślnego zdejmuje tylko tryb jasny i nie rusza pozostałych stanów", () => {
    const { style } = renderPanel();
    openStyle();
    fireEvent.click(iconResets()[0]!);
    expect(style()).toEqual({
      iconColor: { dark: "#eeeeee" },
      iconHoverColor: { light: "#222222" },
      iconActiveColor: "#333333",
    });
  });

  it("reset ostatniego nadpisania koloru po najechaniu usuwa klucz", () => {
    const { style } = renderPanel();
    openStyle();
    fireEvent.click(iconResets()[1]!);
    expect(style()).not.toHaveProperty("iconHoverColor");
    expect(style()).toMatchObject({
      iconColor: { light: "#111111", dark: "#eeeeee" },
      iconActiveColor: "#333333",
    });
  });

  it("reset płaskiego koloru aktywnego usuwa go dla obu trybów", () => {
    const { style } = renderPanel();
    openStyle();
    fireEvent.click(iconResets()[2]!);
    expect(style()).not.toHaveProperty("iconActiveColor");
    expect(iconResets()).toHaveLength(2);
  });
});
