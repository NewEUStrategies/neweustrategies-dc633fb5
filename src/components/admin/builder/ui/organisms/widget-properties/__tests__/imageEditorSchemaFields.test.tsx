// ImageEditor: podpis / wariant / dopasowanie / proporcje.
//
// Regresja przypięta tutaj: cztery ustawienia obrazka żyły w
// `WIDGET_SCHEMAS.image` i były W PEŁNI obsługiwane przez renderer
// (mediaWidgets.ImageWidget: figcaption, klasa wariantu, object-fit,
// aspect-ratio), ale panel kierował widget `image` do własnego edytora, który
// ich nie rysował - cały blok schematu był zasłonięty i redakcja nie miała jak
// ustawić żadnego z nich.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Json, WidgetContent } from "@/lib/builder/types";
import { WIDGET_SCHEMAS } from "@/lib/builder/schemas";

// ImageSlot (górna część edytora) wymaga kontekstu tenanta z `useAuth`.
// Test dotyczy pól schematu, więc dostarczamy tylko ten jeden kawałek kontekstu.
vi.mock("@/hooks/useAuth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useAuth")>()),
  useRequiredTenant: () => "tenant-test",
}));

import { ImageEditor, IMAGE_EDITOR_HANDLED_KEYS } from "../ImageEditor";
import { ImageWidget } from "@/components/builder/organisms/widget-view/mediaWidgets";

type Recorded = Array<[string, Json]>;

function renderEditor(content: WidgetContent, lang: "pl" | "en" = "pl") {
  const calls: Recorded = [];
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ImageEditor
        c={content}
        lang={lang}
        setContent={(k: string, v: Json) => {
          calls.push([k, v]);
        }}
      />
    </QueryClientProvider>,
  );
  return calls;
}

/** PropField nie wiąże etykiety z kontrolką przez htmlFor - szukamy po wrapperze. */
function controlFor(label: string): HTMLElement {
  const wrapper = screen.getByText(label).closest("div");
  const control = wrapper?.querySelector<HTMLElement>(
    "input, textarea, [role='combobox'], [role='switch']",
  );
  if (!control) throw new Error(`Brak kontrolki dla pola "${label}"`);
  return control;
}

/** Otwiera selecta Radiksa i klika opcję o podanej etykiecie. */
function pickOption(label: string, optionLabel: string) {
  const trigger = controlFor(label);
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  fireEvent.click(within(screen.getByRole("listbox")).getByText(optionLabel));
}

function renderWidget(content: WidgetContent) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ImageWidget c={content} lang="pl" theme="light" editable={false} />
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

describe("ImageEditor zna cały schemat obrazka", () => {
  it("claims every schema key, so nothing can be silently swallowed", () => {
    const schemaKeys = (WIDGET_SCHEMAS.image ?? []).map((f) => f.key);
    expect(schemaKeys.length).toBeGreaterThan(0);
    const unclaimed = schemaKeys.filter((key) => !IMAGE_EDITOR_HANDLED_KEYS.has(key));
    expect(unclaimed).toEqual([]);
  });

  it("keeps the four settings the renderer reads in the schema", () => {
    const keys = (WIDGET_SCHEMAS.image ?? []).map((f) => f.key);
    for (const key of ["caption", "variant", "objectFit", "ratio"]) expect(keys).toContain(key);
  });

  it("renders a control for each of them", () => {
    renderEditor({});
    for (const label of ["Podpis (opcjonalny) (PL)", "Wariant", "Dopasowanie", "Proporcje"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });
});

describe("ImageEditor zapisuje nowe ustawienia do treści", () => {
  it.each([
    ["pl", "caption_pl"],
    ["en", "caption_en"],
  ] as const)("writes the caption of the active language (%s)", (lang, key) => {
    const calls = renderEditor({}, lang);
    fireEvent.change(controlFor(`Podpis (opcjonalny) (${lang.toUpperCase()})`), {
      target: { value: "Zdjęcie z konferencji" },
    });
    expect(calls).toEqual([[key, "Zdjęcie z konferencji"]]);
  });

  it.each([
    ["Wariant", "okrąg", "variant", "circle"],
    ["Dopasowanie", "contain", "objectFit", "contain"],
    ["Proporcje", "1:1", "ratio", "1/1"],
  ])("commits %s", (label, optionLabel, key, value) => {
    const calls = renderEditor({});
    pickOption(label, optionLabel);
    expect(calls).toEqual([[key, value]]);
  });

  it("shows the stored value instead of resetting the control", () => {
    renderEditor({ variant: "polaroid", ratio: "16/9", objectFit: "contain" });
    expect(controlFor("Wariant").textContent).toBe("polaroid");
    expect(controlFor("Proporcje").textContent).toBe("16:9");
    expect(controlFor("Dopasowanie").textContent).toBe("contain");
  });
});

describe("renderer honoruje to, co edytor zapisał", () => {
  it("paints the caption committed by the editor", () => {
    const calls = renderEditor({ src: "https://x/a.jpg" });
    fireEvent.change(controlFor("Podpis (opcjonalny) (PL)"), { target: { value: "Podpis" } });
    cleanup();

    const content: WidgetContent = { src: "https://x/a.jpg" };
    for (const [k, v] of calls) content[k] = v;
    const { container } = renderWidget(content);
    expect(container.querySelector("figcaption")?.textContent).toBe("Podpis");
  });

  it("applies the ratio and object-fit committed by the editor", () => {
    const calls: Recorded = [];
    calls.push(...renderEditor({ src: "https://x/a.jpg" }));
    pickOption("Proporcje", "1:1");
    cleanup();
    renderEditor({ src: "https://x/a.jpg" });
    pickOption("Dopasowanie", "contain");
    cleanup();

    const content: WidgetContent = { src: "https://x/a.jpg", ratio: "1/1", objectFit: "contain" };
    const { container } = renderWidget(content);
    const frame = container.querySelector<HTMLElement>("[data-widget-media]");
    expect(frame?.style.aspectRatio).toBe("1 / 1");
    expect(container.querySelector<HTMLImageElement>("img")?.style.objectFit).toBe("contain");
  });
});

describe("bez podpisu figcaption nie powstaje", () => {
  it("renders no caption element for empty content", () => {
    const { container } = renderWidget({ src: "https://x/a.jpg" });
    expect(container.querySelector("figcaption")).toBeNull();
  });
});
