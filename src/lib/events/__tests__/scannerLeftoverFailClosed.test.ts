// Sprzątanie resztek skanera pod originem PORTALU jest FAIL CLOSED - na
// PRAWDZIWYCH modułach pamięci (`scannerStorage`, `scannerOfflineStorage`)
// i działającej atrapie IndexedDB z awariami na żądanie.
//
// CO PSUJE SIĘ BEZ TYCH TESTÓW. Telefon ma pod originem portalu niewysłane
// skany zaszyfrowane kluczem z tokenu. IndexedDB akurat odmawia (WebKit
// „Connection to Indexed Database server lost", błąd wejścia-wyjścia):
// dawniej sondy magazynu oddawały wtedy „pusto", sprzątanie kasowało token
// PIERWSZE, a kasowanie kolejki zawodziło po cichu - zaszyfrowane skany
// zostawały na dysku bez jedynego klucza, na zawsze. Druga droga do tej samej
// straty: skaner pracujący w innej karcie tego originu.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createMemoryIndexedDb,
  type MemoryIndexedDb,
  type MemoryIndexedDbFaults,
} from "@/lib/events/__tests__/support/memoryIndexedDb";
import {
  createFakeLockManager,
  installFakeLockManager,
} from "@/lib/events/__tests__/support/fakeLockManager";

const PORTAL = "https://portal.example.eu";
const SCANNER = "https://scan.example.eu";
const TOKEN_KEY = "nes.scanner.device-token";
const TOKEN = "DEVTOKEN-AbCdEfGhIjKlMnOpQrStUvW";

/** Dwie pozycje kolejki w formacie 2 - kod wyłącznie w bloku sejfu (klucz z tokenu). */
const SEALED_QUEUE = [1, 2].map((n) => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  kind: "checkin",
  checkpointId: null,
  direction: "in",
  interestRating: null,
  deviceScannedAt: "2026-10-12T10:00:00.000Z",
  attempts: 0,
  nextAttemptAt: "2026-10-12T10:00:00.000Z",
  lastError: null,
  deviceId: "dev-1",
  v: 2,
  codeHash: "a".repeat(64),
  codePrefix: "Qr1aB2",
  sealed: { iv: "0".repeat(24), data: "ab".repeat(40) },
}));

/** Sesja i lista osób - nie „praca", ale dane, które sprzątanie MA skasować. */
function seedOfflineSession(): void {
  idb.seed("nes-scanner-offline", "records", "session", { tokenHash: "f".repeat(64) });
  idb.seed("nes-scanner-offline", "records", "roster", { deviceId: "dev-1", rows: [] });
}

let idb: MemoryIndexedDb;
let restoreLocks: (() => void) | null = null;

/** Świeże moduły (stan pamięci karty w `scannerStorage` jest modułowy). */
async function relocation() {
  vi.resetModules();
  return import("@/lib/events/scannerRelocation");
}

function fail(faults: Partial<MemoryIndexedDbFaults>): void {
  Object.assign(idb.faults, faults);
}

function heal(): void {
  Object.assign(idb.faults, { open: "none", read: false, write: false, scope: null });
}

beforeEach(() => {
  idb = createMemoryIndexedDb();
  vi.stubGlobal("indexedDB", idb.factory);
  window.localStorage.clear();
  window.localStorage.setItem(TOKEN_KEY, TOKEN);
});

afterEach(() => {
  restoreLocks?.();
  restoreLocks = null;
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("sprzątanie resztek skanera - fail closed (F3)", () => {
  it("zdrowy magazyn: kolejka zatrzymuje sprzątanie, a bez pracy znika wszystko - token też", async () => {
    idb.seed("nes-scanner", "outbox", "queue", SEALED_QUEUE);
    const busy = await relocation();
    await expect(busy.holdsScannerWork()).resolves.toBe(true);
    await expect(busy.purgeLeftoverScannerData(PORTAL, SCANNER)).resolves.toBe(false);
    expect(window.localStorage.getItem(TOKEN_KEY)).toBe(TOKEN);

    idb.seed("nes-scanner", "outbox", "queue", []);
    seedOfflineSession();
    const idle = await relocation();
    await expect(idle.holdsScannerWork()).resolves.toBe(false);
    await expect(idle.purgeLeftoverScannerData(PORTAL, SCANNER)).resolves.toBe(true);
    expect(window.localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(idb.read("nes-scanner-offline", "records", "session")).toBeUndefined();
    expect(idb.read("nes-scanner-offline", "records", "roster")).toBeUndefined();
    expect(idb.read("nes-scanner", "outbox", "queue")).toEqual([]);
  });

  it.each<[string, Partial<MemoryIndexedDbFaults>]>([
    ["`open` rzuca", { open: "throw" }],
    ["`open` kończy się błędem", { open: "error" }],
    ["odczyt kończy się błędem", { read: true }],
    ["tylko kolejka nieczytelna", { read: true, scope: "nes-scanner" }],
  ])(
    "%s: magazyn nieczytelny = niewysłana praca - token i zaszyfrowana kolejka zostają",
    async (_opis, faults) => {
      idb.seed("nes-scanner", "outbox", "queue", SEALED_QUEUE);
      const { holdsScannerWork, purgeLeftoverScannerData } = await relocation();
      fail(faults);
      await expect(holdsScannerWork()).resolves.toBe(true);
      await expect(purgeLeftoverScannerData(PORTAL, SCANNER)).resolves.toBe(false);
      heal();
      expect(window.localStorage.getItem(TOKEN_KEY)).toBe(TOKEN);
      expect(idb.read("nes-scanner", "outbox", "queue")).toEqual(SEALED_QUEUE);
    },
  );

  it.each<[string, Partial<MemoryIndexedDbFaults>]>([
    ["obie bazy nieczytelne", { open: "error" }],
    ["magazyn offline: odczyt kończy się błędem", { read: true, scope: "nes-scanner-offline" }],
    ["magazyn offline: `open` rzuca", { open: "throw", scope: "nes-scanner-offline" }],
  ])(
    "%s - nawet przy PUSTEJ kolejce sprzątanie staje: pustki nie da się odróżnić od awarii",
    async (_opis, faults) => {
      idb.seed("nes-scanner", "outbox", "queue", []);
      const { holdsScannerWork, purgeLeftoverScannerData } = await relocation();
      fail(faults);
      await expect(holdsScannerWork()).resolves.toBe(true);
      await expect(purgeLeftoverScannerData(PORTAL, SCANNER)).resolves.toBe(false);
      expect(window.localStorage.getItem(TOKEN_KEY)).toBe(TOKEN);
    },
  );

  it.each(["nes-scanner", "nes-scanner-offline"])(
    "kasowanie odrzucone przez bazę `%s`: token ZOSTAJE (znika ostatni), a następne sprzątanie kończy robotę",
    async (database) => {
      seedOfflineSession();
      const { purgeLeftoverScannerData, purgeScannerData } = await relocation();
      fail({ write: true, scope: database });
      await expect(purgeLeftoverScannerData(PORTAL, SCANNER)).resolves.toBe(false);
      expect(window.localStorage.getItem(TOKEN_KEY)).toBe(TOKEN);

      heal();
      await expect(purgeScannerData()).resolves.toBe(true);
      expect(window.localStorage.getItem(TOKEN_KEY)).toBeNull();
      expect(idb.read("nes-scanner-offline", "records", "session")).toBeUndefined();
    },
  );

  it("skaner pracuje w innej karcie (Web Locks): sprzątanie nic nie rusza, po zamknięciu karty sprząta", async () => {
    const locks = createFakeLockManager();
    restoreLocks = installFakeLockManager(locks);
    seedOfflineSession();
    const { purgeLeftoverScannerData } = await relocation();
    const { holdScannerRuntimeLock, SCANNER_RUNTIME_LOCK } =
      await import("@/lib/events/scannerRuntimeLock");
    const release = holdScannerRuntimeLock();
    expect(locks.held()).toEqual([SCANNER_RUNTIME_LOCK]);

    await expect(purgeLeftoverScannerData(PORTAL, SCANNER)).resolves.toBe(false);
    expect(window.localStorage.getItem(TOKEN_KEY)).toBe(TOKEN);
    expect(idb.read("nes-scanner-offline", "records", "session")).toBeDefined();

    release();
    await vi.waitFor(() => expect(locks.held()).toEqual([]));
    await expect(purgeLeftoverScannerData(PORTAL, SCANNER)).resolves.toBe(true);
    expect(window.localStorage.getItem(TOKEN_KEY)).toBeNull();
    // Kasowanie trzymało blokadę tylko na swój czas.
    expect(locks.held()).toEqual([]);
  });

  it("przeglądarka bez IndexedDB: na dysku nic nie mogło zostać - sprzątanie przechodzi", async () => {
    vi.stubGlobal("indexedDB", undefined);
    const { holdsScannerWork, purgeLeftoverScannerData } = await relocation();
    await expect(holdsScannerWork()).resolves.toBe(false);
    await expect(purgeLeftoverScannerData(PORTAL, SCANNER)).resolves.toBe(true);
    expect(window.localStorage.getItem(TOKEN_KEY)).toBeNull();
  });
});
