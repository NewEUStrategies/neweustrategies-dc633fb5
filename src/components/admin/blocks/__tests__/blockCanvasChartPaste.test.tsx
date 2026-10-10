// WKLEJENIE TABELI NA KANWIE PRZY ZAZNACZONYM BLOKU WYKRESU (PR2).
//
// Do PR2 zakres z Excela wklejony przy zaznaczonym wykresie stawał się NOWYM
// blokiem tabeli pod nim. Teraz schowek kanwy (`useBlockClipboard`) ogłasza
// tabelę edytorowi aktywnego bloku `chart` / `data-map`; edytor wykresu ją
// przyjmuje, pokazuje podgląd układu i zastępuje dane. Gdy aktywny jest
// blok innego typu, zachowanie zostaje dawne (pilnuje go
// `blockCanvasPaste.test.tsx`) - tu sprawdzamy oba końce tej granicy.
//
// Prawdziwe są: kanwa, hak schowka, dyspozytor edytorów i edytor wykresu.
// Atrapy: `sonner` (toasty), Radix `Select` (natywna lista pod happy-dom)
// i rysunek wykresu (silnik ma własne testy).
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { Block, BlocksDoc } from "@/lib/blocks/types";

const toasty = vi.hoisted(() => ({
  success: vi.fn<(msg: string) => void>(),
  error: vi.fn<(msg: string) => void>(),
}));
vi.mock("sonner", () => ({ toast: toasty }));
vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const { radixSelectStub } = await import("@/test/reactStubs");
  return radixSelectStub(React);
});
vi.mock("@/components/charts/Chart", () => ({ Chart: () => <div data-testid="podglad" /> }));

const { BlockCanvas } = await import("../BlockCanvas");

const WYKRES: Block = {
  id: "w1",
  type: "chart",
  data: {
    kind: "bar",
    palette: "categorical",
    categories: ["2023"],
    series: [{ name: "Import", values: [1], colorSlot: 12 }],
  },
};
const AKAPIT: Block = { id: "p1", type: "paragraph", data: { html: "<p>tekst</p>" } };

function zamontuj(activeId: string) {
  const onChange = vi.fn<(next: BlocksDoc, immediate?: boolean) => void>();
  render(
    <BlockCanvas
      doc={{ version: 1, blocks: [AKAPIT, WYKRES] } as BlocksDoc}
      activeId={activeId}
      onSelect={vi.fn()}
      onChange={onChange}
      selectedIds={[]}
      onSelectedIdsChange={vi.fn()}
    />,
  );
  return { onChange };
}

function wklejNaKanwie(text: string, html = "") {
  const kanwa = document.querySelector("[data-block-canvas]");
  if (!kanwa) throw new Error("brak kanwy");
  const ev = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "clipboardData", {
    value: {
      getData: (typ: string) => (typ === "text/plain" ? text : typ === "text/html" ? html : ""),
      setData: () => {},
      files: [],
    },
  });
  act(() => {
    kanwa.dispatchEvent(ev);
  });
  return ev;
}

const TABELA = "\tImport\tEksport\n2021\t5\t6\n2022\t7\t8";
/** Ta sama tabela w postaci HTML - tak kładzie ją do schowka Excel. */
const TABELA_HTML =
  "<table><tr><td></td><td>Import</td><td>Eksport</td></tr>" +
  "<tr><td>2021</td><td>5</td><td>6</td></tr><tr><td>2022</td><td>7</td><td>8</td></tr></table>";

describe("kanwa - tabela przy zaznaczonym wykresie", () => {
  it("trafia do podglądu wykresu, a nie do nowego bloku tabeli", () => {
    const { onChange } = zamontuj("w1");
    const ev = wklejNaKanwie(TABELA);
    expect(ev.defaultPrevented).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Wklejanie tabeli" })).toBeInTheDocument();
  });

  it("„Zastosuj” zastępuje dane wykresu - kolor idzie za nazwą serii", () => {
    const { onChange } = zamontuj("w1");
    wklejNaKanwie(TABELA);
    fireEvent.click(screen.getByRole("button", { name: "Zastosuj" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const doc = onChange.mock.calls[0][0];
    expect(doc.blocks.map((b) => b.type)).toEqual(["paragraph", "chart"]);
    const wykres = doc.blocks[1];
    expect(wykres.data.categories).toEqual(["2021", "2022"]);
    const series = wykres.data.series as Array<{ name: string; colorSlot: number }>;
    expect(series.map((s) => s.name)).toEqual(["Import", "Eksport"]);
    expect(series[0].colorSlot).toBe(12);
  });

  it("tabela HTML z Excela też trafia do podglądu wykresu", () => {
    const { onChange } = zamontuj("w1");
    wklejNaKanwie(TABELA, TABELA_HTML);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Wklejanie tabeli" })).toBeInTheDocument();
  });

  it("przy zaznaczonym AKAPICIE tabela zostaje nowym blokiem tabeli (zachowanie dawne)", () => {
    const { onChange } = zamontuj("p1");
    wklejNaKanwie(TABELA, TABELA_HTML);
    expect(screen.queryByRole("dialog")).toBeNull();
    const typy = onChange.mock.calls[0]?.[0].blocks.map((b) => b.type);
    expect(typy).toContain("table");
  });
});
