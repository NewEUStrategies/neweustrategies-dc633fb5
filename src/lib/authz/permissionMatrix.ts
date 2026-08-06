// Macierz uprawnień - KOMPOZYCJA, nie deklaracja.
//
// Poziomy dostępu nie są tu wpisane. Każda komórka wynika z jednego z dwóch
// źródeł prawdy:
//   - kolumny ról  <- snapshot bramek SQL (authzSnapshot.generated.ts): rola ma
//     dostęp wtedy i tylko wtedy, gdy bramka wymienia ją po nazwie,
//   - kolumny warstw <- `membership_tiers.features` BIEŻĄCEGO tenanta plus rejestr
//     capabilities (lib/billing/capabilities), który mówi, czy flaga ma realną bramkę.
//
// Dzięki temu strona /admin/permissions nie może rozjechać się z bazą w ciszy:
// zmiana bramki przechodzi do macierzy sama, a zmiana kontraktu (nowa rola, nowa
// flaga, zniknięta bramka) wywala test parytetu.
//
// Moduł jest czysty i bez zależności od Reacta - wejściem są wiersze warstw, więc
// da się go przetestować bez sieci i bez DOM-u.
import { AUTHZ_SNAPSHOT } from "@/lib/authz/authzSnapshot.generated";
import type {
  AuthzSnapshotModule,
  FeatureGateEntry,
  RoleGateEntry,
  TenantRef,
} from "@/lib/authz/authzSnapshotTypes";
import { APP_ROLES, type AppRole } from "@/lib/authz/roles";
import {
  ROLE_PERMISSION_ROWS,
  TIER_GATE_GROUP,
  type PermissionGroupId,
  type RolePermissionRow,
} from "@/lib/authz/permissionRows";
import { NUMERIC_FEATURE_KEYS, TIER_CAPABILITIES } from "@/lib/billing/capabilities";

export type PermissionLevel = "full" | "partial" | "none" | "not_applicable";

export type ActorKind = "role" | "tier";

/** Kolumna macierzy: rola systemowa albo warstwa członkostwa tenanta. */
export interface MatrixActor {
  /** `role:admin` / `tier:member` - unikalne w obrębie macierzy. */
  readonly id: string;
  readonly kind: ActorKind;
  /** Klucz źródłowy: wartość app_role albo `membership_tiers.key`. */
  readonly key: string;
  /** Nazwa PL/EN warstwy z bazy; role mają etykiety w i18n. */
  readonly namePl: string | null;
  readonly nameEn: string | null;
  /** Ranga warstwy (kolejność kolumn); role: null. */
  readonly rank: number | null;
  /** Czy to warstwa domyślna tenanta. */
  readonly isDefault: boolean;
}

export type MatrixRowSource = "role_gate" | "tier_capability" | "tier_quota";

/** Skrót bramki SQL stojącej za wierszem (do badge'y i tooltipów). */
export interface GateSummary {
  /** Referencje w snapshocie (`fn:...` / `policy:...`). */
  readonly refs: readonly string[];
  /** Nazwy obiektów SQL - to pokazujemy w UI. */
  readonly objects: readonly string[];
  readonly kinds: readonly ("function" | "policy")[];
  /**
   * Migracje z OSTATNIĄ (żywą) definicją - równolegle do `refs`. Provenance jest
   * tu nie dla ozdoby: dryf tego właśnie pola dawał w bramce parytetu komunikat
   * „bramka rozjechała się" z dwoma identycznymi obiektami, bo diagnostyka
   * porównywała pole, którego nie drukowała. Audytor widzi teraz na stronie, KTÓRA
   * migracja jest dziś prawem dla danej bramki.
   */
  readonly files: readonly string[];
  /** `any` = alternatywa OR, `all` = twardy warunek, `mixed` = jedno i drugie. */
  readonly mode: "any" | "all" | "mixed" | "none";
  /** Najsłabsze odniesienie do tenanta ze wszystkich bramek wiersza. */
  readonly tenantRef: TenantRef;
  readonly securityDefiner: boolean;
}

export interface MatrixRow {
  readonly id: string;
  readonly group: PermissionGroupId;
  readonly source: MatrixRowSource;
  /** Pełny klucz i18n etykiety wiersza. */
  readonly labelKey: string;
  /** Klucz flagi `features` (wiersze warstw) albo null. */
  readonly capability: string | null;
  /** Czy wiersz opisuje coś, co system realnie egzekwuje. */
  readonly enforced: boolean;
  readonly gate: GateSummary | null;
  /** Poziom per kolumna (klucz = MatrixActor.id). */
  readonly levels: Readonly<Record<string, PermissionLevel>>;
  /** Wartości limitu per kolumna - tylko dla `tier_quota`. */
  readonly quota: Readonly<Record<string, number>> | null;
}

export interface PermissionMatrix {
  readonly actors: readonly MatrixActor[];
  readonly rows: readonly MatrixRow[];
  /** Metryki nagłówka (KPI) - liczone raz, żeby UI nie iterował po macierzy. */
  readonly summary: PermissionMatrixSummary;
}

export interface PermissionMatrixSummary {
  readonly rows: number;
  readonly enforcedRows: number;
  readonly decorativeRows: number;
  readonly roleGates: number;
  /** Bramki rolowe bez odwołania do tenanta wołającego - pozycje do przeglądu. */
  readonly gatesWithoutCallerTenant: number;
  readonly tiers: number;
}

/** Wiersz warstwy z bazy - strukturalnie zgodny z `membership_tiers`. */
export interface TierInput {
  readonly key: string;
  readonly rank: number;
  readonly name_pl: string | null;
  readonly name_en: string | null;
  readonly features: unknown;
  readonly is_default?: boolean | null;
}

export interface BuildMatrixOptions {
  /** Warstwy BIEŻĄCEGO tenanta (patrz permissionMatrixQuery - zapytanie po tenant_id). */
  readonly tiers: readonly TierInput[];
  /** Wstrzykiwany snapshot - do testów; domyślnie ten wygenerowany z migracji. */
  readonly snapshot?: AuthzSnapshotModule;
}

export const roleActorId = (role: string): string => `role:${role}`;
export const tierActorId = (key: string): string => `tier:${key}`;

function tenantRefWeight(ref: TenantRef): number {
  return ref === "caller" ? 2 : ref === "row" ? 1 : 0;
}

/** Provenance bramki: wersja migracji + data, czytelnie dla człowieka. */
export interface MigrationProvenance {
  /** Prefiks wersji (`YYYYMMDDHHMMSS`) albo cała nazwa pliku, gdy nie pasuje. */
  readonly version: string;
  /** `2026-08-06` albo null, gdy prefiks nie jest datą (migracje sprzed konwencji). */
  readonly date: string | null;
  /** Pełna nazwa pliku - to jest adres, pod który idzie audytor. */
  readonly file: string;
}

const MIGRATION_VERSION_RE = /^(\d{4})(\d{2})(\d{2})(\d{6})?(?:_|$)/;

/**
 * Rozbiera nazwę pliku migracji na wersję i datę. Czysta funkcja (bez i18n i bez
 * DOM-u), bo tę samą wartość pokazuje UI i mogą czytać raporty.
 */
export function migrationProvenance(file: string): MigrationProvenance {
  const match = MIGRATION_VERSION_RE.exec(file);
  if (match === null) return { version: file, date: null, file };
  const [, year, month, day, time] = match;
  return {
    version: `${year}${month}${day}${time ?? ""}`,
    date: `${year}-${month}-${day}`,
    file,
  };
}

function featureFlag(features: unknown, key: string): boolean {
  if (features === null || typeof features !== "object" || Array.isArray(features)) return false;
  return (features as Record<string, unknown>)[key] === true;
}

function featureNumber(features: unknown, key: string): number {
  if (features === null || typeof features !== "object" || Array.isArray(features)) return 0;
  const raw = (features as Record<string, unknown>)[key];
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim() !== "") {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

/** Role, które przechodzą bramkę (patrz gateEffectiveRoles w warstwie CI). */
function effectiveRoles(gate: RoleGateEntry): readonly string[] {
  if (gate.allRoles.length === 0) return gate.anyRoles;
  if (gate.anyRoles.length === 0) return gate.allRoles;
  return [...new Set([...gate.allRoles, ...gate.anyRoles])].sort((a, b) => a.localeCompare(b));
}

function gateModeOf(gate: RoleGateEntry): GateSummary["mode"] {
  if (gate.anyRoles.length > 0 && gate.allRoles.length > 0) return "mixed";
  if (gate.allRoles.length > 0) return "all";
  if (gate.anyRoles.length > 0) return "any";
  return "none";
}

function summarizeGates(gates: readonly RoleGateEntry[]): GateSummary | null {
  if (gates.length === 0) return null;
  const modes = new Set(gates.map(gateModeOf));
  return {
    refs: gates.map((gate) => gate.ref),
    objects: gates.map((gate) => gate.object),
    kinds: gates.map((gate) => gate.kind),
    files: gates.map((gate) => gate.file),
    mode: modes.size === 1 ? [...modes][0] : "mixed",
    // Najsłabsze ogniwo decyduje o komunikacie o tenancie.
    tenantRef: gates.reduce<TenantRef>(
      (weakest, gate) =>
        tenantRefWeight(gate.tenantRef) < tenantRefWeight(weakest) ? gate.tenantRef : weakest,
      "caller",
    ),
    securityDefiner: gates.every((gate) => gate.securityDefiner),
  };
}

/** Bramka flagi warstwy przedstawiona jak bramka rolowa (do jednolitego skrótu). */
function featureGateAsRoleGate(gate: FeatureGateEntry): RoleGateEntry {
  return {
    ref: gate.ref,
    kind: gate.kind,
    object: gate.object,
    file: gate.file,
    anyRoles: gate.bypassRoles,
    allRoles: [],
    tenantRef: gate.tenantRef,
    securityDefiner: gate.kind === "function",
    featureKeys: [gate.capability],
  };
}

function buildRoleRow(
  row: RolePermissionRow,
  gate: RoleGateEntry | undefined,
  actors: readonly MatrixActor[],
): MatrixRow {
  const passing = new Set(gate === undefined ? [] : effectiveRoles(gate));
  const scoped = new Set<string>(row.scoped ?? []);
  const levels: Record<string, PermissionLevel> = {};

  for (const actor of actors) {
    if (actor.kind === "tier") {
      // Bramka rolowa nie patrzy na warstwę - "nie dotyczy" jest uczciwsze niż "brak".
      levels[actor.id] = "not_applicable";
      continue;
    }
    levels[actor.id] = passing.has(actor.key)
      ? scoped.has(actor.key)
        ? "partial"
        : "full"
      : "none";
  }

  return {
    id: row.id,
    group: row.group,
    source: "role_gate",
    labelKey: `adminPermissions.rows.${row.id}`,
    capability: null,
    enforced: gate !== undefined,
    gate: summarizeGates(gate === undefined ? [] : [gate]),
    levels,
    quota: null,
  };
}

function buildTierRow(
  capability: string,
  group: PermissionGroupId,
  gates: readonly FeatureGateEntry[],
  actors: readonly MatrixActor[],
  tiers: readonly TierInput[],
): MatrixRow {
  const byKey = new Map(tiers.map((tier) => [tier.key, tier]));
  const bypass = new Set(gates.flatMap((gate) => gate.bypassRoles));
  const levels: Record<string, PermissionLevel> = {};

  for (const actor of actors) {
    if (actor.kind === "role") {
      // Rola daje dostęp do flagi warstwy TYLKO jeśli bramka wymienia ją jako
      // obejście; inaczej o dostępie decyduje warstwa konta, nie rola.
      levels[actor.id] = bypass.has(actor.key) ? "full" : "not_applicable";
      continue;
    }
    const tier = byKey.get(actor.key);
    levels[actor.id] = featureFlag(tier?.features ?? null, capability) ? "full" : "none";
  }

  return {
    id: `cap_${capability}`,
    group,
    source: "tier_capability",
    labelKey: `adminPermissions.caps.${capability}`,
    capability,
    enforced: gates.length > 0,
    gate: summarizeGates(gates.map(featureGateAsRoleGate)),
    levels,
    quota: null,
  };
}

function buildQuotaRow(
  capability: string,
  gates: readonly FeatureGateEntry[],
  actors: readonly MatrixActor[],
  tiers: readonly TierInput[],
): MatrixRow {
  const byKey = new Map(tiers.map((tier) => [tier.key, tier]));
  const bypass = new Set(gates.flatMap((gate) => gate.bypassRoles));
  const levels: Record<string, PermissionLevel> = {};
  const quota: Record<string, number> = {};

  for (const actor of actors) {
    if (actor.kind === "role") {
      levels[actor.id] = bypass.has(actor.key) ? "full" : "not_applicable";
      continue;
    }
    const value = featureNumber(byKey.get(actor.key)?.features ?? null, capability);
    quota[actor.id] = value;
    levels[actor.id] = value > 0 ? "full" : "none";
  }

  return {
    id: `quota_${capability}`,
    group: "membership",
    source: "tier_quota",
    labelKey: `adminPermissions.quotas.${capability}`,
    capability,
    enforced: gates.length > 0,
    gate: summarizeGates(gates.map(featureGateAsRoleGate)),
    levels,
    quota,
  };
}

function tierActors(tiers: readonly TierInput[]): MatrixActor[] {
  return [...tiers]
    .sort((a, b) => a.rank - b.rank || a.key.localeCompare(b.key))
    .map((tier) => ({
      id: tierActorId(tier.key),
      kind: "tier" as const,
      key: tier.key,
      namePl: tier.name_pl ?? null,
      nameEn: tier.name_en ?? null,
      rank: tier.rank,
      isDefault: tier.is_default === true,
    }));
}

/**
 * Buduje macierz dla PODANYCH warstw (jednego tenanta). Kolumny ról są zawsze
 * obecne - biorą się z kontraktu enuma; kolumny warstw pojawiają się tylko dla
 * warstw, które faktycznie przyszły z bazy, żeby strona nigdy nie sugerowała
 * zakresu warstwy, której ten tenant nie ma.
 */
export function buildPermissionMatrix(options: BuildMatrixOptions): PermissionMatrix {
  const snapshot = options.snapshot ?? AUTHZ_SNAPSHOT;
  const gatesByRef = new Map(snapshot.roleGates.map((gate) => [gate.ref, gate]));

  const actors: MatrixActor[] = [
    ...APP_ROLES.map((role: AppRole) => ({
      id: roleActorId(role),
      kind: "role" as const,
      key: role,
      namePl: null,
      nameEn: null,
      rank: null,
      isDefault: false,
    })),
    ...tierActors(options.tiers),
  ];

  const roleRows = ROLE_PERMISSION_ROWS.map((row) =>
    buildRoleRow(row, gatesByRef.get(row.gateRef), actors),
  );

  // Jedna flaga może mieć kilka bramek (np. `pro_briefings` czyta i rsvp_event,
  // i get_event_access) - wiersz pokazuje wszystkie.
  const featureGatesByKey = new Map<string, FeatureGateEntry[]>();
  for (const gate of snapshot.featureGates) {
    const bucket = featureGatesByKey.get(gate.capability);
    if (bucket === undefined) featureGatesByKey.set(gate.capability, [gate]);
    else bucket.push(gate);
  }

  const tierRows = TIER_CAPABILITIES.map((meta) =>
    buildTierRow(
      meta.key,
      TIER_GATE_GROUP[meta.gate],
      featureGatesByKey.get(meta.key) ?? [],
      actors,
      options.tiers,
    ),
  );

  const quotaRows = NUMERIC_FEATURE_KEYS.map((key) =>
    buildQuotaRow(key, featureGatesByKey.get(key) ?? [], actors, options.tiers),
  );

  const rows = [...roleRows, ...tierRows, ...quotaRows];
  const gateRows = rows.filter((row) => row.gate !== null);

  return {
    actors,
    rows,
    summary: {
      rows: rows.length,
      enforcedRows: rows.filter((row) => row.enforced).length,
      decorativeRows: rows.filter((row) => !row.enforced).length,
      roleGates: roleRows.filter((row) => row.gate !== null).length,
      gatesWithoutCallerTenant: gateRows.filter((row) => row.gate?.tenantRef !== "caller").length,
      tiers: options.tiers.length,
    },
  };
}

// ---------------------------------------------------------------------------
// Filtrowanie (czyste - używane przez UI i testowane bez DOM-u)
// ---------------------------------------------------------------------------

export interface MatrixFilter {
  /** Fraza; dopasowanie po przetłumaczonej etykiecie, kluczu flagi i nazwie bramki. */
  readonly query: string;
  /** Ograniczenie kolumn do ról albo warstw. */
  readonly actorKind: ActorKind | "all";
  /** Tylko wiersze z realną bramką. */
  readonly onlyEnforced: boolean;
  readonly group: PermissionGroupId | "all";
}

export const EMPTY_MATRIX_FILTER: MatrixFilter = {
  query: "",
  actorKind: "all",
  onlyEnforced: false,
  group: "all",
};

/**
 * Zawężenie macierzy. `label` dostarcza UI (tłumaczenie etykiety wiersza), żeby
 * szukanie działało w języku, który użytkownik widzi na ekranie.
 */
export function filterMatrix(
  matrix: PermissionMatrix,
  filter: MatrixFilter,
  label: (row: MatrixRow) => string,
): { actors: readonly MatrixActor[]; rows: readonly MatrixRow[] } {
  const needle = filter.query.trim().toLowerCase();
  const actors =
    filter.actorKind === "all"
      ? matrix.actors
      : matrix.actors.filter((actor) => actor.kind === filter.actorKind);

  const rows = matrix.rows.filter((row) => {
    if (filter.onlyEnforced && !row.enforced) return false;
    if (filter.group !== "all" && row.group !== filter.group) return false;
    if (needle === "") return true;
    const haystack = [
      label(row),
      row.capability ?? "",
      ...(row.gate?.objects ?? []),
      ...(row.gate?.refs ?? []),
      // Provenance jest szukalna: „20260806" wyciąga wszystkie bramki, które
      // zmieniła dzisiejsza delta migracji - dokładnie to pytanie zadaje audyt.
      ...(row.gate?.files ?? []),
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(needle);
  });

  return { actors, rows };
}

// ---------------------------------------------------------------------------
// Etykiety (czyste - `translate` wstrzykuje UI, żeby moduł nie znał i18next)
// ---------------------------------------------------------------------------

export type Translate = (key: string) => string;

/**
 * Etykieta wiersza. Gdy tłumaczenia zabrakło (i18next zwraca wtedy sam klucz),
 * spadamy do klucza technicznego - strona nigdy nie pokazuje `adminPermissions.…`
 * jako treści. Kompletność tłumaczeń pilnuje osobno test parytetu.
 */
export function rowLabel(row: MatrixRow, translate: Translate): string {
  const label = translate(row.labelKey);
  if (label !== row.labelKey && label.trim() !== "") return label;
  return row.capability ?? row.id;
}

/** Nazwa kolumny: role z i18n, warstwy z bazy (nazwa PL/EN tenanta). */
export function actorName(actor: MatrixActor, lang: "pl" | "en", translate: Translate): string {
  if (actor.kind === "role") {
    const key = `adminPermissions.roles.${actor.key}.name`;
    const label = translate(key);
    return label === key ? actor.key : label;
  }
  const fromDb = lang === "en" ? actor.nameEn : actor.namePl;
  return fromDb !== null && fromDb.trim() !== "" ? fromDb : actor.key;
}

/**
 * Ile flag warstwy ma realną bramkę (licznik na karcie warstwy). `total` liczy
 * WSZYSTKIE włączone flagi z rejestru - różnica między liczbami to dokładnie ta
 * część obietnicy, której system dziś nie pilnuje.
 */
export function tierEnforcementCount(
  matrix: PermissionMatrix,
  actorId: string,
): { enforced: number; total: number } {
  let enforced = 0;
  let total = 0;
  for (const row of matrix.rows) {
    if (row.source !== "tier_capability") continue;
    if (row.levels[actorId] !== "full") continue;
    total += 1;
    if (row.enforced) enforced += 1;
  }
  return { enforced, total };
}

/** Wiersze zgrupowane w kolejności sekcji - gotowe do renderu tabeli. */
export function groupRows(
  rows: readonly MatrixRow[],
  order: readonly PermissionGroupId[],
): ReadonlyArray<{ group: PermissionGroupId; rows: readonly MatrixRow[] }> {
  return order
    .map((group) => ({ group, rows: rows.filter((row) => row.group === group) }))
    .filter((section) => section.rows.length > 0);
}
