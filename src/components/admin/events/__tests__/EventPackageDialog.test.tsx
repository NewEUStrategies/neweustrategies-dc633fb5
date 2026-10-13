// Molekuła „Formularz pakietu grupowego" - OFERTA, którą kupuje JEDEN płatnik.
//
// TO JEST EKRAN, KTÓRY DOTYKA PIENIĘDZY, i ma dwie liczby zamiast jednej:
// KWOTĘ (w złotych - pole mówi „899,00", grosze liczy parser) i LICZBĘ MIEJSC.
// Pomyłka w pierwszej to zły rachunek, pomyłka w drugiej to delegacja, która
// nie wejdzie na salę. Dlatego asercje idą na ŁADUNKU przekazanym do
// `onSubmit`, a nie na wyglądzie.
//
// CO TEN PLIK DOWODZI.
//   1. DIALOG ZAMKNIĘTY NIE RENDERUJE TREŚCI, a otwarcie dla INNEGO pakietu nie
//      niesie ani jednej wartości poprzedniego.
//   2. TRYB TWORZENIA I EDYCJI TO DWA EKRANY: inny tytuł i klucz ZAMROŻONY po
//      zapisie - faktury i importy posługują się kluczem, nie identyfikatorem.
//   3. BILET WYBIERA SIĘ Z LISTY BILETÓW TEGO WYDARZENIA, w języku interfejsu,
//      a pakiet BEZ wskazanego biletu nie wychodzi z formularza: miejsce, które
//      nie zamienia się w bilet, jest ofertą nie do zrealizowania.
//   4. KWOTA I LICZBA MIEJSC ODRZUCAJĄ WEJŚCIA ZDEGENEROWANE (zapis
//      niejednoznaczny „8,999", minus, ułamek, pustka, litery), każde
//      z komunikatem PRZY SWOIM polu. Cena jest w złotych (TIX-14a): „899"
//      to 899 zł, nie 8,99 zł.
//   5. PUSTY LIMIT JEDZIE JAKO `null` (bez limitu), nie jako zero.
//   6. TRWAJĄCY ZAPIS BLOKUJE PRZYCISK - podwójne kliknięcie wysyła RAZ.
//   7. MOLEKUŁA NIE ZAMYKA SIĘ SAMA - odmowa serwera zostawia całą pracę.
//   8. WARUNKI ZAKUPU I PODATEK (TIX-07, TIX-09) startują od wartości ZAPISANYCH
//      (albo domyślnych dla nowego pakietu), są sprawdzane bez przycinania,
//      a gdy panel ich NIE ZNA (baza bez migracji, awaria odczytu, wczytywanie)
//      - sekcji nie ma, stoi zdanie, a ładunek ma `terms: null`.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Tabel reguł szkicu (`packageDraftIssue`,
// `packageDraftToInput`) - są w `lib/events/__tests__/packageDraft.test.ts`;
// tutaj dowodzimy, że formularz ich UŻYWA i że komunikat ląduje przy WŁAŚCIWYM
// polu. (2) Molekuł `AdminForm*`, `TaxProfileFields` i atomu `FormSelect` -
// mają własne pliki. (3) Kluczy warunków w RPC - `packagesApiTerms.test.ts`.
//
// DETERMINIZM: żadnego `Date.now()`; terminy wpisujemy wprost, a oczekiwane ISO
// to zegar w STREFIE WYDARZENIA (`timezone`, tu Europe/Warsaw). Dawniej test
// liczył je tym samym `new Date(...)`, co przeglądarka - i tym samym utrwalał
// błąd klasy OPS-15 (okno sprzedaży w strefie organizatora, nie kongresu).
// Konwersja nie czyta strefy maszyny, więc asercja też jej nie zakłada.
// Radix Dialog i Select nie działają pod happy-dom bez pełnego pointer API.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { SALES_IDS, eventPackageRow, eventTicketRow } from "@/test/events/adminSalesRows";
import { formatMoney } from "@/lib/billing/types";
import type { PackageTermsLookup } from "@/lib/events/packageDraft";
import type {
  EventPackageInput,
  EventPackageRow,
  EventPackageTermsRow,
} from "@/lib/events/packagesApi";
import type { EventTicketRow } from "@/lib/events/registrationsApi";

const h = vi.hoisted(() => ({ language: "pl" }));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.language),
);

// Słownik odmów bazy ma własny plik testowy i ciągnie realny i18next; tutaj
// potrzebny jest wyłącznie dowód, że przyczyna awarii odczytu DOCHODZI zdaniem.
vi.mock("@/lib/events/adminRegistrationErrors", () => ({
  adminRegistrationErrorMessage: (error: unknown) =>
    `odmowa:${error instanceof Error ? error.message : String(error)}`,
}));

// Atrapa Radixa: `Content` istnieje wyłącznie przy otwartym dialogu (portal nie
// jest montowany), tak jak w produkcji.
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
// Droplisty tego ekranu (bilet, odbiorca, waluta, stawka VAT) stoją na Radix
// Select, który pod happy-dom nie otwiera listy bez pełnego pointer API.
// Atrapa jest natywna i ETYKIETOWANA - przedmiotem dowodu jest to, KTÓRA
// decyzja dojedzie do ładunku.
vi.mock("@/components/atoms/FormSelect", () => {
  const FormSelect = ({
    id,
    value,
    options,
    onValueChange,
    disabled,
    placeholder,
    "aria-label": ariaLabel,
  }: {
    id?: string;
    value: string;
    options: readonly { value: string; label: ReactNode }[];
    onValueChange: (value: string) => void;
    disabled?: boolean;
    placeholder?: string;
    "aria-label"?: string;
  }) => (
    <select
      id={id}
      aria-label={ariaLabel}
      value={value}
      disabled={disabled}
      onChange={(event) => onValueChange(event.target.value)}
    >
      <option value="">{placeholder ?? ""}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
  return { FormSelect, default: FormSelect };
});

import { EventPackageDialog } from "@/components/admin/events/molecules/EventPackageDialog";

const onSubmit = vi.fn<(input: EventPackageInput) => void>();
const onOpenChange = vi.fn();

const BILETY: EventTicketRow[] = [
  eventTicketRow(),
  eventTicketRow({
    id: SALES_IDS.otherTicket,
    key: "student",
    name_pl: "Bilet studencki",
    name_en: "Student ticket",
  }),
];

/** Warunki zapisanego pakietu `SALES_IDS.eventPackage` - celowo NIE domyślne. */
function warunki(overrides: Partial<EventPackageTermsRow> = {}): EventPackageTermsRow {
  return {
    id: SALES_IDS.eventPackage,
    admit_before_payment: true,
    payment_terms_days: 30,
    max_open_orders_per_buyer: null,
    vat_rate: "zw",
    vat_exempt_basis: "art. 43 ust. 1 pkt 29 ustawy o VAT",
    stripe_tax_code: "txcd_20030000",
    ...overrides,
  };
}

function gotowe(rows: EventPackageTermsRow[] = [warunki()]): PackageTermsLookup {
  return { status: "ready", byPackage: new Map(rows.map((row) => [row.id, row])) };
}

interface Wejscie {
  open?: boolean;
  eventPackage?: EventPackageRow | null;
  tickets?: EventTicketRow[];
  nextSortOrder?: number;
  isSaving?: boolean;
  packageTerms?: PackageTermsLookup;
}

/** Strefa wydarzenia - pola okna sprzedaży są zegarem w niej. */
const STREFA = "Europe/Warsaw";

function renderuj(props: Wejscie = {}) {
  const pelne = (wejscie: Wejscie) => (
    <EventPackageDialog
      open={wejscie.open ?? true}
      onOpenChange={onOpenChange}
      eventId={SALES_IDS.event}
      eventPackage={wejscie.eventPackage ?? null}
      tickets={wejscie.tickets ?? BILETY}
      nextSortOrder={wejscie.nextSortOrder ?? 110}
      isSaving={wejscie.isSaving ?? false}
      onSubmit={onSubmit}
      packageTerms={wejscie.packageTerms ?? gotowe()}
    />
  );
  const wynik = render(pelne(props));
  return {
    ...wynik,
    przerysuj: (next: Wejscie) => wynik.rerender(pelne({ ...props, ...next })),
  };
}

const E = "adminEventRegistration.packages.editor.";
const TAX = "adminEventRegistration.taxProfile.";
const pole = (nazwa: string) => screen.getByLabelText(`${E}${nazwa}`);
const przyciskZapisu = () => screen.getByRole("button", { name: `${E}save` });

/** Komunikat błędu POWIĄZANY z polem przez `aria-describedby`. */
function bladPrzy(field: HTMLElement): string | null {
  for (const id of (field.getAttribute("aria-describedby") ?? "").split(" ")) {
    const node = id === "" ? null : document.getElementById(id);
    if (node !== null && node.getAttribute("role") === "alert") return node.textContent;
  }
  return null;
}

function ladunek(): EventPackageInput {
  const call = onSubmit.mock.calls.at(-1);
  if (call === undefined) throw new Error("formularz nie wysłał niczego");
  return call[0];
}

/** Podgląd kwoty obok pola ceny (wspólny atom `MoneyInputPreview`). */
function podgladCeny(): string {
  const node = document.querySelector("[data-money-preview]");
  if (node === null) throw new Error("brak podglądu kwoty przy polu ceny");
  return node.textContent ?? "";
}

/** Nowy pakiet w stanie gotowym do zapisu: klucz, obie nazwy i bilet. */
function wypelnijMinimum() {
  fireEvent.change(pole("key"), { target: { value: "delegacja_5" } });
  fireEvent.change(pole("namePl"), { target: { value: "Delegacja pięcioosobowa" } });
  fireEvent.change(pole("nameEn"), { target: { value: "Delegation of five" } });
  fireEvent.change(pole("ticketTypeId"), { target: { value: SALES_IDS.ticket } });
}

beforeEach(() => {
  h.language = "pl";
  onSubmit.mockClear();
  onOpenChange.mockClear();
});

describe("EventPackageDialog - otwarcie, tryby i resztki", () => {
  it("dialog zamknięty NIE renderuje treści formularza", () => {
    renderuj({ open: false });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText(`${E}createTitle`)).not.toBeInTheDocument();
  });

  it("nowy pakiet: tytuł tworzenia, klucz czynny i wartości domyślne oferty", () => {
    renderuj({ nextSortOrder: 130 });
    expect(screen.getByText(`${E}createTitle`)).toBeInTheDocument();
    expect(pole("key")).toBeEnabled();
    expect(pole("seats")).toHaveValue("5");
    expect(pole("price")).toHaveValue("0");
    expect(pole("quota")).toHaveValue("");
    expect(pole("sortOrder")).toHaveValue("130");
    expect(pole("ticketTypeId")).toHaveValue("");
  });

  it("edycja: tytuł edycji, klucz ZAMROŻONY i wiersz przepisany do pól", () => {
    renderuj({ eventPackage: eventPackageRow() });
    expect(screen.getByText(`${E}editTitle`)).toBeInTheDocument();
    expect(pole("key")).toHaveValue("delegacja_5");
    expect(pole("key")).toBeDisabled();
    expect(pole("seats")).toHaveValue("5");
    expect(pole("price")).toHaveValue("899,00");
    expect(pole("ticketTypeId")).toHaveValue(SALES_IDS.ticket);
  });

  it("otwarcie dla INNEGO pakietu nie niesie ani jednej wartości poprzedniego", () => {
    const { przerysuj } = renderuj({ eventPackage: eventPackageRow() });
    expect(pole("price")).toHaveValue("899,00");
    expect(pole("paymentTermsDays")).toHaveValue("30");

    przerysuj({ open: false });
    przerysuj({
      open: true,
      eventPackage: eventPackageRow({
        id: SALES_IDS.otherPackage,
        key: "uczelnia_10",
        name_pl: "Pakiet uczelniany",
        seats: 10,
        price_cents: 120_000,
        quota: 3,
        ticket_type_id: SALES_IDS.otherTicket,
      }),
      packageTerms: gotowe([
        warunki(),
        warunki({
          id: SALES_IDS.otherPackage,
          payment_terms_days: 7,
          max_open_orders_per_buyer: 2,
        }),
      ]),
    });

    expect(pole("key")).toHaveValue("uczelnia_10");
    expect(pole("seats")).toHaveValue("10");
    expect(pole("price")).toHaveValue("1200,00");
    expect(pole("quota")).toHaveValue("3");
    expect(pole("ticketTypeId")).toHaveValue(SALES_IDS.otherTicket);
    expect(pole("paymentTermsDays")).toHaveValue("7");
    expect(pole("maxOpenOrders")).toHaveValue("2");
  });

  it("PORZUCONE zmiany nie wracają przy ponownym otwarciu tego samego pakietu", () => {
    const pakiet = eventPackageRow();
    const { przerysuj } = renderuj({ eventPackage: pakiet });
    fireEvent.change(pole("price"), { target: { value: "1" } });
    fireEvent.change(pole("paymentTermsDays"), { target: { value: "99" } });

    przerysuj({ open: false });
    przerysuj({ open: true, eventPackage: pakiet });

    expect(pole("price")).toHaveValue("899,00");
    expect(pole("paymentTermsDays")).toHaveValue("30");
  });

  it("anulowanie zamyka dialog i NIE wysyła niczego", () => {
    renderuj({ eventPackage: eventPackageRow() });
    fireEvent.click(screen.getByRole("button", { name: `${E}cancel` }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("EventPackageDialog - bilet nadawany miejscu", () => {
  it("droplista pokazuje bilety wydarzenia po polsku, z podpowiedzią o skutku", () => {
    renderuj();
    expect(screen.getByRole("option", { name: "Karnet VIP" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Bilet studencki" })).toBeInTheDocument();
    // Ta sama podpowiedź stoi w dwóch miejscach: jako tekst zastępczy pustej
    // droplisty i jako zdanie POD polem. Interesuje nas to drugie - bez niego
    // nie widać, że wybór biletu ma skutek przy każdym zaproszeniu.
    const zdanie = screen.getAllByText(`${E}ticketHint`).find((node) => node.tagName === "P");
    expect(zdanie).toBeDefined();
  });

  it("angielski interfejs pokazuje nazwy biletów po angielsku", () => {
    h.language = "en";
    renderuj();
    expect(screen.getByRole("option", { name: "VIP pass" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Student ticket" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Karnet VIP" })).not.toBeInTheDocument();
  });

  it("pakiet BEZ wskazanego biletu nie wychodzi z formularza", () => {
    // Miejsce z pakietu zamienia się w zwykłe zgłoszenie na wskazanym bilecie.
    // Bez biletu jest to oferta, której nie da się zrealizować - a odmowa
    // przyszłaby dopiero przy pierwszym zaproszeniu, u kupującego.
    renderuj();
    fireEvent.change(pole("key"), { target: { value: "delegacja_5" } });
    fireEvent.change(pole("namePl"), { target: { value: "Delegacja" } });
    fireEvent.change(pole("nameEn"), { target: { value: "Delegation" } });
    fireEvent.click(przyciskZapisu());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(
      screen.getByText("adminEventRegistration.errors.packageTicketRequired"),
    ).toBeInTheDocument();
  });

  it("pusta lista biletów zostawia droplistę bez opcji, ale z tekstem zastępczym", () => {
    // Wydarzenie bez ani jednego biletu nie może mieć pakietu - kontrolka musi
    // to pokazać tekstem, a nie pustym przyciskiem wyglądającym na zepsuty.
    renderuj({ tickets: [] });
    expect(screen.queryByRole("option", { name: "Karnet VIP" })).not.toBeInTheDocument();
    expect(pole("ticketTypeId")).toHaveValue("");
  });
});

describe("EventPackageDialog - cena w złotych (TIX-14a)", () => {
  it("cena z bazy wraca do pola w złotych i do ładunku bez zmiany kwoty", () => {
    renderuj({ eventPackage: eventPackageRow({ price_cents: 89_900 }) });
    expect(pole("price")).toHaveValue("899,00");
    fireEvent.click(przyciskZapisu());
    expect(ladunek().priceCents).toBe(89_900);
    expect(ladunek().currency).toBe("PLN");
  });

  it("angielski interfejs pokazuje kwotę z kropką - kwota ta sama", () => {
    h.language = "en";
    renderuj({ eventPackage: eventPackageRow({ price_cents: 89_900 }) });
    expect(pole("price")).toHaveValue("899.00");
    fireEvent.click(przyciskZapisu());
    expect(ladunek().priceCents).toBe(89_900);
  });

  it.each([
    ["899,00", 89_900],
    ["899", 89_900],
    ["899.00", 89_900],
    ["1 299,50", 129_950],
    ["0,99", 99],
  ])("wpis „%s” zapisuje %i groszy - pole mówi w złotych", (wartosc, grosze) => {
    renderuj();
    wypelnijMinimum();
    fireEvent.change(pole("price"), { target: { value: wartosc } });
    fireEvent.click(przyciskZapisu());
    expect(ladunek().priceCents).toBe(grosze);
  });

  it.each([
    ["8,999", "trzy cyfry po przecinku - 8,99 zł czy 8 999 zł?"],
    ["1,299", "przecinek jako separator tysięcy"],
    ["-1", "kwota ujemna"],
    ["", "pole puste"],
    ["dużo", "tekst niebędący liczbą"],
  ])("cena „%s” NIE wychodzi z formularza i mówi o formacie kwoty (%s)", (wartosc) => {
    renderuj();
    wypelnijMinimum();
    fireEvent.change(pole("price"), { target: { value: wartosc } });
    fireEvent.click(przyciskZapisu());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(bladPrzy(pole("price"))).toBe(`${E}priceFormat.PLN`);
  });

  it("zdanie o formacie mówi walutą pakietu", () => {
    renderuj();
    wypelnijMinimum();
    fireEvent.change(pole("currency"), { target: { value: "EUR" } });
    fireEvent.change(pole("price"), { target: { value: "8,999" } });
    fireEvent.click(przyciskZapisu());
    expect(bladPrzy(pole("price"))).toBe(`${E}priceFormat.EUR`);
  });

  it("kwota ponad sto tysięcy NIE wychodzi z formularza - odmowa zakresu", () => {
    renderuj();
    wypelnijMinimum();
    fireEvent.change(pole("price"), { target: { value: "100000,01" } });
    fireEvent.click(przyciskZapisu());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(bladPrzy(pole("price"))).toBe("adminEventRegistration.errors.packagePriceRange");
  });

  it("podgląd obok pola pokazuje kwotę tak, jak zobaczy ją kupujący - tylko czytelną", () => {
    renderuj();
    fireEvent.change(pole("price"), { target: { value: "899,00" } });
    expect(podgladCeny()).toBe(formatMoney(89_900, "PLN", "pl"));

    fireEvent.change(pole("currency"), { target: { value: "EUR" } });
    expect(podgladCeny()).toBe(formatMoney(89_900, "EUR", "pl"));

    // Zapis niejednoznaczny nie ma podglądu - nie zgadujemy kwoty.
    fireEvent.change(pole("price"), { target: { value: "8,999" } });
    expect(podgladCeny()).toBe("");
  });

  it("pole ceny otwiera klawiaturę dziesiętną, a nie samą cyfrową", () => {
    renderuj();
    expect(pole("price")).toHaveAttribute("inputmode", "decimal");
  });

  it("zero jest ceną DOPUSZCZALNĄ - pakiet zaproszeniowy nadal ma miejsca", () => {
    renderuj();
    wypelnijMinimum();
    fireEvent.change(pole("price"), { target: { value: "0" } });
    fireEvent.click(przyciskZapisu());
    expect(ladunek().priceCents).toBe(0);
  });
});

describe("EventPackageDialog - liczba miejsc i waluta", () => {
  it.each([
    ["0", "pakiet bez ani jednego miejsca"],
    ["-2", "liczba miejsc ujemna"],
    ["2.5", "połowa miejsca"],
    ["", "pole puste"],
    ["1001", "ponad tysiąc miejsc"],
  ])("liczba miejsc „%s” NIE wychodzi z formularza (%s)", (wartosc) => {
    renderuj();
    wypelnijMinimum();
    fireEvent.change(pole("seats"), { target: { value: wartosc } });
    fireEvent.click(przyciskZapisu());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(bladPrzy(pole("seats"))).toBe("adminEventRegistration.errors.packageSeatsRange");
  });

  it("jedno miejsce jest dopuszczalne - to etap przejściowy, nie błąd", () => {
    renderuj();
    wypelnijMinimum();
    fireEvent.change(pole("seats"), { target: { value: "1" } });
    fireEvent.click(przyciskZapisu());
    expect(ladunek().seats).toBe(1);
  });

  it("wybór waluty dojeżdża do ładunku", () => {
    renderuj();
    wypelnijMinimum();
    fireEvent.change(pole("currency"), { target: { value: "EUR" } });
    fireEvent.click(przyciskZapisu());
    expect(ladunek().currency).toBe("EUR");
  });
});

describe("EventPackageDialog - limity, okno i kolejność", () => {
  it("pusty limit sprzedanych pakietów jedzie jako brak limitu, nie jako zero", () => {
    renderuj();
    wypelnijMinimum();
    fireEvent.click(przyciskZapisu());
    expect(ladunek().quota).toBeNull();
  });

  it("limit wpisany liczbą dojeżdża jako liczba", () => {
    renderuj();
    wypelnijMinimum();
    fireEvent.change(pole("quota"), { target: { value: "12" } });
    fireEvent.click(przyciskZapisu());
    expect(ladunek().quota).toBe(12);
  });

  it.each([
    ["-1", "limit ujemny"],
    ["3.5", "limit ułamkowy"],
  ])("limit „%s” NIE wychodzi z formularza (%s)", (wartosc) => {
    renderuj();
    wypelnijMinimum();
    fireEvent.change(pole("quota"), { target: { value: wartosc } });
    fireEvent.click(przyciskZapisu());
    expect(onSubmit).not.toHaveBeenCalled();
    expect(bladPrzy(pole("quota"))).toBe("adminEventRegistration.errors.packageQuotaRange");
  });

  it("próg członkostwa spoza skali zatrzymuje zapis przy swoim polu", () => {
    renderuj();
    wypelnijMinimum();
    fireEvent.change(pole("minTierRank"), { target: { value: "101" } });
    fireEvent.click(przyciskZapisu());
    expect(onSubmit).not.toHaveBeenCalled();
    expect(bladPrzy(pole("minTierRank"))).toBe("adminEventRegistration.errors.packageTierRange");
  });

  it("okno zamknięte PRZED otwarciem zatrzymuje zapis przy polu „sprzedaż do”", () => {
    renderuj();
    wypelnijMinimum();
    fireEvent.change(pole("salesFrom"), { target: { value: "2026-09-10T10:00" } });
    fireEvent.change(pole("salesTo"), { target: { value: "2026-09-01T10:00" } });
    fireEvent.click(przyciskZapisu());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(bladPrzy(pole("salesTo"))).toBe("adminEventRegistration.errors.packageSalesWindow");
    // Pole „od" nie jest winne - komunikat przy nim myliłby, które poprawić.
    expect(bladPrzy(pole("salesFrom"))).toBeNull();
  });

  it("okno poprawne jedzie jako dwie chwile ISO, a brak daty jako null", () => {
    renderuj();
    wypelnijMinimum();
    fireEvent.change(pole("salesFrom"), { target: { value: "2026-09-01T10:00" } });
    fireEvent.click(przyciskZapisu());

    // 10:00 w Warszawie (CEST, UTC+2), niezależnie od strefy maszyny testu.
    expect(ladunek().salesFrom).toBe("2026-09-01T08:00:00.000Z");
    expect(ladunek().salesTo).toBeNull();
  });

  it("pod polem okna stoi strefa wydarzenia, w której jest zegar", () => {
    renderuj();
    const opisy = (pole("salesFrom").getAttribute("aria-describedby") ?? "")
      .split(" ")
      .map((id) => document.getElementById(id)?.textContent ?? "");
    expect(opisy).toContain("adminEvents.eventTime.zone(zone=Europe/Warsaw)");
  });

  it("kolejność wpisana literami zatrzymuje zapis - liczba nie może być NaN", () => {
    // To jest pole, którego bliźniaczy formularz biletu NIE sprawdza. Tutaj
    // sprawdzenie jest i musi zostać: `NaN` w ładunku wraca odmową bez nazwy
    // kolumny, a organizator widzi „coś poszło nie tak".
    renderuj();
    wypelnijMinimum();
    fireEvent.change(pole("sortOrder"), { target: { value: "pierwszy" } });
    fireEvent.click(przyciskZapisu());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(bladPrzy(pole("sortOrder"))).toBe("adminEventRegistration.errors.packageSortRange");
  });
});

describe("EventPackageDialog - warunki zakupu (TIX-07)", () => {
  it("nowy pakiet startuje od wartości domyślnych kolumn i tak je wysyła", () => {
    renderuj();
    expect(pole("admitBeforePayment")).toHaveAttribute("aria-checked", "false");
    expect(pole("paymentTermsDays")).toHaveValue("14");
    expect(pole("maxOpenOrders")).toHaveValue("3");

    wypelnijMinimum();
    fireEvent.click(przyciskZapisu());
    expect(ladunek().terms).toEqual({
      admitBeforePayment: false,
      paymentTermsDays: 14,
      maxOpenOrdersPerBuyer: 3,
      tax: { vat_rate: null, vat_exempt_basis: "", stripe_tax_code: null },
    });
  });

  it("edycja startuje od warunków ZAPISANYCH, a nie od domyślnych - i odsyła je bez zmian", () => {
    renderuj({ eventPackage: eventPackageRow() });
    expect(pole("admitBeforePayment")).toHaveAttribute("aria-checked", "true");
    expect(pole("paymentTermsDays")).toHaveValue("30");
    // Brak limitu w bazie to puste pole, a nie „0" ani „3".
    expect(pole("maxOpenOrders")).toHaveValue("");

    fireEvent.click(przyciskZapisu());
    expect(ladunek().terms).toEqual({
      admitBeforePayment: true,
      paymentTermsDays: 30,
      maxOpenOrdersPerBuyer: null,
      tax: {
        vat_rate: "zw",
        vat_exempt_basis: "art. 43 ust. 1 pkt 29 ustawy o VAT",
        stripe_tax_code: "txcd_20030000",
      },
    });
  });

  it("zmiany organizatora dojeżdżają: zaufanie, termin i zdjęty limit", () => {
    renderuj();
    wypelnijMinimum();
    fireEvent.click(pole("admitBeforePayment"));
    fireEvent.change(pole("paymentTermsDays"), { target: { value: "45" } });
    fireEvent.change(pole("maxOpenOrders"), { target: { value: "" } });
    fireEvent.click(przyciskZapisu());

    expect(ladunek().terms).toMatchObject({
      admitBeforePayment: true,
      paymentTermsDays: 45,
      maxOpenOrdersPerBuyer: null,
    });
  });

  it.each([
    ["0", "zero dni"],
    ["121", "ponad cztery miesiące"],
    ["7.5", "pół dnia"],
    ["", "pole puste"],
  ])("termin „%s” NIE wychodzi z formularza - bez przycinania do zakresu (%s)", (wartosc) => {
    renderuj();
    wypelnijMinimum();
    fireEvent.change(pole("paymentTermsDays"), { target: { value: wartosc } });
    fireEvent.click(przyciskZapisu());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(bladPrzy(pole("paymentTermsDays"))).toBe(`${E}paymentTermsDaysRange(max=120,min=1)`);
  });

  it.each([
    ["0", "zero zamówień - nikt nie kupi"],
    ["101", "ponad sto"],
    ["2.5", "ułamek"],
  ])("limit nieopłaconych „%s” NIE wychodzi z formularza (%s)", (wartosc) => {
    renderuj();
    wypelnijMinimum();
    fireEvent.change(pole("maxOpenOrders"), { target: { value: wartosc } });
    fireEvent.click(przyciskZapisu());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(bladPrzy(pole("maxOpenOrders"))).toBe(`${E}maxOpenOrdersRange(max=100,min=1)`);
  });

  it("komunikat przy terminie pojawia się dopiero PO pierwszej próbie zapisu", () => {
    renderuj();
    wypelnijMinimum();
    fireEvent.change(pole("paymentTermsDays"), { target: { value: "0" } });
    expect(bladPrzy(pole("paymentTermsDays"))).toBeNull();
    fireEvent.click(przyciskZapisu());
    expect(bladPrzy(pole("paymentTermsDays"))).not.toBeNull();
  });
});

describe("EventPackageDialog - profil podatkowy (TIX-09)", () => {
  it("„bez własnej stawki” znaczy w pakiecie stawkę JEGO BILETU", () => {
    renderuj();
    expect(screen.getByRole("option", { name: `${TAX}rateDefaultTicket` })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: `${TAX}rateDefaultTenant` })).toBeNull();
  });

  it("stawka i kod Stripe dojeżdżają do ładunku - kod małymi literami", () => {
    renderuj();
    wypelnijMinimum();
    fireEvent.change(screen.getByLabelText(`${TAX}vatRate`), { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText(`${TAX}stripeTaxCode`), {
      target: { value: " TXCD_10000000 " },
    });
    fireEvent.click(przyciskZapisu());

    expect(ladunek().terms?.tax).toEqual({
      vat_rate: "8",
      vat_exempt_basis: "",
      stripe_tax_code: "txcd_10000000",
    });
  });

  it("błędny kod Stripe zatrzymuje zapis, a zdanie pojawia się dopiero po próbie", () => {
    renderuj();
    wypelnijMinimum();
    const kod = screen.getByLabelText(`${TAX}stripeTaxCode`);
    fireEvent.change(kod, { target: { value: "txcd_123" } });
    expect(bladPrzy(kod)).toBeNull();

    fireEvent.click(przyciskZapisu());
    expect(onSubmit).not.toHaveBeenCalled();
    expect(bladPrzy(screen.getByLabelText(`${TAX}stripeTaxCode`))).toBe(
      `${TAX}stripeTaxCodeInvalid`,
    );
  });

  it("podstawa zwolnienia dłuższa niż 300 znaków to odmowa, nie przycięcie", () => {
    renderuj();
    wypelnijMinimum();
    fireEvent.change(screen.getByLabelText(`${TAX}vatRate`), { target: { value: "zw" } });
    fireEvent.change(screen.getByLabelText(`${TAX}vatExemptBasis`), {
      target: { value: "a".repeat(301) },
    });
    fireEvent.click(przyciskZapisu());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByLabelText(`${TAX}vatExemptBasis`)).toHaveValue("a".repeat(301));
    expect(bladPrzy(screen.getByLabelText(`${TAX}vatExemptBasis`))).toBe(
      `${TAX}vatExemptBasisTooLong(length=301,max=300)`,
    );
  });
});

describe("EventPackageDialog - warunki NIEZNANE nie jadą do bazy", () => {
  it.each<[string, PackageTermsLookup, string]>([
    ["baza bez migracji", { status: "unavailable" }, `${E}termsUnavailable`],
    [
      "odczyt padł",
      { status: "failed", error: new Error("forbidden") },
      `${E}termsLoadFailed(reason=odmowa:forbidden)`,
    ],
    ["wczytywanie", { status: "loading" }, `${E}termsLoading`],
  ])("%s: sekcji nie ma, stoi zdanie, a ładunek ma `terms: null`", (_opis, lookup, zdanie) => {
    renderuj({ eventPackage: eventPackageRow(), packageTerms: lookup });

    expect(screen.queryByLabelText(`${E}paymentTermsDays`)).toBeNull();
    expect(screen.queryByLabelText(`${TAX}vatRate`)).toBeNull();
    expect(screen.getByRole("note")).toHaveTextContent(zdanie);

    fireEvent.click(przyciskZapisu());
    expect(ladunek().terms).toBeNull();
  });

  it("nowy pakiet przy awarii odczytu też nie wysyła wartości domyślnych", () => {
    renderuj({ packageTerms: { status: "failed", error: new Error("timeout") } });
    wypelnijMinimum();
    fireEvent.click(przyciskZapisu());
    expect(ladunek().terms).toBeNull();
  });

  it("pakiet, którego nie ma w odpowiedzi, ma warunki nieznane - nie domyślne", () => {
    renderuj({ eventPackage: eventPackageRow(), packageTerms: gotowe([]) });
    expect(screen.getByRole("note")).toHaveTextContent(`${E}termsMissing`);
    fireEvent.click(przyciskZapisu());
    expect(ladunek().terms).toBeNull();
  });

  it("warunki, które dojechały po otwarciu, wypełniają sekcję i NIE kasują wpisanych zmian", () => {
    const { przerysuj } = renderuj({
      eventPackage: eventPackageRow(),
      packageTerms: { status: "loading" },
    });
    fireEvent.change(pole("namePl"), { target: { value: "Delegacja po zmianie" } });

    przerysuj({ packageTerms: gotowe() });

    expect(pole("paymentTermsDays")).toHaveValue("30");
    expect(pole("namePl")).toHaveValue("Delegacja po zmianie");
    fireEvent.click(przyciskZapisu());
    expect(ladunek().namePl).toBe("Delegacja po zmianie");
    expect(ladunek().terms?.paymentTermsDays).toBe(30);
  });

  it("odświeżenie warunków w tle przy OTWARTYM dialogu nie nadpisuje zmian organizatora", () => {
    const { przerysuj } = renderuj({ eventPackage: eventPackageRow() });
    fireEvent.change(pole("paymentTermsDays"), { target: { value: "60" } });

    przerysuj({ packageTerms: gotowe([warunki({ payment_terms_days: 21 })]) });

    expect(pole("paymentTermsDays")).toHaveValue("60");
  });
});

describe("EventPackageDialog - kształt ładunku i zapis w locie", () => {
  it("nowy pakiet: identyfikator pusty, wydarzenie i wszystkie decyzje w ładunku", () => {
    renderuj({ nextSortOrder: 150 });
    wypelnijMinimum();
    fireEvent.change(pole("audience"), { target: { value: "academic" } });
    fireEvent.change(pole("descriptionPl"), { target: { value: "  Opis polski  " } });
    fireEvent.change(pole("descriptionEn"), { target: { value: "  English  " } });
    fireEvent.click(screen.getByLabelText(`${E}requiresVerification`));
    fireEvent.click(screen.getByLabelText(`${E}active`));
    fireEvent.click(przyciskZapisu());

    expect(ladunek()).toEqual({
      id: null,
      eventId: SALES_IDS.event,
      key: "delegacja_5",
      ticketTypeId: SALES_IDS.ticket,
      namePl: "Delegacja pięcioosobowa",
      nameEn: "Delegation of five",
      descriptionPl: "Opis polski",
      descriptionEn: "English",
      audience: "academic",
      seats: 5,
      priceCents: 0,
      currency: "PLN",
      quota: null,
      salesFrom: null,
      salesTo: null,
      minTierRank: 0,
      requiresVerification: true,
      isActive: false,
      sortOrder: 150,
      terms: {
        admitBeforePayment: false,
        paymentTermsDays: 14,
        maxOpenOrdersPerBuyer: 3,
        tax: { vat_rate: null, vat_exempt_basis: "", stripe_tax_code: null },
      },
    });
  });

  it("edycja niesie identyfikator pakietu, nie zakłada nowego", () => {
    renderuj({ eventPackage: eventPackageRow() });
    fireEvent.click(przyciskZapisu());
    expect(ladunek().id).toBe(SALES_IDS.eventPackage);
    expect(ladunek().key).toBe("delegacja_5");
  });

  it("klucz spoza wzorca zatrzymuje TYLKO nowy pakiet - starego nie da się inaczej poprawić", () => {
    const { przerysuj } = renderuj();
    fireEvent.change(pole("key"), { target: { value: "Delegacja 5" } });
    fireEvent.change(pole("namePl"), { target: { value: "Delegacja" } });
    fireEvent.change(pole("nameEn"), { target: { value: "Delegation" } });
    fireEvent.change(pole("ticketTypeId"), { target: { value: SALES_IDS.ticket } });
    fireEvent.click(przyciskZapisu());
    expect(onSubmit).not.toHaveBeenCalled();
    expect(bladPrzy(pole("key"))).toBe("adminEventRegistration.errors.packageKeyPattern");

    // Ten sam klucz w wierszu ZAPISANYM nie blokuje zapisu nazwy: przy edycji
    // klucz i tak nie jedzie do RPC.
    przerysuj({ open: false });
    przerysuj({ open: true, eventPackage: eventPackageRow({ key: "LEGACY KEY" }) });
    fireEvent.click(przyciskZapisu());
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("komunikat pojawia się dopiero PO pierwszej próbie zapisu", () => {
    renderuj();
    expect(bladPrzy(pole("key"))).toBeNull();
    fireEvent.click(przyciskZapisu());
    expect(bladPrzy(pole("key"))).toBe("adminEventRegistration.errors.packageKeyPattern");
  });

  it("brak nazwy angielskiej zatrzymuje zapis przy TYM polu, nie przy polskim", () => {
    renderuj();
    fireEvent.change(pole("key"), { target: { value: "delegacja_5" } });
    fireEvent.change(pole("ticketTypeId"), { target: { value: SALES_IDS.ticket } });
    fireEvent.change(pole("namePl"), { target: { value: "Delegacja" } });
    fireEvent.click(przyciskZapisu());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(bladPrzy(pole("nameEn"))).toBe("adminEventRegistration.errors.packageNameRequired");
    expect(bladPrzy(pole("namePl"))).toBeNull();
  });

  it("trwający zapis blokuje przycisk - podwójne kliknięcie wysyła RAZ", () => {
    // Dwa kliknięcia w sekundę to dwa pakiety o tym samym kluczu; drugi wraca
    // odmową unikalności, której nikt nie umie odczytać.
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
    fireEvent.change(pole("descriptionPl"), { target: { value: "Opis, którego szkoda" } });
    fireEvent.click(przyciskZapisu());

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(pole("descriptionPl")).toHaveValue("Opis, którego szkoda");
  });
});
