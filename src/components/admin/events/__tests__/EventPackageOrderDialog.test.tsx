// Molekuła „Nowe zamówienie pakietu" - PŁATNIK, PULA MIEJSC I KWOTA.
//
// TO JEST EKRAN, KTÓRY DOTYKA PIENIĘDZY, i jego cała trudność mieści się
// w jednym rozróżnieniu: PUSTE POLE TO NIE ZERO. Liczba miejsc i kwota są
// NADPISANIAMI warunków oferty (negocjacja, rabat delegacyjny), więc pusty
// input musi wysłać `null` - „jak w pakiecie". Zero wysłane w to miejsce
// zamknęłoby zamówienie bez ani jednego miejsca albo wystawiło je za darmo,
// a jedno i drugie wygląda na ekranie dokładnie tak samo jak puste pole.
//
// CO TEN PLIK DOWODZI.
//   1. DIALOG ZAMKNIĘTY NIE RENDERUJE TREŚCI, a KAŻDE otwarcie zaczyna od
//      pustego formularza - drugie zamówienie nie może wystartować z adresem
//      płatnika pierwszego.
//   2. ADRES POCZTY JEST JEDYNYM POLEM WYMAGANYM: bez niego nie ma komu wysłać
//      zaproszeń ani wystawić faktury.
//   3. PUSTE MIEJSCA I PUSTA KWOTA JADĄ JAKO `null`, a wpisane zero - jako
//      zero. To dwie różne decyzje i ładunek musi je rozróżniać.
//   4. LICZBA MIEJSC ODRZUCA ZERO, WARTOŚĆ UJEMNĄ I UŁAMEK; kwota odrzuca
//      przecinek, minus i tekst. Każde z komunikatem PRZY SWOIM polu.
//   5. LICZBY JADĄ JAKO LICZBY, nie jako tekst - `seats_total: "10"` przeszłoby
//      przez jsonb i wróciło odmową typu bez nazwy kolumny.
//   6. TRWAJĄCY ZAPIS BLOKUJE PRZYCISK - podwójne kliknięcie nie tworzy DWÓCH
//      zamówień na tę samą delegację.
//   7. MOLEKUŁA NIE ZAMYKA SIĘ SAMA - odmowa serwera zostawia całą pracę.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Molekuł `AdminForm*` - mają własne pliki.
// (2) Tworzenia zamówienia w bazie (`admin_event_package_order_create`) - to
// warstwa API; tutaj przedmiotem dowodu jest ŁADUNEK, który do niej jedzie.
//
// Radix Dialog nie działa pod happy-dom bez pełnego pointer API.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { SALES_IDS } from "@/test/events/adminSalesRows";
import type { PackageOrderInput } from "@/lib/events/packagesApi";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

vi.mock("@/components/ui/dialog", () => {
  const stan = { open: false };
  return {
    Dialog: ({ open, children }: { open: boolean; children?: ReactNode }) => {
      stan.open = open;
      return <div data-testid="dialog">{children}</div>;
    },
    DialogContent: ({ children }: { children?: ReactNode }) =>
      stan.open ? <div role="dialog">{children}</div> : null,
    DialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    DialogFooter: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    DialogTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
    DialogDescription: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
  };
});

import { EventPackageOrderDialog } from "@/components/admin/events/molecules/EventPackageOrderDialog";

const onSubmit = vi.fn<(input: PackageOrderInput) => void>();
const onOpenChange = vi.fn();

interface Wejscie {
  open?: boolean;
  packageId?: string;
  isSaving?: boolean;
}

function renderuj(props: Wejscie = {}) {
  const pelne = (wejscie: Wejscie) => (
    <EventPackageOrderDialog
      open={wejscie.open ?? true}
      onOpenChange={onOpenChange}
      packageId={wejscie.packageId ?? SALES_IDS.eventPackage}
      isSaving={wejscie.isSaving ?? false}
      onSubmit={onSubmit}
    />
  );
  const wynik = render(pelne(props));
  return {
    ...wynik,
    przerysuj: (next: Wejscie) => wynik.rerender(pelne({ ...props, ...next })),
  };
}

const O = "adminEventRegistration.packages.orders.";
const pole = (nazwa: string) => screen.getByLabelText(`${O}${nazwa}`);
const przyciskZapisu = () => screen.getByRole("button", { name: `${O}save` });

/** Komunikat błędu POWIĄZANY z polem przez `aria-describedby`. */
function bladPrzy(field: HTMLElement): string | null {
  for (const id of (field.getAttribute("aria-describedby") ?? "").split(" ")) {
    const node = id === "" ? null : document.getElementById(id);
    if (node !== null && node.getAttribute("role") === "alert") return node.textContent;
  }
  return null;
}

function ladunek(): PackageOrderInput {
  const call = onSubmit.mock.calls.at(-1);
  if (call === undefined) throw new Error("formularz nie wysłał niczego");
  return call[0];
}

/** Zamówienie w stanie gotowym do zapisu - sam adres płatnika. */
function wypelnijMinimum(email = "biuro@delegacja.test") {
  fireEvent.change(pole("buyerEmail"), { target: { value: email } });
}

beforeEach(() => {
  onSubmit.mockClear();
  onOpenChange.mockClear();
});

describe("EventPackageOrderDialog - otwarcie i czyszczenie", () => {
  it("dialog zamknięty NIE renderuje treści formularza", () => {
    renderuj({ open: false });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText(`${O}createTitle`)).not.toBeInTheDocument();
  });

  it("otwarty pokazuje pusty formularz i mówi, co znaczy pustka w polach", () => {
    // Podpowiedzi są tu częścią umowy: bez nich puste pole liczby miejsc czyta
    // się jak „zero miejsc", a puste pole kwoty jak „za darmo".
    renderuj();
    expect(screen.getByText(`${O}createTitle`)).toBeInTheDocument();
    expect(pole("buyerEmail")).toHaveValue("");
    expect(pole("seatsTotal")).toHaveValue("");
    expect(pole("amountCents")).toHaveValue("");
    expect(screen.getByText(`${O}seatsTotalHint`)).toBeInTheDocument();
    expect(screen.getByText(`${O}amountHint`)).toBeInTheDocument();
  });

  it("KAŻDE otwarcie czyści formularz - drugie zamówienie startuje od zera", () => {
    // Regresja, którą to łapie: organizator wystawia zamówienie dla firmy A,
    // zamyka, otwiera formularz dla firmy B i zapisuje - z adresem A na
    // fakturze, bo formularz wyglądał na wypełniony celowo.
    const { przerysuj } = renderuj();
    fireEvent.change(pole("buyerEmail"), { target: { value: "pierwszy@firma.test" } });
    fireEvent.change(pole("buyerName"), { target: { value: "Firma Pierwsza" } });
    fireEvent.change(pole("seatsTotal"), { target: { value: "10" } });
    fireEvent.change(pole("amountCents"), { target: { value: "120000" } });
    fireEvent.change(pole("invoiceNote"), { target: { value: "Zamówienie 1/2026" } });

    przerysuj({ open: false });
    przerysuj({ open: true, packageId: SALES_IDS.otherPackage });

    expect(pole("buyerEmail")).toHaveValue("");
    expect(pole("buyerName")).toHaveValue("");
    expect(pole("seatsTotal")).toHaveValue("");
    expect(pole("amountCents")).toHaveValue("");
    expect(pole("invoiceNote")).toHaveValue("");
  });

  it("anulowanie zamyka dialog i NIE wysyła niczego", () => {
    renderuj();
    wypelnijMinimum();
    fireEvent.click(screen.getByRole("button", { name: `${O}cancel` }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("EventPackageOrderDialog - płatnik", () => {
  it.each([
    ["", "pole puste"],
    ["biuro", "bez znaku małpy"],
    ["biuro@firma", "bez kropki w domenie"],
    ["biuro@firma.t", "domena jednoznakowa"],
    ["dwa adresy@firma.test", "biały znak w środku"],
  ])("adres „%s” NIE wychodzi z formularza (%s)", (adres) => {
    // Bez adresu nie ma komu wysłać zaproszeń ani wystawić faktury -
    // zamówienie bez płatnika jest pulą miejsc bez właściciela.
    renderuj();
    fireEvent.change(pole("buyerEmail"), { target: { value: adres } });
    fireEvent.click(przyciskZapisu());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(bladPrzy(pole("buyerEmail"))).toBe(
      "adminEventRegistration.errors.packageOrderBuyerEmail",
    );
  });

  it("adres i nazwa są przycinane, a nazwa jest opcjonalna", () => {
    renderuj();
    fireEvent.change(pole("buyerEmail"), { target: { value: "  biuro@delegacja.test  " } });
    fireEvent.click(przyciskZapisu());

    expect(ladunek().buyerEmail).toBe("biuro@delegacja.test");
    expect(ladunek().buyerName).toBe("");
  });

  it("notatka do faktury jedzie przycięta, a pakiet - z właściwości", () => {
    renderuj({ packageId: SALES_IDS.otherPackage });
    wypelnijMinimum();
    fireEvent.change(pole("buyerName"), { target: { value: "  Uczelnia Techniczna  " } });
    fireEvent.change(pole("invoiceNote"), { target: { value: "  PO 42/2026  " } });
    fireEvent.click(przyciskZapisu());

    expect(ladunek()).toEqual({
      packageId: SALES_IDS.otherPackage,
      buyerEmail: "biuro@delegacja.test",
      buyerName: "Uczelnia Techniczna",
      seatsTotal: null,
      amountCents: null,
      invoiceNote: "PO 42/2026",
    });
  });
});

describe("EventPackageOrderDialog - miejsca i kwota", () => {
  it("puste pola jadą jako null - „tyle miejsc i taka cena, jak w pakiecie”", () => {
    renderuj();
    wypelnijMinimum();
    fireEvent.click(przyciskZapisu());

    expect(ladunek().seatsTotal).toBeNull();
    expect(ladunek().amountCents).toBeNull();
  });

  it("wpisane zero to INNA decyzja niż puste pole - i tak jedzie do ładunku", () => {
    // Kwota zerowa jest świadomym „zamówienie sponsorowane", a nie brakiem
    // wpisu. Gdyby ładunek sklejał ją z pustką, organizator nie miałby jak
    // wystawić zamówienia bezpłatnego - i odwrotnie: pusta kwota wystawiłaby
    // pakiet za darmo. Ta para asercji pilnuje OBU kierunków.
    renderuj();
    wypelnijMinimum();
    fireEvent.change(pole("amountCents"), { target: { value: "0" } });
    fireEvent.click(przyciskZapisu());

    expect(ladunek().amountCents).toBe(0);
    expect(ladunek().seatsTotal).toBeNull();
  });

  it("kwota i liczba miejsc jadą jako LICZBY, nie jako tekst z pola", () => {
    // `seats_total: "10"` przeszłoby przez jsonb i wróciło odmową typu bez
    // nazwy kolumny - a formularz wyglądałby na poprawnie wypełniony.
    renderuj();
    wypelnijMinimum();
    fireEvent.change(pole("seatsTotal"), { target: { value: " 10 " } });
    fireEvent.change(pole("amountCents"), { target: { value: " 89900 " } });
    fireEvent.click(przyciskZapisu());

    expect(ladunek().seatsTotal).toBe(10);
    expect(ladunek().amountCents).toBe(89_900);
  });

  it.each([
    ["0", "zamówienie bez ani jednego miejsca"],
    ["-2", "liczba miejsc ujemna"],
    ["2,5", "przecinek w liczbie miejsc"],
    ["2.5", "połowa miejsca"],
    ["1001", "ponad tysiąc miejsc"],
    ["99999999999999999999", "liczba spoza zakresu bezpiecznych całkowitych"],
    ["dziesięć", "tekst niebędący liczbą"],
  ])("liczba miejsc „%s” NIE wychodzi z formularza (%s)", (wartosc) => {
    renderuj();
    wypelnijMinimum();
    fireEvent.change(pole("seatsTotal"), { target: { value: wartosc } });
    fireEvent.click(przyciskZapisu());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(bladPrzy(pole("seatsTotal"))).toBe("adminEventRegistration.errors.packageOrderSeats");
  });

  it("jedno miejsce jest dopuszczalne - dolna granica jest DOMKNIĘTA", () => {
    renderuj();
    wypelnijMinimum();
    fireEvent.change(pole("seatsTotal"), { target: { value: "1" } });
    fireEvent.click(przyciskZapisu());
    expect(ladunek().seatsTotal).toBe(1);
  });

  it.each([
    ["899,00", "przecinek zamiast kropki - odruch złotówkowy"],
    ["899.00", "kropka dziesiętna, a kwota jest w groszach"],
    ["-100", "kwota ujemna"],
    ["10000001", "ponad granicę stu tysięcy złotych"],
    ["dużo", "tekst niebędący liczbą"],
  ])("kwota „%s” NIE wychodzi z formularza (%s)", (wartosc) => {
    renderuj();
    wypelnijMinimum();
    fireEvent.change(pole("amountCents"), { target: { value: wartosc } });
    fireEvent.click(przyciskZapisu());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(bladPrzy(pole("amountCents"))).toBe("adminEventRegistration.errors.packageOrderAmount");
  });

  it("górna granica kwoty jest DOMKNIĘTA - 100 000,00 jeszcze przechodzi", () => {
    renderuj();
    wypelnijMinimum();
    fireEvent.change(pole("amountCents"), { target: { value: "10000000" } });
    fireEvent.click(przyciskZapisu());
    expect(ladunek().amountCents).toBe(10_000_000);
  });
});

describe("EventPackageOrderDialog - moment komunikatu i zapis w locie", () => {
  it("komunikat pojawia się dopiero PO pierwszej próbie zapisu", () => {
    renderuj();
    fireEvent.change(pole("buyerEmail"), { target: { value: "b" } });
    expect(bladPrzy(pole("buyerEmail"))).toBeNull();

    fireEvent.click(przyciskZapisu());
    expect(bladPrzy(pole("buyerEmail"))).toBe(
      "adminEventRegistration.errors.packageOrderBuyerEmail",
    );
  });

  it("pierwszy powód jest JEDEN - adres bije liczbę miejsc", () => {
    // Formularz podświetla jedno pole naraz; lista wszystkich braków przy
    // pustym formularzu jest ścianą tekstu, przez którą nie widać, od czego
    // zacząć.
    renderuj();
    fireEvent.change(pole("seatsTotal"), { target: { value: "0" } });
    fireEvent.click(przyciskZapisu());

    expect(bladPrzy(pole("buyerEmail"))).toBe(
      "adminEventRegistration.errors.packageOrderBuyerEmail",
    );
    expect(bladPrzy(pole("seatsTotal"))).toBeNull();
  });

  it("poprawienie pola gasi komunikat i przepuszcza zapis", () => {
    renderuj();
    fireEvent.click(przyciskZapisu());
    expect(bladPrzy(pole("buyerEmail"))).not.toBeNull();

    wypelnijMinimum();
    expect(bladPrzy(pole("buyerEmail"))).toBeNull();
    fireEvent.click(przyciskZapisu());
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("trwający zapis blokuje przycisk - podwójne kliknięcie NIE tworzy dwóch zamówień", () => {
    // Dwa zamówienia na tę samą delegację to podwójna faktura i podwójna pula
    // miejsc odjęta od limitu pakietu.
    const { przerysuj } = renderuj();
    wypelnijMinimum();
    fireEvent.click(przyciskZapisu());
    expect(onSubmit).toHaveBeenCalledTimes(1);

    przerysuj({ isSaving: true });
    expect(przyciskZapisu()).toBeDisabled();
    fireEvent.click(przyciskZapisu());
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("wysłanie ładunku NIE zamyka dialogu - odmowa serwera zostawia całą pracę", () => {
    renderuj();
    wypelnijMinimum();
    fireEvent.change(pole("invoiceNote"), { target: { value: "Notatka, której szkoda" } });
    fireEvent.click(przyciskZapisu());

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(pole("invoiceNote")).toHaveValue("Notatka, której szkoda");
    expect(pole("buyerEmail")).toHaveValue("biuro@delegacja.test");
  });
});
