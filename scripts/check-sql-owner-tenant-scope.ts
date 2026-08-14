/**
 * Gate inwariantu: polityka RLS „wlasciciel wiersza" nie moze zgubic tenanta,
 * jesli rodzenstwo na tej samej tabeli go pilnuje.
 *
 * PRZYCZYNA ZRODLOWA (audyt 2026-08-03): na public.author_profiles polityki
 * INSERT i UPDATE dostaly `tenant_id = current_tenant_id()` (migracja
 * 20260721105920), ale SELECT i DELETE zostaly przy golym `auth.uid() = user_id`
 * z migracji zalozycielskiej. Powstala asymetria: ten sam wiersz byl ZAPISYWALNY
 * wylacznie w tenancie domowym, a ODCZYTYWALNY i KASOWALNY w dowolnym kontekscie
 * tenanta. Przy dryfie danych (wiersz w tenancie A, profil przepiety do B)
 * omija to granice obszaru roboczego firmy. Zamkniete migracja 20260803130000.
 *
 * INWARIANT: jesli NA DANEJ TABELI choc jedna klauzula wlascicielska wiaze
 * wiersz z tenantem, to KAZDA klauzula wlascicielska na tej tabeli musi go
 * wiazac. Bramka jest samokalibrujaca - nie ma recznej listy tabel: intencje
 * deklaruje sam schemat, wiec tabele bez tenant_id nigdy jej nie zapalaja,
 * a tabela, ktora raz zadeklarowala skalowanie po tenancie, nie moze go po cichu
 * zgubic. Analiza schodzi do pojedynczej galezi OR w pojedynczej klauzuli
 * (USING / WITH CHECK), bo tylko tam mieszka dziura.
 *
 * RATCHET: `KNOWN_OPEN_GAPS` to dlug zastany w chwili wprowadzenia bramki -
 * raportowany GLOSNO przy kazdym przebiegu, ale nieblokujacy. Kazda NOWA luka
 * wywala CI od razu, a luka zamknieta wywala CI dopoki jej wpis nie zniknie z
 * listy. Lista moze wiec tylko malec.
 *
 * Analizuje STAN KONCOWY polityk (CREATE/DROP POLICY liczone po kolei - migracje
 * sa forward-only, a wzorzec „DROP IF EXISTS + CREATE" w jednym pliku wymaga
 * kolejnosci instrukcji, nie samego faktu wystapienia CREATE).
 *
 * Usage: bun run scripts/check-sql-owner-tenant-scope.ts
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  analyzeOwnerTenantScope,
  ownerScopeFailed,
  type OwnerScopeAnnotations,
  type OwnerScopeGap,
} from "../src/lib/ci/ownerTenantScope";
import { extractLatestPolicies } from "../src/lib/ci/rlsPolicies";
import { MIGRATIONS_DIR, stripSqlComments } from "./lib/sqlMigrations";

/**
 * Luki POZORNE: wiersz z definicji nie przekracza granicy tenanta, wiec dopisanie
 * `tenant_id = current_tenant_id()` byloby tautologia (koszt planu bez zysku).
 */
const JUSTIFIED: OwnerScopeAnnotations = {
  "profiles::profiles authenticated read":
    "current_tenant_id() JEST tenantem tego wiersza (SELECT tenant_id FROM profiles WHERE id = auth.uid()), wiec dla id = auth.uid() warunek jest tautologia",
  "profiles::users update own profile":
    "jw. - wlasny wiersz profilu definiuje tenant domowy; przepiecie tenanta blokuje trigger profiles_pin_tenant i tenantowy WITH CHECK",
};

/**
 * Dlug zastany (bramka wprowadzona 2026-08-03). Wpis MUSI mowic, jaki predykat
 * jest poprawny dla tej plaszczyzny danych - inaczej nie da sie go zamknac.
 * Lista moze tylko malec: zamknieta luka bez usunietego wpisu wywala bramke.
 *
 * STAN: PUSTA. Ostatnie 12 pozycji domknieto migracja
 * 20260814221343 (billing_profiles, eu_policy_follows, message_stars,
 * notification_preferences, payment_orders, qa_question_votes, qa_questions) -
 * plaszczyzna konta dostala `tenant_id = current_tenant_id()` / tenant domowy
 * z profilu, plaszczyzna tresci wiazanie tenanta wiersza z tenantem RODZICA
 * (dossier, pytanie, sesja Q&A) w tym samym EXISTS co odpowiadajacy WITH CHECK.
 */
const KNOWN_OPEN_GAPS: OwnerScopeAnnotations = {};

function renderGap(gap: OwnerScopeGap, note?: string): string[] {
  const lines = [
    `  • ${gap.table} :: "${gap.name}"  [FOR ${gap.command.toUpperCase()}] ` +
      `bez tenanta w: ${gap.clauses.join(" + ")}`,
    `      plik: ${gap.file}`,
    `      tenanta pilnuja juz: ${gap.witnesses.map((w) => `"${w}"`).join(", ")}`,
  ];
  if (note !== undefined) lines.push(`      powod odlozenia: ${note}`);
  return lines;
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
  const report = analyzeOwnerTenantScope(policies.values(), {
    justified: JUSTIFIED,
    knownGaps: KNOWN_OPEN_GAPS,
  });

  if (report.gaps.length > 0) {
    console.error(
      `\n✗ NOWA polityka wlasciciela bez tenanta (${report.gaps.length}) - ` +
        "rodzenstwo na tej samej tabeli tenanta pilnuje:\n",
    );
    for (const gap of report.gaps) for (const line of renderGap(gap)) console.error(line);
    console.error(
      "\n  Naprawa: dopisz `tenant_id = current_tenant_id()` do tej klauzuli (wolanie" +
        "\n  owin w `(select …)` - InitPlan liczy je raz na zapytanie, nie raz na wiersz)." +
        "\n  Plaszczyzna tresci -> zwiaz tenanta wiersza z tenantem RODZICA." +
        "\n  Luka pozorna -> JUSTIFIED z uzasadnieniem.",
    );
  }

  if (report.staleAnnotations.length > 0) {
    console.error(
      `\n✗ Nieaktualne wpisy JUSTIFIED / KNOWN_OPEN_GAPS (${report.staleAnnotations.length}) - ` +
        "luka zamknieta albo polityka usunieta, wpis do skasowania:\n",
    );
    for (const key of report.staleAnnotations) console.error(`  • ${key}`);
  }

  if (report.knownGaps.length > 0) {
    console.warn(`\n⚠ Znany dlug tenant-scope (${report.knownGaps.length}) - do domkniecia:\n`);
    for (const gap of report.knownGaps) {
      for (const line of renderGap(gap, KNOWN_OPEN_GAPS[gap.key])) console.warn(line);
    }
  }

  if (ownerScopeFailed(report)) process.exit(1);

  console.log(
    `✓ Inwariant owner-tenant-scope OK (${report.ownerPolicies} polityk wlasciciela ` +
      `z ${report.analyzed} w stanie koncowym; ${report.justifiedHits.length} luk pozornych, ` +
      `${report.knownGaps.length} pozycji znanego dlugu).`,
  );
}

main();
