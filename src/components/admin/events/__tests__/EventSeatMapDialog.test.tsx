// Molekuła „formularz planu sali" - nazwa, sala, sesja, rozmiar i scena.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW - każdy punkt to gwarancja, która znika.
//   1. ZAMKNIĘTE OKNO NIE PYTA o sale i sesje (zapytania dostają `null`).
//   2. Nowy plan startuje z domyślnym rozmiarem i sceną; edycja - z danych
//      planu, a odświeżenie listy w tle (nowa referencja tego samego planu)
//      NIE kasuje wpisanej pracy.
//   3. Błędy pojawiają się dopiero po próbie zapisu i blokują wysyłkę; poprawny
//      formularz wysyła ładunek z identyfikatorem wydarzenia (nowy) albo planu.
//   4. „Bez sali” / „całe wydarzenie” to `null`; wyłączona scena to `null`.
//   5. Anuluj zamyka okno; w trakcie zapisu przyciski są zgaszone.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { SeatMapInfo } from "@/lib/events/seatingApi";

const h = vi.hoisted(() => ({
  roomQueries: [] as (string | null)[],
  sessionQueries: [] as unknown[],
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-admin-event-seating", () => ({ ensureSeatingI18n: () => undefined }));
vi.mock("@/components/atoms/FormSelect", async () =>
  (await import("@/test/events/seatingUiMocks")).formSelectModule(),
);
vi.mock("@/components/ui/dialog", async () =>
  (await import("@/test/events/seatingUiMocks")).dialogModule(),
);
vi.mock("@/lib/events/useEventSessions", () => ({
  useEventRooms: (eventId: string | null) => {
    h.roomQueries.push(eventId);
    return { data: eventId === null ? undefined : [{ id: "room-1", name: "Sala Kryształowa" }] };
  },
  useEventSessions: (query: unknown) => {
    h.sessionQueries.push(query);
    return {
      data:
        query === null
          ? undefined
          : [{ id: "ses-1", title_pl: "Gala wieczorna", title_en: "Evening gala" }],
    };
  },
}));

import {
  EventSeatMapDialog,
  type EventSeatMapDialogProps,
} from "@/components/admin/events/molecules/EventSeatMapDialog";
import { SEAT_EVENT_ID, SEAT_MAP_ID } from "@/test/events/seatingFixtures";

const PLAN: SeatMapInfo = {
  id: SEAT_MAP_ID,
  eventId: SEAT_EVENT_ID,
  name: "Gala",
  roomId: "room-1",
  sessionId: "ses-1",
  status: "draft",
  width: 1000,
  height: 700,
  stage: null,
  sortOrder: 1,
  publishedAt: null,
};

beforeEach(() => {
  h.roomQueries = [];
  h.sessionQueries = [];
});

function okno(over: Partial<EventSeatMapDialogProps> = {}) {
  const props: EventSeatMapDialogProps = {
    open: true,
    onOpenChange: vi.fn(),
    eventId: SEAT_EVENT_ID,
    map: null,
    isSaving: false,
    onSubmit: vi.fn(),
    ...over,
  };
  const view = render(<EventSeatMapDialog {...props} />);
  return { ...view, props };
}

const pole = (name: string) => screen.getByLabelText(name) as HTMLInputElement;
const zapisz = () =>
  fireEvent.click(screen.getByRole("button", { name: "adminEventSeating.mapDialog.save" }));

describe("EventSeatMapDialog", () => {
  it("zamknięte okno nie pyta o sale i sesje i nic nie rysuje", () => {
    const { container } = okno({ open: false });
    expect(h.roomQueries).toEqual([null]);
    expect(h.sessionQueries).toEqual([null]);
    expect(container.innerHTML).toBe("");
  });

  it("nowy plan: domyślny rozmiar i scena, błąd nazwy dopiero po próbie zapisu", () => {
    const { props } = okno();

    expect(
      screen.getByRole("heading", { name: "adminEventSeating.mapDialog.createTitle" }),
    ).toBeTruthy();
    expect(pole("adminEventSeating.mapDialog.width").value).toBe("1200");
    expect(pole("adminEventSeating.mapDialog.stageX").value).toBe("400");
    expect(screen.queryByText("adminEventSeating.mapDialog.validation.nameRequired")).toBeNull();

    zapisz();
    expect(screen.getByText("adminEventSeating.mapDialog.validation.nameRequired")).toBeTruthy();
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it("poprawny nowy plan wysyła identyfikator wydarzenia, salę, sesję i scenę", () => {
    const { props } = okno();
    expect(h.roomQueries.at(-1)).toBe(SEAT_EVENT_ID);

    fireEvent.change(pole("adminEventSeating.mapDialog.name"), { target: { value: "  Gala  " } });
    fireEvent.change(pole("adminEventSeating.mapDialog.room"), { target: { value: "room-1" } });
    fireEvent.change(pole("adminEventSeating.mapDialog.session"), { target: { value: "ses-1" } });
    fireEvent.change(pole("adminEventSeating.mapDialog.stageY"), { target: { value: "30" } });
    fireEvent.change(pole("adminEventSeating.mapDialog.stageW"), { target: { value: "300" } });
    fireEvent.change(pole("adminEventSeating.mapDialog.stageH"), { target: { value: "70" } });
    zapisz();

    expect(props.onSubmit).toHaveBeenCalledWith({
      eventId: SEAT_EVENT_ID,
      name: "Gala",
      roomId: "room-1",
      sessionId: "ses-1",
      width: 1200,
      height: 800,
      stage: { x: 400, y: 30, w: 300, h: 70 },
    });
    expect(screen.getByRole("option", { name: "Gala wieczorna" })).toBeTruthy();
  });

  it("scena wychodząca poza plan i rozmiar spoza zakresu blokują zapis", () => {
    const { props } = okno();
    fireEvent.change(pole("adminEventSeating.mapDialog.name"), { target: { value: "Gala" } });
    fireEvent.change(pole("adminEventSeating.mapDialog.height"), { target: { value: "50" } });
    fireEvent.change(pole("adminEventSeating.mapDialog.stageX"), { target: { value: "1000" } });
    zapisz();

    expect(screen.getByText("adminEventSeating.mapDialog.validation.sizeRange")).toBeTruthy();
    expect(screen.getByText("adminEventSeating.mapDialog.validation.stageInside")).toBeTruthy();
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it("szerokość i wysokość idą do ładunku jako liczby", () => {
    const { props } = okno();
    fireEvent.change(pole("adminEventSeating.mapDialog.name"), { target: { value: "Hala" } });
    fireEvent.change(pole("adminEventSeating.mapDialog.width"), { target: { value: "2000" } });
    fireEvent.change(pole("adminEventSeating.mapDialog.height"), { target: { value: "900" } });
    zapisz();
    expect(props.onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Hala", width: 2000, height: 900 }),
    );
  });

  it("edycja startuje z danych planu, a „bez sali” i wyłączona scena to null", () => {
    const { props } = okno({ map: PLAN });

    expect(
      screen.getByRole("heading", { name: "adminEventSeating.mapDialog.editTitle" }),
    ).toBeTruthy();
    expect(pole("adminEventSeating.mapDialog.name").value).toBe("Gala");
    expect(screen.queryByLabelText("adminEventSeating.mapDialog.stageX")).toBeNull();
    fireEvent.change(pole("adminEventSeating.mapDialog.room"), { target: { value: "__none__" } });
    fireEvent.change(pole("adminEventSeating.mapDialog.session"), {
      target: { value: "__none__" },
    });
    zapisz();

    expect(props.onSubmit).toHaveBeenCalledWith({
      id: SEAT_MAP_ID,
      name: "Gala",
      roomId: null,
      sessionId: null,
      width: 1000,
      height: 700,
      stage: null,
    });
  });

  it("włączenie sceny w edycji pokazuje jej pola z wartościami domyślnymi", () => {
    okno({ map: PLAN });
    fireEvent.click(screen.getByRole("switch", { name: "adminEventSeating.mapDialog.stage" }));
    expect(pole("adminEventSeating.mapDialog.stageW").value).toBe("400");
  });

  it("odświeżenie planu w tle NIE kasuje wpisanej nazwy; inny plan - tak", () => {
    const { rerender, props } = okno({ map: PLAN });
    fireEvent.change(pole("adminEventSeating.mapDialog.name"), { target: { value: "Gala 2" } });

    rerender(<EventSeatMapDialog {...props} map={{ ...PLAN }} />);
    expect(pole("adminEventSeating.mapDialog.name").value).toBe("Gala 2");

    rerender(<EventSeatMapDialog {...props} map={{ ...PLAN, id: "inny", name: "Konferencja" }} />);
    expect(pole("adminEventSeating.mapDialog.name").value).toBe("Konferencja");
  });

  it("anuluj zamyka okno, a w trakcie zapisu przyciski są zgaszone", () => {
    const { props, rerender } = okno();
    fireEvent.click(screen.getByRole("button", { name: "adminEventSeating.mapDialog.cancel" }));
    expect(props.onOpenChange).toHaveBeenCalledWith(false);

    rerender(<EventSeatMapDialog {...props} isSaving />);
    expect(screen.getByRole("button", { name: "adminEventSeating.mapDialog.save" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "adminEventSeating.mapDialog.cancel" }),
    ).toBeDisabled();
  });
});
