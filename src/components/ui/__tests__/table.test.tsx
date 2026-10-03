// Tabela zachowuje natywną semantykę `<table>`: czytnik ekranu ogłasza liczbę
// wierszy i kolumn i wiąże komórki z nagłówkami. Prymityw dokłada tylko
// przewijany kontener i klasy oparte na tokenach motywu (`text-muted-foreground`,
// `bg-muted`), wspólne dla jasnego i ciemnego motywu.
import { createRef } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../table";

afterEach(cleanup);

function Sample({ selected = false }: { selected?: boolean }) {
  return (
    <Table aria-label="Wydarzenia">
      <TableHeader>
        <TableRow>
          <TableHead>Nazwa</TableHead>
          <TableHead>Data</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow data-state={selected ? "selected" : undefined}>
          <TableCell>Forum</TableCell>
          <TableCell>12.10</TableCell>
        </TableRow>
        <TableRow>
          <TableCell>Gala</TableCell>
          <TableCell>20.11</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}

describe("Table", () => {
  it("wystawia pełną semantykę tabeli: nagłówki kolumn, grupy wierszy i komórki", () => {
    render(<Sample />);
    const table = screen.getByRole("table", { name: "Wydarzenia" });
    const groups = within(table).getAllByRole("rowgroup");
    expect(groups.map((g) => g.tagName)).toEqual(["THEAD", "TBODY"]);
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((h) => h.textContent),
    ).toEqual(["Nazwa", "Data"]);
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(within(table).getAllByRole("cell")).toHaveLength(4);
  });

  it("owija tabelę w kontener przewijany poziomo, żeby szerokie dane nie rozpychały strony", () => {
    render(<Sample />);
    const table = screen.getByRole("table");
    const wrapper = table.parentElement as HTMLElement;
    expect(wrapper.tagName).toBe("DIV");
    expect(wrapper).toHaveClass("relative", "w-full", "overflow-auto");
    expect(table).toHaveClass("w-full", "caption-bottom", "text-sm");
  });

  it("wyróżnia zaznaczony wiersz tokenem tła zależnym od motywu", () => {
    render(<Sample selected />);
    const [, first, second] = screen.getAllByRole("row");
    expect(first).toHaveAttribute("data-state", "selected");
    expect(first).toHaveClass("data-[state=selected]:bg-muted", "hover:bg-muted/50", "border-b");
    expect(second).not.toHaveAttribute("data-state");
  });

  it("stylizuje nagłówek i komórkę tokenami motywu i scala klasy wywołującego", () => {
    render(
      <Table>
        <TableHeader className="bg-card">
          <TableRow className="border-0">
            <TableHead className="text-right">Kwota</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="font-mono">
          <TableRow>
            <TableCell className="p-4">100</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    const head = screen.getByRole("columnheader");
    expect(head).toHaveClass("text-muted-foreground", "font-medium", "text-right");
    expect(head).not.toHaveClass("text-left");
    const cell = screen.getByRole("cell");
    expect(cell).toHaveClass("p-4", "align-middle");
    expect(cell).not.toHaveClass("p-2");
    const [thead, tbody] = screen.getAllByRole("rowgroup");
    expect(thead).toHaveClass("bg-card", "[&_tr]:border-b");
    expect(tbody).toHaveClass("font-mono", "[&_tr:last-child]:border-0");
    expect(screen.getAllByRole("row")[0]).toHaveClass("border-0");
  });

  it("przekazuje ref każdego elementu do właściwego węzła tabeli", () => {
    const table = createRef<HTMLTableElement>();
    const header = createRef<HTMLTableSectionElement>();
    const body = createRef<HTMLTableSectionElement>();
    const row = createRef<HTMLTableRowElement>();
    const head = createRef<HTMLTableCellElement>();
    const cell = createRef<HTMLTableCellElement>();
    render(
      <Table ref={table}>
        <TableHeader ref={header}>
          <TableRow ref={row}>
            <TableHead ref={head}>A</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody ref={body}>
          <TableRow>
            <TableCell ref={cell}>1</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    expect(table.current?.tagName).toBe("TABLE");
    expect(header.current?.tagName).toBe("THEAD");
    expect(body.current?.tagName).toBe("TBODY");
    expect(row.current?.tagName).toBe("TR");
    expect(head.current?.tagName).toBe("TH");
    expect(cell.current?.tagName).toBe("TD");
  });
});
