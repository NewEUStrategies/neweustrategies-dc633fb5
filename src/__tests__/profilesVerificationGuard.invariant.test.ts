/**
 * Bramka inwariantu: WERYFIKACJĘ PROFILU ZMIENIA CAŁY STAFF, NIE SAM `admin`.
 *
 * PRZYCZYNA ŹRÓDŁOWA (06.08). `profiles_guard_verification` dostał 05.08
 * kontrakt „verified_at/verified_by tylko dla personelu" z dwiema rolami
 * jawnie wymienionymi w warunku. Nazajutrz migracja 20260806094104 przepisała
 * funkcję (dokładając furtkę `app.verification_sync` dla sweepu domenowego)
 * i przy okazji ZGUBIŁA gałąź `super_admin`.
 *
 * Dlaczego to nie jest kosmetyka: `public.has_role()` dopasowuje rolę
 * DOKŁADNIE (`ur.role = _role`, 20260625160054) - w tym schemacie NIE MA
 * hierarchii ról. Konto mające wyłącznie `super_admin` przestało więc
 * przechodzić bramkę i trafiało w `RAISE EXCEPTION`. Utrata uprawnienia jest
 * cicha: dotyczy roli, której nie używa się w testach dymnych, a pgTAP guardu
 * sprawdzał wtedy wyłącznie STRUKTURĘ (funkcja istnieje / trigger wpięty /
 * SECURITY DEFINER), więc zachowanie przeszło bez asercji.
 *
 * Dlaczego akurat taka bramka: rozjazd wyłapał test parytetu snapshotu
 * autoryzacji - ale ten test porównuje snapshot z migracjami, więc dawało się
 * go „naprawić" regeneracją snapshotu, **utrwalając regresję**. Ten inwariant
 * mówi wprost, jaki zbiór ról jest wymagany, i regeneracja go nie ucisza.
 *
 * Test jest statyczny (bez bazy): liczy się OSTATNIA definicja funkcji
 * w forward-only migracjach, nie fakt, że migracja naprawcza istnieje.
 */
import { describe, it, expect } from "vitest";

import { extractLatestDefinitions, type FnDef } from "../../scripts/lib/sqlMigrations";

const LATEST = extractLatestDefinitions();

function latest(name: string, arity = 0): FnDef {
  const def = LATEST.get(`public.${name}/${arity}`);
  expect(def, `brak funkcji public.${name}/${arity} w migracjach`).toBeDefined();
  return def!;
}

/** `has_role(<cokolwiek>, 'rola')` - z opcjonalnym rzutowaniem na enum. */
function checksRole(body: string, role: string): boolean {
  return new RegExp(`has_role\\s*\\([^,()]*(?:\\([^()]*\\))?[^,()]*,\\s*'${role}'`, "i").test(body);
}

describe("profiles_guard_verification: stan końcowy migracji", () => {
  it("przepuszcza rolę admin", () => {
    expect(checksRole(latest("profiles_guard_verification").body, "admin")).toBe(true);
  });

  it("przepuszcza rolę super_admin (regresja z 20260806094104)", () => {
    const def = latest("profiles_guard_verification");
    expect(
      checksRole(def.body, "super_admin"),
      `Ostatnia definicja profiles_guard_verification (${def.file}) nie sprawdza roli 'super_admin'. ` +
        "has_role() dopasowuje rolę DOKŁADNIE - bez tej gałęzi super_admin nie może " +
        "nadać ani zdjąć weryfikacji i dostaje wyjątek zamiast przejść bramkę. " +
        "Wymieniaj OBIE role jawnie przy każdym CREATE OR REPLACE tej funkcji.",
    ).toBe(true);
  });

  it("nadal odrzuca zmianę wyjątkiem, a nie cichym revertem", () => {
    const body = latest("profiles_guard_verification").body;
    expect(
      /RAISE\s+EXCEPTION/i.test(body),
      "guard musi ODMÓWIĆ jawnie: cicha korekta wartości nie zostawia śladu w logu " +
        "i nie odróżnia próby nadużycia od zwykłego zapisu.",
    ).toBe(true);
  });

  it("zachowuje furtkę sweepu domenowego (app.verification_sync)", () => {
    const body = latest("profiles_guard_verification").body;
    expect(
      /app\.verification_sync/.test(body),
      "sweep weryfikacji domenowej (runOrgVerificationSweep) działa bez auth.uid() " +
        "i musi mieć jawną furtkę - inaczej masowa weryfikacja po domenie przestaje działać.",
    ).toBe(true);
  });

  it("działa jako SECURITY DEFINER z przypiętym search_path", () => {
    // Atrybuty (LANGUAGE / SECURITY DEFINER / SET) są poza ciałem dollar-quote.
    const { attrs } = latest("profiles_guard_verification");
    expect(/SECURITY\s+DEFINER/i.test(attrs)).toBe(true);
    expect(/SET\s+search_path/i.test(attrs)).toBe(true);
  });
});
