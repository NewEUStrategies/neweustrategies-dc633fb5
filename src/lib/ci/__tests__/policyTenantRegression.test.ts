// Testy bramki „polityka nie gubi wiązania z najemcą". Konwencja repo:
// inwariant CI ma test, a nie tylko przebieg w CI - inaczej sam skaner nie ma
// jak umrzeć na czerwono, gdy przestanie cokolwiek widzieć.
//
// Scenariusze odwzorowują REALNY przebieg zdarzeń z 2026-08-14 na buckecie
// `career-cv`: zawężenie do najemcy, wygenerowany plik cofający je, i bliźniak,
// który przypadkiem przywrócił stan. Bramka musi rozróżnić te trzy sytuacje.
import { describe, expect, it } from "vitest";
import {
  analyzePolicyTenantRegressions,
  bindsTenant,
  policyTenantRegressionFailed,
  regressionKey,
  renderPolicyTenantRegressionReport,
  type PolicyTenantGaps,
} from "@/lib/ci/policyTenantRegression";
import { extractLatestPolicies, extractPolicyHistory } from "@/lib/ci/rlsPolicies";
import type { MigrationFile } from "@/lib/ci/dbContract";

/** Polityka zawężona do najemcy - kształt z 20260814100000. */
const HARDENED = `
DROP POLICY IF EXISTS "career_cv_staff_read" ON storage.objects;
CREATE POLICY "career_cv_staff_read"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'career-cv'
  AND public.is_staff()
  AND (storage.foldername(name))[1] = public.current_tenant_id()::text
);
`;

/** Ta sama polityka odtworzona BEZ najemcy - kształt z 20260814122512. */
const WEAKENED = `
DROP POLICY IF EXISTS "career_cv_staff_read" ON storage.objects;
CREATE POLICY "career_cv_staff_read"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'career-cv' AND public.is_staff());
`;

function analyze(files: readonly MigrationFile[], known: PolicyTenantGaps = {}) {
  return analyzePolicyTenantRegressions(
    extractPolicyHistory(files),
    extractLatestPolicies(files),
    known,
  );
}

describe("policyTenantRegression - wiązanie najemcy w politykach", () => {
  it("rozpoznaje wiązanie po current_tenant_id, public_tenant_id i kolumnie tenant_id", () => {
    const policies = extractLatestPolicies([
      {
        file: "001.sql",
        sql: [
          'CREATE POLICY "a" ON public.t1 FOR SELECT USING (tenant_id = public_tenant_id());',
          'CREATE POLICY "b" ON public.t2 FOR SELECT USING (x = current_tenant_id());',
          'CREATE POLICY "c" ON public.t3 FOR SELECT USING (m.tenant_id = 1);',
          'CREATE POLICY "d" ON public.t4 FOR SELECT USING (public.is_staff());',
        ].join("\n"),
      },
    ]);
    expect(bindsTenant(policies.get("t1::a")!)).toBe(true);
    expect(bindsTenant(policies.get("t2::b")!)).toBe(true);
    expect(bindsTenant(policies.get("t3::c")!)).toBe(true);
    expect(bindsTenant(policies.get("t4::d")!)).toBe(false);
  });

  it("widzi wiązanie w WITH CHECK, nie tylko w USING", () => {
    const policies = extractLatestPolicies([
      {
        file: "001.sql",
        sql: 'CREATE POLICY "w" ON public.t FOR INSERT WITH CHECK (tenant_id = current_tenant_id());',
      },
    ]);
    expect(bindsTenant(policies.get("t::w")!)).toBe(true);
  });

  it("BLOKUJE, gdy obowiązująca definicja zgubiła wiązanie", () => {
    const report = analyze([
      { file: "100000_hardening.sql", sql: HARDENED },
      { file: "122512_generated.sql", sql: WEAKENED },
    ]);
    expect(report.open.map(regressionKey)).toEqual(["objects::career_cv_staff_read"]);
    expect(report.open[0].hardenedIn).toBe("100000_hardening.sql");
    expect(report.open[0].weakenedIn).toBe("122512_generated.sql");
    expect(policyTenantRegressionFailed(report)).toBe(true);
  });

  it("NIE blokuje, gdy późniejsza migracja przywróciła wiązanie - ale raportuje", () => {
    const report = analyze([
      { file: "100000_hardening.sql", sql: HARDENED },
      { file: "122512_generated.sql", sql: WEAKENED },
      { file: "122639_twin.sql", sql: HARDENED },
    ]);
    expect(report.open).toEqual([]);
    expect(report.healed.map(regressionKey)).toEqual(["objects::career_cv_staff_read"]);
    expect(report.healed[0].weakenedIn).toBe("122512_generated.sql");
    expect(policyTenantRegressionFailed(report)).toBe(false);
  });

  it("polityka, która NIGDY nie wiązała najemcy, nie jest cofnięciem", () => {
    const report = analyze([
      { file: "001.sql", sql: WEAKENED },
      { file: "002.sql", sql: WEAKENED },
    ]);
    expect(report.open).toEqual([]);
    expect(report.healed).toEqual([]);
  });

  it("polityka SKASOWANA na końcu łańcucha nie jest cofnięciem - brak polityki nie wpuszcza nikogo", () => {
    const report = analyze([
      { file: "001.sql", sql: HARDENED },
      { file: "002.sql", sql: WEAKENED },
      { file: "003.sql", sql: 'DROP POLICY IF EXISTS "career_cv_staff_read" ON storage.objects;' },
    ]);
    expect(report.open).toEqual([]);
    expect(policyTenantRegressionFailed(report)).toBe(false);
  });

  it("wpis długu wycisza znane cofnięcie, ale nie nowe", () => {
    const known: PolicyTenantGaps = { "objects::career_cv_staff_read": "dług zastany" };
    const report = analyze(
      [
        { file: "001.sql", sql: HARDENED },
        { file: "002.sql", sql: WEAKENED },
        {
          file: "003.sql",
          sql: [
            'CREATE POLICY "inna" ON public.t FOR SELECT USING (tenant_id = current_tenant_id());',
            'DROP POLICY IF EXISTS "inna" ON public.t;',
            'CREATE POLICY "inna" ON public.t FOR SELECT USING (public.is_staff());',
          ].join("\n"),
        },
      ],
      known,
    );
    expect(report.known.map(regressionKey)).toEqual(["objects::career_cv_staff_read"]);
    expect(report.open.map(regressionKey)).toEqual(["t::inna"]);
    expect(policyTenantRegressionFailed(report)).toBe(true);
  });

  it("wpis długu bez odpowiadającego cofnięcia oblewa - lista ma maleć", () => {
    const known: PolicyTenantGaps = { "objects::career_cv_staff_read": "już naprawione" };
    const report = analyze([{ file: "001.sql", sql: HARDENED }], known);
    expect(report.staleKnown).toEqual(["objects::career_cv_staff_read"]);
    expect(policyTenantRegressionFailed(report)).toBe(true);
    expect(renderPolicyTenantRegressionReport(report, known)).toContain("USUŃ je");
  });

  it("pusty katalog migracji OBLEWA - milczący skaner wygląda jak zielony", () => {
    const report = analyze([]);
    expect(report.totalPolicies).toBe(0);
    expect(policyTenantRegressionFailed(report)).toBe(true);
    expect(renderPolicyTenantRegressionReport(report)).toContain("zepsuty parser");
  });

  it("raport liczy polityki stanu końcowego i te z wiązaniem", () => {
    const report = analyze([
      {
        file: "001.sql",
        sql: [
          'CREATE POLICY "a" ON public.t1 FOR SELECT USING (tenant_id = current_tenant_id());',
          'CREATE POLICY "b" ON public.t2 FOR SELECT USING (true);',
        ].join("\n"),
      },
    ]);
    expect(report.totalPolicies).toBe(2);
    expect(report.tenantBound).toBe(1);
    expect(renderPolicyTenantRegressionReport(report)).toContain("2 polityk w stanie końcowym");
  });
});
