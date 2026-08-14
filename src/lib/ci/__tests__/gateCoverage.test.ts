// Testy meta-bramki „bramka, która istnieje, musi się uruchamiać". Konwencja
// repo: inwariant CI ma test, a nie tylko przebieg w CI - inaczej sam skaner nie
// ma jak umrzeć na czerwono, gdy przestanie cokolwiek widzieć.
import { describe, expect, it } from "vitest";
import {
  analyzeGateCoverage,
  gateCoverageFailed,
  renderGateCoverageReport,
  scanGateInvocations,
} from "@/lib/ci/gateCoverage";

/** Minimalny workflow o kształcie `ci.yml`: dwa joby, kroki z `bun run`. */
const WORKFLOW = [
  "name: CI",
  "on:",
  "  pull_request:",
  "jobs:",
  "  verify:",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - name: Format",
  "        run: bun run format:check",
  "      - name: Migracje",
  "        run: bun run check:sql-migration-replay",
  "  pgtap:",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - name: Harness",
  "        run: bun run check:pg-harness",
].join("\n");

const SCRIPTS = ["format:check", "check:sql-migration-replay", "check:pg-harness", "check:bundle"];

describe("gateCoverage - bramka, która istnieje, musi się uruchamiać", () => {
  it("przypisuje wywołania do właściwego joba i linii", () => {
    const invocations = scanGateInvocations([{ file: "ci.yml", yaml: WORKFLOW }]);
    expect(invocations).toEqual([
      { file: "ci.yml", job: "verify", script: "format:check", line: 9 },
      { file: "ci.yml", job: "verify", script: "check:sql-migration-replay", line: 11 },
      { file: "ci.yml", job: "pgtap", script: "check:pg-harness", line: 16 },
    ]);
  });

  it("zgłasza bramkę, której nie uruchamia żaden workflow", () => {
    const report = analyzeGateCoverage(
      SCRIPTS,
      scanGateInvocations([{ file: "ci.yml", yaml: WORKFLOW }]),
    );
    expect(report.unwired).toEqual(["check:bundle"]);
    expect(gateCoverageFailed(report)).toBe(true);
    expect(renderGateCoverageReport(report)).toContain("check:bundle");
  });

  it("nie liczy skryptów spoza `check:*` jako bramek", () => {
    // `format:check` jest wywoływany, ale nawet gdyby nie był - to nie bramka
    // `check:*`, więc nie wchodzi do liczby ani do listy niewpiętych.
    const report = analyzeGateCoverage(
      ["format:check", "check:sql-migration-replay", "check:pg-harness"],
      scanGateInvocations([{ file: "ci.yml", yaml: WORKFLOW }]),
    );
    expect(report.totalGates).toBe(2);
    expect(report.unwired).toEqual([]);
    expect(gateCoverageFailed(report)).toBe(false);
  });

  it("zgłasza tę samą bramkę uruchomioną dwa razy w JEDNYM jobie", () => {
    const yaml = [
      "jobs:",
      "  verify:",
      "    steps:",
      "      - name: Snapshot",
      "        run: bun run check:authz-snapshot",
      "      - name: Snapshot parity",
      "        run: bun run check:authz-snapshot",
    ].join("\n");
    const report = analyzeGateCoverage(
      ["check:authz-snapshot"],
      scanGateInvocations([{ file: "ci.yml", yaml }]),
    );
    expect(report.duplicated).toEqual([
      { file: "ci.yml", job: "verify", script: "check:authz-snapshot", lines: [5, 7] },
    ]);
    expect(gateCoverageFailed(report)).toBe(true);
  });

  it("ta sama bramka w DWÓCH jobach nie jest duplikatem - to zwykle celowe", () => {
    const yaml = [
      "jobs:",
      "  verify:",
      "    steps:",
      "      - run: bun run check:pg-harness",
      "  verify-seeded:",
      "    steps:",
      "      - run: bun run check:pg-harness",
    ].join("\n");
    const report = analyzeGateCoverage(
      ["check:pg-harness"],
      scanGateInvocations([{ file: "ci.yml", yaml }]),
    );
    expect(report.duplicated).toEqual([]);
    expect(gateCoverageFailed(report)).toBe(false);
  });

  it("zgłasza krok wołający skrypt, którego nie ma w package.json", () => {
    const yaml = ["jobs:", "  verify:", "    steps:", "      - run: bun run check:literowka"].join(
      "\n",
    );
    const report = analyzeGateCoverage(
      ["check:sql-migration-replay"],
      scanGateInvocations([{ file: "ci.yml", yaml }]),
    );
    expect(report.unknown.map((entry) => entry.script)).toEqual(["check:literowka"]);
    expect(gateCoverageFailed(report)).toBe(true);
  });

  it("brak bramek w package.json OBLEWA - milczący skan wygląda jak zielony", () => {
    const report = analyzeGateCoverage([], []);
    expect(report.totalGates).toBe(0);
    expect(gateCoverageFailed(report)).toBe(true);
    expect(renderGateCoverageReport(report)).toContain("zepsuty skan");
  });

  it("czysty stan raportuje liczbę bramek", () => {
    const report = analyzeGateCoverage(
      // `format:check` MUSI tu być, choć nie jest bramką `check:*`: workflow go
      // woła, a skrypt nieznany manifestowi jest osobnym błędem (`unknown`).
      ["format:check", "check:sql-migration-replay", "check:pg-harness"],
      scanGateInvocations([{ file: "ci.yml", yaml: WORKFLOW }]),
    );
    expect(gateCoverageFailed(report)).toBe(false);
    expect(renderGateCoverageReport(report)).toContain("2 bramek check:*");
  });
});
