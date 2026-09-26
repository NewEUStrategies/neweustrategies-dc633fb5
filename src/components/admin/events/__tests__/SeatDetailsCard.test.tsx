// Molekuła „szczegół zaznaczonych miejsc" - kto siedzi i co można zrobić.
//
// CO TEN PLIK DOWODZI.
//   1. Bez zaznaczenia - podpowiedź; kilka miejsc - liczba i akcje zbiorcze
//      (zwolnienie TYLKO zajętych, bez przycisku, gdy żadne nie jest zajęte).
//   2. Jedno miejsce: stan, rezerwacja (firma, potem sponsor, potem zamówienie),
//      uwaga i powód blokady tylko wtedy, gdy są; osoba z firmą i biletem.
//   3. „Posadź <osoba>" tylko przy WOLNYM i NIEZABLOKOWANYM miejscu z wybraną
//      osobą; „zwolnij" tylko przy zajętym.
//   4. Kategoria: „jak w sekcji" to `null`, inna - identyfikator; dostępność
//      idzie przełącznikiem. W trakcie zapisu wszystko jest zgaszone.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-admin-event-seating", () => ({ ensureSeatingI18n: () => undefined }));
vi.mock("@/components/atoms/FormSelect", async () =>
  (await import("@/test/events/seatingUiMocks")).formSelectModule(),
);

import {
  SeatDetailsCard,
  type SeatDetailsCardProps,
} from "@/components/admin/events/molecules/SeatDetailsCard";
import type { Seat } from "@/lib/events/seatingApi";
import { seat, seatAssignment, seatMapDetail } from "@/test/events/seatingFixtures";

const detail = seatMapDetail();
const po = (id: string): Seat => detail.seats.find((s) => s.id === id) ?? seat();

function karta(over: Partial<SeatDetailsCardProps> = {}) {
  const props: SeatDetailsCardProps = {
    seats: [],
    detail,
    occupantBySeat: new Map(detail.assignments.map((a) => [a.seatId, a])),
    labelFor: (s: Seat) => `miejsce ${s.id}`,
    armedName: null,
    busy: false,
    onAssignArmed: vi.fn(),
    onRelease: vi.fn(),
    onEditStatus: vi.fn(),
    onSetAccessible: vi.fn(),
    onSetCategory: vi.fn(),
    ...over,
  };
  const view = render(<SeatDetailsCard {...props} />);
  return { ...view, props };
}

const guzik = (name: string) => screen.getByRole("button", { name });

describe("SeatDetailsCard - bez zaznaczenia i kilka miejsc", () => {
  it("bez zaznaczenia podpowiada, co zrobić", () => {
    karta();
    expect(screen.getByText("adminEventSeating.details.none")).toBeTruthy();
  });

  it("kilka miejsc: liczba, zmiana stanu i zwolnienie TYLKO zajętych", () => {
    const { props } = karta({ seats: [po("seat-a1"), po("seat-a2"), po("seat-a3")] });

    expect(
      screen.getByRole("heading", { name: "adminEventSeating.workspace.selectionCount(count=3)" }),
    ).toBeTruthy();
    fireEvent.click(guzik("adminEventSeating.details.releaseSelected(count=1)"));
    fireEvent.click(guzik("adminEventSeating.details.changeStatus"));
    expect(props.onRelease).toHaveBeenCalledWith(["seat-a2"]);
    expect(props.onEditStatus).toHaveBeenCalledTimes(1);
  });

  it("kilka wolnych miejsc nie ma przycisku zwolnienia", () => {
    karta({ seats: [po("seat-a1"), po("seat-a3")] });
    expect(screen.queryByRole("button", { name: /releaseSelected/ })).toBeNull();
  });
});

describe("SeatDetailsCard - jedno miejsce", () => {
  it("zajęte: osoba z firmą i biletem, zwolnienie, brak „posadź”", () => {
    const { props } = karta({ seats: [po("seat-a2")], armedName: "Jan Nowak" });

    expect(screen.getByRole("heading", { name: "miejsce seat-a2" })).toBeTruthy();
    expect(screen.getByText("Anna Kowalska")).toBeTruthy();
    expect(screen.getByText("Firma Jeden · VIP")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /assignArmed/ })).toBeNull();
    fireEvent.click(guzik("adminEventSeating.details.release"));
    expect(props.onRelease).toHaveBeenCalledWith(["seat-a2"]);
  });

  it("osoba bez firmy i bez biletu nie dostaje pustej linii opisu", () => {
    karta({
      seats: [po("seat-a2")],
      occupantBySeat: new Map([
        [
          "seat-a2",
          seatAssignment({ company: null, ticketNamePl: null, ticketNameEn: null }),
        ],
      ]),
    });
    expect(screen.getByText("Anna Kowalska").parentElement?.childElementCount).toBe(1);
  });

  it("wolne przy wybranej osobie: „posadź <osoba>”", () => {
    const { props } = karta({ seats: [po("seat-a1")], armedName: "Jan Nowak" });

    expect(screen.getByText("adminEventSeating.details.free")).toBeTruthy();
    fireEvent.click(guzik("adminEventSeating.details.assignArmed(name=Jan Nowak)"));
    expect(props.onAssignArmed).toHaveBeenCalledWith("seat-a1");
    expect(screen.queryByRole("button", { name: "adminEventSeating.details.release" })).toBeNull();
  });

  it("zablokowane: powód blokady i brak „posadź” nawet przy wybranej osobie", () => {
    karta({ seats: [po("seat-a3")], armedName: "Jan Nowak" });

    expect(screen.getByText("adminEventSeating.details.blockReason")).toBeTruthy();
    expect(screen.getByText("Filar")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /assignArmed/ })).toBeNull();
  });

  it("rezerwacja pokazuje dla kogo (firma, potem sponsor, potem zamówienie) i uwagę", () => {
    const { rerender, props } = karta({ seats: [po("seat-t1")] });
    expect(screen.getByText("Firma Jeden")).toBeTruthy();
    expect(screen.getByText("Delegacja")).toBeTruthy();

    rerender(
      <SeatDetailsCard
        {...props}
        seats={[
          seat({
            status: "held",
            holdSponsorId: "sp-1",
            holdSponsorName: "Sponsor Złoty",
          }),
        ]}
      />,
    );
    expect(screen.getByText("Sponsor Złoty")).toBeTruthy();

    rerender(
      <SeatDetailsCard
        {...props}
        seats={[seat({ status: "held", holdPackageOrderId: "po-1", holdPackageBuyer: "Kupiec" })]}
      />,
    );
    expect(screen.getByText("Kupiec")).toBeTruthy();

    rerender(<SeatDetailsCard {...props} seats={[seat({ status: "held" })]} />);
    expect(screen.queryByText("adminEventSeating.details.heldFor")).toBeNull();
    expect(screen.queryByText("adminEventSeating.details.note")).toBeNull();
  });

  it("kategoria: „jak w sekcji” to null, a inna - identyfikator kategorii", () => {
    const { props } = karta({ seats: [po("seat-a1")] });

    const lista = screen.getByLabelText("adminEventSeating.details.categoryOverride");
    expect((lista as HTMLSelectElement).value).toBe("__section__");
    fireEvent.change(lista, { target: { value: "cat-vip" } });
    fireEvent.change(lista, { target: { value: "__section__" } });
    expect(vi.mocked(props.onSetCategory).mock.calls).toEqual([
      [["seat-a1"], "cat-vip"],
      [["seat-a1"], null],
    ]);
  });

  it("dostępność idzie przełącznikiem, a zmiana stanu - osobnym oknem", () => {
    const { props } = karta({ seats: [po("seat-t2")] });

    const przelacznik = screen.getByRole("switch", { name: "adminEventSeating.details.accessible" });
    expect(przelacznik.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(przelacznik);
    fireEvent.click(guzik("adminEventSeating.details.changeStatus"));
    expect(props.onSetAccessible).toHaveBeenCalledWith(["seat-t2"], false);
    expect(props.onEditStatus).toHaveBeenCalledTimes(1);
  });

  it("w trakcie zapisu akcje i pola są zgaszone", () => {
    karta({ seats: [po("seat-a2")], busy: true });

    expect(guzik("adminEventSeating.details.release")).toBeDisabled();
    expect(guzik("adminEventSeating.details.changeStatus")).toBeDisabled();
    expect(screen.getByLabelText("adminEventSeating.details.categoryOverride")).toBeDisabled();
    expect(screen.getByRole("switch")).toBeDisabled();
  });
});
