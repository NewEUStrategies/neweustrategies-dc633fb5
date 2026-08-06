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
import { readAuthzSource } from "../../scripts/lib/authzSource";
import { deriveAuthzSnapshot, gateEffectiveRoles } from "@/lib/ci/authzGates";

const LATEST = extractLatestDefinitions();

// Zbiór ról czytamy przez ROZWINIĘCIE ALIASÓW, nie regexem po ciele funkcji.
// Powód (2026-08-06): `20260806150000_profile_verification_authority.sql`
// sprowadziła decyzję „kto może" do jednego predykatu
// `can_manage_profile_verification()`, z którego czytają trigger, RPC panelu,
// RPC domen i polityka RLS. Literały ról nie stoją już w ciele guardu - stoją
// o jeden poziom niżej. Regex widział to jako UTRATĘ obu ról i świecił na
// czerwono przy uprawnieniach, które są nienaruszone; szedłby też na zielono,
// gdyby predykat po cichu zawęził krąg uprawnionych, bo w guardzie nic by się
// nie zmieniło. `deriveAuthzSnapshot` rozwija wywołania funkcji pomocniczych i
// zwraca EFEKTYWNY zbiór ról - czyli mierzy dokładnie to, o co pyta ten plik.
//
// Źródłem są MIGRACJE, nie zacommitowany snapshot, więc `generate:authz-snapshot`
// nadal nie potrafi uciszyć tej bramki (patrz akapit wyżej).
const DERIVED = deriveAuthzSnapshot(readAuthzSource());

function effectiveRoles(ref: string): string[] {
  const gate = DERIVED.roleGates.find((entry) => entry.ref === ref);
  expect(gate, `brak bramki ${ref} w snapshocie odtworzonym z migracji`).toBeDefined();
  return gateEffectiveRoles(gate!);
}

function latest(name: string, arity = 0): FnDef {
  const def = LATEST.get(`public.${name}/${arity}`);
  expect(def, `brak funkcji public.${name}/${arity} w migracjach`).toBeDefined();
  return def!;
}

describe("profiles_guard_verification: stan końcowy migracji", () => {
  it("przepuszcza rolę admin", () => {
    expect(effectiveRoles("fn:profiles_guard_verification/0")).toContain("admin");
  });

  it("przepuszcza rolę super_admin (regresja z 20260806094104)", () => {
    const def = latest("profiles_guard_verification");
    expect(
      effectiveRoles("fn:profiles_guard_verification/0"),
      `Ostatnia definicja profiles_guard_verification (${def.file}) nie dopuszcza roli 'super_admin' - ` +
        "ani wprost, ani przez predykat, z którego czyta. has_role() dopasowuje rolę " +
        "DOKŁADNIE, bez hierarchii, więc bez tej roli super_admin nie może nadać ani " +
        "zdjąć weryfikacji i dostaje wyjątek zamiast przejść bramkę. Przy każdym " +
        "CREATE OR REPLACE tej funkcji (albo predykatu can_manage_profile_verification) " +
        "wymieniaj OBIE role jawnie.",
    ).toContain("super_admin");
  });

  it("nie dopuszcza NIKOGO poza staffem uprawnionym do weryfikacji", () => {
    // Druga strona tego samego inwariantu: rozwinięcie aliasów mogłoby
    // POSZERZYĆ krąg uprawnionych równie cicho, jak regex go gubił. `editor`
    // jest tu kanarkiem - weryfikacja steruje odznaką, a odznaka `expert`
    // nadaje dożywotni VIP (patrz komentarz w migracji).
    expect(effectiveRoles("fn:profiles_guard_verification/0").sort()).toEqual([
      "admin",
      "super_admin",
    ]);
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
