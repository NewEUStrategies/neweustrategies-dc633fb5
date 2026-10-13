// OPS-06: co skaner zostawia NA DYSKU urządzenia - kryterium odbioru.
//
// PO CO TEN PLIK. Kolejka (do 500 pozycji) i lista odrzuconych (do 2000)
// trzymały JAWNY kod z biletu, a kod to poświadczenie wejścia przy bramce.
// Telefon wolontariusza po wydarzeniu - zgubiony albo prywatny - zachowywał
// ważne kody i listę osób na zawsze, a eksport krążył pocztą.
//
// TU NIC NIE JEST ATRAPĄ POZA SIECIĄ. Środowisko uruchomieniowe pracuje na
// PRAWDZIWYCH modułach pamięci (`scannerStorage`, `scannerOfflineStorage`),
// prawdziwym sejfie (WebCrypto: HKDF + AES-GCM) i działającej atrapie
// IndexedDB w RAM - a test przeszukuje KAŻDĄ wartość zapisaną w IndexedDB
// i `localStorage` wzorcem kodu z biletu.
//
// KRYTERIUM: po synchronizacji i odłączeniu w IndexedDB ani w `localStorage`
// nie ma ani jednego 32-znakowego kodu.
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, waitFor } from "@testing-library/react";

import { renderHookWithQueryClient } from "@/test/renderWithQueryClient";
import { FIXED_NOW, GODZINA, freezeClock, relativeIso } from "@/test/time";
import type {
  CheckinScanInput,
  CheckinScanResult,
  LeadScanInput,
  LeadScanResult,
  RosterPageInput,
  ScannerBootstrap,
} from "@/lib/events/scannerApi";
import type { RosterPage } from "@/lib/events/scannerRoster";
import type { ScannerSession } from "@/lib/events/scannerSession";
import type { RejectedScan } from "@/lib/events/scannerOutbox";
import { syncIssuesJson } from "@/lib/events/scannerSyncIssues";
import {
  CODE_SHAPE,
  createMemoryIndexedDb,
  stringsIn,
  type MemoryIndexedDb,
} from "@/lib/events/__tests__/support/memoryIndexedDb";
import {
  createFakeLockManager,
  installFakeLockManager,
} from "@/lib/events/__tests__/support/fakeLockManager";

freezeClock();

const api = vi.hoisted(() => ({
  bootstrapScanner: vi.fn<(token: string) => Promise<ScannerBootstrap>>(),
  recordCheckinScan: vi.fn<(input: CheckinScanInput) => Promise<CheckinScanResult>>(),
  recordLeadScan: vi.fn<(input: LeadScanInput) => Promise<LeadScanResult>>(),
  fetchScannerRoster: vi.fn<(input: RosterPageInput) => Promise<RosterPage>>(),
  withDeadline: vi.fn(<T,>(promise: Promise<T>, _ms: number): Promise<T> => promise),
}));
vi.mock("@/lib/events/scannerApi", () => api);

/* ------------------------------------------------------------ fixture'y --- */

/** Kształt poświadczenia urządzenia - 32 znaki, jak kody z biletów. */
const TOKEN = "DEVTOKEN-AbCdEfGhIjKlMnOpQrStUvW";
const CP = "11111111-1111-4111-8111-111111111111";
/** Trzy kody z biletów: 24 bajty base64url = 32 znaki (`_event_new_qr_token()`). */
const GRANTED = "Qr1aB2cD3eF4gH5iJ6kL7mN8oP9qR0sT";
const REFUSED = "Zz9yX8wV7uT6sR5qP4oN3mL2kJ1iH0gF";
const LEAD = "Ld_0123456789-abcdefghijklmnopqr";
const CODES = [GRANTED, REFUSED, LEAD];

const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

function session(over: Partial<ScannerSession> = {}): ScannerSession {
  return {
    deviceId: "dev-1",
    label: "Brama 1",
    scopes: ["checkin", "lead"],
    expiresAt: relativeIso(24 * GODZINA),
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
        reentryPolicy: "allow",
        capacity: null,
        dedupeWindowSeconds: 60,
        sortOrder: 0,
      },
    ],
    ...over,
  };
}

function rosterPage(): RosterPage {
  return {
    generatedAt: relativeIso(-60_000),
    full: true,
    total: 1,
    nextAfter: null,
    removed: [],
    rows: [
      {
        registrationId: "r-olga",
        hash: sha(GRANTED),
        badgeHash: null,
        supersededHashes: [],
        status: "approved",
        firstName: "Olga",
        lastName: "Obecna",
        company: "Acme",
        ticketNamePl: null,
        ticketNameEn: null,
        groupNamePl: null,
        groupNameEn: null,
        groupColor: null,
        badgePrinted: false,
      },
    ],
  };
}

function checkinResult(): CheckinScanResult {
  return {
    outcome: "granted",
    admit: true,
    serverAdmit: true,
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
      reentryPolicy: null,
      capacity: null,
      occupancy: null,
    },
    person: null,
    otherEventTitlePl: null,
    otherEventTitleEn: null,
    reentry: false,
    reentryPreviousAt: null,
    credential: null,
    superseded: null,
    displayName: null,
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
    superseded: null,
  };
}

/* ------------------------------------------------------------ narzędzia --- */

let idb: MemoryIndexedDb;
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

/** Każdy napis z IndexedDB i z `localStorage` tej karty. */
function everythingAtRest(): string[] {
  const out: string[] = [];
  for (const [db, store, key, value] of idb.records()) {
    out.push(db, store, key);
    stringsIn(value, out);
  }
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (key === null) continue;
    out.push(key, window.localStorage.getItem(key) ?? "");
  }
  return out;
}

function plaintextCodesAtRest(): string[] {
  const all = everythingAtRest();
  return CODES.filter((code) => all.some((value) => value.includes(code)));
}

function atRest(fragment: string): boolean {
  return everythingAtRest().some((value) => value.includes(fragment));
}

/** Obietnica do rozstrzygnięcia z testu - spóźniona odpowiedź bazy. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Kilka obrotów mikrozadań i timerów - kontynuacje po `await` mają czas dobiec. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let round = 0; round < 10; round += 1) await new Promise((r) => setTimeout(r, 0));
  });
}

function exportJson(rejected: readonly RejectedScan[]): string {
  return syncIssuesJson([], rejected, {
    deviceLabel: "Brama 1",
    eventSlug: "kongres",
    exportedAt: relativeIso(0),
  });
}

async function loadRuntime() {
  vi.resetModules();
  const { useScannerRuntime } = await import("@/lib/events/useScanner");
  return useScannerRuntime;
}

beforeEach(() => {
  vi.clearAllMocks();
  api.withDeadline.mockImplementation(<T,>(promise: Promise<T>) => promise);
  idb = createMemoryIndexedDb();
  vi.stubGlobal("indexedDB", idb.factory);
  window.localStorage.clear();
  offline = false;
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    get: () => !offline,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

/* ---------------------------------------------------------------- testy --- */

describe("OPS-06: kody z biletów nie leżą jawnie na urządzeniu", () => {
  it("KRYTERIUM: kolejka zaszyfrowana, odrzucone bez kodu, a po synchronizacji i odłączeniu - zero kodów w IndexedDB i localStorage", async () => {
    const useScannerRuntime = await loadRuntime();
    api.bootstrapScanner.mockResolvedValue(session());
    api.fetchScannerRoster.mockResolvedValue(rosterPage());
    const { result } = renderHookWithQueryClient(() => useScannerRuntime(TOKEN));
    await waitFor(() => expect(result.current.roster.count).toBe(1));

    // Zmiana bez sieci: odprawa z listy, odprawa nieznanego kodu i lead.
    goOffline();
    await act(async () => {
      await result.current.submitCheckin({ code: GRANTED, checkpointId: CP, direction: "in" });
      await result.current.submitCheckin({ code: REFUSED, checkpointId: CP, direction: "in" });
      await result.current.submitLead({
        code: LEAD,
        note: "rozmowa o wdrożeniu",
        interestRating: 4,
      });
    });
    await waitFor(() => {
      const stored = idb.read("nes-scanner", "outbox", "queue");
      expect(Array.isArray(stored) ? stored : []).toHaveLength(3);
    });

    // 1) Kolejka na dysku: metadane, skrót i prefiks - kod i notatka TYLKO w bloku.
    const queue = idb.read("nes-scanner", "outbox", "queue") as Array<Record<string, unknown>>;
    for (const record of queue) {
      expect(record).not.toHaveProperty("code");
      expect(record).not.toHaveProperty("note");
      expect(record.sealed).toEqual({
        iv: expect.stringMatching(/^[0-9a-f]{24}$/),
        data: expect.stringMatching(/^[0-9a-f]+$/),
      });
    }
    expect(queue.map((record) => record.codeHash)).toEqual(CODES.map(sha));
    expect(queue.map((record) => record.codePrefix)).toEqual(CODES.map((c) => c.slice(0, 6)));
    expect(plaintextCodesAtRest()).toEqual([]);
    expect(everythingAtRest().some((value) => value.includes("rozmowa o wdrożeniu"))).toBe(false);
    // Lista osób na dysku niesie termin poświadczenia.
    expect(idb.read("nes-scanner-offline", "records", "roster")).toMatchObject({
      expiresAt: session().expiresAt,
    });

    // 2) Sieć wraca: dwie pozycje przechodzą, jedna jest odrzucona przez bazę.
    api.recordCheckinScan.mockImplementation((input) =>
      input.code === REFUSED
        ? Promise.reject(new Error("invalid_payload: code is not a ticket"))
        : Promise.resolve(checkinResult()),
    );
    api.recordLeadScan.mockResolvedValue(leadResult());
    goOnline();
    await waitFor(() => expect(result.current.outbox).toEqual([]));
    await waitFor(() => expect(result.current.rejected).toHaveLength(1));
    // Wysłane zostały PRAWDZIWE kody - sejf otwiera je w pamięci karty.
    expect(api.recordCheckinScan.mock.calls.map(([input]) => input.code).sort()).toEqual(
      [GRANTED, REFUSED].sort(),
    );
    expect(api.recordLeadScan).toHaveBeenCalledWith(
      expect.objectContaining({ code: LEAD, note: "rozmowa o wdrożeniu" }),
    );
    // Odrzucona: skrót (ten sam co `qr_token_hash`) i prefiks, bez kodu.
    const rejected = idb.read("nes-scanner-offline", "records", "rejected") as Array<{
      item: Record<string, unknown>;
    }>;
    expect(rejected).toHaveLength(1);
    expect(rejected[0].item).not.toHaveProperty("code");
    expect(rejected[0].item).toMatchObject({ codeHash: sha(REFUSED), codePrefix: "Zz9yX8" });
    expect(plaintextCodesAtRest()).toEqual([]);

    // 3) Odłączenie: token, kolejka, lista osób, sesja i listy do wyjaśnienia znikają.
    await act(async () => {
      await result.current.disconnect();
    });
    const leftovers = everythingAtRest().filter((value) => CODE_SHAPE.test(value));
    expect(leftovers).toEqual([]);
    expect(plaintextCodesAtRest()).toEqual([]);
    expect(everythingAtRest().some((value) => value.includes(TOKEN))).toBe(false);
    expect(idb.read("nes-scanner-offline", "records", "roster")).toBeUndefined();
    expect(idb.read("nes-scanner-offline", "records", "rejected")).toBeUndefined();
    expect(idb.read("nes-scanner", "outbox", "queue")).toEqual([]);
  });

  it("OPS-12: znacznik kolejki leży na dysku WYŁĄCZNIE w sejfie, a z kolejką wraca po restarcie", async () => {
    const MARKER = "AAAAAGkAAAA" + "Z".repeat(43);
    const useScannerRuntime = await loadRuntime();
    api.bootstrapScanner.mockResolvedValue({
      ...session({ offlineRoster: false }),
      queueMarker: { value: MARKER, validUntil: relativeIso(24 * GODZINA) },
    });
    const first = renderHookWithQueryClient(() => useScannerRuntime(TOKEN));
    await waitFor(() => expect(first.result.current.status).toBe("ready"));
    // Znacznik urządzenia trafia do magazynu offline - w bloku sejfu.
    await waitFor(() =>
      expect(idb.read("nes-scanner-offline", "records", "marker")).toMatchObject({
        deviceId: "dev-1",
        sealed: { iv: expect.any(String), data: expect.any(String) },
      }),
    );
    goOffline();
    await act(async () => {
      await first.result.current.submitCheckin({
        code: GRANTED,
        checkpointId: CP,
        direction: "in",
      });
    });
    await waitFor(() => expect(idb.read("nes-scanner", "outbox", "queue")).toHaveLength(1));
    expect(first.result.current.outbox[0].queueMarker).toBe(MARKER);
    // Ani w kolejce, ani w magazynie offline, ani w localStorage - jawnie nigdzie.
    expect(everythingAtRest().some((value) => value.includes(MARKER))).toBe(false);
    first.unmount();

    // Restart karty: pozycja otwiera się kluczem tokenu RAZEM ze swoim znacznikiem.
    const useScannerRuntime2 = await loadRuntime();
    api.recordCheckinScan.mockResolvedValue(checkinResult());
    offline = false;
    const second = renderHookWithQueryClient(() => useScannerRuntime2(TOKEN));
    await waitFor(() => expect(api.recordCheckinScan).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(second.result.current.outbox).toEqual([]));
    expect(api.recordCheckinScan).toHaveBeenCalledWith(
      expect.objectContaining({ code: GRANTED, queued: true, queueMarker: MARKER }),
    );

    // Odłączenie kasuje znacznik razem z sesją.
    await act(async () => {
      await second.result.current.disconnect();
    });
    expect(idb.read("nes-scanner-offline", "records", "marker")).toBeUndefined();
  });

  it("kolejka i lista odrzuconych sprzed sejfu (jawne kody) są przepisywane przy starcie, a skany nadal wychodzą", async () => {
    // Telefon z poprzedniej wersji aplikacji: kolejka i lista odrzuconych z kodem.
    idb.seed("nes-scanner", "outbox", "queue", [
      {
        id: "stara-1",
        kind: "checkin",
        code: GRANTED,
        checkpointId: CP,
        direction: "in",
        note: null,
        interestRating: null,
        deviceScannedAt: relativeIso(-600_000),
        attempts: 8,
        nextAttemptAt: relativeIso(GODZINA),
        lastError: "Scanner request timed out",
        deviceId: "dev-1",
      },
    ]);
    idb.seed("nes-scanner-offline", "records", "rejected", [
      {
        item: {
          id: "stara-2",
          kind: "lead",
          code: REFUSED,
          checkpointId: null,
          direction: null,
          note: null,
          interestRating: null,
          deviceScannedAt: relativeIso(-700_000),
          attempts: 0,
          nextAttemptAt: relativeIso(-700_000),
          lastError: null,
        },
        error: "device_revoked: x",
        rejectedAt: relativeIso(-650_000),
      },
    ]);
    window.localStorage.setItem("nes.scanner.device-token", TOKEN);
    expect(plaintextCodesAtRest()).toEqual([GRANTED, REFUSED]);

    const useScannerRuntime = await loadRuntime();
    let release: () => void = () => undefined;
    api.bootstrapScanner.mockReturnValue(
      new Promise((resolve) => (release = () => resolve(session({ offlineRoster: false })))),
    );
    api.recordCheckinScan.mockResolvedValue(checkinResult());
    const { result } = renderHookWithQueryClient(() => useScannerRuntime(null));

    // Przepisanie przy starcie - zanim baza w ogóle odpowie. Start zeruje
    // też wycofanie pozycji „po limicie prób" (OPS-05).
    await waitFor(() => expect(plaintextCodesAtRest()).toEqual([]));
    await waitFor(() =>
      expect(idb.read("nes-scanner", "outbox", "queue")).toEqual([
        expect.objectContaining({ id: "stara-1", codeHash: sha(GRANTED), attempts: 0 }),
      ]),
    );
    const rejected = idb.read("nes-scanner-offline", "records", "rejected") as Array<{
      item: Record<string, unknown>;
    }>;
    expect(rejected[0].item).toMatchObject({ codeHash: sha(REFUSED), codePrefix: "Zz9yX8" });

    // Skan z poprzedniej wersji nadal wychodzi z PRAWDZIWYM kodem.
    await act(async () => release());
    await waitFor(() => expect(result.current.outbox).toEqual([]));
    expect(api.recordCheckinScan).toHaveBeenCalledWith(
      expect.objectContaining({ code: GRANTED, clientScanUid: "stara-1", queued: true }),
    );
  });

  it("pozycje zaszyfrowane tokenem A przetrwają start z tokenem B i otworzą się po powrocie A", async () => {
    const useScannerRuntime = await loadRuntime();
    api.bootstrapScanner.mockResolvedValue(session({ offlineRoster: false }));
    const first = renderHookWithQueryClient(() => useScannerRuntime(TOKEN));
    await waitFor(() => expect(first.result.current.status).toBe("ready"));
    goOffline();
    await act(async () => {
      await first.result.current.submitCheckin({
        code: GRANTED,
        checkpointId: CP,
        direction: "in",
      });
    });
    await waitFor(() => expect(idb.read("nes-scanner", "outbox", "queue")).toHaveLength(1));
    first.unmount();

    // Nowa karta z INNYM poświadczeniem, które baza odrzuca jako nieznane:
    // blok A zostaje zamknięty i nietknięty na dysku.
    const other = "OTHERTOKEN-zZyYxXwWvVuUtTsSrRqQ";
    const useScannerRuntime2 = await loadRuntime();
    api.bootstrapScanner.mockRejectedValue(new Error("invalid_device_token: unknown"));
    const second = renderHookWithQueryClient(() => useScannerRuntime2(other));
    await waitFor(() => expect(second.result.current.connectError).toContain("invalid_device"));
    await act(async () => {});
    second.unmount();
    // Odmowa CUDZEGO tokenu nie przekreśla pozycji tokenu A.
    expect(idb.read("nes-scanner", "outbox", "queue")).toEqual([
      expect.objectContaining({ sealed: expect.objectContaining({ iv: expect.any(String) }) }),
    ]);
    expect(idb.read("nes-scanner-offline", "records", "rejected")).toBeUndefined();

    // Powrót tokenu A: pozycja otwiera się i wychodzi z prawdziwym kodem.
    offline = false;
    const useScannerRuntime3 = await loadRuntime();
    api.bootstrapScanner.mockResolvedValue(session({ offlineRoster: false }));
    api.recordCheckinScan.mockResolvedValue(checkinResult());
    const third = renderHookWithQueryClient(() => useScannerRuntime3(TOKEN));
    await waitFor(() =>
      expect(api.recordCheckinScan).toHaveBeenCalledWith(
        expect.objectContaining({ code: GRANTED, queued: true }),
      ),
    );
    await waitFor(() => expect(third.result.current.outbox).toEqual([]));
    expect(third.result.current.rejected).toEqual([]);
  });

  it("bez WebCrypto (http, stare WebView) kod NIE trafia na dysk - kolejka żyje w karcie, ekran ostrzega", async () => {
    const real = globalThis.crypto;
    vi.stubGlobal("crypto", {
      getRandomValues: real.getRandomValues.bind(real),
      randomUUID: real.randomUUID.bind(real),
    });
    const useScannerRuntime = await loadRuntime();
    api.bootstrapScanner.mockResolvedValue(session({ offlineRoster: false }));
    const { result } = renderHookWithQueryClient(() => useScannerRuntime(TOKEN));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    goOffline();
    await act(async () => {
      await result.current.submitCheckin({ code: GRANTED, checkpointId: CP, direction: "in" });
    });
    await waitFor(() => expect(result.current.outboxPersistent).toBe(false));
    const queue = idb.read("nes-scanner", "outbox", "queue") as Array<Record<string, unknown>>;
    expect(queue).toHaveLength(1);
    // Skrót (biblioteka zapasowa) i prefiks są - kodu i bloku nie ma.
    expect(queue[0]).toMatchObject({ codeHash: sha(GRANTED), sealed: null });
    expect(plaintextCodesAtRest()).toEqual([]);

    // Dopóki karta żyje, skan i tak wychodzi.
    api.recordCheckinScan.mockResolvedValue(checkinResult());
    goOnline();
    await waitFor(() => expect(result.current.outbox).toEqual([]));
    expect(api.recordCheckinScan).toHaveBeenCalledWith(expect.objectContaining({ code: GRANTED }));
  });

  it("lista osób po terminie poświadczenia znika przy starcie - także bez otwierania sesji", async () => {
    idb.seed("nes-scanner-offline", "records", "roster", {
      deviceId: "dev-1",
      generatedAt: relativeIso(-3 * GODZINA),
      expiresAt: relativeIso(-GODZINA),
      rows: [{ registrationId: "r1", hash: sha(GRANTED), firstName: "Olga" }],
    });
    idb.seed("nes-scanner-offline", "records", "log", [
      { checkpointId: CP, registrationId: "r1", direction: "in", at: relativeIso(-2 * GODZINA) },
    ]);
    const useScannerRuntime = await loadRuntime();
    renderHookWithQueryClient(() => useScannerRuntime(null));

    await waitFor(() =>
      expect(idb.read("nes-scanner-offline", "records", "roster")).toBeUndefined(),
    );
    expect(idb.read("nes-scanner-offline", "records", "log")).toBeUndefined();
    expect(Date.now()).toBe(FIXED_NOW.getTime());
  });

  it("lista osób z ważnym terminem zostaje, a sierota bez sesji (lista sprzed tej zmiany) znika", async () => {
    const storage = await import("@/lib/events/scannerOfflineStorage");
    idb.seed("nes-scanner-offline", "records", "roster", {
      deviceId: "dev-1",
      generatedAt: relativeIso(-GODZINA),
      expiresAt: relativeIso(GODZINA),
      rows: [],
    });
    await expect(storage.purgeExpiredRoster(Date.now())).resolves.toBe(false);
    expect(idb.read("nes-scanner-offline", "records", "roster")).toBeDefined();

    idb.seed("nes-scanner-offline", "records", "roster", {
      deviceId: "dev-1",
      generatedAt: relativeIso(-GODZINA),
      rows: [],
    });
    await expect(storage.purgeExpiredRoster(Date.now())).resolves.toBe(true);
    expect(idb.read("nes-scanner-offline", "records", "roster")).toBeUndefined();
  });
});

/* ------------------------------------- notatka sponsora na liście odrzuconych --- */

/** Notatka sponsora - w kolejce leży wyłącznie w sejfie, jak kod. */
const NOTE = "PRIVATE-NOTE tel 600100200";

describe("F0: notatka leadu nie przechodzi jawnie na listę odrzuconych", () => {
  /** Lead z notatką w kolejce (bez sieci) - notatka tylko w bloku sejfu. */
  async function leadQueuedOffline() {
    const useScannerRuntime = await loadRuntime();
    api.bootstrapScanner.mockResolvedValue(session({ offlineRoster: false }));
    const hook = renderHookWithQueryClient(() => useScannerRuntime(TOKEN));
    await waitFor(() => expect(hook.result.current.status).toBe("ready"));
    goOffline();
    await act(async () => {
      await hook.result.current.submitLead({ code: LEAD, note: NOTE, interestRating: 5 });
    });
    await waitFor(() => expect(idb.read("nes-scanner", "outbox", "queue")).toHaveLength(1));
    expect(atRest(NOTE)).toBe(false);
    return hook;
  }

  function storedRejected(): Array<{ item: Record<string, unknown> }> {
    const stored = idb.read("nes-scanner-offline", "records", "rejected");
    return Array.isArray(stored) ? (stored as Array<{ item: Record<string, unknown> }>) : [];
  }

  it("odmowa pozycji (`invalid_payload`): odrzucony lead bez notatki - na dysku, w pamięci i w eksporcie JSON", async () => {
    const { result } = await leadQueuedOffline();
    api.recordLeadScan.mockRejectedValue(new Error("invalid_payload: not a ticket"));
    goOnline();
    await waitFor(() => expect(storedRejected()).toHaveLength(1));
    await waitFor(() => expect(result.current.outbox).toEqual([]));
    // Do bazy notatka pojechała - sejf otwiera ją w pamięci karty.
    expect(api.recordLeadScan).toHaveBeenCalledWith(
      expect.objectContaining({ code: LEAD, note: NOTE }),
    );
    const [entry] = storedRejected();
    expect(entry.item).toMatchObject({ kind: "lead", codeHash: sha(LEAD), codePrefix: "Ld_012" });
    expect(entry.item).not.toHaveProperty("note");
    expect(result.current.rejected).toHaveLength(1);
    expect(result.current.rejected[0].item).not.toHaveProperty("note");
    expect(atRest(NOTE)).toBe(false);
    expect(plaintextCodesAtRest()).toEqual([]);
    expect(exportJson(result.current.rejected)).not.toContain(NOTE);
  });

  it("odmowa poświadczenia (`device_revoked`, cała kolejka na listę): notatka nie zostaje jawnie po utracie klucza", async () => {
    const { result } = await leadQueuedOffline();
    api.recordLeadScan.mockRejectedValue(new Error("device_revoked: revoked in panel"));
    goOnline();
    await waitFor(() => expect(result.current.status).toBe("idle"));
    await waitFor(() => expect(storedRejected()).toHaveLength(1));
    await waitFor(() => expect(idb.read("nes-scanner", "outbox", "queue")).toEqual([]));
    // Klucz (token) zniknął z urządzenia - lista odrzuconych zostaje, bez notatki.
    expect(window.localStorage.getItem("nes.scanner.device-token")).toBeNull();
    expect(storedRejected()[0].item).toMatchObject({ kind: "lead", codeHash: sha(LEAD) });
    expect(storedRejected()[0].item).not.toHaveProperty("note");
    expect(result.current.rejected[0].item).not.toHaveProperty("note");
    expect(atRest(NOTE)).toBe(false);
    expect(exportJson(result.current.rejected)).not.toContain(NOTE);
  });

  it("eksport JSON i zapis listy zdejmują notatkę także z wpisu, który ją jeszcze niesie (granica)", async () => {
    const storage = await import("@/lib/events/scannerOfflineStorage");
    const carrying = {
      item: {
        id: "l-1",
        kind: "lead",
        checkpointId: null,
        direction: null,
        note: NOTE,
        interestRating: 3,
        deviceScannedAt: relativeIso(-60_000),
        attempts: 0,
        nextAttemptAt: relativeIso(-60_000),
        lastError: null,
        codeHash: sha(LEAD),
        codePrefix: "Ld_012",
      },
      error: "invalid_payload: not a ticket",
      rejectedAt: relativeIso(-30_000),
    } as unknown as RejectedScan;
    expect(exportJson([carrying])).not.toContain(NOTE);
    await storage.saveRejected([carrying]);
    expect(atRest(NOTE)).toBe(false);
    expect(storedRejected()).toHaveLength(1);
  });

  it("lista odrzuconych z notatką (zapisana przed tą zmianą) traci ją przy pierwszym odczycie", async () => {
    idb.seed("nes-scanner-offline", "records", "rejected", [
      {
        item: {
          id: "l-stary",
          kind: "lead",
          checkpointId: null,
          direction: null,
          note: NOTE,
          interestRating: 4,
          deviceScannedAt: relativeIso(-600_000),
          attempts: 0,
          nextAttemptAt: relativeIso(-600_000),
          lastError: null,
          codeHash: sha(LEAD),
          codePrefix: "Ld_012",
        },
        error: "device_revoked: x",
        rejectedAt: relativeIso(-500_000),
      },
    ]);
    expect(atRest(NOTE)).toBe(true);
    const useScannerRuntime = await loadRuntime();
    const { result } = renderHookWithQueryClient(() => useScannerRuntime(null));
    await waitFor(() => expect(atRest(NOTE)).toBe(false));
    expect(storedRejected()).toEqual([
      expect.objectContaining({ item: expect.objectContaining({ id: "l-stary" }) }),
    ]);
    await waitFor(() => expect(result.current.rejected).toHaveLength(1));
    expect(result.current.rejected[0].item).not.toHaveProperty("note");
  });
});

/* --------------------------------------- odłączenie w trakcie żądania (F1/F2) --- */

describe("F1/F2: odpowiedź spóźniona względem „Odłącz” nie zapisuje niczego", () => {
  const TOKEN_B = "OTHERTOKEN-zZyYxXwWvVuUtTsSrRqQ";

  it("wysyłka kolejki: spóźniona odpowiedź z rozbieżną decyzją nie zostawia konfliktu (imię i nazwisko) ani kolejki", async () => {
    const useScannerRuntime = await loadRuntime();
    api.bootstrapScanner.mockResolvedValue(session());
    api.fetchScannerRoster.mockResolvedValue(rosterPage());
    const { result } = renderHookWithQueryClient(() => useScannerRuntime(TOKEN));
    await waitFor(() => expect(result.current.roster.count).toBe(1));

    // Odprawa bez sieci wpuszczona z listy - decyzja jedzie z pozycją.
    goOffline();
    await act(async () => {
      await result.current.submitCheckin({ code: GRANTED, checkpointId: CP, direction: "in" });
    });
    await waitFor(() => expect(idb.read("nes-scanner", "outbox", "queue")).toHaveLength(1));

    // Sieć wraca, wysyłka trwa (słaby zasięg przy bramce)...
    const late = deferred<CheckinScanResult>();
    api.recordCheckinScan.mockReturnValue(late.promise);
    goOnline();
    await waitFor(() => expect(api.recordCheckinScan).toHaveBeenCalledTimes(1));

    // ...a operator potwierdza „Odłącz".
    await act(async () => {
      await result.current.disconnect();
    });
    expect(idb.read("nes-scanner", "outbox", "queue")).toEqual([]);
    expect(idb.read("nes-scanner-offline", "records", "conflicts")).toBeUndefined();

    // Baza nie potwierdza decyzji offline - dawniej: konflikt z nazwiskiem na dysku.
    late.resolve({
      ...checkinResult(),
      outcome: "registration_cancelled",
      admit: false,
      serverAdmit: false,
      result: "registration_cancelled",
      person: {
        personId: "p1",
        firstName: "Olga",
        lastName: "Obecna",
        company: null,
        jobTitle: null,
        registrationId: "r-olga",
        registrationStatus: "cancelled",
        ticketNamePl: null,
        ticketNameEn: null,
        groupNamePl: null,
        groupNameEn: null,
        groupColor: null,
        badgePrinted: false,
        badgePrintedAt: null,
        badgePrintedVersion: null,
      },
    } as CheckinScanResult);
    await settle();

    expect(idb.read("nes-scanner-offline", "records", "conflicts")).toBeUndefined();
    expect(idb.read("nes-scanner-offline", "records", "rejected")).toBeUndefined();
    expect(idb.read("nes-scanner", "outbox", "queue")).toEqual([]);
    expect(atRest("Obecna")).toBe(false);
    expect(atRest("r-olga")).toBe(false);
    expect(result.current.conflicts).toEqual([]);
    expect(result.current.outbox).toEqual([]);
    expect(result.current.lastFlush).toBeNull();
    expect(result.current.status).toBe("idle");
  });

  it("wysyłka kolejki: spóźniona odmowa poświadczenia nie kończy NOWEGO parowania", async () => {
    const useScannerRuntime = await loadRuntime();
    api.bootstrapScanner.mockResolvedValue(session({ offlineRoster: false }));
    const { result } = renderHookWithQueryClient(() => useScannerRuntime(TOKEN));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    goOffline();
    await act(async () => {
      await result.current.submitCheckin({ code: GRANTED, checkpointId: CP, direction: "in" });
    });
    await waitFor(() => expect(idb.read("nes-scanner", "outbox", "queue")).toHaveLength(1));
    const late = deferred<CheckinScanResult>();
    api.recordCheckinScan.mockReturnValue(late.promise);
    goOnline();
    await waitFor(() => expect(api.recordCheckinScan).toHaveBeenCalledTimes(1));
    await act(async () => {
      await result.current.disconnect();
    });

    // Nowe poświadczenie (inne urządzenie) - zanim stara odpowiedź wróci.
    api.bootstrapScanner.mockResolvedValue(session({ deviceId: "dev-2", offlineRoster: false }));
    act(() => result.current.connect(TOKEN_B));
    await waitFor(() => expect(result.current.session?.deviceId).toBe("dev-2"));

    late.reject(new Error("device_revoked: revoked in panel"));
    await settle();
    expect(result.current.status).toBe("ready");
    expect(result.current.connectError).toBeNull();
    expect(window.localStorage.getItem("nes.scanner.device-token")).toBe(TOKEN_B);
    expect(result.current.rejected).toEqual([]);
    expect(idb.read("nes-scanner-offline", "records", "rejected")).toBeUndefined();
  });

  it("skan na żywo po terminie żądania już po „Odłącz”: nie trafia do kolejki ani do kolejki następnego urządzenia", async () => {
    const useScannerRuntime = await loadRuntime();
    api.bootstrapScanner.mockResolvedValue(session({ offlineRoster: false }));
    const { result } = renderHookWithQueryClient(() => useScannerRuntime(TOKEN));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    const liveCheckin = deferred<CheckinScanResult>();
    const liveLead = deferred<LeadScanResult>();
    api.recordCheckinScan.mockReturnValue(liveCheckin.promise);
    api.recordLeadScan.mockReturnValue(liveLead.promise);
    let checkin!: Promise<unknown>;
    let lead!: Promise<unknown>;
    act(() => {
      checkin = result.current.submitCheckin({ code: GRANTED, checkpointId: CP, direction: "in" });
      lead = result.current.submitLead({ code: LEAD, note: NOTE, interestRating: 2 });
    });
    const outcomes = Promise.all(
      [checkin, lead].map((pending) =>
        pending.then(
          () => "zapisany",
          (error: unknown) => (error instanceof Error ? error.message : String(error)),
        ),
      ),
    );
    await waitFor(() => expect(api.recordLeadScan).toHaveBeenCalledTimes(1));
    expect(api.recordCheckinScan).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.disconnect();
    });
    // Termin żądania mija PO odłączeniu - dawniej: skan w kolejce na dysku.
    liveCheckin.reject(new Error("Scanner request timed out"));
    liveLead.reject(new Error("Scanner request timed out"));
    await settle();

    // Operator dostaje odmowę „brak sesji", a nie „zapisano w kolejce".
    await expect(outcomes).resolves.toEqual([
      expect.stringMatching(/^invalid_device_token/),
      expect.stringMatching(/^invalid_device_token/),
    ]);
    expect(idb.read("nes-scanner", "outbox", "queue")).toEqual([]);
    expect(result.current.outbox).toEqual([]);
    expect(atRest(NOTE)).toBe(false);

    // Następne urządzenie nie dziedziczy cudzego skanu (dawniej: `device_mismatch`).
    api.bootstrapScanner.mockResolvedValue(session({ deviceId: "dev-2", offlineRoster: false }));
    act(() => result.current.connect(TOKEN_B));
    await waitFor(() => expect(result.current.session?.deviceId).toBe("dev-2"));
    await settle();
    expect(result.current.outbox).toEqual([]);
    expect(result.current.rejected).toEqual([]);
    expect(idb.read("nes-scanner-offline", "records", "rejected")).toBeUndefined();
  });

  it("F2: znacznik z odpowiedzi urządzenia A, która wróciła po sparowaniu B, nie stempluje skanów B", async () => {
    const MARKER_A = "AAAAAGkAAAA" + "A".repeat(43);
    const MARKER_A_LATE = "AAAAAGkAAAA" + "L".repeat(43);
    const MARKER_B = "AAAAAGkAAAA" + "B".repeat(43);
    const useScannerRuntime = await loadRuntime();
    api.bootstrapScanner.mockResolvedValue({
      ...session({ offlineRoster: false }),
      queueMarker: { value: MARKER_A, validUntil: relativeIso(24 * GODZINA) },
    });
    const { result } = renderHookWithQueryClient(() => useScannerRuntime(TOKEN));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    goOffline();
    await act(async () => {
      await result.current.submitCheckin({ code: GRANTED, checkpointId: CP, direction: "in" });
    });
    await waitFor(() => expect(result.current.outbox).toHaveLength(1));
    expect(result.current.outbox[0].queueMarker).toBe(MARKER_A);

    // Wysyłka urządzenia A w locie...
    const late = deferred<CheckinScanResult>();
    api.recordCheckinScan.mockReturnValue(late.promise);
    goOnline();
    await waitFor(() => expect(api.recordCheckinScan).toHaveBeenCalledTimes(1));
    // ...telefon przechodzi na urządzenie B, które wygasa wcześniej niż znacznik A.
    await act(async () => {
      await result.current.disconnect();
    });
    api.bootstrapScanner.mockResolvedValue({
      ...session({ deviceId: "dev-2", offlineRoster: false, expiresAt: relativeIso(2 * GODZINA) }),
      queueMarker: { value: MARKER_B, validUntil: relativeIso(2 * GODZINA) },
    });
    act(() => result.current.connect(TOKEN_B));
    await waitFor(() => expect(result.current.session?.deviceId).toBe("dev-2"));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    // Spóźniona odpowiedź A niesie NOWSZY (dłużej ważny) znacznik A.
    late.resolve({
      ...checkinResult(),
      queueMarker: { value: MARKER_A_LATE, validUntil: relativeIso(24 * GODZINA) },
    });
    await settle();

    goOffline();
    await act(async () => {
      await result.current.submitCheckin({ code: REFUSED, checkpointId: CP, direction: "in" });
    });
    await waitFor(() => expect(result.current.outbox).toHaveLength(1));
    expect(result.current.outbox[0]).toMatchObject({ deviceId: "dev-2", queueMarker: MARKER_B });
  });
});

/* ------------------------------------------- blokada „skaner pracuje” (F3) --- */

describe("F3: środowisko skanera trzyma blokadę przez cały czas życia karty", () => {
  it("blokada `nes-scanner-runtime` jest trzymana od startu i zwalniana przy zamknięciu", async () => {
    const locks = createFakeLockManager();
    const restore = installFakeLockManager(locks);
    try {
      const useScannerRuntime = await loadRuntime();
      api.bootstrapScanner.mockResolvedValue(session({ offlineRoster: false }));
      const { unmount } = renderHookWithQueryClient(() => useScannerRuntime(TOKEN));
      await waitFor(() => expect(locks.held()).toEqual(["nes-scanner-runtime"]));
      unmount();
      await waitFor(() => expect(locks.held()).toEqual([]));
    } finally {
      restore();
    }
  });
});
