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

import {
  extractLatestDefinitions,
  extractLatestTriggerDefinitions,
  type FnDef,
  type TriggerDef,
} from "../../scripts/lib/sqlMigrations";
import { readAuthzSource } from "../../scripts/lib/authzSource";
import { deriveAuthzSnapshot, gateEffectiveRoles } from "@/lib/ci/authzGates";

const LATEST = extractLatestDefinitions();
const LATEST_TRIGGERS = extractLatestTriggerDefinitions();

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

function latest(name: string, arity = 0): FnDef {
  const def = LATEST.get(`public.${name}/${arity}`);
  expect(def, `brak funkcji public.${name}/${arity} w migracjach`).toBeDefined();
  return def!;
}

function latestTrigger(name: string): TriggerDef {
  const def = LATEST_TRIGGERS.get(name);
  expect(def, `brak triggera ${name} w migracjach`).toBeDefined();
  return def!;
}

/** `has_role(<cokolwiek>, 'rola')` - z opcjonalnym rzutowaniem na enum. */
function checksRole(body: string, role: string): boolean {
  return new RegExp(`has_role\\s*\\([^,()]*(?:\\([^()]*\\))?[^,()]*,\\s*'${role}'`, "i").test(body);
}

/**
 * EFEKTYWNY zbiór ról bramki, po rozwinięciu aliasów i delegacji.
 *
 * `deriveAuthzSnapshot` sam wchodzi w `can_manage_profile_verification`, więc
 * pytanie „kto przejdzie" ma jedną odpowiedź niezależnie od tego, na ile
 * funkcji rozłożono decyzję.
 */
function effectiveRoles(ref: string): string[] {
  const gate = DERIVED.roleGates.find((entry) => entry.ref === ref);
  expect(gate, `brak bramki ${ref} w snapshocie odtworzonym z migracji`).toBeDefined();
  return gateEffectiveRoles(gate!);
}

const GUARD_REF = "fn:profiles_guard_verification/0";
/** Personel uprawniony do nadawania i zdejmowania weryfikacji - obie role. */
const STAFF_ROLES = ["admin", "super_admin"] as const;

describe("profiles_guard_verification: stan końcowy migracji", () => {
  it("przepuszcza DOKŁADNIE role personelu - ani mniej, ani więcej", () => {
    // Dlaczego równość zbiorów, a nie `checksRole` regexem po ciele funkcji:
    // regex odpowiada na „czy w tekście stoi has_role(..., 'super_admin')",
    // czyli przechodzi na zielono także wtedy, gdy warunek obok ZAWĘŻA krąg
    // uprawnionych (dodatkowy `AND`, wcześniejszy `RETURN false`, zmiana
    // predykatu pomocniczego). Snapshot rozwija aliasy i delegację, więc
    // porównanie zbiorów łapie oba kierunki: utratę roli i po cichu dodaną.
    // Zestaw ról personelu to decyzja do review, nie szczegół implementacji -
    // dlatego jej zmiana MA tu zaświecić na czerwono.
    const def = latest("profiles_guard_verification");
    expect(
      effectiveRoles(GUARD_REF),
      `Efektywny zbiór ról bramki weryfikacji (ostatnia definicja: ${def.file}) różni się od ` +
        `[${STAFF_ROLES.join(", ")}]. has_role() dopasowuje rolę DOKŁADNIE: brak gałęzi ` +
        "super_admin odbiera tej roli możliwość nadania i zdjęcia weryfikacji (dostaje wyjątek " +
        "zamiast przejść bramkę), a rola dopisana poszerza krąg uprawnionych bez decyzji.",
    ).toEqual([...STAFF_ROLES]);
  });

  it("`has_role` stoi w ciele bramki albo w jej źródle prawdy", () => {
    // Asercja na KSZTAŁCIE, uzupełniająca tę wyżej: snapshot potrafi rozwinąć
    // tylko to, co przechodzi przez `has_role`. Gdyby bramka zaczęła czytać
    // rolę inaczej (własny SELECT po `user_roles`, porównanie stringów),
    // zbiór ról wyżej mógłby wyjść pusty albo mylący - a to musi być widać.
    const guard = latest("profiles_guard_verification").body;
    const body = /can_manage_profile_verification/i.test(guard)
      ? `${guard}\n${latest("can_manage_profile_verification", 1).body}`
      : guard;
    for (const role of STAFF_ROLES) {
      expect(checksRole(body, role), `brak has_role(..., '${role}') w ścieżce decyzyjnej`).toBe(
        true,
      );
    }
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

  it("wiąże weryfikację z obszarem roboczym wiersza (tenant_id vs current_tenant_id)", () => {
    const { body, file } = latest("profiles_guard_verification");
    expect(
      /current_tenant_id\s*\(/i.test(body) && /tenant_id/i.test(body),
      `Ostatnia definicja profiles_guard_verification (${file}) nie porównuje tenanta wiersza ` +
        "z current_tenant_id(). Bez tego admin tenanta A stempluje odznakę - a przez " +
        "sync_expert_vip_grant dożywotni VIP - w tenancie B.",
    ).toBe(true);
  });
});

/**
 * Ciało funkcji mówi, CO bramka sprawdza. Instrukcja `CREATE TRIGGER` mówi, KIEDY
 * bramka w ogóle się odpali - i to drugie da się cofnąć, nie ruszając pierwszego.
 * Tak zniknęło pokrycie INSERT: `20260806150000` przepięła trigger na
 * `BEFORE UPDATE OF verified_at, verified_by`, więc funkcja pozostała bez zarzutu
 * i ani snapshot autoryzacji, ani bramka literałów ról nie miały czego zgłosić.
 * Kontrakt pgTAP (`tgtype = 23`) mówił jedno, migracje drugie - i dowiedzieliśmy
 * się o tym z prawdziwego Postgresa, po `supabase db start`.
 */
describe("profiles_guard_verification_trg: zasięg bramki", () => {
  it("odpala się przed zapisem, na INSERT ORAZ UPDATE", () => {
    const trg = latestTrigger("profiles_guard_verification_trg");
    expect(trg.table).toBe("public.profiles");
    expect(trg.timing).toBe("BEFORE");
    expect(
      trg.events,
      `Ostatnia definicja triggera (${trg.file}) nie pokrywa INSERT-u. Polityka ` +
        '"Users insert own profile" pozwala wstawić WŁASNY wiersz profilu, gdy jeszcze ' +
        "go nie ma - bramka na samym UPDATE nie widzi wiersza, który RODZI SIĘ " +
        "zweryfikowany (luka zamknięta w 20260806130000).",
    ).toEqual(["INSERT", "UPDATE"]);
  });

  it("nie zawęża się listą kolumn (`UPDATE OF`)", () => {
    const trg = latestTrigger("profiles_guard_verification_trg");
    expect(
      trg.updateOfColumns,
      `Ostatnia definicja triggera (${trg.file}) ma listę kolumn: ` +
        `[${trg.updateOfColumns.join(", ")}]. \`BEFORE UPDATE OF kolumna\` odpala się ` +
        "według LISTY SET w zapytaniu, a NIE według realnej zmiany wartości - wartość " +
        "podstawiona przez wcześniejszy trigger BEFORE (nazwy sortują się alfabetycznie) " +
        "mija taką bramkę bez śladu. Wczesne wyjście przez IS NOT DISTINCT FROM daje ten " +
        "sam zysk bez tego założenia.",
    ).toEqual([]);
  });

  it("bramka firmy trzyma ten sam zasięg (wiersz nie rodzi się z obcą firmą)", () => {
    const trg = latestTrigger("profiles_guard_privileged_columns_trg");
    expect(trg.table).toBe("public.profiles");
    expect(trg.timing).toBe("BEFORE");
    expect(trg.events).toEqual(["INSERT", "UPDATE"]);
    expect(trg.updateOfColumns).toEqual([]);
  });

  it("bramka firmy NIE jest współwłaścicielem kolumn weryfikacji", () => {
    // Dublowana własność była przyczyną źródłową: cichy revert w bramce
    // „privileged" odpalał się alfabetycznie PRZED „verification" i maskował
    // twardą odmowę, więc oba zbiory ról mogły dryfować niezależnie.
    const { body, file } = latest("profiles_guard_privileged_columns");
    expect(
      /verified_at|verified_by/i.test(body),
      `${file}: profiles_guard_privileged_columns znów dotyka kolumn weryfikacji. ` +
        "Jedna kolumna = jedna bramka, inaczej naruszenie nie zostawia śladu.",
    ).toBe(false);
  });
});
