// Panel kolumny: KOLOR TEKSTU per tryb i reset JEDYNEGO nadpisania.
//
// Kolor tła ma testy w `ColumnProperties.test.tsx`; tu dowodzimy drugiego
// wiersza tej samej sekcji (kolor tekstu) i gałęzi resetu, której tamte testy
// nie dotykają: gdy nadpisany był TYLKO bieżący tryb, reset usuwa klucz ze
// stylu kolumny całkiem - zamiast zostawiać pusty obiekt `{}`, który kaskada
// kolorów czytałaby jako „ustawione, ale bez wartości".
//
// Atrapy jak u sąsiada: słownik (`i18nStub`), Radix Select i Tabs (natywne
// odpowiedniki - Radix nie przełącza się pod happy-dom od samego kliknięcia).
import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ColumnNode, Mode } from "@/lib/builder/types";
import { themedColorStyle } from "@/test/builder/panels";
import { ColumnProperties } from "../ColumnProperties";

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

function renderStyleTab(initial: ColumnNode, startMode: Mode = "light") {
  const seen: ColumnNode[] = [];
  function Host() {
    const [node, setNode] = useState<ColumnNode>(initial);
    const [mode, setMode] = useState<Mode>(startMode);
    return (
      <ColumnProperties
        column={node}
        device="desktop"
        mode={mode}
        onModeChange={setMode}
        onChange={(mut) => {
          setNode((prev) => {
            const next = JSON.parse(JSON.stringify(prev)) as ColumnNode;
            mut(next);
            seen.push(next);
            return next;
          });
        }}
      />
    );
  }
  render(<Host />);
  fireEvent.click(screen.getByRole("tab", { name: /builder\.columnProps\.tabStyle/ }));
  return { node: () => seen.at(-1) };
}

const column = (style?: ColumnNode["style"]): ColumnNode => ({
  id: "c1",
  kind: "column",
  span: { desktop: 12 },
  children: [],
  ...(style ? { style } : {}),
});

/** Wiersze kolorów w kolejności sekcji: tło, potem tekst. */
function colorInputs(): HTMLInputElement[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>("input.font-mono"));
}

describe("ColumnProperties - kolor tekstu", () => {
  it("pierwszy zapis w trybie jasnym jest płaski (oba tryby) i nie rusza tła", () => {
    // Kontrakt `themed.setMode`: pierwsza wartość w trybie jasnym obowiązuje
    // w obu trybach, dopóki redakcja jawnie nie nadpisze ciemnego.
    const { node } = renderStyleTab(column(themedColorStyle({ bgColor: { light: "#ffffff" } })));
    const text = colorInputs()[1];
    if (!text) throw new Error("test: brak pola koloru tekstu");
    fireEvent.change(text, { target: { value: "#222222" } });
    expect(node()?.style?.textColor).toBe("#222222");
    expect(node()?.style?.bgColor).toEqual({ light: "#ffffff" });
  });

  it("w trybie ciemnym kolor tekstu trafia do gałęzi `dark`", () => {
    const { node } = renderStyleTab(
      column(themedColorStyle({ textColor: { light: "#111111" } })),
      "dark",
    );
    fireEvent.change(colorInputs()[1], { target: { value: "#eeeeee" } });
    expect(node()?.style?.textColor).toEqual({ light: "#111111", dark: "#eeeeee" });
  });

  it("reset jedynego nadpisania usuwa klucz ze stylu, nie zostawia pustego obiektu", () => {
    const { node } = renderStyleTab(column(themedColorStyle({ textColor: { light: "#111111" } })));
    const reset = document.querySelector<HTMLButtonElement>(
      'button[title="builder.columnProps.resetGlobal"]',
    );
    if (!reset) throw new Error("test: brak przycisku resetu");
    fireEvent.click(reset);
    expect(node()?.style).toBeDefined();
    expect(node()?.style && "textColor" in node()!.style!).toBe(false);
  });
});
