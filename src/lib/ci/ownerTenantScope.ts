// Inwariant izolacji tenanta w politykach RLS „właściciel wiersza".
//
// PRZYCZYNA ŹRÓDŁOWA (audyt 2026-08-03, `author_profiles`): polityki właściciela
// dopisywane są zwykle parami INSERT/UPDATE (bo tam boli - zapis), a SELECT
// i DELETE zostają przy gołym `auth.uid() = user_id` z migracji założycielskiej.
// Powstaje tabela, w której ten sam wiersz jest ZAPISYWALNY wyłącznie w tenancie
// domowym, ale ODCZYTYWALNY (i kasowalny) w dowolnym kontekście tenanta -
// dokładnie ta asymetria, którą zamyka migracja 20260803130000. To nie jest
// jednorazowa wpadka, tylko KLASA błędu: dopisanie tenanta do jednej komendy
// nie pociąga pozostałych.
//
// INWARIANT (samokalibrujący się, bez ręcznej listy tabel): jeżeli NA DANEJ
// TABELI choć jedna klauzula właścicielska wiąże wiersz z tenantem, to KAŻDA
// klauzula właścicielska na tej tabeli musi go wiązać. Intencję deklaruje sam
// schemat - tabele bez `tenant_id` (albo świadomie globalne) nigdy nie zapalają
// bramki, a tabela, która raz zadeklarowała skalowanie po tenancie, nie może go
// po cichu zgubić na jednej komendzie.
//
// Analiza schodzi do POJEDYNCZEJ GAŁĘZI `OR` w POJEDYNCZEJ KLAUZULI, bo tylko
// tam mieszka dziura: `user_id = auth.uid() OR (tenant_id = current_tenant_id()
// AND has_role(…))` wygląda na skalowane tenantem, a wpuszcza właściciela z
// dowolnego tenanta; `USING (user_id = auth.uid())` z tenantowym `WITH CHECK`
// pozwala ruszyć cudzy wiersz, byle przepisać go do siebie.
//
// Moduł jest CZYSTY - skrypt scripts/check-sql-owner-tenant-scope.ts dokłada I/O.
import { policyPredicate, type PolicyCommand, type PolicyDef } from "./rlsPolicies";

/** Klauzula polityki, w której wykryto lukę. */
export type PolicyClause = "USING" | "WITH CHECK";

/** Wyjątki i dług: `tabela::nazwa polityki` -> uzasadnienie widoczne w logu. */
export type OwnerScopeAnnotations = Readonly<Record<string, string>>;

export interface OwnerScopeGap {
  readonly key: string;
  readonly table: string;
  readonly name: string;
  readonly file: string;
  readonly command: PolicyCommand;
  /** Klauzule, w których gałąź właścicielska nie wiąże tenanta. */
  readonly clauses: readonly PolicyClause[];
  /** Klauzule właścicielskie na tej samej tabeli, które JUŻ wiążą tenanta. */
  readonly witnesses: readonly string[];
}

export interface OwnerScopeReport {
  /** Liczba polityk w stanie końcowym. */
  readonly analyzed: number;
  /** Liczba polityk rozpoznanych jako „własność wiersza". */
  readonly ownerPolicies: number;
  /** Luki blokujące CI (nowe - spoza listy znanego długu). */
  readonly gaps: readonly OwnerScopeGap[];
  /** Luki świadomie odłożone: raportowane głośno, ale nieblokujące. */
  readonly knownGaps: readonly OwnerScopeGap[];
  /** Wpisy uzasadnionych wyjątków, które faktycznie kogoś przykryły. */
  readonly justifiedHits: readonly string[];
  /** Wpisy wyjątków/długu bez trafienia - luka zamknięta, wpis do usunięcia. */
  readonly staleAnnotations: readonly string[];
}

/**
 * Normalizuje predykat do porównań: lowercase, bez białych znaków i bez owijki
 * `(select …)`, którą Supabase zaleca dla funkcji stabilnych
 * (`(select auth.uid()) = user_id` to ta sama semantyka co `auth.uid() = user_id`,
 * tylko liczona raz na zapytanie zamiast raz na wiersz).
 */
export function normalizePredicate(predicate: string): string {
  return predicate
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/\(select(auth\.uid\(\)|[a-z0-9_.]*current_tenant_id\(\))\)/g, "$1");
}

const OWNER_EQUALITY = [
  /auth\.uid\(\)=[a-z_][a-z0-9_.]*/, // auth.uid() = kolumna
  /[a-z_][a-z0-9_.]*=auth\.uid\(\)/, // kolumna = auth.uid()
];

const WORD_CHAR = /[a-z0-9_.$]/;

/**
 * Rozbija predykat na gałęzie połączone `OR` na NAJWYŻSZYM poziomie nawiasów
 * i zwraca je już znormalizowane. Wystarczy JEDNA gałąź „właściciel bez
 * tenanta", żeby wiersz przeciekł - alternatywa jest sumą uprawnień, nie ich
 * przecięciem.
 *
 * Podział idzie po tekście Z białymi znakami i respektuje granicę słowa, bo
 * `OR` jest podciągiem zwyczajnych identyfikatorów (`order_id`, `author_id`,
 * `moderator`). Literały `'…'` są nieprzezroczyste - `status = 'editor or
 * admin'` nie jest alternatywą.
 */
export function splitOrBranches(predicate: string): string[] {
  const source = predicate.toLowerCase();
  const branches: string[] = [];
  let depth = 0;
  let inSingle = false;
  let current = "";

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];

    if (inSingle) {
      if (ch === "'") inSingle = false;
      current += ch;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      current += ch;
      continue;
    }
    if (
      depth === 0 &&
      source.startsWith("or", i) &&
      !WORD_CHAR.test(source[i - 1] ?? " ") &&
      !WORD_CHAR.test(source[i + 2] ?? " ")
    ) {
      branches.push(current);
      current = "";
      i += 1;
      continue;
    }
    if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    current += ch;
  }
  branches.push(current);

  return branches.map(normalizePredicate).filter((branch) => branch !== "");
}

/**
 * Czy gałąź bramkuje wiersz WŁASNOŚCIĄ (równość kolumny z `auth.uid()`).
 *
 * Świadomie NIE łapie `has_role(auth.uid(), …)` ani `is_staff(auth.uid())` -
 * tam `auth.uid()` jest argumentem sprawdzenia roli, a nie tożsamością wiersza;
 * polityki stafowe mają własne (zwykle inne) reguły skalowania.
 */
export function isOwnerBranch(branch: string): boolean {
  return OWNER_EQUALITY.some((re) => re.test(branch));
}

/**
 * Czy gałąź wiąże wiersz z tenantem: przez kanoniczny `current_tenant_id()`
 * albo przez jawną równość na kolumnie `tenant_id` - starsze polityki wstawiają
 * równoważny podzapyt (`tenant_id = (select tenant_id from profiles where …)`),
 * a polityki płaszczyzny treści wiążą tenanta wiersza z tenantem rodzica.
 */
export function isTenantBranch(branch: string): boolean {
  return /current_tenant_id\(\)/.test(branch) || /tenant_id=/.test(branch);
}

interface ClauseVerdict {
  readonly clause: PolicyClause;
  /** KAŻDA gałąź właścicielska tej klauzuli wiąże tenanta. */
  readonly scoped: boolean;
}

/** Werdykt dla klauzul, które W OGÓLE bramkują wiersz własnością (reszta nie dotyczy inwariantu). */
function clauseVerdicts(policy: PolicyDef): ClauseVerdict[] {
  const clauses: readonly (readonly [PolicyClause, string | null])[] = [
    ["USING", policy.using],
    ["WITH CHECK", policy.withCheck],
  ];

  const verdicts: ClauseVerdict[] = [];
  for (const [clause, expr] of clauses) {
    if (expr === null) continue;
    const ownerBranches = splitOrBranches(expr).filter(isOwnerBranch);
    if (ownerBranches.length === 0) continue;
    verdicts.push({ clause, scoped: ownerBranches.every(isTenantBranch) });
  }
  return verdicts;
}

/** Czy polityka bramkuje wiersz własnością - w dowolnej klauzuli i gałęzi. */
export function isOwnerScoped(policy: PolicyDef): boolean {
  return splitOrBranches(policyPredicate(policy)).some(isOwnerBranch);
}

/** Klauzule, w których własność nie została związana z tenantem. */
export function unscopedClauses(policy: PolicyDef): PolicyClause[] {
  return clauseVerdicts(policy)
    .filter((verdict) => !verdict.scoped)
    .map((verdict) => verdict.clause);
}

export interface OwnerScopeInput {
  /** Uzasadnione wyjątki - luka pozorna, wiersz z definicji nie przekracza tenanta. */
  readonly justified?: OwnerScopeAnnotations;
  /** Znany, świadomie odłożony dług - raportowany głośno, nieblokujący. */
  readonly knownGaps?: OwnerScopeAnnotations;
}

/**
 * Znajduje klauzule właścicielskie, które zgubiły tenanta, choć rodzeństwo na
 * tej samej tabeli go pilnuje. Zwraca zaratchetowany raport: nowe luki blokują
 * CI, znany dług jest widoczny w każdym przebiegu, a zamknięta luka zgłasza swój
 * wpis jako nieaktualny.
 */
export function analyzeOwnerTenantScope(
  policies: Iterable<PolicyDef>,
  { justified = {}, knownGaps = {} }: OwnerScopeInput = {},
): OwnerScopeReport {
  const all = [...policies];
  const byTable = new Map<string, PolicyDef[]>();
  let ownerPolicies = 0;

  for (const policy of all) {
    if (!isOwnerScoped(policy)) continue;
    ownerPolicies += 1;
    const bucket = byTable.get(policy.table);
    if (bucket === undefined) byTable.set(policy.table, [policy]);
    else bucket.push(policy);
  }

  const gaps: OwnerScopeGap[] = [];
  const known: OwnerScopeGap[] = [];
  const hits = new Set<string>();
  const justifiedHits = new Set<string>();

  for (const [table, owned] of byTable) {
    const witnesses = owned
      .filter((policy) => clauseVerdicts(policy).some((verdict) => verdict.scoped))
      .map((policy) => policy.name)
      .sort();
    if (witnesses.length === 0) continue; // tabela świadomie globalna - nic nie deklaruje

    for (const policy of owned) {
      const clauses = unscopedClauses(policy);
      if (clauses.length === 0) continue;

      if (justified[policy.key] !== undefined) {
        hits.add(policy.key);
        justifiedHits.add(policy.key);
        continue;
      }
      const gap: OwnerScopeGap = {
        key: policy.key,
        table,
        name: policy.name,
        file: policy.file,
        command: policy.command,
        clauses,
        witnesses,
      };
      if (knownGaps[policy.key] !== undefined) {
        hits.add(policy.key);
        known.push(gap);
      } else {
        gaps.push(gap);
      }
    }
  }

  const byKey = (a: OwnerScopeGap, b: OwnerScopeGap): number => a.key.localeCompare(b.key);

  return {
    analyzed: all.length,
    ownerPolicies,
    gaps: gaps.sort(byKey),
    knownGaps: known.sort(byKey),
    justifiedHits: [...justifiedHits].sort(),
    staleAnnotations: [...Object.keys(justified), ...Object.keys(knownGaps)]
      .filter((key) => !hits.has(key))
      .sort(),
  };
}

/**
 * Czy raport powinien zablokować CI: NOWA luka albo wpis, który przestał
 * cokolwiek przykrywać (zamknięta luka musi zniknąć z listy długu - inaczej
 * lista puchnie i przestaje znaczyć cokolwiek).
 */
export function ownerScopeFailed(report: OwnerScopeReport): boolean {
  return report.gaps.length > 0 || report.staleAnnotations.length > 0;
}
