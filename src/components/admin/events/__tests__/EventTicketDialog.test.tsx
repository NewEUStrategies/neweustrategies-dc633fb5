// Molekuła „Formularz biletu" - SKLEJENIE czternastu pól z regułami szkicu.
//
// TO JEST EKRAN, KTÓRY DOTYKA PIENIĘDZY. Cena biletu żyje w bazie w GROSZACH
// i formularz też prowadzi ją w groszach (podpowiedź mówi wprost: „15000 to
// 150,00"). Pomyłka o jedno zero jest tu nie do zauważenia wzrokiem, więc
// asercje idą na ŁADUNKU przekazanym do `onSubmit`, a nie na wyglądzie pola.
//
// CO TEN PLIK DOWODZI.
//   1. DIALOG ZAMKNIĘTY NIE RENDERUJE TREŚCI, a KAŻDE otwarcie odtwarza szkic:
//      bilet A zamknięty i bilet B otwarty nie może pokazać ani jednej wartości
//      A. To samo dotyczy PORZUCONYCH zmian na tym samym bilecie - wracają
//      wartości wiersza, nie to, co ktoś wpisał i się rozmyślił.
//   2. TRYB TWORZENIA I TRYB EDYCJI TO DWA RÓŻNE EKRANY: inny tytuł i klucz,
//      który po zapisie jest ZAMROŻONY (RPC i tak go przy edycji ignoruje,
//      więc czynne pole byłoby obietnicą bez pokrycia).
//   3. KWOTA JEDZIE W GROSZACH W OBIE STRONY. Wiersz z 1999 wraca do ładunku
//      jako 1999 - nie 19,99 i nie 199 900. Wejścia zdegenerowane (przecinek,
//      kropka, minus, pustka, litery, trzy miejsca po przecinku) NIE WYCHODZĄ
//      z formularza i mają komunikat PRZY SWOIM polu.
//   4. LIMITY: pula ujemna i ułamkowa nie wychodzi, pusta pula jedzie jako
//      `null` (bez limitu), a nie jako zero (bilet natychmiast wyprzedany).
//   5. TRZY STANY KODU DOSTĘPU mają trzy różne ładunki: brak klucza w obiekcie
//      (nie ruszaj), napis (ustaw), `null` (zdejmij).
//   6. KOMUNIKAT POJAWIA SIĘ PO PIERWSZEJ PRÓBIE ZAPISU, nie przy pisaniu.
//   7. TRWAJĄCY ZAPIS BLOKUJE PRZYCISK - podwójne kliknięcie wysyła RAZ.
//   8. MOLEKUŁA NIE ZAMYKA SIĘ SAMA. Zamknięcie po sukcesie należy do rodzica,
//      więc odmowa serwera zostawia dialog otwarty z całą pracą użytkownika.
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
// i oczekujemy ISO policzonego w teście tym samym `new Date(...)`, co
// przeglądarka - dzięki temu asercja nie zakłada strefy maszyny.
// Radix Dialog i Select nie działają pod happy-dom bez pełnego pointer API.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { SALES_IDS, eventTicketRow } from "@/test/events/adminSalesRows";
import type { EventTicketInput, EventTicketRow } from "@/lib/events/registrationsApi";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

// Atrapa Radixa: `Root` renderuje dzieci zawsze, ale `Content` istnieje TYLKO
// przy otwartym dialogu (portal nie jest montowany). Bez tego „dialog zamknięty
// nie renderuje treści" byłoby dowodem na atrapę, a nie na molekułę.
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

const onSubmit = vi.fn<(input: EventTicketInput) => void>();
const onOpenChange = vi.fn();

interface Wejscie {
  open?: boolean;
  ticket?: EventTicketRow | null;
  nextSortOrder?: number;
  isSaving?: boolean;
}

function renderuj(props: Wejscie = {}) {
  const pelne = (wejscie: Wejscie) => (
    <EventTicketDialog
      open={wejscie.open ?? true}
      onOpenChange={onOpenChange}
      eventId={SALES_IDS.event}
      ticket={wejscie.ticket ?? null}
      nextSortOrder={wejscie.nextSortOrder ?? 30}
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

const E = "adminEventRegistration.tickets.editor.";
const pole = (nazwa: string) => screen.getByLabelText(`${E}${nazwa}`);
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
    expect(pole("priceCents")).toHaveValue("1999");

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
    expect(pole("priceCents")).toHaveValue("4900");
    expect(pole("quota")).toHaveValue("30");
  });

  it("PORZUCONE zmiany nie wracają przy ponownym otwarciu tego samego biletu", () => {
    const bilet = eventTicketRow();
    const { przerysuj } = renderuj({ ticket: bilet });
    fireEvent.change(pole("priceCents"), { target: { value: "999999" } });
    fireEvent.change(pole("namePl"), { target: { value: "Pomyłka" } });

    przerysuj({ open: false });
    przerysuj({ open: true, ticket: bilet });

    expect(pole("priceCents")).toHaveValue("1999");
    expect(pole("namePl")).toHaveValue("Karnet VIP");
  });

  it("anulowanie zamyka dialog i NIE wysyła niczego", () => {
    renderuj({ ticket: eventTicketRow() });
    fireEvent.click(przyciskAnuluj());
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("EventTicketDialog - kwoty w groszach", () => {
  it("1999 z bazy wraca do ładunku jako 1999 - bez dzielenia i bez mnożenia", () => {
    // Obie strony konwersji w jednym teście: wiersz -> pole -> ładunek. Błąd
    // o jedno zero (199 900) albo o dwa rzędy (19,99) przechodziłby przez
    // formularz niezauważony - w kasie już nie.
    renderuj({ ticket: eventTicketRow({ price_cents: 1999 }) });
    expect(pole("priceCents")).toHaveValue("1999");
    fireEvent.click(przyciskZapisu());
    expect(ladunek().priceCents).toBe(1999);
    expect(ladunek().currency).toBe("PLN");
  });

  it.each([
    ["19,99", "przecinek zamiast kropki - odruch złotówkowy"],
    ["19.99", "kropka dziesiętna - grosze są liczbą całkowitą"],
    ["19.999", "trzy miejsca po przecinku"],
    ["-1", "cena ujemna"],
    ["", "pole puste"],
    ["dwadzieścia", "tekst niebędący liczbą"],
  ])("cena „%s” NIE wychodzi z formularza (%s)", (wartosc) => {
    renderuj();
    wypelnijMinimum();
    fireEvent.change(pole("priceCents"), { target: { value: wartosc } });
    fireEvent.click(przyciskZapisu());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(bladPrzy(pole("priceCents"))).toBe("adminEventRegistration.errors.invalidRequest");
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
    fireEvent.change(pole("priceCents"), { target: { value: "  1999  " } });
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
    fireEvent.change(pole("priceCents"), { target: { value: "10000000" } });
    fireEvent.click(przyciskZapisu());
    expect(ladunek().priceCents).toBe(10_000_000);

    przerysuj({ open: false });
    przerysuj({ open: true });
    wypelnijMinimum();
    fireEvent.change(pole("priceCents"), { target: { value: "10000001" } });
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
    expect(ladunek().salesTo).toBe(new Date("2026-09-10T18:30").toISOString());
  });
});

describe("EventTicketDialog - cena promocyjna", () => {
  it("cena promocyjna BEZ terminu zatrzymuje zapis przy polu terminu", () => {
    // Para jest niepodzielna: cena bez terminu obowiązywałaby wiecznie, czyli
    // bilet byłby na stałe tańszy, niż go wyceniono.
    renderuj();
    wypelnijMinimum();
    fireEvent.change(pole("priceCents"), { target: { value: "15000" } });
    fireEvent.change(pole("earlyBirdPriceCents"), { target: { value: "9900" } });
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
    fireEvent.change(pole("priceCents"), { target: { value: "15000" } });
    fireEvent.change(pole("earlyBirdPriceCents"), { target: { value: "15001" } });
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
    fireEvent.change(pole("priceCents"), { target: { value: "15000" } });
    fireEvent.change(pole("earlyBirdPriceCents"), { target: { value: "15000" } });
    fireEvent.change(pole("earlyBirdUntil"), { target: { value: "2026-09-01T10:00" } });
    fireEvent.click(przyciskZapisu());
    expect(ladunek().earlyBirdPriceCents).toBe(15_000);
    expect(ladunek().earlyBirdUntil).toBe(new Date("2026-09-01T10:00").toISOString());
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

  it("próg cennika dodany w edytorze dojeżdża do ładunku w groszach i w ISO", () => {
    renderuj();
    wypelnijMinimum();
    fireEvent.click(screen.getByRole("button", { name: `${E}phaseAdd` }));
    fireEvent.change(screen.getByLabelText(`${E}phaseLabelPl`), {
      target: { value: "  Early bird  " },
    });
    fireEvent.change(screen.getByLabelText(`${E}phasePrice`), { target: { value: "9900" } });
    fireEvent.change(screen.getByLabelText(`${E}phaseTo`), {
      target: { value: "2026-09-01T23:59" },
    });
    fireEvent.click(przyciskZapisu());

    expect(ladunek().priceSchedule).toEqual([
      {
        labelPl: "Early bird",
        labelEn: "",
        from: null,
        to: new Date("2026-09-01T23:59").toISOString(),
        priceCents: 9900,
      },
    ]);
  });

  it("próg bez ceny zatrzymuje zapis komunikatem dla CAŁEJ listy", () => {
    // Baza odrzuca cennik w całości i bez numeru wiersza, więc komunikat też
    // dotyczy listy - ale musi się w ogóle pojawić, inaczej redaktor klika
    // „Zapisz" w kółko bez żadnej odpowiedzi.
    renderuj();
    wypelnijMinimum();
    fireEvent.click(screen.getByRole("button", { name: `${E}phaseAdd` }));
    fireEvent.click(przyciskZapisu());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "adminEventRegistration.errors.invalidPriceSchedule",
    );
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
    fireEvent.change(pole("priceCents"), { target: { value: "12900" } });

    przerysuj({ nextSortOrder: 40 });

    expect(pole("priceCents")).toHaveValue("12900");
  });
});
