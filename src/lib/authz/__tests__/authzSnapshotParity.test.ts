// BRAMKA PARYTETU macierzy uprawnień - sedno naprawy audytowej.
//
// /admin/permissions była stroną referencyjną wpisaną z ręki: nie wynikała z kodu
// ani z bazy, więc rozjeżdżała się z rzeczywistością BEZ ŻADNEGO SYGNAŁU. Ten test
// jest tym sygnałem. Odtwarza snapshot bramek wprost z supabase/migrations i
// porównuje go z zacommitowanym artefaktem oraz z rejestrem capabilities.
//
// Co obleje CI (i dlaczego to dobrze):
//   1. dopisanie/odjęcie roli w bramce, której macierz dotyczy,
//   2. zniknięcie bramki, na którą wskazuje wiersz macierzy (referencja wisząca),
//   3. nowa wartość enuma app_role bez kolumny w macierzy,
//   4. flaga `features` czytana przez bramkę, a nieopisana w rejestrze capabilities,
//   5. flaga oznaczona jako egzekwowana, której żadna bramka już nie czyta.
import { describe, expect, it } from "vitest";
import {
  collectAuthzSnapshotDrift,
  deriveAuthzSnapshot,
  formatAuthzDriftReport,
  renderAuthzSnapshotModule,
  selectAuthzSnapshot,
} from "@/lib/ci/authzGates";
import { AUTHZ_SNAPSHOT } from "@/lib/authz/authzSnapshot.generated";
import { APP_ROLES } from "@/lib/authz/roles";
import { DOCUMENTED_ROLE_GATE_REFS, ROLE_PERMISSION_ROWS } from "@/lib/authz/permissionRows";
import { NUMERIC_FEATURE_KEYS, TIER_CAPABILITIES } from "@/lib/billing/capabilities";
import { readAuthzSource } from "../../../../scripts/lib/authzSource";

/** Jedno odtworzenie ze SQL-a dla wszystkich przypadków (skan 500+ migracji). */
const derived = deriveAuthzSnapshot(readAuthzSource());
const selected = selectAuthzSnapshot(derived, { roleGateRefs: DOCUMENTED_ROLE_GATE_REFS });

describe("snapshot bramek autoryzacji vs migracje", () => {
  it("skan migracji w ogóle coś znalazł (bez tego reszta testów byłaby pusta)", () => {
    expect(derived.stats.migrations).toBeGreaterThan(100);
    expect(derived.stats.functions).toBeGreaterThan(100);
    expect(derived.stats.policies).toBeGreaterThan(100);
    expect(derived.roleGates.length).toBeGreaterThan(50);
  });

  // Komunikat jest raportem z podziałem na wagę: zawężenie uprawnień nie może
  // schować się między wpisami o przeniesionej definicji, a każdy wpis wymienia
  // DOKŁADNIE te pola, które się różnią (wcześniej komunikat potrafił pokazać dwa
  // identyczne obiekty i twierdzić, że się rozjechały - patrz authzGates.ts).
  it("zacommitowany snapshot zgadza się z odtworzeniem z migracji", () => {
    const drift = collectAuthzSnapshotDrift(AUTHZ_SNAPSHOT, selected);
    expect(
      drift.map((entry) => `[${entry.severity}] ${entry.message}`),
      formatAuthzDriftReport(drift),
    ).toEqual([]);
  });

  it("wygenerowany moduł jest deterministyczny (ten sam wejściowy SQL = ten sam plik)", () => {
    expect(renderAuthzSnapshotModule(selected)).toBe(renderAuthzSnapshotModule(selected));
  });

  it("każdy wiersz macierzy wskazuje bramkę, która nadal istnieje", () => {
    expect(
      selected.danglingRefs,
      "wiersze macierzy wskazują nieistniejące bramki - popraw gateRef w permissionRows.ts",
    ).toEqual([]);
  });

  it("APP_ROLES pokrywa się z enumem public.app_role z migracji", () => {
    expect([...APP_ROLES].sort()).toEqual([...derived.appRoles].sort());
    expect([...AUTHZ_SNAPSHOT.appRoles].sort()).toEqual([...derived.appRoles].sort());
  });

  it("role zawężone (`scoped`) faktycznie przechodzą swoją bramkę", () => {
    const byRef = new Map(selected.roleGates.map((gate) => [gate.ref, gate]));
    const broken: string[] = [];
    for (const row of ROLE_PERMISSION_ROWS) {
      const gate = byRef.get(row.gateRef);
      if (gate === undefined) continue;
      const passing = new Set([...gate.anyRoles, ...gate.allRoles]);
      for (const role of row.scoped ?? []) {
        if (!passing.has(role)) broken.push(`${row.id}: '${role}' nie przechodzi ${row.gateRef}`);
      }
    }
    expect(broken, "zawężenie zakresu dotyczy roli, której bramka już nie przepuszcza").toEqual([]);
  });

  it("każda bramka dokumentowana przez macierz wymienia jakąś rolę", () => {
    const mute = selected.roleGates.filter(
      (gate) => gate.anyRoles.length === 0 && gate.allRoles.length === 0,
    );
    expect(
      mute.map((gate) => gate.ref),
      "bramka nie wymienia żadnej roli - wiersz macierzy nic nie dokumentuje",
    ).toEqual([]);
  });
});

describe("rejestr capabilities vs realne bramki flag warstw", () => {
  const gatedKeys = new Set(derived.featureGates.map((gate) => gate.capability));
  const registry = new Map(TIER_CAPABILITIES.map((meta) => [meta.key, meta]));

  it("bramki flag w ogóle się znalazły", () => {
    expect(gatedKeys.size).toBeGreaterThanOrEqual(8);
  });

  it("każda flaga czytana przez bramkę jest opisana (rejestr albo lista liczbowa)", () => {
    const known = new Set([...registry.keys(), ...NUMERIC_FEATURE_KEYS]);
    const unregistered = [...gatedKeys].filter((key) => !known.has(key)).sort();
    expect(
      unregistered,
      "flaga jest egzekwowana przez SQL, ale nie ma jej w TIER_CAPABILITIES ani w NUMERIC_FEATURE_KEYS - macierz by o niej milczała",
    ).toEqual([]);
  });

  it("`enforced: true` ma pokrycie w realnej bramce", () => {
    const claimedButUngated = TIER_CAPABILITIES.filter(
      (meta) => meta.enforced && !gatedKeys.has(meta.key),
    ).map((meta) => meta.key);
    expect(
      claimedButUngated,
      "rejestr twierdzi, że flaga jest egzekwowana, a żadna bramka jej nie czyta",
    ).toEqual([]);
  });

  it("`enforced: false` nie ukrywa istniejącej bramki", () => {
    const gatedButClaimedDecorative = TIER_CAPABILITIES.filter(
      (meta) => !meta.enforced && gatedKeys.has(meta.key),
    ).map((meta) => meta.key);
    expect(
      gatedButClaimedDecorative,
      "bramka istnieje, a rejestr pokazuje flagę jako dekoracyjną - przestaw `enforced` na true",
    ).toEqual([]);
  });

  it("flagi liczbowe nie dublują się z rejestrem boolowskim", () => {
    const duplicated = NUMERIC_FEATURE_KEYS.filter((key) => registry.has(key));
    expect(duplicated).toEqual([]);
  });
});
