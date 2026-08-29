// Skan LEADU na stoisku partnera: to, co po zepsuciu wynosi ze stoiska cudze
// dane osobowe albo gubi rozmowę, dla której ten skan w ogóle powstał.
//
// PANEL DOSTAJE ŚRODOWISKO W PROPSIE - tak samo jak `ScannerCheckinPanel` -
// więc test podaje mu wprost atrapę: bez atrapy sieci, bez IndexedDB i bez
// zegara. Sprawdzamy pięć rzeczy, które decydują o tym, czy stoisko wyniesie
// dane, których nie wolno mu wynieść:
// 1. ZGODA RZĄDZI TYM, CO WIDAĆ - bez zgody ekran mówi o jej braku i nie ma
//    tam ani maila, ani telefonu (patrz `it.fails` na końcu pliku),
// 2. skan bez wyniku nie rysuje notatnika - notatka bez leadu nie ma dokąd pójść,
// 3. brak sieci mówi „w kolejce", a nie „zapisano",
// 4. notatka i ocena dopisują się do TEGO SAMEGO skanu (drugie wywołanie
//    z tym samym kodem), a nie tworzą drugiego leadu,
// 5. notatka poprzedniej osoby nie przykleja się do następnej.
//
// i18n jest zamockowane kluczami (parytetu PL/EN pilnuje osobna bramka
// słowników), ale komunikat odmowy powstaje POZA Reactem
// (`scannerErrorMessage` -> prawdziwa instancja i18next), więc tam asercja
// czyta zdanie, które faktycznie zobaczy operator.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { LeadScanResult } from "@/lib/events/scannerApi";
import type { ScannerRuntime } from "@/lib/events/useScanner";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// Aparat nie istnieje w happy-dom; stoisko i tak ma działać z czytnika i klawiatury.
vi.mock("@/hooks/useBarcodeScanner", () => ({
  useBarcodeScanner: () => ({
    support: "unsupported",
    active: false,
    starting: false,
    error: null,
    torchAvailable: false,
    torchOn: false,
    videoRef: { current: null },
    start: vi.fn(),
    stop: vi.fn(),
    toggleTorch: vi.fn(),
  }),
}));

const { toast } = await import("sonner");
const { ScannerLeadPanel } = await import("@/components/events/scanner/organisms/ScannerLeadPanel");

/** Zdanie, które składa produkcyjny mapper odmów bramki (prawdziwy słownik). */
const DEVICE_LOCKED_PL =
  "Urządzenie jest chwilowo zablokowane po serii nieznanych kodów. Odczekaj chwilę i spróbuj ponownie.";

function leadResult(over: Partial<LeadScanResult> = {}): LeadScanResult {
  return {
    outcome: "saved",
    leadId: "l1",
    scanCount: 1,
    consent: true,
    deviceLocked: false,
    person: {
      firstName: "Anna",
      lastName: "Kowalska",
      company: "Acme Energy",
      jobTitle: "CTO",
      email: "anna@example.org",
      phone: "+48 600 100 200",
    },
    ...over,
  };
}

function runtimeStub(over: Partial<ScannerRuntime> = {}): ScannerRuntime {
  return {
    status: "ready",
    session: null,
    token: "a".repeat(32),
    connectError: null,
    connect: vi.fn(),
    disconnect: vi.fn(),
    online: true,
    outbox: [],
    outboxCounts: { pending: 0, stuck: 0 },
    outboxPersistent: true,
    flushing: false,
    flush: vi.fn(),
    discard: vi.fn(),
    submitCheckin: vi.fn(),
    submitLead: vi.fn().mockResolvedValue({ queued: false, result: leadResult() }),
    ...over,
  };
}

function scan(code: string): void {
  const input = screen.getByLabelText("eventScanner.manual.label");
  fireEvent.change(input, { target: { value: code } });
  fireEvent.submit(input.closest("form") as HTMLFormElement);
}

function saveButton(): HTMLElement {
  return screen.getByRole("button", { name: "eventScanner.lead.save" });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ScannerLeadPanel", () => {
  it("przed pierwszym skanem nie ma ani wyniku, ani notatnika", () => {
    // Notatka bez leadu nie ma dokąd pójść: gdyby pole stało tu od początku,
    // operator wpisałby uwagi „na zapas", a te przepadłyby przy pierwszym skanie.
    render(<ScannerLeadPanel runtime={runtimeStub()} />);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByLabelText("eventScanner.lead.noteLabel")).toBeNull();
    expect(screen.queryByRole("button", { name: "eventScanner.lead.save" })).toBeNull();
  });

  it("lead ZE ZGODĄ oddaje komplet danych kontaktowych", async () => {
    // To jest cała wartość skanu dla partnera. Gdyby panel przestał pokazywać
    // maila i telefon, wystawca miałby na stoisku licznik piknięć zamiast leadu.
    render(<ScannerLeadPanel runtime={runtimeStub()} />);
    scan("QR-1");

    expect(await screen.findByText("Anna Kowalska")).toBeInTheDocument();
    expect(screen.getByText("CTO · Acme Energy")).toBeInTheDocument();
    expect(screen.getByText("anna@example.org · +48 600 100 200")).toBeInTheDocument();
    // Zgodę widać w DWÓCH miejscach: w podpowiedzi pod wielkim napisem wyniku
    // i na plakietce nad danymi - operator patrzy raz na pas, raz na kartę.
    expect(screen.getAllByText("eventScanner.lead.consentYes")).toHaveLength(2);
    expect(screen.getByText("eventScanner.lead.scanCount(count=1)")).toBeInTheDocument();
  });

  it("lead BEZ ZGODY jest policzony, ale nie ma przy nim danych kontaktowych", async () => {
    // Baza przy braku zgody nie oddaje osoby (`person => NULL`), więc ekran ma
    // powiedzieć WPROST, że danych nie będzie - inaczej operator uznałby pusty
    // panel za awarię i szukałby obejścia (dopisania maila w notatce).
    render(
      <ScannerLeadPanel
        runtime={runtimeStub({
          submitLead: vi.fn().mockResolvedValue({
            queued: false,
            result: leadResult({ consent: false, person: null, scanCount: 2 }),
          }),
        })}
      />,
    );
    scan("QR-2");

    expect(await screen.findByText("eventScanner.lead.consentNo")).toBeInTheDocument();
    expect(screen.getByText("eventScanner.lead.consentNoHint")).toBeInTheDocument();
    expect(screen.getByText("eventScanner.lead.scanCount(count=2)")).toBeInTheDocument();
    // Notatka zostaje dostępna: rozmowę wolno opisać nawet bez zgody na dane.
    expect(screen.getByLabelText("eventScanner.lead.noteLabel")).toBeInTheDocument();
  });

  it("puste pola osoby nie zostawiają wiszących separatorów", async () => {
    // Baza oddaje osobę z częścią pól pustych (`company_text` bywa puste, a
    // telefon jest opcjonalny). Bez odsiania pustych kawałków na identyfikatorze
    // pojawiłoby się „CTO · " albo samotna kropka - wygląda jak ucięte dane.
    render(
      <ScannerLeadPanel
        runtime={runtimeStub({
          submitLead: vi.fn().mockResolvedValue({
            queued: false,
            result: leadResult({
              person: {
                firstName: "Jan",
                lastName: null,
                company: "   ",
                jobTitle: "Dyrektor",
                email: "jan@example.org",
                phone: null,
              },
            }),
          }),
        })}
      />,
    );
    scan("QR-3");

    expect(await screen.findByText("Jan")).toBeInTheDocument();
    expect(screen.getByText("Dyrektor")).toBeInTheDocument();
    expect(screen.getByText("jan@example.org")).toBeInTheDocument();
    expect(screen.queryByText(/·/)).toBeNull();
  });

  it("brak sieci mówi „w kolejce”, a nie „zapisano” - i nie otwiera notatnika", async () => {
    // Kolejka offline nie zna jeszcze osoby, więc nie ma czego opisać. Gdyby
    // ekran pokazał tu notatnik, operator wpisałby uwagi, które nie mają leadu.
    render(
      <ScannerLeadPanel
        runtime={runtimeStub({
          online: false,
          submitLead: vi.fn().mockResolvedValue({ queued: true }),
        })}
      />,
    );
    scan("QR-4");

    expect(await screen.findByText("eventScanner.outcomes.saved")).toBeInTheDocument();
    expect(screen.getByText("eventScanner.errors.offline")).toBeInTheDocument();
    expect(screen.queryByLabelText("eventScanner.lead.noteLabel")).toBeNull();
    expect(toast.info).toHaveBeenCalledWith("eventScanner.outbox.queuedToast");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("odmowa poświadczenia ląduje jako ZDANIE dla operatora, nie jako pusty ekran", async () => {
    // Wyjątek z bramki niesie surową głowę `device_locked:`; operator ma zobaczyć
    // co robić („odczekaj chwilę"), a nie klucz błędu.
    render(
      <ScannerLeadPanel
        runtime={runtimeStub({
          submitLead: vi.fn().mockRejectedValue(new Error("device_locked: cooling down")),
        })}
      />,
    );
    scan("QR-5");

    expect(await screen.findByText("eventScanner.outcomes.unknown")).toBeInTheDocument();
    expect(screen.getByText(DEVICE_LOCKED_PL)).toBeInTheDocument();
    expect(screen.queryByLabelText("eventScanner.lead.noteLabel")).toBeNull();
  });

  it("odmowa po udanym skanie ZDEJMUJE poprzedni lead z ekranu", async () => {
    // Inaczej przy stoisku zostałaby karta poprzedniej osoby razem z notatnikiem,
    // a wpisana w nim uwaga poszłaby na cudzy lead.
    const submitLead = vi
      .fn()
      .mockResolvedValueOnce({ queued: false, result: leadResult() })
      .mockRejectedValueOnce(new Error("device_scope_missing: no lead scope"));
    render(<ScannerLeadPanel runtime={runtimeStub({ submitLead })} />);

    scan("QR-6");
    expect(await screen.findByText("Anna Kowalska")).toBeInTheDocument();

    scan("QR-7");
    await waitFor(() => expect(screen.queryByText("Anna Kowalska")).toBeNull());
    expect(screen.getByText("eventScanner.outcomes.unknown")).toBeInTheDocument();
  });

  it("kod z innego wydarzenia i kod nieznany nie otwierają notatnika", async () => {
    // Notatka przy odmowie nie ma leadu, do którego mogłaby się dopisać - baza
    // odrzuciłaby drugie wywołanie, a operator myślałby, że zapisał rozmowę.
    const submitLead = vi
      .fn()
      .mockResolvedValueOnce({
        queued: false,
        result: leadResult({ outcome: "wrong_event", consent: false, person: null }),
      })
      .mockResolvedValueOnce({
        queued: false,
        result: leadResult({ outcome: "unknown_code", consent: false, person: null }),
      });
    render(<ScannerLeadPanel runtime={runtimeStub({ submitLead })} />);

    scan("QR-8");
    expect(await screen.findByText("eventScanner.outcomes.wrongEvent")).toBeInTheDocument();
    expect(screen.queryByLabelText("eventScanner.lead.noteLabel")).toBeNull();

    scan("QR-9");
    expect(await screen.findByText("eventScanner.outcomes.unknownCode")).toBeInTheDocument();
    expect(screen.queryByLabelText("eventScanner.lead.noteLabel")).toBeNull();
  });

  it("sam skan idzie BEZ notatki, a notatka z oceną dopisuje się do TEGO SAMEGO kodu", async () => {
    // Rozmowa dzieje się po piknięciu badge'a. Gdyby drugie wywołanie poszło
    // z innym kodem (albo bez kodu), baza założyłaby drugi lead i wystawca
    // zobaczyłby tę samą osobę dwa razy - raz z notatką, raz bez.
    const runtime = runtimeStub();
    render(<ScannerLeadPanel runtime={runtime} />);

    scan("QR-10");
    await screen.findByText("Anna Kowalska");
    expect(runtime.submitLead).toHaveBeenNthCalledWith(1, {
      code: "QR-10",
      note: null,
      interestRating: null,
    });

    fireEvent.change(screen.getByLabelText("eventScanner.lead.noteLabel"), {
      target: { value: "  chce ofertę na Q1  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "4" }));
    fireEvent.click(saveButton());

    await waitFor(() => expect(runtime.submitLead).toHaveBeenCalledTimes(2));
    expect(runtime.submitLead).toHaveBeenNthCalledWith(2, {
      code: "QR-10",
      note: "chce ofertę na Q1",
      interestRating: 4,
    });
    expect(toast.success).toHaveBeenCalledWith("eventScanner.lead.saved");
  });

  it("sama ocena, bez notatki, też jest zapisem - notatka nie jest obowiązkowa", async () => {
    // Przy stoisku „4/5" bywa całą treścią rozmowy. Wymóg notatki nauczyłby
    // operatora wpisywać kropkę, żeby móc kliknąć zapis.
    const runtime = runtimeStub();
    render(<ScannerLeadPanel runtime={runtime} />);
    scan("QR-11");
    await screen.findByText("Anna Kowalska");

    expect(saveButton()).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "2" }));
    expect(saveButton()).toBeEnabled();
    fireEvent.click(saveButton());

    await waitFor(() => expect(runtime.submitLead).toHaveBeenCalledTimes(2));
    expect(runtime.submitLead).toHaveBeenNthCalledWith(2, {
      code: "QR-11",
      note: null,
      interestRating: 2,
    });
  });

  it("sama biała spacja w notatce nie jest zapisem", async () => {
    // Bez obcięcia białych znaków „ " włącza przycisk i jedzie do bazy jako
    // treść rozmowy - w panelu wystawcy wygląda to jak notatka, którą ktoś
    // napisał i skasował.
    render(<ScannerLeadPanel runtime={runtimeStub()} />);
    scan("QR-12");
    await screen.findByText("Anna Kowalska");

    fireEvent.change(screen.getByLabelText("eventScanner.lead.noteLabel"), {
      target: { value: "   " },
    });
    expect(saveButton()).toBeDisabled();
  });

  it("ponowne kliknięcie tej samej oceny ją ZDEJMUJE", async () => {
    // Ocena wpisana pomyłkowo musi mieć drogę powrotną - przy stoisku nie ma
    // panelu do jej poprawienia, a błędna „1" zostaje w CRM wystawcy.
    render(<ScannerLeadPanel runtime={runtimeStub()} />);
    scan("QR-13");
    await screen.findByText("Anna Kowalska");

    const three = screen.getByRole("button", { name: "3" });
    fireEvent.click(three);
    expect(three).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(three);
    expect(three).toHaveAttribute("aria-pressed", "false");
    expect(saveButton()).toBeDisabled();
  });

  it("notatka poprzedniej osoby NIE przykleja się do następnej", async () => {
    // Najdroższy błąd tego ekranu: uwaga o jednym rozmówcy trafia do CRM
    // przy nazwisku drugiego. Kolejka przy stoisku nie daje czasu, żeby to
    // zauważyć.
    const runtime = runtimeStub();
    render(<ScannerLeadPanel runtime={runtime} />);

    scan("QR-14");
    await screen.findByText("Anna Kowalska");
    fireEvent.change(screen.getByLabelText("eventScanner.lead.noteLabel"), {
      target: { value: "budżet 200k" },
    });
    fireEvent.click(screen.getByRole("button", { name: "5" }));

    scan("QR-15");
    await waitFor(() => expect(runtime.submitLead).toHaveBeenCalledTimes(2));
    expect(runtime.submitLead).toHaveBeenNthCalledWith(2, {
      code: "QR-15",
      note: null,
      interestRating: null,
    });
    expect(screen.getByLabelText("eventScanner.lead.noteLabel")).toHaveValue("");
    expect(screen.getByRole("button", { name: "5" })).toHaveAttribute("aria-pressed", "false");
    expect(saveButton()).toBeDisabled();
  });

  it("zapis w toku blokuje przycisk - drugie kliknięcie to drugie wywołanie", async () => {
    // Bez blokady niecierpliwe drugie kliknięcie wysyła tę samą notatkę raz
    // jeszcze; baza scala leady po parze partner-osoba, więc druga treść
    // NADPISUJE pierwszą.
    let release: (value: { queued: false; result: LeadScanResult }) => void = () => {};
    const submitLead = vi
      .fn()
      .mockResolvedValueOnce({ queued: false, result: leadResult() })
      .mockImplementationOnce(
        () =>
          new Promise<{ queued: false; result: LeadScanResult }>((resolve) => {
            release = resolve;
          }),
      );
    render(<ScannerLeadPanel runtime={runtimeStub({ submitLead })} />);

    scan("QR-16");
    await screen.findByText("Anna Kowalska");
    fireEvent.change(screen.getByLabelText("eventScanner.lead.noteLabel"), {
      target: { value: "wraca w marcu" },
    });

    fireEvent.click(saveButton());
    await waitFor(() => expect(saveButton()).toBeDisabled());
    fireEvent.click(saveButton());
    expect(submitLead).toHaveBeenCalledTimes(2);

    release({ queued: false, result: leadResult() });
    await waitFor(() => expect(saveButton()).toBeEnabled());
  });

  // ---------------------------------------------------------------------
  // DRUGA ZAPORA NA DANE OSOBOWE.
  //
  // `ScannerLeadPanel.tsx` rysował kartę osoby na warunku `person !== null`,
  // bez oglądania się na `consent`. Ratowała nas wyłącznie baza
  // (`event_lead_scan_record` zwraca `person => NULL` przy braku zgody), więc
  // jedna zmiana po stronie SQL - albo cofnięcie zgody między skanem a
  // renderem - wystawiłaby mail i telefon obok plakietki „brak zgody".
  // Warunek jest teraz `consent && person !== null`, czyli panel egzekwuje to,
  // co obiecuje jego nagłówek, zamiast zakładać, że zrobi to kto inny.
  // ---------------------------------------------------------------------
  it("dane kontaktowe leada BEZ ZGODY nie trafiają na ekran", async () => {
    render(
      <ScannerLeadPanel
        runtime={runtimeStub({
          submitLead: vi.fn().mockResolvedValue({
            queued: false,
            result: leadResult({ consent: false }),
          }),
        })}
      />,
    );
    scan("QR-17");

    expect(await screen.findByText("eventScanner.lead.consentNo")).toBeInTheDocument();
    expect(screen.queryByText(/anna@example\.org/)).toBeNull();
    expect(screen.queryByText(/600 100 200/)).toBeNull();
  });
});
