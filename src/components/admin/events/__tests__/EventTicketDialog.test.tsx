// Molekuła „Formularz biletu" - SKLEJENIE czternastu pól z regułami szkicu.
//
// TO JEST EKRAN, KTÓRY DOTYKA PIENIĘDZY. Cena biletu żyje w bazie w GROSZACH,
// a formularz prowadzi ją w ZŁOTYCH (TIX-14a: „899" wpisane w polu groszowym
// dawało bilet za 8,99 zł). Pomyłka o dwa rzędy jest tu nie do zauważenia
// wzrokiem, więc asercje idą na ŁADUNKU przekazanym do `onSubmit`, a nie na
// wyglądzie pola.
//
// CO TEN PLIK DOWODZI.
//   1. DIALOG ZAMKNIĘTY NIE RENDERUJE TREŚCI, a KAŻDE otwarcie odtwarza szkic:
//      bilet A zamknięty i bilet B otwarty nie może pokazać ani jednej wartości
//      A. To samo dotyczy PORZUCONYCH zmian na tym samym bilecie - wracają
//      wartości wiersza, nie to, co ktoś wpisał i się rozmyślił.
//   2. TRYB TWORZENIA I TRYB EDYCJI TO DWA RÓŻNE EKRANY: inny tytuł i klucz,
//      który po zapisie jest ZAMROŻONY (RPC i tak go przy edycji ignoruje,
//      więc czynne pole byłoby obietnicą bez pokrycia).
//   3. KWOTA W POLU JEST W ZŁOTYCH, W ŁADUNKU W GROSZACH. Wiersz z 1999 pokazuje
//      „19,99" i wraca do ładunku jako 1999 - nie 19 i nie 199 900. „899,00"
//      i „899" to 89 900 groszy. Wejścia zdegenerowane (minus, pustka, litery,
//      trzy miejsca po przecinku, „8,999") NIE WYCHODZĄ z formularza i mają
//      komunikat o zapisie kwoty PRZY SWOIM polu; obok pola stoi podgląd kwoty.
//   4. LIMITY: pula ujemna i ułamkowa nie wychodzi, pusta pula jedzie jako
//      `null` (bez limitu), a nie jako zero (bilet natychmiast wyprzedany).
//   5. TRZY STANY KODU DOSTĘPU mają trzy różne ładunki: brak klucza w obiekcie
//      (nie ruszaj), napis (ustaw), `null` (zdejmij).
//   6. KOMUNIKAT POJAWIA SIĘ PO PIERWSZEJ PRÓBIE ZAPISU, nie przy pisaniu.
//   7. TRWAJĄCY ZAPIS BLOKUJE PRZYCISK - podwójne kliknięcie wysyła RAZ.
//   8. MOLEKUŁA NIE ZAMYKA SIĘ SAMA. Zamknięcie po sukcesie należy do rodzica,
//      więc odmowa serwera zostawia dialog otwarty z całą pracą użytkownika.
//   9. PROFIL PODATKOWY (TIX-09) jedzie TRZECIM argumentem `onSubmit` tylko
//      wtedy, gdy redaktor go zmienił; zły kod Stripe albo za długa podstawa
//      zatrzymują zapis, a baza bez migracji pokazuje zdanie zamiast pól.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Tabel reguł szkicu (`ticketDraftIssue`,
// `ticketDraftToInput`, `toLocalInput`) - są w
// `lib/events/__tests__/ticketDraft.test.ts`; tutaj dowodzimy, że formularz ich
// UŻYWA i że komunikat ląduje przy WŁAŚCIWYM polu. (2) Molekuł `AdminForm*` -
// mają własne pliki. (3) Edytora progów cenowych - ma własny plik
// `EventTicketPhasesEditor.test.tsx`; tutaj sprawdzamy wyłącznie, że jego wynik
// dojeżdża do ładunku.
//
// DETERMINIZM: żadnego `Date.now()`. Terminy wpisujemy jako `datetime-local`
// i oczekujemy ISO zegara w STREFIE WYDARZENIA (`timezone`, tu Europe/Warsaw).
// Dawniej oczekiwane ISO liczył ten sam `new Date(...)`, co przeglądarka - test
// utrwalał więc błąd klasy OPS-15 (termin w strefie organizatora, nie
// kongresu). Konwersja nie czyta strefy maszyny, więc asercja też jej nie
// zakłada; obca strefa przeglądarki: `lib/events/__tests__/eventLocalInputZone`.
// Radix Dialog i Select nie działają pod happy-dom bez pełnego pointer API.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps, ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { SALES_IDS, eventTicketRow } from "@/test/events/adminSalesRows";
import type { EventTicketInput, EventTicketRow } from "@/lib/events/registrationsApi";
import { EMPTY_TAX_PROFILE, type TaxProfileDraft } from "@/lib/events/taxProfileDraft";
import type { TicketTaxProfileState } from "@/lib/events/ticketTaxProfileApi";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
// `DateInput` jest kalendarzem (przycisk + popover), a nie natywnym polem -
// `fireEvent.change` go nie wypełni. Przedmiotem dowodu jest to, CO edytor robi
// z wartością pola `datetime-local`, więc atrapa jest natywna, jak w
// `MeetingSettingsPanel.test.tsx`. Bez niej trzy przypadki z oknem progu były
// czerwone na bazie 3a98acb (od zamiany pola na kalendarz).
vi.mock("@/components/ui/date-input", () => ({
  DateInput: ({
    onChange,
    value,
    type,
    ...props
  }: {
    onChange: (event: { target: { value: string } }) => void;
    value: string;
    type: string;
    id?: string;
  }) => <input {...props} type={type} value={value} onChange={onChange} />,
}));

// Atrapa Radixa: `Root` renderuje dzieci zawsze, ale `Content` istnieje TYLKO
// przy otwartym dialogu (portal nie jest montowany). Bez tego „dialog zamknięty
// nie renderuje treści" byłoby dowodem na atrapę, a nie na molekułę.
vi.mock("@/lib/events/useEventTermsGroups", () => ({
  useEventGroups: () => ({ data: [], isLoading: false, error: null }),
}));

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
// Droplista waluty stoi na Radix Select (przez `FormSelect`), a ten pod
// happy-dom nie otwiera listy bez pełnego pointer API. Atrapa jest natywna
// i ETYKIETOWANA, bo przedmiotem dowodu jest to, KTÓRA waluta dojedzie do
// ładunku - nie to, jak wygląda popup.
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

import { EventTicketDialog } from "@/components/admin/events/molecules/EventTicketDialog";

type TicketPresentation = NonNullable<ComponentProps<typeof EventTicketDialog>["presentation"]>;

/** Prezentacja domyślna, przepisana jawnie - moduł prezentacji czyta zegar. */
const DEFAULT_TICKET_PRESENTATION: TicketPresentation = {
  isHidden: false,
  showPriceLabel: true,
  priceLabelPl: "",
  priceLabelEn: "",
  groupRegistrationEnabled: false,
  taxMode: "inclusive",
  groupMaxSize: 10,
};

const onSubmit =
  vi.fn<
    (input: EventTicketInput, look: TicketPresentation, taxProfile: TaxProfileDraft | null) => void
  >();
const onOpenChange = vi.fn();

const GOTOWY_PUSTY: TicketTaxProfileState = { status: "ready", value: EMPTY_TAX_PROFILE };

interface Wejscie {
  open?: boolean;
  ticket?: EventTicketRow | null;
  nextSortOrder?: number;
  isSaving?: boolean;
  presentation?: TicketPresentation;
  taxProfile?: TicketTaxProfileState;
}

/** Strefa wydarzenia - terminy biletu są zegarem w niej. */
const STREFA = "Europe/Warsaw";

function renderuj(props: Wejscie = {}) {
  const pelne = (wejscie: Wejscie) => (
    <EventTicketDialog
      timezone={STREFA}
      open={wejscie.open ?? true}
      onOpenChange={onOpenChange}
      eventId={SALES_IDS.event}
      ticket={wejscie.ticket ?? null}
      nextSortOrder={wejscie.nextSortOrder ?? 30}
      isSaving={wejscie.isSaving ?? false}
      onSubmit={onSubmit}
      taxProfile={wejscie.taxProfile ?? GOTOWY_PUSTY}
      presentation={wejscie.presentation}
    />
  );
  const wynik = render(pelne(props));
  return {
    ...wynik,
    przerysuj: (next: Wejscie) => wynik.rerender(pelne({ ...props, ...next })),
  };
}

const E = "adminEventRegistration.tickets.editor.";
const TP = "adminEventRegistration.taxProfile.";
const FORMAT_PLN = `${E}moneyFormat.PLN`;
const pole = (nazwa: string) => screen.getByLabelText(`${E}${nazwa}`);
/** Podgląd kwoty stojący obok pola ceny. */
const podgladKwoty = (field: HTMLElement): string | null =>
  field.parentElement?.querySelector("[data-money-preview]")?.textContent ?? null;
const przyciskZapisu = () => screen.getByRole("button", { name: `${E}saveAction` });
const przyciskAnuluj = () => screen.getByRole("button", { name: `${E}cancelAction` });

/**
 * Komunikat błędu POWIĄZANY z polem przez `aria-describedby`.
 *
 * Szukanie napisu „gdziekolwiek na ekranie" nie odróżniłoby błędu ceny od błędu
 * puli - oba jadą tym samym kluczem `invalidRequest`. Redaktor musi zobaczyć,
 * KTÓRE pole go zatrzymało.
 */
function bladPrzy(field: HTMLElement): string | null {
  for (const id of (field.getAttribute("aria-describedby") ?? "").split(" ")) {
    const node = id === "" ? null : document.getElementById(id);
    if (node !== null && node.getAttribute("role") === "alert") return node.textContent;
  }
  return null;
}

/** Ostatni ładunek przekazany rodzicowi. */
function ladunek(): EventTicketInput {
  const call = onSubmit.mock.calls.at(-1);
  if (call === undefined) throw new Error("formularz nie wysłał niczego");
  return call[0];
}

/** Profil podatkowy z ostatniego zapisu (`null` = bez zapisu profilu). */
function profilZapisu(): TaxProfileDraft | null {
  const call = onSubmit.mock.calls.at(-1);
  if (call === undefined) throw new Error("formularz nie wysłał niczego");
  return call[2];
}

/** Nowy bilet w stanie gotowym do zapisu - klucz i obie nazwy. */
function wypelnijMinimum() {
  fireEvent.change(pole("key"), { target: { value: "vip_pass" } });
  fireEvent.change(pole("namePl"), { target: { value: "Karnet VIP" } });
  fireEvent.change(pole("nameEn"), { target: { value: "VIP pass" } });
}

beforeEach(() => {
  onSubmit.mockClear();
  onOpenChange.mockClear();
});

describe("EventTicketDialog - otwarcie, tryby i resztki", () => {
  it("dialog zamknięty NIE renderuje treści formularza", () => {
    renderuj({ open: false });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText(`${E}createTitle`)).not.toBeInTheDocument();
  });

  it("nowy bilet: tytuł tworzenia, klucz CZYNNY, kolejność z listy, cena zerowa", () => {
    renderuj({ nextSortOrder: 40 });
    expect(screen.getByText(`${E}createTitle`)).toBeInTheDocument();
    expect(pole("key")).toBeEnabled();
    expect(pole("key")).toHaveValue("");
    expect(pole("sortOrder")).toHaveValue("40");
    expect(pole("priceCents")).toHaveValue("0");
    expect(pole("priceCents")).toHaveAttribute("inputmode", "decimal");
    expect(pole("quota")).toHaveValue("");
    expect(pole("minTierRank")).toHaveValue("0");
  });

  it("edycja: tytuł edycji i klucz ZAMROŻONY z wartością wiersza", () => {
    // Zapisane zgłoszenia wskazują bilet identyfikatorem, ale importy i faktury
    // posługują się kluczem - czynne pole obiecywałoby zmianę, której RPC
    // i tak nie wykona.
    renderuj({ ticket: eventTicketRow() });
    expect(screen.getByText(`${E}editTitle`)).toBeInTheDocument();
    expect(pole("key")).toHaveValue("vip_pass");
    expect(pole("key")).toBeDisabled();
    expect(pole("namePl")).toHaveValue("Karnet VIP");
    expect(pole("nameEn")).toHaveValue("VIP pass");
  });

  it("otwarcie dla INNEGO biletu nie niesie ani jednej wartości poprzedniego", () => {
    // Regresja, którą to łapie: organizator poprawia cenę biletu A, zamyka,
    // otwiera bilet B i zapisuje - z ceną A, bo formularz wyglądał na
    // wypełniony celowo.
    const { przerysuj } = renderuj({ ticket: eventTicketRow() });
    expect(pole("priceCents")).toHaveValue("19,99");

    przerysuj({ open: false });
    przerysuj({
      open: true,
      ticket: eventTicketRow({
        id: SALES_IDS.otherTicket,
        key: "student",
        name_pl: "Bilet studencki",
        name_en: "Student ticket",
        price_cents: 4900,
        quota: 30,
      }),
    });

    expect(pole("key")).toHaveValue("student");
    expect(pole("namePl")).toHaveValue("Bilet studencki");
    expect(pole("priceCents")).toHaveValue("49,00");
    expect(pole("quota")).toHaveValue("30");
  });

  it("PORZUCONE zmiany nie wracają przy ponownym otwarciu tego samego biletu", () => {
    const bilet = eventTicketRow();
    const { przerysuj } = renderuj({ ticket: bilet });
    fireEvent.change(pole("priceCents"), { target: { value: "9999,99" } });
    fireEvent.change(pole("namePl"), { target: { value: "Pomyłka" } });

    przerysuj({ open: false });
    przerysuj({ open: true, ticket: bilet });

    expect(pole("priceCents")).toHaveValue("19,99");
    expect(pole("namePl")).toHaveValue("Karnet VIP");
  });

  it("anulowanie zamyka dialog i NIE wysyła niczego", () => {
    renderuj({ ticket: eventTicketRow() });
    fireEvent.click(przyciskAnuluj());
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("EventTicketDialog - kwoty w złotych", () => {
  it("1999 groszy z bazy to „19,99” w polu i 1999 w ładunku", () => {
    // Obie strony konwersji w jednym teście: wiersz -> pole -> ładunek. Błąd
    // o jedno zero (199 900) albo o dwa rzędy (19) przechodziłby przez
    // formularz niezauważony - w kasie już nie.
    renderuj({ ticket: eventTicketRow({ price_cents: 1999 }) });
    expect(pole("priceCents")).toHaveValue("19,99");
    fireEvent.click(przyciskZapisu());
    expect(ladunek().priceCents).toBe(1999);
    expect(ladunek().currency).toBe("PLN");
  });

  it.each([
    ["899,00", 89_900],
    ["899", 89_900],
    ["899.00", 89_900],
    ["1 299,00", 129_900],
    ["8,99", 899],
  ])("cena „%s” jedzie do ładunku jako %i groszy", (wartosc, grosze) => {
    // „899" to 899 zł, a nie 8,99 zł - dokładnie ten błąd naprawia TIX-14a.
    renderuj();
    wypelnijMinimum();
    fireEvent.change(pole("priceCents"), { target: { value: wartosc } });
    fireEvent.click(przyciskZapisu());
    expect(ladunek().priceCents).toBe(grosze);
  });

  it.each([
    ["8,999", "trzy cyfry po przecinku - tysiące czy grosze?"],
    ["1,299", "przecinek tysięcy bez części dziesiętnej"],
    ["19.999", "trzy miejsca po kropce"],
    ["-1", "cena ujemna"],
    ["", "pole puste"],
    ["dwadzieścia", "tekst niebędący liczbą"],
  ])("cena „%s” NIE wychodzi z formularza (%s)", (wartosc) => {
    renderuj();
    wypelnijMinimum();
    fireEvent.change(pole("priceCents"), { target: { value: wartosc } });
    fireEvent.click(przyciskZapisu());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(bladPrzy(pole("priceCents"))).toBe(FORMAT_PLN);
  });

  it("zdanie o zapisie kwoty mówi w walucie biletu", () => {
    renderuj();
    wypelnijMinimum();
    fireEvent.change(pole("currency"), { target: { value: "EUR" } });
    fireEvent.change(pole("priceCents"), { target: { value: "8,999" } });
    fireEvent.click(przyciskZapisu());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(bladPrzy(pole("priceCents"))).toBe(`${E}moneyFormat.EUR`);
  });

  it("obok pola stoi podgląd kwoty w walucie biletu - i znika przy zapisie błędnym", () => {
    renderuj();
    fireEvent.change(pole("priceCents"), { target: { value: "899" } });
    expect(podgladKwoty(pole("priceCents"))).toMatch(/^899,00\s?zł$/);

    fireEvent.change(pole("currency"), { target: { value: "EUR" } });
    expect(podgladKwoty(pole("priceCents"))).toMatch(/^899,00\s?€$/);

    fireEvent.change(pole("priceCents"), { target: { value: "8,999" } });
    expect(podgladKwoty(pole("priceCents"))).toBe("");
  });

  it("zero jest ceną DOPUSZCZALNĄ - wejściówka bezpłatna z pulą i oknem", () => {
    // Kontrapunkt do listy wyżej: gdyby walidacja odcinała zero, wejściówka
    // bezpłatna byłaby niezapisywalna, a to jest udokumentowany przypadek
    // użycia (podpowiedź przy polu mówi o nim wprost).
    renderuj();
    wypelnijMinimum();
    fireEvent.change(pole("priceCents"), { target: { value: "0" } });
    fireEvent.click(przyciskZapisu());
    expect(ladunek().priceCents).toBe(0);
  });

  it("białe znaki wokół kwoty i nazw są obcinane, nie wysyłane", () => {
    renderuj();
    wypelnijMinimum();
    fireEvent.change(pole("priceCents"), { target: { value: "  19,99  " } });
    fireEvent.change(pole("namePl"), { target: { value: "  Karnet VIP  " } });
    fireEvent.click(przyciskZapisu());
    expect(ladunek().priceCents).toBe(1999);
    expect(ladunek().namePl).toBe("Karnet VIP");
  });

  it("górna granica ceny przepuszcza 100 000,00, ale nie grosz więcej", () => {
    // Powyżej tej kwoty to literówka, a nie oferta - dziesięć milionów groszy
    // jest granicą CHECK-a, więc formularz odcina ją przed żądaniem.
    const { przerysuj } = renderuj();
    wypelnijMinimum();
    fireEvent.change(pole("priceCents"), { target: { value: "100 000,00" } });
    fireEvent.click(przyciskZapisu());
    expect(ladunek().priceCents).toBe(10_000_000);

    przerysuj({ open: false });
    przerysuj({ open: true });
    wypelnijMinimum();
    fireEvent.change(pole("priceCents"), { target: { value: "100000,01" } });
    fireEvent.click(przyciskZapisu());
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(bladPrzy(pole("priceCents"))).toBe("adminEventRegistration.errors.invalidRequest");
  });

  it("wybór waluty dojeżdża do ładunku", () => {
    renderuj();
    wypelnijMinimum();
    fireEvent.change(pole("currency"), { target: { value: "EUR" } });
    fireEvent.click(przyciskZapisu());
    expect(ladunek().currency).toBe("EUR");
  });
});

describe("EventTicketDialog - pula, próg i okno sprzedaży", () => {
  it("pusta pula z bazy zostaje pusta i jedzie jako brak limitu, nie jako zero", () => {
    // `quota = 0` znaczy „bilet bez ani jednego miejsca", czyli natychmiast
    // wyprzedany. Sklejenie obu wartości zamknęłoby sprzedaż biletu, który
    // limitu mieć nie miał.
    renderuj({ ticket: eventTicketRow({ quota: null as unknown as number }) });
    expect(pole("quota")).toHaveValue("");
    fireEvent.click(przyciskZapisu());
    expect(ladunek().quota).toBeNull();
  });

  it("pula zapisana jako zero wraca zerem - to inna decyzja niż brak limitu", () => {
    renderuj({ ticket: eventTicketRow({ quota: 0 }) });
    expect(pole("quota")).toHaveValue("0");
    fireEvent.click(przyciskZapisu());
    expect(ladunek().quota).toBe(0);
  });

  it.each([
    ["-5", "liczba miejsc ujemna"],
    ["1.5", "połowa miejsca"],
    ["100001", "ponad limit stu tysięcy"],
  ])("pula „%s” nie wychodzi z formularza (%s)", (wartosc) => {
    renderuj();
    wypelnijMinimum();
    fireEvent.change(pole("quota"), { target: { value: wartosc } });
    fireEvent.click(przyciskZapisu());
    expect(onSubmit).not.toHaveBeenCalled();
    expect(bladPrzy(pole("quota"))).toBe("adminEventRegistration.errors.invalidRequest");
  });

  it.each([
    ["", "próg pusty"],
    ["-1", "próg ujemny"],
    ["101", "próg spoza skali"],
  ])("próg warstwy „%s” nie wychodzi z formularza (%s)", (wartosc) => {
    renderuj();
    wypelnijMinimum();
    fireEvent.change(pole("minTierRank"), { target: { value: wartosc } });
    fireEvent.click(przyciskZapisu());
    expect(onSubmit).not.toHaveBeenCalled();
    expect(bladPrzy(pole("minTierRank"))).toBe("adminEventRegistration.errors.invalidRequest");
  });

  it("okno zamknięte PRZED otwarciem zatrzymuje zapis przy polu „sprzedaż do”", () => {
    // Bilet, którego nie da się kupić ani dziś, ani nigdy. Baza odrzuca to
    // CHECK-iem bez nazwy kolumny, więc odcinamy wcześniej i wskazujemy pole.
    renderuj();
    wypelnijMinimum();
    fireEvent.change(pole("salesFrom"), { target: { value: "2026-09-10T10:00" } });
    fireEvent.change(pole("salesTo"), { target: { value: "2026-09-01T10:00" } });
    fireEvent.click(przyciskZapisu());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(bladPrzy(pole("salesTo"))).toBe("adminEventRegistration.errors.invalidRequest");
  });

  it("okno poprawne jedzie jako dwie chwile ISO, a brak daty jako null", () => {
    renderuj();
    wypelnijMinimum();
    fireEvent.change(pole("salesTo"), { target: { value: "2026-09-10T18:30" } });
    fireEvent.click(przyciskZapisu());

    expect(ladunek().salesFrom).toBeNull();
    // 18:30 w Warszawie (CEST, UTC+2).
    expect(ladunek().salesTo).toBe("2026-09-10T16:30:00.000Z");
  });

  it("pod polami terminów stoi strefa wydarzenia, w której jest zegar", () => {
    renderuj();
    const opisy = (nazwa: string) =>
      (pole(nazwa).getAttribute("aria-describedby") ?? "")
        .split(" ")
        .map((id) => document.getElementById(id)?.textContent ?? "");
    for (const nazwa of ["salesFrom", "salesTo", "earlyBirdUntil"]) {
      expect(opisy(nazwa)).toContain("adminEvents.eventTime.zone(zone=Europe/Warsaw)");
    }
  });

  it("nietknięty termin z sekundami wraca do bazy co do milisekundy", () => {
    // Pole `datetime-local` nie pokazuje sekund. Bez pamięci chwili z bazy zapis
    // samej nazwy przycinałby koniec sprzedaży 23:59:59 do 23:59:00.
    renderuj({ ticket: eventTicketRow({ sales_to: "2026-09-30T21:59:59.000Z" }) });
    expect(pole("salesTo")).toHaveValue("2026-09-30T23:59");
    fireEvent.click(przyciskZapisu());
    expect(ladunek().salesTo).toBe("2026-09-30T21:59:59.000Z");
  });
});

describe("EventTicketDialog - cena promocyjna", () => {
  it("cena promocyjna BEZ terminu zatrzymuje zapis przy polu terminu", () => {
    // Para jest niepodzielna: cena bez terminu obowiązywałaby wiecznie, czyli
    // bilet byłby na stałe tańszy, niż go wyceniono.
    renderuj();
    wypelnijMinimum();
    fireEvent.change(pole("priceCents"), { target: { value: "150,00" } });
    fireEvent.change(pole("earlyBirdPriceCents"), { target: { value: "99,00" } });
    fireEvent.click(przyciskZapisu());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(bladPrzy(pole("earlyBirdUntil"))).toBe("adminEventRegistration.errors.invalidEarlyBird");
  });

  it("termin BEZ ceny promocyjnej zatrzymuje zapis przy polu ceny", () => {
    renderuj();
    wypelnijMinimum();
    fireEvent.change(pole("earlyBirdUntil"), { target: { value: "2026-09-01T10:00" } });
    fireEvent.click(przyciskZapisu());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(bladPrzy(pole("earlyBirdPriceCents"))).toBe(
      "adminEventRegistration.errors.invalidEarlyBird",
    );
  });

  it("cena promocyjna WYŻSZA od podstawowej nie wychodzi, równa - wychodzi", () => {
    const { przerysuj } = renderuj();
    wypelnijMinimum();
    fireEvent.change(pole("priceCents"), { target: { value: "150,00" } });
    fireEvent.change(pole("earlyBirdPriceCents"), { target: { value: "150,01" } });
    fireEvent.change(pole("earlyBirdUntil"), { target: { value: "2026-09-01T10:00" } });
    fireEvent.click(przyciskZapisu());
    expect(onSubmit).not.toHaveBeenCalled();
    expect(bladPrzy(pole("earlyBirdPriceCents"))).toBe(
      "adminEventRegistration.errors.invalidEarlyBird",
    );

    // Granica jest DOMKNIĘTA: promocja równa cenie podstawowej to nadal
    // poprawna oferta, tylko bez rabatu.
    przerysuj({ open: false });
    przerysuj({ open: true });
    wypelnijMinimum();
    fireEvent.change(pole("priceCents"), { target: { value: "150" } });
    fireEvent.change(pole("earlyBirdPriceCents"), { target: { value: "150,00" } });
    fireEvent.change(pole("earlyBirdUntil"), { target: { value: "2026-09-01T10:00" } });
    fireEvent.click(przyciskZapisu());
    expect(ladunek().earlyBirdPriceCents).toBe(15_000);
    expect(ladunek().earlyBirdUntil).toBe("2026-09-01T08:00:00.000Z");
  });

  it("cena promocyjna nie do przeczytania zatrzymuje zapis zdaniem o kwocie przy SWOIM polu", () => {
    renderuj();
    wypelnijMinimum();
    fireEvent.change(pole("priceCents"), { target: { value: "150" } });
    fireEvent.change(pole("earlyBirdPriceCents"), { target: { value: "8,999" } });
    fireEvent.click(przyciskZapisu());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(bladPrzy(pole("earlyBirdPriceCents"))).toBe(FORMAT_PLN);
    expect(bladPrzy(pole("earlyBirdUntil"))).toBeNull();
  });

  it("cena promocyjna z bazy wraca w złotych i jedzie z powrotem w groszach", () => {
    renderuj({
      ticket: eventTicketRow({
        price_cents: 89_900,
        early_bird_price_cents: 69_950,
        early_bird_until: "2026-09-01T08:30:00.000Z",
      }),
    });
    expect(pole("earlyBirdPriceCents")).toHaveValue("699,50");
    expect(podgladKwoty(pole("earlyBirdPriceCents"))).toMatch(/^699,50\s?zł$/);
    fireEvent.click(przyciskZapisu());
    expect(ladunek().priceCents).toBe(89_900);
    expect(ladunek().earlyBirdPriceCents).toBe(69_950);
  });

  it("bilet bez ceny promocyjnej wysyła oba pola jako null", () => {
    renderuj({ ticket: eventTicketRow() });
    fireEvent.click(przyciskZapisu());
    expect(ladunek().earlyBirdPriceCents).toBeNull();
    expect(ladunek().earlyBirdUntil).toBeNull();
  });
});

describe("EventTicketDialog - kod dostępu ma trzy stany", () => {
  it("bilet BEZ kodu: brak przełącznika zdejmowania, a pusty kod nie rusza bramki", () => {
    // `undefined` znaczy „zostaw obecny kod". Wysłanie pustego napisu jako
    // „skasuj" myliłoby brak wpisu ze świadomym zdjęciem bramki.
    renderuj({ ticket: eventTicketRow({ has_access_code: false }) });
    expect(screen.getByText(`${E}accessCodeNone`)).toBeInTheDocument();
    expect(screen.queryByLabelText(`${E}removeAccessCode`)).not.toBeInTheDocument();

    fireEvent.click(przyciskZapisu());
    expect(ladunek().accessCode).toBeUndefined();
  });

  it("bilet Z kodem: podpowiedź mówi o kodzie, a przełącznik zdejmuje go jawnie", () => {
    renderuj({ ticket: eventTicketRow({ has_access_code: true }) });
    expect(screen.getByText(`${E}accessCodeSet`)).toBeInTheDocument();

    const przelacznik = screen.getByLabelText(`${E}removeAccessCode`);
    fireEvent.click(przelacznik);

    // Pole kodu przestaje być czynne - „zdejmij" i „ustaw nowy" to dwie
    // wykluczające się decyzje.
    expect(pole("accessCode")).toBeDisabled();
    fireEvent.click(przyciskZapisu());
    expect(ladunek().accessCode).toBeNull();
  });

  it("wpisany kod jedzie napisem, a krótszy niż cztery znaki zatrzymuje zapis", () => {
    const { przerysuj } = renderuj({ ticket: eventTicketRow() });
    fireEvent.change(pole("accessCode"), { target: { value: "abc" } });
    fireEvent.click(przyciskZapisu());
    expect(onSubmit).not.toHaveBeenCalled();
    expect(bladPrzy(pole("accessCode"))).toBe("adminEventRegistration.errors.invalidAccessCode");

    przerysuj({ open: false });
    przerysuj({ open: true, ticket: eventTicketRow() });
    fireEvent.change(pole("accessCode"), { target: { value: "  kongres2026  " } });
    fireEvent.change(pole("accessCodeHintLabel"), { target: { value: " kod z zaproszenia " } });
    fireEvent.click(przyciskZapisu());
    expect(ladunek().accessCode).toBe("kongres2026");
    expect(ladunek().accessCodeHint).toBe("kod z zaproszenia");
  });
});

describe("EventTicketDialog - korzyści, progi i przełączniki", () => {
  it("korzyści z bazy wracają linia po linii, a puste linie odpadają z ładunku", () => {
    renderuj({
      ticket: eventTicketRow({
        benefits_pl: ["Wstęp na dwa dni", "Lunch"],
        benefits_en: ["Two-day access"],
      }),
    });
    expect(pole("benefitsPl")).toHaveValue("Wstęp na dwa dni\nLunch");

    fireEvent.change(pole("benefitsPl"), {
      target: { value: "  Wstęp na dwa dni  \n\n  Lunch\n" },
    });
    fireEvent.click(przyciskZapisu());
    expect(ladunek().benefitsPl).toEqual(["Wstęp na dwa dni", "Lunch"]);
    expect(ladunek().benefitsEn).toEqual(["Two-day access"]);
  });

  it("każda kolumna językowa niesie SWOJĄ treść, a nie treść sąsiada", () => {
    // Blok „etykieta + pole" jest w tym formularzu przeklejony czternaście
    // razy. Pole opisane etykietą angielską, które zapisuje treść do klucza
    // polskiego, wygląda na ekranie DOKŁADNIE tak jak poprawne - widać to
    // dopiero na karcie biletu u uczestnika, w złym języku.
    renderuj();
    wypelnijMinimum();
    fireEvent.change(pole("descriptionPl"), { target: { value: "Opis polski" } });
    fireEvent.change(pole("descriptionEn"), { target: { value: "English description" } });
    fireEvent.change(pole("benefitsPl"), { target: { value: "Lunch" } });
    fireEvent.change(pole("benefitsEn"), { target: { value: "Lunch included" } });
    fireEvent.click(przyciskZapisu());

    expect(ladunek()).toMatchObject({
      descriptionPl: "Opis polski",
      descriptionEn: "English description",
      benefitsPl: ["Lunch"],
      benefitsEn: ["Lunch included"],
    });
  });

  it("próg cennika wpisany w złotych dojeżdża do ładunku w groszach i w ISO", () => {
    renderuj();
    wypelnijMinimum();
    fireEvent.click(screen.getByRole("button", { name: `${E}phaseAdd` }));
    fireEvent.change(screen.getByLabelText(`${E}phaseLabelPl`), {
      target: { value: "  Early bird  " },
    });
    fireEvent.change(screen.getByLabelText(`${E}phasePrice`), { target: { value: "99" } });
    fireEvent.change(screen.getByLabelText(`${E}phaseTo`), {
      target: { value: "2026-09-01T23:59" },
    });
    fireEvent.click(przyciskZapisu());

    expect(ladunek().priceSchedule).toEqual([
      {
        labelPl: "Early bird",
        labelEn: "",
        from: null,
        // 23:59 w Warszawie (CEST, UTC+2).
        to: "2026-09-01T21:59:00.000Z",
        priceCents: 9900,
      },
    ]);
  });

  it("próg bez ceny zatrzymuje zapis komunikatem dla CAŁEJ listy - z numerem progu", () => {
    // Baza odrzuca cennik w całości i bez numeru wiersza, więc komunikat też
    // stoi pod listą - ale musi się w ogóle pojawić i wskazać próg, inaczej
    // redaktor klika „Zapisz" w kółko bez żadnej odpowiedzi.
    renderuj();
    wypelnijMinimum();
    fireEvent.click(screen.getByRole("button", { name: `${E}phaseAdd` }));
    fireEvent.click(przyciskZapisu());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(`${E}phaseMoneyFormat.PLN(index=1)`);
  });

  it("cena progu z bazy wraca w złotych, a niezmieniona jedzie tymi samymi groszami", () => {
    renderuj({
      ticket: eventTicketRow({
        price_cents: 15_000,
        price_schedule: [{ label_pl: "Early", label_en: "Early", price_cents: 12_345 }],
      }),
    });
    expect(screen.getByLabelText(`${E}phasePrice`)).toHaveValue("123,45");
    fireEvent.click(przyciskZapisu());
    expect(ladunek().priceSchedule.map((phase) => phase.priceCents)).toEqual([12_345]);
  });

  it("próg z kwotą niejednoznaczną zatrzymuje zapis - nie zgadujemy groszy", () => {
    renderuj();
    wypelnijMinimum();
    fireEvent.click(screen.getByRole("button", { name: `${E}phaseAdd` }));
    fireEvent.change(screen.getByLabelText(`${E}phasePrice`), { target: { value: "8,999" } });
    fireEvent.click(przyciskZapisu());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(`${E}phaseMoneyFormat.PLN(index=1)`);
  });

  it("trzy przełączniki i kolejność dojeżdżają do ładunku", () => {
    renderuj({ nextSortOrder: 70 });
    wypelnijMinimum();
    fireEvent.click(screen.getByLabelText(`${E}requiresApproval`));
    fireEvent.click(screen.getByLabelText(`${E}active`));
    fireEvent.click(screen.getByLabelText(`${E}waitlistEnabled`));
    fireEvent.click(przyciskZapisu());

    expect(ladunek()).toMatchObject({
      id: null,
      eventId: SALES_IDS.event,
      key: "vip_pass",
      requiresApproval: true,
      isActive: false,
      waitlistEnabled: false,
      sortOrder: 70,
      groupId: null,
    });
  });

  it("edycja niesie identyfikator i PRZENOSI grupę, zamiast ją zerować", () => {
    // Katalog grup ma własny ekran; zapis nazwy biletu nie może po cichu
    // odpiąć grupy nadawanej uczestnikom.
    renderuj({ ticket: eventTicketRow({ group_id: "eeeeeeee-1111-4111-8111-111111111111" }) });
    fireEvent.click(przyciskZapisu());
    expect(ladunek().id).toBe(SALES_IDS.ticket);
    expect(ladunek().groupId).toBe("eeeeeeee-1111-4111-8111-111111111111");
  });

  it("pusta kolejność jedzie jako zero, a nie jako pusty napis", () => {
    renderuj();
    wypelnijMinimum();
    fireEvent.change(pole("sortOrder"), { target: { value: "" } });
    fireEvent.click(przyciskZapisu());
    expect(ladunek().sortOrder).toBe(0);
  });
});

describe("EventTicketDialog - moment komunikatu i zapis w locie", () => {
  it("komunikat pojawia się dopiero PO pierwszej próbie zapisu", () => {
    // Formularz krzyczący przy pierwszej literze klucza uczy redaktora
    // ignorować komunikaty - a wtedy nie zauważy tego, który ma znaczenie.
    renderuj();
    expect(bladPrzy(pole("key"))).toBeNull();

    fireEvent.click(przyciskZapisu());
    expect(bladPrzy(pole("key"))).toBe("adminEventRegistration.errors.invalidKey");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("poprawienie pola gasi komunikat i przepuszcza zapis", () => {
    renderuj();
    fireEvent.click(przyciskZapisu());
    expect(bladPrzy(pole("key"))).toBe("adminEventRegistration.errors.invalidKey");

    wypelnijMinimum();
    expect(bladPrzy(pole("key"))).toBeNull();
    fireEvent.click(przyciskZapisu());
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("brak nazwy angielskiej zatrzymuje zapis przy TYM polu, nie przy polskim", () => {
    renderuj();
    fireEvent.change(pole("key"), { target: { value: "vip_pass" } });
    fireEvent.change(pole("namePl"), { target: { value: "Karnet VIP" } });
    fireEvent.click(przyciskZapisu());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(bladPrzy(pole("nameEn"))).toBe("adminEventRegistration.errors.invalidNames");
    expect(bladPrzy(pole("namePl"))).toBeNull();
  });

  it("trwający zapis blokuje OBA przyciski - podwójne kliknięcie wysyła RAZ", () => {
    // Bez tego dwa kliknięcia w sekundę tworzą dwa bilety o tym samym kluczu,
    // a drugi zapis kończy się odmową unikalności, której nikt nie rozumie.
    const { przerysuj } = renderuj();
    wypelnijMinimum();
    fireEvent.click(przyciskZapisu());
    expect(onSubmit).toHaveBeenCalledTimes(1);

    przerysuj({ isSaving: true });
    expect(przyciskZapisu()).toBeDisabled();
    expect(przyciskAnuluj()).toBeDisabled();

    fireEvent.click(przyciskZapisu());
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("wysłanie ładunku NIE zamyka dialogu - odmowa serwera zostawia całą pracę", () => {
    // Zamknięcie należy do rodzica i następuje dopiero po sukcesie. Gdyby
    // molekuła zamykała się sama, odmowa bazy kasowałaby kwadrans pracy
    // i nikt by nie wiedział, co dokładnie zniknęło.
    renderuj();
    wypelnijMinimum();
    fireEvent.change(pole("descriptionPl"), { target: { value: "Opis, którego szkoda" } });
    fireEvent.click(przyciskZapisu());

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(pole("descriptionPl")).toHaveValue("Opis, którego szkoda");
    expect(pole("namePl")).toHaveValue("Karnet VIP");
  });

  it("kolejność wpisana literami NIE wychodzi z formularza jako NaN", () => {
    // `ticketDraftIssue` nie sprawdzał pola „Kolejność" WCALE (nie było go
    // nawet w `TicketDraftField`), a `ticketDraftToInput` robi na nim
    // `Number()`. Wpisane „pierwszy" dawało `sortOrder: NaN`, które w JSON-ie
    // zamieniało się w `null` i wracało odmową NOT NULL bez nazwy kolumny -
    // użytkownik widział „coś poszło nie tak" i ani jednego podświetlonego
    // pola. Bliźniaczy `packageDraftIssue` to pole sprawdzał od początku.
    renderuj();
    wypelnijMinimum();
    fireEvent.change(pole("sortOrder"), { target: { value: "pierwszy" } });
    fireEvent.click(przyciskZapisu());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("odświeżenie listy w tle NIE kasuje wpisanych zmian", () => {
    // Efekt odtwarzający szkic zależał od `nextSortOrder`, a ta liczba jest
    // policzona z listy biletów przy KAŻDYM renderze rodzica. Gdy lista
    // odświeżyła się w tle (ktoś inny dodał bilet), liczba się zmieniała, efekt
    // ruszał mimo otwartego dialogu i zamiatał wpisaną cenę. Teraz zależnością
    // jest TOŻSAMOŚĆ wiersza, a kolejność początkowa idzie przez `ref`.
    const { przerysuj } = renderuj({ ticket: eventTicketRow(), nextSortOrder: 30 });
    fireEvent.change(pole("priceCents"), { target: { value: "129,00" } });

    przerysuj({ nextSortOrder: 40 });

    expect(pole("priceCents")).toHaveValue("129,00");
  });
});

describe("EventTicketDialog - podgląd podatku", () => {
  const PLUS_TAX = "adminEventRegistration.tickets.studio.previewPlusTax";

  it("płatny bilet z podatkiem doliczanym pokazuje w podglądzie „+ podatek”", () => {
    renderuj({
      ticket: eventTicketRow({ price_cents: 1999 }),
      presentation: { ...DEFAULT_TICKET_PRESENTATION, taxMode: "exclusive" },
    });
    expect(screen.getByText(PLUS_TAX)).toBeTruthy();
  });

  it("podatek wliczony albo ukryta etykieta ceny - bez dopisku", () => {
    const { przerysuj } = renderuj({
      ticket: eventTicketRow({ price_cents: 1999 }),
      presentation: { ...DEFAULT_TICKET_PRESENTATION, taxMode: "inclusive" },
    });
    expect(screen.queryByText(PLUS_TAX)).toBeNull();
    przerysuj({
      open: false,
    });
    przerysuj({
      open: true,
      presentation: {
        ...DEFAULT_TICKET_PRESENTATION,
        taxMode: "exclusive",
        showPriceLabel: false,
      },
    });
    expect(screen.queryByText(PLUS_TAX)).toBeNull();
  });

  it("bilet bezpłatny nie dostaje dopisku nawet przy podatku doliczanym", () => {
    renderuj({
      ticket: eventTicketRow({ price_cents: 0 }),
      presentation: { ...DEFAULT_TICKET_PRESENTATION, taxMode: "exclusive" },
    });
    expect(screen.queryByText(PLUS_TAX)).toBeNull();
  });
});

describe("EventTicketDialog - profil podatkowy (TIX-09)", () => {
  const ZW: TaxProfileDraft = {
    vatRate: "zw",
    vatExemptBasis: "art. 43 ust. 1 pkt 29 ustawy o VAT",
    stripeTaxCode: "txcd_20030000",
  };
  const stawka = () => screen.getByLabelText(`${TP}vatRate`);
  const kod = () => screen.getByLabelText(`${TP}stripeTaxCode`);
  const podstawa = () => screen.getByLabelText(`${TP}vatExemptBasis`);

  it("sekcja „podatek na fakturze” stoi w oknie z wartością ZAPISANĄ biletu", () => {
    renderuj({ ticket: eventTicketRow(), taxProfile: { status: "ready", value: ZW } });

    expect(screen.getByText(`${TP}section`)).toBeInTheDocument();
    expect(stawka()).toHaveValue("zw");
    expect(kod()).toHaveValue("txcd_20030000");
    expect(podstawa()).toHaveValue(ZW.vatExemptBasis);
    expect(kod()).toBeEnabled();
  });

  it("zapis BEZ zmian w profilu nie niesie profilu - drugiego RPC nie będzie", () => {
    renderuj({ ticket: eventTicketRow(), taxProfile: { status: "ready", value: ZW } });
    fireEvent.click(przyciskZapisu());

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(profilZapisu()).toBeNull();
  });

  it("nowy bilet bez profilu nie niesie profilu, a z ustawioną stawką - niesie", () => {
    const { przerysuj } = renderuj();
    wypelnijMinimum();
    fireEvent.click(przyciskZapisu());
    expect(profilZapisu()).toBeNull();

    przerysuj({ open: false });
    przerysuj({ open: true });
    wypelnijMinimum();
    fireEvent.change(stawka(), { target: { value: "8" } });
    fireEvent.change(kod(), { target: { value: "txcd_10000000" } });
    fireEvent.click(przyciskZapisu());

    expect(profilZapisu()).toEqual({
      vatRate: "8",
      vatExemptBasis: "",
      stripeTaxCode: "txcd_10000000",
    });
  });

  it("zmieniony profil jedzie trzecim argumentem obok biletu i wyglądu", () => {
    renderuj({ ticket: eventTicketRow(), taxProfile: { status: "ready", value: ZW } });
    fireEvent.change(stawka(), { target: { value: "23" } });
    fireEvent.click(przyciskZapisu());

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(ladunek().id).toBe(SALES_IDS.ticket);
    expect(profilZapisu()).toEqual({ ...ZW, vatRate: "23" });
  });

  it("zły kod Stripe zatrzymuje CAŁY zapis z komunikatem przy polu kodu", () => {
    renderuj({ ticket: eventTicketRow() });
    fireEvent.change(kod(), { target: { value: "txcd_123" } });
    fireEvent.click(przyciskZapisu());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(bladPrzy(kod())).toBe(`${TP}stripeTaxCodeInvalid`);

    // Poprawka gasi komunikat i przepuszcza zapis z profilem.
    fireEvent.change(kod(), { target: { value: "TXCD_10000000" } });
    fireEvent.click(przyciskZapisu());
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(profilZapisu()?.stripeTaxCode).toBe("TXCD_10000000");
  });

  it("podstawa zwolnienia dłuższa niż 300 znaków zatrzymuje zapis - bez przycinania", () => {
    renderuj({ ticket: eventTicketRow() });
    fireEvent.change(stawka(), { target: { value: "zw" } });
    fireEvent.change(podstawa(), { target: { value: "x".repeat(301) } });
    fireEvent.click(przyciskZapisu());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(podstawa()).toHaveValue("x".repeat(301));
    expect(bladPrzy(podstawa())).toBe(`${TP}vatExemptBasisTooLong(length=301,max=300)`);
  });

  it("błąd biletu i błąd profilu świecą razem po pierwszej próbie zapisu", () => {
    renderuj();
    fireEvent.change(kod(), { target: { value: "zly" } });
    expect(bladPrzy(kod())).toBeNull();

    fireEvent.click(przyciskZapisu());
    expect(bladPrzy(pole("key"))).toBe("adminEventRegistration.errors.invalidKey");
    expect(bladPrzy(kod())).toBe(`${TP}stripeTaxCodeInvalid`);
  });

  it("baza bez migracji: zdanie zamiast pól i zapis BEZ profilu", () => {
    renderuj({ ticket: eventTicketRow(), taxProfile: { status: "unavailable" } });

    expect(screen.getByText(`${TP}unavailable`)).toBeInTheDocument();
    expect(screen.queryByLabelText(`${TP}vatRate`)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(`${TP}stripeTaxCode`)).not.toBeInTheDocument();

    fireEvent.click(przyciskZapisu());
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(profilZapisu()).toBeNull();
  });

  it("awaria odczytu profilu mówi to zdaniem z powodem i nie zapisuje profilu", () => {
    renderuj({
      ticket: eventTicketRow(),
      taxProfile: { status: "failed", error: new Error("forbidden") },
    });

    expect(screen.getByText(/taxProfileLoadFailed\(reason=/)).toBeInTheDocument();
    expect(screen.queryByLabelText(`${TP}vatRate`)).not.toBeInTheDocument();
    fireEvent.click(przyciskZapisu());
    expect(profilZapisu()).toBeNull();
  });

  it("w trakcie wczytywania pola są zgaszone, a zapis nie niesie profilu", () => {
    renderuj({ ticket: eventTicketRow(), taxProfile: { status: "loading" } });

    expect(kod()).toBeDisabled();
    fireEvent.click(przyciskZapisu());
    expect(profilZapisu()).toBeNull();
  });

  it("profil wczytany PO otwarciu staje się wartością pól i punktem odniesienia", () => {
    const { przerysuj } = renderuj({
      ticket: eventTicketRow(),
      taxProfile: { status: "loading" },
    });
    przerysuj({ taxProfile: { status: "ready", value: ZW } });

    expect(kod()).toBeEnabled();
    expect(kod()).toHaveValue("txcd_20030000");
    fireEvent.click(przyciskZapisu());
    // Wartość z bazy nie jest zmianą - nic do zapisania.
    expect(profilZapisu()).toBeNull();
  });

  it("odświeżenie profilu w tle NIE kasuje wpisanej zmiany", () => {
    const { przerysuj } = renderuj({
      ticket: eventTicketRow(),
      taxProfile: { status: "ready", value: ZW },
    });
    fireEvent.change(kod(), { target: { value: "txcd_10000000" } });

    // Nowy obiekt z tą samą treścią - tak wygląda ponowny odczyt zapytania.
    przerysuj({ taxProfile: { status: "ready", value: { ...ZW } } });

    expect(kod()).toHaveValue("txcd_10000000");
    fireEvent.click(przyciskZapisu());
    expect(profilZapisu()).toEqual({ ...ZW, stripeTaxCode: "txcd_10000000" });
  });

  it("ponowne otwarcie innego biletu startuje od JEGO profilu, nie od resztek", () => {
    const { przerysuj } = renderuj({
      ticket: eventTicketRow(),
      taxProfile: { status: "ready", value: ZW },
    });
    fireEvent.change(kod(), { target: { value: "txcd_10000000" } });

    przerysuj({ open: false });
    przerysuj({
      open: true,
      ticket: eventTicketRow({ id: SALES_IDS.otherTicket, key: "student" }),
      taxProfile: GOTOWY_PUSTY,
    });

    expect(kod()).toHaveValue("");
    expect(stawka()).toHaveValue("default");
    fireEvent.click(przyciskZapisu());
    expect(profilZapisu()).toBeNull();
  });
});
