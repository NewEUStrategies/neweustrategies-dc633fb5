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
 */
const KNOWN_OPEN_GAPS: OwnerScopeAnnotations = {
  "billing_profiles::billing owner delete":
    "plaszczyzna konta - poprawny predykat: user_id = auth.uid() AND tenant_id = current_tenant_id() (jak w 'billing owner update')",
  "billing_profiles::billing owner read":
    "jw. - galaz wlasciciela w OR czyta profil rozliczeniowy z dowolnego tenanta",
  "eu_policy_follows::policy follows owner all":
    "plaszczyzna TRESCI - tenantem obserwacji jest tenant dossier; WITH CHECK wiaze ja z i.tenant_id, USING nie wiaze nic (poprawne wiazanie: to samo EXISTS po stronie USING)",
  "message_stars::message_stars_own_delete":
    "plaszczyzna konta - poprawny predykat: user_id = (select auth.uid()) AND tenant_id = (select current_tenant_id()) (jak w 'message_stars_own_select')",
  "notification_preferences::own prefs delete":
    "plaszczyzna konta - poprawny predykat: user_id = auth.uid() AND tenant_id = current_tenant_id() (jak w 'own prefs insert')",
  "notification_preferences::own prefs select":
    "jw. - preferencje sa przypiete do tenanta domowego triggerem, polityka tego nie odwzorowuje",
  "notification_preferences::own prefs update":
    "jw. - USING bez tenanta pozwala ruszyc wiersz obcego tenanta, WITH CHECK wymusza tylko przepisanie go do siebie",
  "payment_orders::orders owner read":
    "plaszczyzna konta - poprawny predykat: user_id = auth.uid() AND tenant_id = current_tenant_id() (jak w 'orders owner insert')",
  "qa_question_votes::qa votes own delete":
    "plaszczyzna TRESCI - tenantem wiersza jest tenant pytania (uzytkownik tenanta A glosuje na publicznej stronie tenanta publicznego), wiec current_tenant_id() jest tu ZLYM predykatem; poprawne wiazanie: tenant glosu = tenant pytania, jak w 'qa votes own insert'",
  "qa_question_votes::qa votes own read": "jw. - wiazanie przez tenanta pytania, nie tenant domowy",
  "qa_questions::qa questions host read":
    "plaszczyzna TRESCI - host czyta pytania SWOJEJ sesji; poprawne wiazanie: tenant pytania = tenant sesji w EXISTS, nie current_tenant_id()",
  "qa_questions::qa questions moderate":
    "jw. - galaz stafowa wiaze tenanta, galaz hosta (EXISTS po qa_sessions.host_user_id) nie wiaze nic; poprawne wiazanie: q.tenant_id = s.tenant_id w tym samym EXISTS",
};

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
