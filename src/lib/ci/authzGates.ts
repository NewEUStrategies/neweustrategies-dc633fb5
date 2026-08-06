// Statyczna analiza BRAMEK AUTORYZACJI w forward-only migracjach SQL.
//
// PO CO: macierz uprawnień (/admin/permissions) była stroną referencyjną z ręcznie
// wpisaną tabelką - żadna zmiana bramki w bazie nie dawała sygnału, więc strona
// mogła (i musiała) rozjechać się z rzeczywistością. Ten moduł odtwarza z migracji
// dwa fakty, na których stoi cała macierz:
//
//   1. ROLE, które przechodzą daną bramkę (funkcja SECURITY DEFINER albo polityka
//      RLS) - z literałów `has_role(uid, 'X')`, `role = 'X'::app_role` oraz z
//      aliasów rolowych (`is_staff()`, `is_super_admin()`, `assert_admin_tenant()`),
//      których zbiory ról są też odtwarzane z kodu, nie wpisywane z pamięci.
//   2. FLAGI warstw (`membership_tiers.features`), które są REALNIE czytane przez
//      bramkę - z `has_tier_feature('k')`, `user_has_tier_feature(uid,'k')` oraz
//      `features ->> 'k'`. To rozstrzyga pole `enforced` w rejestrze capabilities:
//      dopisanie/usunięcie bramki bez aktualizacji rejestru obleje CI.
//
// Migracje są forward-only, więc o stanie bazy decyduje OSTATNIA definicja funkcji
// i OSTATNIA operacja na polityce (CREATE po DROP = żywa, DROP po CREATE = martwa) -
// dokładnie tak, jak liczą to pozostałe bramki (scripts/lib/sqlMigrations.ts).
//
// Moduł jest CZYSTY (bez I/O): wejście dostarcza scripts/lib/authzSource.ts, więc
// całe parsowanie jest testowalne jednostkowo na syntetycznym SQL-u. Ten sam
// wzorzec co src/lib/ci/dbContract.ts.

import type {
  AuthzSnapshotModule,
  AuthzSnapshotStats,
  FeatureGateEntry,
  RoleGateEntry,
  TenantRef,
} from "@/lib/authz/authzSnapshotTypes";

export type { FeatureGateEntry, RoleGateEntry, AuthzSnapshotStats, TenantRef };

/** Funkcja SQL w stanie końcowym (komentarze już usunięte). */
export interface AuthzFunctionInput {
  /** `public.nazwa/arność` - klucz stanu końcowego. */
  readonly key: string;
  /** `public.nazwa`. */
  readonly name: string;
  readonly file: string;
  /** Ciało między tagami dollar-quote. */
  readonly body: string;
  /** Atrybuty (LANGUAGE, SECURITY DEFINER, ...) bez ciała. */
  readonly attrs: string;
}

/** Pojedynczy plik migracji (komentarze już usunięte). */
export interface AuthzMigrationInput {
  readonly file: string;
  readonly sql: string;
}

export interface AuthzGateSource {
  readonly functions: readonly AuthzFunctionInput[];
  readonly migrations: readonly AuthzMigrationInput[];
}

/** Pełny wynik skanu migracji (nadzbiór tego, co trafia do snapshotu w bundlu). */
export type AuthzSnapshot = AuthzSnapshotModule;

/**
 * Aliasy rolowe, których CAŁA semantyka to "wołający ma jedną z tych ról".
 * Zbiory ról nie są tu wpisane - liczymy je z ciał tych właśnie funkcji, więc
 * zmiana `is_staff()` w bazie przelicza całą macierz.
 *
 * `any` = alternatywa (gałąź OR), `all` = twardy warunek (RAISE gdy brak roli).
 */
const ROLE_ALIAS_ANY: readonly string[] = [
  "is_staff",
  "is_super_admin",
  "can_publish_content",
  // 20260806150000: jedyne źródło prawdy dla „kto zmienia weryfikację profilu".
  // Trigger, RPC panelu, RPC domen weryfikacji i polityka RLS czytają ten sam
  // predykat, więc zbiory ról tych bramek nie mogą się już rozjechać - a macierz
  // nadal liczy je z SQL-a, bo alias rozwija się z własnego ciała.
  "can_manage_profile_verification",
];
const ROLE_ALIAS_ALL: readonly string[] = ["assert_admin_tenant"];

/** `has_role(<uid>, 'rola')` - z opcjonalnym rzutowaniem i wyrażeniem w 1. argumencie. */
const HAS_ROLE_RE = /has_role\s*\(\s*[^,()]*(?:\([^()]*\))?[^,()]*,\s*'([a-zA-Z0-9_]+)'/g;

/**
 * `role = 'rola'::app_role` - WYMAGAMY jawnego rzutowania, bo kolumna `role`
 * występuje też w tabelach niezwiązanych z rolami systemowymi
 * (conversation_participants, member_organizations) i goły literał dawałby
 * fałszywe trafienia. Literały bez rzutowania łapie `has_role`.
 */
const ROLE_CAST_RE = /\brole\s*=\s*'([a-zA-Z0-9_]+)'::(?:public\.)?app_role/g;

/** Odczyty flag `features` będące BRAMKĄ (nie seedem: `?`, `-`, jsonb_build_object). */
const FEATURE_READ_RES: readonly RegExp[] = [
  /\bhas_tier_feature\s*\(\s*'([a-z0-9_]+)'/g,
  /\buser_has_tier_feature\s*\(\s*[^,()]*(?:\([^()]*\))?[^,()]*,\s*'([a-z0-9_]+)'/g,
  /[a-z_]*features\s*->>\s*'([a-z0-9_]+)'/g,
];

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function matchAll(text: string, re: RegExp): string[] {
  const out: string[] = [];
  re.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) out.push(match[1]);
  return out;
}

function calls(text: string, fn: string): boolean {
  return new RegExp(`\\b${fn}\\s*\\(`, "i").test(text);
}

/** Wartości enuma `app_role`: CREATE TYPE ... AS ENUM + ALTER TYPE ... ADD VALUE. */
export function deriveAppRoles(migrations: readonly AuthzMigrationInput[]): string[] {
  const createRe = /CREATE\s+TYPE\s+(?:public\.)?"?app_role"?\s+AS\s+ENUM\s*\(([^)]*)\)/gi;
  const addRe =
    /ALTER\s+TYPE\s+(?:public\.)?"?app_role"?\s+ADD\s+VALUE\s+(?:IF\s+NOT\s+EXISTS\s+)?'([^']+)'/gi;
  const values = new Set<string>();

  for (const { sql } of migrations) {
    createRe.lastIndex = 0;
    let created: RegExpExecArray | null;
    while ((created = createRe.exec(sql)) !== null) {
      for (const raw of created[1].split(",")) {
        const value = raw.trim().replace(/^'|'$/g, "");
        if (value !== "") values.add(value);
      }
    }
    for (const value of matchAll(sql, addRe)) values.add(value);
  }
  return sortedUnique(values);
}

/** Żywa polityka RLS (ostatnia operacja to CREATE). */
interface PolicyDef {
  readonly table: string;
  readonly name: string;
  readonly file: string;
  readonly sql: string;
}

/**
 * Dzieli SQL na instrukcje po średnikach najwyższego poziomu, respektując
 * literały `'...'` i bloki dollar-quote (`$$ ... $$`, `$tag$ ... $tag$`) - bez
 * tego ciało funkcji rozpadłoby się na śmieciowe "instrukcje".
 */
export function splitSqlStatements(sql: string): string[] {
  const out: string[] = [];
  let current = "";
  let i = 0;
  let inSingle = false;

  while (i < sql.length) {
    const ch = sql[i];

    if (inSingle) {
      current += ch;
      // '' wewnątrz literału to escape apostrofu, nie koniec literału.
      if (ch === "'") {
        if (sql[i + 1] === "'") {
          current += "'";
          i += 2;
          continue;
        }
        inSingle = false;
      }
      i += 1;
      continue;
    }

    if (ch === "'") {
      inSingle = true;
      current += ch;
      i += 1;
      continue;
    }

    if (ch === "$") {
      const tag = /^\$[A-Za-z0-9_]*\$/.exec(sql.slice(i));
      if (tag !== null) {
        const close = sql.indexOf(tag[0], i + tag[0].length);
        const end = close < 0 ? sql.length : close + tag[0].length;
        current += sql.slice(i, end);
        i = end;
        continue;
      }
    }

    if (ch === ";") {
      if (current.trim() !== "") out.push(current.trim());
      current = "";
      i += 1;
      continue;
    }

    current += ch;
    i += 1;
  }
  if (current.trim() !== "") out.push(current.trim());
  return out;
}

const CREATE_POLICY_RE =
  /^CREATE\s+POLICY\s+(?:"([^"]+)"|([a-zA-Z0-9_]+))\s+ON\s+(?:public\.)?"?([a-zA-Z0-9_]+)"?/i;
const DROP_POLICY_RE =
  /^DROP\s+POLICY\s+(?:IF\s+EXISTS\s+)?(?:"([^"]+)"|([a-zA-Z0-9_]+))\s+ON\s+(?:public\.)?"?([a-zA-Z0-9_]+)"?/i;

/** Polityki RLS żywe po zastosowaniu wszystkich migracji (CREATE minus DROP). */
export function deriveLivePolicies(migrations: readonly AuthzMigrationInput[]): PolicyDef[] {
  const live = new Map<string, PolicyDef>();

  for (const { file, sql } of migrations) {
    for (const statement of splitSqlStatements(sql)) {
      const created = CREATE_POLICY_RE.exec(statement);
      if (created !== null) {
        const name = created[1] ?? created[2];
        const table = created[3].toLowerCase();
        live.set(`${table}|${name}`, { table, name, file, sql: statement });
        continue;
      }
      const dropped = DROP_POLICY_RE.exec(statement);
      if (dropped !== null) {
        const name = dropped[1] ?? dropped[2];
        live.delete(`${dropped[3].toLowerCase()}|${name}`);
      }
    }
  }
  return [...live.values()].sort(
    (a, b) => a.table.localeCompare(b.table) || a.name.localeCompare(b.name),
  );
}

/** Literały ról w wyrażeniu, ograniczone do wartości enuma (odsiewa obce kolumny `role`). */
function directRoles(text: string, appRoles: ReadonlySet<string>): string[] {
  const found = [...matchAll(text, HAS_ROLE_RE), ...matchAll(text, ROLE_CAST_RE)];
  return sortedUnique(found.filter((role) => appRoles.has(role)));
}

function featureKeysIn(text: string): string[] {
  return sortedUnique(FEATURE_READ_RES.flatMap((re) => matchAll(text, re)));
}

/**
 * Jak bramka odnosi się do tenanta. `current_tenant_id()` = tenant DOMOWY
 * wołającego (jedyna wiarygodna podstawa izolacji obszarów roboczych); samo
 * porównanie kolumn `tenant_id` daje spójność wiersz-wiersz, ale nie wiąże jej z
 * wołającym; brak jednego i drugiego to sygnał do przeglądu w audycie.
 */
function tenantRefOf(text: string): TenantRef {
  if (/\bcurrent_tenant_id\s*\(/i.test(text)) return "caller";
  if (/\btenant_id\b/i.test(text)) return "row";
  return "none";
}

/**
 * Snapshot bramek autoryzacji odtworzony z migracji.
 *
 * Zwraca WSZYSTKIE znalezione bramki - filtrowanie do zbioru dokumentowanego
 * przez macierz robi generator (renderAuthzSnapshotModule), żeby bramka parytetu
 * mogła osobno wykryć referencje wiszące.
 */
export function deriveAuthzSnapshot(source: AuthzGateSource): AuthzSnapshot {
  const appRoles = deriveAppRoles(source.migrations);
  const roleSet = new Set(appRoles);

  // Krok 1: literały bezpośrednie per funkcja (baza dla rozwinięcia aliasów).
  const direct = new Map<string, string[]>();
  for (const fn of source.functions) direct.set(fn.key, directRoles(fn.body, roleSet));

  /** Zbiór ról aliasu - z jego własnego ciała, nie z listy w kodzie TS. */
  const aliasRoles = (alias: string): readonly string[] => {
    for (const fn of source.functions) {
      if (fn.name === `public.${alias}`) return direct.get(fn.key) ?? [];
    }
    return [];
  };

  const expand = (
    text: string,
    own: readonly string[],
  ): { anyRoles: string[]; allRoles: string[] } => {
    const anyRoles = new Set(own);
    const allRoles = new Set<string>();
    for (const alias of ROLE_ALIAS_ANY) {
      if (calls(text, alias)) for (const role of aliasRoles(alias)) anyRoles.add(role);
    }
    for (const alias of ROLE_ALIAS_ALL) {
      if (calls(text, alias)) for (const role of aliasRoles(alias)) allRoles.add(role);
    }
    return { anyRoles: sortedUnique(anyRoles), allRoles: sortedUnique(allRoles) };
  };

  const roleGates: RoleGateEntry[] = [];
  const featureGates: FeatureGateEntry[] = [];

  const pushGate = (entry: RoleGateEntry): void => {
    if (entry.anyRoles.length > 0 || entry.allRoles.length > 0 || entry.featureKeys.length > 0) {
      roleGates.push(entry);
    }
    for (const capability of entry.featureKeys) {
      featureGates.push({
        capability,
        ref: entry.ref,
        kind: entry.kind,
        object: entry.object,
        file: entry.file,
        bypassRoles: gateEffectiveRoles(entry),
        tenantRef: entry.tenantRef,
      });
    }
  };

  for (const fn of source.functions) {
    const { anyRoles, allRoles } = expand(fn.body, direct.get(fn.key) ?? []);
    pushGate({
      ref: `fn:${fn.key.replace(/^public\./, "")}`,
      kind: "function",
      object: fn.name.replace(/^public\./, ""),
      file: fn.file,
      anyRoles,
      allRoles,
      tenantRef: tenantRefOf(fn.body),
      securityDefiner: /SECURITY\s+DEFINER/i.test(fn.attrs),
      featureKeys: featureKeysIn(fn.body),
    });
  }

  const policies = deriveLivePolicies(source.migrations);
  for (const policy of policies) {
    const { anyRoles, allRoles } = expand(policy.sql, directRoles(policy.sql, roleSet));
    pushGate({
      ref: `policy:${policy.table}/${policy.name}`,
      kind: "policy",
      object: policy.table,
      file: policy.file,
      anyRoles,
      allRoles,
      tenantRef: tenantRefOf(policy.sql),
      securityDefiner: false,
      featureKeys: featureKeysIn(policy.sql),
    });
  }

  return {
    appRoles,
    roleGates: roleGates.sort((a, b) => a.ref.localeCompare(b.ref)),
    featureGates: featureGates.sort(
      (a, b) => a.capability.localeCompare(b.capability) || a.ref.localeCompare(b.ref),
    ),
    stats: {
      migrations: source.migrations.length,
      functions: source.functions.length,
      policies: policies.length,
    },
  };
}

/**
 * Role, które FAKTYCZNIE przechodzą bramkę:
 *  - tylko `allRoles` (twardy `assert_*`)     -> allRoles,
 *  - tylko `anyRoles` (alternatywy OR)        -> anyRoles,
 *  - jedno i drugie (bramka mieszana)         -> suma, z flagą `mixed` w gateMode().
 */
export function gateEffectiveRoles(gate: RoleGateEntry): string[] {
  if (gate.allRoles.length === 0) return [...gate.anyRoles];
  if (gate.anyRoles.length === 0) return [...gate.allRoles];
  return sortedUnique([...gate.allRoles, ...gate.anyRoles]);
}

export type GateMode = "any" | "all" | "mixed" | "none";

export function gateMode(gate: RoleGateEntry): GateMode {
  if (gate.anyRoles.length > 0 && gate.allRoles.length > 0) return "mixed";
  if (gate.allRoles.length > 0) return "all";
  if (gate.anyRoles.length > 0) return "any";
  return "none";
}

/** Flagi warstw czytane przez co najmniej jedną żywą bramkę. */
export function gatedFeatureKeys(snapshot: AuthzSnapshot): string[] {
  return sortedUnique(snapshot.featureGates.map((gate) => gate.capability));
}

/** Bramki flagi (kolejność: funkcje przed politykami, potem po referencji). */
export function featureGatesFor(snapshot: AuthzSnapshot, capability: string): FeatureGateEntry[] {
  return snapshot.featureGates.filter((gate) => gate.capability === capability);
}

// ---------------------------------------------------------------------------
// Renderowanie modułu snapshotu (lockfile dla macierzy uprawnień)
// ---------------------------------------------------------------------------

/** Podzbiór snapshotu, który trafia do bundla klienta. */
export interface AuthzSnapshotSelection {
  /** Referencje bramek rolowych dokumentowanych przez macierz (`fn:...`/`policy:...`). */
  readonly roleGateRefs: readonly string[];
}

export interface SelectedAuthzSnapshot extends AuthzSnapshot {
  /** Referencje z zaznaczenia, dla których nie ma bramki w migracjach. */
  readonly danglingRefs: readonly string[];
}

/**
 * Zawęża snapshot do bramek dokumentowanych przez macierz. Pełny skan ma ~1000
 * polityk - w bundlu trasy admina siedzą wyłącznie bramki, o których macierz
 * naprawdę coś twierdzi, plus KOMPLETNA mapa bramek flag warstw (kilkanaście
 * kluczy), bo od niej zależy pole `enforced` w rejestrze capabilities.
 */
export function selectAuthzSnapshot(
  snapshot: AuthzSnapshot,
  selection: AuthzSnapshotSelection,
): SelectedAuthzSnapshot {
  const wanted = new Set(selection.roleGateRefs);
  const byRef = new Map(snapshot.roleGates.map((gate) => [gate.ref, gate]));
  const roleGates = snapshot.roleGates.filter((gate) => wanted.has(gate.ref));
  return {
    appRoles: snapshot.appRoles,
    roleGates,
    featureGates: snapshot.featureGates,
    stats: snapshot.stats,
    danglingRefs: [...wanted].filter((ref) => !byRef.has(ref)).sort(),
  };
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

/**
 * Moduł TS ze snapshotem - format stabilny (bajt w bajt) dla tego samego wejścia.
 * Jedna bramka = jedna linia, żeby diff w code review pokazywał DOKŁADNIE, która
 * bramka zmieniła zbiór ról (plik jest w .prettierignore, jak pozostałe
 * `*.generated.ts`).
 */
export function renderAuthzSnapshotModule(selected: SelectedAuthzSnapshot): string {
  const list = (entries: readonly unknown[]): string =>
    entries.length === 0 ? "[]" : `[\n${entries.map((e) => `    ${json(e)},`).join("\n")}\n  ]`;

  return [
    "// WYGENEROWANE przez scripts/generate-authz-snapshot.ts z supabase/migrations.",
    "// Nie edytować ręcznie - zmiany nadpisze `bun run generate:authz-snapshot`.",
    "//",
    "// Snapshot bramek autoryzacji odtworzony ze SQL-a: role przechodzące każdą",
    "// dokumentowaną bramkę oraz flagi `membership_tiers.features` realnie czytane",
    "// przez bramki. Macierz uprawnień (/admin/permissions) renderuje się z tych",
    "// danych, a test parytetu (src/lib/authz/__tests__) porównuje plik z ponownym",
    "// odtworzeniem z migracji - rozjazd bazy i strony obleje CI.",
    'import type { AuthzSnapshotModule } from "@/lib/authz/authzSnapshotTypes";',
    "",
    "export const AUTHZ_SNAPSHOT: AuthzSnapshotModule = {",
    `  appRoles: ${json(selected.appRoles)},`,
    `  roleGates: ${list(selected.roleGates)},`,
    `  featureGates: ${list(selected.featureGates)},`,
    `  stats: ${json(selected.stats)},`,
    "};",
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Dryf snapshotu: waga (uprawnienia vs provenance) + dowód na poziomie pola
// ---------------------------------------------------------------------------

/**
 * Waga rozjazdu. `authorization` zmienia krąg uprawnionych albo warunki dostępu
 * i wymaga świadomej decyzji w code review. `provenance` oznacza ten sam stan
 * uprawnień w innym miejscu historii migracji - wystarczy regeneracja pliku.
 */
export type AuthzDriftSeverity = "authorization" | "provenance";

/** Pojedyncze pole, które faktycznie się różni (dowód pod tezą komunikatu). */
export interface AuthzFieldDrift {
  readonly field: string;
  readonly severity: AuthzDriftSeverity;
  readonly committed: string;
  readonly derived: string;
}

export type AuthzDriftKind =
  | "app_roles"
  | "gate_added"
  | "gate_removed"
  | "gate_changed"
  | "feature_gate_added"
  | "feature_gate_removed"
  | "feature_gate_changed"
  | "stats";

/** Jeden wpis rozjazdu snapshotu wobec `supabase/migrations`. */
export interface AuthzSnapshotDrift {
  readonly kind: AuthzDriftKind;
  readonly severity: AuthzDriftSeverity;
  /** Bramka / klucz, którego dotyczy wpis (używany też do sortowania). */
  readonly subject: string;
  readonly fields: readonly AuthzFieldDrift[];
  readonly message: string;
}

const SEVERITY_RANK: Record<AuthzDriftSeverity, number> = {
  authorization: 0,
  provenance: 1,
};

/**
 * Klasyfikacja pól bramki rolowej. `Record<Exclude<keyof RoleGateEntry, "ref">>`
 * jest celowy: nowe pole w kontrakcie bramki nie skompiluje się, dopóki ktoś nie
 * zdecyduje, czy jego zmiana to zmiana uprawnień, czy tylko provenance.
 */
const ROLE_GATE_FIELD_SEVERITY: Record<Exclude<keyof RoleGateEntry, "ref">, AuthzDriftSeverity> = {
  anyRoles: "authorization",
  allRoles: "authorization",
  tenantRef: "authorization",
  securityDefiner: "authorization",
  featureKeys: "authorization",
  kind: "authorization",
  object: "authorization",
  file: "provenance",
};

const FEATURE_FIELD_SEVERITY: Record<
  Exclude<keyof FeatureGateEntry, "capability" | "ref">,
  AuthzDriftSeverity
> = {
  bypassRoles: "authorization",
  tenantRef: "authorization",
  kind: "authorization",
  object: "authorization",
  file: "provenance",
};

/**
 * Metryki skanu porównujemy WYŁĄCZNIE po liczbie migracji: to ona mówi, że
 * snapshot powstał z innego stanu `supabase/migrations`. Liczba funkcji i
 * polityk zmienia się przy każdym zawężeniu zaznaczenia, więc raportowana
 * osobno tylko szumiałaby w komunikacie.
 */
const STATS_FIELD_SEVERITY: Record<string, AuthzDriftSeverity> = {
  migrations: "provenance",
};

/** Pola niosące ZBIÓR RÓL - tylko one uzasadniają tezę „krąg uprawnionych". */
const ROLE_BEARING_FIELDS = new Set(["anyRoles", "allRoles", "bypassRoles", "appRoles"]);

/** Czytelna wartość pola: tablice jako `[a, b]`, reszta bez cudzysłowów JSON-a. */
function formatFieldValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => String(item)).join(", ")}]`;
  return String(value);
}

/** Różnice pól dwóch obiektów w kolejności deklaracji klasyfikacji. */
function fieldDrift<T extends object>(
  committed: T,
  derived: T,
  severities: Record<string, AuthzDriftSeverity>,
): AuthzFieldDrift[] {
  const out: AuthzFieldDrift[] = [];
  for (const [field, severity] of Object.entries(severities)) {
    const a = (committed as Record<string, unknown>)[field];
    const b = (derived as Record<string, unknown>)[field];
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    out.push({ field, severity, committed: formatFieldValue(a), derived: formatFieldValue(b) });
  }
  return out;
}

function describeFields(fields: readonly AuthzFieldDrift[]): string {
  return fields.map((f) => `${f.field}: ${f.committed} -> ${f.derived}`).join(", ");
}

function worstSeverity(fields: readonly AuthzFieldDrift[]): AuthzDriftSeverity {
  return fields.some((f) => f.severity === "authorization") ? "authorization" : "provenance";
}

/** Teza komunikatu: krąg uprawnionych zmieniamy TYLKO przy polach z rolami. */
function describeAuthorizationChange(fields: readonly AuthzFieldDrift[]): string {
  const roles = fields.some(
    (f) => f.severity === "authorization" && ROLE_BEARING_FIELDS.has(f.field),
  );
  return roles ? "zmieniła krąg uprawnionych" : "zmieniła warunki dostępu";
}

/**
 * Pełny dryf snapshotu wobec migracji: wpisy z wagą i dowodem na poziomie pola,
 * posortowane „najpierw uprawnienia".
 */
export function collectAuthzSnapshotDrift(
  committed: AuthzSnapshot,
  derived: AuthzSnapshot,
): AuthzSnapshotDrift[] {
  const drift: AuthzSnapshotDrift[] = [];

  if (json(committed.appRoles) !== json(derived.appRoles)) {
    const fields: AuthzFieldDrift[] = [
      {
        field: "appRoles",
        severity: "authorization",
        committed: formatFieldValue(committed.appRoles),
        derived: formatFieldValue(derived.appRoles),
      },
    ];
    drift.push({
      kind: "app_roles",
      severity: "authorization",
      subject: "app_role",
      fields,
      message: `enum app_role rozjechał się: ${describeFields(fields)} (snapshot -> migracje)`,
    });
  }

  const committedGates = new Map(committed.roleGates.map((gate) => [gate.ref, gate]));
  const derivedGates = new Map(derived.roleGates.map((gate) => [gate.ref, gate]));

  for (const [ref, gate] of committedGates) {
    const fresh = derivedGates.get(ref);
    if (fresh === undefined) {
      drift.push({
        kind: "gate_removed",
        severity: "authorization",
        subject: ref,
        fields: [],
        message: `bramka '${ref}' jest w snapshocie, ale nie ma jej już w migracjach`,
      });
      continue;
    }
    const fields = fieldDrift(gate, fresh, ROLE_GATE_FIELD_SEVERITY);
    if (fields.length === 0) continue;
    const severity = worstSeverity(fields);
    drift.push({
      kind: "gate_changed",
      severity,
      subject: ref,
      fields,
      message:
        severity === "authorization"
          ? `bramka '${ref}' ${describeAuthorizationChange(fields)}: ${describeFields(fields)} (snapshot -> migracje)`
          : `bramka '${ref}' zmieniła provenance (bez zmiany uprawnień): ${describeFields(fields)} - wystarczy regeneracja snapshotu`,
    });
  }

  for (const ref of derivedGates.keys()) {
    if (committedGates.has(ref)) continue;
    drift.push({
      kind: "gate_added",
      severity: "authorization",
      subject: ref,
      fields: [],
      message: `bramka '${ref}' jest w migracjach, ale nie w snapshocie`,
    });
  }

  const featureKey = (gate: FeatureGateEntry): string => `${gate.capability}|${gate.ref}`;
  const committedFeatures = new Map(committed.featureGates.map((gate) => [featureKey(gate), gate]));
  const derivedFeatures = new Map(derived.featureGates.map((gate) => [featureKey(gate), gate]));

  for (const [key, gate] of committedFeatures) {
    const fresh = derivedFeatures.get(key);
    if (fresh === undefined) {
      drift.push({
        kind: "feature_gate_removed",
        severity: "authorization",
        subject: key,
        fields: [],
        message: `bramka flagi '${key}' zniknęła z migracji`,
      });
      continue;
    }
    // Zmiana POLA bramki flagi (np. dopisany bypass stafowy) była wcześniej
    // niewidoczna - porównywaliśmy tylko obecność klucza.
    const fields = fieldDrift(gate, fresh, FEATURE_FIELD_SEVERITY);
    if (fields.length === 0) continue;
    const severity = worstSeverity(fields);
    drift.push({
      kind: "feature_gate_changed",
      severity,
      subject: key,
      fields,
      message:
        severity === "authorization"
          ? `bramka flagi '${key}' ${describeAuthorizationChange(fields)}: ${describeFields(fields)} (snapshot -> migracje)`
          : `bramka flagi '${key}' pochodzi z innej migracji: ${describeFields(fields)} - wystarczy regeneracja snapshotu`,
    });
  }

  for (const key of derivedFeatures.keys()) {
    if (committedFeatures.has(key)) continue;
    drift.push({
      kind: "feature_gate_added",
      severity: "authorization",
      subject: key,
      fields: [],
      message: `bramka flagi '${key}' doszła w migracjach`,
    });
  }

  // Metryki skanu: snapshot z innego stanu `supabase/migrations` jest nieaktualny
  // nawet wtedy, gdy żadna DOKUMENTOWANA bramka się nie zmieniła. Bez tego test
  // parytetu przechodził, a bajtowa bramka `check:authz-snapshot` padała - dwa
  // pomiary tego samego artefaktu nie mogą mówić czegoś innego.
  const statsFields = fieldDrift(committed.stats, derived.stats, STATS_FIELD_SEVERITY);
  if (statsFields.length > 0) {
    drift.push({
      kind: "stats",
      severity: "provenance",
      subject: "stats",
      fields: statsFields,
      message: `snapshot pochodzi ze starszego skanu migracji: ${describeFields(statsFields)} - wystarczy regeneracja snapshotu`,
    });
  }

  return drift.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.subject.localeCompare(b.subject),
  );
}

/**
 * Czytelny diff snapshotów dla komunikatu bramki parytetu - lista komunikatów w
 * kolejności „najpierw uprawnienia". Pusta lista = snapshot zgadza się z migracjami.
 */
export function diffAuthzSnapshots(committed: AuthzSnapshot, derived: AuthzSnapshot): string[] {
  return collectAuthzSnapshotDrift(committed, derived).map((entry) => entry.message);
}

/** Czy w dryfie jest cokolwiek, co zmienia krąg uprawnionych. */
export function hasAuthorizationDrift(drift: readonly AuthzSnapshotDrift[]): boolean {
  return drift.some((entry) => entry.severity === "authorization");
}

/**
 * Raport dla CI: sekcje wg wagi, żeby „zawężenie uprawnień" nigdy nie schowało
 * się między wpisami o przeniesionej definicji.
 */
export function formatAuthzDriftReport(drift: readonly AuthzSnapshotDrift[]): string {
  if (drift.length === 0) return "Snapshot bramek zgadza się z supabase/migrations.";

  const section = (severity: AuthzDriftSeverity, title: string): string[] => {
    const entries = drift.filter((item) => item.severity === severity);
    if (entries.length === 0) return [];
    return [`${title} (${entries.length}):`, ...entries.map((item) => `  • ${item.message}`)];
  };

  return [
    "Snapshot bramek rozjechał się z supabase/migrations.",
    ...section("authorization", "ZMIANA UPRAWNIEŃ - do rozstrzygnięcia w code review"),
    ...section("provenance", "PROVENANCE - ten sam krąg uprawnionych, inne miejsce w historii"),
    "Regeneracja: `bun run generate:authz-snapshot` (i commit wyniku).",
  ].join("\n");
}
