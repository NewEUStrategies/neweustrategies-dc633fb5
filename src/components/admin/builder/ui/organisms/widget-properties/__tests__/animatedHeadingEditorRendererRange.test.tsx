// AnimatedHeadingEditor: czas i opóźnienie animacji pokazują i zapisują to,
// co RYSUJE renderer.
//
// `AnimatedHeadingRender` domyka czas od dołu (`Math.max(300, …)`) i opóźnienie
// (`Math.max(0, …)`), a panel zapisywał `Number(v) || domyślna` bez klamry:
// czas 100 ms w panelu był na kanwie animacją 300 ms. Wyczyszczenie pola
// w trakcie pisania wstawiało od razu 1600, więc „2500" wpisywane od zera
// zamieniało się w „16002500". Górnej granicy renderer NIE ma - panel też jej
// nie wymyśla.
import { describe, it, expect, vi, afterEach } from "vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Json, WidgetNode } from "@/lib/builder/types";
import { AnimatedHeadingEditor } from "../AnimatedHeadingEditor";

vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const { radixSelectStub } = await import("@/test/reactStubs");
  return radixSelectStub(React);
});
vi.mock("../../../molecules/DynamicTagInserter", () => ({
  DynamicTagInserter: () => <span data-testid="wstaw-znacznik" />,
}));
vi.mock("../../../molecules/LinkPicker", () => ({
  LinkPicker: () => <span data-testid="link-picker" />,
}));

type Content = WidgetNode["content"];

function renderEditor(initial: Content) {
  const written: Array<[string, Json]> = [];
  function Host() {
    const [content, setContent] = useState<Content>(initial);
    return (
      <AnimatedHeadingEditor
        c={content}
        lang="pl"
        setContent={(k, v) => {
          written.push([k, v]);
          setContent((prev) => ({ ...prev, [k]: v }));
        }}
      />
    );
  }
  render(<Host />);
  const writesOf = (key: string): Json[] => written.filter(([k]) => k === key).map(([, v]) => v);
  return { written, writesOf };
}

function fieldUnder(label: string): HTMLInputElement {
  const box = screen.getByText(label, { selector: "label" }).parentElement;
  const input = box?.querySelector("input");
  if (!input) throw new Error(`test: brak pola pod etykietą „${label}"`);
  return input;
}

afterEach(cleanup);

describe("AnimatedHeadingEditor - czas i opóźnienie jak w rendererze", () => {
  it("czas poniżej 300 ms i ujemne opóźnienie pokazują wartości, które rysuje kanwa", () => {
    const { written } = renderEditor({ mode: "highlight", durationMs: 100, delayMs: -50 });
    expect(fieldUnder("Czas animacji (ms)").value).toBe("300");
    expect(fieldUnder("Opóźnienie startu (ms)").value).toBe("0");
    expect(written).toEqual([]);
  });

  it("czas wpisany poniżej 300 ms jest domykany przy wyjściu z pola", () => {
    const { writesOf } = renderEditor({ mode: "highlight", durationMs: 1600 });
    const duration = fieldUnder("Czas animacji (ms)");
    fireEvent.focus(duration);
    fireEvent.change(duration, { target: { value: "100" } });
    expect(writesOf("durationMs")).toEqual([]);
    fireEvent.blur(duration);
    expect(writesOf("durationMs")).toEqual([300]);
    expect(duration.value).toBe("300");
  });

  it("tryby hover domykają czas tą samą granicą renderera", () => {
    const { writesOf } = renderEditor({ mode: "hover-underline", shape: "hover-line-1" });
    const duration = fieldUnder("Czas animacji (ms)");
    fireEvent.focus(duration);
    fireEvent.change(duration, { target: { value: "150" } });
    fireEvent.keyDown(duration, { key: "Enter" });
    expect(writesOf("durationMs")).toEqual([300]);
  });

  it("wyczyszczenie pola nie wstawia 1600 - czas da się wpisać od zera i nie ma sufitu", () => {
    const { writesOf } = renderEditor({ mode: "highlight", durationMs: 2000 });
    const duration = fieldUnder("Czas animacji (ms)");
    fireEvent.focus(duration);
    fireEvent.change(duration, { target: { value: "" } });
    expect(duration.value).toBe("");
    for (const typed of ["2", "25", "250", "2500", "25000"]) {
      fireEvent.change(duration, { target: { value: typed } });
      expect(duration.value).toBe(typed);
    }
    expect(writesOf("durationMs")).toEqual([2500, 25000]);
  });
});
