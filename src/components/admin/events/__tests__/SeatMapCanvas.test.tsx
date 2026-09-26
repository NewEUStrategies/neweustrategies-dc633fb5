// Molekuła „płótno planu sali" - parametry sekcji zamienione na obraz.
//
// CO TEN PLIK DOWODZI.
//   1. Miejsca są PRZENIESIONE na plan (`toMapPoint`: początek i obrót sekcji),
//      a kolor idzie z kategorii miejsca, potem sekcji, a bez kategorii -
//      neutralny token. Stan zajęcia bierze się z przydziałów, nie z miejsca.
//   2. JEDEN cel upuszczenia na całe płótno, z pierścieniem przy najechaniu.
//   3. KLAWIATURA: jedno miejsce w tabulacji (pierwsze w kolejności czytania),
//      strzałki przenoszą fokus i przystanek, Enter / spacja aktywują,
//      Shift+Enter rozszerza, Delete / Backspace zwalnia; inne klawisze nic.
//   4. Płótno jest nazwaną grupą z instrukcją dla czytnika; scena ma podpis,
//      a plan bez sceny - nie. Kadr obejmuje cały plan i to, co z niego wystaje.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({ isOver: false, dropIds: [] as string[] }));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-admin-event-seating", () => ({ ensureSeatingI18n: () => undefined }));
vi.mock("@dnd-kit/core", () => ({
  useDroppable: ({ id }: { id: string }) => {
    h.dropIds.push(id);
    return { setNodeRef: () => undefined, isOver: h.isOver };
  },
}));

import {
  SEAT_CANVAS_DROP_ID,
  SeatMapCanvas,
  type SeatMapCanvasProps,
} from "@/components/admin/events/molecules/SeatMapCanvas";
import type { Seat } from "@/lib/events/seatingApi";
import {
  seat,
  seatAssignment,
  seatCategory,
  seatMapDetail,
  seatSection,
} from "@/test/events/seatingFixtures";

beforeEach(() => {
  h.isOver = false;
  h.dropIds = [];
});

function plotno(over: Partial<SeatMapCanvasProps> = {}) {
  const detail = over.detail ?? seatMapDetail();
  const props: SeatMapCanvasProps = {
    detail,
    selected: new Set(),
    occupantBySeat: new Map(detail.assignments.map((a) => [a.seatId, a])),
    labelFor: (s: Seat) => `miejsce ${s.id}`,
    onActivate: vi.fn(),
    onRelease: vi.fn(),
    ...over,
  };
  const view = render(<SeatMapCanvas {...props} />);
  const miejsce = (id: string) =>
    view.container.querySelector(`[data-seat-id="${id}"]`) as SVGGElement;
  const cialo = (id: string) => [...miejsce(id).querySelectorAll("circle")].at(-1) as SVGElement;
  return { ...view, props, miejsce, cialo };
}

describe("SeatMapCanvas - obraz planu", () => {
  it("przenosi miejsca na plan i koloruje je kategorią miejsca albo sekcji", () => {
    const { cialo, miejsce } = plotno();

    // Sekcja A zaczyna się w (100, 200); miejsce A2 leży 50 dalej.
    expect(cialo("seat-a2").getAttribute("cx")).toBe("150");
    expect(cialo("seat-a2").getAttribute("cy")).toBe("200");
    // Sekcja A ma kategorię VIP, stół - żadnej.
    expect(cialo("seat-a1").getAttribute("stroke")).toBe("#AA3355");
    expect(cialo("seat-t2").getAttribute("stroke")).toBe("currentColor");
    // Zajęcie z przydziałów: A2 ma osobę, A1 - nie.
    expect(miejsce("seat-a2").getAttribute("data-occupied")).toBe("true");
    expect(miejsce("seat-a1").getAttribute("data-occupied")).toBe("false");
    expect(miejsce("seat-a3").getAttribute("data-status")).toBe("blocked");
    expect(miejsce("seat-a1").getAttribute("aria-label")).toBe("miejsce seat-a1");
  });

  it("kategoria MIEJSCA wygrywa z kategorią sekcji, a nieznana daje neutralny token", () => {
    const detail = seatMapDetail({
      categories: [seatCategory(), seatCategory({ id: "cat-press", color: "#00AA00" })],
      seats: [
        seat({ categoryId: "cat-press" }),
        seat({ id: "seat-a2", x: 50, sortKey: 1, categoryId: "cat-usunieta" }),
      ],
    });
    const { cialo } = plotno({ detail });

    expect(cialo("seat-a1").getAttribute("stroke")).toBe("#00AA00");
    expect(cialo("seat-a2").getAttribute("stroke")).toBe("currentColor");
  });

  it("obrót sekcji obraca miejsca wokół jej początku", () => {
    const detail = seatMapDetail({
      sections: [seatSection({ rotationDeg: 90 })],
      seats: [seat({ id: "seat-a2", x: 50 })],
      assignments: [],
    });
    const { cialo } = plotno({ detail });

    expect(cialo("seat-a2").getAttribute("cx")).toBe("100");
    expect(cialo("seat-a2").getAttribute("cy")).toBe("250");
  });

  it("zaznaczone miejsca mają pierścień, a plan jest nazwaną grupą z instrukcją", () => {
    const { miejsce, container } = plotno({ selected: new Set(["seat-a1"]) });

    expect(miejsce("seat-a1").getAttribute("aria-pressed")).toBe("true");
    expect(miejsce("seat-a2").getAttribute("aria-pressed")).toBe("false");
    const grupa = screen.getByRole("group", { name: "adminEventSeating.canvas.label(name=Gala)" });
    const opis = document.getElementById(grupa.getAttribute("aria-describedby") ?? "");
    expect(opis?.textContent).toBe("adminEventSeating.canvas.instructions");
    expect(screen.getByText("adminEventSeating.canvas.stage")).toBeTruthy();
    // Podpisy sekcji: A oraz stół 5.
    const podpisy = [...container.querySelectorAll("g[data-section-id] > text")];
    expect(podpisy.map((node) => node.textContent)).toEqual(["A", "5"]);
    // Kadr: cały plan 1200x800 plus margines podziałki (50) nad sceną w y=20.
    expect(grupa.getAttribute("viewBox")).toBe("0 -30 1200 830");
  });

  it("plan bez sceny nie ma podpisu sceny, a sekcja bez miejsc - żadnego krzesła", () => {
    const detail = seatMapDetail({
      sections: [seatSection({ id: "pusta" })],
      seats: [],
      assignments: [],
    });
    detail.map = { ...detail.map, stage: null };
    const { container } = plotno({ detail });

    expect(screen.queryByText("adminEventSeating.canvas.stage")).toBeNull();
    expect(container.querySelectorAll("[data-seat-id]")).toHaveLength(0);
  });

  it("plan bez sekcji liczy margines domyślną podziałką", () => {
    const detail = seatMapDetail({ sections: [], seats: [], assignments: [] });
    detail.map = { ...detail.map, stage: { x: -10, y: 0, w: 100, h: 10 } };
    plotno({ detail });

    // Scena wystaje w lewo o 10, margines 50 -> kadr zaczyna się w -60.
    expect(screen.getByRole("group").getAttribute("viewBox")).toBe("-60 -50 1260 850");
  });

  it("jeden cel upuszczenia na całe płótno, z pierścieniem przy najechaniu", () => {
    const { container, rerender, props } = plotno();
    expect(new Set(h.dropIds)).toEqual(new Set([SEAT_CANVAS_DROP_ID]));
    expect((container.firstChild as HTMLElement).className).not.toContain("ring-2");

    h.isOver = true;
    rerender(<SeatMapCanvas {...props} />);
    expect((container.firstChild as HTMLElement).className).toContain("ring-2");
  });
});

describe("SeatMapCanvas - klawiatura", () => {
  it("jedno miejsce w tabulacji - pierwsze w kolejności czytania", () => {
    const { container, miejsce } = plotno();

    const przystanki = [...container.querySelectorAll('[data-seat-id][tabindex="0"]')];
    expect(przystanki).toEqual([miejsce("seat-a1")]);
  });

  it("strzałki przenoszą fokus i przystanek, także przez granicę sekcji", () => {
    const { miejsce } = plotno();

    fireEvent.keyDown(miejsce("seat-a1"), { key: "ArrowRight" });
    expect(document.activeElement).toBe(miejsce("seat-a2"));
    expect(miejsce("seat-a2").getAttribute("tabindex")).toBe("0");
    expect(miejsce("seat-a1").getAttribute("tabindex")).toBe("-1");

    fireEvent.keyDown(miejsce("seat-a2"), { key: "End" });
    expect(document.activeElement).toBe(miejsce("seat-t2"));
    fireEvent.keyDown(miejsce("seat-t2"), { key: "ArrowUp" });
    expect(document.activeElement).toBe(miejsce("seat-t1"));
    fireEvent.keyDown(miejsce("seat-t1"), { key: "ArrowLeft" });
    expect(document.activeElement).toBe(miejsce("seat-a3"));
  });

  it("fokus myszą (albo tabulacją) ustawia przystanek na tym miejscu", () => {
    const { miejsce } = plotno();

    fireEvent.focus(miejsce("seat-a3"));
    expect(miejsce("seat-a3").getAttribute("tabindex")).toBe("0");
  });

  it("przystanek wraca na pierwsze miejsce, gdy zapamiętane zniknęło z planu", () => {
    const { miejsce, rerender, props } = plotno();
    fireEvent.focus(miejsce("seat-a3"));

    const detail = seatMapDetail();
    detail.seats = detail.seats.filter((s) => s.id !== "seat-a3");
    rerender(<SeatMapCanvas {...props} detail={detail} />);
    expect(miejsce("seat-a1").getAttribute("tabindex")).toBe("0");
  });

  it("Enter i spacja aktywują, Shift+Enter rozszerza, Delete i Backspace zwalniają", () => {
    const { miejsce, props } = plotno();

    fireEvent.keyDown(miejsce("seat-a2"), { key: "Enter" });
    fireEvent.keyDown(miejsce("seat-a2"), { key: " " });
    fireEvent.keyDown(miejsce("seat-a2"), { key: "Enter", shiftKey: true });
    fireEvent.keyDown(miejsce("seat-a2"), { key: "Delete" });
    fireEvent.keyDown(miejsce("seat-a2"), { key: "Backspace" });
    fireEvent.keyDown(miejsce("seat-a2"), { key: "x" });

    expect(vi.mocked(props.onActivate).mock.calls).toEqual([
      ["seat-a2", false],
      ["seat-a2", false],
      ["seat-a2", true],
    ]);
    expect(vi.mocked(props.onRelease).mock.calls).toEqual([["seat-a2"], ["seat-a2"]]);
  });

  it("kliknięcie aktywuje miejsce", () => {
    const { miejsce, props } = plotno();
    fireEvent.click(miejsce("seat-t1"));
    expect(props.onActivate).toHaveBeenCalledWith("seat-t1", false);
  });
});

it("przydział spoza planu nie zmienia żadnego miejsca w zajęte", () => {
  const detail = seatMapDetail();
  const { miejsce } = plotno({
    detail,
    occupantBySeat: new Map([["obce", seatAssignment({ seatId: "obce" })]]),
  });
  expect(miejsce("seat-a2").getAttribute("data-occupied")).toBe("false");
});
