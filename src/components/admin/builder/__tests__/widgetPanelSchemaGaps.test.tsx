// Panel właściwości: widgety, których ustawienia renderer czytał, a panel
// nie dawał na nie ŻADNEJ kontrolki.
//
// Regresje przypięte tutaj:
//  1. `copyright` konsumował `text_pl|_en`, `brand` i `showYear`, a panel
//     pokazywał "Brak edytowalnych pól dla tego widgetu.",
//  2. `lang-switcher` miał etykiety tylko w defaultach palety; etykieta jest
//     opisem dla czytnika ekranu, a na stronie widoczne są wyłącznie flagi,
//  3. `search-form` w ogóle nie miał wpisu w `WIDGET_SCHEMAS`, mimo że
//     SearchFormWidget czyta `action`, `placeholder_*` i `button_*`,
//  4. edytor niestandardowy (image) zasłaniał cały blok schematu - mechanizm
//     `unhandledSchemaFields` gwarantuje, że pole schematu nie znika po cichu.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import type { Json, WidgetContent, WidgetNode, WidgetType } from "@/lib/builder/types";
import { WIDGETS } from "@/lib/builder/registry";
import { WIDGET_SCHEMAS, type SchemaField } from "@/lib/builder/schemas";

// ImageSlot (edytor obrazka) wymaga kontekstu tenanta z `useAuth`.

// Podział kodu (React.lazy) zamieniony na importy statyczne - bez tego pierwszy
// render leniwych widgetów pokazuje fallback Suspense i synchroniczne asercje
// widzą pustkę tam, gdzie w produkcji SSR wypełnia boundary. Lustro eager jest
// kontraktowo identyczne z rejestrem (src/lib/builder/ci/__tests__/eagerWidgetChunks.test.ts).
vi.mock(
  "@/components/builder/organisms/widget-view/lazyWidgets",
  () => import("@/test/eagerWidgetChunks"),
);

vi.mock("@/hooks/useAuth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useAuth")>()),
  useRequiredTenant: () => "tenant-test",
}));

import { WidgetProperties, unhandledSchemaFields } from "../WidgetProperties";
import { renderSimpleWidget } from "@/components/builder/organisms/widget-view/SimpleWidgets";
import { DynamicTagWidget } from "@/components/builder/organisms/widget-view/DynamicTagWidgets";

function defaultsOf(type: WidgetType): WidgetContent {
  return WIDGETS.find((w) => w.type === type)?.defaults() ?? {};
}

/** Panel podpięty do stanu - dokładnie jak w edytorze: mutacja -> nowa treść. */
function renderPanel(type: WidgetType, content: WidgetContent, lang: "pl" | "en" = "pl") {
  const state: { content: WidgetContent } = { content };
  function Harness() {
    const [widget, setWidget] = useState<WidgetNode>({
      id: `${type}-1`,
      kind: "widget",
      type,
      content,
    });
    state.content = widget.content;
    return (
      <WidgetProperties
        widget={widget}
        lang={lang}
        device="desktop"
        onChange={(mut) =>
          setWidget((prev) => {
            const next: WidgetNode = { ...prev, content: { ...prev.content } };
            mut(next);
            return next;
          })
        }
      />
    );
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
  return state;
}

/** PropField nie wiąże etykiety z kontrolką przez htmlFor - szukamy po wrapperze. */
function controlFor(label: string): HTMLElement {
  const wrapper = screen.getByText(label).closest("div");
  const control = wrapper?.querySelector<HTMLElement>("input, textarea, [role='combobox']");
  if (!control) throw new Error(`Brak kontrolki dla pola "${label}"`);
  return control;
}

const NO_FIELDS = /Brak edytowalnych pól/;

afterEach(cleanup);

describe("copyright ma edytowalne pola", () => {
  it("stops telling the editor there is nothing to edit", () => {
    renderPanel("copyright", defaultsOf("copyright"));
    expect(screen.queryByText(NO_FIELDS)).toBeNull();
  });

  it("writes the brand, the text of the active language and the year switch", () => {
    const state = renderPanel("copyright", {});
    fireEvent.change(controlFor("Nazwa marki"), { target: { value: "NES" } });
    fireEvent.change(controlFor("Tekst (PL)"), { target: { value: "Wszelkie prawa" } });
    fireEvent.click(screen.getByRole("switch", { name: "Pokaż rok" }));

    expect(state.content.brand).toBe("NES");
    expect(state.content.text_pl).toBe("Wszelkie prawa");
    // Prawdziwy boolean, nie string "0" - inaczej renderer nigdy nie zgasi roku.
    expect(state.content.showYear).toBe(false);
  });

  it("writes the EN text when the panel edits EN", () => {
    const state = renderPanel("copyright", {}, "en");
    fireEvent.change(controlFor("Tekst (EN)"), { target: { value: "All rights reserved" } });
    expect(state.content.text_en).toBe("All rights reserved");
  });

  it("hides the year in the renderer once the switch is off", () => {
    const year = String(new Date().getFullYear());
    const on = render(
      <>{renderSimpleWidget(node("copyright", { brand: "NES", showYear: true }), "pl", "light")}</>,
    );
    expect(on.container.textContent).toContain(year);
    cleanup();

    const off = render(
      <>
        {renderSimpleWidget(node("copyright", { brand: "NES", showYear: false }), "pl", "light")}
      </>,
    );
    expect(off.container.textContent).not.toContain(year);
    expect(off.container.textContent).toContain("NES");
  });
});

describe("lang-switcher ma edytowalną etykietę (aria-label) i realny przełącznik", () => {
  it("exposes the aria-label field in the panel", () => {
    renderPanel("lang-switcher", defaultsOf("lang-switcher"));
    expect(screen.queryByText(NO_FIELDS)).toBeNull();
    expect(screen.getByText("Etykieta (PL)")).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "Pokaż etykietę tekstową" })).toBeNull();
  });

  it("writes the label used by screen readers", () => {
    const state = renderPanel("lang-switcher", defaultsOf("lang-switcher"));
    fireEvent.change(controlFor("Etykieta (PL)"), { target: { value: "Język" } });

    expect(state.content.label_pl).toBe("Język");
    expect(state.content.showLabel).toBeUndefined();
  });

  it("keeps a fresh widget visually unchanged (label only for screen readers)", () => {
    const defaults = defaultsOf("lang-switcher");
    expect(defaults.showLabel).toBeUndefined();
    expect(defaults.label_pl).toBeTruthy();
    expect(defaults.label_en).toBeTruthy();
  });
});

describe("search-form ma schemat", () => {
  it("exposes action, placeholder and button label", () => {
    renderPanel("search-form", defaultsOf("search-form"));
    expect(screen.queryByText(NO_FIELDS)).toBeNull();
    for (const label of [
      "Adres wyników wyszukiwania",
      "Placeholder (PL)",
      "Etykieta przycisku (PL)",
    ])
      expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("writes every field the renderer reads", () => {
    const state = renderPanel("search-form", {});
    fireEvent.change(controlFor("Adres wyników wyszukiwania"), { target: { value: "/szukaj" } });
    fireEvent.change(controlFor("Placeholder (PL)"), { target: { value: "Czego szukasz?" } });
    fireEvent.change(controlFor("Etykieta przycisku (PL)"), { target: { value: "Znajdź" } });

    expect(state.content).toMatchObject({
      action: "/szukaj",
      placeholder_pl: "Czego szukasz?",
      button_pl: "Znajdź",
    });
  });

  it("renders what the panel saved", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={client}>
        <DynamicTagWidget
          node={node("search-form", {
            action: "/szukaj",
            placeholder_pl: "Czego szukasz?",
            button_pl: "Znajdź",
          })}
          lang="pl"
        />
      </QueryClientProvider>,
    );
    const form = container.querySelector("form");
    expect(form?.getAttribute("action")).toBe("/szukaj");
    expect(container.querySelector("input")?.getAttribute("placeholder")).toBe("Czego szukasz?");
    expect(container.querySelector("button")?.textContent).toBe("Znajdź");
  });

  it("drops the dead `variant` default that nothing ever read", () => {
    expect(defaultsOf("search-form")).not.toHaveProperty("variant");
  });
});

describe("edytory niestandardowe nie zjadają pól schematu", () => {
  const OPTED_IN: WidgetType[] = ["image", "progress-carousel"];

  it.each(OPTED_IN)("%s: the custom editor claims the whole schema today", (type) => {
    expect(unhandledSchemaFields(type)).toEqual([]);
  });

  it("surfaces a schema field the editor does not know about", () => {
    const invented: SchemaField = { key: "wymyslonePole", type: "text", label: "Wymyślone pole" };
    const schema = [...(WIDGET_SCHEMAS.image ?? []), invented];
    expect(unhandledSchemaFields("image", schema)).toEqual([invented]);
  });

  it("stays opt-in: a widget outside the registry keeps today's behaviour", () => {
    const invented: SchemaField = { key: "wymyslonePole", type: "text", label: "Wymyślone pole" };
    expect(unhandledSchemaFields("heading", [invented])).toEqual([]);
    expect(unhandledSchemaFields("slider")).toEqual([]);
  });

  it("shows the four image settings in the panel exactly once", () => {
    renderPanel("image", { src: "https://x/a.jpg" });
    for (const label of ["Podpis (opcjonalny) (PL)", "Wariant", "Dopasowanie", "Proporcje"]) {
      expect(screen.getAllByText(label)).toHaveLength(1);
    }
  });
});

function node(type: WidgetType, content: WidgetContent): WidgetNode {
  return { id: `${type}-1`, kind: "widget", type, content: content as Record<string, Json> };
}
