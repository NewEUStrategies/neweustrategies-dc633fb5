// Molekuła „formularz kategorii miejsc" - klucz, nazwy, kolor i bilety.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW - każdy punkt to gwarancja, która znika.
//   1. Zamknięte okno nie pyta o bilety. Nowa kategoria startuje z kolorem
//      czytelnym na obu płytach planu, bez ostrzeżenia o kontraście.
//   2. Kolor zlewający się z płytą jasną albo ciemną dostaje OSTRZEŻENIE
//      (nie blokadę - kolor bywa firmowy). Zły format koloru nie liczy
//      kontrastu, a próbnik wraca wtedy do koloru domyślnego.
//   3. Bilety to lista pól wyboru; zaznaczenie i odznaczenie zmienia zbiór,
//      który jedzie W CAŁOŚCI (`ticket_type_ids` zastępuje zbiór w bazie).
//   4. Klucz jest zablokowany w edycji i nie jedzie w ładunku edycji.
//   5. Błędy dopiero po próbie zapisu; anuluj zamyka okno.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({
  lang: "pl",
  ticketQueries: [] as (string | null)[],
  tickets: [] as { id: string; name_pl: string; name_en: string }[],
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.lang),
);
vi.mock("@/lib/i18n-admin-event-seating", () => ({ ensureSeatingI18n: () => undefined }));
vi.mock("@/components/ui/dialog", async () =>
  (await import("@/test/events/seatingUiMocks")).dialogModule(),
);
vi.mock("@/lib/events/useEventRegistrations", () => ({
  useEventTickets: (eventId: string | null) => {
    h.ticketQueries.push(eventId);
    return { data: eventId === null ? undefined : h.tickets };
  },
}));

import {
  EventSeatCategoryDialog,
  type EventSeatCategoryDialogProps,
} from "@/components/admin/events/molecules/EventSeatCategoryDialog";
import { DEFAULT_CATEGORY_COLOR } from "@/lib/events/seatingDraft";
import { SEAT_EVENT_ID, seatCategory } from "@/test/events/seatingFixtures";

const C = "adminEventSeating.categoryDialog";

beforeEach(() => {
  h.lang = "pl";
  h.ticketQueries = [];
  h.tickets = [
    { id: "t-vip", name_pl: "Karnet VIP", name_en: "VIP pass" },
    { id: "t-std", name_pl: "Standard", name_en: "Standard pass" },
  ];
});

function okno(over: Partial<EventSeatCategoryDialogProps> = {}) {
  const props: EventSeatCategoryDialogProps = {
    open: true,
    onOpenChange: vi.fn(),
    eventId: SEAT_EVENT_ID,
    category: null,
    isSaving: false,
    onSubmit: vi.fn(),
    ...over,
  };
  const view = render(<EventSeatCategoryDialog {...props} />);
  return { ...view, props };
}

const pole = (klucz: string) => screen.getByLabelText(`${C}.${klucz}`) as HTMLInputElement;
const wpisz = (klucz: string, value: string) =>
  fireEvent.change(pole(klucz), { target: { value } });
const zapisz = () => fireEvent.click(screen.getByRole("button", { name: `${C}.save` }));

describe("EventSeatCategoryDialog", () => {
  it("zamknięte okno nie pyta o bilety i nic nie rysuje", () => {
    const { container } = okno({ open: false });
    expect(h.ticketQueries).toEqual([null]);
    expect(container.innerHTML).toBe("");
  });

  it("nowa kategoria: kolor domyślny bez ostrzeżenia i lista biletów", () => {
    okno();

    expect(screen.getByRole("heading", { name: `${C}.createTitle` })).toBeTruthy();
    expect(h.ticketQueries.at(-1)).toBe(SEAT_EVENT_ID);
    expect(pole("color").value).toBe(DEFAULT_CATEGORY_COLOR);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("checkbox", { name: "Karnet VIP" })).toBeTruthy();
    expect(pole("key").disabled).toBe(false);
  });

  it("kolor zlewający się z płytą ostrzega, ale NIE blokuje zapisu", () => {
    const { props } = okno();
    wpisz("key", "prasa");
    wpisz("namePl", "Prasa");
    wpisz("nameEn", "Press");
    wpisz("color", "#ffff00");

    expect(screen.getByRole("status").textContent).toMatch(new RegExp(`^${C}.contrastWarning`));
    zapisz();
    expect(props.onSubmit).toHaveBeenCalledWith({
      eventId: SEAT_EVENT_ID,
      key: "prasa",
      namePl: "Prasa",
      nameEn: "Press",
      color: "#FFFF00",
      ticketTypeIds: [],
    });
  });

  it("próbnik koloru ustawia kod wielkimi literami, a przy złym formacie pokazuje domyślny", () => {
    okno();
    const probnik = screen.getByLabelText(`${C}.colorPicker`) as HTMLInputElement;
    fireEvent.change(probnik, { target: { value: "#aa3355" } });
    expect(pole("color").value).toBe("#AA3355");

    wpisz("color", "#zzz");
    expect(probnik.value).toBe(DEFAULT_CATEGORY_COLOR.toLowerCase());
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("błędy dopiero po próbie zapisu i blokują wysyłkę", () => {
    const { props } = okno();
    expect(screen.queryByText(`${C}.validation.keyFormat`)).toBeNull();

    wpisz("key", "Zły Klucz");
    wpisz("color", "zielony");
    zapisz();
    expect(screen.getByText(`${C}.validation.keyFormat`)).toBeTruthy();
    expect(screen.getAllByText(`${C}.validation.nameRequired`)).toHaveLength(2);
    expect(screen.getByText(`${C}.validation.colorFormat`)).toBeTruthy();
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it("edycja: klucz zablokowany, bilety zaznaczone, zbiór jedzie w całości bez klucza", () => {
    h.lang = "en";
    const { props } = okno({ category: seatCategory() });

    expect(screen.getByRole("heading", { name: `${C}.editTitle` })).toBeTruthy();
    expect(pole("key").disabled).toBe(true);
    const vip = screen.getByRole("checkbox", { name: "VIP pass" });
    const std = screen.getByRole("checkbox", { name: "Standard pass" });
    expect(vip.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(std);
    fireEvent.click(vip);
    zapisz();

    expect(props.onSubmit).toHaveBeenCalledWith({
      id: "cat-vip",
      namePl: "Strefa VIP",
      nameEn: "VIP zone",
      color: "#AA3355",
      ticketTypeIds: ["t-std"],
    });
  });

  it("wydarzenie bez biletów mówi to zdaniem", () => {
    h.tickets = [];
    okno();
    expect(screen.getByText(`${C}.noTickets`)).toBeTruthy();
  });

  it("odświeżenie kategorii w tle nie kasuje pracy; anuluj zamyka okno", () => {
    const { rerender, props } = okno({ category: seatCategory() });
    wpisz("namePl", "Strefa Premium");
    rerender(<EventSeatCategoryDialog {...props} category={seatCategory()} />);
    expect(pole("namePl").value).toBe("Strefa Premium");

    fireEvent.click(screen.getByRole("button", { name: `${C}.cancel` }));
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
    rerender(<EventSeatCategoryDialog {...props} isSaving />);
    expect(screen.getByRole("button", { name: `${C}.save` })).toBeDisabled();
  });
});
