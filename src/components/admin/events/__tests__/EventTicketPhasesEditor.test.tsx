// Molekuła „Cennik w czasie" - LISTA PROGÓW, w której KOLEJNOŚĆ jest ceną.
//
// DLACZEGO TO NIE JEST ZWYKŁA LISTA. Baza bierze PIERWSZY próg, którego okno
// obejmuje „teraz" (`_event_ticket_phase`). Przeniesienie wiersza o jedno
// miejsce zmienia więc kwotę pobieraną w kasie, a dwa progi z nachodzącymi się
// oknami to nie błąd, tylko rozstrzygnięcie kolejnością. Stąd widoczny numer
// wiersza i strzałki zamiast ukrytego pola sortowania - i stąd ten plik.
//
// CO TEN PLIK DOWODZI.
//   1. PUSTA LISTA MÓWI, CO OBOWIĄZUJE ZAMIAST NIEJ - „brak progów" bez zdania
//      o cenie podstawowej czyta się jak awaria edytora.
//   2. NOWY PRÓG JEST PUSTY, A PUSTE OKNO ZNACZY „BEZ GRANICY", NIE „DZIŚ".
//      Podstawienie bieżącej chwili zamieniłoby próg zaplanowany na przyszłość
//      w próg obowiązujący natychmiast - czyli w cichą przecenę.
//   3. ZMIANA W JEDNYM WIERSZU NIE RUSZA POZOSTAŁYCH (łatka po indeksie).
//   4. PRZENIESIENIE ZMIENIA KOLEJNOŚĆ CAŁEJ LISTY, a strzałki na krańcach są
//      wyłączone - lista nie ma jak wypaść poza swój zakres.
//   5. USUNIĘCIE ZDEJMUJE WSKAZANY WIERSZ, nie sąsiada.
//   6. LIMIT DWUNASTU PROGÓW ODCINA DODAWANIE, zamiast pozwolić zbudować
//      cennik, który baza i tak odrzuci w całości.
//   7. EDYTOR NIE OCENIA WARTOŚCI. Okno zamknięte przed otwarciem, okna
//      nachodzące na siebie i kwota niejednoznaczna („8,999") zostają dokładnie
//      takie, jak je wpisano - werdykt należy do `ticketDraftIssue`, a edytor
//      pokazuje go jako JEDEN komunikat dla całej listy (baza też odrzuca ją
//      w całości).
//   8. KWOTA JEST W ZŁOTYCH (TIX-14a), a obok pola stoi jej podgląd w walucie
//      biletu - liczony tym samym parserem, którym szkic liczy grosze. Zapis
//      nie do przeczytania podglądu nie ma.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Walidacji progów - tabela przypadków jest
// w `lib/events/__tests__/ticketDraft.test.ts`, a wpięcie komunikatu do
// formularza w `EventTicketDialog.test.tsx`. (2) Konwersji `price_schedule`
// (jsonb) na wiersze - to `phasesFromJson`.
//
// DETERMINIZM: żadnego `Date.now()` - wszystkie terminy są wpisywane wprost.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { EventTicketPhasesEditor } from "@/components/admin/events/molecules/EventTicketPhasesEditor";
import {
  TICKET_MAX_PHASES,
  emptyTicketPhase,
  type TicketPhaseDraft,
} from "@/lib/events/ticketDraft";

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

const onChange = vi.fn<(phases: TicketPhaseDraft[]) => void>();

/**
 * Podpięcie pod stan, bo edytor jest KONTROLOWANY.
 *
 * Bez trzymania listy w stanie „przenieś wyżej" nie dałoby się odróżnić
 * poprawnego wyniku od braku wyniku: pola nadal pokazywałyby wartości sprzed
 * kliknięcia, bo pochodzą z właściwości. Atrapa rodzica robi dokładnie to, co
 * robi `EventTicketDialog` - zapisuje nową listę i rysuje ją ponownie.
 */
function Harness({
  initial,
  error,
  currency,
}: {
  initial: TicketPhaseDraft[];
  error: string | null;
  currency?: string;
}) {
  const [phases, setPhases] = useState(initial);
  return (
    <EventTicketPhasesEditor
      phases={phases}
      error={error}
      timeZone="Europe/Warsaw"
      currency={currency}
      onChange={(next) => {
        onChange(next);
        setPhases(next);
      }}
    />
  );
}

function renderuj(
  initial: TicketPhaseDraft[] = [],
  error: string | null = null,
  currency?: string,
) {
  return render(<Harness initial={initial} error={error} currency={currency} />);
}

/** Podgląd kwoty obok pola ceny w wierszu o podanym numerze. */
const podgladWierszu = (index: number) =>
  wiersze()[index].querySelector("[data-money-preview]")?.textContent ?? null;

const E = "adminEventRegistration.tickets.editor.";

function prog(overrides: Partial<TicketPhaseDraft> = {}): TicketPhaseDraft {
  return { ...emptyTicketPhase(), ...overrides };
}

const wiersze = () => screen.queryAllByRole("listitem");
const przyciskDodania = () => screen.getByRole("button", { name: `${E}phaseAdd` });
/** Pole o podanej etykiecie w wierszu o podanym numerze (licząc od zera). */
const poleWierszu = (index: number, nazwa: string) =>
  within(wiersze()[index]).getByLabelText(`${E}${nazwa}`);
const akcjaWierszu = (index: number, nazwa: string) =>
  within(wiersze()[index]).getByRole("button", { name: `${E}${nazwa}` });

/** Ostatnia lista przekazana rodzicowi. */
function ostatniaLista(): TicketPhaseDraft[] {
  const call = onChange.mock.calls.at(-1);
  if (call === undefined) throw new Error("edytor nie oddał żadnej listy");
  return call[0];
}

beforeEach(() => {
  onChange.mockClear();
});

describe("EventTicketPhasesEditor - pusta lista i dodawanie", () => {
  it("brak progów mówi, że obowiązuje cena podstawowa, i nie rysuje wierszy", () => {
    renderuj([]);
    expect(screen.getByText(`${E}phasesEmpty`)).toBeInTheDocument();
    expect(screen.getByText(`${E}phasesHint`)).toBeInTheDocument();
    expect(wiersze()).toHaveLength(0);
  });

  it("nowy próg jest PUSTY - żadne pole nie dostaje wartości domyślnej", () => {
    // Podstawienie bieżącej chwili w polu „obowiązuje od" zamieniłoby próg
    // zaplanowany na przyszłość w próg działający natychmiast. Puste okno
    // znaczy „od zawsze / bezterminowo" i tylko takie ma tu prawo powstać.
    renderuj([]);
    fireEvent.click(przyciskDodania());

    expect(ostatniaLista()).toEqual([{ labelPl: "", labelEn: "", from: "", to: "", price: "" }]);
    expect(screen.queryByText(`${E}phasesEmpty`)).not.toBeInTheDocument();
    expect(wiersze()).toHaveLength(1);
    expect(poleWierszu(0, "phaseFrom")).toHaveValue("");
    expect(poleWierszu(0, "phaseTo")).toHaveValue("");
    expect(poleWierszu(0, "phasePrice")).toHaveValue("");
  });

  it("wiersze są NUMEROWANE od jedynki - numer to kolejność rozstrzygania", () => {
    renderuj([prog({ labelPl: "Early bird" }), prog({ labelPl: "Regularna" })]);
    expect(screen.getByText(`${E}phaseNumber(index=1)`)).toBeInTheDocument();
    expect(screen.getByText(`${E}phaseNumber(index=2)`)).toBeInTheDocument();
  });

  it("dwunasty próg wyłącza dodawanie - trzynastego cennik już nie przyjmie", () => {
    const pelnaLista = Array.from({ length: TICKET_MAX_PHASES - 1 }, () => prog());
    renderuj(pelnaLista);
    expect(przyciskDodania()).toBeEnabled();

    fireEvent.click(przyciskDodania());

    expect(wiersze()).toHaveLength(TICKET_MAX_PHASES);
    expect(przyciskDodania()).toBeDisabled();
    // Wyłączony przycisk nie ma jak dołożyć trzynastego wiersza.
    fireEvent.click(przyciskDodania());
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe("EventTicketPhasesEditor - edycja pojedynczego wiersza", () => {
  it("zmiana w drugim wierszu NIE rusza pierwszego", () => {
    // Łatka idzie po indeksie; pomyłka w tym miejscu przepisywałaby cenę
    // wszystkich progów naraz, a na ekranie wyglądałaby jak jedna zmiana.
    renderuj([prog({ labelPl: "Early bird", price: "99,00" }), prog({ labelPl: "Regularna" })]);
    fireEvent.change(poleWierszu(1, "phasePrice"), { target: { value: "150,00" } });

    expect(ostatniaLista()).toEqual([
      { labelPl: "Early bird", labelEn: "", from: "", to: "", price: "99,00" },
      { labelPl: "Regularna", labelEn: "", from: "", to: "", price: "150,00" },
    ]);
    expect(poleWierszu(0, "phasePrice")).toHaveValue("99,00");
  });

  it("każde pole wiersza trafia do SWOJEJ kolumny - także obie nazwy", () => {
    renderuj([prog()]);
    fireEvent.change(poleWierszu(0, "phaseLabelPl"), { target: { value: "Ostatnia szansa" } });
    fireEvent.change(poleWierszu(0, "phaseLabelEn"), { target: { value: "Last minute" } });
    fireEvent.change(poleWierszu(0, "phaseFrom"), { target: { value: "2026-09-01T00:00" } });
    fireEvent.change(poleWierszu(0, "phaseTo"), { target: { value: "2026-09-10T23:59" } });
    fireEvent.change(poleWierszu(0, "phasePrice"), { target: { value: "199,00" } });

    expect(ostatniaLista()[0]).toEqual({
      labelPl: "Ostatnia szansa",
      labelEn: "Last minute",
      from: "2026-09-01T00:00",
      to: "2026-09-10T23:59",
      price: "199,00",
    });
  });

  it("kwota jest pokazywana w ZŁOTYCH, znak w znak, z klawiaturą dziesiętną", () => {
    // Szkic trzyma „19,99" (z 1999 groszy) - edytor pokazuje to samo, bez
    // „pomocy", która przestawiłaby kwotę o dwa rzędy wielkości.
    renderuj([prog({ price: "19,99" })]);
    expect(poleWierszu(0, "phasePrice")).toHaveValue("19,99");
    expect(poleWierszu(0, "phasePrice")).toHaveAttribute("inputmode", "decimal");
    expect(screen.getByText(`${E}phasePrice`)).toBeInTheDocument();
  });

  it("podgląd obok pola pokazuje kwotę w walucie biletu i idzie za wpisem", () => {
    renderuj([prog({ price: "899" })]);
    expect(podgladWierszu(0)).toMatch(/^899,00\s?zł$/);

    fireEvent.change(poleWierszu(0, "phasePrice"), { target: { value: "1 299,5" } });
    expect(podgladWierszu(0)).toMatch(/^1\s?299,50\s?zł$/);
  });

  it("podgląd mówi w walucie biletu podanej przez okno", () => {
    renderuj([prog({ price: "49,90" })], null, "EUR");
    expect(podgladWierszu(0)).toMatch(/^49,90\s?€$/);
  });

  it("zapis nie do przeczytania nie ma podglądu - miejsce zostaje", () => {
    renderuj([prog({ price: "8,999" })]);
    expect(podgladWierszu(0)).toBe("");
    fireEvent.change(poleWierszu(0, "phasePrice"), { target: { value: "" } });
    expect(podgladWierszu(0)).toBe("");
  });
});

describe("EventTicketPhasesEditor - kolejność rozstrzyga o cenie", () => {
  it("przeniesienie WYŻEJ zamienia progi miejscami w całej liście", () => {
    renderuj([
      prog({ labelPl: "Early bird", price: "99,00" }),
      prog({ labelPl: "Regularna", price: "150,00" }),
      prog({ labelPl: "Last minute", price: "199,00" }),
    ]);

    fireEvent.click(akcjaWierszu(2, "phaseMoveUp"));

    expect(ostatniaLista().map((phase) => phase.labelPl)).toEqual([
      "Early bird",
      "Last minute",
      "Regularna",
    ]);
    expect(poleWierszu(1, "phasePrice")).toHaveValue("199,00");
    expect(poleWierszu(2, "phasePrice")).toHaveValue("150,00");
  });

  it("przeniesienie NIŻEJ jest odwrotnością przeniesienia wyżej", () => {
    renderuj([prog({ labelPl: "Early bird" }), prog({ labelPl: "Regularna" })]);

    fireEvent.click(akcjaWierszu(0, "phaseMoveDown"));
    expect(ostatniaLista().map((phase) => phase.labelPl)).toEqual(["Regularna", "Early bird"]);

    fireEvent.click(akcjaWierszu(1, "phaseMoveUp"));
    expect(ostatniaLista().map((phase) => phase.labelPl)).toEqual(["Early bird", "Regularna"]);
  });

  it("strzałki na krańcach listy są wyłączone", () => {
    // Lista nie ma jak wypaść poza swój zakres - a wyłączony przycisk mówi to
    // wzrokiem, zamiast przyjmować kliknięcie bez skutku.
    renderuj([prog(), prog(), prog()]);
    expect(akcjaWierszu(0, "phaseMoveUp")).toBeDisabled();
    expect(akcjaWierszu(0, "phaseMoveDown")).toBeEnabled();
    expect(akcjaWierszu(2, "phaseMoveUp")).toBeEnabled();
    expect(akcjaWierszu(2, "phaseMoveDown")).toBeDisabled();

    fireEvent.click(akcjaWierszu(0, "phaseMoveUp"));
    fireEvent.click(akcjaWierszu(2, "phaseMoveDown"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("jedyny próg ma obie strzałki wyłączone", () => {
    renderuj([prog()]);
    expect(akcjaWierszu(0, "phaseMoveUp")).toBeDisabled();
    expect(akcjaWierszu(0, "phaseMoveDown")).toBeDisabled();
  });

  it("usunięcie zdejmuje WSKAZANY wiersz, a nie sąsiada", () => {
    renderuj([
      prog({ labelPl: "Early bird" }),
      prog({ labelPl: "Regularna" }),
      prog({ labelPl: "Last minute" }),
    ]);

    fireEvent.click(akcjaWierszu(1, "phaseRemove"));

    expect(ostatniaLista().map((phase) => phase.labelPl)).toEqual(["Early bird", "Last minute"]);
    expect(wiersze()).toHaveLength(2);
  });

  it("usunięcie OSTATNIEGO progu wraca do zdania o cenie podstawowej", () => {
    renderuj([prog({ labelPl: "Early bird" })]);
    fireEvent.click(akcjaWierszu(0, "phaseRemove"));

    expect(ostatniaLista()).toEqual([]);
    expect(screen.getByText(`${E}phasesEmpty`)).toBeInTheDocument();
  });
});

describe("EventTicketPhasesEditor - okna czasowe i werdykt", () => {
  it("okno ZAMKNIĘTE PRZED OTWARCIEM zostaje takie, jak je wpisano", () => {
    // Edytor nie prostuje dat po cichu: zamiana „od" z „do" dałaby próg,
    // którego nikt nie ustawiał, i to w polu, na które redaktor już nie
    // patrzy. Odmowę wystawia `ticketDraftIssue` przy zapisie - i to ona
    // wraca tu jako `error`.
    renderuj([prog({ from: "2026-09-10T10:00", to: "2026-09-01T10:00", price: "99,00" })]);

    expect(poleWierszu(0, "phaseFrom")).toHaveValue("2026-09-10T10:00");
    expect(poleWierszu(0, "phaseTo")).toHaveValue("2026-09-01T10:00");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("próg BEZ daty końca zostaje bezterminowy - pole nie dostaje żadnej daty", () => {
    renderuj([prog({ from: "2026-09-01T00:00", price: "99,00" })]);
    fireEvent.change(poleWierszu(0, "phasePrice"), { target: { value: "109,00" } });

    expect(poleWierszu(0, "phaseTo")).toHaveValue("");
    expect(ostatniaLista()[0].to).toBe("");
    expect(ostatniaLista()[0].from).toBe("2026-09-01T00:00");
  });

  it("progi z NACHODZĄCYMI oknami zostają oba - rozstrzyga kolejność, nie edytor", () => {
    // To nie jest przeoczenie: nachodzące okna są dozwolonym sposobem
    // zapisania „w tym tygodniu inna cena". Baza bierze PIERWSZY pasujący
    // próg, więc edytor nie ma prawa żadnego z nich skasować ani przestawić -
    // ma za to dać strzałki, żeby wybór był świadomy.
    const nachodzace = [
      prog({
        labelPl: "Tydzień promocji",
        from: "2026-09-01T00:00",
        to: "2026-09-30T23:59",
        price: "99,00",
      }),
      prog({
        labelPl: "Wrzesień",
        from: "2026-09-01T00:00",
        to: "2026-09-30T23:59",
        price: "150,00",
      }),
    ];
    renderuj(nachodzace);

    expect(wiersze()).toHaveLength(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    fireEvent.click(akcjaWierszu(1, "phaseMoveUp"));
    expect(ostatniaLista().map((phase) => phase.price)).toEqual(["150,00", "99,00"]);
  });

  it("kwota niejednoznaczna NIE jest tu prostowana ani odrzucana", () => {
    // Edytor jest powierzchnią tekstową - „cichego" zaokrąglenia „8,999" do
    // 9,00 nikt by nie zauważył. Zapis zatrzymuje `ticketDraftIssue`, co
    // dowodzi `EventTicketDialog.test.tsx`.
    renderuj([prog()]);
    fireEvent.change(poleWierszu(0, "phasePrice"), { target: { value: "8,999" } });
    expect(ostatniaLista()[0].price).toBe("8,999");
    expect(poleWierszu(0, "phasePrice")).toHaveValue("8,999");
  });

  it("komunikat dotyczy CAŁEJ listy i jest ogłaszany jako alarm", () => {
    renderuj([prog()], "adminEventRegistration.errors.invalidPriceSchedule");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "adminEventRegistration.errors.invalidPriceSchedule",
    );
  });

  it("bez komunikatu nie ma alarmu - pusty akapit czytnik ekranu ogłasza tak samo", () => {
    renderuj([prog()], null);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
