/**
 * Bramka izolacji tenantow dla plaszczyzny wlasciciela: media_mentions,
 * saved_searches, user_follows.
 *
 * PRZYCZYNA ZRODLOWA (audyt bezpieczenstwa 2026-08-29): polityki wlascicielskie
 * tych trzech tabel bramkowaly wylacznie `user_id = auth.uid()`. Kolumna
 * `tenant_id` istnieje i jest NOT NULL, wiec przy dryfie danych (wiersz zalozony
 * w tenancie A, profil przepiety do B) ten sam wiersz byl czytelny i edytowalny
 * poza swoim obszarem roboczym, a `WITH CHECK` pozwalal ZAPISAC wiersz do cudzego
 * tenanta. Domkniete migracja 20260829091010.
 *
 * INWARIANT: dla kazdej z tych tabel KAZDA polityka wlascicielska (kazda klauzula
 * USING i WITH CHECK, kazda galaz OR) wiaze wiersz i z uzytkownikiem, i z tenantem.
 * Test czyta STAN KONCOWY polityk z forward-only migracji - nie pojedynczy plik.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isOwnerScoped, unscopedClauses } from "../ownerTenantScope";
import { extractLatestPolicies, type PolicyDef } from "../rlsPolicies";
import { stripSqlComments } from "../../../../scripts/lib/sqlMigrations";

const MIGRATIONS_DIR = resolve(process.cwd(), "supabase/migrations");

/** Tabele objete bramka - plaszczyzna konta uzytkownika z kolumna tenant_id. */
const TENANT_SCOPED_TABLES = ["media_mentions", "saved_searches", "user_follows"] as const;

function latestPolicies(): PolicyDef[] {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => ({
      file,
      sql: stripSqlComments(readFileSync(join(MIGRATIONS_DIR, file), "utf8")),
    }));
  return [...extractLatestPolicies(files).values()];
}

const POLICIES = latestPolicies();

describe("izolacja tenantow na plaszczyznie wlasciciela", () => {
  for (const table of TENANT_SCOPED_TABLES) {
    describe(table, () => {
      const tablePolicies = POLICIES.filter((policy) => policy.table === table);

      it("ma polityki wlascicielskie w stanie koncowym", () => {
        expect(tablePolicies.filter(isOwnerScoped).length).toBeGreaterThan(0);
      });

      it("kazda klauzula wlascicielska wiaze tenanta", () => {
        const gaps = tablePolicies
          .filter(isOwnerScoped)
          .map((policy) => ({ name: policy.name, clauses: unscopedClauses(policy) }))
          .filter((entry) => entry.clauses.length > 0);
        expect(gaps).toEqual([]);
      });

      it("zapis wlasciciela nie moze trafic do cudzego tenanta", () => {
        const writable = tablePolicies.filter(
          (policy) =>
            isOwnerScoped(policy) &&
            (policy.command === "all" ||
              policy.command === "insert" ||
              policy.command === "update"),
        );
        expect(writable.length).toBeGreaterThan(0);
        for (const policy of writable) {
          expect(policy.withCheck, `${table}::${policy.name} bez WITH CHECK`).not.toBeNull();
          expect(policy.withCheck ?? "").toMatch(/current_tenant_id\(\)/);
        }
      });

      it("odczyt wlasciciela wiaze tenanta", () => {
        const readable = tablePolicies.filter(
          (policy) =>
            isOwnerScoped(policy) && (policy.command === "all" || policy.command === "select"),
        );
        expect(readable.length).toBeGreaterThan(0);
        for (const policy of readable) {
          expect(policy.using ?? "", `${table}::${policy.name} USING`).toMatch(
            /current_tenant_id\(\)/,
          );
        }
      });
    });
  }
});
