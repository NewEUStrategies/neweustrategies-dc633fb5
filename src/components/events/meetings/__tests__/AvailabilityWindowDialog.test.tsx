// Molekuła „OKNO DOSTĘPNOŚCI" - formularz jednego przedziału, w którym uczestnik
// deklaruje, że przyjmuje zaproszenia.
//
// CO TEN PLIK DOWODZI I DLACZEGO TO WAŻNE:
//
//  1. GODZINA JEST POKAZANA DWA RAZY, I TO JEST CAŁY SENS TEGO OKNA.
//     Pole `datetime-local` mówi czasem PRZEGLĄDARKI, podpis pod nim - czasem
//     WYDARZENIA. Uczestnik z innej strefy deklaruje „9:30" i bez tej drugiej
//     linii dowiaduje się dopiero na miejscu, że na kongresie było wtedy 11:30.
//     To jest jedyne miejsce w całym module, w którym różnica stref jest
//     widoczna PRZED zapisem.
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
// pełnego pointer API, którego wymaga portal Radixa.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";

import { axeViolations, summarize } from "@/test/axe";
import { localInputToIso, type WindowDraft } from "@/lib/events/meetingWindowDraft";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

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

/**
 * Szkic okna. Napisy są w formacie `datetime-local`, czyli w czasie LOKALNYM
 * przeglądarki - maszyna testowa stoi w UTC, więc każda godzina w tym pliku
 * jest jednocześnie godziną UTC i to jest jedyny powód, dla którego różnica
 * względem strefy wydarzenia daje się wypisać wprost.
 */
function szkic(over: Partial<WindowDraft> = {}): WindowDraft {
  return {
    id: "w-1",
    startsAtLocal: "2026-09-14T09:30",
    endsAtLocal: "2026-09-14T13:00",
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
    otwarte: screen.getByRole("switch"),
    zapisz: screen.getByText("eventMeetings.participant.form.save"),
    odrzuc: screen.getByText("eventMeetings.participant.form.dismiss"),
  };
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

describe("AvailabilityWindowDialog - godzina wydarzenia obok godziny przeglądarki", () => {
  it("KOLIZJA: okno POZA godzinami wydarzenia jest widoczne w podpisie, a nie dopiero przy zaproszeniu", () => {
    // Uczestnik z Londynu deklaruje „22:00-23:30" u siebie. W Warszawie jest
    // wtedy północ - czyli daleko poza dniem giełdy. Baza takie okno PRZYJMIE
    // (`event_meeting_availability_set` waliduje tylko kolejność i długość),
    // a odmowa `slot_not_in_grid` przyjdzie dopiero komuś, kto spróbuje się
    // na ten termin umówić. Podpis pod polem jest jedynym ostrzeżeniem, jakie
    // uczestnik dostaje na czas.
    renderDialog({
      draft: szkic({ startsAtLocal: "2026-09-14T22:00", endsAtLocal: "2026-09-14T23:30" }),
    });

    // 22:00 UTC = 00:00 następnego dnia w Warszawie (czas letni, UTC+2).
    const podpisy = screen.getAllByText(/2026|września/);
    const teksty = podpisy.map((node) => node.textContent ?? "");
    expect(teksty.some((tekst) => tekst.includes("00:00"))).toBe(true);
    expect(teksty.some((tekst) => tekst.includes("01:30"))).toBe(true);
    // Sama godzina z pola nigdzie w podpisie nie występuje - inaczej podpis
    // nie niósłby żadnej nowej informacji.
    expect(teksty.some((tekst) => tekst.includes("22:00"))).toBe(false);
  });

  it("podpis liczy godzinę w strefie WYDARZENIA, a nie w strefie przeglądarki", () => {
    renderDialog({ draft: szkic({ startsAtLocal: "2026-09-14T09:30" }) });
    const teksty = screen.getAllByText(/2026|września/).map((node) => node.textContent ?? "");
    // 09:30 UTC -> 11:30 w Warszawie.
    expect(teksty.some((tekst) => tekst.includes("11:30"))).toBe(true);
  });

  it("PUSTE pole nie dostaje podpisu - „Invalid Date” pod polem to gorzej niż nic", () => {
    renderDialog({ draft: null });
    expect(screen.queryByText(/Invalid/)).toBeNull();
    expect(screen.queryAllByText(/2026/).length).toBe(0);
  });

  it("NIEPEŁNA data (sama data bez godziny) też nie dostaje podpisu", () => {
    renderDialog();
    fireEvent.change(pola().od, { target: { value: "2026-09-14" } });
    expect(screen.queryAllByText(/2026 /).length).toBe(0);
  });

  it("BRAK strefy wydarzenia degraduje do strefy domyślnej, a nie do pustego podpisu", () => {
    renderDialog({ timezone: null, draft: szkic({ startsAtLocal: "2026-09-14T09:30" }) });
    const teksty = screen.getAllByText(/2026|września/).map((node) => node.textContent ?? "");
    // `eventTimeZone(null)` -> `Europe/Warsaw`, więc podpis nadal jest i nadal
    // pokazuje 11:30, a nie godzinę maszyny.
    expect(teksty.some((tekst) => tekst.includes("11:30"))).toBe(true);
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
    ["koniec PRZED początkiem", "2026-09-14T13:00", "2026-09-14T09:30"],
    ["koniec RÓWNY początkowi", "2026-09-14T09:30", "2026-09-14T09:30"],
    ["okno KRÓTSZE niż 15 minut", "2026-09-14T09:30", "2026-09-14T09:40"],
    ["okno DŁUŻSZE niż 16 godzin", "2026-09-14T06:00", "2026-09-14T23:00"],
  ])("%s zatrzymuje zapis i mówi o tym", (_opis, od, do_) => {
    renderDialog({ draft: szkic({ startsAtLocal: od, endsAtLocal: do_ }) });
    expect((pola().zapisz as HTMLButtonElement).disabled).toBe(true);
    // Dwa wystąpienia: podpowiedź w nagłówku i czerwone zdanie pod stopką.
    expect(screen.getAllByText(`${BAZA}.durationHint`).length).toBe(2);
    expect(h.submit).not.toHaveBeenCalled();
  });

  it.fails("DEFEKT: KAŻDY powód odrzucenia szkicu dostaje komunikat o DŁUGOŚCI okna", () => {
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
    expect(screen.getAllByText(`${BAZA}.durationHint`).length).toBe(2);
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
      startsAt: localInputToIso("2026-09-14T09:30"),
      endsAt: localInputToIso("2026-09-14T13:00"),
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

  it("każde pole ma etykietę - inaczej czytnik ogłasza cztery bezimienne kontrolki", () => {
    renderDialog({ draft: szkic() });
    const { od, do_, notatka, otwarte } = pola();
    for (const kontrolka of [od, do_, notatka, otwarte]) {
      expect(kontrolka.getAttribute("id")).toBeTruthy();
    }
  });
});
