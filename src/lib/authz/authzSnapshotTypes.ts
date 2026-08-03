// Kontrakt artefaktu `authzSnapshot.generated.ts` - wyłącznie typy, zero runtime.
//
// Generator (scripts/generate-authz-snapshot.ts + src/lib/ci/authzGates.ts) i
// konsument (macierz uprawnień w /admin/permissions) patrzą na TEN sam plik z
// typami, więc kształt snapshotu nie może rozjechać się między nimi. Parser SQL
// żyje w warstwie CI i NIE trafia do bundla klienta - trasa admina importuje
// tylko dane i te typy.

/** Wartość enuma `public.app_role` (walidowana przez test parytetu). */
export type AppRoleName = string;

export type AuthzGateKind = "function" | "policy";

/**
 * Jak bramka odnosi się do tenanta - kluczowe dla izolacji obszarów roboczych:
 *  - `caller` - woła `current_tenant_id()`, więc wiąże dane z tenantem wołającego,
 *  - `row`    - porównuje kolumny `tenant_id` (spójność wiersz-wiersz), bez
 *               odwołania do tenanta domowego wołającego,
 *  - `none`   - nie odwołuje się do tenanta wcale (do przeglądu przy audycie).
 */
export type TenantRef = "caller" | "row" | "none";

/** Bramka rolowa odtworzona ze SQL-a: kto (jaka rola) ją przechodzi. */
export interface RoleGateEntry {
  /** Stabilna referencja: `fn:nazwa/arność` albo `policy:tabela/nazwa`. */
  readonly ref: string;
  readonly kind: AuthzGateKind;
  /** Nazwa funkcji (bez schematu) albo tabeli, na której wisi polityka. */
  readonly object: string;
  /** Migracja z ostatnią (żywą) definicją. */
  readonly file: string;
  /** Role, dla których wystarcza jedna gałąź OR. Posortowane. */
  readonly anyRoles: readonly AppRoleName[];
  /** Role wymagane bezwarunkowo (aliasy `assert_*`). Posortowane. */
  readonly allRoles: readonly AppRoleName[];
  /** Sposób odniesienia do tenanta (izolacja obszarów roboczych). */
  readonly tenantRef: TenantRef;
  /** Czy funkcja omija RLS (SECURITY DEFINER). Polityki: zawsze false. */
  readonly securityDefiner: boolean;
  /** Flagi `membership_tiers.features` czytane przez tę samą bramkę. */
  readonly featureKeys: readonly string[];
}

/** Bramka flagi warstwy: gdzie flaga `features` jest realnie czytana. */
export interface FeatureGateEntry {
  /** Klucz w `membership_tiers.features`. */
  readonly capability: string;
  readonly ref: string;
  readonly kind: AuthzGateKind;
  readonly object: string;
  readonly file: string;
  /** Role, które w tym samym ciele omijają bramkę warstwy (bypass stafowy). */
  readonly bypassRoles: readonly AppRoleName[];
  readonly tenantRef: TenantRef;
}

export interface AuthzSnapshotStats {
  readonly migrations: number;
  readonly functions: number;
  readonly policies: number;
}

/** Kształt eksportu `AUTHZ_SNAPSHOT` w pliku generowanym. */
export interface AuthzSnapshotModule {
  readonly appRoles: readonly AppRoleName[];
  readonly roleGates: readonly RoleGateEntry[];
  readonly featureGates: readonly FeatureGateEntry[];
  readonly stats: AuthzSnapshotStats;
}
