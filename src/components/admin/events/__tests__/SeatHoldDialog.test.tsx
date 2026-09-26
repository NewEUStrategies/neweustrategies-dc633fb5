// Molekuła „stan wybranych miejsc" - wolne, blokada albo rezerwacja (CRM).
//
// CO TEN PLIK DOWODZI.
//   1. Okno startuje ze stanem podanym przez organizm i czyści pracę przy
//      każdym otwarciu.
//   2. BLOKADA: powód opcjonalny; przełącznik „zwolnij osoby” TYLKO wtedy, gdy
//      w zaznaczeniu ktoś siedzi - i jedzie w ładunku jako `release`.
//   3. REZERWACJA: cel (firma CRM / sponsor / zamówienie / sama notatka).
//      Listy sponsorów i zamówień montują się DOPIERO po wyborze celu. Brak
//      wybranego celu i pusta notatka przy „samej notatce” blokują zapis.
//      Ładunek niesie wyłącznie identyfikator WYBRANEGO celu.
//   4. Wyszukiwarka firm pyta z wpisaną frazą; pusty wynik mówi to zdaniem.
//   5. Wolne: ładunek bez rezerwacji i bez powodu blokady.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({
  companyQueries: [] as string[],
  companies: [] as { id: string; name: string }[] | undefined,
  sponsorMounts: 0,
  sponsors: [] as { id: string; snapshot_name: string }[] | undefined,
  packageMounts: 0,
  orders: [] as
    | {
        id: string;
        buyer_name: string;
        package_name_pl: string;
        package_name_en: string;
      }[]
    | undefined,
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-admin-event-seating", () => ({ ensureSeatingI18n: () => undefined }));
vi.mock("@/components/atoms/FormSelect", async () =>
  (await import("@/test/events/seatingUiMocks")).formSelectModule(),
);
vi.mock("@/components/ui/dialog", async () =>
  (await import("@/test/events/seatingUiMocks")).dialogModule(),
);
vi.mock("@/lib/events/useEventSponsors", () => ({
  useSponsorCompanySearch: (_eventId: string, q: string) => {
    h.companyQueries.push(q);
    return { data: h.companies };
  },
  useSponsors: () => {
    h.sponsorMounts += 1;
    return { data: h.sponsors };
  },
}));
vi.mock("@/lib/events/useEventPackages", () => ({
  usePackageOrders: () => {
    h.packageMounts += 1;
    return { data: h.orders };
  },
}));

import {
  SeatHoldDialog,
  type SeatHoldDialogProps,
} from "@/components/admin/events/molecules/SeatHoldDialog";
import { SEAT_EVENT_ID, SEAT_MAP_ID } from "@/test/events/seatingFixtures";

const D = "adminEventSeating.holdDialog";

beforeEach(() => {
  h.companyQueries = [];
  h.companies = [{ id: "co-1", name: "Firma Jeden" }];
  h.sponsorMounts = 0;
  h.sponsors = [{ id: "sp-1", snapshot_name: "Sponsor Złoty" }];
  h.packageMounts = 0;
  h.orders = [
    { id: "po-1", buyer_name: "Kupiec SA", package_name_pl: "Stół", package_name_en: "Table" },
  ];
});

function okno(over: Partial<SeatHoldDialogProps> = {}) {
  const props: SeatHoldDialogProps = {
    open: true,
    onOpenChange: vi.fn(),
    eventId: SEAT_EVENT_ID,
    mapId: SEAT_MAP_ID,
    seatIds: ["s-1", "s-2"],
    occupiedCount: 0,
    initialStatus: "held",
    isSaving: false,
    onSubmit: vi.fn(),
    ...over,
  };
  const view = render(<SeatHoldDialog {...props} />);
  return { ...view, props };
}

const lista = (klucz: string) => screen.getByLabelText(`${D}.${klucz}`) as HTMLSelectElement;
const wybierz = (klucz: string, value: string) =>
  fireEvent.change(lista(klucz), { target: { value } });
const pole = (klucz: string) => screen.getByLabelText(`${D}.${klucz}`) as HTMLInputElement;
const zapisz = () => fireEvent.click(screen.getByRole("button", { name: `${D}.save` }));

const ladunek = (over: Record<string, unknown>) => ({
  mapId: SEAT_MAP_ID,
  seatIds: ["s-1", "s-2"],
  status: "held",
  blockReason: null,
  holdCompanyId: null,
  holdSponsorId: null,
  holdPackageOrderId: null,
  holdNote: null,
  release: undefined,
  ...over,
});

describe("SeatHoldDialog - rezerwacja", () => {
  it("rezerwacja dla firmy CRM: wyszukiwarka z frazą i identyfikator firmy w ładunku", () => {
    const { props } = okno();

    expect(screen.getByText("adminEventSeating.workspace.selectionCount(count=2)")).toBeTruthy();
    expect(lista("status").value).toBe("held");
    expect(h.sponsorMounts).toBe(0);
    expect(h.packageMounts).toBe(0);
    fireEvent.change(screen.getByRole("textbox", { name: `${D}.companySearch` }), {
      target: { value: "Firma" },
    });
    expect(h.companyQueries.at(-1)).toBe("Firma");
    wybierz("company", "co-1");
    fireEvent.change(pole("note"), { target: { value: "  Stół partnera  " } });
    zapisz();

    expect(props.onSubmit).toHaveBeenCalledWith(
      ladunek({ holdCompanyId: "co-1", holdNote: "Stół partnera" }),
    );
  });

  it("brak wybranego celu blokuje zapis zdaniem przy polu celu", () => {
    const { props } = okno();
    zapisz();
    expect(screen.getByRole("alert").textContent).toBe(`${D}.validation.targetRequired`);
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it("wybór „bez firmy” wraca do braku celu, a pusta wyszukiwarka mówi to zdaniem", () => {
    okno();
    wybierz("company", "co-1");
    wybierz("company", "__none__");
    zapisz();
    expect(screen.getByRole("alert")).toBeTruthy();

    h.companies = [];
    fireEvent.change(screen.getByRole("textbox", { name: `${D}.companySearch` }), {
      target: { value: "nic" },
    });
    expect(screen.getByText(`${D}.companyNone`)).toBeTruthy();
  });

  it("sponsor: lista montuje się dopiero po wyborze celu, a ładunek niesie tylko sponsora", () => {
    const { props } = okno();
    wybierz("company", "co-1");
    wybierz("target", "sponsor");

    expect(h.sponsorMounts).toBeGreaterThan(0);
    wybierz("sponsor", "sp-1");
    zapisz();
    expect(props.onSubmit).toHaveBeenCalledWith(ladunek({ holdSponsorId: "sp-1" }));
  });

  it("sponsor „brak” wraca do braku celu; wydarzenie bez sponsorów mówi to zdaniem", () => {
    const { props, rerender } = okno();
    wybierz("target", "sponsor");
    wybierz("sponsor", "sp-1");
    wybierz("sponsor", "__none__");
    zapisz();
    expect(props.onSubmit).not.toHaveBeenCalled();

    h.sponsors = [];
    rerender(<SeatHoldDialog {...props} seatIds={["s-1"]} />);
    expect(screen.getByText(`${D}.sponsorNone`)).toBeTruthy();
  });

  it("zamówienie pakietowe: opcja z kupującym i pakietem, identyfikator zamówienia w ładunku", () => {
    const { props } = okno();
    wybierz("target", "package");

    expect(h.packageMounts).toBeGreaterThan(0);
    expect(
      screen.getByRole("option", { name: `${D}.packageOption(buyer=Kupiec SA,package=Stół)` }),
    ).toBeTruthy();
    wybierz("package", "po-1");
    zapisz();
    expect(props.onSubmit).toHaveBeenCalledWith(ladunek({ holdPackageOrderId: "po-1" }));
  });

  it("zamówienie „brak” wraca do braku celu; brak zamówień mówi to zdaniem", () => {
    const { props, rerender } = okno();
    wybierz("target", "package");
    wybierz("package", "po-1");
    wybierz("package", "__none__");
    zapisz();
    expect(props.onSubmit).not.toHaveBeenCalled();

    h.orders = [];
    rerender(<SeatHoldDialog {...props} seatIds={["s-1"]} />);
    expect(screen.getByText(`${D}.packageNone`)).toBeTruthy();
  });

  it("sama notatka wymaga treści", () => {
    const { props } = okno();
    wybierz("target", "note");
    zapisz();
    expect(screen.getByText(`${D}.validation.noteRequired`)).toBeTruthy();

    fireEvent.change(pole("note"), { target: { value: "Dla zarządu" } });
    zapisz();
    expect(props.onSubmit).toHaveBeenCalledWith(ladunek({ holdNote: "Dla zarządu" }));
  });
});

describe("SeatHoldDialog - listy w locie", () => {
  it("firmy, sponsorzy i zamówienia w locie pokazują zdanie „brak”, a nie pustą listę", () => {
    h.companies = undefined;
    h.sponsors = undefined;
    h.orders = undefined;
    okno();
    expect(screen.getByText(`${D}.companyNone`)).toBeTruthy();
    wybierz("target", "sponsor");
    expect(screen.getByText(`${D}.sponsorNone`)).toBeTruthy();
    wybierz("target", "package");
    expect(screen.getByText(`${D}.packageNone`)).toBeTruthy();
  });
});

describe("SeatHoldDialog - blokada i wolne", () => {
  it("blokada wolnych miejsc: powód, bez przełącznika zwolnienia", () => {
    const { props } = okno({ initialStatus: "blocked" });

    expect(screen.queryByRole("switch")).toBeNull();
    fireEvent.change(pole("blockReason"), { target: { value: "Kamera" } });
    zapisz();
    expect(props.onSubmit).toHaveBeenCalledWith(
      ladunek({ status: "blocked", blockReason: "Kamera", release: false }),
    );
  });

  it("blokada zajętych miejsc pokazuje przełącznik i wysyła `release`", () => {
    const { props } = okno({ initialStatus: "blocked", occupiedCount: 1 });

    fireEvent.click(screen.getByRole("switch", { name: `${D}.release` }));
    zapisz();
    expect(props.onSubmit).toHaveBeenCalledWith(
      ladunek({ status: "blocked", blockReason: null, release: true }),
    );
  });

  it("za długi powód blokady blokuje zapis", () => {
    const { props } = okno({ initialStatus: "blocked" });
    fireEvent.change(pole("blockReason"), { target: { value: "x".repeat(201) } });
    zapisz();
    expect(screen.getByText(`${D}.validation.noteTooLong`)).toBeTruthy();
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it("wolne: bez pól rezerwacji i blokady, ładunek czysty", () => {
    const { props } = okno({ initialStatus: "available" });

    expect(screen.queryByLabelText(`${D}.target`)).toBeNull();
    expect(screen.queryByLabelText(`${D}.blockReason`)).toBeNull();
    zapisz();
    expect(props.onSubmit).toHaveBeenCalledWith(ladunek({ status: "available" }));
  });

  it("ponowne otwarcie czyści pracę i bierze stan od organizmu", () => {
    const { props, rerender } = okno({ initialStatus: "held" });
    wybierz("status", "blocked");

    rerender(<SeatHoldDialog {...props} open={false} />);
    rerender(<SeatHoldDialog {...props} open initialStatus="available" />);
    expect(lista("status").value).toBe("available");
  });

  it("anuluj zamyka okno, a w trakcie zapisu przyciski są zgaszone", () => {
    const { props, rerender } = okno();
    fireEvent.click(screen.getByRole("button", { name: `${D}.cancel` }));
    expect(props.onOpenChange).toHaveBeenCalledWith(false);

    rerender(<SeatHoldDialog {...props} isSaving />);
    expect(screen.getByRole("button", { name: `${D}.save` })).toBeDisabled();
  });
});
