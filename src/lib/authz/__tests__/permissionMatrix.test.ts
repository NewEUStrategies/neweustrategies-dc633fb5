// Testy kompozycji macierzy uprawnień.
//
// Sprawdzamy KONTRAKT, nie wygląd: że poziomy wynikają z bramek i z flag warstw,
// że kolumny warstw pochodzą wyłącznie z podanych (tenantowych) danych, że każdy
// wiersz i każda kolumna ma tłumaczenie PL i EN, oraz że filtrowanie jest czyste.
import { describe, expect, it } from "vitest";
import type { AuthzSnapshotModule } from "@/lib/authz/authzSnapshotTypes";
import {
  EMPTY_MATRIX_FILTER,
  actorName,
  buildPermissionMatrix,
  filterMatrix,
  groupRows,
  roleActorId,
  rowLabel,
  tierActorId,
  tierEnforcementCount,
  type TierInput,
} from "@/lib/authz/permissionMatrix";
import {
  PERMISSION_GROUPS,
  ROLE_PERMISSION_ROWS,
  TIER_GATE_GROUP,
} from "@/lib/authz/permissionRows";
import { APP_ROLES } from "@/lib/authz/roles";
import { NUMERIC_FEATURE_KEYS, TIER_CAPABILITIES } from "@/lib/billing/capabilities";
import { pl as corePl } from "@/lib/locale/pl";
import { en as coreEn } from "@/lib/locale/en";
import { flattenKeys, readKey, type ResourceTree } from "@/lib/ci/i18nParity";

const SNAPSHOT: AuthzSnapshotModule = {
  appRoles: ["admin", "author", "editor", "super_admin", "user"],
  roleGates: [
    {
      ref: "fn:admin_list_users/0",
      kind: "function",
      object: "admin_list_users",
      file: "x.sql",
      anyRoles: ["admin", "super_admin"],
      allRoles: [],
      tenantRef: "caller",
      securityDefiner: true,
      featureKeys: [],
    },
    {
      ref: "fn:is_staff/0",
      kind: "function",
      object: "is_staff",
      file: "x.sql",
      anyRoles: ["admin", "author", "editor"],
      allRoles: [],
      tenantRef: "none",
      securityDefiner: true,
      featureKeys: [],
    },
    {
      ref: "fn:admin_grant_membership/4",
      kind: "function",
      object: "admin_grant_membership",
      file: "x.sql",
      anyRoles: [],
      allRoles: ["admin"],
      tenantRef: "row",
      securityDefiner: true,
      featureKeys: [],
    },
  ],
  featureGates: [
    {
      capability: "premium_content",
      ref: "fn:has_content_access/2",
      kind: "function",
      object: "has_content_access",
      file: "x.sql",
      bypassRoles: [],
      tenantRef: "row",
    },
    {
      capability: "recordings",
      ref: "fn:get_event_access/1",
      kind: "function",
      object: "get_event_access",
      file: "x.sql",
      bypassRoles: ["admin", "editor"],
      tenantRef: "caller",
    },
    {
      capability: "expert_request_quota",
      ref: "fn:my_expert_request_quota/0",
      kind: "function",
      object: "my_expert_request_quota",
      file: "x.sql",
      bypassRoles: ["super_admin"],
      tenantRef: "none",
    },
  ],
  stats: { migrations: 1, functions: 3, policies: 0 },
};

const TIERS: readonly TierInput[] = [
  {
    key: "reader",
    rank: 0,
    name_pl: "Essential",
    name_en: "Essential",
    features: {},
    is_default: true,
  },
  {
    key: "member",
    rank: 10,
    name_pl: "Plus",
    name_en: "Plus",
    features: { premium_content: true, recordings: true, working_groups: true },
    is_default: false,
  },
  {
    key: "pro",
    rank: 20,
    name_pl: "Pro",
    name_en: "Pro",
    features: { premium_content: true, expert_request_quota: 4 },
    is_default: false,
  },
];

const matrix = buildPermissionMatrix({ tiers: TIERS, snapshot: SNAPSHOT });
const row = (id: string) => {
  const found = matrix.rows.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`brak wiersza '${id}' w macierzy`);
  return found;
};

describe("kolumny macierzy", () => {
  it("role są zawsze obecne i w kolejności malejącego zaufania", () => {
    const roles = matrix.actors.filter((actor) => actor.kind === "role").map((actor) => actor.key);
    expect(roles).toEqual([...APP_ROLES]);
  });

  it("warstwy pochodzą WYŁĄCZNIE z podanych danych tenanta, posortowane rangą", () => {
    const tiers = matrix.actors.filter((actor) => actor.kind === "tier");
    expect(tiers.map((actor) => actor.key)).toEqual(["reader", "member", "pro"]);
    expect(tiers.map((actor) => actor.rank)).toEqual([0, 10, 20]);
    expect(tiers.filter((actor) => actor.isDefault).map((actor) => actor.key)).toEqual(["reader"]);
  });

  it("bez warstw tenanta macierz pokazuje tylko role (żadnej wymyślonej kolumny)", () => {
    const roleOnly = buildPermissionMatrix({ tiers: [], snapshot: SNAPSHOT });
    expect(roleOnly.actors.every((actor) => actor.kind === "role")).toBe(true);
    expect(roleOnly.summary.tiers).toBe(0);
  });

  it("warstwy innego tenanta nie mogą wejść do macierzy zbudowanej dla pierwszego", () => {
    const other = buildPermissionMatrix({
      tiers: [{ key: "obcy", rank: 99, name_pl: "Obcy", name_en: "Other", features: {} }],
      snapshot: SNAPSHOT,
    });
    expect(matrix.actors.map((actor) => actor.id)).not.toContain(tierActorId("obcy"));
    expect(other.actors.map((actor) => actor.id)).not.toContain(tierActorId("member"));
  });
});

describe("poziomy wynikają z bramek, nie z deklaracji", () => {
  it("rola wymieniona przez bramkę ma pełny dostęp, pozostałe nie mają żadnego", () => {
    const users = row("users_list");
    expect(users.levels[roleActorId("admin")]).toBe("full");
    expect(users.levels[roleActorId("super_admin")]).toBe("full");
    expect(users.levels[roleActorId("editor")]).toBe("none");
    expect(users.levels[roleActorId("user")]).toBe("none");
  });

  it("bramka rolowa nie zależy od warstwy - kolumny warstw są 'nie dotyczy'", () => {
    const users = row("users_list");
    expect(users.levels[tierActorId("pro")]).toBe("not_applicable");
  });

  it("zawężenie zakresu obniża poziom do 'własne' tylko dla wskazanej roli", () => {
    const editorial = row("editorial_scope");
    expect(editorial.levels[roleActorId("author")]).toBe("partial");
    expect(editorial.levels[roleActorId("editor")]).toBe("full");
  });

  it("twardy warunek (`assert_*`) daje dostęp tylko wymienionej roli", () => {
    const grant = row("membership_grant");
    expect(grant.levels[roleActorId("admin")]).toBe("full");
    expect(grant.levels[roleActorId("super_admin")]).toBe("none");
    expect(grant.gate?.mode).toBe("all");
  });

  it("bramka bez definicji w snapshocie daje wiersz bez bramki (nie 'pełny dostęp')", () => {
    const noGate = buildPermissionMatrix({
      tiers: TIERS,
      snapshot: { ...SNAPSHOT, roleGates: [] },
    });
    const users = noGate.rows.find((candidate) => candidate.id === "users_list");
    expect(users?.enforced).toBe(false);
    expect(users?.gate).toBeNull();
    expect(users?.levels[roleActorId("admin")]).toBe("none");
  });
});

describe("wiersze flag warstw", () => {
  it("flaga włączona w warstwie daje pełny poziom, wyłączona - brak", () => {
    const premium = row("cap_premium_content");
    expect(premium.levels[tierActorId("member")]).toBe("full");
    expect(premium.levels[tierActorId("reader")]).toBe("none");
  });

  it("rola dostaje flagę warstwy tylko przez jawne obejście w bramce", () => {
    const recordings = row("cap_recordings");
    expect(recordings.levels[roleActorId("admin")]).toBe("full");
    expect(recordings.levels[roleActorId("editor")]).toBe("full");
    expect(recordings.levels[roleActorId("author")]).toBe("not_applicable");
    // Paywall treści nie ma obejścia stafowego - i macierz to pokazuje.
    expect(row("cap_premium_content").levels[roleActorId("editor")]).toBe("not_applicable");
  });

  it("flaga bez bramki jest oznaczona jako dekoracyjna, choć warstwa ją ma", () => {
    const groups = row("cap_working_groups");
    expect(groups.enforced).toBe(false);
    expect(groups.levels[tierActorId("member")]).toBe("full");
  });

  it("jest dokładnie jeden wiersz na każdą flagę z rejestru (bijekcja)", () => {
    const capabilityRows = matrix.rows.filter((r) => r.source === "tier_capability");
    expect(capabilityRows).toHaveLength(TIER_CAPABILITIES.length);
    expect(capabilityRows.map((r) => r.capability).sort()).toEqual(
      TIER_CAPABILITIES.map((meta) => meta.key).sort(),
    );
  });

  it("flagi liczbowe pokazują wartość puli per warstwa", () => {
    const quota = row("quota_expert_request_quota");
    expect(quota.source).toBe("tier_quota");
    expect(quota.quota?.[tierActorId("pro")]).toBe(4);
    expect(quota.levels[tierActorId("pro")]).toBe("full");
    expect(quota.levels[tierActorId("member")]).toBe("none");
    expect(NUMERIC_FEATURE_KEYS).toContain("expert_request_quota");
  });

  it("licznik egzekwowania warstwy odróżnia obietnicę od bramki", () => {
    // Plus ma 3 włączone flagi, ale tylko 2 mają bramkę w tym snapshocie.
    expect(tierEnforcementCount(matrix, tierActorId("member"))).toEqual({
      enforced: 2,
      total: 3,
    });
  });
});

describe("struktura i metryki", () => {
  it("identyfikatory wierszy są unikalne", () => {
    const ids = matrix.rows.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("każdy wiersz trafia do znanej sekcji", () => {
    const known = new Set<string>(PERMISSION_GROUPS);
    expect(matrix.rows.filter((r) => !known.has(r.group))).toEqual([]);
  });

  it("flagi bez obszaru egzekwowania lądują w sekcji warstw członkostwa", () => {
    expect(TIER_GATE_GROUP.none).toBe("membership");
    expect(row("cap_vip_concierge").group).toBe("membership");
  });

  it("metryki zgadzają się z zawartością", () => {
    expect(matrix.summary.rows).toBe(matrix.rows.length);
    expect(matrix.summary.enforcedRows + matrix.summary.decorativeRows).toBe(matrix.rows.length);
    expect(matrix.summary.tiers).toBe(TIERS.length);
    expect(matrix.summary.gatesWithoutCallerTenant).toBeGreaterThan(0);
  });

  it("grupowanie zachowuje kolejność sekcji i pomija puste", () => {
    const sections = groupRows(matrix.rows, PERMISSION_GROUPS);
    const order = sections.map((section) => section.group);
    expect(order).toEqual(PERMISSION_GROUPS.filter((group) => order.includes(group)));
    expect(sections.every((section) => section.rows.length > 0)).toBe(true);
  });
});

describe("filtrowanie", () => {
  const label = (r: Parameters<typeof rowLabel>[0]): string => r.capability ?? r.id;

  it("puste filtry zwracają wszystko", () => {
    const result = filterMatrix(matrix, EMPTY_MATRIX_FILTER, label);
    expect(result.rows).toHaveLength(matrix.rows.length);
    expect(result.actors).toHaveLength(matrix.actors.length);
  });

  it("filtr kolumn zawęża aktorów, nie wiersze", () => {
    const result = filterMatrix(matrix, { ...EMPTY_MATRIX_FILTER, actorKind: "tier" }, label);
    expect(result.actors.every((actor) => actor.kind === "tier")).toBe(true);
    expect(result.rows).toHaveLength(matrix.rows.length);
  });

  it("szukanie działa po nazwie bramki SQL", () => {
    const result = filterMatrix(
      matrix,
      { ...EMPTY_MATRIX_FILTER, query: "admin_list_users" },
      label,
    );
    expect(result.rows.map((r) => r.id)).toEqual(["users_list"]);
  });

  it("szukanie działa po kluczu flagi", () => {
    const result = filterMatrix(
      matrix,
      { ...EMPTY_MATRIX_FILTER, query: "PREMIUM_content" },
      label,
    );
    expect(result.rows.map((r) => r.id)).toContain("cap_premium_content");
  });

  it("'tylko z bramką' odsiewa pozycje dekoracyjne", () => {
    const result = filterMatrix(matrix, { ...EMPTY_MATRIX_FILTER, onlyEnforced: true }, label);
    expect(result.rows.every((r) => r.enforced)).toBe(true);
    expect(result.rows.map((r) => r.id)).not.toContain("cap_working_groups");
  });

  it("filtr sekcji zwraca wyłącznie wybraną sekcję", () => {
    const result = filterMatrix(matrix, { ...EMPTY_MATRIX_FILTER, group: "users" }, label);
    expect(result.rows.every((r) => r.group === "users")).toBe(true);
    expect(result.rows.length).toBeGreaterThan(0);
  });
});

describe("kompletność tłumaczeń macierzy (PL i EN)", () => {
  // Ten test importuje rdzenne słowniki i nakładkę macierzy, więc sprawdza
  // dokładnie to, co zobaczy użytkownik - a nie samą obecność pliku.
  const overlays = import.meta.glob("/src/lib/i18n-admin-permissions.ts", { eager: true });

  function tree(lang: "pl" | "en"): ResourceTree {
    void overlays;
    return (lang === "pl" ? corePl : coreEn) as ResourceTree;
  }

  async function bundle(lang: "pl" | "en"): Promise<ResourceTree> {
    const { default: i18n } = await import("@/lib/i18n");
    const registered = i18n.getResourceBundle(lang, "translation") as ResourceTree | undefined;
    return { ...tree(lang), ...(registered ?? {}) };
  }

  it("każdy wiersz i każda kolumna ma etykietę PL i EN", async () => {
    const [pl, en] = await Promise.all([bundle("pl"), bundle("en")]);

    const required = [
      ...ROLE_PERMISSION_ROWS.map((r) => `adminPermissions.rows.${r.id}`),
      ...TIER_CAPABILITIES.map((meta) => `adminPermissions.caps.${meta.key}`),
      ...NUMERIC_FEATURE_KEYS.map((key) => `adminPermissions.quotas.${key}`),
      ...PERMISSION_GROUPS.map((group) => `adminPermissions.groups.${group}`),
      ...APP_ROLES.flatMap((role) => [
        `adminPermissions.roles.${role}.name`,
        `adminPermissions.roles.${role}.desc`,
      ]),
      ...["full", "partial", "none", "not_applicable"].flatMap((level) => [
        `adminPermissions.levels.${level}`,
        `adminPermissions.levelHints.${level}`,
      ]),
      ...["caller", "row", "none"].flatMap((ref) => [
        `adminPermissions.tenant.${ref}`,
        `adminPermissions.tenant.${ref}Hint`,
      ]),
      ...["any", "all", "mixed", "none"].flatMap((mode) => [
        `adminPermissions.gateMode.${mode}`,
        `adminPermissions.gateMode.${mode}Hint`,
      ]),
      "adminPermissions.title",
      "adminPermissions.subtitle",
      "adminPermissions.sourceTitle",
      "adminPermissions.sourceBody",
      "adminPermissions.generatedFrom",
      "adminPermissions.rlsNote",
      "adminPermissions.tenantNote",
    ];

    const missingPl = required.filter((key) => typeof readKey(pl, key) !== "string");
    const missingEn = required.filter((key) => typeof readKey(en, key) !== "string");
    expect(missingPl, "brakujące etykiety PL").toEqual([]);
    expect(missingEn, "brakujące etykiety EN").toEqual([]);
  });

  it("nakładka nie zostawia kluczy tylko w jednym języku", async () => {
    const [pl, en] = await Promise.all([bundle("pl"), bundle("en")]);
    const only = (a: ResourceTree, b: ResourceTree): string[] => {
      const other = new Set(flattenKeys(b).filter((key) => key.startsWith("adminPermissions.")));
      return flattenKeys(a)
        .filter((key) => key.startsWith("adminPermissions."))
        .filter((key) => !other.has(key) && !/_(few|many|one)$/.test(key))
        .sort();
    };
    expect(only(pl, en), "klucze bez wersji EN").toEqual([]);
    expect(only(en, pl), "klucze bez wersji PL").toEqual([]);
  });

  it("etykiety wierszy i kolumn są rozwiązywane, a nie pokazywane jako klucze", async () => {
    const { default: i18n } = await import("@/lib/i18n");
    const translate = (key: string): string => i18n.t(key);
    for (const r of matrix.rows) {
      const resolved = rowLabel(r, translate);
      expect(resolved.startsWith("adminPermissions."), `wiersz ${r.id}`).toBe(false);
      expect(resolved.trim()).not.toBe("");
    }
    for (const actor of matrix.actors) {
      const resolved = actorName(actor, "pl", translate);
      expect(resolved.startsWith("adminPermissions."), `kolumna ${actor.id}`).toBe(false);
    }
  });
});
