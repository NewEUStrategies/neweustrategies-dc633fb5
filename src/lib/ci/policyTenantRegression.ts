// Inwariant CI: POLITYKA, KTÓRA RAZ ZWIĄZAŁA WIERSZ Z NAJEMCĄ, NIE MOŻE TEGO
// WIĄZANIA STRACIĆ PRZY PÓŹNIEJSZYM ODTWORZENIU.
//
// ── PRZYCZYNA ŹRÓDŁOWA (wydanie 2026-08-14) ────────────────────────────────
// Migracja 20260814100000 zawęziła trzy polityki bucketu `career-cv` do
// najemcy, bo `is_staff()` bada WYŁĄCZNIE rolę: bez wiązania redaktor najemcy A
// mógł podpisać i pobrać KAŻDE CV każdego najemcy. Trzy godziny później
// platforma zapisała wygenerowany plik `20260814122512` - odpowiednik stanu
// PRZED zawężeniem - który tę samą trójkę odtworzył w kształcie:
//
//     career_cv_staff_read  USING (bucket_id = 'career-cv' AND public.is_staff())
//
// czyli zdjął wiązanie najemcy z odczytu i usuwania CV. Stan końcowy bazy
// uratowała WYŁĄCZNIE kolejność sortowania nazw plików: bliźniak migracji
// zawężającej (`20260814122639`) wypadł chwilę PO pliku cofającym i przywrócił
// hardening. Gdyby platforma wygenerowała tylko ten pierwszy plik, izolacja
// najemców na plikach CV byłaby otwarta na produkcji.
//
// ŻADNA istniejąca bramka tego nie widziała, i każda z dobrego powodu:
//   * `check:sql-tenant-scope`       - patrzy na funkcje SECURITY DEFINER;
//   * `check:sql-owner-tenant-scope` - szuka ASYMETRII między klauzulami
//     właścicielskimi tej samej tabeli, a tu WSZYSTKIE trzy polityki cofnęły się
//     razem, więc asymetrii nie było;
//   * `check:sql-migration-replay`   - porównuje TREŚĆ plików; `20260814122512`
//     nie był bliźniakiem niczego (różnił się od pierwowzoru brakiem INSERT-a do
//     `storage.buckets`), więc przeszedł bez śladu;
//   * pgTAP i harnessy                - stawiają bazę ze stanu KOŃCOWEGO, a stan
//     końcowy był (przypadkiem) poprawny.
//
// ── CO MIERZY BRAMKA ────────────────────────────────────────────────────────
// Dla każdej polityki (tabela + nazwa) porównuje jej HISTORIĘ ze STANEM
// KOŃCOWYM. Zapala się, gdy jakakolwiek definicja w łańcuchu wiązała najemcę,
// a definicja OBOWIĄZUJĄCA już nie wiąże. To jedyny kształt, który realnie
// otwiera dane - i jednocześnie jedyny, którego nie da się zamieść pod dywan
// dopisaniem kolejnej migracji: wystarczy odtworzyć politykę poprawnie.
//
// Cofnięcia ZALECZONE (wiązanie wróciło w późniejszej migracji) raportujemy
// GŁOŚNO, ale bez blokowania - to właśnie kategoria z 20260814122512 i audyt
// ma prawo ją zobaczyć bez czytania 770 plików. Blokuje wyłącznie stan otwarty.
//
// Bramka jest SAMOKALIBRUJĄCA: nie ma ręcznej listy tabel ani polityk. Intencję
// deklaruje sam schemat - polityka, która nigdy nie wiązała najemcy, nie ma jak
// jej zgubić, więc płaszczyzny globalne (słowniki, katalogi publiczne) są poza
// zasięgiem z definicji.
//
// Warstwa wykonawcza (odczyt katalogu, kod wyjścia) żyje w
// `scripts/check-sql-policy-tenant-regression.ts`; ten moduł jest czysty.
import { type PolicyDef, policyPredicate } from "./rlsPolicies";

/**
 * Sygnały wiązania z najemcą w predykacie polityki.
 *
 * `current_tenant_id()` to tenant DOMOWY wołającego (z profilu), a
 * `public_tenant_id()` - tenant PRZEGLĄDANEGO hosta (nagłówek `x-tenant-host`,
 * kowalny przez klienta, więc dopuszczalny wyłącznie dla ścieżek publicznych).
 * Bramka nie rozstrzyga, który z nich jest w danym miejscu właściwy - to robi
 * `check:sql-tenant-scope`. Tu liczy się sam FAKT wiązania.
 */
const TENANT_SIGNALS: readonly RegExp[] = [
  /\bcurrent_tenant_id\s*\(/i,
  /\bpublic_tenant_id\s*\(/i,
  /\btenant_id\b/i,
];

/** Czy predykat polityki (USING + WITH CHECK) w ogóle wiąże najemcę. */
export function bindsTenant(policy: PolicyDef): boolean {
  const predicate = policyPredicate(policy);
  return TENANT_SIGNALS.some((signal) => signal.test(predicate));
}

/** Cofnięcie wiązania najemcy w jednej polityce. */
export interface TenantBindingRegression {
  /** Tabela bez schematu - jak w kluczach `rlsPolicies`. */
  readonly table: string;
  readonly policy: string;
  /** Migracja, która wiązanie NADAŁA (pierwsza taka w łańcuchu). */
  readonly hardenedIn: string;
  /** Migracja, której definicja wiązanie ZDJĘŁA. */
  readonly weakenedIn: string;
}

/** `tabela::polityka` - klucz zgodny z resztą bramek polityk. */
export function regressionKey(entry: TenantBindingRegression): string {
  return `${entry.table}::${entry.policy}`;
}

/**
 * Dług zastany w chwili wprowadzenia bramki: `tabela::polityka` -> powód.
 *
 * Wpis MUSI podać, jaki predykat jest dla tej płaszczyzny danych POPRAWNY -
 * inaczej nikt nie ma jak luki zamknąć (ta sama zasada, co w
 * `KNOWN_OPEN_GAPS` bramki `check:sql-owner-tenant-scope`). Lista jest
 * raportowana GŁOŚNO przy każdym przebiegu, nie blokuje, i może TYLKO MALEĆ:
 * wpis bez odpowiadającego cofnięcia oblewa bramkę.
 */
export type PolicyTenantGaps = Readonly<Record<string, string>>;

export interface PolicyTenantRegressionReport {
  /**
   * Wszystkie sparsowane `CREATE POLICY` - liczba kontrolna, że skaner w ogóle
   * czyta SQL. Liczymy DEFINICJE, nie polityki stanu końcowego: łańcuch, który
   * legalnie kasuje swoją jedyną politykę, zostawia zero polityk i wyglądałby
   * wtedy identycznie jak zepsuty parser.
   */
  readonly scannedDefinitions: number;
  /** Polityki w stanie końcowym. */
  readonly totalPolicies: number;
  /** Ile z nich wiąże najemcę. */
  readonly tenantBound: number;
  /** BLOKUJĄCE: obowiązująca definicja zgubiła wiązanie, które kiedyś miała. */
  readonly open: readonly TenantBindingRegression[];
  /** Raportowane: wiązanie zdjęte i przywrócone przez późniejszą migrację. */
  readonly healed: readonly TenantBindingRegression[];
  /** Dług zastany: cofnięcia z listy `KNOWN_OPEN_GAPS`, które nadal trwają. */
  readonly known: readonly TenantBindingRegression[];
  /** Wpisy listy długu bez odpowiadającego cofnięcia - ratchet każe usunąć. */
  readonly staleKnown: readonly string[];
}

/**
 * @param history  wszystkie `CREATE POLICY` w kolejności migracji (`extractPolicyHistory`).
 * @param latest   stan końcowy polityk (`extractLatestPolicies`).
 * @param known    dług zastany: `tabela::polityka` -> poprawny predykat / powód.
 */
export function analyzePolicyTenantRegressions(
  history: ReadonlyMap<string, readonly PolicyDef[]>,
  latest: ReadonlyMap<string, PolicyDef>,
  known: PolicyTenantGaps = {},
): PolicyTenantRegressionReport {
  const open: TenantBindingRegression[] = [];
  const healed: TenantBindingRegression[] = [];
  const knownHits: TenantBindingRegression[] = [];
  const matchedKnown = new Set<string>();

  for (const [key, defs] of history) {
    const firstBoundIdx = defs.findIndex(bindsTenant);
    if (firstBoundIdx === -1) continue;

    const after = defs.slice(firstBoundIdx + 1);
    const weakened = after.filter((def) => !bindsTenant(def));
    if (weakened.length === 0) continue;

    // Polityka SKASOWANA na końcu łańcucha nie jest cofnięciem wiązania:
    // bez polityki RLS nie wpuszcza nikogo. Zniknięciem zajmują się bramki
    // kontraktu, nie ta.
    const current = latest.get(key);
    if (current === undefined) continue;

    const entry: TenantBindingRegression = {
      table: defs[firstBoundIdx].table,
      policy: defs[firstBoundIdx].name,
      hardenedIn: defs[firstBoundIdx].file,
      // Stan otwarty datujemy definicją OBOWIĄZUJĄCĄ, zaleczony - ostatnią,
      // która wiązanie zdjęła. W obu razach to plik, który trzeba przeczytać.
      weakenedIn: bindsTenant(current) ? weakened[weakened.length - 1].file : current.file,
    };

    if (bindsTenant(current)) {
      healed.push(entry);
      continue;
    }
    if (key in known) {
      matchedKnown.add(key);
      knownHits.push(entry);
      continue;
    }
    open.push(entry);
  }

  const byKey = (a: TenantBindingRegression, b: TenantBindingRegression): number =>
    regressionKey(a).localeCompare(regressionKey(b));

  let tenantBound = 0;
  for (const policy of latest.values()) if (bindsTenant(policy)) tenantBound += 1;

  let scannedDefinitions = 0;
  for (const defs of history.values()) scannedDefinitions += defs.length;

  return {
    scannedDefinitions,
    totalPolicies: latest.size,
    tenantBound,
    open: open.sort(byKey),
    healed: healed.sort(byKey),
    known: knownHits.sort(byKey),
    staleKnown: Object.keys(known)
      .filter((key) => !matchedKnown.has(key))
      .sort(),
  };
}

/**
 * Bramka oblewa, gdy jest NOWE cofnięcie, martwy wpis długu albo gdy skaner
 * przestał cokolwiek widzieć. Ten trzeci warunek jest równie ważny jak dwa
 * pierwsze: bramka, która po zmianie parsera milczy, wygląda dokładnie jak
 * bramka, która przechodzi.
 */
export function policyTenantRegressionFailed(report: PolicyTenantRegressionReport): boolean {
  return report.open.length > 0 || report.staleKnown.length > 0 || report.scannedDefinitions === 0;
}

export function renderPolicyTenantRegressionReport(
  report: PolicyTenantRegressionReport,
  known: PolicyTenantGaps = {},
): string {
  const lines: string[] = [];

  if (report.scannedDefinitions === 0) {
    return [
      "✗ [policy-tenant] skaner nie sparsował ANI JEDNEGO `CREATE POLICY`.",
      "  To nie jest zielone światło - to zepsuty parser albo pusty katalog migracji.",
    ].join("\n");
  }

  if (report.open.length > 0) {
    lines.push(
      `✗ [policy-tenant] ${report.open.length} polityk STRACIŁO wiązanie z najemcą:`,
      ...report.open.map(
        (entry) =>
          `    ${regressionKey(entry)}\n` +
          `      wiązanie nadane w: ${entry.hardenedIn}\n` +
          `      obowiązująca definicja BEZ wiązania: ${entry.weakenedIn}`,
      ),
      "",
      "Tak wygląda otwarta granica obszaru roboczego: rola się zgadza, najemca nie.",
      "Napraw PÓŹNIEJSZĄ migracją odtwarzającą politykę z wiązaniem (migracje są",
      "forward-only, więc edycja zastosowanego pliku nie wykona się nigdzie) -",
      "wzorcem jest 20260814194500_career_cv_policies_tenant_scope_reassert.sql.",
      "Jeśli dane naprawdę przestały być dzielone po najemcy, dopisz wpis do",
      "listy wyjątków W SKRYPCIE, razem z powodem.",
    );
  }

  if (report.staleKnown.length > 0) {
    lines.push(
      `✗ [policy-tenant] ${report.staleKnown.length} wpisów długu nie pasuje już do niczego - USUŃ je:`,
      ...report.staleKnown.map((key) => `    ${key}  (${known[key] ?? "brak powodu"})`),
      "",
      "Martwy wpis to zgoda, o której nikt nie pamięta - i furtka dla polityki,",
      "która pod tą nazwą powstanie w przyszłości.",
    );
  }

  if (lines.length === 0) {
    lines.push(
      `✓ Inwariant wiązania najemcy w politykach OK (${report.totalPolicies} polityk w stanie końcowym, ${report.tenantBound} z wiązaniem najemcy).`,
    );
  }

  if (report.known.length > 0) {
    lines.push(
      `  DŁUG ZASTANY - ${report.known.length} polityk nadal bez wiązania (lista może tylko maleć):`,
      ...report.known.map(
        (entry) =>
          `    ${regressionKey(entry)}  [${entry.hardenedIn} -> ${entry.weakenedIn}]\n` +
          `      ${known[regressionKey(entry)]}`,
      ),
    );
  }

  if (report.healed.length > 0) {
    lines.push(
      `  ${report.healed.length} cofnięć ZALECZONYCH później (raport, nie blokada):`,
      ...report.healed.map(
        (entry) =>
          `    ${regressionKey(entry)}: ${entry.hardenedIn} nadała, ${entry.weakenedIn} zdjęła, późniejsza migracja przywróciła`,
      ),
    );
  }

  return lines.join("\n");
}
