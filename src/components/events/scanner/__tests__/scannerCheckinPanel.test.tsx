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

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params === undefined ? key : `${key}(${JSON.stringify(params)})`,
    i18n: { language: "pl", exists: () => true, changeLanguage: () => Promise.resolve() },
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
