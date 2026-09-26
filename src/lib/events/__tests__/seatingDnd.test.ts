// Rozstrzygnięcie celu upuszczenia uczestnika na plan sali.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. Upuszczenie poza płótnem sadza osobę na miejscu spod wskaźnika z innego
//      widoku (np. z tabeli pod spodem).
//   2. Punkt puszczenia bez przesunięcia (`delta`) trafia w miejsce CHWYTU.
//   3. Zdarzenie klawiatury bez współrzędnych zgaduje miejsce.
import { describe, expect, it, vi } from "vitest";

import { seatDropTarget, type SeatDropEvent } from "@/lib/events/seatingDnd";

function drop(overrides: Partial<SeatDropEvent> = {}): SeatDropEvent {
  return {
    over: { id: "canvas" },
    delta: { x: 30, y: -10 },
    activatorEvent: Object.assign(new Event("pointerdown"), { clientX: 100, clientY: 200 }),
    active: { data: { current: { registrationId: "r1", name: "Anna Kowalska" } } },
    ...overrides,
  };
}

function docWith(seatId: string | null) {
  const element =
    seatId === null
      ? null
      : {
          closest: () => ({ getAttribute: (name: string) => (name === "data-seat-id" ? seatId : null) }),
        };
  return { elementFromPoint: vi.fn(() => element as unknown as Element | null) };
}

describe("cel upuszczenia na planie sali", () => {
  it("miejsce spod wskaźnika w punkcie PUSZCZENIA (chwyt + przesunięcie)", () => {
    const doc = docWith("seat-9");
    expect(seatDropTarget(drop(), "canvas", doc)).toEqual({
      seatId: "seat-9",
      registrationId: "r1",
      name: "Anna Kowalska",
    });
    expect(doc.elementFromPoint).toHaveBeenCalledWith(130, 190);
  });

  it("poza płótnem, bez uczestnika, bez współrzędnych i bez miejsca - brak celu", () => {
    const doc = docWith("seat-9");
    expect(seatDropTarget(drop({ over: null }), "canvas", doc)).toBeNull();
    expect(seatDropTarget(drop({ over: { id: "inne" } }), "canvas", doc)).toBeNull();
    expect(seatDropTarget(drop({ active: { data: { current: undefined } } }), "canvas", doc)).toBeNull();
    expect(seatDropTarget(drop({ activatorEvent: new Event("keydown") }), "canvas", doc)).toBeNull();
    expect(
      seatDropTarget(
        drop({ activatorEvent: Object.assign(new Event("x"), { clientX: 1 }) }),
        "canvas",
        doc,
      ),
    ).toBeNull();
    expect(seatDropTarget(drop(), "canvas", docWith(null))).toBeNull();
  });

  it("brak nazwy w danych przeciągania daje pusty napis, nie `undefined`", () => {
    expect(
      seatDropTarget(drop({ active: { data: { current: { registrationId: "r2" } } } }), "canvas", docWith("s")),
    ).toEqual({ seatId: "s", registrationId: "r2", name: "" });
  });
});
