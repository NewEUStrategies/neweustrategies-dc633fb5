// Trwałość trybu offline skanera: sesja bez tokenu, lista, dziennik zgód,
// odrzucone i konflikty.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. MIGRACJA KOLEJKI W TRAKCIE PRACY. Tryb offline ma OSOBNĄ bazę
//      (`nes-scanner-offline`, wersja 1) - gdyby dopisał magazyny do
//      `nes-scanner`, każda karta z otwartą kolejką przechodziłaby migrację
//      przy bramce. Asercje idą po DOSŁOWNYCH nazwach.
//   2. SESJA CUDZEGO POŚWIADCZENIA. Zimny start bez sieci podnosi sesję
//      wyłącznie dla skrótu TEGO tokenu - inny token (nowe urządzenie na tym
//      samym telefonie) nie może otworzyć poprzedniego wydarzenia.
//   3. LISTA CUDZEGO URZĄDZENIA jako baza decyzji offline.
//   4. DANE OSOBOWE ZOSTAJĄ PO ODŁĄCZENIU. `wipeOfflineSession` kasuje sesję,
//      listę i dziennik - ale NIE odrzucone i konflikty (jedyny ślad skanów,
//      których baza nie przyjęła).
//   5. AWARIA IndexedDB WYWRACA SKANER zamiast przejść na pamięć karty
//      (prywatne okno Safari, zablokowana baza, przerwana transakcja).
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ScannerSession } from "@/lib/events/scannerSession";
import type { RosterSnapshot } from "@/lib/events/scannerRoster";

type StorageModule = typeof import("@/lib/events/scannerOfflineStorage");

async function freshModule(): Promise<StorageModule> {
  vi.resetModules();
  return import("@/lib/events/scannerOfflineStorage");
}

const SESSION: ScannerSession = {
  deviceId: "d1",
  label: "Brama 1",
  scopes: ["checkin"],
  expiresAt: "2026-09-27T18:00:00.000Z",
  pinnedCheckpointId: null,
  sponsorId: null,
  offlineRoster: true,
  rosterDownloadedAt: null,
  serverNow: "2026-09-26T08:00:00.000Z",
  event: {
    id: "e1",
    slug: "kongres",
    titlePl: "Kongres",
    titleEn: "Congress",
    startsAt: null,
    endsAt: null,
    timezone: "Europe/Warsaw",
  },
  checkpoints: [],
};

const ROSTER: RosterSnapshot = {
  deviceId: "d1",
  generatedAt: "2026-09-26T08:00:00.000Z",
  rows: [
    {
      registrationId: "r1",
      hash: "a".repeat(64),
      badgeHash: null,
      supersededHashes: [],
      status: "approved",
      firstName: "Anna",
      lastName: null,
      company: null,
      ticketNamePl: null,
      ticketNameEn: null,
      groupNamePl: null,
      groupNameEn: null,
      groupColor: null,
      badgePrinted: false,
    },
  ],
};

/* ------------------------------------------------ atrapa IndexedDB --- */

interface FakeOptions {
  open?: "success" | "error" | "blocked" | "throw";
  upgradeNeeded?: boolean;
  stores?: string[];
  transactionThrows?: boolean;
  getFails?: boolean;
  tx?: "complete" | "error" | "abort";
}

interface FakeSpy {
  opens: Array<{ name: string; version: number }>;
  created: string[];
  data: Map<unknown, unknown>;
  closes: number;
}

interface FakeRequest {
  result: unknown;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
  onupgradeneeded: (() => void) | null;
  onblocked: (() => void) | null;
}

function request(result: unknown): FakeRequest {
  return { result, onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null };
}

function installFakeIdb(options: FakeOptions = {}, data = new Map<unknown, unknown>()): FakeSpy {
  const spy: FakeSpy = { opens: [], created: [], data, closes: 0 };
  const stores = new Set(options.stores ?? ["records"]);
  const db = {
    objectStoreNames: { contains: (name: string) => stores.has(name) },
    createObjectStore: (name: string) => {
      stores.add(name);
      spy.created.push(name);
    },
    close: () => {
      spy.closes += 1;
    },
    transaction: () => {
      if (options.transactionThrows === true) throw new Error("InvalidStateError");
      const tx = {
        oncomplete: null as (() => void) | null,
        onerror: null as (() => void) | null,
        onabort: null as (() => void) | null,
        objectStore: () => ({
          get: (key: unknown) => {
            const req = request(undefined);
            queueMicrotask(() => {
              if (options.getFails === true) {
                req.onerror?.();
                return;
              }
              req.result = data.get(key);
              req.onsuccess?.();
            });
            return req;
          },
          put: (value: unknown, key: unknown) => {
            data.set(key, value);
          },
          delete: (key: unknown) => {
            data.delete(key);
          },
        }),
      };
      queueMicrotask(() => {
        const outcome = options.tx ?? "complete";
        if (outcome === "complete") tx.oncomplete?.();
        else if (outcome === "error") tx.onerror?.();
        else tx.onabort?.();
      });
      return tx;
    },
  };
  vi.stubGlobal("indexedDB", {
    open: (name: string, version: number) => {
      spy.opens.push({ name, version });
      if (options.open === "throw") throw new Error("SecurityError");
      const req = request(db);
      queueMicrotask(() => {
        if (options.open === "error") req.onerror?.();
        else if (options.open === "blocked") req.onblocked?.();
        else {
          if (options.upgradeNeeded === true) req.onupgradeneeded?.();
          req.onsuccess?.();
        }
      });
      return req;
    },
  });
  return spy;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("baza trybu offline", () => {
  it("to OSOBNA baza `nes-scanner-offline` w wersji 1 z jednym magazynem", async () => {
    const spy = installFakeIdb({ upgradeNeeded: true, stores: [] });
    const storage = await freshModule();

    await storage.saveDecisionLog([]);

    expect(spy.opens[0]).toEqual({ name: "nes-scanner-offline", version: 1 });
    expect(spy.created).toEqual(["records"]);
    expect(storage.isOfflineStoragePersistent()).toBe(true);
  });

  it("migracja nie zakłada magazynu drugi raz", async () => {
    const spy = installFakeIdb({ upgradeNeeded: true });
    const storage = await freshModule();

    await storage.saveDecisionLog([]);

    expect(spy.created).toEqual([]);
  });

  it("każde połączenie jest zamykane - otwarte blokowałoby migrację innej karty", async () => {
    const spy = installFakeIdb();
    const storage = await freshModule();

    await storage.saveRejected([]);
    await storage.loadRejected();

    expect(spy.closes).toBe(2);
  });
});

describe("sesja bez tokenu", () => {
  it("wraca WYŁĄCZNIE dla skrótu tego samego tokenu, przez parser odpowiedzi serwera", async () => {
    installFakeIdb();
    const storage = await freshModule();
    await storage.saveCachedSession({
      tokenHash: "hash-a",
      session: SESSION,
      serverOffsetMs: 1500,
      savedAt: "2026-09-26T08:00:01.000Z",
    });

    await expect(storage.loadCachedSession("hash-a")).resolves.toEqual({
      tokenHash: "hash-a",
      session: SESSION,
      serverOffsetMs: 1500,
      savedAt: "2026-09-26T08:00:01.000Z",
    });
    await expect(storage.loadCachedSession("hash-b")).resolves.toBeNull();
  });

  it("rekord bez tokenu - ani jawnego, ani w innym polu", async () => {
    const spy = installFakeIdb();
    const storage = await freshModule();
    await storage.saveCachedSession({
      tokenHash: "hash-a",
      session: SESSION,
      serverOffsetMs: 0,
      savedAt: "x",
    });

    const stored = JSON.stringify(spy.data.get("session"));
    expect(stored).not.toContain("device_token");
    expect(Object.keys(spy.data.get("session") as object).sort()).toEqual([
      "savedAt",
      "serverOffsetMs",
      "session",
      "tokenHash",
    ]);
  });

  it("uszkodzony rekord sesji to brak sesji, a złe pola pomocnicze mają wartości domyślne", async () => {
    const data = new Map<unknown, unknown>();
    installFakeIdb({}, data);
    const storage = await freshModule();

    data.set("session", ["nie-obiekt"]);
    await expect(storage.loadCachedSession("h")).resolves.toBeNull();
    data.set("session", null);
    await expect(storage.loadCachedSession("h")).resolves.toBeNull();
    data.set("session", { tokenHash: "h", session: { device_id: "d1" } });
    await expect(storage.loadCachedSession("h")).resolves.toBeNull();
    data.set("session", {
      tokenHash: "h",
      session: { device_id: "d1", event: { id: "e1" } },
      serverOffsetMs: Number.NaN,
      savedAt: 5,
    });
    await expect(storage.loadCachedSession("h")).resolves.toMatchObject({
      serverOffsetMs: 0,
      savedAt: "",
    });
  });
});

describe("lista, dziennik, odrzucone i konflikty", () => {
  it("lista wraca dla swojego urządzenia, a zapis `null` ją kasuje", async () => {
    const data = new Map<unknown, unknown>();
    installFakeIdb({}, data);
    const storage = await freshModule();

    await storage.saveRoster(ROSTER);
    await expect(storage.loadRoster("d1")).resolves.toEqual(ROSTER);
    await expect(storage.loadRoster("inne-urzadzenie")).resolves.toBeNull();

    await storage.saveRoster(null);
    expect(data.has("roster")).toBe(false);
    await expect(storage.loadRoster("d1")).resolves.toBeNull();
  });

  it("dziennik zgód, odrzucone i konflikty przechodzą przez zapis i odczyt", async () => {
    installFakeIdb();
    const storage = await freshModule();
    const log = [{ checkpointId: "c1", registrationId: "r1", direction: "in" as const, at: "x" }];

    await storage.saveDecisionLog(log);
    await storage.saveRejected([]);
    await storage.saveConflicts([]);

    await expect(storage.loadDecisionLog()).resolves.toEqual(log);
    await expect(storage.loadRejected()).resolves.toEqual([]);
    await expect(storage.loadConflicts()).resolves.toEqual([]);
  });

  it("odłączenie kasuje sesję, znacznik, listę i dziennik - ale NIE odrzucone i konflikty", async () => {
    const data = new Map<unknown, unknown>([
      ["session", {}],
      ["marker", {}],
      ["roster", {}],
      ["log", []],
      ["rejected", ["x"]],
      ["conflicts", ["y"]],
    ]);
    installFakeIdb({}, data);
    const storage = await freshModule();

    await storage.wipeOfflineSession();

    expect([...data.keys()].sort()).toEqual(["conflicts", "rejected"]);
  });

  it("wygaśnięcie kasuje listę i dziennik, zostawia sesję i znacznik kolejki", async () => {
    // Znacznik (OPS-12) nie jest daną osobową; pozycje w kolejce mają własny
    // stempel, a nowego skanu po terminie i tak nie będzie.
    const data = new Map<unknown, unknown>([
      ["session", {}],
      ["marker", {}],
      ["roster", {}],
      ["log", []],
    ]);
    installFakeIdb({}, data);
    const storage = await freshModule();

    await storage.wipeRoster();

    expect([...data.keys()]).toEqual(["session", "marker"]);
  });

  it("świadome wyczyszczenie kasuje odrzucone i konflikty", async () => {
    const data = new Map<unknown, unknown>([
      ["session", {}],
      ["rejected", []],
      ["conflicts", []],
    ]);
    installFakeIdb({}, data);
    const storage = await freshModule();

    await storage.clearSyncIssues();

    expect([...data.keys()]).toEqual(["session"]);
  });
});

describe("brak trwałości to stan, nie awaria", () => {
  it.each(["error", "blocked", "throw"] as const)(
    "otwarcie `%s` - praca z pamięci karty i sygnał dla ekranu gotowości",
    async (open) => {
      installFakeIdb({ open });
      const storage = await freshModule();

      await storage.saveRoster(ROSTER);

      await expect(storage.loadRoster("d1")).resolves.toEqual(ROSTER);
      expect(storage.isOfflineStoragePersistent()).toBe(false);
      await storage.saveRoster(null);
      await expect(storage.loadRoster("d1")).resolves.toBeNull();
    },
  );

  it("przeglądarka bez IndexedDB też pracuje z pamięci", async () => {
    vi.stubGlobal("indexedDB", undefined);
    const storage = await freshModule();

    await storage.saveConflicts([]);

    await expect(storage.loadConflicts()).resolves.toEqual([]);
    expect(storage.isOfflineStoragePersistent()).toBe(false);
  });

  it("bez `window` (render na serwerze) nie sięga po IndexedDB", async () => {
    const storage = await freshModule();
    vi.stubGlobal("window", undefined);

    await expect(storage.loadDecisionLog()).resolves.toEqual([]);
    expect(storage.isOfflineStoragePersistent()).toBe(false);
  });

  it("błąd odczytu oddaje kopię z pamięci karty", async () => {
    installFakeIdb({ getFails: true });
    const storage = await freshModule();
    await storage.saveDecisionLog([
      { checkpointId: "c1", registrationId: "r1", direction: "in", at: "x" },
    ]);

    await expect(storage.loadDecisionLog()).resolves.toHaveLength(1);
    expect(storage.isOfflineStoragePersistent()).toBe(false);
  });

  it("transakcja, która rzuca, nie wywraca odczytu ani zapisu", async () => {
    installFakeIdb({ transactionThrows: true });
    const storage = await freshModule();

    await storage.saveRejected([]);
    await expect(storage.loadRejected()).resolves.toEqual([]);
    expect(storage.isOfflineStoragePersistent()).toBe(false);
  });

  it.each(["error", "abort"] as const)(
    "przerwana transakcja zapisu (`%s`) przełącza na pamięć karty",
    async (tx) => {
      installFakeIdb({ tx });
      const storage = await freshModule();

      await storage.saveConflicts([]);

      expect(storage.isOfflineStoragePersistent()).toBe(false);
    },
  );
});

/* ------------------------------------------- OPS-06: dane osobowe i kody --- */

describe("OPS-06: lista osób ma termin, odrzucone nie mają kodu, odłączenie kasuje wszystko", () => {
  const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
  const NOW = Date.parse("2026-09-26T12:00:00.000Z");

  it("lista z terminem poświadczenia znika po nim - razem z dziennikiem zgód", async () => {
    const data = new Map<unknown, unknown>([["log", [{ checkpointId: "c1" }]]]);
    installFakeIdb({}, data);
    const storage = await freshModule();
    await storage.saveRoster({ ...ROSTER, expiresAt: "2026-09-26T11:59:59.000Z" });
    expect(data.get("roster")).toMatchObject({ expiresAt: "2026-09-26T11:59:59.000Z" });

    await expect(storage.purgeExpiredRoster(NOW)).resolves.toBe(true);
    expect(data.has("roster")).toBe(false);
    expect(data.has("log")).toBe(false);
    await expect(storage.purgeExpiredRoster(NOW)).resolves.toBe(false);
  });

  it("lista bez własnego terminu bierze go z sesji TEGO urządzenia; uszkodzona znika", async () => {
    const data = new Map<unknown, unknown>();
    installFakeIdb({}, data);
    const storage = await freshModule();
    await storage.saveCachedSession({
      tokenHash: "h",
      session: SESSION,
      serverOffsetMs: 0,
      savedAt: "x",
    });
    await storage.saveRoster(ROSTER);

    // SESSION.expiresAt = 2026-09-27T18:00Z - jeszcze ważna.
    await expect(storage.purgeExpiredRoster(NOW)).resolves.toBe(false);
    await expect(storage.purgeExpiredRoster(Date.parse("2026-09-28T00:00:00.000Z"))).resolves.toBe(
      true,
    );
    expect(data.has("roster")).toBe(false);

    data.set("roster", { nie: "lista" });
    await expect(storage.purgeExpiredRoster(NOW)).resolves.toBe(true);
    expect(data.has("roster")).toBe(false);
  });

  it("lista odrzuconych zapisuje skrót i prefiks - wpis sprzed sejfu jest przepisywany przy odczycie", async () => {
    const data = new Map<unknown, unknown>([
      [
        "rejected",
        [
          {
            item: {
              id: "s1",
              kind: "checkin",
              code: "QR-JAWNY-KOD-1",
              checkpointId: null,
              direction: "in",
              note: null,
              interestRating: null,
              deviceScannedAt: "x",
              attempts: 0,
              nextAttemptAt: "x",
              lastError: null,
            },
            error: "device_revoked: x",
            rejectedAt: "y",
          },
        ],
      ],
    ]);
    installFakeIdb({}, data);
    const storage = await freshModule();

    const [entry] = await storage.loadRejected();
    expect(entry.item).toMatchObject({ codeHash: sha("QR-JAWNY-KOD-1"), codePrefix: "QR-JAW" });
    expect(entry.item).not.toHaveProperty("code");
    expect(JSON.stringify(data.get("rejected"))).not.toContain("QR-JAWNY-KOD-1");
    expect(data.get("rejected")).toEqual([
      expect.objectContaining({
        item: expect.objectContaining({ codeHash: sha("QR-JAWNY-KOD-1") }),
      }),
    ]);
  });

  it("odłączenie kasuje sesję, znacznik, listę, dziennik, odrzucone i konflikty", async () => {
    const data = new Map<unknown, unknown>([
      ["session", {}],
      ["marker", {}],
      ["roster", {}],
      ["log", []],
      ["rejected", ["x"]],
      ["conflicts", ["y"]],
    ]);
    installFakeIdb({}, data);
    const storage = await freshModule();

    await storage.wipeAllOfflineData();

    expect([...data.keys()]).toEqual([]);
  });
});

describe("OPS-12: znacznik kolejki na dysku wyłącznie w sejfie", () => {
  const MARKER = {
    value: "AAAAAGkAAAA" + "x".repeat(43),
    validUntil: "2026-09-27T08:00:00.000Z",
  };

  async function vaultKey(token: string): Promise<CryptoKey> {
    const { deriveVaultKey } = await import("@/lib/events/scannerVault");
    const derived = await deriveVaultKey(token);
    if (derived === null) throw new Error("test: brak WebCrypto w środowisku testowym");
    return derived;
  }

  it("zapis szyfruje znacznik kluczem tokenu, a odczyt oddaje go TYLKO temu urządzeniu", async () => {
    const data = new Map<unknown, unknown>();
    installFakeIdb({}, data);
    const storage = await freshModule();
    const key = await vaultKey("token-urzadzenia-0123456789");

    await expect(storage.saveQueueMarker("d1", MARKER, key)).resolves.toBe(true);

    // Na dysku nie ma napisu znacznika - jest blok sejfu i urządzenie.
    const stored = data.get("marker") as Record<string, unknown>;
    expect(stored.deviceId).toBe("d1");
    expect(stored.sealed).toMatchObject({ iv: expect.any(String), data: expect.any(String) });
    expect(JSON.stringify([...data.values()])).not.toContain(MARKER.value);

    await expect(storage.loadQueueMarker("d1", key)).resolves.toEqual(MARKER);
    // Inne urządzenie i klucz innego poświadczenia nie dostają nic.
    await expect(storage.loadQueueMarker("d2", key)).resolves.toBeNull();
    await expect(
      storage.loadQueueMarker("d1", await vaultKey("inny-token-urzadzenia-987654")),
    ).resolves.toBeNull();
  });

  it("blok przełożony do innego urządzenia się nie otwiera (AAD wiąże go z urządzeniem)", async () => {
    const data = new Map<unknown, unknown>();
    installFakeIdb({}, data);
    const storage = await freshModule();
    const key = await vaultKey("token-urzadzenia-0123456789");
    await storage.saveQueueMarker("d1", MARKER, key);

    const stored = data.get("marker") as Record<string, unknown>;
    data.set("marker", { ...stored, deviceId: "d2" });

    await expect(storage.loadQueueMarker("d2", key)).resolves.toBeNull();
  });

  it("bez klucza (brak WebCrypto) znacznik NIE trafia na dysk wcale", async () => {
    const data = new Map<unknown, unknown>();
    installFakeIdb({}, data);
    const storage = await freshModule();

    await expect(storage.saveQueueMarker("d1", MARKER, null)).resolves.toBe(false);
    await expect(storage.loadQueueMarker("d1", null)).resolves.toBeNull();
    expect(data.has("marker")).toBe(false);
  });

  it("odłączenie w trakcie szyfrowania - zapis się nie odbywa", async () => {
    const data = new Map<unknown, unknown>();
    installFakeIdb({}, data);
    const storage = await freshModule();
    const key = await vaultKey("token-urzadzenia-0123456789");

    await expect(storage.saveQueueMarker("d1", MARKER, key, () => false)).resolves.toBe(false);
    expect(data.has("marker")).toBe(false);
  });
});
