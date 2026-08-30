// REJESTR WYDRUKU identyfikatora - dokument rozliczenia z drukarnią, a nie
// przycisk „drukuj".
//
// CO TEN PLIK DOWODZI (panel stał na zerowym pokryciu):
// 1. NA IDENTYFIKATOR IDZIE ODPOWIEDŹ BAZY, NIE POLE FORMULARZA. Operator
//    klika powód i liczbę sztuk, ale to, co ląduje na ekranie jako zapis
//    rejestru (powód, liczba wcześniejszych wydruków, osoba), pochodzi
//    z `event_badge_print_record`. Gdyby ekran odbijał wybór z formularza,
//    pokazywałby wydruk, którego rejestr nie zna.
// 2. WYBÓR CZŁOWIEKA JEDZIE W ŻĄDANIU. Powód jest wskazaniem operatora,
//    a nie domysłem bazy - stąd asercja na ładunku wywołania.
// 3. BEZ SIECI NIE MA WYDRUKU I NIE MA KOLEJKI. Ten jeden tryb nie ma kolejki
//    offline: każde wywołanie wstawia NOWY wiersz rejestru, więc ponowienie po
//    zgubionej odpowiedzi zostawiłoby ślad wydruku, którego nikt nie zrobił.
// 4. ODMOWA JEST ZDANIEM DLA OPERATORA. Powstaje POZA Reactem
//    (`scannerErrorMessage` -> prawdziwa instancja i18next), więc asercja czyta
//    zdanie, które faktycznie zobaczy człowiek.
//
// i18n jest zamockowane kluczami (parytetu PL/EN pilnuje osobna bramka
// słowników), z wyjątkiem opisanym w punkcie 4.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import type { BadgePrintScanResult, ScanPerson } from "@/lib/events/scannerApi";
import type { ScannerSession } from "@/lib/events/scannerSession";
import { axeViolations, summarize } from "@/test/axe";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// Bramka jest zaślepiona NA POZIOMIE MODUŁU RPC: panel woła ją wprost
// (nie przez środowisko w propsie), a prawdziwy moduł ciągnie klienta bazy.
vi.mock("@/lib/events/scannerApi", () => ({
  recordBadgePrintScan: vi.fn(),
}));

// Aparat nie istnieje w happy-dom; stanowisko druku i tak pracuje z czytnika.
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
const { recordBadgePrintScan } = await import("@/lib/events/scannerApi");
const { ScannerBadgePanel } =
  await import("@/components/events/scanner/organisms/ScannerBadgePanel");

const printScan = vi.mocked(recordBadgePrintScan);

const TOKEN = "nes-scanner-token-0123456789";

/** Zdanie składane przez produkcyjny mapper odmów (prawdziwy słownik PL). */
const DEVICE_LOCKED_PL =
  "Urządzenie jest chwilowo zablokowane po serii nieznanych kodów. Odczekaj chwilę i spróbuj ponownie.";

const SESSION: ScannerSession = {
  deviceId: "d1",
  label: "Stanowisko druku",
  scopes: ["badge_print"],
  expiresAt: null,
  pinnedCheckpointId: null,
  sponsorId: null,
  event: {
    id: "e1",
    slug: "kongres",
    titlePl: "Kongres",
    titleEn: "Congress",
    startsAt: null,
    endsAt: null,
    timezone: "Europe/Warsaw",
  },
  checkpoints: [],
};

function person(over: Partial<ScanPerson> = {}): ScanPerson {
  return {
    personId: "p1",
    firstName: "Anna",
    lastName: "Kowalska",
    company: "Acme Energy",
    jobTitle: "CTO",
    registrationId: "r1",
    registrationStatus: "confirmed",
    ticketNamePl: "Bilet dwudniowy",
    ticketNameEn: "Two-day pass",
    groupNamePl: "Prelegenci",
    groupNameEn: "Speakers",
    groupColor: null,
    badgePrinted: false,
    badgePrintedAt: null,
    badgePrintedVersion: null,
    ...over,
  };
}

function printed(over: Partial<BadgePrintScanResult> = {}): BadgePrintScanResult {
  return {
    outcome: "printed",
    printId: "print-1",
    templateId: "tpl-1",
    templateVersion: 4,
    copies: 1,
    reason: "first_issue",
    previousPrints: 0,
    deviceLocked: false,
    person: null,
    ...over,
  };
}

function mount(over: { online?: boolean } = {}) {
  return render(
    <ScannerBadgePanel deviceToken={TOKEN} session={SESSION} online={over.online ?? true} />,
  );
}

function scan(code: string): void {
  const input = screen.getByLabelText("eventScanner.manual.label");
  fireEvent.change(input, { target: { value: code } });
  fireEvent.submit(input.closest("form") as HTMLFormElement);
}

function reasonButton(reason: string): HTMLElement {
  return screen.getByRole("button", { name: `eventScanner.badge.reasons.${reason}` });
}

/** Blok wyniku - wszystko, co panel rysuje NA PODSTAWIE odpowiedzi bazy. */
function resultBlock(): HTMLElement {
  return screen.getByRole("status").parentElement as HTMLElement;
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  printScan.mockResolvedValue(printed());
});

describe("ScannerBadgePanel - wybór człowieka jedzie w żądaniu", () => {
  it("domyślnym powodem jest PIERWSZE WYDANIE, a domyślną liczbą sztuk jedna", () => {
    mount();

    expect(reasonButton("first_issue")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "1" })).toHaveAttribute("aria-pressed", "true");
  });

  it("powód i liczba sztuk jadą do rejestru dokładnie takie, jak je kliknięto", async () => {
    // Baza umie zgadnąć („był wydruk -> reprint_lost"), ale zgadywanie psuje
    // statystykę reklamacji. Ten test pilnuje, że zgaduje CZŁOWIEK.
    mount();

    fireEvent.click(reasonButton("reprint_damaged"));
    fireEvent.click(screen.getByRole("button", { name: "3" }));
    scan("BADGE-1");

    await waitFor(() => expect(printScan).toHaveBeenCalledTimes(1));
    expect(printScan).toHaveBeenCalledWith({
      deviceToken: TOKEN,
      code: "BADGE-1",
      reason: "reprint_damaged",
      copies: 3,
    });
  });

  it("powód ZOSTAJE wybrany między skanami - wydruk hurtowy to seria, nie jeden identyfikator", async () => {
    // Świadomy zapis stanu faktycznego: panel NIE zeruje powodu po skanie.
    // Przy `bulk_preprint` to oszczędza klikanie przy każdej osobie z serii,
    // ale znaczy też, że powód poprzedniego wydruku obowiązuje dalej - i to
    // jest widoczne na ekranie (plakietka `aria-pressed`), a nie ukryte.
    mount();

    fireEvent.click(reasonButton("bulk_preprint"));
    scan("BADGE-2");
    await waitFor(() => expect(printScan).toHaveBeenCalledTimes(1));

    expect(reasonButton("bulk_preprint")).toHaveAttribute("aria-pressed", "true");

    scan("BADGE-3");
    await waitFor(() => expect(printScan).toHaveBeenCalledTimes(2));
    expect(printScan).toHaveBeenLastCalledWith({
      deviceToken: TOKEN,
      code: "BADGE-3",
      reason: "bulk_preprint",
      copies: 1,
    });
  });
});

describe("ScannerBadgePanel - na ekranie ląduje ODPOWIEDŹ BAZY", () => {
  it("plakietka powodu pokazuje powód Z REJESTRU, nawet gdy różni się od pola formularza", async () => {
    // Sedno tego panelu. Baza może znormalizować powód (albo zapisać własny
    // przy wydruku hurtowym); ekran jest POTWIERDZENIEM ZAPISU, więc pokazuje
    // to, co poszło do dziennika - inaczej operator dostaje potwierdzenie
    // wydruku, którego rejestr nie zna.
    printScan.mockResolvedValue(printed({ reason: "first_issue", previousPrints: 2 }));
    mount();

    fireEvent.click(reasonButton("reprint_lost"));
    scan("BADGE-4");

    await screen.findByText("eventScanner.outcomes.printed");
    const block = within(resultBlock());
    expect(block.getByText("eventScanner.badge.reasons.first_issue")).toBeInTheDocument();
    expect(block.queryByText("eventScanner.badge.reasons.reprint_lost")).toBeNull();
    expect(block.getByText("eventScanner.badge.previousPrints(count=2)")).toBeInTheDocument();
  });

  it("brak powodu w odpowiedzi NIE dorysowuje plakietki z formularza", async () => {
    // `reason` bywa `NULL` w odpowiedzi. Wtedy plakietki po prostu nie ma -
    // pusty rejestr jest uczciwszy niż odbicie tego, co kliknął operator.
    printScan.mockResolvedValue(printed({ reason: null }));
    mount();

    fireEvent.click(reasonButton("data_correction"));
    scan("BADGE-5");

    await screen.findByText("eventScanner.outcomes.printed");
    expect(
      within(resultBlock()).queryByText("eventScanner.badge.reasons.data_correction"),
    ).toBeNull();
  });

  it("karta osoby powstaje z odpowiedzi bazy, a nie z niczego", async () => {
    printScan.mockResolvedValue(
      printed({ person: person({ badgePrinted: true, badgePrintedAt: "2026-09-01T08:00:00Z" }) }),
    );
    mount();

    scan("BADGE-6");

    expect(await screen.findByText("Anna Kowalska")).toBeInTheDocument();
    expect(screen.getByText("eventScanner.person.badgePrinted")).toBeInTheDocument();
  });

  it("udany zapis rejestru mówi o tym także powiadomieniem", async () => {
    mount();

    scan("BADGE-7");

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("eventScanner.outcomes.printed"),
    );
  });

  it("kod z innego wydarzenia i kod nieznany NIE dostają plakietek rejestru", async () => {
    // Nie ma wiersza rejestru, więc nie ma czego pokazywać: „wcześniej
    // wydrukowano 0 razy" przy nieznanym kodzie brzmi jak udany zapis.
    printScan.mockResolvedValueOnce(
      printed({ outcome: "wrong_event", reason: null, printId: null }),
    );
    printScan.mockResolvedValueOnce(
      printed({ outcome: "unknown_code", reason: null, printId: null }),
    );
    mount();

    scan("BADGE-8");
    expect(await screen.findByText("eventScanner.outcomes.wrongEvent")).toBeInTheDocument();
    expect(within(resultBlock()).queryByText(/previousPrints/)).toBeNull();
    expect(toast.success).not.toHaveBeenCalled();

    scan("BADGE-9");
    expect(await screen.findByText("eventScanner.outcomes.unknownCode")).toBeInTheDocument();
    expect(within(resultBlock()).queryByText(/previousPrints/)).toBeNull();
  });

  it("odmowa ZDEJMUJE poprzedni wynik z ekranu i mówi zdaniem, co robić", async () => {
    // Inaczej przy stanowisku zostałaby karta poprzedniej osoby razem
    // z potwierdzeniem wydruku, którego dla tej osoby nie było.
    printScan.mockResolvedValueOnce(printed({ person: person() }));
    printScan.mockRejectedValueOnce(new Error("device_locked: too many unknown codes"));
    mount();

    scan("BADGE-10");
    expect(await screen.findByText("Anna Kowalska")).toBeInTheDocument();

    scan("BADGE-11");
    await waitFor(() => expect(screen.queryByText("Anna Kowalska")).toBeNull());
    expect(screen.getByText("eventScanner.outcomes.unknown")).toBeInTheDocument();
    expect(screen.getByText(DEVICE_LOCKED_PL)).toBeInTheDocument();
  });
});

describe("ScannerBadgePanel - bez sieci nie ma wydruku i nie ma kolejki", () => {
  it("brak sieci mówi WPROST, że rejestr wymaga łącza, i blokuje pole kodu", () => {
    mount({ online: false });

    expect(screen.getByText("eventScanner.badge.requiresNetwork")).toBeInTheDocument();
    expect(screen.getByLabelText("eventScanner.manual.label")).toBeDisabled();
  });

  it("skan bez sieci nie idzie do bramki ANI do kolejki - ponowienie zostawiłoby fałszywy wiersz", () => {
    mount({ online: false });

    scan("BADGE-12");

    expect(printScan).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("z siecią komunikat o łączu znika", () => {
    mount();

    expect(screen.queryByText("eventScanner.badge.requiresNetwork")).toBeNull();
    expect(screen.getByLabelText("eventScanner.manual.label")).toBeEnabled();
  });
});

describe("ScannerBadgePanel - dostępność", () => {
  it("panel z wynikiem i kartą osoby nie ma naruszeń axe", async () => {
    printScan.mockResolvedValue(printed({ previousPrints: 1, person: person() }));
    const { container } = mount();

    scan("BADGE-13");
    await screen.findByText("Anna Kowalska");

    expect(await axeViolations(container).then(summarize)).toBe("");
  });

  it("panel z odmową nie ma naruszeń axe", async () => {
    printScan.mockRejectedValue(new Error("template_missing: no default template"));
    const { container } = mount();

    scan("BADGE-14");
    await screen.findByText("eventScanner.outcomes.unknown");

    expect(await axeViolations(container).then(summarize)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// DEFEKTY. Testy poniżej opisują zachowanie, którego panel NIE MA - i dlatego
// są `it.fails`. Zieleń któregoś z nich znaczy, że defekt zniknął i test trzeba
// przepiąć na zwykłe `it`.
// ---------------------------------------------------------------------------
describe("ScannerBadgePanel - defekty", () => {
  it.fails(
    "blokada urządzenia z odpowiedzi bazy NIE dociera do operatora (panel odprawy ten sam sygnał pokazuje)",
    async () => {
      // `BadgePrintScanResult.deviceLocked` jest parsowane w `scannerApi`
      // i wyrzucane do kosza w tym panelu. `ScannerCheckinPanel` na ten sam
      // sygnał woła `toast.error(scannerErrorMessage("device_locked: ..."))`.
      // Skutek przy stanowisku druku: baza już blokuje urządzenie, a operator
      // widzi wyłącznie „Wydruk zapisany" - i dowiaduje się o blokadzie dopiero
      // przy pierwszym skanie, który wróci z odmową, bez wiedzy, że wystarczy
      // odczekać.
      printScan.mockResolvedValue(printed({ deviceLocked: true }));
      mount();

      scan("BADGE-15");
      await screen.findByText("eventScanner.outcomes.printed");

      expect(toast.error).toHaveBeenCalledWith(DEVICE_LOCKED_PL);
    },
  );

  it.fails(
    "liczba sztuk ZAPISANA w rejestrze nie trafia na ekran - widać tylko to, co kliknął operator",
    async () => {
      // Rejestr jest dokumentem rozliczenia z drukarnią, a odpowiedź niesie
      // `copies` (parsowane, z domyślną jedynką). Baza może zapisać INNĄ liczbę
      // niż wybrana, a wtedy jedyną liczbą na ekranie zostaje wybór z formularza:
      // operator rozlicza trzy sztuki, rejestr zna jedną, i nikt tego nie widzi
      // aż do faktury.
      printScan.mockResolvedValue(printed({ copies: 1, previousPrints: 0 }));
      mount();

      fireEvent.click(screen.getByRole("button", { name: "3" }));
      scan("BADGE-16");
      await screen.findByText("eventScanner.outcomes.printed");

      expect(within(resultBlock()).getByText(/eventScanner\.badge\.copies/)).toBeInTheDocument();
    },
  );
});
