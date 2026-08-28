// Molekuła „potwierdź decyzję o zgłoszeniu" - JEDNO OKNO NA SZEŚĆ CZYNNOŚCI.
//
// CO TEN PLIK DOWODZI.
//   1. BRAK CZYNNOŚCI TO BRAK OKNA. `action === null` znaczy „organizator
//      niczego nie wybrał"; okno bez tytułu i bez treści, z czynnym przyciskiem
//      „Potwierdź", potwierdzałoby decyzję, której nikt nie podjął.
//   2. SZEŚĆ CZYNNOŚCI MA SZEŚĆ RÓŻNYCH ZDAŃ. Zatwierdzenie zabiera miejsce
//      z puli, anulowanie je oddaje, nieobecność je ZOSTAWIA zajęte - to trzy
//      różne skutki dla puli miejsc i organizator musi je przeczytać PRZED
//      kliknięciem, a nie wywnioskować z nazwy przycisku.
//   3. POWÓD BLOKUJE PRZYCISK TYLKO PRZY ODRZUCENIU I ANULOWANIU. Baza wraca
//      wtedy błędem `reason_required`, więc puste pole musi zatrzymać się tutaj;
//      przy pozostałych czterech to samo pole jest notatką wewnętrzną i wymóg
//      nauczyłby organizatora wpisywać kropkę.
//   4. SAME SPACJE TO NADAL BRAK POWODU. Bez obcięcia białych znaków „ "
//      przechodzi walidację i ląduje w historii zgłoszenia jako uzasadnienie.
//   5. PUSTA NOTATKA JEDZIE JAKO `null`, NIE JAKO PUSTY NAPIS - pusty napis
//      w historii wygląda jak notatka, którą ktoś napisał i skasował.
//   6. NOWA DECYZJA ZACZYNA OD PUSTEGO POLA - i po zamknięciu okna, i przy
//      zmianie czynności bez zamykania. Przeniesiony powód trafiłby do historii
//      innego zgłoszenia jako uzasadnienie, którego nikt nie napisał.
//   7. TRWAJĄCY ZAPIS ODCINA OBA PRZYCISKI - drugie kliknięcie to druga decyzja
//      w tej samej sprawie.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Zbioru czynności wymagających powodu
// (`actionRequiresReason`) i dozwolonych przejść stanu - tabele przypadków są
// w `lib/events/__tests__/registrationRows.test.ts`; tutaj dowodzimy, że okno
// tej reguły UŻYWA i co robi z wynikiem. (2) Samego wywołania RPC decyzji -
// molekuła dostaje `onConfirm` w propsie i nie zna warstwy zapisu.
//
// Radix Dialog nie działa pod happy-dom bez pełnego pointer API - jest
// podmieniony na natywny odpowiednik, w którym TREŚĆ istnieje wyłącznie przy
// otwartym oknie (tak jak portal Radixa).
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import type { RegistrationAction } from "@/lib/events/registrationsApi";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

vi.mock("@/components/ui/dialog", () => {
  const stan = { open: false };
  return {
    Dialog: ({ open, children }: { open: boolean; children?: ReactNode }) => {
      stan.open = open;
      return <div data-testid="dialog-root">{children}</div>;
    },
    DialogContent: ({ children }: { children?: ReactNode }) =>
      stan.open ? <div role="dialog">{children}</div> : null,
    DialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    DialogFooter: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    DialogTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
    DialogDescription: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
  };
});

const { RegistrationDecideDialog } =
  await import("@/components/admin/events/molecules/RegistrationDecideDialog");

const BAZA = "adminEventRegistration.registrations.decideDialog";

interface Props {
  open?: boolean;
  action?: RegistrationAction | null;
  personName?: string;
  isPending?: boolean;
}

function renderuj(props: Props = {}) {
  const onOpenChange = vi.fn();
  const onConfirm = vi.fn();
  const wlasciwosci = {
    open: props.open ?? true,
    action: props.action === undefined ? ("reject" as RegistrationAction) : props.action,
    personName: props.personName ?? "Anna Kowalska",
    isPending: props.isPending ?? false,
  };
  const wynik = render(
    <RegistrationDecideDialog {...wlasciwosci} onOpenChange={onOpenChange} onConfirm={onConfirm} />,
  );
  const przerysuj = (zmiana: Props) =>
    wynik.rerender(
      <RegistrationDecideDialog
        {...wlasciwosci}
        {...{
          open: zmiana.open ?? wlasciwosci.open,
          action: zmiana.action === undefined ? wlasciwosci.action : zmiana.action,
          personName: zmiana.personName ?? wlasciwosci.personName,
          isPending: zmiana.isPending ?? wlasciwosci.isPending,
        }}
        onOpenChange={onOpenChange}
        onConfirm={onConfirm}
      />,
    );
  return { ...wynik, onOpenChange, onConfirm, przerysuj };
}

const pole = () => screen.getByRole("textbox");
const potwierdz = () => screen.getByRole("button", { name: `${BAZA}.confirmAction` });
const anuluj = () => screen.getByRole("button", { name: `${BAZA}.cancelAction` });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("RegistrationDecideDialog - kiedy okna nie ma", () => {
  it("BEZ WYBRANEJ CZYNNOŚCI okno nie renderuje NICZEGO", () => {
    // Bez tego wczesnego wyjścia okno rysuje się z pustym tytułem i czynnym
    // przyciskiem „Potwierdź" - klik potwierdzałby decyzję, której nie ma.
    const { container } = renderuj({ action: null });
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("okno ZAMKNIĘTE nie pokazuje ani tytułu, ani pola powodu", () => {
    renderuj({ open: false });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText(`${BAZA}.rejectTitle`)).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});

describe("RegistrationDecideDialog - sześć czynności, sześć zdań", () => {
  const przypadki: {
    action: RegistrationAction;
    tytul: string;
    tresc: string;
    powodWymagany: boolean;
  }[] = [
    { action: "approve", tytul: "approveTitle", tresc: "approveBody", powodWymagany: false },
    { action: "reject", tytul: "rejectTitle", tresc: "rejectBody", powodWymagany: true },
    { action: "waitlist", tytul: "waitlistTitle", tresc: "waitlistBody", powodWymagany: false },
    { action: "cancel", tytul: "cancelTitle", tresc: "cancelBody", powodWymagany: true },
    { action: "attended", tytul: "attendedTitle", tresc: "attendedBody", powodWymagany: false },
    { action: "no_show", tytul: "noShowTitle", tresc: "noShowBody", powodWymagany: false },
  ];

  it.each(przypadki)(
    "„$action" + "” ma własny tytuł, własną treść i własną semantykę pola",
    ({ action, tytul, tresc, powodWymagany }) => {
      // Jeden nagłówek na sześć czynności byłby zaproszeniem do pomyłki:
      // „nieobecność" i „anulowanie" różnią się tym, czy miejsce wraca do puli.
      renderuj({ action });
      expect(screen.getByRole("heading", { name: `${BAZA}.${tytul}` })).toBeInTheDocument();
      expect(screen.getByText(`${BAZA}.${tresc}`)).toBeInTheDocument();

      const etykieta = powodWymagany ? "reasonLabel" : "noteLabel";
      expect(screen.getByLabelText(`${BAZA}.${etykieta}`)).toBe(pole());
      if (powodWymagany) {
        expect(pole()).toHaveAttribute("placeholder", `${BAZA}.reasonPlaceholder`);
      } else {
        expect(pole()).not.toHaveAttribute("placeholder");
      }
      // Pusty formularz: wymóg powodu jest JEDYNYM powodem blokady przycisku.
      expect(potwierdz()).toHaveProperty("disabled", powodWymagany);
    },
  );

  it("imię osoby, której dotyczy decyzja, jest na ekranie", () => {
    // Okno otwiera się z wiersza listy; bez imienia organizator potwierdza
    // decyzję w sprawie kogoś, kogo w tym momencie nie widzi.
    renderuj({ action: "approve", personName: "Jan Nowak" });
    expect(screen.getByText("Jan Nowak")).toBeInTheDocument();
  });
});

describe("RegistrationDecideDialog - powód wymagany", () => {
  it("SAME SPACJE to nadal brak powodu - przycisk zostaje zablokowany", () => {
    // Bez obcięcia białych znaków spacja przechodzi tutaj, a w historii
    // zgłoszenia zostaje uzasadnienie, którego nie da się przeczytać.
    renderuj({ action: "reject" });
    fireEvent.change(pole(), { target: { value: "   " } });
    expect(potwierdz()).toBeDisabled();
    fireEvent.click(potwierdz());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("wpisany powód odblokowuje przycisk i jedzie OBCIĘTY z białych znaków", () => {
    const { onConfirm } = renderuj({ action: "reject" });
    fireEvent.change(pole(), { target: { value: "  Brak miejsc w puli  " } });
    expect(potwierdz()).toBeEnabled();
    fireEvent.click(potwierdz());
    expect(onConfirm).toHaveBeenCalledWith("Brak miejsc w puli");
  });

  it("zablokowany przycisk NIE woła warstwy zapisu", () => {
    const { onConfirm } = renderuj({ action: "cancel" });
    fireEvent.click(potwierdz());
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe("RegistrationDecideDialog - notatka nieobowiązkowa", () => {
  it("puste pole jedzie jako null, nie jako pusty napis", () => {
    // Pusty napis w historii wygląda jak notatka skasowana przez człowieka;
    // `null` mówi wprost, że nikt jej nie pisał.
    const { onConfirm } = renderuj({ action: "approve" });
    fireEvent.click(potwierdz());
    expect(onConfirm).toHaveBeenCalledWith(null);
  });

  it("pole wypełnione samymi spacjami też jedzie jako null", () => {
    const { onConfirm } = renderuj({ action: "attended" });
    fireEvent.change(pole(), { target: { value: "  \n " } });
    fireEvent.click(potwierdz());
    expect(onConfirm).toHaveBeenCalledWith(null);
  });

  it("wpisana notatka jedzie obcięta", () => {
    const { onConfirm } = renderuj({ action: "no_show" });
    fireEvent.change(pole(), { target: { value: " nie dotarł, potwierdzone SMS-em " } });
    fireEvent.click(potwierdz());
    expect(onConfirm).toHaveBeenCalledWith("nie dotarł, potwierdzone SMS-em");
  });
});

describe("RegistrationDecideDialog - pozostałość po poprzedniej decyzji", () => {
  it("ZAMKNIĘCIE I OTWARCIE czyści pole", () => {
    // Regresja, którą to łapie: powód odrzucenia Anny zostaje w polu przy
    // decyzji o Janie i - jeśli organizator go nie zauważy - ląduje w JEGO
    // historii jako uzasadnienie.
    const { przerysuj } = renderuj({ action: "reject" });
    fireEvent.change(pole(), { target: { value: "Zgłoszenie duplikat" } });
    expect(pole()).toHaveValue("Zgłoszenie duplikat");

    przerysuj({ open: false });
    przerysuj({ open: true });

    expect(pole()).toHaveValue("");
  });

  it("ZMIANA CZYNNOŚCI bez zamykania okna też czyści pole", () => {
    // Lista pozwala przełączyć decyzję w locie; powód napisany pod odrzucenie
    // nie jest notatką do zatwierdzenia.
    const { przerysuj, onConfirm } = renderuj({ action: "reject" });
    fireEvent.change(pole(), { target: { value: "Niekompletne dane" } });

    przerysuj({ action: "approve" });

    expect(pole()).toHaveValue("");
    fireEvent.click(potwierdz());
    expect(onConfirm).toHaveBeenCalledWith(null);
  });
});

describe("RegistrationDecideDialog - zapis w locie i wyjście", () => {
  it("trwający zapis odcina OBA przyciski i nie przepuszcza drugiej decyzji", () => {
    const { onConfirm, onOpenChange } = renderuj({ action: "approve", isPending: true });
    expect(potwierdz()).toBeDisabled();
    expect(anuluj()).toBeDisabled();

    fireEvent.click(potwierdz());
    fireEvent.click(anuluj());

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("trwający zapis blokuje przycisk także tam, gdzie powód JEST wpisany", () => {
    // Dwa niezależne powody blokady - bez tego przypadku odwrócenie `||` na
    // `&&` przeszłoby niezauważone.
    const { onConfirm } = renderuj({ action: "reject", isPending: true });
    fireEvent.change(pole(), { target: { value: "Powód jest" } });
    expect(potwierdz()).toBeDisabled();
    fireEvent.click(potwierdz());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("anulowanie zamyka okno BEZ decyzji", () => {
    const { onOpenChange, onConfirm } = renderuj({ action: "reject" });
    fireEvent.change(pole(), { target: { value: "Coś tam" } });
    fireEvent.click(anuluj());
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
