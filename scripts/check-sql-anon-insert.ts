/**
 * Gate inwariantu: ZADNA tabela nie przyjmuje permisywnego anonimowego INSERT-u,
 * a tabele intake (telemetria / zgloszenia) nie przyjmuja BEZPOSREDNIEGO INSERT-u
 * od klienta w ogole (zapis idzie przez funkcje serwerowa / RPC SECURITY DEFINER).
 *
 * PRZYCZYNA ZRODLOWA (audyt bezpieczenstwa 2026-07-30): przez ~30 dni cztery
 * tabele przyjmowaly INSERT wprost przez PostgREST, bo polityka wpuszczajaca
 * anon/authenticated przetrwala churn migracji (guard is_experiment_running()
 * zgubiony w 20260702114108->20260703052115). Skutki: spam do skrzynki admina
 * (contact_messages), FABRYKACJA ZGOD RODO na dowolny e-mail (crm_consent_log),
 * falszowanie statystyk (related_post_clicks) i wynikow A/B
 * (builder_experiment_events). Zamkniete recznie migracjami 20260730130000 /
 * 20260730140000 - ale to JEDNA klasa bledu, ktora wroci bez bramki.
 *
 * INWARIANTY (stan koncowy polityk - migracje forward-only, CREATE/DROP POLICY
 * liczone po kolei; parser: src/lib/ci/rlsPolicies.ts):
 *   A. HARD, wszystkie tabele: zadna polityka INSERT-capable (FOR INSERT/FOR ALL)
 *      z rola `anon`/`public` nie moze miec PERMISYWNEGO checku INSERT-u (WITH
 *      CHECK sprowadzajacy sie do `true`, albo jego brak). Polityki z realnym
 *      warunkiem (np. `auth.role() = 'service_role'`, `has_role(...)`) i polityki
 *      DENY (`false`) sa poprawne - anon ich nie spelni.
 *   B. Tabele PROTECTED_INTAKE: zadna polityka INSERT-capable z rola klienta
 *      (anon/public/authenticated), ktora nie jest czystym DENY. Te tabele
 *      przyjmuja zapis WYLACZNIE przez service_role (omija RLS, nie potrzebuje
 *      polityki) - kazda inna sciezka to wektor fabrykacji danych.
 *
 * Zakres: bramka patrzy na POLITYKI (zaklada RLS wlaczony wszedzie - audyt
 * 198/198). Nie modeluje GRANT-ow: permisywna polityka bez GRANT-u nie jest
 * eksploatowalna, ale i tak jest smellem, wiec ja raportujemy.
 *
 * Usage: bun run scripts/check-sql-anon-insert.ts
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  extractLatestPolicies,
  insertCheckKind,
  isInsertCapable,
  type PolicyDef,
} from "../src/lib/ci/rlsPolicies";
import { MIGRATIONS_DIR, stripSqlComments } from "./lib/sqlMigrations";

/** Legalne permisywne polityki anon-insert (klucz `tabela::nazwa` -> uzasadnienie). */
const ANON_INSERT_ALLOWLIST: Readonly<Record<string, string>> = {};

/**
 * Tabele intake: zapis WYLACZNIE przez funkcje uprzywilejowana (service_role
 * albo SECURITY DEFINER - obie omijaja RLS, wiec zadna nie potrzebuje polityki
 * INSERT dla roli klienckiej).
 */
const PROTECTED_INTAKE_TABLES: ReadonlySet<string> = new Set([
  "contact_messages",
  "crm_consent_log",
  "related_post_clicks",
  "builder_experiment_events",
  "analytics_events",
  "web_vitals",
  // Rejestr zgod RODO: stan i dziennik dowodu pisze wylacznie
  // SECURITY DEFINER set_user_consent (sama ustala user_id/tenant_id/czas).
  "user_consents",
  "user_consent_events",
]);

function render(policy: PolicyDef): string {
  return (
    `  • ${policy.table} :: "${policy.name}"  (${policy.file}), ` +
    `role: ${[...policy.roles].join(", ")}`
  );
}

function main(): void {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => ({
      file,
      sql: stripSqlComments(readFileSync(join(MIGRATIONS_DIR, file), "utf8")),
    }));

  const policies = extractLatestPolicies(files);

  const anonViolations: PolicyDef[] = [];
  const intakeViolations: PolicyDef[] = [];
  const allowlistHit = new Set<string>();

  for (const policy of policies.values()) {
    if (!isInsertCapable(policy)) continue;
    const hasAnon = policy.roles.has("anon") || policy.roles.has("public");
    const hasClient = hasAnon || policy.roles.has("authenticated");
    const check = insertCheckKind(policy);

    // A: permisywny anon-insert (rola anon/public + check == true/brak).
    if (hasAnon && check === "permissive") {
      if (ANON_INSERT_ALLOWLIST[policy.key] !== undefined) allowlistHit.add(policy.key);
      else anonViolations.push(policy);
    }

    // B: tabela intake z jakakolwiek nie-DENY polityka INSERT dla roli klienta.
    if (PROTECTED_INTAKE_TABLES.has(policy.table) && hasClient && check !== "deny") {
      intakeViolations.push(policy);
    }
  }

  let failed = false;

  if (anonViolations.length > 0) {
    failed = true;
    console.error(`\n✗ Permisywny anonimowy INSERT w ${anonViolations.length} polityce/ach:\n`);
    for (const v of anonViolations.sort((a, b) => a.table.localeCompare(b.table))) {
      console.error(render(v));
    }
    console.error(
      "\n  Naprawa: zapis anonimowy prowadz przez funkcje serwerowa / RPC SECURITY" +
        "\n  DEFINER (jak newsletter/kontakt), albo dodaj realny WITH CHECK. Uzasadniony" +
        "\n  wyjatek -> ANON_INSERT_ALLOWLIST.",
    );
  }

  if (intakeViolations.length > 0) {
    failed = true;
    console.error(
      `\n✗ Tabela intake przyjmuje INSERT klienta w ${intakeViolations.length} polityce/ach:\n`,
    );
    for (const v of intakeViolations.sort((a, b) => a.table.localeCompare(b.table))) {
      console.error(render(v));
    }
    console.error(
      "\n  Te tabele przyjmuja zapis WYLACZNIE przez service_role. Usun polityke" +
        "\n  INSERT dla anon/authenticated (albo ustaw ja na DENY).",
    );
  }

  const staleAllowlist = Object.keys(ANON_INSERT_ALLOWLIST).filter((k) => !allowlistHit.has(k));
  if (staleAllowlist.length > 0) {
    console.warn(`\n⚠ Nieaktualne wpisy ANON_INSERT_ALLOWLIST: ${staleAllowlist.join(", ")}`);
  }

  if (failed) process.exit(1);

  console.log(
    `✓ Inwariant anon-insert OK (${policies.size} polityk w stanie koncowym, ` +
      `${PROTECTED_INTAKE_TABLES.size} tabel intake chronionych).`,
  );
}

main();
