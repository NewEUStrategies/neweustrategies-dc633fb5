// Panel kolumny + publiczny renderer: edycja koloru JASNEGO nie zmienia
// wyglądu kolumny w trybie CIEMNYM.
//
// Kolor płaski widgetu ramka odwraca w dark (decyzja produktowa 2026-10-19,
// rodzina `setInvertibleMode`), ale kolumna jest inna: `columnColor` w
// `BuilderRenderer` czyta płaską przez `pickMode` BEZ odwracania - płaska
// obowiązuje w obu trybach. Gdyby panel kolumny przeszedł na semantykę
// widgetu, edycja jasnego zostawiłaby płaską i ciemny tryb istniejącej strony
// zmieniłby kolor razem z jasnym. Kontrakt: kolumna zostaje przy `setMode`,
// który stempluje dark jego dotychczasową wartością.
//
// Wygląd ciemnego trybu czytamy z kontraktu renderera: kolumna z
// `data-col-bg` bierze w `.dark` zmienną `--nes-col-bg-dark` (reguła w
// `styles.css`), bez znacznika obowiązuje deklaracja inline w obu trybach.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import "@/test/i18nReal";
import { __resetBuilderDebugForTests } from "@/lib/builder/builderDebug";
import { parseColorChannels } from "@/lib/builder/cssColor";
import type { ColumnNode, Mode } from "@/lib/builder/types";
import { BuilderRenderer } from "@/components/builder/organisms/BuilderRenderer";
import {
  column,
  doc,
  section,
  stubObservers,
  widget,
} from "@/components/builder/organisms/__tests__/builderRendererFixtures";
import { ColumnProperties } from "../ColumnProperties";

vi.mock(
  "@/components/builder/organisms/widget-view/lazyWidgets",
  () => import("@/test/eagerWidgetChunks"),
);
// Radix Tabs nie przełącza się pod happy-dom od samego kliknięcia.
vi.mock("@/components/ui/tabs", async () => {
  const React = await import("react");
  const { radixTabsStub } = await import("@/test/builder/panels");
  return radixTabsStub(React);
});

let observers: ReturnType<typeof stubObservers>;

beforeEach(() => {
  observers = stubObservers();
  __resetBuilderDebugForTests();
});

afterEach(() => {
  cleanup();
  observers.restore();
  document.body.innerHTML = "";
});

/** Redakcja zmienia w panelu kolor tła w danym trybie; zwraca kolumnę po zapisie. */
function editBackground(initial: ColumnNode, mode: Mode, value: string): ColumnNode {
  let last = initial;
  function Host() {
    const [node, setNode] = useState<ColumnNode>(initial);
    return (
      <ColumnProperties
        column={node}
        device="desktop"
        mode={mode}
        onChange={(mut) => {
          setNode((prev) => {
            const next = JSON.parse(JSON.stringify(prev)) as ColumnNode;
            mut(next);
            last = next;
            return next;
          });
        }}
      />
    );
  }
  render(<Host />);
  fireEvent.click(screen.getByRole("tab", { name: /tabStyle|Styl|Style/ }));
  // Pierwsze pole koloru sekcji to tło (potem tekst).
  const bg = document.querySelector<HTMLInputElement>("input.font-mono");
  if (!bg) throw new Error("test: brak pola koloru tła kolumny");
  fireEvent.change(bg, { target: { value } });
  cleanup();
  return last;
}

/** Tło kolumny, które renderer rysuje w danym trybie (kanały RGB). */
function renderedBackground(col: ColumnNode, mode: Mode) {
  const el = renderWithQueryClient(
    <BuilderRenderer doc={doc([section("s1", [col])])} lang="pl" />,
  ).container.querySelector<HTMLElement>('[data-col-id="c1"]:not([data-column-slot])');
  if (!el) throw new Error("test: brak kolumny c1");
  const raw = el.hasAttribute("data-col-bg")
    ? el.style.getPropertyValue(mode === "dark" ? "--nes-col-bg-dark" : "--nes-col-bg")
    : el.style.background;
  cleanup();
  const rgba = parseColorChannels(raw.trim());
  if (!rgba) throw new Error(`test: tło niepoliczalne: ${raw}`);
  return { r: rgba.r, g: rgba.g, b: rgba.b };
}

const original = (): ColumnNode =>
  column("c1", [widget("w1")], { style: { bgColor: "#111111" } } as Partial<ColumnNode>);

describe("ColumnProperties + BuilderRenderer - tło kolumny po edycji trybu jasnego", () => {
  it("dark wygląda tak samo jak przed edycją jasnego, a light ma nowy kolor", () => {
    const before = original();
    const darkBefore = renderedBackground(before, "dark");
    const after = editBackground(before, "light", "#222222");
    expect(renderedBackground(after, "light")).toEqual({ r: 34, g: 34, b: 34 });
    expect(renderedBackground(after, "dark")).toEqual(darkBefore);
    expect(darkBefore).toEqual({ r: 17, g: 17, b: 17 });
  });

  it("edycja ciemnego zmienia tylko dark, jasny zostaje", () => {
    const after = editBackground(original(), "dark", "#333333");
    expect(renderedBackground(after, "dark")).toEqual({ r: 51, g: 51, b: 51 });
    expect(renderedBackground(after, "light")).toEqual({ r: 17, g: 17, b: 17 });
  });
});
