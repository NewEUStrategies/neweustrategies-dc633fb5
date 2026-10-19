// Panel widgetu + ramka widgetu: kolor płaski w trybie ciemnym.
//
// DECYZJA PRODUKTOWA (2026-10-19): kolor płaski widgetu to zapis trybu
// jasnego, a tryb ciemny bez własnej wartości rysuje go ODWRÓCONEGO
// (`resolveColorForMode` w ramce). Do tej poprawki edycja jasnego w panelu
// stemplowała ciemny starą wartością płaską (`setMode`), ramka widziała jawne
// `dark` i przestawała odwracać - ciemny tekst na ciemnym tle, choć nikt
// trybu ciemnego nie dotknął.
//
// Test przechodzi całą drogę redakcji: pole koloru w panelu -> dokument ->
// PRAWDZIWY podgląd na żywo (`WidgetLivePreview` renderuje kanoniczny
// `WidgetView` w `BuilderModeProvider`), więc sprawdza kolor, który ramka
// faktycznie nakłada w danym trybie, a nie kształt zapisu.
//
// Atrapy jak w `widgetPropertiesPanel`: Radix (Select, Tabs, Switch), i18n
// jako echo klucza, Supabase z `@/test/supabaseChain`, server fny i tenant
// z pomocników repo. Podglądu NIE atrapujemy - to on jest rendererem.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { ok, supabaseFromStub, type SupabaseFromStub } from "@/test/supabaseChain";
import { parseColorChannels } from "@/lib/builder/cssColor";
import { hoverCss } from "@/lib/builder/hoverCss";
import type { Mode, WidgetNode } from "@/lib/builder/types";
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
// FontPicker dopina arkusz Google Fonts do `<head>` - poza przedmiotem testu,
// a pod happy-dom to żądanie sieciowe przy każdym renderze zakładki stylu.
vi.mock("@/components/admin/settings/FontPicker", () => ({
  FontPicker: () => null,
}));

function renderPanel(style: WidgetNode["style"], startMode: Mode = "light") {
  const seen: WidgetNode[] = [];
  function Host() {
    const [node, setNode] = useState<WidgetNode>({
      id: "w1",
      kind: "widget",
      type: "heading",
      content: { text: "Nagłówek" },
      style,
    });
    const [mode, setMode] = useState<Mode>(startMode);
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
  fireEvent.click(screen.getByRole("tab", { name: /builder\.widgetProps\.tabStyle/ }));
  return {
    textColor: () => seen.at(-1)?.style?.textColor as unknown,
    style: () => seen.at(-1)?.style,
  };
}

const switchMode = (mode: Mode) =>
  fireEvent.click(screen.getByRole("button", { name: `builder.chrome.${mode}` }));

/** Wiersz pola „kolor tekstu" w sekcji kolorów widgetu. */
function textColorRow(): HTMLElement {
  const label = Array.from(document.querySelectorAll<HTMLElement>("label")).find(
    (el) => el.textContent?.trim() === "builder.widgetProps.text",
  );
  if (!label?.parentElement) throw new Error("test: brak pola koloru tekstu");
  return label.parentElement;
}

function textColorInput(): HTMLInputElement {
  const input = textColorRow().querySelector<HTMLInputElement>("input.font-mono");
  if (!input) throw new Error("test: brak pola tekstowego koloru");
  return input;
}

/** Kolor tekstu, który ramka widgetu nakłada w podglądzie na żywo. */
function renderedTextColor(): string {
  const frame = document.querySelector<HTMLElement>(
    '[data-builder-renderer="widget-props-preview"] [data-w-id="w1"]',
  );
  if (!frame) throw new Error("test: brak ramki widgetu w podglądzie");
  return frame.style.color;
}

/** Jasność koloru (0 = czerń, 1 = biel). */
function lightness(color: string): number {
  const rgba = parseColorChannels(color);
  if (!rgba) throw new Error(`test: kolor niepoliczalny: ${color}`);
  return (0.299 * rgba.r + 0.587 * rgba.g + 0.114 * rgba.b) / 255;
}

beforeEach(() => {
  db.current = supabaseFromStub();
  db.current.setResponse("builder_global_widgets", ok([]));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("WidgetProperties + ramka widgetu - kolor płaski w trybie ciemnym", () => {
  it("bez edycji płaski ciemny tekst jest w dark odwracany na jasny", () => {
    renderPanel({ textColor: "#111111" });
    expect(lightness(renderedTextColor())).toBeLessThan(0.5);
    switchMode("dark");
    expect(lightness(renderedTextColor())).toBeGreaterThan(0.5);
  });

  it("edycja koloru jasnego nie gasi odwrócenia w dark", () => {
    const { textColor } = renderPanel({ textColor: "#111111" });
    fireEvent.change(textColorInput(), { target: { value: "#222222" } });
    expect(lightness(renderedTextColor())).toBeLessThan(0.5);
    switchMode("dark");
    // Odwrócenie NOWEGO koloru jasnego, nie stempel starego `#111111`.
    expect(lightness(renderedTextColor())).toBeGreaterThan(0.5);
    expect(parseColorChannels(renderedTextColor())).toMatchObject({ r: 221, g: 221, b: 221 });
    expect(textColor()).toBe("#222222");
  });

  it("zakładka dark bez własnej wartości pokazuje kolor odwrócony jako dziedziczony", () => {
    renderPanel({ textColor: "#111111" });
    switchMode("dark");
    const input = textColorInput();
    // Pole nie udaje, że dark ma zapisany kolor jasny: jest puste, a
    // podpowiedź niesie to, co ramka naprawdę rysuje.
    expect(input.value).toBe("");
    expect(input.placeholder).toContain("rgb(238, 238, 238)");
    expect(
      textColorRow().querySelector('button[title="builder.widgetProps.restoreGlobal"]'),
    ).toBeNull();
  });

  it("edycja koloru ciemnego zachowuje jasny", () => {
    const { textColor } = renderPanel({ textColor: "#222222" });
    switchMode("dark");
    fireEvent.change(textColorInput(), { target: { value: "#333333" } });
    expect(parseColorChannels(renderedTextColor())).toMatchObject({ r: 51, g: 51, b: 51 });
    switchMode("light");
    expect(parseColorChannels(renderedTextColor())).toMatchObject({ r: 34, g: 34, b: 34 });
    expect(textColorInput().value).toBe("#222222");
    expect(textColor()).toEqual({ light: "#222222", dark: "#333333" });
  });

  it("wyczyszczenie koloru ciemnego wraca do odwracania jasnego", () => {
    const { textColor } = renderPanel({ textColor: "#222222" });
    switchMode("dark");
    fireEvent.change(textColorInput(), { target: { value: "#333333" } });
    fireEvent.change(textColorInput(), { target: { value: "" } });
    expect(lightness(renderedTextColor())).toBeGreaterThan(0.5);
    expect(textColor()).toBe("#222222");
    switchMode("light");
    expect(parseColorChannels(renderedTextColor())).toMatchObject({ r: 34, g: 34, b: 34 });
  });

  it("reset koloru ciemnego przyciskiem panelu też wraca do odwracania", () => {
    const { textColor } = renderPanel({
      textColor: { light: "#222222", dark: "#333333" },
    } as unknown as WidgetNode["style"]);
    switchMode("dark");
    const reset = textColorRow().querySelector<HTMLButtonElement>(
      'button[title="builder.widgetProps.restoreGlobal"]',
    );
    if (!reset) throw new Error("test: brak przycisku resetu koloru tekstu");
    fireEvent.click(reset);
    expect(lightness(renderedTextColor())).toBeGreaterThan(0.5);
    expect(textColor()).toBe("#222222");
  });

  it("kolor hoveru (renderer bez odwracania) po edycji jasnego zostawia dark bez zmian", () => {
    // `hoverCss` czyta płaską przez `pickMode` - obowiązuje w obu trybach - więc
    // hover zostaje przy ogólnym `setMode`, który stempluje dark starą wartością.
    const { style } = renderPanel({ hover: { transitionMs: 200, bgColor: "#ffffff" } });
    const label = Array.from(document.querySelectorAll<HTMLElement>("label")).find(
      (el) => el.textContent?.trim() === "builder.hover.bg",
    );
    const input = label?.parentElement?.querySelector<HTMLInputElement>("input.font-mono");
    if (!input) throw new Error("test: brak pola tła hoveru");
    fireEvent.change(input, { target: { value: "#eeeeee" } });
    expect(hoverCss("w1", style(), "desktop", "light")).toContain("background: #eeeeee");
    expect(hoverCss("w1", style(), "desktop", "dark")).toContain("background: #ffffff");
  });
});
