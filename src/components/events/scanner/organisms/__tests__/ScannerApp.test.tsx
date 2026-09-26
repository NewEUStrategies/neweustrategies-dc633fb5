// Cała aplikacja skanera - TRZY STANY, NIE JEDEN EKRAN.
//
// CO TEN PLIK DOWODZI (organizm stał na zerowym pokryciu):
// 1. BEZ POŚWIADCZENIA WIDAĆ PAROWANIE, i nic poza nim. Czytnik nad ekranem
//    parowania byłby zaproszeniem do skanowania, które nie ma prawa się udać.
// 2. Z WYGASŁYM POŚWIADCZENIEM WIDAĆ JEDNO ZDANIE I ODŁĄCZENIE. Pokazywanie
//    czytnika, który każdy skan skończy odmową, to okrucieństwo wobec kolejki.
// 3. ZAKŁADKI POCHODZĄ Z ZAKRESÓW, NIE Z KONFIGURACJI. Tryb, którego
//    poświadczenie nie niesie, po prostu nie istnieje na ekranie - a tryb,
//    który zniknął z poświadczenia w trakcie zmiany, przestaje być aktywny.
// 4. ODŁĄCZENIE URZĄDZENIA KASUJE POŚWIADCZENIE. Na tym poziomie znaczy to:
//    przycisk w pasku sesji woła `runtime.disconnect` - jedyną funkcję, która
//    czyści pamięć urządzenia (jej wnętrze ma własne testy i przejazd e2e).
// 5. PASEK SESJI ZOSTAJE NA WIERZCHU: sieć, kolejka i termin ważności są tym,
//    co decyduje, czy wolno odejść od bramki.
//
// ŚRODOWISKO URUCHOMIENIOWE JEST ZAŚLEPIONE (`useScannerRuntime`), bo to ono,
// a nie ten organizm, rozmawia z bazą, z IndexedDB i z pamięcią urządzenia.
// Panele trybów są PRAWDZIWE - inaczej „przełączanie trybu" dowodziłoby
// wyłącznie tego, że atrapa się przerysowała.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import type { ScannerSession } from "@/lib/events/scannerSession";
import type { ScannerRuntime } from "@/lib/events/useScanner";
import type { OutboxItem } from "@/lib/events/scannerOutbox";
import { axeViolations, summarize } from "@/test/axe";
import { freezeClock } from "@/test/time";

freezeClock();

const h = vi.hoisted(() => ({
  /** Wartości `initialToken`, z jakimi organizm wołał środowisko. */
  initialTokens: [] as (string | null)[],
  readinessActive: [] as boolean[],
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastWarning: vi.fn(),
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

vi.mock("sonner", () => ({
  toast: { success: h.toastSuccess, error: h.toastError, info: vi.fn(), warning: h.toastWarning },
}));

vi.mock("@/lib/events/useScannerReadiness", () => ({
  useScannerReadiness: (active: boolean) => {
    h.readinessActive.push(active);
    return {
      shell: "ready",
      precache: { cached: 1, total: 1 },
      storagePersisted: true,
      persistRequest: null,
      requestPersist: vi.fn(),
    };
  },
}));

// Bramka wydruku jest wołana wprost z panelu identyfikatora; prawdziwy moduł
// RPC ciągnie klienta bazy, którego w teście jednostkowym nie ma po co budzić.
vi.mock("@/lib/events/scannerApi", () => ({
  recordBadgePrintScan: vi.fn(),
}));

// Aparat nie istnieje w happy-dom; bramka i tak pracuje z czytnika sprzętowego.
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

let runtime: ScannerRuntime;

vi.mock("@/lib/events/useScanner", () => ({
  useScannerRuntime: (initialToken: string | null) => {
    h.initialTokens.push(initialToken);
    return runtime;
  },
}));

const { ScannerApp } = await import("@/components/events/scanner/organisms/ScannerApp");

const TOKEN = "nes-scanner-token-0123456789";

function session(over: Partial<ScannerSession> = {}): ScannerSession {
  return {
    deviceId: "d1",
    label: "Recepcja A",
    scopes: ["checkin", "lead", "badge_print"],
    expiresAt: null,
    pinnedCheckpointId: null,
    sponsorId: null,
    offlineRoster: false,
    rosterDownloadedAt: null,
    serverNow: null,
    event: {
      id: "e1",
      slug: "kongres-testowy",
      titlePl: "Kongres testowy",
      titleEn: "Test congress",
      startsAt: null,
      endsAt: null,
      timezone: "Europe/Warsaw",
    },
    checkpoints: [
      {
        id: "c1",
        namePl: "Wejście główne",
        nameEn: "Main entrance",
        kind: "event_entry",
        directionMode: "in_only",
        accessMode: "control",
        capacity: null,
        dedupeWindowSeconds: 0,
        sortOrder: 0,
      },
    ],
    ...over,
  };
}

function outboxItem(over: Partial<OutboxItem> = {}): OutboxItem {
  return {
    id: "o1",
    kind: "checkin",
    code: "TICKET-1",
    checkpointId: "c1",
    direction: "in",
    note: null,
    interestRating: null,
    deviceScannedAt: "2026-09-01T08:00:00.000Z",
    attempts: 1,
    nextAttemptAt: "2026-09-01T08:00:10.000Z",
    lastError: null,
    ...over,
  };
}

function runtimeStub(over: Partial<ScannerRuntime> = {}): ScannerRuntime {
  return {
    status: "ready",
    session: session(),
    token: TOKEN,
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
    sessionStale: false,
    clockOffsetMs: 0,
    clockSkewed: false,
    roster: { enabled: false, generatedAt: null, count: 0, syncing: false },
    syncRoster: vi.fn(),
    rejected: [],
    conflicts: [],
    clearSyncIssues: vi.fn(),
    offlineStoragePersistent: true,
    lastFlush: null,
    submitCheckin: vi.fn(),
    submitLead: vi.fn(),
    ...over,
  };
}

/** Godzin od teraz w postaci znacznika ISO - dla progu „wygasa dziś". */
function inHours(hours: number): string {
  return new Date(Date.now() + hours * 3_600_000).toISOString();
}

function mount(over: Partial<ScannerRuntime> = {}, initialToken: string | null = null) {
  runtime = runtimeStub(over);
  return { ...render(<ScannerApp initialToken={initialToken} />), runtime };
}

function modeTab(mode: string): HTMLElement {
  return screen.getByRole("button", { name: `eventScanner.modes.${mode}` });
}

/** Czytnik kodu - obecny w każdym trybie, nieobecny na ekranach bez skanowania. */
function codeInput(): HTMLElement | null {
  return screen.queryByLabelText("eventScanner.manual.label");
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  h.initialTokens = [];
  h.readinessActive = [];
});

describe("ScannerApp - stan bez poświadczenia", () => {
  it("bez sesji widać PAROWANIE, a nie czytnik", () => {
    mount({ status: "idle", session: null, token: null });

    expect(screen.getByRole("heading", { name: "eventScanner.pairing.title" })).toBeInTheDocument();
    expect(codeInput()).toBeNull();
    expect(screen.queryByText("eventScanner.session.deviceLabel: Recepcja A")).toBeNull();
  });

  it("token z adresu idzie do środowiska - jedno miejsce rozstrzyga, więc jest jeden bootstrap", () => {
    // Gdyby organizm sam czytał pamięć urządzenia obok środowiska, powstałyby
    // dwa wywołania bramki na to samo poświadczenie.
    mount({ status: "connecting", session: null, token: null }, TOKEN);

    expect(h.initialTokens).toContain(TOKEN);
  });

  it("łączenie w toku przechodzi do ekranu parowania jako stan „łączę”", () => {
    mount({ status: "connecting", session: null, token: null });

    expect(screen.getByRole("button", { name: /eventScanner.pairing.connecting/ })).toBeDisabled();
  });

  it("odmowa bramki wraca na ekran parowania razem ze zdaniem dla operatora", () => {
    // Nieudane parowanie wraca do stanu spoczynku (`idle`) i niesie powód
    // w `connectError` - osobnego stanu „błąd" nie ma, bo ekran jest ten sam.
    mount({ status: "idle", session: null, token: null, connectError: "device_revoked" });

    expect(
      screen.getByText("Poświadczenie zostało unieważnione. Poproś organizatora o nowy kod."),
    ).toBeInTheDocument();
  });

  it("wygaśnięcie BEZ sesji to nadal parowanie - nie ma czego pokazać", () => {
    mount({ status: "expired", session: null, token: null });

    expect(screen.getByRole("heading", { name: "eventScanner.pairing.title" })).toBeInTheDocument();
    expect(screen.queryByText("eventScanner.session.expired")).toBeNull();
  });
});

describe("ScannerApp - poświadczenie po terminie", () => {
  it("wygasła sesja pokazuje JEDNO zdanie i odłączenie, bez czytnika", () => {
    mount({ status: "expired", session: session({ expiresAt: inHours(-1) }) });

    expect(screen.getByText("eventScanner.session.expired")).toBeInTheDocument();
    expect(codeInput()).toBeNull();
    expect(screen.queryByRole("button", { name: "eventScanner.modes.checkin" })).toBeNull();
  });

  it("odłączenie z ekranu wygaśnięcia kasuje poświadczenie", () => {
    const view = mount({ status: "expired", session: session({ expiresAt: inHours(-1) }) });

    fireEvent.click(screen.getByRole("button", { name: /eventScanner.session.disconnect/ }));

    expect(view.runtime.disconnect).toHaveBeenCalledTimes(1);
  });
});

describe("ScannerApp - tryby pochodzą z zakresów poświadczenia", () => {
  it("trzy zakresy dają trzy zakładki, a zaczyna ODPRAWA", () => {
    mount();

    expect(modeTab("checkin")).toHaveAttribute("aria-current", "true");
    expect(modeTab("lead")).toHaveAttribute("aria-current", "false");
    expect(modeTab("badge")).toHaveAttribute("aria-current", "false");
    // Ekran odprawy poznajemy po wyborze punktu kontrolnego.
    expect(screen.getByText("eventScanner.checkpoint.label")).toBeInTheDocument();
  });

  it("przełączenie na LEADY zmienia ekran, a nie tylko podświetlenie zakładki", () => {
    mount();

    fireEvent.click(modeTab("lead"));

    expect(modeTab("lead")).toHaveAttribute("aria-current", "true");
    expect(screen.queryByText("eventScanner.checkpoint.label")).toBeNull();
    expect(screen.queryByText("eventScanner.badge.title")).toBeNull();
    // Stoisko partnera przed pierwszym skanem ma sam czytnik - i tyle.
    expect(codeInput()).toBeInTheDocument();
  });

  it("przełączenie na IDENTYFIKATOR otwiera rejestr wydruku", () => {
    mount();

    fireEvent.click(modeTab("badge"));

    expect(screen.getByText("eventScanner.badge.title")).toBeInTheDocument();
    expect(screen.getByText("eventScanner.badge.reasonLabel")).toBeInTheDocument();
    expect(screen.queryByText("eventScanner.checkpoint.label")).toBeNull();
  });

  it("jeden zakres NIE rysuje zakładek - nie ma między czym przełączać", () => {
    mount({ session: session({ scopes: ["lead"] }) });

    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByRole("button", { name: "eventScanner.modes.checkin" })).toBeNull();
    expect(codeInput()).toBeInTheDocument();
  });

  it("poświadczenie stoiska zaczyna od LEADÓW, a nie od odprawy", () => {
    // Kolejność trybów jest stała, ale pierwszy DOSTĘPNY zależy od zakresów.
    mount({ session: session({ scopes: ["lead", "badge_print"] }) });

    expect(screen.queryByText("eventScanner.checkpoint.label")).toBeNull();
    expect(modeTab("lead")).toHaveAttribute("aria-current", "true");
  });

  it("poświadczenie bez żadnego zakresu mówi o tym wprost, zamiast pokazywać pusty ekran", () => {
    mount({ session: session({ scopes: [] }) });

    expect(screen.getByText("eventScanner.errors.deviceScopeMissing")).toBeInTheDocument();
    expect(codeInput()).toBeNull();
  });

  it("tryb, który ZNIKNĄŁ z poświadczenia, przestaje być aktywny", () => {
    // Organizator potrafi odebrać zakres w trakcie zmiany. Bez tego warunku
    // ekran zostałby na zakładce, której każdy skan kończy się odmową.
    const view = mount();
    fireEvent.click(modeTab("badge"));
    expect(screen.getByText("eventScanner.badge.title")).toBeInTheDocument();

    runtime = runtimeStub({ session: session({ scopes: ["checkin"] }) });
    view.rerender(<ScannerApp initialToken={null} />);

    expect(screen.queryByText("eventScanner.badge.title")).toBeNull();
    expect(screen.getByText("eventScanner.checkpoint.label")).toBeInTheDocument();
  });
});

describe("ScannerApp - pasek sesji", () => {
  it("pasek niesie wydarzenie i urządzenie w języku interfejsu", () => {
    mount();

    expect(screen.getByText("Kongres testowy")).toBeInTheDocument();
    expect(screen.getByText("eventScanner.session.deviceLabel: Recepcja A")).toBeInTheDocument();
  });

  it("odłączenie z paska sesji kasuje poświadczenie", () => {
    const view = mount();

    fireEvent.click(screen.getByRole("button", { name: "eventScanner.session.disconnect" }));

    expect(view.runtime.disconnect).toHaveBeenCalledTimes(1);
  });

  it("brak sieci widać w pasku, bo od tego zależy, czy wolno odejść od bramki", () => {
    mount({ online: false });

    expect(screen.getByText("eventScanner.session.offline")).toBeInTheDocument();
  });

  it("kolejka czekających skanów jest liczbą w pasku, nie domysłem", () => {
    mount({
      outboxCounts: { pending: 2, stuck: 0 },
      outbox: [outboxItem(), outboxItem({ id: "o2" })],
    });

    // Liczbę widać w DWÓCH miejscach: w pasku sesji (zawsze na wierzchu)
    // i w panelu kolejki - operator patrzy raz na pasek, raz na listę.
    expect(screen.getAllByText("eventScanner.outbox.pending(count=2)")).toHaveLength(2);
  });

  it("termin ważności bliski końca zmiany mówi o sobie ZANIM wygaśnie", () => {
    mount({ session: session({ expiresAt: inHours(3) }) });

    expect(screen.getByText("eventScanner.session.expiresSoon")).toBeInTheDocument();
  });

  it("odległy termin ważności nie zaśmieca paska", () => {
    mount({ session: session({ expiresAt: inHours(72) }) });

    expect(screen.queryByText("eventScanner.session.expiresSoon")).toBeNull();
  });

  it("brak terminu ważności to brak ostrzeżenia, a nie ostrzeżenie na zapas", () => {
    mount({ session: session({ expiresAt: null }) });

    expect(screen.queryByText("eventScanner.session.expiresSoon")).toBeNull();
  });
});

describe("ScannerApp - kolejka skanów", () => {
  it("pusta i trwała kolejka NIE zajmuje miejsca na ekranie", () => {
    mount();

    expect(screen.queryByRole("heading", { name: "eventScanner.outbox.title" })).toBeNull();
  });

  it("niepusta kolejka jest widoczna razem z liczbą czekających", () => {
    mount({ outbox: [outboxItem()], outboxCounts: { pending: 1, stuck: 0 } });

    expect(screen.getByRole("heading", { name: "eventScanner.outbox.title" })).toBeInTheDocument();
  });

  it("kolejka, która NIE PRZEŻYJE zamknięcia karty, pokazuje się nawet pusta", () => {
    // Prywatne okno bez IndexedDB. Ostrzeżenie musi wisieć ZANIM operator
    // zeskanuje pierwszy bilet, a nie dopiero razem z pierwszą stratą.
    mount({ outboxPersistent: false });

    expect(screen.getByText("eventScanner.session.memoryOnly")).toBeInTheDocument();
  });
});

describe("ScannerApp - dostępność", () => {
  it("ekran z trzema trybami i kolejką nie ma naruszeń axe", async () => {
    const { container } = mount({
      outbox: [outboxItem({ attempts: 8, lastError: "invalid_payload" })],
      outboxCounts: { pending: 0, stuck: 1 },
      session: session({ expiresAt: inHours(2) }),
    });

    expect(await axeViolations(container).then(summarize)).toBe("");
  });

  it("ekran parowania i ekran wygaśnięcia nie mają naruszeń axe", async () => {
    const pairing = mount({ status: "idle", session: null, token: null });
    expect(await axeViolations(pairing.container).then(summarize)).toBe("");

    cleanup();
    const expired = mount({ status: "expired", session: session({ expiresAt: inHours(-1) }) });
    expect(await axeViolations(expired.container).then(summarize)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// DEFEKT. Test poniżej opisuje zachowanie, którego organizm NIE MA - i dlatego
// jest `it.fails`. Zieleń znaczy, że defekt zniknął i test trzeba przepiąć
// na zwykłe `it`.
// ---------------------------------------------------------------------------
describe("ScannerApp - defekty", () => {
  it.fails("stopka ze skrótem wydarzenia nie wkłada bloku do akapitu", () => {
    // `ScannerApp.tsx` zamyka ekran w `<p>...<Badge/></p>`, a `Badge` renderuje
    // `<div>`. To jest niepoprawny HTML: React zgłasza przy każdym renderze
    // ekranu bramki „<div> cannot be a descendant of <p>", a parser przeglądarki
    // zamyka akapit PRZED plakietką, więc drzewo w dokumencie różni się od tego,
    // które React uważa za swoje. Koszt jest podwójny: błąd w konsoli przy
    // KAŻDYM skanie zagłusza błędy prawdziwe, a każde późniejsze włączenie
    // renderu serwerowego tej trasy zamienia to w błąd hydracji.
    // Naprawa to jeden znak: `<p>` -> `<div>` (albo plakietka bez `div`).
    mount();

    const slug = screen.getByText("kongres-testowy");
    expect(slug.closest("p")).toBeNull();
  });
});

/* ------------------------------------------------------ tryb offline --- */
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW:
//   * lista do wyjaśnienia (konflikty, odrzucone) znika razem z sesją - po
//     unieważnieniu poświadczenia operator nie ma jak oddać pliku;
//   * wygasłe poświadczenie z kolejką nie mówi, że skany jeszcze się wysyłają
//     (okno 72 h), więc wolontariusz odłącza urządzenie i traci kolejkę;
//   * brak sieci z listą offline świeci się na czerwono;
//   * wynik wysyłki kolejki (konflikty, odrzucone) nie dociera do operatora.
describe("ScannerApp - tryb offline", () => {
  const conflict = {
    id: "scan-1",
    kind: "admitted_offline" as const,
    checkinId: "k1",
    checkpointId: "c1",
    direction: "in" as const,
    deviceScannedAt: "2026-09-26T08:00:00.000Z",
    offlineOutcome: "granted" as const,
    serverOutcome: "denied_not_registered",
    personName: "Anna",
    registrationId: "r1",
    detectedAt: "2026-09-26T09:00:00.000Z",
  };

  it("pasek sesji mówi o liście offline, a bez sieci z listą pigułka NIE jest alarmem", () => {
    mount({
      online: false,
      roster: { enabled: true, generatedAt: new Date().toISOString(), count: 12, syncing: false },
    });
    expect(screen.getByText("eventScanner.session.offlineReady")).toBeInTheDocument();
    expect(screen.getByText(/eventScanner\.offline\.rosterFresh\(count=12/)).toBeInTheDocument();
  });

  it("odświeżenie listy z paska woła synchronizację środowiska", () => {
    const view = mount({
      roster: { enabled: true, generatedAt: null, count: 0, syncing: false },
    });
    fireEvent.click(screen.getByRole("button", { name: "eventScanner.offline.refresh" }));
    expect(view.runtime.syncRoster).toHaveBeenCalledTimes(1);
  });

  it("karta gotowości stoi przy ODPRAWIE i sprawdza gotowość tylko przy potwierdzonej sesji", () => {
    mount();
    expect(screen.getByText("eventScanner.readiness.title")).toBeInTheDocument();
    expect(h.readinessActive.at(-1)).toBe(true);
    cleanup();
    mount({ sessionStale: true });
    expect(h.readinessActive.at(-1)).toBe(false);
    cleanup();
    mount({ session: session({ scopes: ["lead"] }) });
    expect(screen.queryByText("eventScanner.readiness.title")).toBeNull();
  });

  it("lista do wyjaśnienia widać przy działającej sesji", () => {
    mount({ conflicts: [conflict] });
    expect(screen.getByText("eventScanner.sync.title")).toBeInTheDocument();
  });

  it("lista do wyjaśnienia ZOSTAJE na ekranie parowania po utracie poświadczenia", () => {
    mount({
      status: "idle",
      session: null,
      token: null,
      rejected: [
        {
          item: outboxItem(),
          error: "device_revoked: revoked",
          rejectedAt: "2026-09-26T09:00:00.000Z",
        },
      ],
    });
    expect(screen.getByRole("heading", { name: "eventScanner.pairing.title" })).toBeInTheDocument();
    expect(screen.getByText("eventScanner.sync.title")).toBeInTheDocument();
  });

  it("wygasłe poświadczenie z kolejką mówi, że skany jeszcze się wysyłają, i pokazuje kolejkę", () => {
    mount({
      status: "expired",
      session: session({ expiresAt: inHours(-1) }),
      outbox: [outboxItem()],
      outboxCounts: { pending: 1, stuck: 0 },
      conflicts: [conflict],
    });
    expect(screen.getByText("eventScanner.session.expiredSyncing")).toBeInTheDocument();
    expect(screen.getByText("eventScanner.outbox.title")).toBeInTheDocument();
    expect(screen.getByText("eventScanner.sync.title")).toBeInTheDocument();
  });

  it("wygasłe poświadczenie bez kolejki nie obiecuje wysyłki", () => {
    mount({ status: "expired", session: session({ expiresAt: inHours(-1) }) });
    expect(screen.queryByText("eventScanner.session.expiredSyncing")).toBeNull();
    expect(screen.queryByText("eventScanner.sync.title")).toBeNull();
  });

  it("wynik wysyłki kolejki: wysłane, konflikty i odrzucone mają osobne komunikaty", () => {
    mount({ lastFlush: { sent: 3, conflicts: 1, rejected: 2, seq: 1 } });
    expect(h.toastSuccess).toHaveBeenCalledWith("eventScanner.outbox.flushedToast(count=3)");
    expect(h.toastWarning).toHaveBeenCalledWith("eventScanner.sync.flushedConflicts(count=1)");
    expect(h.toastError).toHaveBeenCalledWith("eventScanner.sync.flushedRejected(count=2)");
  });

  it("wysyłka bez sukcesów i bez problemów nie hałasuje", () => {
    mount({ lastFlush: { sent: 0, conflicts: 0, rejected: 0, seq: 1 } });
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(h.toastWarning).not.toHaveBeenCalled();
    expect(h.toastError).not.toHaveBeenCalled();
  });
});
