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
// KOŃCOWYM, OSOBNO DLA KAŻDEJ STRONY: `USING` (które istniejące wiersze
// polityka wystawia) i `WITH CHECK` (jak ma wyglądać wiersz po zapisie; gdy
// klauzuli nie ma, PostgreSQL bierze `USING`). Zapala się, gdy któraś strona
// była kiedyś wiązana, a w definicji OBOWIĄZUJĄCEJ już nie jest. To jedyny
// kształt, który realnie otwiera dane - i jednocześnie jedyny, którego nie da
// się zamieść pod dywan dopisaniem kolejnej migracji: wystarczy odtworzyć
// politykę poprawnie.
//
// Rozdzielenie stron jest KONIECZNE, nie kosmetyczne - patrz komentarz przy
// `policySideBindings`: `USING (true)` przy zachowanym tenantowym `WITH CHECK`
// pozwala wziąć na cel wiersz obcego najemcy i przepisać go do siebie, a przy
// zlanych klauzulach token najemcy „gdzieś w predykacie" wyglądał jak wiązanie.
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

/** Czy pojedyncze wyrażenie wiąże najemcę. `null` = klauzuli nie ma. */
function exprBindsTenant(expr: string | null): boolean | null {
  if (expr === null) return null;
  return TENANT_SIGNALS.some((signal) => signal.test(expr));
}

/**
 * Strona polityki. Nazwy są semantyczne, nie składniowe, bo o wyciek decyduje
 * semantyka PostgreSQL, a nie to, która klauzula jest zapisana:
 *
 *   * `selection` = `USING` - KTÓRE ISTNIEJĄCE WIERSZE polityka wystawia
 *     (SELECT je zwraca, UPDATE i DELETE mogą je wziąć na cel);
 *   * `result`    = JAK MA WYGLĄDAĆ WIERSZ PO ZAPISIE.
 *
 * Która strona ISTNIEJE, zależy od komendy - i to nie jest szczegół, bo strona
 * nieistniejąca nie ma jak zgubić wiązania:
 *
 *   | komenda  | selection            | result                              |
 *   | -------- | -------------------- | ----------------------------------- |
 *   | SELECT   | USING                | brak (nic nie zapisuje)             |
 *   | DELETE   | USING                | brak (nie powstaje żaden wiersz)    |
 *   | INSERT   | brak (USING zabronione) | WITH CHECK                       |
 *   | UPDATE   | USING                | WITH CHECK, a bez niej USING        |
 *   | ALL      | USING                | WITH CHECK, a bez niej USING        |
 */
export type PolicySide = "selection" | "result";

/** Wiązanie najemcy OSOBNO dla każdej strony; `null` = strona nie istnieje. */
export type PolicySideBindings = Readonly<Record<PolicySide, boolean | null>>;

/**
 * DLACZEGO OSOBNO, A NIE JEDNYM NAPISEM (korekta po recenzji PR #228).
 *
 * Pierwsza wersja skanowała `policyPredicate()`, czyli `USING` i `WITH CHECK`
 * zlane w jeden tekst, i uznawała politykę za wiążącą, gdy token najemcy
 * wystąpił GDZIEKOLWIEK. To przepuszczało cofnięcie CZĘŚCIOWE, a takie jest
 * w pełni wystarczające do przejęcia wiersza obcego najemcy:
 *
 *     -- przed
 *     FOR UPDATE USING (tenant_id = current_tenant_id())
 *            WITH CHECK (tenant_id = current_tenant_id())
 *     -- po - dla starej wersji nadal „wiąże", bo `tenant_id` gdzieś jest
 *     FOR UPDATE USING (true)
 *            WITH CHECK (tenant_id = current_tenant_id())
 *
 * Po tej zmianie `USING (true)` pozwala WZIĄĆ NA CEL dowolny wiersz dowolnego
 * najemcy, a `WITH CHECK` wymaga tylko, by wiersz PO zapisie należał do
 * najemcy piszącego - czyli dokładnie przepisuje cudzy wiersz do siebie.
 * Dlatego każda strona ma własną historię i własne cofnięcie.
 */
export function policySideBindings(policy: PolicyDef): PolicySideBindings {
  const writesRow = policy.command === "update" || policy.command === "all";
  const resultExpr =
    policy.command === "insert"
      ? policy.withCheck
      : writesRow
        ? (policy.withCheck ?? policy.using)
        : null;
  return {
    selection: policy.command === "insert" ? null : exprBindsTenant(policy.using),
    result: exprBindsTenant(resultExpr),
  };
}

/**
 * Czy polityka wiąże najemcę NA KTÓREJKOLWIEK stronie.
 *
 * Wyłącznie do licznika w raporcie („ile polityk w ogóle zna najemcę").
 * Do wykrywania cofnięć NIE WOLNO tego używać - patrz `policySideBindings`.
 */
export function bindsTenant(policy: PolicyDef): boolean {
  const predicate = policyPredicate(policy);
  return TENANT_SIGNALS.some((signal) => signal.test(predicate));
}

/** Cofnięcie wiązania najemcy w jednej polityce. */
export interface TenantBindingRegression {
  /** Tabela bez schematu - jak w kluczach `rlsPolicies`. */
  readonly table: string;
  readonly policy: string;
  /** Strony, które wiązanie STRACIŁY - `selection` (USING) i/lub `result` (WITH CHECK). */
  readonly sides: readonly PolicySide[];
  /** Migracja, która wiązanie NADAŁA (najwcześniejsza dla cofniętych stron). */
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

  const SIDES: readonly PolicySide[] = ["selection", "result"];

  for (const [key, defs] of history) {
    // Krok 1: dla KAŻDEJ strony osobno - pierwsza definicja, która ją wiązała,
    // i ostatnia późniejsza, która wiązanie zdjęła.
    const hardened = new Map<PolicySide, PolicyDef>();
    const weakened = new Map<PolicySide, PolicyDef>();
    for (const def of defs) {
      const bindings = policySideBindings(def);
      for (const side of SIDES) {
        const bound = bindings[side];
        // Strona nieistniejąca (np. brak WITH CHECK przy FOR SELECT) nie jest
        // ani nadaniem, ani zdjęciem wiązania - polityka nic tam nie wpuszcza.
        if (bound === null) continue;
        if (bound) {
          if (!hardened.has(side)) hardened.set(side, def);
          continue;
        }
        if (hardened.has(side)) weakened.set(side, def);
      }
    }
    if (weakened.size === 0) continue;

    // Krok 2: polityka SKASOWANA na końcu łańcucha nie jest cofnięciem
    // wiązania - bez polityki RLS nie wpuszcza nikogo. Zniknięciem zajmują się
    // bramki kontraktu, nie ta.
    const current = latest.get(key);
    if (current === undefined) continue;

    // Krok 3: o stanie OTWARTYM decyduje wyłącznie definicja OBOWIĄZUJĄCA.
    // Strona, która w niej nie istnieje, też jest w porządku: brak klauzuli to
    // brak uprawnienia, a nie utrata wiązania.
    const currentBindings = policySideBindings(current);
    const openSides = SIDES.filter((side) => hardened.has(side) && currentBindings[side] === false);
    const sides = openSides.length > 0 ? openSides : [...weakened.keys()];
    const firstHardened = sides
      .map((side) => hardened.get(side))
      .filter((def): def is PolicyDef => def !== undefined)
      .reduce((earliest, def) => (def.file < earliest.file ? def : earliest));

    const entry: TenantBindingRegression = {
      table: firstHardened.table,
      policy: firstHardened.name,
      sides,
      hardenedIn: firstHardened.file,
      // Stan otwarty datujemy definicją OBOWIĄZUJĄCĄ, zaleczony - ostatnią,
      // która wiązanie zdjęła. W obu razach to plik, który trzeba przeczytać.
      weakenedIn:
        openSides.length > 0
          ? current.file
          : sides
              .map((side) => weakened.get(side))
              .filter((def): def is PolicyDef => def !== undefined)
              .reduce((latestWeak, def) => (def.file > latestWeak.file ? def : latestWeak)).file,
    };

    if (openSides.length === 0) {
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

/** Opis strony do raportu - klauzula plus to, o co w niej idzie. */
const SIDE_LABEL: Readonly<Record<PolicySide, string>> = {
  selection: "USING (które wiersze polityka wystawia)",
  result: "WITH CHECK (jak ma wyglądać wiersz po zapisie)",
};

function sidesLabel(entry: TenantBindingRegression): string {
  return entry.sides.map((side) => SIDE_LABEL[side]).join(" + ");
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
          `      strona bez wiązania: ${sidesLabel(entry)}\n` +
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
          `      strona: ${sidesLabel(entry)}\n` +
          `      ${known[regressionKey(entry)]}`,
      ),
    );
  }

  if (report.healed.length > 0) {
    lines.push(
      `  ${report.healed.length} cofnięć ZALECZONYCH później (raport, nie blokada):`,
      ...report.healed.map(
        (entry) =>
          `    ${regressionKey(entry)} [${sidesLabel(entry)}]: ${entry.hardenedIn} nadała, ${entry.weakenedIn} zdjęła, późniejsza migracja przywróciła`,
      ),
    );
  }

  return lines.join("\n");
}
