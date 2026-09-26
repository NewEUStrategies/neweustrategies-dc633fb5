// Środowisko uruchomieniowe skanera - TRYB OFFLINE (20260926150000).
//
// Uzupełnia `useScanner.test.tsx` (kolejka, poświadczenie, sieć) o to, co
// dołożył tryb offline. Atrapy: API bramki i obie pamięci urządzenia w RAM;
// skrót SHA-256 liczy PRAWDZIWY moduł (WebCrypto środowiska testowego).
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. ZIMNY START W HALI. Otwarcie skanera bez zasięgu (albo z portalem
//      Wi-Fi, który trzyma żądanie) kończy się ekranem parowania, choć sesja
//      jest na urządzeniu - bramka stoi.
//   2. SESJA CUDZEGO TOKENU podniesiona z pamięci po wklejeniu nowego kodu.
//   3. DECYZJA OFFLINE bez listy albo z listy innego urządzenia; zgoda nie
//      trafia do dziennika zgód, więc podwójne piknięcie bez sieci wpuszcza
//      „drugi raz".
//   4. KONFLIKT I ODRZUCENIE po synchronizacji giną w próżni.
//   5. COFNIĘTA ZGODA na listę offline nie usuwa listy osób z telefonu.
//   6. ZEGAR telefonu przesunięty o minuty - czas skanu w dzienniku jest
//      nieskorygowany, a operator nie dostaje ostrzeżenia.
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, waitFor } from "@testing-library/react";

import { renderHookWithQueryClient } from "@/test/renderWithQueryClient";
import { FIXED_NOW, freezeClock, relativeIso } from "@/test/time";
import type {
  CheckinScanInput,
  CheckinScanResult,
  LeadScanInput,
  LeadScanResult,
  RosterPageInput,
} from "@/lib/events/scannerApi";
import type { OutboxItem, RejectedScan } from "@/lib/events/scannerOutbox";
import type { CachedSession } from "@/lib/events/scannerOfflineStorage";
import type {
  LocalDecisionLogEntry,
  RosterEntry,
  RosterPage,
  RosterSnapshot,
} from "@/lib/events/scannerRoster";
import type { ScanConflict } from "@/lib/events/scannerSyncIssues";
import type { ScannerSession } from "@/lib/events/scannerSession";

freezeClock();

const api = vi.hoisted(() => ({
  bootstrapScanner: vi.fn<(token: string) => Promise<ScannerSession>>(),
  recordCheckinScan: vi.fn<(input: CheckinScanInput) => Promise<CheckinScanResult>>(),
  recordLeadScan: vi.fn<(input: LeadScanInput) => Promise<LeadScanResult>>(),
  fetchScannerRoster: vi.fn<(input: RosterPageInput) => Promise<RosterPage>>(),
  withDeadline: vi.fn(<T,>(promise: Promise<T>, _ms: number): Promise<T> => promise),
}));
vi.mock("@/lib/events/scannerApi", () => api);

const device = vi.hoisted(() => ({
  token: null as string | null,
  queue: [] as OutboxItem[],
}));
vi.mock("@/lib/events/scannerStorage", () => ({
  readStoredToken: () => device.token,
  writeStoredToken: (token: string) => {
    device.token = token;
  },
  clearStoredToken: () => {
    device.token = null;
  },
  isOutboxPersistent: () => true,
  loadOutbox: () => Promise.resolve([...device.queue]),
  saveOutbox: (queue: readonly OutboxItem[]) => {
    device.queue = [...queue];
    return Promise.resolve();
  },
}));

const store = vi.hoisted(() => ({
  session: null as CachedSession | null,
  roster: null as RosterSnapshot | null,
  /** Odczyt listy wstrzymany przez test (wyścig z odłączeniem). */
  rosterGate: null as Promise<RosterSnapshot | null> | null,
  log: [] as LocalDecisionLogEntry[],
  rejected: [] as RejectedScan[],
  conflicts: [] as ScanConflict[],
  persistent: true,
  wipes: 0,
  rosterWipes: 0,
  clears: 0,
}));
vi.mock("@/lib/events/scannerOfflineStorage", () => ({
  isOfflineStoragePersistent: () => store.persistent,
  saveCachedSession: (value: CachedSession) => {
    store.session = value;
    return Promise.resolve();
  },
  loadCachedSession: (hash: string) =>
    Promise.resolve(store.session?.tokenHash === hash ? store.session : null),
  saveRoster: (snapshot: RosterSnapshot | null) => {
    store.roster = snapshot;
    return Promise.resolve();
  },
  loadRoster: (deviceId: string) =>
    store.rosterGate ?? Promise.resolve(store.roster?.deviceId === deviceId ? store.roster : null),
  saveDecisionLog: (log: LocalDecisionLogEntry[]) => {
    store.log = [...log];
    return Promise.resolve();
  },
  loadDecisionLog: () => Promise.resolve([...store.log]),
  saveRejected: (list: RejectedScan[]) => {
    store.rejected = [...list];
    return Promise.resolve();
  },
  loadRejected: () => Promise.resolve([...store.rejected]),
  saveConflicts: (list: ScanConflict[]) => {
    store.conflicts = [...list];
    return Promise.resolve();
  },
  loadConflicts: () => Promise.resolve([...store.conflicts]),
  wipeOfflineSession: () => {
    store.session = null;
    store.roster = null;
    store.log = [];
    store.wipes += 1;
    return Promise.resolve();
  },
  wipeRoster: () => {
    store.roster = null;
    store.log = [];
    store.rosterWipes += 1;
    return Promise.resolve();
  },
  clearSyncIssues: () => {
    store.rejected = [];
    store.conflicts = [];
    store.clears += 1;
    return Promise.resolve();
  },
}));

const { useScannerRuntime } = await import("@/lib/events/useScanner");

/* ------------------------------------------------------------ fixture'y --- */

const TOKEN = "SCN-abcdefghijklmnopqrstuvwxyz01";
const OTHER_TOKEN = "SCN-zyxwvutsrqponmlkjihgfedcba99";
const CP = "11111111-1111-4111-8111-111111111111";
const CODE = "QR-OLGA-000000000000000000000001";

const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

function session(over: Partial<ScannerSession> = {}): ScannerSession {
  return {
    deviceId: "dev-1",
    label: "Brama 1",
    scopes: ["checkin", "lead"],
    expiresAt: relativeIso(24 * 3_600_000),
    pinnedCheckpointId: null,
    sponsorId: null,
    offlineRoster: true,
    rosterDownloadedAt: null,
    serverNow: null,
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
        id: CP,
        namePl: "Brama",
        nameEn: "Gate",
        kind: "event_entry",
        directionMode: "in_out",
        accessMode: "control",
        capacity: null,
        dedupeWindowSeconds: 60,
        sortOrder: 0,
      },
    ],
    ...over,
  };
}

function entry(over: Partial<RosterEntry> = {}): RosterEntry {
  return {
    registrationId: "r-olga",
    hash: sha(CODE),
    status: "approved",
    firstName: "Olga",
    lastName: "Obecna",
    company: null,
    ticketNamePl: null,
    ticketNameEn: null,
    groupNamePl: null,
    groupNameEn: null,
    groupColor: null,
    badgePrinted: false,
    ...over,
  };
}

function page(over: Partial<RosterPage> = {}): RosterPage {
  return {
    generatedAt: relativeIso(-60_000),
    full: true,
    total: 1,
    nextAfter: null,
    rows: [entry()],
    removed: [],
    ...over,
  };
}

function scanResult(over: Partial<CheckinScanResult> = {}): CheckinScanResult {
  return {
    outcome: "granted",
    admit: true,
    result: "granted",
    checkinId: "k1",
    direction: "in",
    occurredAt: null,
    repeatCount: 0,
    previousCheckinAt: null,
    deviceLocked: false,
    checkpoint: {
      id: CP,
      namePl: null,
      nameEn: null,
      kind: null,
      directionMode: null,
      accessMode: "control",
      capacity: null,
      occupancy: null,
    },
    person: null,
    otherEventTitlePl: null,
    otherEventTitleEn: null,
    ...over,
  };
}

function queued(over: Partial<OutboxItem> = {}): OutboxItem {
  return {
    id: "scan-q1",
    kind: "checkin",
    code: CODE,
    checkpointId: CP,
    direction: "in",
    note: null,
    interestRating: null,
    deviceScannedAt: relativeIso(-600_000),
    attempts: 0,
    nextAttemptAt: relativeIso(-600_000),
    lastError: null,
    offlineAdmitted: true,
    offlineOutcome: "granted",
    rosterGeneratedAt: relativeIso(-3_600_000),
    ...over,
  };
}

function cached(tokenValue: string, over: Partial<CachedSession> = {}): CachedSession {
  return {
    tokenHash: sha(tokenValue),
    session: session(),
    serverOffsetMs: 0,
    savedAt: relativeIso(-3_600_000),
    ...over,
  };
}

/* ------------------------------------------------------------ narzędzia --- */

let offline = false;

function goOffline(): void {
  offline = true;
  act(() => {
    window.dispatchEvent(new Event("offline"));
  });
}

function goOnline(): void {
  offline = false;
  act(() => {
    window.dispatchEvent(new Event("online"));
  });
}

function render(initialToken: string | null = TOKEN) {
  return renderHookWithQueryClient(() => useScannerRuntime(initialToken));
}

/** Sparowane urządzenie z pobraną listą offline (jedna osoba: Olga). */
async function withRoster(over: Partial<ScannerSession> = {}) {
  api.bootstrapScanner.mockResolvedValue(session(over));
  api.fetchScannerRoster.mockResolvedValue(page());
  const view = render();
  await waitFor(() => expect(view.result.current.roster.count).toBe(1));
  return view;
}

beforeEach(() => {
  vi.clearAllMocks();
  api.withDeadline.mockImplementation(<T,>(promise: Promise<T>) => promise);
  device.token = null;
  device.queue = [];
  store.session = null;
  store.roster = null;
  store.rosterGate = null;
  store.log = [];
  store.rejected = [];
  store.conflicts = [];
  store.persistent = true;
  store.wipes = 0;
  store.rosterWipes = 0;
  store.clears = 0;
  offline = false;
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    get: () => !offline,
  });
});

/* ------------------------------------------------------- zimny start --- */

describe("zimny start i sesja z pamięci urządzenia", () => {
  it("udane połączenie zapisuje sesję pod SKRÓTEM tokenu, bez tokenu", async () => {
    api.bootstrapScanner.mockResolvedValue(session({ offlineRoster: false }));
    const { result } = render();
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await waitFor(() => expect(store.session).not.toBeNull());
    expect(store.session?.tokenHash).toBe(sha(TOKEN));
    expect(JSON.stringify(store.session)).not.toContain(TOKEN);
    expect(result.current.sessionStale).toBe(false);
  });

  it("BEZ SIECI sesja wraca z pamięci od razu, bez wołania bazy", async () => {
    store.session = cached(TOKEN);
    offline = true;
    const { result } = render();
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.sessionStale).toBe(true);
    expect(api.bootstrapScanner).not.toHaveBeenCalled();
  });

  it("bez sieci i bez sesji w pamięci próbuje bazy i wraca do parowania ze zdaniem", async () => {
    offline = true;
    api.bootstrapScanner.mockRejectedValue(new TypeError("Failed to fetch"));
    const { result } = render();
    await waitFor(() => expect(result.current.connectError).toBe("Failed to fetch"));
    expect(result.current.status).toBe("idle");
  });

  it("sesja z pamięci należy do INNEGO tokenu - nie otwiera cudzego wydarzenia", async () => {
    store.session = cached(OTHER_TOKEN);
    api.bootstrapScanner.mockRejectedValue(new TypeError("Failed to fetch"));
    const { result } = render();
    await waitFor(() => expect(result.current.connectError).toBe("Failed to fetch"));
    expect(result.current.session).toBeNull();
  });

  it("AWARIA SIECI (albo termin żądania) przy połączeniu podnosi sesję z pamięci", async () => {
    store.session = cached(TOKEN, { serverOffsetMs: 4000 });
    api.bootstrapScanner.mockRejectedValue(new Error("Scanner request timed out"));
    const { result } = render();
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.sessionStale).toBe(true);
    expect(result.current.clockOffsetMs).toBe(4000);
  });

  it("odmowa NAZWANA przez bazę (nie sieć) nie podnosi sesji z pamięci", async () => {
    store.session = cached(TOKEN);
    api.bootstrapScanner.mockRejectedValue(new Error("device_locked: cooling down"));
    const { result } = render();
    await waitFor(() => expect(result.current.connectError).toContain("device_locked"));
    expect(result.current.status).toBe("idle");
  });

  it("sesja z pamięci jest potwierdzana w bazie, gdy sieć jest - i przestaje być „z pamięci”", async () => {
    store.session = cached(TOKEN);
    offline = true;
    const { result } = render();
    await waitFor(() => expect(result.current.sessionStale).toBe(true));

    api.bootstrapScanner.mockResolvedValue(session({ offlineRoster: false, label: "Świeża" }));
    goOnline();
    await waitFor(() => expect(result.current.sessionStale).toBe(false));
    expect(result.current.session?.label).toBe("Świeża");
  });

  it("nieudane potwierdzenie przez sieć zostawia sesję z pamięci", async () => {
    store.session = cached(TOKEN);
    offline = true;
    const { result } = render();
    await waitFor(() => expect(result.current.sessionStale).toBe(true));

    api.bootstrapScanner.mockRejectedValue(new TypeError("Failed to fetch"));
    goOnline();
    await waitFor(() => expect(api.bootstrapScanner).toHaveBeenCalled());
    await act(async () => {});
    expect(result.current.status).toBe("ready");
    expect(result.current.sessionStale).toBe(true);
  });

  it("potwierdzenie z odmową unieważniającą wyrzuca do parowania i czyści dane", async () => {
    store.session = cached(TOKEN);
    offline = true;
    const { result } = render();
    await waitFor(() => expect(result.current.sessionStale).toBe(true));

    api.bootstrapScanner.mockRejectedValue(new Error("device_revoked: revoked"));
    goOnline();
    await waitFor(() => expect(result.current.status).toBe("idle"));
    expect(device.token).toBeNull();
    expect(store.wipes).toBeGreaterThan(0);
  });

  it("wygasłe poświadczenie z sesją w pamięci to ekran „wygasło”, a nie parowanie", async () => {
    store.session = cached(TOKEN);
    api.bootstrapScanner.mockRejectedValue(new Error("device_expired: past expiry"));
    const { result } = render();
    await waitFor(() => expect(result.current.status).toBe("expired"));
    expect(result.current.session?.deviceId).toBe("dev-1");
    // Lista osób nie zostaje na wygasłym urządzeniu.
    await waitFor(() => expect(store.rosterWipes).toBeGreaterThan(0));
  });

  it("wygasłe poświadczenie BEZ sesji w pamięci kończy się parowaniem", async () => {
    api.bootstrapScanner.mockRejectedValue(new Error("device_expired: past expiry"));
    const { result } = render();
    await waitFor(() => expect(result.current.connectError).toContain("device_expired"));
    expect(result.current.status).toBe("idle");
  });

  it("zegar serwera daje przesunięcie zegara urządzenia i ostrzeżenie przy dużej odchyłce", async () => {
    api.bootstrapScanner.mockResolvedValue(
      session({
        offlineRoster: false,
        serverNow: new Date(FIXED_NOW.getTime() + 300_000).toISOString(),
      }),
    );
    const { result } = render();
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.clockOffsetMs).toBe(300_000);
    expect(result.current.clockSkewed).toBe(true);
  });

  it("odłączenie kasuje sesję i listę z urządzenia", async () => {
    const { result } = await withRoster();
    act(() => result.current.disconnect());
    expect(result.current.status).toBe("idle");
    expect(result.current.roster.count).toBe(0);
    expect(store.wipes).toBe(1);
  });

  it("pamięć trybu offline tylko w karcie jest widoczna dla ekranu", async () => {
    store.persistent = false;
    api.bootstrapScanner.mockResolvedValue(session({ offlineRoster: false }));
    const { result } = render();
    await waitFor(() => expect(result.current.offlineStoragePersistent).toBe(false));
  });
});

/* ------------------------------------------------------ lista offline --- */

describe("lista offline", () => {
  it("urządzenie ze zgodą pobiera PEŁNĄ listę po połączeniu i zapisuje ją", async () => {
    const { result } = await withRoster();
    expect(api.fetchScannerRoster).toHaveBeenCalledWith({ deviceToken: TOKEN, after: undefined });
    expect(result.current.roster).toMatchObject({ enabled: true, count: 1, syncing: false });
    expect(store.roster?.deviceId).toBe("dev-1");
  });

  it("lista w pamięci jest bazą PRZYROSTU zamiast pełnego pobrania", async () => {
    store.roster = { deviceId: "dev-1", generatedAt: "v-stara", rows: [entry()] };
    api.bootstrapScanner.mockResolvedValue(session());
    api.fetchScannerRoster.mockResolvedValue(
      page({ full: false, generatedAt: "v-nowa", rows: [] }),
    );
    const { result } = render();
    await waitFor(() => expect(result.current.roster.generatedAt).toBe("v-nowa"));
    expect(api.fetchScannerRoster).toHaveBeenCalledWith({
      deviceToken: TOKEN,
      since: "v-stara",
      after: undefined,
    });
    expect(result.current.roster.count).toBe(1);
  });

  it("urządzenie BEZ zgody nie pobiera listy osób", async () => {
    api.bootstrapScanner.mockResolvedValue(session({ offlineRoster: false }));
    const { result } = render();
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await act(async () => {});
    expect(api.fetchScannerRoster).not.toHaveBeenCalled();
    expect(result.current.roster.enabled).toBe(false);
  });

  it("cofnięta zgoda (`roster_disabled`) usuwa listę z telefonu i wyłącza tryb", async () => {
    const { result } = await withRoster();
    api.fetchScannerRoster.mockRejectedValue(new Error("roster_disabled: off"));
    act(() => result.current.syncRoster());
    await waitFor(() => expect(result.current.roster.enabled).toBe(false));
    expect(result.current.roster.count).toBe(0);
    expect(store.rosterWipes).toBeGreaterThan(0);
  });

  it("dławik i awaria sieci zostawiają poprzednią listę", async () => {
    const { result } = await withRoster();
    api.fetchScannerRoster.mockRejectedValue(new Error("roster_throttled: wait"));
    act(() => result.current.syncRoster());
    await waitFor(() => expect(result.current.roster.syncing).toBe(false));
    expect(result.current.roster.count).toBe(1);
  });

  it("unieważnione poświadczenie przy pobieraniu listy wyrzuca do parowania", async () => {
    const { result } = await withRoster();
    api.fetchScannerRoster.mockRejectedValue(new Error("device_revoked: gone"));
    act(() => result.current.syncRoster());
    await waitFor(() => expect(result.current.status).toBe("idle"));
    expect(store.wipes).toBeGreaterThan(0);
  });

  it("wygasłe poświadczenie przy pobieraniu listy to „wygasło”, a lista znika", async () => {
    const { result } = await withRoster();
    api.fetchScannerRoster.mockRejectedValue(new Error("device_expired: past"));
    act(() => result.current.syncRoster());
    await waitFor(() => expect(result.current.status).toBe("expired"));
    await waitFor(() => expect(result.current.roster.count).toBe(0));
  });

  it("bez sieci, w trakcie pobierania i bez sesji ręczne odświeżenie nic nie robi", async () => {
    const { result } = await withRoster();
    const calls = api.fetchScannerRoster.mock.calls.length;
    goOffline();
    act(() => result.current.syncRoster());
    expect(api.fetchScannerRoster).toHaveBeenCalledTimes(calls);

    goOnline();
    await waitFor(() => expect(result.current.roster.syncing).toBe(false));
    let finish: (value: RosterPage) => void = () => undefined;
    api.fetchScannerRoster.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    act(() => result.current.syncRoster());
    const inFlight = api.fetchScannerRoster.mock.calls.length;
    act(() => result.current.syncRoster());
    expect(api.fetchScannerRoster).toHaveBeenCalledTimes(inFlight);
    await act(async () => finish(page()));

    act(() => result.current.disconnect());
    act(() => result.current.syncRoster());
    expect(api.fetchScannerRoster).toHaveBeenCalledTimes(inFlight);
  });

  it("lista pobrana dla urządzenia, które w międzyczasie ODŁĄCZONO, nie jest zapisywana", async () => {
    let finish: (value: RosterPage) => void = () => undefined;
    api.bootstrapScanner.mockResolvedValue(session());
    api.fetchScannerRoster.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const { result } = render();
    await waitFor(() => expect(result.current.roster.syncing).toBe(true));
    act(() => result.current.disconnect());
    await act(async () => finish(page()));
    expect(result.current.roster.count).toBe(0);
    expect(store.roster).toBeNull();
  });

  it("lista wczytana z pamięci PO odłączeniu nie wraca na ekran", async () => {
    let release: (value: RosterSnapshot | null) => void = () => undefined;
    store.rosterGate = new Promise((resolve) => (release = resolve));
    api.bootstrapScanner.mockResolvedValue(session());
    const { result } = render();
    await waitFor(() => expect(result.current.status).toBe("ready"));
    act(() => result.current.disconnect());
    await act(async () => release({ deviceId: "dev-1", generatedAt: "v1", rows: [entry()] }));
    expect(result.current.roster.count).toBe(0);
    expect(api.fetchScannerRoster).not.toHaveBeenCalled();
  });

  it("odmowa listy dla urządzenia, które w międzyczasie ODŁĄCZONO, niczego nie zmienia", async () => {
    let fail: (error: Error) => void = () => undefined;
    api.bootstrapScanner.mockResolvedValue(session());
    api.fetchScannerRoster.mockReturnValue(new Promise((_resolve, reject) => (fail = reject)));
    const { result } = render();
    await waitFor(() => expect(result.current.roster.syncing).toBe(true));
    act(() => result.current.disconnect());
    const wipes = store.wipes;
    await act(async () => fail(new Error("device_revoked: gone")));
    expect(result.current.connectError).toBeNull();
    expect(store.wipes).toBe(wipes);
  });

  it("domyślnie (bez argumentu) środowisko bierze token z pamięci urządzenia", async () => {
    device.token = TOKEN;
    api.bootstrapScanner.mockResolvedValue(session({ offlineRoster: false }));
    const { result } = renderHookWithQueryClient(() => useScannerRuntime());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(api.bootstrapScanner).toHaveBeenCalledWith(TOKEN);
  });

  it("przełączenie na poświadczenie BEZ zgody usuwa listę poprzedniego urządzenia", async () => {
    const { result } = await withRoster();
    api.bootstrapScanner.mockResolvedValue(session({ deviceId: "dev-2", offlineRoster: false }));
    act(() => result.current.connect(OTHER_TOKEN));
    await waitFor(() => expect(result.current.session?.deviceId).toBe("dev-2"));
    await waitFor(() => expect(result.current.roster.count).toBe(0));
    expect(store.rosterWipes).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------- decyzja offline --- */

describe("skan bez sieci z listą offline", () => {
  it("bilet z listy dostaje ZGODĘ offline, która jedzie do kolejki z decyzją", async () => {
    const { result } = await withRoster();
    goOffline();
    let outcome: Awaited<ReturnType<typeof result.current.submitCheckin>> | undefined;
    await act(async () => {
      outcome = await result.current.submitCheckin({
        code: CODE,
        checkpointId: CP,
        direction: "in",
      });
    });
    if (outcome === undefined || !outcome.queued)
      throw new Error("test: skan nie trafił do kolejki");
    expect(outcome.local).toMatchObject({ outcome: "granted", admit: true });
    expect(outcome.local?.entry?.firstName).toBe("Olga");
    expect(result.current.outbox[0]).toMatchObject({
      offlineAdmitted: true,
      offlineOutcome: "granted",
      rosterGeneratedAt: page().generatedAt,
    });
    expect(store.log).toHaveLength(1);
  });

  it("drugie piknięcie w oknie punktu to „już odprawiony”, a nie druga zgoda", async () => {
    const { result } = await withRoster();
    goOffline();
    await act(async () => {
      await result.current.submitCheckin({ code: CODE, checkpointId: CP, direction: "in" });
    });
    let second: Awaited<ReturnType<typeof result.current.submitCheckin>> | undefined;
    await act(async () => {
      second = await result.current.submitCheckin({
        code: CODE,
        checkpointId: CP,
        direction: "in",
      });
    });
    expect(second).toMatchObject({ queued: true, local: { outcome: "repeat", admit: true } });
    expect(store.log).toHaveLength(1);
  });

  it("kod spoza listy to odmowa offline (spacje z czytnika nie zmieniają skrótu)", async () => {
    const { result } = await withRoster();
    goOffline();
    let known: Awaited<ReturnType<typeof result.current.submitCheckin>> | undefined;
    let unknown: Awaited<ReturnType<typeof result.current.submitCheckin>> | undefined;
    await act(async () => {
      known = await result.current.submitCheckin({
        code: `  ${CODE} `,
        checkpointId: CP,
        direction: "out",
      });
      unknown = await result.current.submitCheckin({
        code: "QR-OBCY",
        checkpointId: CP,
        direction: "in",
      });
    });
    expect(known).toMatchObject({ local: { outcome: "granted" } });
    expect(unknown).toMatchObject({
      local: { outcome: "unknown_code", admit: false, entry: null },
    });
    expect(result.current.outbox.at(-1)).toMatchObject({
      offlineAdmitted: false,
      offlineOutcome: "unknown_code",
    });
  });

  it("punkt spoza sesji albo brak listy - skan tylko czeka w kolejce, bez decyzji", async () => {
    const { result } = await withRoster();
    goOffline();
    let outcome: Awaited<ReturnType<typeof result.current.submitCheckin>> | undefined;
    await act(async () => {
      outcome = await result.current.submitCheckin({
        code: CODE,
        checkpointId: "inny",
        direction: "in",
      });
    });
    expect(outcome).toEqual({ queued: true, local: null });
    expect(result.current.outbox[0].offlineOutcome).toBeUndefined();
  });

  it("przekroczony termin żądania przy sieci też idzie ścieżką offline", async () => {
    const { result } = await withRoster();
    api.recordCheckinScan.mockReturnValue(new Promise(() => undefined));
    api.withDeadline.mockImplementation(() =>
      Promise.reject(new Error("Scanner request timed out")),
    );
    let outcome: Awaited<ReturnType<typeof result.current.submitCheckin>> | undefined;
    await act(async () => {
      outcome = await result.current.submitCheckin({
        code: CODE,
        checkpointId: CP,
        direction: "in",
      });
    });
    expect(outcome).toMatchObject({ queued: true, local: { outcome: "granted" } });
  });

  it("zgoda ONLINE trafia do dziennika zgód - piknięcie po utracie sieci to „już odprawiony”", async () => {
    const { result } = await withRoster();
    api.recordCheckinScan.mockResolvedValue(
      scanResult({ person: { ...personCard(), registrationId: "r-olga" } }),
    );
    await act(async () => {
      await result.current.submitCheckin({ code: CODE, checkpointId: CP, direction: "in" });
    });
    expect(store.log).toEqual([
      { checkpointId: CP, registrationId: "r-olga", direction: "in", at: FIXED_NOW.toISOString() },
    ]);
    goOffline();
    let outcome: Awaited<ReturnType<typeof result.current.submitCheckin>> | undefined;
    await act(async () => {
      outcome = await result.current.submitCheckin({
        code: CODE,
        checkpointId: CP,
        direction: "in",
      });
    });
    expect(outcome).toMatchObject({ local: { outcome: "repeat" } });
  });

  it("odmowa online albo odpowiedź bez osoby NIE trafia do dziennika zgód", async () => {
    const { result } = await withRoster();
    api.recordCheckinScan.mockResolvedValueOnce(
      scanResult({ result: "denied_capacity", admit: false }),
    );
    api.recordCheckinScan.mockResolvedValueOnce(scanResult({ person: null }));
    api.recordCheckinScan.mockResolvedValueOnce(
      scanResult({
        person: { ...personCard(), registrationId: "r-olga" },
        checkpoint: { ...scanResult().checkpoint, id: null },
        direction: null,
      }),
    );
    await act(async () => {
      await result.current.submitCheckin({ code: CODE, checkpointId: CP, direction: "in" });
      await result.current.submitCheckin({ code: CODE, checkpointId: CP, direction: "in" });
      await result.current.submitCheckin({ code: CODE, checkpointId: CP, direction: "in" });
    });
    expect(store.log).toEqual([]);
  });

  it("zgoda online na urządzeniu BEZ listy nie zapisuje dziennika zgód", async () => {
    api.bootstrapScanner.mockResolvedValue(session({ offlineRoster: false }));
    api.recordCheckinScan.mockResolvedValue(
      scanResult({ person: { ...personCard(), registrationId: "r-olga" }, direction: null }),
    );
    const { result } = render();
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await act(async () => {
      await result.current.submitCheckin({ code: CODE, checkpointId: CP, direction: "in" });
    });
    expect(store.log).toEqual([]);
  });

  it("czas skanu jest korygowany przesunięciem zegara z bazy", async () => {
    api.bootstrapScanner.mockResolvedValue(
      session({
        offlineRoster: false,
        serverNow: new Date(FIXED_NOW.getTime() + 120_000).toISOString(),
      }),
    );
    api.recordCheckinScan.mockResolvedValue(scanResult());
    api.recordLeadScan.mockResolvedValue(leadResult());
    const { result } = render();
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await act(async () => {
      await result.current.submitCheckin({ code: CODE, checkpointId: CP, direction: "in" });
      await result.current.submitLead({ code: CODE, note: null, interestRating: null });
    });
    const skew = new Date(FIXED_NOW.getTime() + 120_000).toISOString();
    expect(api.recordCheckinScan.mock.calls[0][0].deviceScannedAt).toBe(skew);
    expect(api.recordLeadScan.mock.calls[0][0].deviceScannedAt).toBe(skew);
  });
});

function personCard() {
  return {
    personId: "p1",
    firstName: "Olga",
    lastName: "Obecna",
    company: null,
    jobTitle: null,
    registrationId: null,
    registrationStatus: "attended",
    ticketNamePl: null,
    ticketNameEn: null,
    groupNamePl: null,
    groupNameEn: null,
    groupColor: null,
    badgePrinted: false,
    badgePrintedAt: null,
    badgePrintedVersion: null,
  };
}

function leadResult(): LeadScanResult {
  return {
    outcome: "saved",
    leadId: "l1",
    scanCount: 1,
    consent: false,
    deviceLocked: false,
    person: null,
  };
}

describe("odmowa poświadczenia przy skanie na żywo", () => {
  it("unieważnione poświadczenie przy odprawie: błąd do operatora I lista znika z telefonu", async () => {
    const { result } = await withRoster();
    api.recordCheckinScan.mockRejectedValue(new Error("device_revoked: gone"));
    let caught: unknown;
    await act(async () => {
      await result.current
        .submitCheckin({ code: CODE, checkpointId: CP, direction: "in" })
        .catch((error: unknown) => {
          caught = error;
        });
    });
    expect(String(caught)).toContain("device_revoked");
    expect(result.current.status).toBe("idle");
    expect(result.current.roster.count).toBe(0);
    expect(store.wipes).toBeGreaterThan(0);
  });

  it("wygasłe poświadczenie przy leadzie: ekran „wygasło”, kolejka zostaje do wysyłki", async () => {
    api.bootstrapScanner.mockResolvedValue(session({ offlineRoster: false }));
    api.recordLeadScan.mockRejectedValue(new Error("device_expired: past"));
    const { result } = render();
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await act(async () => {
      await result.current
        .submitLead({ code: CODE, note: null, interestRating: null })
        .catch(() => undefined);
    });
    expect(result.current.status).toBe("expired");
    expect(device.token).toBe(TOKEN);
  });
});

/* ------------------------------------------------------- synchronizacja --- */

describe("wysyłka kolejki: konflikty i odrzucone", () => {
  it("wpuszczony offline, baza odmawia - konflikt trafia na trwałą listę i do raportu", async () => {
    device.queue = [queued()];
    api.bootstrapScanner.mockResolvedValue(session({ offlineRoster: false }));
    api.recordCheckinScan.mockResolvedValue(
      scanResult({
        outcome: "denied_not_registered",
        admit: false,
        result: "denied_not_registered",
      }),
    );
    const { result } = render();
    await waitFor(() => expect(result.current.conflicts).toHaveLength(1));
    expect(api.recordCheckinScan.mock.calls[0][0]).toMatchObject({
      queued: true,
      offlineAdmitted: true,
      offlineOutcome: "granted",
      rosterGeneratedAt: queued().rosterGeneratedAt,
    });
    expect(result.current.conflicts[0]).toMatchObject({ id: "scan-q1", kind: "admitted_offline" });
    expect(store.conflicts).toHaveLength(1);
    await waitFor(() =>
      expect(result.current.lastFlush).toEqual({ sent: 1, conflicts: 1, rejected: 0, seq: 1 }),
    );
  });

  it("zgodna decyzja nie jest konfliktem; lead z kolejki też się wysyła", async () => {
    device.queue = [
      queued(),
      queued({ id: "lead-1", kind: "lead", checkpointId: null, direction: null }),
    ];
    api.bootstrapScanner.mockResolvedValue(session({ offlineRoster: false }));
    api.recordCheckinScan.mockResolvedValue(scanResult());
    api.recordLeadScan.mockResolvedValue(leadResult());
    const { result } = render();
    await waitFor(() => expect(result.current.lastFlush?.sent).toBe(2));
    expect(result.current.conflicts).toEqual([]);
    expect(result.current.outbox).toEqual([]);
  });

  it("skan sprzed tygodnia (trwała odmowa) idzie na listę odrzuconych, reszta leci dalej", async () => {
    device.queue = [
      queued({ id: "stary", deviceScannedAt: relativeIso(-700_000) }),
      queued({ id: "nowy", deviceScannedAt: relativeIso(-600_000) }),
    ];
    api.bootstrapScanner.mockResolvedValue(session({ offlineRoster: false }));
    api.recordCheckinScan
      .mockRejectedValueOnce(new Error("device_time_out_of_range: too old"))
      .mockResolvedValueOnce(scanResult());
    const { result } = render();
    await waitFor(() => expect(result.current.lastFlush).not.toBeNull());
    expect(result.current.rejected.map((row) => row.item.id)).toEqual(["stary"]);
    expect(result.current.lastFlush).toMatchObject({ sent: 1, rejected: 1 });
    expect(result.current.outbox).toEqual([]);
  });

  it("awaria sieci przy wysyłce NIE jest odrzuceniem - pozycja czeka dalej", async () => {
    device.queue = [queued()];
    api.bootstrapScanner.mockResolvedValue(session({ offlineRoster: false }));
    api.recordCheckinScan.mockRejectedValue(new TypeError("Failed to fetch"));
    const { result } = render();
    await waitFor(() => expect(result.current.outbox[0]?.attempts).toBe(1));
    expect(result.current.rejected).toEqual([]);
    expect(result.current.lastFlush).toBeNull();
  });

  it("unieważnione poświadczenie: cała kolejka odrzucona, powrót do parowania", async () => {
    device.queue = [queued({ id: "a" }), queued({ id: "b" })];
    api.bootstrapScanner.mockResolvedValue(session({ offlineRoster: false }));
    api.recordCheckinScan.mockRejectedValue(new Error("device_revoked: gone"));
    const { result } = render();
    await waitFor(() => expect(result.current.status).toBe("idle"));
    expect(result.current.rejected.map((row) => row.item.id)).toEqual(["a", "b"]);
    expect(result.current.lastFlush).toMatchObject({ sent: 0, rejected: 2 });
    // Odrzucone PRZEŻYWAJĄ utratę sesji - to jedyny ślad tych skanów.
    expect(store.rejected).toHaveLength(2);
  });

  it("odrzucone i konflikty z poprzedniej zmiany wracają z pamięci; wyczyszczenie je kasuje", async () => {
    store.rejected = [{ item: queued({ id: "x" }), error: "device_revoked: x", rejectedAt: "t" }];
    store.conflicts = [
      {
        id: "c-old",
        kind: "admitted_offline",
        checkinId: null,
        checkpointId: CP,
        direction: "in",
        deviceScannedAt: "t",
        offlineOutcome: "granted",
        serverOutcome: "denied_capacity",
        personName: null,
        registrationId: null,
        detectedAt: "t",
      },
    ];
    const { result } = render(null);
    await waitFor(() => expect(result.current.rejected).toHaveLength(1));
    expect(result.current.conflicts).toHaveLength(1);

    act(() => result.current.clearSyncIssues());
    expect(result.current.rejected).toEqual([]);
    expect(result.current.conflicts).toEqual([]);
    expect(store.clears).toBe(1);
  });

  it("wygasłe poświadczenie nadal wysyła kolejkę (okno 72 h po terminie)", async () => {
    device.queue = [queued()];
    api.bootstrapScanner.mockResolvedValue(
      session({ offlineRoster: false, expiresAt: relativeIso(-60_000) }),
    );
    api.recordCheckinScan.mockResolvedValue(scanResult());
    const { result } = render();
    await waitFor(() => expect(result.current.status).toBe("expired"));
    await waitFor(() => expect(result.current.outbox).toEqual([]));
    expect(api.recordCheckinScan).toHaveBeenCalledTimes(1);
  });
});
