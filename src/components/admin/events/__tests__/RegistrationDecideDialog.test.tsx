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
//   3. DWA POLA, DWÓCH ODBIORCÓW (REG-06). Notatka wewnętrzna jest przy KAŻDEJ
//      czynności i ma zdanie „nie trafia do uczestnika"; powód widoczny dla
//      uczestnika stoi WYŁĄCZNIE przy odrzuceniu i anulowaniu. Przy innej
//      czynności nigdy nie jedzie (baza i tak by odmówiła `invalid_request`).
//   4. NOTATKA BLOKUJE PRZYCISK TYLKO TAM, GDZIE BAZA JEJ WYMAGA. Same spacje to
//      nadal brak notatki; odrzucenie liczy od 3 znaków (CHECK bazy).
//   5. LIMITY SĄ WSPÓLNE Z BAZĄ I BLOKUJĄ, NIE TNĄ: 2000 znaków notatki i 1000
//      powodu - licznik pokazuje limit, przekroczenie gasi przycisk.
//   6. PUSTE POLA JADĄ JAKO `null`, obcięte z białych znaków.
//   7. NOWA DECYZJA ZACZYNA OD PUSTYCH PÓL - i po zamknięciu okna, i przy
//      zmianie czynności bez zamykania.
//   8. ANULOWANIE OPŁACONEGO (REG-03): okno pyta bazę o skutek finansowy,
//      pokazuje go przed decyzją, a „Nie zwracaj płatności" wymaga notatki
//      i jedzie jako `refund: none`. Zgłoszenie bez wpłaty nie ma tego pola.
//   9. TRWAJĄCY ZAPIS ODCINA OBA PRZYCISKI.
//
// Radix Dialog nie działa pod happy-dom bez pełnego pointer API - jest
// podmieniony na natywny odpowiednik, w którym TREŚĆ istnieje wyłącznie przy
// otwartym oknie (tak jak portal Radixa).
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { fireEvent, screen } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { RegistrationAction, RegistrationRefundPreview } from "@/lib/events/registrationsApi";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";

const h = vi.hoisted(() => ({
  preview: null as RegistrationRefundPreview | null,
  previewCalls: [] as string[],
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn() } }));

vi.mock("@/lib/events/registrationsApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events/registrationsApi")>()),
  fetchRegistrationRefundPreview: (registrationId: string) => {
    h.previewCalls.push(registrationId);
    return h.preview === null ? Promise.reject(new Error("boom")) : Promise.resolve(h.preview);
  },
}));

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
const REG = "11111111-1111-4111-8111-111111111111";

interface Props {
  open?: boolean;
  action?: RegistrationAction | null;
  personName?: string;
  isPending?: boolean;
  registrationId?: string | null;
}

function renderuj(props: Props = {}) {
  const onOpenChange = vi.fn();
  const onConfirm = vi.fn();
  const wlasciwosci = {
    open: props.open ?? true,
    action: props.action === undefined ? ("reject" as RegistrationAction) : props.action,
    personName: props.personName ?? "Anna Kowalska",
    isPending: props.isPending ?? false,
    registrationId: props.registrationId === undefined ? REG : props.registrationId,
  };
  const wynik = renderWithQueryClient(
    <RegistrationDecideDialog {...wlasciwosci} onOpenChange={onOpenChange} onConfirm={onConfirm} />,
  );
  const przerysuj = (zmiana: Props) =>
    wynik.rerender(
      <QueryClientProvider client={wynik.queryClient}>
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
        />
      </QueryClientProvider>,
    );
  return { ...wynik, onOpenChange, onConfirm, przerysuj };
}

const notatka = () => screen.getByLabelText(`${BAZA}.noteLabel`);
const powodUczestnika = () => screen.getByLabelText(`${BAZA}.participantReasonLabel`);
const potwierdz = () => screen.getByRole("button", { name: `${BAZA}.confirmAction` });
const anuluj = () => screen.getByRole("button", { name: `${BAZA}.cancelAction` });

/** Skutek anulowania z bazy - domyślnie opłacone zgłoszenie z automatycznym zwrotem. */
function skutek(over: Partial<RegistrationRefundPreview> = {}): RegistrationRefundPreview {
  return {
    effect: "full_refund",
    reviewReason: null,
    amountCents: 15000,
    currency: "PLN",
    refundMode: "policy",
    refundDeadlineAt: null,
    groupGuestsClosing: 0,
    acknowledgementRequired: true,
    jobState: "pending",
    paymentStatus: "paid",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.preview = skutek({ effect: "none", jobState: null, amountCents: null, currency: null });
  h.previewCalls = [];
});

describe("RegistrationDecideDialog - kiedy okna nie ma", () => {
  it("BEZ WYBRANEJ CZYNNOŚCI okno nie renderuje NICZEGO", () => {
    const { container } = renderuj({ action: null });
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("okno ZAMKNIĘTE nie pokazuje ani tytułu, ani pól", () => {
    renderuj({ open: false });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText(`${BAZA}.rejectTitle`)).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});

describe("RegistrationDecideDialog - sześć czynności, sześć zdań, dwa pola", () => {
  const przypadki: {
    action: RegistrationAction;
    tytul: string;
    tresc: string;
    notatkaWymagana: boolean;
    powodDlaUczestnika: boolean;
  }[] = [
    {
      action: "approve",
      tytul: "approveTitle",
      tresc: "approveBody",
      notatkaWymagana: false,
      powodDlaUczestnika: false,
    },
    {
      action: "reject",
      tytul: "rejectTitle",
      tresc: "rejectBody",
      notatkaWymagana: true,
      powodDlaUczestnika: true,
    },
    {
      action: "waitlist",
      tytul: "waitlistTitle",
      tresc: "waitlistBody",
      notatkaWymagana: false,
      powodDlaUczestnika: false,
    },
    {
      action: "cancel",
      tytul: "cancelTitle",
      tresc: "cancelBody",
      notatkaWymagana: true,
      powodDlaUczestnika: true,
    },
    {
      action: "attended",
      tytul: "attendedTitle",
      tresc: "attendedBody",
      notatkaWymagana: false,
      powodDlaUczestnika: false,
    },
    {
      action: "no_show",
      tytul: "noShowTitle",
      tresc: "noShowBody",
      notatkaWymagana: false,
      powodDlaUczestnika: false,
    },
  ];

  it.each(przypadki)(
    "„$action" + "” ma własny tytuł, treść i właściwe pola",
    ({ action, tytul, tresc, notatkaWymagana, powodDlaUczestnika }) => {
      renderuj({ action });
      expect(screen.getByRole("heading", { name: `${BAZA}.${tytul}` })).toBeInTheDocument();
      expect(screen.getByText(`${BAZA}.${tresc}`)).toBeInTheDocument();

      // Notatka wewnętrzna jest ZAWSZE i mówi, że nie trafia do uczestnika.
      expect(notatka()).toBeInTheDocument();
      expect(screen.getByText(new RegExp(`${BAZA}.noteHint`))).toBeInTheDocument();
      // Powód dla uczestnika - tylko przy zamknięciu.
      expect(screen.queryByLabelText(`${BAZA}.participantReasonLabel`) !== null).toBe(
        powodDlaUczestnika,
      );
      expect(screen.getAllByRole("textbox")).toHaveLength(powodDlaUczestnika ? 2 : 1);
      // Pusty formularz: wymóg notatki jest JEDYNYM powodem blokady przycisku.
      expect(potwierdz()).toHaveProperty("disabled", notatkaWymagana);
    },
  );

  it("imię osoby, której dotyczy decyzja, jest na ekranie", () => {
    renderuj({ action: "approve", personName: "Jan Nowak" });
    expect(screen.getByText("Jan Nowak")).toBeInTheDocument();
  });
});

describe("RegistrationDecideDialog - dwa pola, dwóch odbiorców (REG-06)", () => {
  it("odrzucenie oddaje notatkę i powód OSOBNO, obcięte z białych znaków", () => {
    const { onConfirm } = renderuj({ action: "reject" });
    fireEvent.change(notatka(), { target: { value: "  Brak miejsc w puli  " } });
    fireEvent.change(powodUczestnika(), { target: { value: "  Powód Y  " } });
    fireEvent.click(potwierdz());
    expect(onConfirm).toHaveBeenCalledWith({
      note: "Brak miejsc w puli",
      participantReason: "Powód Y",
    });
  });

  it("powód dla uczestnika z samych spacji jedzie jako null", () => {
    const { onConfirm } = renderuj({ action: "reject" });
    fireEvent.change(notatka(), { target: { value: "Duplikat zgłoszenia" } });
    fireEvent.change(powodUczestnika(), { target: { value: "   " } });
    fireEvent.click(potwierdz());
    expect(onConfirm).toHaveBeenCalledWith({
      note: "Duplikat zgłoszenia",
      participantReason: null,
    });
  });

  it("po zmianie czynności na zatwierdzenie powód dla uczestnika NIE jedzie", () => {
    const { przerysuj, onConfirm } = renderuj({ action: "reject" });
    fireEvent.change(powodUczestnika(), { target: { value: "Powód Y" } });
    przerysuj({ action: "approve" });
    expect(screen.queryByLabelText(`${BAZA}.participantReasonLabel`)).toBeNull();
    fireEvent.click(potwierdz());
    expect(onConfirm).toHaveBeenCalledWith({ note: null, participantReason: null });
  });

  it("limity bazy blokują, nie tną: 1001 znaków powodu albo 2001 notatki gasi przycisk", () => {
    const { onConfirm } = renderuj({ action: "reject" });
    fireEvent.change(notatka(), { target: { value: "Notatka ok" } });
    fireEvent.change(powodUczestnika(), { target: { value: "x".repeat(1001) } });
    expect(potwierdz()).toBeDisabled();
    expect(screen.getByText(/1001 \/ 1000/)).toBeInTheDocument();

    fireEvent.change(powodUczestnika(), { target: { value: "x".repeat(1000) } });
    expect(potwierdz()).toBeEnabled();

    fireEvent.change(notatka(), { target: { value: "n".repeat(2001) } });
    expect(potwierdz()).toBeDisabled();
    fireEvent.click(potwierdz());
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe("RegistrationDecideDialog - notatka wymagana", () => {
  it("SAME SPACJE to nadal brak notatki - przycisk zostaje zablokowany", () => {
    renderuj({ action: "reject" });
    fireEvent.change(notatka(), { target: { value: "   " } });
    expect(potwierdz()).toBeDisabled();
  });

  it("odrzucenie liczy notatkę od 3 znaków (CHECK bazy), a pusta notatka blokuje", () => {
    renderuj({ action: "reject" });
    fireEvent.change(notatka(), { target: { value: "ok" } });
    expect(potwierdz()).toBeDisabled();
    fireEvent.change(notatka(), { target: { value: "oki" } });
    expect(potwierdz()).toBeEnabled();
  });

  it("zablokowany przycisk NIE woła warstwy zapisu", () => {
    const { onConfirm } = renderuj({ action: "cancel" });
    fireEvent.click(potwierdz());
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe("RegistrationDecideDialog - notatka nieobowiązkowa", () => {
  it("puste pole jedzie jako null, nie jako pusty napis", () => {
    const { onConfirm } = renderuj({ action: "approve" });
    fireEvent.click(potwierdz());
    expect(onConfirm).toHaveBeenCalledWith({ note: null, participantReason: null });
  });

  it("wpisana notatka jedzie obcięta", () => {
    const { onConfirm } = renderuj({ action: "no_show" });
    fireEvent.change(notatka(), { target: { value: " nie dotarł, potwierdzone SMS-em " } });
    fireEvent.click(potwierdz());
    expect(onConfirm).toHaveBeenCalledWith({
      note: "nie dotarł, potwierdzone SMS-em",
      participantReason: null,
    });
  });
});

describe("RegistrationDecideDialog - pozostałość po poprzedniej decyzji", () => {
  it("ZAMKNIĘCIE I OTWARCIE czyści oba pola", () => {
    const { przerysuj } = renderuj({ action: "reject" });
    fireEvent.change(notatka(), { target: { value: "Zgłoszenie duplikat" } });
    fireEvent.change(powodUczestnika(), { target: { value: "Powód" } });

    przerysuj({ open: false });
    przerysuj({ open: true });

    expect(notatka()).toHaveValue("");
    expect(powodUczestnika()).toHaveValue("");
  });
});

describe("RegistrationDecideDialog - anulowanie opłaconego (REG-03)", () => {
  it("pokazuje skutek PRZED decyzją i domyślnie zleca zwrot (`refund: full`)", async () => {
    h.preview = skutek();
    const { onConfirm } = renderuj({ action: "cancel" });

    expect(await screen.findByText(/refund\.full\(amount=/)).toBeInTheDocument();
    expect(h.previewCalls).toEqual([REG]);

    fireEvent.change(notatka(), { target: { value: "Prośba uczestnika" } });
    fireEvent.click(potwierdz());
    expect(onConfirm).toHaveBeenCalledWith({
      note: "Prośba uczestnika",
      participantReason: null,
      refund: "full",
    });
  });

  it("„Nie zwracaj płatności” wymaga notatki (3 znaki) i jedzie jako `refund: none`", async () => {
    h.preview = skutek();
    const { onConfirm } = renderuj({ action: "cancel" });

    fireEvent.click(await screen.findByLabelText(`${BAZA}.refund.waive`));
    fireEvent.change(notatka(), { target: { value: "ab" } });
    expect(potwierdz()).toBeDisabled();

    fireEvent.change(notatka(), { target: { value: "Bilet na 2027" } });
    fireEvent.click(potwierdz());
    expect(onConfirm).toHaveBeenCalledWith({
      note: "Bilet na 2027",
      participantReason: null,
      refund: "none",
    });
  });

  it("wspólna wpłata mówi o decyzji w dzienniku, bez kwoty", async () => {
    h.preview = skutek({
      effect: "organizer_review",
      reviewReason: "shared_payment",
      amountCents: null,
      currency: null,
      jobState: "needs_review",
    });
    renderuj({ action: "cancel" });
    expect(await screen.findByText(`${BAZA}.refund.shared`)).toBeInTheDocument();
  });

  it("zgłoszenie bez wpłaty nie ma pola „nie zwracaj” i nie wysyła klucza `refund`", async () => {
    const { onConfirm } = renderuj({ action: "cancel" });
    await screen.findByText(`${BAZA}.cancelBody`);
    expect(screen.queryByLabelText(`${BAZA}.refund.waive`)).toBeNull();
    fireEvent.change(notatka(), { target: { value: "Rezygnacja telefoniczna" } });
    fireEvent.click(potwierdz());
    expect(onConfirm).toHaveBeenCalledWith({
      note: "Rezygnacja telefoniczna",
      participantReason: null,
    });
  });

  it("odmowa podglądu mówi to wprost, a decyzja zostaje możliwa", async () => {
    h.preview = null;
    renderuj({ action: "cancel" });
    expect(await screen.findByText(`${BAZA}.refund.loadError`)).toBeInTheDocument();
  });

  it("przy innej czynności okno NIE pyta bazy o płatność", () => {
    renderuj({ action: "reject" });
    expect(h.previewCalls).toEqual([]);
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

  it("trwający zapis blokuje przycisk także tam, gdzie notatka JEST wpisana", () => {
    const { onConfirm } = renderuj({ action: "reject", isPending: true });
    fireEvent.change(notatka(), { target: { value: "Powód jest" } });
    expect(potwierdz()).toBeDisabled();
    fireEvent.click(potwierdz());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("anulowanie zamyka okno BEZ decyzji", () => {
    const { onOpenChange, onConfirm } = renderuj({ action: "reject" });
    fireEvent.change(notatka(), { target: { value: "Coś tam" } });
    fireEvent.click(anuluj());
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
