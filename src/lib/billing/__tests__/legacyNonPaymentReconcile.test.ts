// Sklejanie raportów kolejnych partii uzgodnienia dawnych anulowań
// (`legacyNonPaymentReconcile.ts`, moduł wspólny serwera i panelu).
//
// CZEGO PILNUJE:
//   1. SUMY. Liczniki decyzji, zapisy, `scanned` i `candidates` to suma partii,
//      a wiersze idą w kolejności partii - panel pokazuje jeden obraz zadania.
//   2. MIEJSCE ZATRZYMANIA. Kursor, `done`, tryb i środowisko pochodzą z partii
//      PÓŹNIEJSZEJ - to ona mówi, skąd kontynuować.
//   3. ROZJAZD WERSJI. Raport serwera, który nie zna jeszcze którejś decyzji
//      (wdrożenie w trakcie przebiegu z panelu), nie zamienia licznika w `NaN`.
import { describe, expect, it } from "vitest";

import {
  LEGACY_DECISIONS,
  emptyLegacyCounts,
  mergeLegacyReconcileReports,
  type LegacyDecision,
  type LegacyReconcileReport,
  type LegacyReconcileRow,
} from "@/lib/billing/legacyNonPaymentReconcile";

function row(subscriptionId: string, decision: LegacyDecision): LegacyReconcileRow {
  return {
    subscriptionId,
    tenantId: "tenant-alfa",
    decision,
    evidence: null,
    paymentProof: null,
    cancellationReason: null,
    invoiceStatus: null,
    anchor: null,
    accessUntilBefore: null,
    accessUntilAfter: null,
    suspendTeam: false,
    applied: false,
    error: null,
  };
}

function report(overrides: Partial<LegacyReconcileReport>): LegacyReconcileReport {
  return {
    environment: "live",
    mode: "apply",
    scanned: 0,
    candidates: 0,
    counts: emptyLegacyCounts(),
    writes: { anchors: 0, paymentMarkers: 0, entitlements: 0, teams: 0 },
    rows: [],
    nextCursor: null,
    done: true,
    ...overrides,
  };
}

describe("mergeLegacyReconcileReports", () => {
  it("pierwsza partia jest raportem bez zmian", () => {
    const first = report({ scanned: 3 });

    expect(mergeLegacyReconcileReports(null, first)).toBe(first);
  });

  it("sumuje liczniki, zapisy i wiersze; kursor i `done` z partii późniejszej", () => {
    const first = report({
      scanned: 50,
      candidates: 2,
      counts: { ...emptyLegacyCounts(), clamp: 1, error: 1 },
      writes: { anchors: 1, paymentMarkers: 1, entitlements: 1, teams: 0 },
      rows: [row("sub_1", "clamp"), row("sub_2", "error")],
      nextCursor: "00000000-0000-4000-8000-000000000050",
      done: false,
    });
    const second = report({
      scanned: 7,
      candidates: 2,
      counts: { ...emptyLegacyCounts(), clamp: 1, revoke: 1 },
      writes: { anchors: 2, paymentMarkers: 0, entitlements: 1, teams: 1 },
      rows: [row("sub_3", "clamp"), row("sub_4", "revoke")],
      nextCursor: null,
      done: true,
    });

    const merged = mergeLegacyReconcileReports(first, second);

    expect(merged).toEqual({
      environment: "live",
      mode: "apply",
      scanned: 57,
      candidates: 4,
      counts: { ...emptyLegacyCounts(), clamp: 2, revoke: 1, error: 1 },
      writes: { anchors: 3, paymentMarkers: 1, entitlements: 2, teams: 1 },
      rows: [
        row("sub_1", "clamp"),
        row("sub_2", "error"),
        row("sub_3", "clamp"),
        row("sub_4", "revoke"),
      ],
      nextCursor: null,
      done: true,
    });
    // Wejścia zostają nietknięte - panel trzyma poprzedni raport w stanie.
    expect(first.rows).toHaveLength(2);
    expect(first.counts.clamp).toBe(1);
  });

  it("raport bez klucza którejś decyzji (starszy serwer) nie daje `NaN`", () => {
    const { paid: _paid, ...withoutPaid } = emptyLegacyCounts();
    const older = report({
      counts: { ...withoutPaid, clamp: 2 } as Record<LegacyDecision, number>,
    });
    const newer = report({ counts: { ...emptyLegacyCounts(), paid: 1 } });

    for (const [acc, next] of [
      [older, newer],
      [newer, older],
    ] as const) {
      const merged = mergeLegacyReconcileReports(acc, next);
      expect(LEGACY_DECISIONS.every((d) => Number.isFinite(merged.counts[d]))).toBe(true);
      expect(merged.counts).toMatchObject({ clamp: 2, paid: 1 });
    }
  });
});
