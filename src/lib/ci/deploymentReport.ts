// Czysty generator raportu zgodności wdrożenia.
//
// Zbiera to, co po wydaniu wersji musi być udokumentowane: numery PR wchodzące
// w wydanie, liczbę testów, status CI oraz wynik smoke'ów (E2E). Wejście jest
// zwykłymi danymi - I/O (git, pliki raportów vitest/playwright, zmienne
// środowiskowe GitHuba) robi scripts/deployment-report.ts.
export interface PullRequestRef {
  readonly number: number;
  readonly title: string;
  readonly sha: string;
}

export type CheckStatus = "passed" | "failed" | "skipped" | "unknown";

export interface TestTotals {
  readonly files: number;
  readonly tests: number;
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
}

export interface DeploymentReportInput {
  readonly version: string;
  readonly generatedAt: string;
  readonly commit: string;
  readonly branch: string;
  readonly previousRef: string | null;
  readonly pullRequests: readonly PullRequestRef[];
  readonly unitTests: TestTotals | null;
  readonly smoke: {
    readonly status: CheckStatus;
    readonly tests: number;
    readonly failed: number;
  } | null;
  readonly ciStatus: CheckStatus;
  readonly dbContract: { readonly status: CheckStatus; readonly missing: number } | null;
  readonly i18nParity: { readonly status: CheckStatus; readonly missing: number } | null;
  /**
   * Bramka wierności ustawień widgetów (panel ⇄ renderer).
   *
   * `unwaived` to rozjazdy między tym, co panel oferuje redakcji, a tym, co
   * renderer naprawdę czyta - BEZ uzasadnienia (każdy z nich to defekt).
   * `waived` to rozjazdy zamierzone, opisane powodem. Raportujemy OBA, bo
   * pokrycie rejestru widgetów jest na tę klasę błędu całkowicie odporne:
   * widget istnieje, renderuje się, a pojedyncze ustawienie kłamie.
   */
  readonly widgetFidelity: {
    readonly status: CheckStatus;
    readonly unwaived: number;
    readonly waived: number;
  } | null;
}

const STATUS_ICON: Record<CheckStatus, string> = {
  passed: "✅",
  failed: "❌",
  skipped: "⏭️",
  unknown: "❔",
};

/** Wyciąga numery PR z komunikatów merge commitów (`Merge pull request #123 from …`). */
export function parsePullRequests(
  commits: readonly { readonly sha: string; readonly subject: string; readonly body?: string }[],
): PullRequestRef[] {
  const seen = new Map<number, PullRequestRef>();
  for (const c of commits) {
    const merge = /Merge pull request #(\d+) from \S+/.exec(c.subject);
    const squash = /\(#(\d+)\)\s*$/.exec(c.subject);
    const number = merge ? Number(merge[1]) : squash ? Number(squash[1]) : null;
    if (number === null || seen.has(number)) continue;
    const title = merge
      ? (c.body ?? "")
          .split("\n")
          .find((l) => l.trim() !== "")
          ?.trim() || c.subject
      : c.subject.replace(/\s*\(#\d+\)\s*$/, "");
    seen.set(number, { number, title, sha: c.sha });
  }
  return [...seen.values()].sort((a, b) => b.number - a.number);
}

/** Wynik całościowy: czerwony, jeśli którakolwiek bramka padła. */
export function overallStatus(input: DeploymentReportInput): CheckStatus {
  const statuses: CheckStatus[] = [
    input.ciStatus,
    input.smoke?.status ?? "unknown",
    input.dbContract?.status ?? "unknown",
    input.i18nParity?.status ?? "unknown",
    input.widgetFidelity?.status ?? "unknown",
  ];
  if (statuses.includes("failed")) return "failed";
  if ((input.unitTests?.failed ?? 0) > 0) return "failed";
  if (statuses.every((s) => s === "passed")) return "passed";
  return "unknown";
}

/** Raport w Markdown - trafia do artefaktu CI i do GitHub Step Summary. */
export function renderDeploymentReport(input: DeploymentReportInput): string {
  const overall = overallStatus(input);
  const lines: string[] = [
    `# Raport zgodności wdrożenia - ${input.version}`,
    "",
    `- Status ogólny: **${STATUS_ICON[overall]} ${overall}**`,
    `- Commit: \`${input.commit}\` (gałąź \`${input.branch}\`)`,
    `- Zakres: \`${input.previousRef ?? "początek historii"}\` → \`${input.commit}\``,
    `- Wygenerowano: ${input.generatedAt}`,
    "",
    "## Bramki",
    "",
    "| Bramka | Status | Szczegóły |",
    "| --- | --- | --- |",
    `| CI (typecheck, lint, build) | ${STATUS_ICON[input.ciStatus]} ${input.ciStatus} | - |`,
    input.unitTests
      ? `| Testy jednostkowe | ${STATUS_ICON[input.unitTests.failed > 0 ? "failed" : "passed"]} ${
          input.unitTests.failed > 0 ? "failed" : "passed"
        } | ${input.unitTests.passed}/${input.unitTests.tests} zielonych w ${input.unitTests.files} plikach |`
      : `| Testy jednostkowe | ${STATUS_ICON.unknown} unknown | brak raportu |`,
    input.smoke
      ? `| Smoke E2E | ${STATUS_ICON[input.smoke.status]} ${input.smoke.status} | ${input.smoke.tests} testów, ${input.smoke.failed} czerwonych |`
      : `| Smoke E2E | ${STATUS_ICON.unknown} unknown | brak raportu |`,
    input.dbContract
      ? `| Kontrakt bazy (tabele/widoki/RPC) | ${STATUS_ICON[input.dbContract.status]} ${input.dbContract.status} | brakujących: ${input.dbContract.missing} |`
      : `| Kontrakt bazy (tabele/widoki/RPC) | ${STATUS_ICON.unknown} unknown | brak raportu |`,
    input.i18nParity
      ? `| Parytet PL/EN | ${STATUS_ICON[input.i18nParity.status]} ${input.i18nParity.status} | brakujących kluczy: ${input.i18nParity.missing} |`
      : `| Parytet PL/EN | ${STATUS_ICON.unknown} unknown | brak raportu |`,
    input.widgetFidelity
      ? `| Wierność ustawień widgetów (panel ⇄ renderer) | ${STATUS_ICON[input.widgetFidelity.status]} ${input.widgetFidelity.status} | rozjazdy bez uzasadnienia: ${input.widgetFidelity.unwaived} · zwolnione z powodem: ${input.widgetFidelity.waived} |`
      : `| Wierność ustawień widgetów (panel ⇄ renderer) | ${STATUS_ICON.unknown} unknown | brak raportu |`,
    "",
    `## Pull requesty w wydaniu (${input.pullRequests.length})`,
    "",
  ];

  if (input.pullRequests.length === 0) {
    lines.push("_Brak merge commitów PR w tym zakresie._");
  } else {
    for (const pr of input.pullRequests) {
      lines.push(`- **#${pr.number}** - ${pr.title} (\`${pr.sha.slice(0, 8)}\`)`);
    }
  }

  return `${lines.join("\n")}\n`;
}
