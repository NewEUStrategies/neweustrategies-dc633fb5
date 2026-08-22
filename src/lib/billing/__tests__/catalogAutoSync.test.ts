// Kontrakt automatycznej synchronizacji katalogu po restarcie integracji:
// zmiana odcisku połączenia z operatorem musi wymusić odtworzenie katalogu,
// a spójny i świeży stan - nie wywoływać zbędnych zapytań do operatora.
import { describe, expect, it } from "vitest";

import {
  CATALOG_SYNC_RETRY_MS,
  CATALOG_SYNC_TTL_MS,
  catalogFingerprintSource,
  resyncReason,
  syncStatusFrom,
} from "@/lib/billing/catalogAutoSync";

const now = new Date("2026-07-29T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

describe("resyncReason", () => {
  it("pierwsze uruchomienie bez zapisanego stanu", () => {
    expect(
      resyncReason({
        fingerprint: null,
        lastSyncedAt: null,
        lastStatus: null,
        currentFingerprint: "abc",
        now,
      }),
    ).toBe("first_run");
  });

  it("zmiana odcisku = restart integracji", () => {
    expect(
      resyncReason({
        fingerprint: "old",
        lastSyncedAt: ago(1000),
        lastStatus: "ok",
        currentFingerprint: "new",
        now,
      }),
    ).toBe("integration_restarted");
  });

  it("świeży i spójny stan nie uruchamia synchronizacji", () => {
    expect(
      resyncReason({
        fingerprint: "abc",
        lastSyncedAt: ago(60_000),
        lastStatus: "ok",
        currentFingerprint: "abc",
        now,
      }),
    ).toBeNull();
  });

  it("po TTL wykonuje kontrolne odświeżenie", () => {
    expect(
      resyncReason({
        fingerprint: "abc",
        lastSyncedAt: ago(CATALOG_SYNC_TTL_MS + 1),
        lastStatus: "ok",
        currentFingerprint: "abc",
        now,
      }),
    ).toBe("stale");
  });

  it("po porażce ponawia dopiero po backoffie", () => {
    const base = {
      fingerprint: "abc",
      lastStatus: "failed" as const,
      currentFingerprint: "abc",
      now,
    };
    expect(resyncReason({ ...base, lastSyncedAt: ago(60_000) })).toBeNull();
    expect(resyncReason({ ...base, lastSyncedAt: ago(CATALOG_SYNC_RETRY_MS + 1) })).toBe(
      "retry_after_failure",
    );
  });

  it("uszkodzona data traktowana jest jak brak synchronizacji", () => {
    expect(
      resyncReason({
        fingerprint: "abc",
        lastSyncedAt: "nie-data",
        lastStatus: "ok",
        currentFingerprint: "abc",
        now,
      }),
    ).toBe("first_run");
  });
});

describe("syncStatusFrom", () => {
  it("bez błędów - ok", () => {
    expect(syncStatusFrom({ failed: 0, items: [1, 2] })).toBe("ok");
  });

  it("część pozycji nieudana - partial", () => {
    expect(syncStatusFrom({ failed: 1, items: [1, 2] })).toBe("partial");
  });

  it("wszystkie pozycje nieudane - failed", () => {
    expect(syncStatusFrom({ failed: 2, items: [1, 2] })).toBe("failed");
  });
});

describe("catalog_changed", () => {
  const base = {
    fingerprint: "abc",
    currentFingerprint: "abc",
    lastSyncedAt: ago(60_000),
    lastStatus: "ok" as const,
    now,
  };

  it("zmiana cennika po wdrożeniu wymusza synchronizację", () => {
    expect(
      resyncReason({ ...base, catalogFingerprint: "cat1", currentCatalogFingerprint: "cat2" }),
    ).toBe("catalog_changed");
  });

  it("ten sam cennik nie uruchamia synchronizacji", () => {
    expect(
      resyncReason({ ...base, catalogFingerprint: "cat1", currentCatalogFingerprint: "cat1" }),
    ).toBeNull();
  });

  it("brak policzonego odcisku cennika nie wymusza synchronizacji", () => {
    expect(
      resyncReason({ ...base, catalogFingerprint: "cat1", currentCatalogFingerprint: null }),
    ).toBeNull();
  });

  it("restart integracji ma pierwszeństwo przed zmianą cennika", () => {
    expect(
      resyncReason({
        ...base,
        currentFingerprint: "new",
        catalogFingerprint: "cat1",
        currentCatalogFingerprint: "cat2",
      }),
    ).toBe("integration_restarted");
  });
});

describe("catalogFingerprintSource", () => {
  const entry = {
    priceId: "pro_monthly",
    productId: "plan_pro",
    interval: "month",
    amountCents: 4900,
    currency: "pln",
    name: "Pro",
    description: null,
    trialDays: 7,
    active: true,
    volumeThresholdSeats: null,
    volumePriceCents: null,
  };

  it("kolejność pozycji nie zmienia odcisku", () => {
    const other = { ...entry, priceId: "plus_monthly", productId: "plan_plus" };
    expect(catalogFingerprintSource([entry, other])).toBe(catalogFingerprintSource([other, entry]));
  });

  it("zmiana kwoty zmienia źródło odcisku", () => {
    expect(catalogFingerprintSource([entry])).not.toBe(
      catalogFingerprintSource([{ ...entry, amountCents: 5900 }]),
    );
  });

  it("zmiana triala lub dostępności zmienia źródło odcisku", () => {
    expect(catalogFingerprintSource([entry])).not.toBe(
      catalogFingerprintSource([{ ...entry, trialDays: 14 }]),
    );
    expect(catalogFingerprintSource([entry])).not.toBe(
      catalogFingerprintSource([{ ...entry, active: false }]),
    );
  });

  // Próg wolumenowy jest cechą CENY u operatora (`tiers_mode: "volume"`), a nie
  // tylko podsumowania zamówienia. Gdyby nie wchodził do odcisku, podniesienie
  // rabatu w bazie nie uruchomiłoby synchronizacji: cennik pokazywałby 79 zł
  // za miejsce, a operator dalej pobierałby 89.
  it("zmiana progu wolumenowego zmienia źródło odcisku", () => {
    expect(catalogFingerprintSource([entry])).not.toBe(
      catalogFingerprintSource([{ ...entry, volumeThresholdSeats: 11, volumePriceCents: 7900 }]),
    );
    expect(
      catalogFingerprintSource([{ ...entry, volumeThresholdSeats: 11, volumePriceCents: 7900 }]),
    ).not.toBe(
      catalogFingerprintSource([{ ...entry, volumeThresholdSeats: 11, volumePriceCents: 6900 }]),
    );
  });
});
