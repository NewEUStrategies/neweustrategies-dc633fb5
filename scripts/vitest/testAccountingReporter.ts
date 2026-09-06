// BRAMKA RACHUNKU TESTÓW: ZEBRANE = ZARAPORTOWANE.
//
// PO CO. 2026-08-27, przebieg CI 33059185577: suita zamknęła się bez ANI
// JEDNEJ porażki, a mimo to 927 testów nigdy się nie wykonało. Log mówił
// tylko tyle:
//
//   Test Files  1672 passed | 2 skipped (1675)     <- 1672+2 = 1674 z 1675
//        Tests  42786 passed | 183 expected fail | 50 skipped (43946)
//   Error: [vitest-pool]: Worker forks emitted error / Worker exited unexpectedly
//
// Jeden plik testowy (`editorMatrix.test.tsx`, 1 486 przypadków) stracił
// swój fork - jądro ubiło go SIGKILL-em, bo trzy forki po ~7 GB nie mieszczą
// się w 16 GB runnera. Pokrycie V8 pliku jest odsyłane DOPIERO po jego
// zakończeniu, więc przepadło w całości i bramka
// `src/components/admin/builder/**` spadła z 96,50/93,23/95,03/97,34
// na 87,82/84,02/75,74/88,74. Suita raportowała ZIELONO.
//
// To jest najgorsza klasa awarii, jaką ma bramka pokrycia: pomiar przestaje
// być prawdziwy, a log milczy. Rachunek „zebrane = zaraportowane" nazywa ją
// wprost i wskazuje PLIK, więc nie da się jej wziąć za „flake".
//
// Uwaga na czytanie liczb: `pending` to przypadek, który został ZEBRANY, ale
// nie dostał wyniku. Test pominięty ma stan `skipped` i jest w porządku;
// przerwanie przebiegu (Ctrl+C, `--bail`) daje `reason === "interrupted"`
// i wtedy bramka milczy, bo brak wyniku jest wówczas oczekiwany.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface ReportedTest {
  result: () => { state: string };
  options?: { fails?: boolean };
}

interface ReportedModule {
  moduleId: string;
  state: () => string;
  children: { allTests: () => Iterable<ReportedTest> };
}

export default class TestAccountingReporter {
  private coverageDirectory?: string;

  onInit(context: { config: { coverage: { enabled: boolean; reportsDirectory: string } } }): void {
    if (context.config.coverage.enabled)
      this.coverageDirectory = context.config.coverage.reportsDirectory;
  }
  onTestRunEnd(
    testModules: ReadonlyArray<ReportedModule>,
    _unhandledErrors: ReadonlyArray<unknown>,
    reason?: string,
  ): void {
    if (reason === "interrupted") return;

    let collected = 0;
    let reported = 0;
    const offenders: string[] = [];
    const moduleOutcomes = { passed: 0, failed: 0, skipped: 0, pending: 0 };
    const outcomes = { passed: 0, expectedFailed: 0, failed: 0, skipped: 0, pending: 0 };

    for (const mod of testModules) {
      const moduleState = mod.state();
      if (moduleState in moduleOutcomes)
        moduleOutcomes[moduleState as keyof typeof moduleOutcomes] += 1;
      else moduleOutcomes.pending += 1;
      let total = 0;
      let pending = 0;
      for (const test of mod.children.allTests()) {
        total += 1;
        const state = test.result().state;
        if (!["passed", "failed", "skipped"].includes(state)) {
          pending += 1;
          outcomes.pending += 1;
        } else if (state === "passed") {
          if (test.options?.fails) outcomes.expectedFailed += 1;
          else outcomes.passed += 1;
        } else if (state === "failed") outcomes.failed += 1;
        else if (state === "skipped") outcomes.skipped += 1;
      }
      collected += total;
      reported += total - pending;
      if (pending > 0) {
        offenders.push(`  ${mod.moduleId}: ${pending} z ${total} przypadków BEZ WYNIKU`);
      } else if (total === 0 && moduleState !== "passed" && moduleState !== "skipped") {
        offenders.push(`  ${mod.moduleId}: moduł nie zwrócił ŻADNEGO wyniku`);
      }
    }

    mkdirSync("reports", { recursive: true });
    const report =
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          commit: process.env.GITHUB_SHA ?? null,
          node: process.version,
          timezone: process.env.TZ ?? null,
          modules: testModules.length,
          collected,
          reported,
          outcomes,
          moduleOutcomes,
          unhandledErrors: _unhandledErrors.length,
          complete: !offenders.length && collected === reported && !_unhandledErrors.length,
          offenders,
        },
        null,
        2,
      ) + "\n";
    writeFileSync("reports/test-accounting.json", report);
    if (this.coverageDirectory) {
      mkdirSync(this.coverageDirectory, { recursive: true });
      writeFileSync(join(this.coverageDirectory, "test-accounting.json"), report);
    }

    if (!offenders.length && collected === reported && !_unhandledErrors.length) return;

    const missing = collected - reported;
    const lines = [
      "",
      "⎯⎯⎯⎯⎯⎯ RACHUNEK TESTÓW SIĘ NIE DOMYKA ⎯⎯⎯⎯⎯⎯",
      `Zebrano ${collected} przypadków, wynik zwróciło ${reported}. Brakuje ${missing}.`,
      `Nieobsłużone błędy procesu: ${_unhandledErrors.length}.`,
      "Pliki, których to dotyczy:",
      ...offenders,
      "",
      "Możliwa przyczyna: błąd importu pliku albo utrata procesu testowego.",
      "To nie jest kompletny pomiar wykonania testów. Pokrycie V8 takiego",
      "pliku nie dojechało do raportu, więc KAŻDA liczba pokrycia z tego",
      "przebiegu jest zaniżona - progów per-ścieżka nie wolno pod nią ruszać.",
      "Diagnoza: `scripts/vitest/testAccountingReporter.ts` i nagłówek",
      "`__tests__/editorMatrix.shared.tsx`.",
      "",
    ].join("\n");

    process.stderr.write(`${lines}\n`);
    // NIE `throw`: wyjątek z tego haka przerywa `Vitest.report()` PRZED
    // raportem pokrycia, a `coverage.reportOnFailure: true` istnieje właśnie po
    // to, żeby raport powstawał także na czerwonej suicie (sprawdzone
    // pomiarem: z wyjątkiem log nie ma ani „Coverage summary", ani linii
    // `ERROR: Coverage ...`). Vitest nigdy nie ustawia `exitCode` na 0 - tylko
    // na 1 przy porażkach - więc podniesienie kodu tutaj jest trwałe i nie
    // zabiera nikomu raportu.
    process.exitCode = 1;
  }
}
