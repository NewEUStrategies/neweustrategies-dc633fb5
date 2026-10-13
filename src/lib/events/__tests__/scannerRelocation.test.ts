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
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  token: null as string | null,
  queued: 0,
  rejected: [] as unknown[],
  conflicts: [] as unknown[],
  cleared: 0,
  wiped: 0,
}));

vi.mock("@/lib/events/scannerStorage", () => ({
  readStoredToken: () => h.token,
  clearStoredToken: () => {
    h.token = null;
  },
  countStoredOutbox: () => Promise.resolve(h.queued),
  clearOutbox: () => {
    h.cleared += 1;
    return Promise.resolve();
  },
}));

vi.mock("@/lib/events/scannerOfflineStorage", () => ({
  loadRejected: () => Promise.resolve(h.rejected),
  loadConflicts: () => Promise.resolve(h.conflicts),
  wipeAllOfflineData: () => {
    h.wiped += 1;
    return Promise.resolve();
  },
}));

const { purgeLeftoverScannerData } = await import("@/lib/events/scannerRelocation");

const PORTAL = "https://portal.example.eu";
const SCANNER = "https://scan.example.eu";

beforeEach(() => {
  h.token = "token-z-dawnych-czasow-0123";
  h.queued = 0;
  h.rejected = [];
  h.conflicts = [];
  h.cleared = 0;
  h.wiped = 0;
});

describe("resztki skanera pod originem portalu", () => {
  it("token bez niewysłanej pracy znika razem z danymi skanera", async () => {
    await expect(purgeLeftoverScannerData(PORTAL, SCANNER)).resolves.toBe(true);
    expect(h.token).toBeNull();
    expect(h.cleared).toBe(1);
    expect(h.wiped).toBe(1);
  });

  it.each([
    ["kolejka z niewysłanymi skanami", () => (h.queued = 2)],
    ["lista odrzuconych do przekazania", () => (h.rejected = [{}])],
    ["konflikty decyzji offline", () => (h.conflicts = [{}])],
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
