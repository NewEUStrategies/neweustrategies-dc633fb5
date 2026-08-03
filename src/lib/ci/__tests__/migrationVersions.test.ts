// Kontrakt bramki unikalności wersji migracji + jej self-test na REALNYM
// katalogu migracji.
//
// Bramka istnieje, bo audyt rekomendował ją przez trzy wydania, a przy trzecim
// incydencie kolizja przestała być ryzykiem i przewróciła CI: `supabase db start`
// padał na `schema_migrations_pkey`, więc joby `pgtap`/`e2e`/`e2e-seeded` nie
// startowały, a żadna migracja po kolizji nie była już walidowana.
import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  analyzeMigrationVersions,
  migrationVersionsFailed,
  renderMigrationVersionReport,
} from "@/lib/ci/migrationVersions";

describe("analyzeMigrationVersions", () => {
  it("przechodzi dla unikalnych, rosnących wersji", () => {
    const report = analyzeMigrationVersions([
      "20260101000000_a.sql",
      "20260101000001_b.sql",
      "20260102000000_c.sql",
    ]);
    expect(report.total).toBe(3);
    expect(migrationVersionsFailed(report)).toBe(false);
    expect(renderMigrationVersionReport(report)).toContain("✓");
  });

  it("łapie DOKŁADNIE tę kolizję, która przewróciła CI (trzy pliki, jedna wersja)", () => {
    const report = analyzeMigrationVersions([
      "20260803090000_harden_enqueue_notification_acl.sql",
      "20260803090000_link_monitor_archive_and_alerts.sql",
      "20260803090000_payment_orders_gdpr_retention.sql",
    ]);
    expect(migrationVersionsFailed(report)).toBe(true);
    expect(report.duplicates.get("20260803090000")).toHaveLength(3);
    const rendered = renderMigrationVersionReport(report);
    expect(rendered).toContain("KLUCZ GŁÓWNY");
    // Raport musi POWIEDZIEĆ, jak naprawić - inaczej bramka tylko blokuje.
    expect(rendered).toContain("przenumeruj");
  });

  it("wskazuje wszystkie pliki kolizji, nie tylko drugi", () => {
    const report = analyzeMigrationVersions(["20260101000000_a.sql", "20260101000000_b.sql"]);
    expect(report.duplicates.get("20260101000000")).toEqual([
      "20260101000000_a.sql",
      "20260101000000_b.sql",
    ]);
  });

  it("zgłasza nazwę bez parsowalnej wersji", () => {
    const report = analyzeMigrationVersions(["init.sql", "2026_short.sql"]);
    expect(report.unparsable).toEqual(["2026_short.sql", "init.sql"]);
    expect(migrationVersionsFailed(report)).toBe(true);
    expect(renderMigrationVersionReport(report)).toContain("14 cyfr");
  });

  it("nie myli się na tej samej wersji w różnych opisach (to nadal kolizja)", () => {
    const report = analyzeMigrationVersions([
      "20260803090000_aaa.sql",
      "20260803090001_bbb.sql",
      "20260803090001_ccc.sql",
    ]);
    expect([...report.duplicates.keys()]).toEqual(["20260803090001"]);
  });

  it("ignoruje kolejność wejścia - analiza sortuje sama", () => {
    const a = analyzeMigrationVersions(["20260102000000_b.sql", "20260101000000_a.sql"]);
    const b = analyzeMigrationVersions(["20260101000000_a.sql", "20260102000000_b.sql"]);
    expect(migrationVersionsFailed(a)).toBe(false);
    expect(a).toEqual(b);
  });
});

describe("self-test na realnym katalogu supabase/migrations", () => {
  const files = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql"));

  it("katalog nie jest pusty (bramka bez wejścia byłaby zawsze zielona)", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("ŻADNA wersja się nie powtarza - bazę da się odtworzyć z migracji", () => {
    const report = analyzeMigrationVersions(files);
    expect(
      [...report.duplicates.entries()].map(([v, g]) => `${v}: ${g.join(", ")}`),
      "zduplikowana wersja = supabase db start pada na schema_migrations_pkey",
    ).toEqual([]);
  });

  it("każda nazwa ma parsowalną wersję i porządek nazw = porządek wersji", () => {
    const report = analyzeMigrationVersions(files);
    expect(report.unparsable).toEqual([]);
    expect(report.outOfOrder).toEqual([]);
    expect(migrationVersionsFailed(report)).toBe(false);
  });
});
