// WKLEJENIE TABELI NA KANWIE PRZY ZAZNACZONYM BLOKU MAPY DANYCH (PR2, W6).
//
// Schowek kanwy (`useBlockClipboard`) ogłasza tabelę edytorowi aktywnego
// bloku `chart` / `data-map`, a do PR2 tylko edytor wykresu ją przyjmował -
// przy zaznaczonej mapie zakres z Excela dalej stawał się nowym blokiem
// tabeli. Teraz edytor mapy przyjmuje tabelę (`useBlockTablePaste`), pokazuje
// podgląd układu w trybie mapy (kolumna krajów, wartości, obrót) i zastępuje
// dane mapy JEDNYM zapisem dokumentu.
//
// Prawdziwe są: kanwa, hak schowka, dyspozytor edytorów i edytor mapy.
// Atrapy: `sonner` (toasty), Radix `Select` (natywna lista pod happy-dom)
// i rysunek mapy (silnik ma własne testy); zasób geometrii serwuje
// `installWidgetGateFetch` z `public/geo`.
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Block, BlocksDoc } from "@/lib/blocks/types";
import { installWidgetGateFetch } from "@/test/widgetGateEnvironment";

installWidgetGateFetch();

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
vi.mock("@/components/charts/ChoroplethMap", () => ({
  ChoroplethMap: () => <div data-testid="podglad-mapy" />,
}));

const { BlockCanvas } = await import("../BlockCanvas");

const MAPA: Block = {
  id: "m1",
  type: "data-map",
  data: { region: "europe", values: [{ id: "PL", value: 1 }] },
};
const AKAPIT: Block = { id: "p1", type: "paragraph", data: { html: "<p>tekst</p>" } };

function zamontuj(activeId: string) {
  const onChange = vi.fn<(next: BlocksDoc, immediate?: boolean) => void>();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <BlockCanvas
        doc={{ version: 1, blocks: [AKAPIT, MAPA] } as BlocksDoc}
        activeId={activeId}
        onSelect={vi.fn()}
        onChange={onChange}
        selectedIds={[]}
        onSelectedIdsChange={vi.fn()}
      />
    </QueryClientProvider>,
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

/** Tabela Eurostatu: kraje w drugiej kolumnie, lata obok - jak kopiuje ją Excel. */
const TABELA = "Lp.\tKraj\t2023\t2024\n1\tPolska\t5\t6\n2\tCzechy\t7\t8";
/** Ta sama tabela w postaci HTML - tak kładzie ją do schowka Excel. */
const TABELA_HTML =
  "<table><tr><td>Lp.</td><td>Kraj</td><td>2023</td><td>2024</td></tr>" +
  "<tr><td>1</td><td>Polska</td><td>5</td><td>6</td></tr>" +
  "<tr><td>2</td><td>Czechy</td><td>7</td><td>8</td></tr></table>";

describe("kanwa - tabela przy zaznaczonej mapie danych", () => {
  it("trafia do podglądu mapy, a nie do nowego bloku tabeli", () => {
    const { onChange } = zamontuj("m1");
    const ev = wklejNaKanwie(TABELA);
    expect(ev.defaultPrevented).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
    const okno = screen.getByRole("dialog", { name: "Wklejanie tabeli" });
    expect(within(okno).getByRole("combobox", { name: "Kolumna krajów" })).toBeInTheDocument();
  });

  it("„Zastosuj” zastępuje dane mapy jednym zapisem - kraje z kolumny B, wartość z C", () => {
    const { onChange } = zamontuj("m1");
    wklejNaKanwie(TABELA);
    const okno = screen.getByRole("dialog", { name: "Wklejanie tabeli" });
    fireEvent.click(within(okno).getByRole("button", { name: "Zastosuj" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const doc = onChange.mock.calls[0][0];
    expect(doc.blocks.map((b) => b.type)).toEqual(["paragraph", "data-map"]);
    expect(doc.blocks[1].data.values).toEqual([
      { id: "PL", value: 5 },
      { id: "CZ", value: 7 },
    ]);
  });

  it("przy zaznaczonym AKAPICIE tabela zostaje nowym blokiem tabeli (zachowanie dawne)", () => {
    const { onChange } = zamontuj("p1");
    wklejNaKanwie(TABELA, TABELA_HTML);
    expect(screen.queryByRole("dialog")).toBeNull();
    const typy = onChange.mock.calls[0]?.[0].blocks.map((b) => b.type);
    expect(typy).toContain("table");
  });
});
