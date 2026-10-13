// Sprzątanie resztek skanera pod originem PORTALU (OPS-13) - wołane leniwie
// z bootu każdej strony (`__root.tsx`, `armScannerLeftoverPurge`).
//
// CO PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. Telefon sparowany przed wdrożeniem osobnego originu trzyma token
//      urządzenia pod originem portalu na zawsze - obok treści CMS.
//   2. Albo odwrotnie: sprzątanie kasuje NIEWYSŁANE skany (kolejka, lista do
//      wyjaśnienia), których przeniesienie nie może porzucić.
//   3. Sprzątanie biegnie pod originem SKANERA (albo bez skonfigurowanego
//      originu) i wylogowuje działające urządzenie.
//   4. Token znika PRZED kasowaniem kolejki albo mimo nieudanego kasowania -
//      zaszyfrowane skany zostają na dysku bez klucza (F3; na prawdziwych
//      modułach i awariach IndexedDB: `scannerLeftoverFailClosed.test.ts`).
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  token: null as string | null,
  /** `null` = magazyn nieczytelny. */
  queued: 0 as number | null,
  issues: 0 as number | null,
  cleared: 0,
  wiped: 0,
  clearedOk: true,
  wipedOk: true,
  /** Token w chwili każdego kasowania - musi jeszcze być (znika OSTATNI). */
  tokenAtWipe: [] as Array<string | null>,
}));

vi.mock("@/lib/events/scannerStorage", () => ({
  readStoredToken: () => h.token,
  clearStoredToken: () => {
    h.token = null;
  },
  countStoredOutbox: () => Promise.resolve(h.queued),
  clearOutbox: () => {
    h.cleared += 1;
    h.tokenAtWipe.push(h.token);
    return Promise.resolve(h.clearedOk);
  },
}));

vi.mock("@/lib/events/scannerOfflineStorage", () => ({
  countStoredSyncIssues: () => Promise.resolve(h.issues),
  wipeAllOfflineData: () => {
    h.wiped += 1;
    h.tokenAtWipe.push(h.token);
    return Promise.resolve(h.wipedOk);
  },
}));

const { purgeLeftoverScannerData } = await import("@/lib/events/scannerRelocation");

const PORTAL = "https://portal.example.eu";
const SCANNER = "https://scan.example.eu";

beforeEach(() => {
  h.token = "token-z-dawnych-czasow-0123";
  h.queued = 0;
  h.issues = 0;
  h.cleared = 0;
  h.wiped = 0;
  h.clearedOk = true;
  h.wipedOk = true;
  h.tokenAtWipe = [];
});

describe("resztki skanera pod originem portalu", () => {
  it("token bez niewysłanej pracy znika razem z danymi skanera - OSTATNI", async () => {
    await expect(purgeLeftoverScannerData(PORTAL, SCANNER)).resolves.toBe(true);
    expect(h.token).toBeNull();
    expect(h.cleared).toBe(1);
    expect(h.wiped).toBe(1);
    expect(h.tokenAtWipe).toEqual(["token-z-dawnych-czasow-0123", "token-z-dawnych-czasow-0123"]);
  });

  it.each([
    ["kolejka nie potwierdziła kasowania", () => (h.clearedOk = false)],
    ["magazyn offline nie potwierdził kasowania", () => (h.wipedOk = false)],
  ])("%s: token ZOSTAJE (bez niego zaszyfrowana kolejka przepada)", async (_opis, arrange) => {
    arrange();
    await expect(purgeLeftoverScannerData(PORTAL, SCANNER)).resolves.toBe(false);
    expect(h.token).toBe("token-z-dawnych-czasow-0123");
  });

  it.each([
    ["kolejka z niewysłanymi skanami", () => (h.queued = 2)],
    ["lista odrzuconych albo konflikty do przekazania", () => (h.issues = 1)],
    ["kolejka nieczytelna (fail closed)", () => (h.queued = null)],
    ["magazyn offline nieczytelny (fail closed)", () => (h.issues = null)],
  ])("%s ZATRZYMUJE sprzątanie (ta sama reguła co trasa `/scanner`)", async (_opis, arrange) => {
    arrange();
    await expect(purgeLeftoverScannerData(PORTAL, SCANNER)).resolves.toBe(false);
    expect(h.token).not.toBeNull();
    expect(h.cleared + h.wiped).toBe(0);
  });

  it("pod originem skanera, bez skonfigurowanego originu i bez tokenu - nic się nie dzieje", async () => {
    await expect(purgeLeftoverScannerData(SCANNER, SCANNER)).resolves.toBe(false);
    await expect(purgeLeftoverScannerData(PORTAL, null)).resolves.toBe(false);
    h.token = null;
    await expect(purgeLeftoverScannerData(PORTAL, SCANNER)).resolves.toBe(false);
    expect(h.cleared + h.wiped).toBe(0);
  });
});
