// Molekuły trybu offline skanera: pasek listy offline, karta gotowości,
// lista do wyjaśnienia (konflikty i odrzucone) oraz nowe stany atomu łączności.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. OPERATOR NIE WIE, NA CZYM STOI. Pasek listy offline ma cztery stany
//      (wyłączona, brak, świeża, nieświeża) - pomylenie „brak" ze „świeża"
//      znaczy decyzje z listy, której nie ma.
//   2. KARTA GOTOWOŚCI KŁAMIE: „aplikacja zapisana" przy częściowym cache
//      albo brak przycisku trwałego przechowywania, gdy przeglądarka go wymaga.
//   3. ODRZUCONE SKANY ZNIKAJĄ BEZ PLIKU: eksport CSV/JSON nie zawiera obu
//      list albo czyszczenie działa bez potwierdzenia.
//   4. STAN „BEZ SIECI Z LISTĄ" wygląda jak alarm (czerwony) - wolontariusz
//      przestaje ufać zielonemu wynikowi.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { freezeClock } from "@/test/time";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import type { RejectedScan } from "@/lib/events/scannerOutbox";
import type { ScanConflict } from "@/lib/events/scannerSyncIssues";
import type { ScannerReadiness } from "@/lib/events/useScannerReadiness";
import type { ScannerRosterInfo } from "@/lib/events/useScanner";
import { axeViolations, summarize } from "@/test/axe";

freezeClock();

const h = vi.hoisted(() => ({
  confirm: vi.fn(async (_opts: unknown) => true),
  downloads: [] as Array<{ name: string; mime: string; data: string }>,
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/appDialogs", () => ({ confirmDialog: h.confirm }));
vi.mock("@/lib/events/scannerSyncIssues", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events/scannerSyncIssues")>()),
  downloadTextFile: (name: string, mime: string, data: string) => {
    h.downloads.push({ name, mime, data });
  },
}));

const { ScannerOfflineBar } = await import("@/components/events/scanner/molecules/ScannerOfflineBar");
const { ScannerReadinessCard } =
  await import("@/components/events/scanner/molecules/ScannerReadinessCard");
const { ScannerSyncIssuesPanel } =
  await import("@/components/events/scanner/molecules/ScannerSyncIssuesPanel");
const { ScannerStatusPill } = await import("@/components/events/scanner/atoms/ScannerStatusPill");

const TZ = "Europe/Warsaw";

function roster(over: Partial<ScannerRosterInfo> = {}): ScannerRosterInfo {
  return {
    enabled: true,
    generatedAt: "2026-09-26T07:12:00.000Z",
    count: 1234,
    syncing: false,
    ...over,
  };
}

function bar(props: Partial<Parameters<typeof ScannerOfflineBar>[0]> = {}) {
  const onRefresh = vi.fn();
  const view = render(
    <ScannerOfflineBar
      roster={roster()}
      state="fresh"
      timezone={TZ}
      online
      sessionStale={false}
      clockOffsetMs={0}
      clockSkewed={false}
      onRefresh={onRefresh}
      {...props}
    />,
  );
  return { ...view, onRefresh };
}

function readiness(over: Partial<ScannerReadiness> = {}): ScannerReadiness {
  return {
    shell: "ready",
    precache: { cached: 12, total: 12 },
    storagePersisted: true,
    persistRequest: null,
    requestPersist: vi.fn(),
    ...over,
  };
}

function conflict(over: Partial<ScanConflict> = {}): ScanConflict {
  return {
    id: "scan-1",
    kind: "admitted_offline",
    checkinId: "k1",
    checkpointId: "c1",
    direction: "in",
    deviceScannedAt: "2026-09-26T08:00:00.000Z",
    offlineOutcome: "granted",
    serverOutcome: "denied_not_registered",
    personName: "Anna Kowalska",
    registrationId: "r1",
    detectedAt: "2026-09-26T09:00:00.000Z",
    ...over,
  };
}

function rejectedScan(over: Partial<RejectedScan> = {}): RejectedScan {
  return {
    item: {
      id: "scan-9",
      kind: "checkin",
      code: "QR-ODRZUCONY",
      checkpointId: "c1",
      direction: "in",
      note: null,
      interestRating: null,
      deviceScannedAt: "2026-09-26T08:30:00.000Z",
      attempts: 0,
      nextAttemptAt: "2026-09-26T08:30:00.000Z",
      lastError: null,
    },
    error: "device_revoked: revoked",
    rejectedAt: "2026-09-26T09:00:00.000Z",
    ...over,
  };
}

beforeEach(() => {
  cleanup();
  h.confirm.mockReset();
  h.confirm.mockResolvedValue(true);
  h.downloads = [];
});

describe("ScannerOfflineBar - stan listy offline w pasku sesji", () => {
  it("świeża lista mówi ile osób i z kiedy (w strefie wydarzenia)", () => {
    bar();
    expect(
      screen.getByText("eventScanner.offline.rosterFresh(count=1234,time=26 września 2026 09:12)"),
    ).toBeInTheDocument();
  });

  it("nieświeża lista ostrzega i nadal podaje liczbę", () => {
    bar({ state: "stale" });
    expect(screen.getByText(/eventScanner\.offline\.rosterStale\(count=1234/)).toBeInTheDocument();
  });

  it("brak listy mówi, że pobierze się po połączeniu - albo że właśnie się pobiera", () => {
    bar({ state: "none", roster: roster({ generatedAt: null, count: 0 }) });
    expect(screen.getByText("eventScanner.offline.rosterNone")).toBeInTheDocument();
    cleanup();
    bar({ state: "none", roster: roster({ generatedAt: null, syncing: true }) });
    expect(screen.getByText("eventScanner.offline.rosterSyncing")).toBeInTheDocument();
  });

  it("lista wyłączona przez organizatora nie ma przycisku odświeżenia", () => {
    bar({ state: "disabled", roster: roster({ enabled: false, generatedAt: null }) });
    expect(screen.getByText("eventScanner.offline.rosterDisabled")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("odświeżenie przy sieci woła synchronizację; w trakcie jest wyłączone", () => {
    const { onRefresh } = bar();
    fireEvent.click(screen.getByRole("button", { name: "eventScanner.offline.refresh" }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    cleanup();
    bar({ roster: roster({ syncing: true }) });
    expect(screen.getByRole("button", { name: "eventScanner.offline.refresh" })).toBeDisabled();
  });

  it("bez sieci nie ma czego odświeżać", () => {
    bar({ online: false });
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("sesja z pamięci urządzenia jest nazwana wprost", () => {
    bar({ sessionStale: true });
    expect(screen.getByText("eventScanner.session.staleSession")).toBeInTheDocument();
  });

  it("rozjechany zegar ostrzega w minutach, zaokrąglonych i co najmniej jednej", () => {
    bar({ clockSkewed: true, clockOffsetMs: -185_000 });
    expect(screen.getByText("eventScanner.session.clockSkew(count=3)")).toBeInTheDocument();
    cleanup();
    bar({ clockSkewed: true, clockOffsetMs: 20_000 });
    expect(screen.getByText("eventScanner.session.clockSkew(count=1)")).toBeInTheDocument();
    cleanup();
    bar();
    expect(screen.queryByText(/clockSkew/)).toBeNull();
  });
});

describe("ScannerReadinessCard - gotowość do pracy bez sieci", () => {
  function card(r: ScannerReadiness, rosterState: "fresh" | "stale" | "none" | "disabled" = "fresh", queuePersistent = true) {
    return render(
      <ScannerReadinessCard readiness={r} rosterState={rosterState} queuePersistent={queuePersistent} />,
    );
  }

  it("wszystko gotowe: cztery zielone warunki, bez przycisku", () => {
    card(readiness());
    expect(screen.getByText("eventScanner.readiness.shellReady")).toBeInTheDocument();
    expect(screen.getByText("eventScanner.readiness.rosterReady")).toBeInTheDocument();
    expect(screen.getByText("eventScanner.readiness.queuePersistent")).toBeInTheDocument();
    expect(screen.getByText("eventScanner.readiness.storagePersisted")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("powłoka: częściowa z liczbami, sprawdzana, brakująca", () => {
    card(readiness({ shell: "partial", precache: { cached: 3, total: 9 } }));
    expect(screen.getByText("eventScanner.readiness.shellPartial(cached=3,total=9)")).toBeInTheDocument();
    cleanup();
    card(readiness({ shell: "partial", precache: null }));
    expect(screen.getByText("eventScanner.readiness.shellPartial(cached=0,total=0)")).toBeInTheDocument();
    cleanup();
    card(readiness({ shell: "checking", precache: null }));
    expect(screen.getByText("eventScanner.readiness.shellChecking")).toBeInTheDocument();
    cleanup();
    card(readiness({ shell: "missing", precache: null }));
    expect(screen.getByText("eventScanner.readiness.shellMissing")).toBeInTheDocument();
  });

  it("lista: wyłączona i nieaktualna mówią różne rzeczy", () => {
    card(readiness(), "disabled");
    expect(screen.getByText("eventScanner.readiness.rosterDisabled")).toBeInTheDocument();
    cleanup();
    card(readiness(), "stale");
    expect(screen.getByText("eventScanner.readiness.rosterNotReady")).toBeInTheDocument();
  });

  it("kolejka tylko w pamięci karty jest ostrzeżeniem", () => {
    card(readiness(), "fresh", false);
    expect(screen.getByText("eventScanner.readiness.queueMemoryOnly")).toBeInTheDocument();
  });

  it("brak trwałego przechowywania daje przycisk prośby, a wynik prośby jest ogłaszany", () => {
    const r = readiness({ storagePersisted: false });
    card(r);
    expect(screen.getByText("eventScanner.readiness.storageNotPersisted")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "eventScanner.readiness.requestPersist" }));
    expect(r.requestPersist).toHaveBeenCalledTimes(1);
    cleanup();
    card(readiness({ storagePersisted: false, persistRequest: false }));
    expect(screen.getByRole("status")).toHaveTextContent("eventScanner.readiness.persistDenied");
    cleanup();
    card(readiness({ persistRequest: true }));
    expect(screen.getByRole("status")).toHaveTextContent("eventScanner.readiness.persistGranted");
  });

  it("przeglądarka bez API przechowywania mówi „nie wiadomo” i nie oferuje przycisku", () => {
    card(readiness({ storagePersisted: null }));
    expect(screen.getByText("eventScanner.readiness.storageUnknown")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("karta nie ma naruszeń dostępności", async () => {
    const { container } = card(readiness({ storagePersisted: false, shell: "missing" }), "none", false);
    expect(summarize(await axeViolations(container))).toBe("");
  });
});

describe("ScannerSyncIssuesPanel - konflikty i odrzucone skany", () => {
  function panel(conflicts: ScanConflict[] = [conflict()], rejected: RejectedScan[] = [rejectedScan()]) {
    const onClear = vi.fn();
    const view = render(
      <ScannerSyncIssuesPanel
        conflicts={conflicts}
        rejected={rejected}
        timezone={TZ}
        deviceLabel="Brama 1"
        eventSlug="kongres"
        onClear={onClear}
      />,
    );
    return { ...view, onClear };
  }

  it("konflikt pokazuje kierunek rozbieżności, osobę i oba wyniki", () => {
    panel();
    expect(screen.getByText("eventScanner.sync.conflicts(count=1)")).toBeInTheDocument();
    expect(screen.getByText("eventScanner.sync.kinds.admittedOffline")).toBeInTheDocument();
    expect(
      screen.getByText(/Anna Kowalska · .* · eventScanner\.outcomes\.granted → eventScanner\.outcomes\.deniedNotRegistered/),
    ).toBeInTheDocument();
  });

  it("konflikt odwrotny i bez nazwiska nie rysuje pustego separatora", () => {
    panel([conflict({ kind: "denied_offline", personName: null })], []);
    expect(screen.getByText("eventScanner.sync.kinds.deniedOffline")).toBeInTheDocument();
    expect(screen.queryByText(/^ · /)).toBeNull();
    expect(screen.queryByText(/eventScanner\.sync\.rejected/)).toBeNull();
  });

  it("odrzucony skan pokazuje kod, czas i zdanie odmowy bazy", () => {
    panel([], [rejectedScan()]);
    const row = screen.getByText("QR-ODRZUCONY").closest("li") as HTMLElement;
    expect(within(row).getByText("Poświadczenie zostało unieważnione. Poproś organizatora o nowy kod.")).toBeInTheDocument();
    expect(screen.queryByText(/eventScanner\.sync\.conflicts/)).toBeNull();
  });

  it("CSV niesie obie listy z nagłówkiem w języku operatora", () => {
    panel();
    fireEvent.click(screen.getByRole("button", { name: "eventScanner.sync.exportCsv" }));
    expect(h.downloads).toHaveLength(1);
    const [file] = h.downloads;
    expect(file.name).toMatch(/^skaner-kongres-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(file.mime).toBe("text/csv;charset=utf-8");
    expect(file.data).toContain("eventScanner.sync.columns.type");
    expect(file.data).toContain("eventScanner.sync.columns.conflict,admitted_offline");
    expect(file.data).toContain("QR-ODRZUCONY");
  });

  it("JSON niesie urządzenie i wydarzenie", () => {
    panel();
    fireEvent.click(screen.getByRole("button", { name: "eventScanner.sync.exportJson" }));
    const parsed = JSON.parse(h.downloads[0].data) as Record<string, unknown>;
    expect(parsed).toMatchObject({ deviceLabel: "Brama 1", eventSlug: "kongres" });
    expect(h.downloads[0].mime).toBe("application/json");
  });

  it("czyszczenie wymaga potwierdzenia - odmowa nie kasuje niczego", async () => {
    const { onClear } = panel();
    h.confirm.mockResolvedValue(false);
    fireEvent.click(screen.getByRole("button", { name: "eventScanner.sync.clear" }));
    await vi.waitFor(() => expect(h.confirm).toHaveBeenCalledTimes(1));
    expect(onClear).not.toHaveBeenCalled();

    h.confirm.mockResolvedValue(true);
    fireEvent.click(screen.getByRole("button", { name: "eventScanner.sync.clear" }));
    await vi.waitFor(() => expect(onClear).toHaveBeenCalledTimes(1));
    expect(h.confirm).toHaveBeenLastCalledWith(
      expect.objectContaining({ destructive: true, title: "eventScanner.sync.clearTitle" }),
    );
  });

  it("panel nie ma naruszeń dostępności", async () => {
    const { container } = panel();
    expect(summarize(await axeViolations(container))).toBe("");
  });
});

describe("ScannerStatusPill - stany trybu offline", () => {
  it("bez sieci Z LISTĄ offline to NIE alarm - skaner nadal decyduje", () => {
    render(<ScannerStatusPill online={false} pending={3} syncing={false} offlineReady />);
    expect(screen.getByText("eventScanner.session.offlineReady")).toBeInTheDocument();
    expect(screen.queryByText("eventScanner.session.offline")).toBeNull();
  });

  it("sesja z pamięci przy sieci i pustej kolejce ma własny napis", () => {
    render(<ScannerStatusPill online pending={0} syncing={false} sessionStale />);
    expect(screen.getByText("eventScanner.session.staleBadge")).toBeInTheDocument();
  });

  it("czekające skany mają pierwszeństwo przed napisem o sesji z pamięci", () => {
    render(<ScannerStatusPill online pending={2} syncing sessionStale />);
    expect(screen.getByText("eventScanner.outbox.pending(count=2)")).toBeInTheDocument();
  });
});
