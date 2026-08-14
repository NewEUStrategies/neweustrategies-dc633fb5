// Kontrakt retencji plików CV po stronie klienta RPC.
//
// `career_cv_gc_scan` i `career_cv_gc_claim` zwracają jsonb (a nie TABLE - nazwy
// kolumn kolejki kolidowałyby z parametrami OUT w plpgsql), więc job nie może
// ufać kształtowi na słowo. Te testy trzymają parsowanie, a harness SQL
// (`scripts/careers-harness`) trzyma zachowanie samych funkcji na żywej bazie.
import { describe, expect, it } from "vitest";

import {
  CV_GC_REASONS,
  emptyRetentionResult,
  parseCvGcClaims,
  parseCvGcScan,
} from "../cvRetention";

describe("parseCvGcScan", () => {
  it("czyta liczniki skanu", () => {
    expect(parseCvGcScan({ orphans: 3, retention: 2 })).toEqual({ orphans: 3, retention: 2 });
  });

  it("znosi brakujące i nieliczbowe wartości", () => {
    expect(parseCvGcScan({})).toEqual({ orphans: 0, retention: 0 });
    expect(parseCvGcScan({ orphans: "3" })).toEqual({ orphans: 0, retention: 0 });
    expect(parseCvGcScan(null)).toEqual({ orphans: 0, retention: 0 });
    expect(parseCvGcScan("boom")).toEqual({ orphans: 0, retention: 0 });
    expect(parseCvGcScan({ orphans: Number.NaN })).toEqual({ orphans: 0, retention: 0 });
  });
});

describe("parseCvGcClaims", () => {
  it("czyta partię wydaną przez claim", () => {
    const claims = parseCvGcClaims([
      { path: "t/uploads/2026-08-14/a.pdf", reason: "orphan", attempts: 1 },
      { path: "t/uploads/2026-08-14/b.pdf", reason: "retention", attempts: 2 },
    ]);
    expect(claims).toHaveLength(2);
    expect(claims[0]).toEqual({
      path: "t/uploads/2026-08-14/a.pdf",
      reason: "orphan",
      attempts: 1,
    });
    expect(claims[1].reason).toBe("retention");
  });

  it("odrzuca pozycje bez ścieżki - job nie może zawołać remove('')", () => {
    expect(parseCvGcClaims([{ reason: "orphan" }, { path: "   " }, {}, null, 7])).toEqual([]);
  });

  it("nieznany powód degraduje do 'orphan', zamiast wywracać przebieg", () => {
    const claims = parseCvGcClaims([{ path: "t/uploads/2026-08-14/a.pdf", reason: "kosmos" }]);
    expect(claims[0].reason).toBe("orphan");
    expect(claims[0].attempts).toBe(0);
  });

  it("kształt inny niż tablica daje pustą partię", () => {
    expect(parseCvGcClaims(null)).toEqual([]);
    expect(parseCvGcClaims({ path: "x" })).toEqual([]);
    expect(parseCvGcClaims("[]")).toEqual([]);
  });
});

describe("kontrakt powodów", () => {
  it("lista powodów zgadza się z CHECK-iem kolumny `reason`", () => {
    // Migracja 20260814110000: CHECK (reason IN ('orphan','application_deleted','retention')).
    expect([...CV_GC_REASONS]).toEqual(["orphan", "application_deleted", "retention"]);
  });
});

describe("emptyRetentionResult", () => {
  it("startuje od zer - przebieg bez pracy raportuje zera, nie undefined", () => {
    expect(emptyRetentionResult()).toEqual({
      scannedOrphans: 0,
      scannedRetention: 0,
      claimed: 0,
      deleted: 0,
      failed: 0,
      pending: 0,
    });
  });
});
