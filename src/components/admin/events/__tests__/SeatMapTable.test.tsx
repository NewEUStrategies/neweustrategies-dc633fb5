// Molekuła „widok tabeli planu sali" - równorzędna droga do każdego miejsca.
//
// CO TEN PLIK DOWODZI.
//   1. Wiersze idą w kolejności planu: sekcja po sekcji, w sekcji po `sort_key`
//      (nie w kolejności, w jakiej baza oddała miejsca).
//   2. Kategoria to nadpisanie miejsca albo kategoria sekcji, w języku
//      interfejsu; brak kategorii ma własny napis.
//   3. Akcje zależą od stanu: zajęte - „zwolnij", wolne przy wybranej osobie -
//      „posadź", zablokowane - nic. Zaznaczenie idzie przez pole wyboru
//      z nazwą miejsca.
//   4. Pusta mapa mówi to zdaniem, a tabela ma podpis dla czytnika.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

const h = vi.hoisted(() => ({ lang: "pl" }));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.lang),
);
vi.mock("@/lib/i18n-admin-event-seating", () => ({ ensureSeatingI18n: () => undefined }));

import {
  SeatMapTable,
  type SeatMapTableProps,
} from "@/components/admin/events/molecules/SeatMapTable";
import type { Seat } from "@/lib/events/seatingApi";
import { seat, seatMapDetail } from "@/test/events/seatingFixtures";

function tabela(over: Partial<SeatMapTableProps> = {}) {
  const detail = over.detail ?? seatMapDetail();
  const props: SeatMapTableProps = {
    detail,
    selected: new Set(),
    occupantBySeat: new Map(detail.assignments.map((a) => [a.seatId, a])),
    labelFor: (s: Seat) => `miejsce ${s.id}`,
    canAssign: false,
    onToggle: vi.fn(),
    onAssign: vi.fn(),
    onRelease: vi.fn(),
    ...over,
  };
  render(<SeatMapTable {...props} />);
  const wiersz = (id: string) =>
    screen.getByRole("cell", { name: `miejsce ${id}` }).closest("tr") as HTMLElement;
  return { props, wiersz };
}

describe("SeatMapTable", () => {
  it("wiersze idą w kolejności planu, z kategorią, stanem i osobą", () => {
    h.lang = "pl";
    const detail = seatMapDetail();
    detail.seats = [...detail.seats].reverse();
    const { wiersz } = tabela({ detail });

    const kolejnosc = screen
      .getAllByRole("row")
      .slice(1)
      .map((row) => within(row).getAllByRole("cell")[1]?.textContent);
    expect(kolejnosc).toEqual([
      "miejsce seat-a1",
      "miejsce seat-a2",
      "miejsce seat-a3",
      "miejsce seat-t1",
      "miejsce seat-t2",
    ]);
    const a2 = within(wiersz("seat-a2")).getAllByRole("cell");
    expect(a2.map((cell) => cell.textContent).slice(2, 5)).toEqual([
      "Strefa VIP",
      "adminEventSeating.seatStatus.available",
      "Anna Kowalska",
    ]);
    const t1 = within(wiersz("seat-t1")).getAllByRole("cell");
    expect(t1.map((cell) => cell.textContent).slice(2, 5)).toEqual([
      "adminEventSeating.table.noCategory",
      "adminEventSeating.seatStatus.held",
      "adminEventSeating.table.nobody",
    ]);
    expect(screen.getByText("adminEventSeating.table.caption(name=Gala)")).toBeTruthy();
  });

  it("nazwa kategorii idzie w języku interfejsu, a nadpisanie miejsca wygrywa z sekcją", () => {
    h.lang = "en";
    const detail = seatMapDetail({
      seats: [seat({ categoryId: "cat-vip" }), seat({ id: "seat-a2", categoryId: "cat-nieznana" })],
      assignments: [],
    });
    const { wiersz } = tabela({ detail });

    expect(within(wiersz("seat-a1")).getByText("VIP zone")).toBeTruthy();
    expect(
      within(wiersz("seat-a2")).getByText("adminEventSeating.table.noCategory"),
    ).toBeTruthy();
  });

  it("zajęte - zwolnij; wolne przy wybranej osobie - posadź; zablokowane - nic", () => {
    h.lang = "pl";
    const { wiersz, props } = tabela({ canAssign: true });

    fireEvent.click(within(wiersz("seat-a2")).getByRole("button", { name: "adminEventSeating.table.release" }));
    fireEvent.click(within(wiersz("seat-a1")).getByRole("button", { name: "adminEventSeating.table.assign" }));
    expect(within(wiersz("seat-a3")).queryByRole("button")).toBeNull();
    expect(props.onRelease).toHaveBeenCalledWith("seat-a2");
    expect(props.onAssign).toHaveBeenCalledWith("seat-a1");
  });

  it("bez wybranej osoby wolne miejsce nie ma przycisku „posadź”", () => {
    const { wiersz } = tabela();
    expect(within(wiersz("seat-a1")).queryByRole("button")).toBeNull();
  });

  it("zaznaczenie idzie przez pole wyboru z nazwą miejsca", () => {
    const { wiersz, props } = tabela({ selected: new Set(["seat-a1"]) });

    const pole = screen.getByRole("checkbox", {
      name: "adminEventSeating.table.select(seat=miejsce seat-a1)",
    });
    expect(pole.getAttribute("aria-checked")).toBe("true");
    expect(wiersz("seat-a1").getAttribute("data-state")).toBe("selected");
    expect(wiersz("seat-a2").getAttribute("data-state")).toBeNull();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "adminEventSeating.table.select(seat=miejsce seat-a2)" }),
    );
    expect(props.onToggle).toHaveBeenCalledWith("seat-a2");
  });

  it("plan bez miejsc mówi to zdaniem zamiast pustej tabeli", () => {
    tabela({ detail: seatMapDetail({ seats: [], assignments: [] }) });
    expect(screen.getByText("adminEventSeating.table.empty")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
});
