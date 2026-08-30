// Bramka wejscia: to, co po zepsuciu zatrzymuje kolejke stu osob.
//
// PANEL DOSTAJE SRODOWISKO W PROPSIE, wiec test podaje mu wprost atrape -
// bez atrapy sieci, bez atrapy IndexedDB i bez zegara. Sprawdzamy cztery
// rzeczy, ktore decyduja o wpuszczeniu czlowieka:
// 1. wynik skanu zostaje NA EKRANIE, nie w znikajacym powiadomieniu,
// 2. odmowa niesie POWOD, a przy biletach z innego wydarzenia - jego nazwe,
// 3. brak sieci mowi „w kolejce", a nie „blad",
// 4. przypiety punkt kontrolny nie daje wyboru, ktorego baza i tak odrzuci.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { CheckinScanResult } from "@/lib/events/scannerApi";
import type { ScannerSession } from "@/lib/events/scannerSession";
import type { ScannerRuntime } from "@/lib/events/useScanner";

// `istniejaceKlucze` jest sterowalne, bo panel wybiera podpowiedz pod wynikiem
// po ISTNIENIU klucza w slowniku - wynik bez wlasnej podpowiedzi ma pokazac
// sam naglowek, a nie surowy klucz.
const h = vi.hoisted(() => ({ istniejaceKlucze: true }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params === undefined ? key : `${key}(${JSON.stringify(params)})`,
    i18n: {
      language: "pl",
      exists: () => h.istniejaceKlucze,
      changeLanguage: () => Promise.resolve(),
    },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// Aparat nie istnieje w happy-dom; czytnik i tak ma dzialac z klawiatury.
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

const { ScannerCheckinPanel } =
  await import("@/components/events/scanner/organisms/ScannerCheckinPanel");

const SESSION: ScannerSession = {
  deviceId: "d1",
  label: "Recepcja",
  scopes: ["checkin"],
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
  checkpoints: [
    {
      id: "c1",
      namePl: "Wejscie glowne",
      nameEn: "Main entrance",
      kind: "event_entry",
      directionMode: "in_out",
      accessMode: "control",
      capacity: null,
      dedupeWindowSeconds: 0,
      sortOrder: 1,
    },
    {
      id: "c2",
      namePl: "Sala B",
      nameEn: "Room B",
      kind: "room",
      directionMode: "in_only",
      accessMode: "track",
      capacity: 100,
      dedupeWindowSeconds: 0,
      sortOrder: 2,
    },
  ],
};

function outcome(over: Partial<CheckinScanResult>): CheckinScanResult {
  return {
    outcome: "granted",
    admit: true,
    result: "granted",
    checkinId: "k1",
    direction: "in",
    occurredAt: "2026-09-01T08:00:00Z",
    repeatCount: 0,
    previousCheckinAt: null,
    deviceLocked: false,
    checkpoint: {
      id: "c1",
      namePl: "Wejscie glowne",
      nameEn: "Main entrance",
      kind: "event_entry",
      directionMode: "in_out",
      accessMode: "control",
      capacity: null,
      occupancy: 12,
    },
    person: null,
    otherEventTitlePl: null,
    otherEventTitleEn: null,
    ...over,
  };
}

function runtimeStub(over: Partial<ScannerRuntime>): ScannerRuntime {
  return {
    status: "ready",
    session: SESSION,
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
    submitCheckin: vi.fn().mockResolvedValue({ queued: false, result: outcome({}) }),
    submitLead: vi.fn(),
    ...over,
  };
}

function scan(code: string) {
  const input = screen.getByLabelText("eventScanner.manual.label");
  fireEvent.change(input, { target: { value: code } });
  fireEvent.submit(input.closest("form") as HTMLFormElement);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.istniejaceKlucze = true;
});

describe("ScannerCheckinPanel", () => {
  it("wynik skanu zostaje na ekranie, a nie w powiadomieniu", async () => {
    const runtime = runtimeStub({});
    render(<ScannerCheckinPanel runtime={runtime} session={SESSION} />);
    scan("QR-1");
    expect(await screen.findByText("eventScanner.outcomes.granted")).toBeInTheDocument();
    expect(runtime.submitCheckin).toHaveBeenCalledWith({
      code: "QR-1",
      checkpointId: "c1",
      direction: "in",
    });
  });

  it("bilet z innego wydarzenia niesie NAZWE tamtego wydarzenia", async () => {
    const runtime = runtimeStub({
      submitCheckin: vi.fn().mockResolvedValue({
        queued: false,
        result: outcome({
          outcome: "wrong_event",
          admit: false,
          result: null,
          otherEventTitlePl: "Forum Energetyczne",
        }),
      }),
    });
    render(<ScannerCheckinPanel runtime={runtime} session={SESSION} />);
    scan("QR-2");
    expect(await screen.findByText("eventScanner.outcomes.wrongEvent")).toBeInTheDocument();
    expect(
      screen.getByText(/eventScanner.outcomeHints.wrongEvent.*Forum Energetyczne/),
    ).toBeInTheDocument();
  });

  it("brak sieci mowi „w kolejce”, a nie „blad”", async () => {
    const runtime = runtimeStub({
      online: false,
      submitCheckin: vi.fn().mockResolvedValue({ queued: true }),
    });
    render(<ScannerCheckinPanel runtime={runtime} session={SESSION} />);
    scan("QR-3");
    expect(await screen.findByText("eventScanner.outcomes.saved")).toBeInTheDocument();
    expect(screen.getByText("eventScanner.errors.offline")).toBeInTheDocument();
  });

  it("odmowa poswiadczenia laduje jako komunikat, nie jako pusty ekran", async () => {
    const runtime = runtimeStub({
      submitCheckin: vi.fn().mockRejectedValue(new Error("device_locked: cooling down")),
    });
    render(<ScannerCheckinPanel runtime={runtime} session={SESSION} />);
    scan("QR-4");
    await waitFor(() =>
      expect(screen.getByText("eventScanner.outcomes.unknown")).toBeInTheDocument(),
    );
  });

  it("przypiety punkt NIE daje wyboru - baza i tak odmowilaby zmiany", () => {
    const pinned: ScannerSession = { ...SESSION, pinnedCheckpointId: "c2" };
    render(<ScannerCheckinPanel runtime={runtimeStub({ session: pinned })} session={pinned} />);
    expect(screen.getByText("eventScanner.checkpoint.pinned")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Wejscie glowne" })).not.toBeInTheDocument();
  });

  it("punkt jednokierunkowy nie pokazuje przelacznika kierunku", () => {
    const pinned: ScannerSession = { ...SESSION, pinnedCheckpointId: "c2" };
    render(<ScannerCheckinPanel runtime={runtimeStub({ session: pinned })} session={pinned} />);
    expect(screen.queryByText("eventScanner.directions.label")).not.toBeInTheDocument();
  });
});

/* ------------------------------- kolor wyniku, punkt i kierunek na ekranie --- */

// TRZY KOLORY MAJA TRZY ZNACZENIA i operator patrzy na nie z metra, przez
// ramie, w sloncu. Zielony to „wpusc", czerwony „nie wpuszczaj", bursztynowy
// „to nie jest odmowa, ale przeczytaj". Pomylenie bursztynu z czerwienia przy
// powtornym skanie zawraca od bramki czlowieka, ktory ma prawo wejsc.
describe("ScannerCheckinPanel - kolor wyniku niesie decyzje", () => {
  /** Pas wyniku - jedyny element o roli `status` na tym ekranie. */
  function pas(): HTMLElement {
    return screen.getAllByRole("status")[0];
  }

  it("POWTORNY skan z prawem wejscia jest BURSZTYNOWY, a nie zielony i nie czerwony", async () => {
    // `repeat` przy `admit === true` to drugie pikniecie w oknie deduplikacji
    // punktu: czlowiek juz jest w srodku i ma wejsc dalej.
    const runtime = runtimeStub({
      submitCheckin: vi.fn().mockResolvedValue({
        queued: false,
        result: outcome({ outcome: "repeat", admit: true, result: "repeat", repeatCount: 2 }),
      }),
    });
    render(<ScannerCheckinPanel runtime={runtime} session={SESSION} />);
    scan("QR-REPEAT");

    await screen.findByText("eventScanner.outcomes.repeat");
    expect(pas().className).toContain("amber");
    expect(pas().className).not.toContain("emerald");
  });

  it("ODMOWA jest CZERWONA - to nie jest ostrzezenie", async () => {
    const runtime = runtimeStub({
      submitCheckin: vi.fn().mockResolvedValue({
        queued: false,
        result: outcome({
          outcome: "denied_registration_status",
          admit: false,
          result: "denied_registration_status",
        }),
      }),
    });
    render(<ScannerCheckinPanel runtime={runtime} session={SESSION} />);
    scan("QR-DENIED");

    await screen.findByText("eventScanner.outcomes.deniedRegistrationStatus");
    expect(pas().className).toContain("destructive");
  });

  it("KOD NIEZNANY jest BURSZTYNOWY - zle piknieta kartka to nie jest odmowa wejscia", async () => {
    const runtime = runtimeStub({
      submitCheckin: vi.fn().mockResolvedValue({
        queued: false,
        result: outcome({ outcome: "unknown_code", admit: false, result: null }),
      }),
    });
    render(<ScannerCheckinPanel runtime={runtime} session={SESSION} />);
    scan("QR-NIEZNANY");

    await screen.findByText("eventScanner.outcomes.unknownCode");
    expect(pas().className).toContain("amber");
  });

  it("wynik BEZ wlasnej podpowiedzi w slowniku pokazuje sam naglowek, a nie surowy klucz", async () => {
    h.istniejaceKlucze = false;
    const runtime = runtimeStub({});
    render(<ScannerCheckinPanel runtime={runtime} session={SESSION} />);
    scan("QR-BEZ-PODPOWIEDZI");

    await screen.findByText("eventScanner.outcomes.granted");
    expect(screen.queryByText(/eventScanner\.outcomeHints\.granted/)).not.toBeInTheDocument();
  });

  it("BLOKADA urzadzenia po serii pomylek jest KRZYCZANA osobno, nie chowana w wyniku", async () => {
    const { toast } = await import("sonner");
    const runtime = runtimeStub({
      submitCheckin: vi.fn().mockResolvedValue({
        queued: false,
        result: outcome({ outcome: "unknown_code", admit: false, deviceLocked: true }),
      }),
    });
    render(<ScannerCheckinPanel runtime={runtime} session={SESSION} />);
    scan("QR-PO-SERII");

    await screen.findByText("eventScanner.outcomes.unknownCode");
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it("POPRZEDNIA odprawa i ZAJETOSC punktu stoja pod wynikiem - to sa liczby decyzji", async () => {
    const runtime = runtimeStub({
      submitCheckin: vi.fn().mockResolvedValue({
        queued: false,
        result: outcome({
          outcome: "repeat",
          admit: true,
          previousCheckinAt: "2026-09-01T07:40:00Z",
          person: {
            personId: "p1",
            firstName: "Zofia",
            lastName: "Testowa",
            company: null,
            jobTitle: null,
            registrationId: null,
            registrationStatus: "approved",
            ticketNamePl: null,
            ticketNameEn: null,
            groupNamePl: null,
            groupNameEn: null,
            groupColor: null,
            badgePrinted: false,
            badgePrintedAt: null,
            badgePrintedVersion: null,
          },
        }),
      }),
    });
    render(<ScannerCheckinPanel runtime={runtime} session={SESSION} />);
    scan("QR-POWTORKA");

    await screen.findByText("eventScanner.outcomes.repeat");
    expect(screen.getByText(/eventScanner\.outcomeHints\.previousCheckin/)).toBeInTheDocument();
    expect(screen.getByText(/eventScanner\.checkpoint\.occupancy/)).toBeInTheDocument();
    // Tozsamosc rozpoznanej osoby - operator porownuje ja z twarza przy bramce.
    expect(screen.getByText(/Zofia/)).toBeInTheDocument();
  });

  it("brak zajetosci w odpowiedzi NIE rysuje pustego wiersza z licznikiem", async () => {
    const runtime = runtimeStub({
      submitCheckin: vi.fn().mockResolvedValue({
        queued: false,
        result: outcome({
          checkpoint: {
            id: "c1",
            namePl: "Wejscie glowne",
            nameEn: "Main entrance",
            kind: "event_entry",
            directionMode: "in_out",
            accessMode: "control",
            capacity: null,
            occupancy: null,
          },
        }),
      }),
    });
    render(<ScannerCheckinPanel runtime={runtime} session={SESSION} />);
    scan("QR-BEZ-ZAJETOSCI");

    await screen.findByText("eventScanner.outcomes.granted");
    expect(screen.queryByText(/eventScanner\.checkpoint\.occupancy/)).not.toBeInTheDocument();
  });
});

describe("ScannerCheckinPanel - wybor punktu i kierunku", () => {
  it("ZMIANA PUNKTU jedzie do bazy - operator przeszedl z bramy do sali", async () => {
    const runtime = runtimeStub({});
    render(<ScannerCheckinPanel runtime={runtime} session={SESSION} />);

    fireEvent.click(screen.getByRole("button", { name: "Sala B" }));
    scan("QR-SALA-B");
    await screen.findByText("eventScanner.outcomes.granted");

    expect(runtime.submitCheckin).toHaveBeenCalledWith({
      code: "QR-SALA-B",
      checkpointId: "c2",
      direction: "in",
    });
  });

  it("WYJSCIE wybrane recznie jedzie do bazy jako kierunek `out`", async () => {
    const runtime = runtimeStub({});
    render(<ScannerCheckinPanel runtime={runtime} session={SESSION} />);

    fireEvent.click(screen.getByRole("button", { name: "eventScanner.directions.out" }));
    scan("QR-WYJSCIE");
    await screen.findByText("eventScanner.outcomes.granted");

    expect(runtime.submitCheckin).toHaveBeenCalledWith({
      code: "QR-WYJSCIE",
      checkpointId: "c1",
      direction: "out",
    });
  });

  it("PRZEJSCIE do punktu jednokierunkowego sciaga „wyjscie” z powrotem na „wejscie”", async () => {
    // Bez tego sciagniecia panel wyslalby `out` do punktu `in_only`, a baza
    // odmowilaby - przy bramce wyglada to jak zepsuty czytnik.
    const runtime = runtimeStub({});
    render(<ScannerCheckinPanel runtime={runtime} session={SESSION} />);

    fireEvent.click(screen.getByRole("button", { name: "eventScanner.directions.out" }));
    fireEvent.click(screen.getByRole("button", { name: "Sala B" }));
    scan("QR-PO-ZMIANIE");
    await screen.findByText("eventScanner.outcomes.granted");

    expect(runtime.submitCheckin).toHaveBeenCalledWith({
      code: "QR-PO-ZMIANIE",
      checkpointId: "c2",
      direction: "in",
    });
  });

  it("punkt z OKNEM DEDUPLIKACJI i POJEMNOSCIA opisuje sie operatorowi", () => {
    const zOknem: ScannerSession = {
      ...SESSION,
      pinnedCheckpointId: "c3",
      checkpoints: [
        {
          id: "c3",
          namePl: "Katering",
          nameEn: "Catering",
          kind: "catering",
          directionMode: "in_only",
          accessMode: "track",
          capacity: 250,
          dedupeWindowSeconds: 60,
          sortOrder: 1,
        },
      ],
    };
    render(<ScannerCheckinPanel runtime={runtimeStub({ session: zOknem })} session={zOknem} />);

    expect(screen.getByText("eventScanner.checkpoint.trackMode")).toBeInTheDocument();
    expect(screen.getByText(/eventScanner\.checkpoint\.capacity/)).toBeInTheDocument();
    expect(screen.getByText(/eventScanner\.checkpoint\.dedupeWindow/)).toBeInTheDocument();
  });

  it("POSWIADCZENIE BEZ PUNKTOW mowi o tym wprost i BLOKUJE czytnik", () => {
    // Skan bez punktu konczy sie odmowa bazy i podnosi licznik pomylek
    // urzadzenia - po serii takich prob bramka blokuje sie sama.
    const bezPunktow: ScannerSession = { ...SESSION, checkpoints: [] };
    render(
      <ScannerCheckinPanel runtime={runtimeStub({ session: bezPunktow })} session={bezPunktow} />,
    );

    expect(screen.getByText("eventScanner.checkpoint.none")).toBeInTheDocument();
    expect(screen.getByLabelText("eventScanner.manual.label")).toBeDisabled();
  });
});
