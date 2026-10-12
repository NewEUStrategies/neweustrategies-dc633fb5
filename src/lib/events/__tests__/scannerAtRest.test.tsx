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
} from "@/lib/events/scannerApi";
import type { RosterPage } from "@/lib/events/scannerRoster";
import type { ScannerSession } from "@/lib/events/scannerSession";
import {
  CODE_SHAPE,
  createMemoryIndexedDb,
  stringsIn,
  type MemoryIndexedDb,
} from "@/lib/events/__tests__/support/memoryIndexedDb";

freezeClock();

const api = vi.hoisted(() => ({
  bootstrapScanner: vi.fn<(token: string) => Promise<ScannerSession>>(),
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
      capacity: null,
      occupancy: null,
    },
    person: null,
    otherEventTitlePl: null,
    otherEventTitleEn: null,
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
