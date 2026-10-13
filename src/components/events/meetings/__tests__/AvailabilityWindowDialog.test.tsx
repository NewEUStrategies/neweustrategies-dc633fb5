// Molekuła „OKNO DOSTĘPNOŚCI" - formularz jednego przedziału, w którym uczestnik
// deklaruje, że przyjmuje zaproszenia.
//
// CO TEN PLIK DOWODZI I DLACZEGO TO WAŻNE:
//
//  1. GODZINY SĄ W STREFIE WYDARZENIA, A EKRAN MÓWI, W JAKIEJ (OPS-15).
//     W niej baza liczy siatkę slotów i w niej wydrukowany jest program.
//     Uczestnik z Londynu wpisuje „9:30" z programu kongresu w Warszawie
//     i zapisuje się 9:30 w Warszawie - a nie 10:30, jak przy dawnej
//     konwersji w strefie przeglądarki. Gdy jego strefa jest inna, obok stoi
//     jawny przełącznik „wpisuję w mojej strefie (Europe/London)", a pod
//     polem - ta sama chwila w DRUGIEJ strefie. Przełącznik przepisuje pola,
//     więc samo przełączenie nigdy nie przesuwa okna. Cały plik biegnie przy
//     `TZ=Europe/London` - na maszynie w strefie wydarzenia tej różnicy nie
//     widać.
//
//  2. KOLIZJA „OKNO POZA GODZINAMI WYDARZENIA" NIE JEST BŁĘDEM FORMULARZA.
//     Baza przyjmuje takie okno bez mrugnięcia (`event_meeting_availability_set`
//     sprawdza wyłącznie kolejność i długość) - koszt przychodzi później, gdy
//     zaproszenie na ten termin odbija się o `slot_not_in_grid` albo
//     `requester_unavailable`. Dialog nie ma prawa zgadywać godzin wydarzenia,
//     więc jego jedyną obroną jest PODPIS w strefie wydarzenia. Dlatego ten
//     podpis ma tu własny, jawny test, a nie jest ozdobą.
//
//  3. SZKIC NADPISUJE STAN PRZY KAŻDYM OTWARCIU. Bez tego drugie kliknięcie
//     „edytuj" pokazuje poprzedni wiersz - czyli uczestnik nadpisuje CUDZE
//     okno, patrząc na formularz, który wygląda poprawnie.
//
//  4. PRZYCISK ZAPISU JEST BRAMKĄ, NIE OZDOBĄ. Granice 15 minut - 16 godzin
//     odwzorowują `CHECK` z migracji; przepuszczony szkic kończy się odmową
//     `invalid_window` PO kliknięciu, a wtedy uczestnik nie wie, które pole
//     poprawić.
//
//  5. TRWAJĄCY ZAPIS ODCINA PRZYCISK. Drugie kliknięcie „Zapisz" to drugie
//     `event_meeting_availability_set` - a dwa okna o tych samych godzinach
//     odbijają się o `availability_overlap` i uczestnik widzi odmowę
//     za własne, podwójne kliknięcie.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Konwersji `datetime-local` <-> ISO i tabeli
// walidacji - mają własny plik `src/lib/events/__tests__/meetingWindowDraft.test.ts`.
// Tutaj dowodzimy, że formularz TYCH reguł używa i co robi z ich wynikiem.
//
// Radixowy Dialog jest podmieniony na natywny odpowiednik: happy-dom nie ma
// pełnego pointer API, którego wymaga portal Radixa. Atom `DateInput` (kalendarz
// w popoverze) jest podmieniony na natywne pole, jak w `MeetingSettingsPanel.test`
// - przedmiotem dowodu jest dialog i jego napisy `datetime-local`, a nie
// kalendarz.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";

import { axeViolations, summarize } from "@/test/axe";
import type { WindowDraft } from "@/lib/events/meetingWindowDraft";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

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

vi.mock("@/components/ui/switch", async () =>
  (await import("@/test/reactStubs")).radixSwitchStub(await import("react")),
);

vi.mock("@/components/ui/dialog", () => {
  const stan = { open: false, zamknij: (_next: boolean) => {} };
  return {
    Dialog: ({
      open,
      onOpenChange,
      children,
    }: {
      open: boolean;
      onOpenChange?: (next: boolean) => void;
      children?: ReactNode;
    }) => {
      stan.open = open;
      stan.zamknij = onOpenChange ?? (() => {});
      return <div>{children}</div>;
    },
    DialogContent: ({ children }: { children?: ReactNode }) =>
      stan.open ? (
        <div role="dialog" aria-label="atrapa-okno">
          {children}
        </div>
      ) : null,
    DialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    DialogFooter: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    DialogTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
    DialogDescription: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
  };
});

const { AvailabilityWindowDialog } =
  await import("@/components/events/meetings/AvailabilityWindowDialog");

const BAZA = "eventMeetings.participant.availability";
const TZ = "Europe/Warsaw";
const LONDYN = "Europe/London";
const ORIGINAL_TZ = process.env.TZ;

/**
 * Szkic okna. Napisy są w formacie `datetime-local` w strefie WYDARZENIA
 * (`inputZone: "event"`) - 09:30 to 09:30 w Warszawie, czyli 07:30 UTC
 * i 08:30 w Londynie, gdzie stoi „przeglądarka".
 */
function szkic(over: Partial<WindowDraft> = {}): WindowDraft {
  return {
    id: "w-1",
    startsAtLocal: "2026-09-14T09:30",
    endsAtLocal: "2026-09-14T13:00",
    inputZone: "event",
    startsAtSaved: null,
    endsAtSaved: null,
    isOpen: true,
    note: "",
    ...over,
  };
}

function pola() {
  return {
    od: screen.getByLabelText(`${BAZA}.from`),
    do_: screen.getByLabelText(`${BAZA}.to`),
    notatka: screen.getByLabelText("eventMeetings.fields.note"),
    otwarte: screen.getByLabelText(`${BAZA}.openField`),
    zapisz: screen.getByText("eventMeetings.participant.form.save"),
    odrzuc: screen.getByText("eventMeetings.participant.form.dismiss"),
  };
}

/** Przełącznik „wpisuję w mojej strefie" - jest tylko przy różnych strefach. */
function mojaStrefa(zone = LONDYN): HTMLInputElement | null {
  return screen.queryByLabelText(`${BAZA}.zone.useMine(zone=${zone})`) as HTMLInputElement | null;
}

/** Podpisy „ta sama chwila w drugiej strefie" pod polami. */
function podpisyStref(): string[] {
  return screen
    .queryAllByText((tekst) => tekst.startsWith(`${BAZA}.zone.in`))
    .map((node) => node.textContent ?? "");
}

const h = vi.hoisted(() => ({ submit: vi.fn(), openChange: vi.fn() }));

function renderDialog(over: Partial<Parameters<typeof AvailabilityWindowDialog>[0]> = {}) {
  const props = {
    open: true,
    draft: null,
    timezone: TZ,
    isSaving: false,
    onSubmit: h.submit,
    onOpenChange: h.openChange,
    ...over,
  };
  const view = render(<AvailabilityWindowDialog {...props} />);
  return {
    ...view,
    przerysuj: (next: Partial<Parameters<typeof AvailabilityWindowDialog>[0]>) =>
      view.rerender(<AvailabilityWindowDialog {...props} {...next} />),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Uczestnik z Londynu, kongres w Warszawie (OPS-15).
  process.env.TZ = LONDYN;
});

afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

describe("AvailabilityWindowDialog - nowe okno vs edycja istniejącego", () => {
  it("bez szkicu formularz jest PUSTY i zapowiada nowe okno", () => {
    renderDialog();
    expect(screen.getByText(`${BAZA}.dialogNew`)).toBeTruthy();
    const { od, do_, notatka } = pola();
    expect((od as HTMLInputElement).value).toBe("");
    expect((do_ as HTMLInputElement).value).toBe("");
    expect((notatka as HTMLTextAreaElement).value).toBe("");
  });

  it("szkic istniejącego okna wchodzi w pola i zmienia tytuł na „edytuj”", () => {
    renderDialog({ draft: szkic({ note: "Tylko po polsku", isOpen: false }) });
    expect(screen.getByText(`${BAZA}.dialogEdit`)).toBeTruthy();
    const { od, do_, notatka, otwarte } = pola();
    expect((od as HTMLInputElement).value).toBe("2026-09-14T09:30");
    expect((do_ as HTMLInputElement).value).toBe("2026-09-14T13:00");
    expect((notatka as HTMLTextAreaElement).value).toBe("Tylko po polsku");
    expect((otwarte as HTMLInputElement).checked).toBe(false);
  });

  it("DRUGIE otwarcie pokazuje NOWY wiersz, a nie poprzedni", () => {
    // To jest regresja, którą efekt w komponencie ma zamykać: bez nadpisania
    // stanu przy otwarciu uczestnik edytuje okno A, patrząc na dane okna B -
    // i zapisuje je pod cudzym identyfikatorem.
    const { przerysuj } = renderDialog({ draft: szkic({ id: "w-1", note: "Pierwsze" }) });
    expect((pola().notatka as HTMLTextAreaElement).value).toBe("Pierwsze");

    przerysuj({ open: false });
    przerysuj({
      open: true,
      draft: szkic({ id: "w-2", note: "Drugie", startsAtLocal: "2026-09-15T10:00" }),
    });

    expect((pola().notatka as HTMLTextAreaElement).value).toBe("Drugie");
    expect((pola().od as HTMLInputElement).value).toBe("2026-09-15T10:00");
  });

  it("otwarcie BEZ szkicu po edycji czyści formularz, zamiast zostawić poprzedni wiersz", () => {
    const { przerysuj } = renderDialog({ draft: szkic({ note: "Poprzednie okno" }) });
    przerysuj({ open: false });
    przerysuj({ open: true, draft: null });

    expect(screen.getByText(`${BAZA}.dialogNew`)).toBeTruthy();
    expect((pola().notatka as HTMLTextAreaElement).value).toBe("");
  });

  it("zamknięte okno nie renderuje formularza wcale", () => {
    renderDialog({ open: false, draft: szkic() });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("AvailabilityWindowDialog - strefa pól (OPS-15)", () => {
  it("domyślnie godziny są w strefie WYDARZENIA i ekran mówi to wprost", () => {
    renderDialog({ draft: szkic() });
    expect(screen.getByText(`${BAZA}.zone.activeEvent(zone=${TZ})`)).toBeTruthy();
    expect(mojaStrefa()?.checked).toBe(false);
    expect((pola().od as HTMLInputElement).value).toBe("2026-09-14T09:30");
  });

  it("pod polem stoi ta sama chwila w strefie UCZESTNIKA - 09:30 w Warszawie to 08:30 w Londynie", () => {
    renderDialog({ draft: szkic() });
    const podpisy = podpisyStref();
    expect(podpisy).toHaveLength(2);
    expect(podpisy[0]).toMatch(/zone\.inMine\(value=.*08:30,zone=Europe\/London\)/);
    expect(podpisy[1]).toMatch(/zone\.inMine\(value=.*12:00,zone=Europe\/London\)/);
  });

  it("przełącznik „moja strefa” przepisuje pola na Londyn i NIE przesuwa okna", () => {
    renderDialog({ draft: szkic() });
    fireEvent.click(mojaStrefa() as HTMLInputElement);

    expect(mojaStrefa()?.checked).toBe(true);
    expect(screen.getByText(`${BAZA}.zone.activeMine(zone=${LONDYN})`)).toBeTruthy();
    expect((pola().od as HTMLInputElement).value).toBe("2026-09-14T08:30");
    expect((pola().do_ as HTMLInputElement).value).toBe("2026-09-14T12:00");
    // Podpis odwraca się: teraz pokazuje czas WYDARZENIA.
    expect(podpisyStref()[0]).toMatch(/zone\.inEvent\(value=.*09:30,zone=Europe\/Warsaw\)/);

    fireEvent.click(pola().zapisz);
    expect(h.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        startsAt: "2026-09-14T07:30:00.000Z",
        endsAt: "2026-09-14T11:00:00.000Z",
      }),
    );
  });

  it("w trybie „moja strefa” wpisane godziny czyta się jako londyńskie", () => {
    renderDialog();
    fireEvent.click(mojaStrefa() as HTMLInputElement);
    fireEvent.change(pola().od, { target: { value: "2026-09-14T09:00" } });
    fireEvent.change(pola().do_, { target: { value: "2026-09-14T12:00" } });
    fireEvent.click(pola().zapisz);

    expect(h.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        startsAt: "2026-09-14T08:00:00.000Z",
        endsAt: "2026-09-14T11:00:00.000Z",
      }),
    );
  });

  it("wybór strefy przeżywa ponowne otwarcie - kolejne okno otwiera się w strefie uczestnika", () => {
    const { przerysuj } = renderDialog({ draft: szkic() });
    fireEvent.click(mojaStrefa() as HTMLInputElement);
    przerysuj({ open: false });
    przerysuj({ open: true, draft: szkic({ id: "w-2", startsAtLocal: "2026-09-15T10:00" }) });

    expect(mojaStrefa()?.checked).toBe(true);
    // 10:00 w Warszawie (szkic z listy) -> 09:00 w Londynie.
    expect((pola().od as HTMLInputElement).value).toBe("2026-09-15T09:00");
  });

  it("KOLIZJA: okno POZA godzinami wydarzenia jest widoczne w podpisie, a nie dopiero przy zaproszeniu", () => {
    // Uczestnik z Londynu deklaruje „22:00-23:30" u siebie. W Warszawie jest
    // wtedy 23:00-00:30 - czyli poza dniem giełdy. Baza takie okno PRZYJMIE
    // (`event_meeting_availability_set` waliduje tylko kolejność i długość),
    // a odmowa `slot_not_in_grid` przyjdzie dopiero komuś, kto spróbuje się
    // na ten termin umówić. Podpis pod polem jest jedynym ostrzeżeniem, jakie
    // uczestnik dostaje na czas.
    renderDialog();
    fireEvent.click(mojaStrefa() as HTMLInputElement);
    fireEvent.change(pola().od, { target: { value: "2026-09-14T22:00" } });
    fireEvent.change(pola().do_, { target: { value: "2026-09-14T23:30" } });

    const teksty = podpisyStref();
    expect(teksty.some((tekst) => tekst.includes("23:00"))).toBe(true);
    expect(teksty.some((tekst) => /15 września 2026 00:30/.test(tekst))).toBe(true);
    // Sama godzina z pola nigdzie w podpisie nie występuje - inaczej podpis
    // nie niósłby żadnej nowej informacji.
    expect(teksty.some((tekst) => tekst.includes("22:00"))).toBe(false);
  });

  it("uczestnik w strefie wydarzenia nie dostaje przełącznika ani podwójnych godzin", () => {
    process.env.TZ = TZ;
    renderDialog({ draft: szkic() });
    expect(mojaStrefa(TZ)).toBeNull();
    expect(screen.queryByRole("switch", { name: /zone\.useMine/ })).toBeNull();
    expect(podpisyStref()).toEqual([]);
    // Zdanie o strefie zostaje - mówi, w czyjej strefie są godziny.
    expect(screen.getByText(`${BAZA}.zone.activeEvent(zone=${TZ})`)).toBeTruthy();
  });

  it("PUSTE pole nie dostaje podpisu - „Invalid Date” pod polem to gorzej niż nic", () => {
    renderDialog({ draft: null });
    expect(screen.queryByText(/Invalid/)).toBeNull();
    expect(podpisyStref()).toEqual([]);
  });

  it("NIEPEŁNA data (sama data bez godziny) też nie dostaje podpisu", () => {
    renderDialog();
    fireEvent.change(pola().od, { target: { value: "2026-09-14" } });
    expect(podpisyStref()).toEqual([]);
  });

  it("BRAK strefy wydarzenia degraduje do strefy domyślnej, a nie do strefy przeglądarki", () => {
    renderDialog({ timezone: null, draft: szkic({ startsAtLocal: "2026-09-14T09:30" }) });
    // `eventTimeZone(null)` -> `Europe/Warsaw`, więc pola nadal są warszawskie,
    // a podpis pokazuje 08:30 w Londynie - nie 09:30 maszyny.
    expect(screen.getByText(`${BAZA}.zone.activeEvent(zone=${TZ})`)).toBeTruthy();
    expect(podpisyStref()[0]).toMatch(/08:30,zone=Europe\/London/);
  });

  it("LUKA: 02:30 29 marca nie istnieje w Warszawie - pole mówi, że zapisze 03:30", () => {
    renderDialog({
      draft: szkic({ startsAtLocal: "2026-03-29T02:30", endsAtLocal: "2026-03-29T05:00" }),
    });
    expect(screen.getByText(`${BAZA}.zone.gap(value=03:30,zone=${TZ})`)).toBeTruthy();
    fireEvent.click(pola().zapisz);
    expect(h.submit).toHaveBeenCalledWith(
      expect.objectContaining({ startsAt: "2026-03-29T01:30:00.000Z" }),
    );
  });

  it("ZAKŁADKA: 02:30 25 października jest dwa razy - pole mówi, że bierze drugie (CET)", () => {
    renderDialog({
      draft: szkic({ startsAtLocal: "2026-10-25T02:30", endsAtLocal: "2026-10-25T05:00" }),
    });
    expect(screen.getByText(`${BAZA}.zone.overlap(value=02:30 CET,zone=${TZ})`)).toBeTruthy();
    fireEvent.click(pola().zapisz);
    expect(h.submit).toHaveBeenCalledWith(
      expect.objectContaining({ startsAt: "2026-10-25T01:30:00.000Z" }),
    );
  });

  it("NIETKNIĘTE pole edycji nie dostaje ostrzeżenia o zakładce i nie przesuwa okna", () => {
    // Okno z bazy zaczyna się PIERWSZYM 02:30 (CEST). Zmiana samej notatki
    // nie może go przenieść na drugie 02:30.
    renderDialog({
      draft: szkic({
        startsAtLocal: "2026-10-25T02:30",
        endsAtLocal: "2026-10-25T05:00",
        startsAtSaved: "2026-10-25T00:30:00.000Z",
        endsAtSaved: "2026-10-25T04:00:00.000Z",
      }),
    });
    expect(screen.queryByText(/zone\.overlap/)).toBeNull();
    fireEvent.change(pola().notatka, { target: { value: "Stoisko B12" } });
    fireEvent.click(pola().zapisz);
    expect(h.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        startsAt: "2026-10-25T00:30:00.000Z",
        endsAt: "2026-10-25T04:00:00.000Z",
      }),
    );
  });
});

describe("AvailabilityWindowDialog - bramka zapisu odwzorowuje CHECK-i bazy", () => {
  it("pusty formularz nie da się wysłać i NIE straszy komunikatem błędu", () => {
    // „incomplete" to stan początkowy, a nie pomyłka uczestnika - czerwone
    // zdanie nad pustym formularzem oskarża go, zanim cokolwiek zrobił.
    renderDialog();
    expect((pola().zapisz as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText(`${BAZA}.durationHint`)).toBeTruthy();
    // Podpowiedź w nagłówku jest, czerwonego zdania pod stopką nie ma.
    expect(screen.getAllByText(`${BAZA}.durationHint`).length).toBe(1);
  });

  it.each([
    ["koniec PRZED początkiem", "2026-09-14T13:00", "2026-09-14T09:30", "order"],
    ["koniec RÓWNY początkowi", "2026-09-14T09:30", "2026-09-14T09:30", "order"],
    ["okno KRÓTSZE niż 15 minut", "2026-09-14T09:30", "2026-09-14T09:40", "tooShort"],
    ["okno DŁUŻSZE niż 16 godzin", "2026-09-14T06:00", "2026-09-14T23:00", "tooLong"],
  ])("%s zatrzymuje zapis i mówi o tym", (_opis, od, do_, problem) => {
    renderDialog({ draft: szkic({ startsAtLocal: od, endsAtLocal: do_ }) });
    expect((pola().zapisz as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByText(`${BAZA}.durationHint`).length).toBe(1);
    expect(screen.getByRole("alert")).toHaveTextContent(`${BAZA}.validation.${problem}`);
    expect(h.submit).not.toHaveBeenCalled();
  });

  it("błąd kolejności godzin ma odrębny komunikat walidacji", () => {
    // `validateWindowDraft` rozróżnia CZTERY powody (`order`, `tooShort`,
    // `tooLong`, `noteTooLong`) i robi to celowo - każdy prowadzi do innej
    // poprawki. Ekran skleja je w jedno zdanie, i to akurat w to, które już
    // stoi w nagłówku jako podpowiedź. Uczestnik, który wpisał koniec PRZED
    // początkiem, czyta pod stopką „okno musi trwać od 15 minut do 16 godzin" -
    // czyli zdanie, które nie opisuje jego pomyłki, a do tego widzi je dwa razy.
    //
    // Skutek: jedyna droga do poprawnego szkicu prowadzi przez zgadywanie,
    // a przycisk zapisu milczy.
    renderDialog({
      draft: szkic({ startsAtLocal: "2026-09-14T13:00", endsAtLocal: "2026-09-14T09:30" }),
    });
    expect((pola().zapisz as HTMLButtonElement).disabled).toBe(true);
    // Komunikat o kolejności powinien mieć własne zdanie - podpowiedź
    // o długości ma zostać JEDNYM wystąpieniem, w nagłówku.
    expect(screen.getAllByText(`${BAZA}.durationHint`).length).toBe(1);
  });

  it("notatka DŁUŻSZA niż 300 znaków zatrzymuje zapis", () => {
    renderDialog({ draft: szkic() });
    fireEvent.change(pola().notatka, { target: { value: "x".repeat(301) } });
    expect((pola().zapisz as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("alert")).toHaveTextContent(`${BAZA}.validation.noteTooLong`);
  });

  it.each([
    ["dokładnie 15 minut", "2026-09-14T09:30", "2026-09-14T09:45"],
    ["dokładnie 16 godzin", "2026-09-14T06:00", "2026-09-14T22:00"],
  ])("%s jest jeszcze PRZYJMOWANE - granica jest domknięta jak w bazie", (_opis, od, do_) => {
    renderDialog({ draft: szkic({ startsAtLocal: od, endsAtLocal: do_ }) });
    expect((pola().zapisz as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("AvailabilityWindowDialog - co dokładnie wychodzi z formularza", () => {
  it("ładunek niesie ISO, identyfikator wiersza i flagę otwarcia", () => {
    renderDialog({ draft: szkic({ id: "w-7", isOpen: true, note: "  Stoisko B12  " }) });
    fireEvent.click(pola().zapisz);

    expect(h.submit).toHaveBeenCalledTimes(1);
    expect(h.submit).toHaveBeenCalledWith({
      id: "w-7",
      // 09:30-13:00 w Warszawie (CEST), nie w Londynie, gdzie stoi przeglądarka.
      startsAt: "2026-09-14T07:30:00.000Z",
      endsAt: "2026-09-14T11:00:00.000Z",
      isOpen: true,
      // Notatka jedzie PRZYCIĘTA - białe znaki w bazie to notatka wyglądająca
      // na pustą i mimo to widoczna dla rozmówcy.
      note: "Stoisko B12",
    });
  });

  it("PUSTA notatka wychodzi jako `null`, a nie jako pusty napis", () => {
    // `''` przechodzi CHECK-a długości i zostaje w bazie jako widoczna,
    // pusta adnotacja pod oknem.
    renderDialog({ draft: szkic({ note: "   " }) });
    fireEvent.click(pola().zapisz);
    expect(h.submit).toHaveBeenCalledWith(expect.objectContaining({ note: null }));
  });

  it("nowe okno wychodzi z `id: null` - inaczej zapis nadpisałby cudzy wiersz", () => {
    renderDialog();
    fireEvent.change(pola().od, { target: { value: "2026-09-14T09:00" } });
    fireEvent.change(pola().do_, { target: { value: "2026-09-14T12:00" } });
    fireEvent.click(pola().zapisz);

    expect(h.submit).toHaveBeenCalledWith(expect.objectContaining({ id: null, isOpen: true }));
  });

  it("przełącznik „przyjmuję zaproszenia” dojeżdża do ładunku", () => {
    // Okno ZAMKNIĘTE to nie brak okna: „jestem, ale prowadzę wtedy panel"
    // rezerwuje czas i blokuje zaproszenia. Zgubiona flaga zamienia jedno
    // w drugie.
    renderDialog({ draft: szkic({ isOpen: true }) });
    fireEvent.click(pola().otwarte);
    fireEvent.click(pola().zapisz);
    expect(h.submit).toHaveBeenCalledWith(expect.objectContaining({ isOpen: false }));
  });

  it("TRWAJĄCY zapis odcina przycisk - drugie kliknięcie nie wysyła drugiego okna", () => {
    const { przerysuj } = renderDialog({ draft: szkic() });
    fireEvent.click(pola().zapisz);
    expect(h.submit).toHaveBeenCalledTimes(1);

    przerysuj({ isSaving: true });
    expect((pola().zapisz as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(pola().zapisz);
    expect(h.submit).toHaveBeenCalledTimes(1);
  });

  it("„Odrzuć” zamyka okno i NIE wysyła niczego", () => {
    renderDialog({ draft: szkic() });
    fireEvent.click(pola().odrzuc);
    expect(h.openChange).toHaveBeenCalledWith(false);
    expect(h.submit).not.toHaveBeenCalled();
  });
});

describe("AvailabilityWindowDialog - dostępność", () => {
  it("formularz nie ma naruszeń axe", async () => {
    const { container } = renderDialog({ draft: szkic({ note: "Stoisko B12" }) });
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("formularz z komunikatem błędu też nie ma naruszeń axe", async () => {
    const { container } = renderDialog({
      draft: szkic({ startsAtLocal: "2026-09-14T13:00", endsAtLocal: "2026-09-14T09:30" }),
    });
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("każde pole ma etykietę - inaczej czytnik ogłasza pięć bezimiennych kontrolek", () => {
    renderDialog({ draft: szkic() });
    const { od, do_, notatka, otwarte } = pola();
    for (const kontrolka of [od, do_, notatka, otwarte, mojaStrefa() as HTMLElement]) {
      expect(kontrolka.getAttribute("id")).toBeTruthy();
    }
  });

  it("pola godzin wskazują zdanie o strefie - czytnik ogłasza strefę przy każdym polu", () => {
    renderDialog({ draft: szkic() });
    const { od, do_ } = pola();
    for (const pole of [od, do_]) {
      const opis = pole.getAttribute("aria-describedby") ?? "";
      expect(opis.split(" ")).toContain("availability-zone-active");
      for (const id of opis.split(" ")) {
        expect(document.getElementById(id), id).not.toBeNull();
      }
    }
  });
});
