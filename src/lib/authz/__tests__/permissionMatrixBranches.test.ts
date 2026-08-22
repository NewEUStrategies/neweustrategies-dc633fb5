// Macierz uprawnień - REGUŁY WEJŚCIA, których nie widzi test kontraktu.
//
// `permissionMatrix.test.ts` dowodzi KONTRAKTU macierzy na danych ładnych: że
// poziomy biorą się z bramek, że kolumny warstw pochodzą wyłącznie od tenanta,
// że filtr i grupowanie są czyste, że każdy wiersz i każda kolumna ma etykietę
// PL i EN. Ten plik dowodzi rzeczy węższej i brzydszej: JAK REGUŁY ZACHOWUJĄ SIĘ
// NA WEJŚCIU, KTÓRE NIE JEST ŁADNE. A takie wejście jest tu stanem normalnym:
//
//   - `membership_tiers.features` to kolumna JSON, nie typ. Z bazy może przyjść
//     `null`, tablica, liczba, napis albo obiekt z limitem zapisanym jako napis
//     („3” z panelu cen). Od `featureNumber` zależy LIMIT WNIOSKÓW EKSPERCKICH,
//     a `0` znaczy „zero wniosków”, nie „brak limitu” - pomyłka w tę stronę
//     otwierałaby pulę, której warstwa nie kupiła.
//   - bramka SQL potrafi mieszać twardy `assert_*` z gałęzią OR, a jedna flaga
//     potrafi mieć kilka bramek o RÓŻNYCH trybach i różnym odniesieniu do
//     tenanta - i to skrót wiersza ma pokazać uczciwie (najsłabsze ogniwo).
//   - i18n potrafi nie mieć tłumaczenia; wtedy strona nie ma prawa pokazać
//     `adminPermissions.…` jako treści nagłówka.
//
// DLACZEGO OSOBNY PLIK, A NIE DOPISKI DO PLIKU KONTRAKTU. Te dowody są
// tabelaryczne (kilkadziesiąt kształtów JEDNEGO wejścia) i celują w funkcje
// wewnętrzne (`featureFlag`, `featureNumber`, `effectiveRoles`, `gateModeOf`,
// `summarizeGates`, `tierActors`) osiągane przez API publiczne. Wsypanie ich do
// pliku kontraktu utopiłoby jego czytelność: tam każdy test jest jednym zdaniem
// o produkcie, tu jest siatka kształtów danych. Podział jest więc po RODZAJU
// dowodu, nie po pliku produkcyjnym.
//
// CZEGO TEN PLIK ŚWIADOMIE NIE DUBLUJE:
//   - kontraktu macierzy: kolejność kolumn ról, bijekcja wiersz-flaga, filtr,
//     grupowanie, licznik egzekwowania warstwy, kompletność tłumaczeń PL/EN
//     (`permissionMatrix.test.ts`),
//   - parytetu snapshotu z migracjami (`authzSnapshotParity.test.ts`) - tu
//     snapshot jest WSTRZYKIWANY, żeby dowieść REGUŁY, a nie stanu bazy,
//   - bramek CI `check:authz-snapshot`, `check:permissions-parity`,
//     `check:gate-coverage` (nic tu nie regeneruje snapshotu),
//   - autorytetu bazy - pgTAP `role_management_test.sql`,
//     `rls_tenant_isolation_test.sql`, `security_definer_tenant_scope_test.sql`;
//     w tym pliku nie ma ani jednego zapytania i ani jednej atrapy Supabase,
//   - trzech kształtów nazwy migracji już przypiętych w pliku kontraktu (pełna
//     wersja / wersja bez części czasowej / plik poza konwencją) - dokładamy
//     wyłącznie kształty, których tam NIE MA.
import { describe, expect, it } from "vitest";
import { AUTHZ_SNAPSHOT } from "@/lib/authz/authzSnapshot.generated";
import type {
  AuthzSnapshotModule,
  FeatureGateEntry,
  RoleGateEntry,
  TenantRef,
} from "@/lib/authz/authzSnapshotTypes";
import {
  actorName,
  buildPermissionMatrix,
  migrationProvenance,
  roleActorId,
  rowLabel,
  tierActorId,
  type GateSummary,
  type MatrixActor,
  type MatrixRow,
  type PermissionLevel,
  type PermissionMatrix,
  type TierInput,
  type Translate,
} from "@/lib/authz/permissionMatrix";
import { APP_ROLES } from "@/lib/authz/roles";

// --- narzędzia (jedna warstwa, jeden tenant - minimum, żeby widzieć regułę) ---

const SOLO_KEY = "solo";
const SOLO = tierActorId(SOLO_KEY);
/** Bramka wiersza `users_list` - jedyny wiersz rolowy używany w tym pliku. */
const USERS_GATE_REF = "fn:admin_list_users/0";

function snapshotOf(parts: Partial<AuthzSnapshotModule> = {}): AuthzSnapshotModule {
  return {
    appRoles: [...APP_ROLES],
    roleGates: [],
    featureGates: [],
    stats: { migrations: 1, functions: 0, policies: 0 },
    ...parts,
  };
}

function roleGate(parts: Partial<RoleGateEntry> = {}): RoleGateEntry {
  return {
    ref: USERS_GATE_REF,
    kind: "function",
    object: "admin_list_users",
    file: "20260703090100_profiles_column_grants_and_role_audit.sql",
    anyRoles: [],
    allRoles: [],
    tenantRef: "caller",
    securityDefiner: true,
    featureKeys: [],
    ...parts,
  };
}

function featureGate(parts: Partial<FeatureGateEntry> = {}): FeatureGateEntry {
  return {
    capability: "premium_content",
    ref: "fn:has_content_access/2",
    kind: "function",
    object: "has_content_access",
    file: "20260703173228_admin_users.sql",
    bypassRoles: [],
    tenantRef: "caller",
    ...parts,
  };
}

function tierOf(features: unknown, parts: Partial<TierInput> = {}): TierInput {
  return {
    key: SOLO_KEY,
    rank: 0,
    name_pl: "Solo",
    name_en: "Solo",
    features,
    is_default: false,
    ...parts,
  };
}

function matrixOf(
  features: unknown,
  snapshot: AuthzSnapshotModule = snapshotOf(),
): PermissionMatrix {
  return buildPermissionMatrix({ tiers: [tierOf(features)], snapshot });
}

function rowOf(matrix: PermissionMatrix, id: string): MatrixRow {
  const found = matrix.rows.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`brak wiersza '${id}' w macierzy`);
  return found;
}

function actorOf(matrix: PermissionMatrix, id: string): MatrixActor {
  const found = matrix.actors.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`brak kolumny '${id}' w macierzy`);
  return found;
}

/** Role, którym wiersz `users_list` daje jakikolwiek dostęp - posortowane. */
function passingRoles(matrix: PermissionMatrix): string[] {
  const row = rowOf(matrix, "users_list");
  return APP_ROLES.filter((role) => row.levels[roleActorId(role)] !== "none").sort();
}

/** i18next bez tłumaczenia zwraca SAM KLUCZ - dokładnie to udaje ta atrapa. */
const echoKey: Translate = (key) => key;
/** Tłumaczenie „puste” (same spacje) - też nie jest treścią dla użytkownika. */
const blankLabel: Translate = () => "   ";
const realLabel: Translate = (key) => `[${key}]`;

// ---------------------------------------------------------------------------
// features jako kolumna JSON: flaga boolowska
// ---------------------------------------------------------------------------

interface FlagCase {
  readonly nazwa: string;
  readonly features: unknown;
  readonly poziom: PermissionLevel;
}

const FLAG_CASES: readonly FlagCase[] = [
  { nazwa: "null (kolumna bez wartości)", features: null, poziom: "none" },
  { nazwa: "undefined (brak pola w wierszu)", features: undefined, poziom: "none" },
  { nazwa: "TABLICA z nazwą flagi", features: ["premium_content"], poziom: "none" },
  { nazwa: "pusta tablica", features: [], poziom: "none" },
  { nazwa: "liczba zamiast obiektu", features: 42, poziom: "none" },
  { nazwa: "napis zamiast obiektu", features: "premium_content", poziom: "none" },
  { nazwa: "obiekt BEZ tego klucza", features: { recordings: true }, poziom: "none" },
  { nazwa: "klucz = false", features: { premium_content: false }, poziom: "none" },
  { nazwa: "klucz = null", features: { premium_content: null }, poziom: "none" },
  { nazwa: "klucz = napis „true”", features: { premium_content: "true" }, poziom: "none" },
  {
    nazwa: "klucz = 1 (prawdziwe, ale nie true)",
    features: { premium_content: 1 },
    poziom: "none",
  },
  { nazwa: "klucz = obiekt", features: { premium_content: {} }, poziom: "none" },
  { nazwa: "klucz = true", features: { premium_content: true }, poziom: "full" },
];

describe("features to kolumna JSON, nie typ - flaga boolowska warstwy", () => {
  // Reguła jest ostra celowo: dostęp daje WYŁĄCZNIE literalne `true`. Każdy inny
  // kształt (napis „true”, 1, obiekt) to ślad ręcznej edycji JSON-a albo importu
  // i macierz ma go pokazać jako BRAK dostępu, a nie zgadywać intencję.
  it.each(FLAG_CASES)("features $nazwa -> poziom $poziom", ({ features, poziom }) => {
    expect(rowOf(matrixOf(features), "cap_premium_content").levels[SOLO]).toBe(poziom);
  });

  it("kształt spoza obiektu nie wywala macierzy - pozostałe wiersze nadal są", () => {
    const matrix = matrixOf(["premium_content"]);
    expect(matrix.rows.length).toBeGreaterThan(0);
    expect(matrix.summary.tiers).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// features jako kolumna JSON: limit liczbowy
// ---------------------------------------------------------------------------

interface QuotaCase {
  readonly nazwa: string;
  readonly features: unknown;
  readonly wartosc: number;
  readonly poziom: PermissionLevel;
}

const QUOTA_CASES: readonly QuotaCase[] = [
  { nazwa: "null (kolumna bez wartości)", features: null, wartosc: 0, poziom: "none" },
  { nazwa: "undefined (brak pola)", features: undefined, wartosc: 0, poziom: "none" },
  { nazwa: "TABLICA z liczbą", features: [3], wartosc: 0, poziom: "none" },
  { nazwa: "liczba zamiast obiektu", features: 3, wartosc: 0, poziom: "none" },
  { nazwa: "napis zamiast obiektu", features: "3", wartosc: 0, poziom: "none" },
  { nazwa: "obiekt BEZ tego klucza", features: {}, wartosc: 0, poziom: "none" },
  { nazwa: "klucz = false", features: { expert_request_quota: false }, wartosc: 0, poziom: "none" },
  { nazwa: "klucz = true", features: { expert_request_quota: true }, wartosc: 0, poziom: "none" },
  { nazwa: "klucz = 3", features: { expert_request_quota: 3 }, wartosc: 3, poziom: "full" },
  {
    nazwa: "klucz = napis „3” (kształt z panelu cen)",
    features: { expert_request_quota: "3" },
    wartosc: 3,
    poziom: "full",
  },
  {
    nazwa: "klucz = napis „3.5”",
    features: { expert_request_quota: "3.5" },
    wartosc: 3.5,
    poziom: "full",
  },
  {
    nazwa: "klucz = napis „ 4 ” (spacje wokół liczby)",
    features: { expert_request_quota: " 4 " },
    wartosc: 4,
    poziom: "full",
  },
  {
    nazwa: "klucz = napis „abc”",
    features: { expert_request_quota: "abc" },
    wartosc: 0,
    poziom: "none",
  },
  {
    nazwa: "klucz = napis pusty",
    features: { expert_request_quota: "" },
    wartosc: 0,
    poziom: "none",
  },
  {
    nazwa: "klucz = napis z samych spacji",
    features: { expert_request_quota: "  " },
    wartosc: 0,
    poziom: "none",
  },
  {
    nazwa: "klucz = napis „Infinity”",
    features: { expert_request_quota: "Infinity" },
    wartosc: 0,
    poziom: "none",
  },
  {
    nazwa: "klucz = 0 (zero wniosków)",
    features: { expert_request_quota: 0 },
    wartosc: 0,
    poziom: "none",
  },
  {
    nazwa: "klucz = liczba nieskończona",
    features: { expert_request_quota: Number.POSITIVE_INFINITY },
    wartosc: 0,
    poziom: "none",
  },
  {
    nazwa: "klucz = NaN",
    features: { expert_request_quota: Number.NaN },
    wartosc: 0,
    poziom: "none",
  },
  { nazwa: "klucz = -3", features: { expert_request_quota: -3 }, wartosc: -3, poziom: "none" },
];

describe("features to kolumna JSON, nie typ - limit liczbowy warstwy", () => {
  // To NIE jest ozdoba tabeli: od tej funkcji zależy pula wniosków eksperckich.
  // Dwa wnioski osobno:
  //   - napis „3” MUSI dać 3, bo tak zapisuje limit panel cen (JSON z formularza),
  //   - `0` MUSI dać poziom „brak”, bo `0` znaczy „zero wniosków”; potraktowanie
  //     zera jak „brak limitu” otworzyłoby pulę bez limitu.
  it.each(QUOTA_CASES)(
    "features $nazwa -> limit $wartosc, poziom $poziom",
    ({ features, wartosc, poziom }) => {
      const row = rowOf(matrixOf(features), "quota_expert_request_quota");
      expect(row.quota?.[SOLO]).toBe(wartosc);
      expect(row.levels[SOLO]).toBe(poziom);
    },
  );

  it("brak wartości i zero są w macierzy NIEROZRÓŻNIALNE - obie znaczą zero wniosków", () => {
    const brak = rowOf(matrixOf(null), "quota_expert_request_quota");
    const zero = rowOf(matrixOf({ expert_request_quota: 0 }), "quota_expert_request_quota");
    expect(brak.quota?.[SOLO]).toBe(0);
    expect(zero.quota?.[SOLO]).toBe(0);
    expect(brak.levels[SOLO]).toBe(zero.levels[SOLO]);
  });

  it("liczby nie ma dla kolumn ról - limit jest własnością warstwy, nie roli", () => {
    const row = rowOf(
      matrixOf(
        { expert_request_quota: 3 },
        snapshotOf({
          featureGates: [
            featureGate({ capability: "expert_request_quota", bypassRoles: ["admin"] }),
          ],
        }),
      ),
      "quota_expert_request_quota",
    );
    expect(row.levels[roleActorId("admin")]).toBe("full");
    expect(row.levels[roleActorId("editor")]).toBe("not_applicable");
    expect(row.quota).not.toHaveProperty(roleActorId("admin"));
    expect(Object.keys(row.quota ?? {})).toEqual([SOLO]);
  });
});

// ---------------------------------------------------------------------------
// Kto przechodzi bramkę i jaki ma tryb
// ---------------------------------------------------------------------------

interface GateArmCase {
  readonly nazwa: string;
  readonly dowolne: readonly string[];
  readonly wszystkie: readonly string[];
  readonly tryb: GateSummary["mode"];
  readonly przechodza: readonly string[];
}

const GATE_ARMS: readonly GateArmCase[] = [
  { nazwa: "obie listy puste", dowolne: [], wszystkie: [], tryb: "none", przechodza: [] },
  {
    nazwa: "tylko gałąź OR",
    dowolne: ["admin", "editor"],
    wszystkie: [],
    tryb: "any",
    przechodza: ["admin", "editor"],
  },
  {
    nazwa: "tylko twardy assert",
    dowolne: [],
    wszystkie: ["admin"],
    tryb: "all",
    przechodza: ["admin"],
  },
  {
    nazwa: "assert I gałąź OR (bramka mieszana)",
    dowolne: ["editor"],
    wszystkie: ["admin"],
    tryb: "mixed",
    przechodza: ["admin", "editor"],
  },
];

describe("role przechodzące bramkę i tryb bramki - cztery ramiona", () => {
  it.each(GATE_ARMS)("$nazwa -> tryb $tryb", ({ dowolne, wszystkie, tryb, przechodza }) => {
    const matrix = matrixOf(
      null,
      snapshotOf({ roleGates: [roleGate({ anyRoles: dowolne, allRoles: wszystkie })] }),
    );
    expect(rowOf(matrix, "users_list").gate?.mode).toBe(tryb);
    expect(passingRoles(matrix)).toEqual([...przechodza].sort());
  });

  it("bramka, która nie wymienia ŻADNEJ roli, jest egzekwowana - tylko nikogo nie przepuszcza", () => {
    // To jest stan do przeglądu, nie „pełny dostęp”: wiersz ma bramkę (więc nie
    // jest dekoracyjny), a mimo to żadna rola go nie przechodzi.
    const matrix = matrixOf(null, snapshotOf({ roleGates: [roleGate()] }));
    const row = rowOf(matrix, "users_list");
    expect(row.enforced).toBe(true);
    expect(row.gate?.mode).toBe("none");
    expect(passingRoles(matrix)).toEqual([]);
  });

  it("tryb mieszany: wynik nie zależy od kolejności ani od powtórzeń na wejściu", () => {
    // Produkcja sortuje i deduplikuje sumę ról (permissionMatrix.ts:181), ale
    // KOLEJNOŚĆ tej tablicy nie jest widoczna przez API publiczne - `buildRoleRow`
    // pakuje wynik w `Set` i pyta go tylko o przynależność. Dowodem jest więc
    // OBSERWOWALNY skutek sortowania i dedupu: rola występująca w obu listach
    // przechodzi raz, a przestawienie wejścia nie zmienia ani jednej komórki.
    // Asercja wprost na kolejności wymagałaby wyeksportowania `effectiveRoles`,
    // czyli zmiany produkcji - a to nie jest praca testowa.
    const przestawiona = matrixOf(
      null,
      snapshotOf({
        roleGates: [roleGate({ allRoles: ["editor", "admin"], anyRoles: ["admin", "author"] })],
      }),
    );
    const kanoniczna = matrixOf(
      null,
      snapshotOf({
        roleGates: [roleGate({ allRoles: ["admin", "editor"], anyRoles: ["author"] })],
      }),
    );
    expect(passingRoles(przestawiona)).toEqual(["admin", "author", "editor"]);
    expect(passingRoles(przestawiona)).toEqual(passingRoles(kanoniczna));
    expect(rowOf(przestawiona, "users_list").levels).toEqual(
      rowOf(kanoniczna, "users_list").levels,
    );
  });

  it("rola nieznana bramce nie tworzy kolumny - kolumny biorą się z enuma", () => {
    const matrix = matrixOf(null, snapshotOf({ roleGates: [roleGate({ anyRoles: ["ghost"] })] }));
    expect(matrix.actors.map((actor) => actor.id)).not.toContain(roleActorId("ghost"));
    expect(passingRoles(matrix)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Skrót bramek wiersza
// ---------------------------------------------------------------------------

interface TenantCase {
  readonly nazwa: string;
  readonly refy: readonly TenantRef[];
  readonly wynik: TenantRef;
}

const TENANT_CASES: readonly TenantCase[] = [
  { nazwa: "caller", refy: ["caller"], wynik: "caller" },
  { nazwa: "row", refy: ["row"], wynik: "row" },
  { nazwa: "none", refy: ["none"], wynik: "none" },
  { nazwa: "caller + caller", refy: ["caller", "caller"], wynik: "caller" },
  { nazwa: "caller + row", refy: ["caller", "row"], wynik: "row" },
  { nazwa: "row + caller", refy: ["row", "caller"], wynik: "row" },
  { nazwa: "caller + none", refy: ["caller", "none"], wynik: "none" },
  { nazwa: "none + caller", refy: ["none", "caller"], wynik: "none" },
  { nazwa: "row + none", refy: ["row", "none"], wynik: "none" },
  { nazwa: "none + row", refy: ["none", "row"], wynik: "none" },
  { nazwa: "row + row", refy: ["row", "row"], wynik: "row" },
  { nazwa: "none + none", refy: ["none", "none"], wynik: "none" },
  { nazwa: "caller + row + none", refy: ["caller", "row", "none"], wynik: "none" },
];

describe("skrót bramek wiersza - najsłabsze ogniwo decyduje", () => {
  it("brak bramek to null, a nie skrót pusty", () => {
    // Wiersz bez bramki musi być odróżnialny od wiersza z bramką bez ról -
    // inaczej UI nie ma czym rozdzielić „dekoracja” od „nikt nie przechodzi”.
    const matrix = matrixOf({}, snapshotOf());
    expect(rowOf(matrix, "users_list").gate).toBeNull();
    expect(rowOf(matrix, "cap_premium_content").gate).toBeNull();
    expect(rowOf(matrix, "quota_expert_request_quota").gate).toBeNull();
  });

  it("jedna bramka przepisuje się do skrótu 1:1", () => {
    const matrix = matrixOf(
      {},
      snapshotOf({ featureGates: [featureGate({ tenantRef: "row", bypassRoles: ["admin"] })] }),
    );
    expect(rowOf(matrix, "cap_premium_content").gate).toEqual({
      refs: ["fn:has_content_access/2"],
      objects: ["has_content_access"],
      kinds: ["function"],
      files: ["20260703173228_admin_users.sql"],
      mode: "any",
      tenantRef: "row",
      securityDefiner: true,
    });
  });

  it("bramki o RÓŻNYCH trybach dają tryb mieszany i wszystkie bramki w skrócie", () => {
    const matrix = matrixOf(
      {},
      snapshotOf({
        featureGates: [
          featureGate({ bypassRoles: [] }),
          featureGate({
            ref: "fn:create_gift_link/3",
            object: "create_gift_link",
            bypassRoles: ["admin"],
          }),
          featureGate({
            ref: "policy:posts/posts member read",
            object: "posts",
            kind: "policy",
            file: "20260713_people.sql",
            bypassRoles: ["editor"],
          }),
        ],
      }),
    );
    const gate = rowOf(matrix, "cap_premium_content").gate;
    // Jedna bramka bez ról (tryb „brak”) i dwie z obejściem (tryb „alternatywa”)
    // -> skrót mówi „mieszana”, czyli: zobacz źródło SQL, nie zgaduj.
    expect(gate?.mode).toBe("mixed");
    expect(gate?.refs).toEqual([
      "fn:has_content_access/2",
      "fn:create_gift_link/3",
      "policy:posts/posts member read",
    ]);
    expect(gate?.objects).toEqual(["has_content_access", "create_gift_link", "posts"]);
    expect(gate?.kinds).toEqual(["function", "function", "policy"]);
    expect(gate?.files).toEqual([
      "20260703173228_admin_users.sql",
      "20260703173228_admin_users.sql",
      "20260713_people.sql",
    ]);
    // Polityka nie omija RLS, więc „wszystkie omijają” jest nieprawdą.
    expect(gate?.securityDefiner).toBe(false);
    // Obejście stafowe jest sumą obejść WSZYSTKICH bramek flagi.
    const levels = rowOf(matrix, "cap_premium_content").levels;
    expect(levels[roleActorId("admin")]).toBe("full");
    expect(levels[roleActorId("editor")]).toBe("full");
    expect(levels[roleActorId("author")]).toBe("not_applicable");
  });

  it.each(TENANT_CASES)("odniesienie do tenanta $nazwa -> $wynik", ({ refy, wynik }) => {
    const matrix = matrixOf(
      {},
      snapshotOf({
        featureGates: refy.map((tenantRef, index) =>
          featureGate({ ref: `fn:g${index}/0`, object: `g${index}`, tenantRef }),
        ),
      }),
    );
    expect(rowOf(matrix, "cap_premium_content").gate?.tenantRef).toBe(wynik);
  });

  it("„omija RLS” tylko wtedy, gdy omijają WSZYSTKIE bramki wiersza", () => {
    const funkcje = matrixOf(
      {},
      snapshotOf({
        featureGates: [featureGate(), featureGate({ ref: "fn:b/0", object: "b" })],
      }),
    );
    const zPolityka = matrixOf(
      {},
      snapshotOf({
        featureGates: [
          featureGate(),
          featureGate({ ref: "policy:posts/read", object: "posts", kind: "policy" }),
        ],
      }),
    );
    expect(rowOf(funkcje, "cap_premium_content").gate?.securityDefiner).toBe(true);
    expect(rowOf(zPolityka, "cap_premium_content").gate?.securityDefiner).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Kolumny warstw
// ---------------------------------------------------------------------------

describe("kolumny warstw - kolejność i nazwy z bazy", () => {
  it("warstwy o RÓWNEJ randze porządkuje klucz (kolejność kolumn jest deterministyczna)", () => {
    const matrix = buildPermissionMatrix({
      tiers: [
        tierOf({}, { key: "gamma", rank: 10 }),
        tierOf({}, { key: "alfa", rank: 10 }),
        tierOf({}, { key: "beta", rank: 5 }),
      ],
      snapshot: snapshotOf(),
    });
    expect(
      matrix.actors.filter((actor) => actor.kind === "tier").map((actor) => actor.key),
    ).toEqual(["beta", "alfa", "gamma"]);
  });

  it("sortowanie kolumn nie mutuje tablicy wejściowej (moduł jest czysty)", () => {
    const tiers = [tierOf({}, { key: "z", rank: 9 }), tierOf({}, { key: "a", rank: 1 })];
    buildPermissionMatrix({ tiers, snapshot: snapshotOf() });
    expect(tiers.map((tier) => tier.key)).toEqual(["z", "a"]);
  });

  it("warstwa bez nazw z bazy nie dostaje wymyślonej etykiety - nagłówek pokazuje klucz", () => {
    const matrix = buildPermissionMatrix({
      tiers: [tierOf({}, { name_pl: null, name_en: null })],
      snapshot: snapshotOf(),
    });
    const actor = actorOf(matrix, SOLO);
    expect(actor.namePl).toBeNull();
    expect(actor.nameEn).toBeNull();
    // Nawet DZIAŁAJĄCE i18n nie wymyśla nazwy warstwy - to dana tenanta.
    expect(actorName(actor, "pl", realLabel)).toBe(SOLO_KEY);
    expect(actorName(actor, "en", realLabel)).toBe(SOLO_KEY);
  });

  it("brak wartości `is_default` nie czyni warstwy domyślną", () => {
    const matrix = buildPermissionMatrix({
      tiers: [tierOf({}, { is_default: null })],
      snapshot: snapshotOf(),
    });
    expect(actorOf(matrix, SOLO).isDefault).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Etykiety, gdy tłumaczenia brak
// ---------------------------------------------------------------------------

describe("etykiety bez tłumaczenia - strona nigdy nie pokazuje klucza i18n", () => {
  const matrix = matrixOf(
    { premium_content: true },
    snapshotOf({ roleGates: [roleGate({ anyRoles: ["admin"] })] }),
  );

  it("wiersz rolowy spada do identyfikatora wiersza", () => {
    const row = rowOf(matrix, "users_list");
    expect(row.capability).toBeNull();
    expect(rowLabel(row, echoKey)).toBe("users_list");
  });

  it("wiersz flagi i wiersz limitu spadają do klucza flagi", () => {
    expect(rowLabel(rowOf(matrix, "cap_premium_content"), echoKey)).toBe("premium_content");
    expect(rowLabel(rowOf(matrix, "quota_expert_request_quota"), echoKey)).toBe(
      "expert_request_quota",
    );
  });

  it("tłumaczenie z samych spacji jest traktowane jak brak tłumaczenia", () => {
    expect(rowLabel(rowOf(matrix, "cap_premium_content"), blankLabel)).toBe("premium_content");
    expect(rowLabel(rowOf(matrix, "users_list"), blankLabel)).toBe("users_list");
  });

  it("obecne tłumaczenie wygrywa nad awaryjnym kluczem", () => {
    expect(rowLabel(rowOf(matrix, "cap_premium_content"), realLabel)).toBe(
      "[adminPermissions.caps.premium_content]",
    );
  });

  it("kolumna roli bez tłumaczenia pokazuje nazwę roli z enuma", () => {
    const admin = actorOf(matrix, roleActorId("admin"));
    expect(actorName(admin, "pl", echoKey)).toBe("admin");
    expect(actorName(admin, "pl", realLabel)).toBe("[adminPermissions.roles.admin.name]");
  });

  it("kolumna warstwy bierze nazwę z bazy - PL i EN osobno", () => {
    const dwujezyczna = buildPermissionMatrix({
      tiers: [tierOf({}, { name_pl: "Plus", name_en: "Plus EN" })],
      snapshot: snapshotOf(),
    });
    const actor = actorOf(dwujezyczna, SOLO);
    expect(actorName(actor, "pl", echoKey)).toBe("Plus");
    expect(actorName(actor, "en", echoKey)).toBe("Plus EN");
  });

  it("nazwa warstwy z samych spacji nie trafia do nagłówka - wygrywa klucz warstwy", () => {
    const puste = buildPermissionMatrix({
      tiers: [tierOf({}, { name_pl: "   ", name_en: "" })],
      snapshot: snapshotOf(),
    });
    const actor = actorOf(puste, SOLO);
    expect(actorName(actor, "pl", echoKey)).toBe(SOLO_KEY);
    expect(actorName(actor, "en", echoKey)).toBe(SOLO_KEY);
  });
});

// ---------------------------------------------------------------------------
// Snapshot domyślny i limit bez bramki
// ---------------------------------------------------------------------------

describe("snapshot domyślny i limit bez bramki", () => {
  it("bez wstrzykniętego snapshotu macierz bierze ten wygenerowany z migracji", () => {
    // Dowód na DOMYŚLNOŚĆ, nie na treść snapshotu (tę pilnuje test parytetu).
    expect(buildPermissionMatrix({ tiers: [] })).toEqual(
      buildPermissionMatrix({ tiers: [], snapshot: AUTHZ_SNAPSHOT }),
    );
    expect(buildPermissionMatrix({ tiers: [] }).summary.roleGates).toBeGreaterThan(0);
  });

  it("na ŻYWYM snapshocie flaga z kilkoma bramkami pokazuje je wszystkie w jednym wierszu", () => {
    // Gdyby przyszła migracja zwinęła bramki flag do jednej na flagę, ta asercja
    // jest miejscem na świadomą decyzję - nie na ciche wykreślenie.
    const matrix = buildPermissionMatrix({ tiers: [] });
    const wielobramkowe = matrix.rows.filter((row) => (row.gate?.refs.length ?? 0) > 1);
    expect(wielobramkowe.length).toBeGreaterThan(0);
    for (const row of wielobramkowe) {
      const liczba = row.gate?.refs.length ?? 0;
      expect(row.gate?.objects).toHaveLength(liczba);
      expect(row.gate?.kinds).toHaveLength(liczba);
      expect(row.gate?.files).toHaveLength(liczba);
    }
  });

  it("limit bez bramki jest dekoracyjny, ale wartość z warstwy nadal widać", () => {
    const matrix = matrixOf(
      { expert_request_quota: 5 },
      snapshotOf({ featureGates: [featureGate()] }),
    );
    const row = rowOf(matrix, "quota_expert_request_quota");
    expect(row.enforced).toBe(false);
    expect(row.gate).toBeNull();
    expect(row.quota?.[SOLO]).toBe(5);
    expect(row.levels[SOLO]).toBe("full");
  });
});

// ---------------------------------------------------------------------------
// Provenance - kształty nazw poza tymi przypiętymi w teście kontraktu
// ---------------------------------------------------------------------------

describe("provenance bramki - kształty brzegowe nazwy pliku", () => {
  it("sam prefiks wersji bez podkreślenia jest wersją (koniec napisu kończy prefiks)", () => {
    expect(migrationProvenance("20260806")).toEqual({
      version: "20260806",
      date: "2026-08-06",
      file: "20260806",
    });
    expect(migrationProvenance("20260806150000")).toEqual({
      version: "20260806150000",
      date: "2026-08-06",
      file: "20260806150000",
    });
  });

  it("wersja NIEODDZIELONA podkreśleniem nie jest rozbierana - wygrywa cała nazwa", () => {
    // `20260806150000.sql` nie jest nazwą z konwencji repo (brak `_opis`), więc
    // funkcja nie zgaduje: pokazuje plik i nie zmyśla daty.
    expect(migrationProvenance("20260806150000.sql")).toEqual({
      version: "20260806150000.sql",
      date: null,
      file: "20260806150000.sql",
    });
    expect(migrationProvenance("2026080_people.sql")).toEqual({
      version: "2026080_people.sql",
      date: null,
      file: "2026080_people.sql",
    });
  });

  it("pusta nazwa nie wywala funkcji", () => {
    expect(migrationProvenance("")).toEqual({ version: "", date: null, file: "" });
  });

  it("funkcja NIE waliduje kalendarza - liczy cyfry, nie miesiące", () => {
    // Stan faktyczny przypięty świadomie: nazwy migracji generuje narzędzie, więc
    // `20261332_…` nie może pojawić się w `supabase/migrations`. Gdyby jednak
    // ktoś dopisał plik ręcznie, UI pokaże datę niemożliwą - i to jest wtedy
    // sygnał o nazwie pliku, nie o bramce.
    expect(migrationProvenance("20261332_recznie.sql")).toEqual({
      version: "20261332",
      date: "2026-13-32",
      file: "20261332_recznie.sql",
    });
  });
});

// ---------------------------------------------------------------------------
// KPI „bramki bez current_tenant_id()”
// ---------------------------------------------------------------------------

describe("KPI bramek bez odniesienia do tenanta wołającego", () => {
  // DEFEKT (produkcja: src/lib/authz/permissionMatrix.ts:394 i :404).
  //
  // CO JEST ZŁE. `gatesWithoutCallerTenant` liczy WIERSZE z bramką, których
  // najsłabsze odniesienie do tenanta nie jest „caller” - a nie BRAMKI. Wiersz
  // flagi skleja wszystkie jej bramki w JEDEN skrót (`summarizeGates` wybiera
  // najsłabsze ogniwo), więc flaga o trzech bramkach wchodzi do licznika jako
  // jedna pozycja. Dodatkowo doc-comment pola (:105) mówi „Bramki rolowe”,
  // a wyrażenie iteruje po WSZYSTKICH wierszach - także po wierszach flag
  // i limitów. Pod żadnym z tych dwóch opisów liczba nie jest tym, co obiecuje.
  //
  // SKUTEK DLA UŻYTKOWNIKA. Kafel na /admin/permissions ma etykietę „Bramki bez
  // current_tenant_id()” (i18n-admin-permissions.ts:32) i zapala się na
  // ostrzeżenie; audytor czyta z niego liczbę pozycji do przeglądu izolacji
  // tenanta i dostaje liczbę MNIEJSZĄ od prawdy. Pomiar na tym HEAD
  // (2026-08-22, żywy snapshot: 43 bramki rolowe i 14 bramek flag): bez
  // `current_tenant_id()` jest 25 bramek (13 rolowych + 12 flagowych), a kafel
  // pokazuje 23 - bo `pro_briefings` (3 bramki) i `chat_direct_gated`
  // (2 bramki) zwijają się do jednego wiersza każda. Dwie bramki bez
  // odniesienia do tenanta wołającego nigdy nie trafiają do liczby, którą
  // ktokolwiek przegląda.
  //
  // DLACZEGO NAPRAWA TO OSOBNA PRACA. Najpierw trzeba ROZSTRZYGNĄĆ, co ten kafel
  // ma mierzyć (bramki czy pozycje do przeglądu; tylko rolowe czy wszystkie),
  // potem zmienić pole razem z etykietą PL i EN oraz z opisem źródła na stronie,
  // a `summary` czyta trasa panelu. To zmiana kontraktu prezentacji, nie
  // poprawka jednego wyrażenia - i nie wolno jej robić w pracy testowej.
  const DWIE_BRAMKI = snapshotOf({
    featureGates: [
      featureGate({ ref: "fn:g0/0", object: "g0", tenantRef: "none" }),
      featureGate({ ref: "fn:g1/0", object: "g1", tenantRef: "row" }),
    ],
  });

  it.fails("DEFEKT: licznik pomija bramki zwinięte w jeden wiersz flagi", () => {
    // Dwie bramki jednej flagi, ŻADNA nie woła `current_tenant_id()`.
    expect(matrixOf({}, DWIE_BRAMKI).summary.gatesWithoutCallerTenant).toBe(2);
  });

  it("KONTROLA DODATNIA: dwie takie bramki liczą się dziś jako jedna pozycja", () => {
    const matrix = matrixOf({}, DWIE_BRAMKI);
    const gate = rowOf(matrix, "cap_premium_content").gate;
    expect(gate?.refs).toHaveLength(2);
    expect(gate?.tenantRef).toBe("none");
    expect(matrix.summary.gatesWithoutCallerTenant).toBe(1);
  });

  it("KONTROLA DODATNIA: wiersz, którego wszystkie bramki wołają current_tenant_id(), nie liczy się wcale", () => {
    const matrix = matrixOf(
      {},
      snapshotOf({
        featureGates: [
          featureGate({ ref: "fn:g0/0", object: "g0", tenantRef: "caller" }),
          featureGate({ ref: "fn:g1/0", object: "g1", tenantRef: "caller" }),
        ],
      }),
    );
    expect(matrix.summary.gatesWithoutCallerTenant).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ŚCIEŻKI, KTÓRYCH TEN PLIK ŚWIADOMIE NIE PODPIERA ATRAPĄ
// ---------------------------------------------------------------------------
//
// Po dopisaniu powyższych przypadków v8 raportuje dla `permissionMatrix.ts`
// 100% instrukcji, gałęzi, funkcji i linii - żadne ramię NIE zostało pominięte.
// Poniżej dwie ścieżki, których v8 nie liczy jako osobnych gałęzi i których
// mimo to nie da się (albo nie warto) dowodzić wprost - opisane, żeby nikt nie
// szukał ich w tabelach:
//
// 1. permissionMatrix.ts:279 i :311 - `tier?.features` w
//    `featureFlag(tier?.features ?? null, …)` / `featureNumber(byKey.get(…)?.features ?? null, …)`.
//    Ramię „tier === undefined” jest NIEOSIĄGALNE: `byKey` powstaje z tej samej
//    tablicy `options.tiers`, z której zbudowano kolumny warstw, więc dla każdej
//    kolumny warstwy klucz w mapie ISTNIEJE. Optional chaining jest tu obroną
//    przed przyszłą zmianą (np. kolumnami z innego źródła), nie ścieżką danych.
//    Nie podpieramy go atrapą - ramię `?? null` jest natomiast pokryte uczciwie,
//    wejściem `features: null` / `features: undefined` z tabel powyżej.
//
// 2. permissionMatrix.ts:181 - KOLEJNOŚĆ posortowanej sumy ról w trybie
//    mieszanym nie jest obserwowalna: `buildRoleRow` (:230) natychmiast pakuje
//    wynik w `Set` i pyta go wyłącznie o przynależność. Dowodzimy więc skutku
//    (dedup i niezależność od kolejności wejścia), a nie samej tablicy; asercja
//    wprost wymagałaby eksportu `effectiveRoles`, czyli zmiany produkcji.
