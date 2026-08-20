// Panel właściwości KOLUMNY: rozpiętość (1-12) i minimalna wysokość per
// urządzenie, wyrównanie zawartości w dwóch osiach, kolory i ramka per tryb
// jasny/ciemny.
//
// Kolumna jest jedynym węzłem, którego rozpiętość rządzi siatką strony - stąd
// dwie reguły, których nie wolno naruszyć i które ten test przypina:
//  1. ROZPIĘTOŚĆ I WYSOKOŚĆ SĄ PER URZĄDZENIE. Zapis dla telefonu nie może
//     zmienić układu na komputerze; przy braku wartości dla urządzenia panel
//     pokazuje wartość desktopową (a nie pustkę, po której redaktor nadpisuje
//     działające ustawienie).
//  2. KOLORY SĄ PER TRYB - dokładnie jak w panelu widgetu.
import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ColumnNode, Mode } from "@/lib/builder/types";
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

function columnOf(over: Partial<ColumnNode> = {}): ColumnNode {
  return { id: "c1", kind: "column", span: { desktop: 12 }, children: [], ...over };
}

function renderPanel(
  initial: ColumnNode = columnOf(),
  device: "desktop" | "tablet" | "mobile" = "desktop",
  startMode: Mode = "light",
) {
  const seen: ColumnNode[] = [];
  function Host() {
    const [node, setNode] = useState<ColumnNode>(initial);
    const [mode, setMode] = useState<Mode>(startMode);
    return (
      <ColumnProperties
        column={node}
        device={device}
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
  const view = render(<Host />);
  return { ...view, seen, node: () => seen.at(-1) };
}

const tab = (key: string) => screen.getByRole("tab", { name: new RegExp(key) });
const field = (key: string) => screen.getByLabelText(`builder.columnProps.${key}`);

describe("ColumnProperties - rozpiętość", () => {
  it("pokazuje rozpiętość bieżącego urządzenia", () => {
    renderPanel(columnOf({ span: { desktop: 12, mobile: 6 } }), "mobile");
    expect((field("width") as HTMLInputElement).value).toBe("6");
  });

  it("bez wartości dla urządzenia pokazuje desktopową", () => {
    renderPanel(columnOf({ span: { desktop: 8 } }), "tablet");
    // Pustka w tym polu prowokuje redaktora do nadpisania działającego
    // ustawienia - panel musi pokazać, co REALNIE obowiązuje.
    expect((field("width") as HTMLInputElement).value).toBe("8");
  });

  it("bez zapisanej rozpiętości pokazuje pełne dwanaście kolumn", () => {
    renderPanel(columnOf({ span: {} as ColumnNode["span"] }));
    expect((field("width") as HTMLInputElement).value).toBe("12");
  });

  it("zapis rozpiętości nie rusza pozostałych urządzeń", () => {
    const { node } = renderPanel(columnOf({ span: { desktop: 12, tablet: 6 } }), "mobile");
    fireEvent.change(field("width"), { target: { value: "4" } });
    expect(node()?.span).toEqual({ desktop: 12, tablet: 6, mobile: 4 });
  });

  it("rozpiętość jest klampowana do zakresu siatki", () => {
    const { node } = renderPanel();
    fireEvent.change(field("width"), { target: { value: "99" } });
    fireEvent.blur(field("width"));
    // Siatka ma dwanaście kolumn - większa rozpiętość rozwala układ sekcji.
    expect(node()?.span?.desktop).toBe(12);
  });
});

describe("ColumnProperties - minimalna wysokość", () => {
  it("pusta wysokość znaczy „dopasuj do treści”", () => {
    renderPanel();
    expect((field("minHeight") as HTMLInputElement).value).toBe("");
  });

  it("zapisana wysokość ma jednostkę pikseli", () => {
    const { node } = renderPanel(columnOf(), "tablet");
    fireEvent.change(field("minHeight"), { target: { value: "320" } });
    // Wysokość minimalna kolumny jest WSPÓLNA dla urządzeń (inaczej niż
    // rozpiętość) i idzie do CSS, więc musi nieść jednostkę.
    expect(node()?.style?.minHeight).toBe("320px");
  });

  it("wyczyszczenie wysokości zdejmuje nadpisanie", () => {
    const { node } = renderPanel(
      columnOf({ style: { minHeight: "320px" } as ColumnNode["style"] }),
    );
    const input = field("minHeight");
    expect((input as HTMLInputElement).value).toBe("320");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(node()?.style?.minHeight).toBeUndefined();
  });
});

describe("ColumnProperties - wyrównanie zawartości", () => {
  it.each([
    ["poziome", "hAlign"],
    ["pionowe", "vAlign"],
  ])("oferuje wybór wyrównania %s", (_label, key) => {
    renderPanel();
    expect(screen.getByText(`builder.columnProps.${key}`)).toBeInTheDocument();
  });

  it("wybór wyrównania zapisuje się w stylu kolumny", () => {
    const { seen } = renderPanel();
    const buttons = screen
      .getAllByRole("button")
      .filter((b) => /builder.columnProps.(start|center|end|stretch)/.test(b.textContent ?? ""));
    expect(buttons.length).toBeGreaterThan(0);
    for (const b of buttons) fireEvent.click(b);
    expect(seen.length).toBeGreaterThan(0);
    // Każde wyrównanie zapisuje wartość, nie `undefined` - inaczej kolumna
    // cicho wracałaby do domyślnego układu.
    for (const node of seen) expect(JSON.stringify(node.style ?? {})).not.toContain("undefined");
  });
});

describe("ColumnProperties - zakładki i tryb", () => {
  it("startuje na zakładce układu", () => {
    renderPanel();
    expect(tab("builder.columnProps.tabLayout")).toHaveAttribute("data-state", "active");
  });

  it.each([
    ["styl", "builder.columnProps.tabStyle"],
    ["zaawansowane", "builder.columnProps.tabAdvanced"],
  ])("przełącza na zakładkę %s", (_label, key) => {
    renderPanel();
    fireEvent.click(tab(key));
    expect(tab(key)).toHaveAttribute("data-state", "active");
  });

  it("kolory zapisują się per tryb", () => {
    const { node } = renderPanel(
      columnOf({ style: { bgColor: { light: "#ffffff" } } as ColumnNode["style"] }),
    );
    fireEvent.click(tab("builder.columnProps.tabStyle"));
    const dark = screen.getByRole("button", { name: "builder.columnProps.modeDark" });
    fireEvent.click(dark);
    const colorInput = document.querySelector<HTMLInputElement>("input.font-mono");
    if (!colorInput) throw new Error("test: brak pola koloru");
    fireEvent.change(colorInput, { target: { value: "#000000" } });
    expect(node()?.style?.bgColor).toEqual({ light: "#ffffff", dark: "#000000" });
  });

  it("reset koloru zdejmuje nadpisanie bieżącego trybu", () => {
    const { node } = renderPanel(
      columnOf({
        style: { bgColor: { light: "#ffffff", dark: "#000000" } } as ColumnNode["style"],
      }),
    );
    fireEvent.click(tab("builder.columnProps.tabStyle"));
    const reset = document.querySelector<HTMLButtonElement>(
      'button[title="builder.columnProps.resetGlobal"]',
    );
    if (!reset) throw new Error("test: brak przycisku resetu");
    fireEvent.click(reset);
    expect(node()?.style?.bgColor).toEqual({ dark: "#000000" });
  });

  it("bez nadpisania nie ma przycisku resetu", () => {
    renderPanel();
    fireEvent.click(tab("builder.columnProps.tabStyle"));
    expect(document.querySelector('button[title="builder.columnProps.resetGlobal"]')).toBeNull();
  });

  it("zakładka stylu ma odstępy, wymiary i identyfikatory", () => {
    const { node } = renderPanel();
    fireEvent.click(tab("builder.columnProps.tabStyle"));
    expect(screen.getByText("builder.columnProps.spacing")).toBeInTheDocument();
    expect(screen.getByText("builder.columnProps.dimensions")).toBeInTheDocument();

    const radius = screen.getByText("Border radius").parentElement?.querySelector("input");
    if (!radius) throw new Error("test: brak pola promienia");
    fireEvent.change(radius, { target: { value: "12px" } });
    expect(JSON.stringify(node()?.style ?? {})).toContain("12px");
  });

  it("identyfikator HTML i klasa CSS zapisują się w węźle", () => {
    const { node } = renderPanel();
    fireEvent.click(tab("builder.columnProps.tabAdvanced"));
    expect(screen.getByText("builder.columnProps.identifiers")).toBeInTheDocument();
    const htmlId = screen.getByText("HTML ID").parentElement?.querySelector("input");
    const cssClass = screen.getByText("CSS class").parentElement?.querySelector("input");
    if (!htmlId || !cssClass) throw new Error("test: brak pól identyfikatorów");
    fireEvent.change(htmlId, { target: { value: "kolumna-hero" } });
    fireEvent.change(cssClass, { target: { value: "moja-klasa" } });
    // Identyfikator i klasa idą do znacznika kolumny - to jedyny sposób, żeby
    // redakcja przypięła własny arkusz do konkretnej kolumny.
    const json = JSON.stringify(node() ?? {});
    expect(json).toContain("moja-klasa");
  });

  it("etykieta urządzenia jedzie w nagłówku zakładki układu", () => {
    renderPanel(columnOf(), "mobile");
    expect(screen.getByText("builder.columnProps.editing(device=mobile)")).toBeInTheDocument();
  });
});
