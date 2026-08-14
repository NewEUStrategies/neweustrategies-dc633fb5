// Meta-inwariant CI: BRAMKA, KTÓRA ISTNIEJE, MUSI SIĘ URUCHAMIAĆ.
//
// ── PRZYCZYNA ŹRÓDŁOWA ──────────────────────────────────────────────────────
// Repo ma 25 bramek `check:*` i historię, w której najdroższe defekty przeszły
// NIE dlatego, że bramki brakowało, ale dlatego, że istniejąca bramka nie była
// wpięta w żaden workflow. Trzy udokumentowane przypadki, każdy opisany
// w komentarzu przy swoim kroku w `.github/workflows/ci.yml`:
//
//   * `check:authz-snapshot`   - skrypt istniał od wprowadzenia macierzy
//     uprawnień i NIE BYŁ wpięty; zawężenie kręgu uprawnionych w
//     `profiles_guard_verification()` (20260806094104) przeszło bez sygnału,
//     a suita na `main` stała czerwona czwartą dobę;
//   * `check:pg-harness`       - istniał od dawna, uruchamiał go WYŁĄCZNIE
//     człowiek, jeśli pamiętał; dlatego `source_type = 'club_application'`
//     łamiące CHECK na `crm_leads` trafiło na produkcję, a ścieżka zgłoszeń
//     klubowych nie działała w ŻADNYM przypadku przy zielonym CI;
//   * `check:careers-harness`  - ten sam mechanizm w module rekrutacji.
//
// Wspólny mianownik: bramka niewpięta wygląda w repo dokładnie tak samo jak
// bramka wpięta - jest skrypt, jest logika, jest test jednostkowy. Różnicę
// widać jedynie w pliku workflow, którego przy przeglądzie zmiany nikt nie
// czyta, bo „to tylko konfiguracja". Dlatego różnicę mierzy bramka.
//
// ── DRUGI POMIAR: TEN SAM KROK DWA I TRZY RAZY ─────────────────────────────
// Skan przy wprowadzeniu (2026-08-14) pokazał w jednym jobie `verify`:
// `check:authz-snapshot` TRZY razy i `check:permissions-parity` DWA razy - te
// same komendy pod różnymi nazwami kroków, każda dokładająca swój czas do
// czasu do pierwszej informacji zwrotnej. Powtórzenie nie zwiększa pokrycia
// ani o jeden przypadek; zwiększa tylko koszt. To bliźniak defektu z góry:
// obie klasy powstają, gdy plik workflow rośnie krokami dopisywanymi po
// kolejnych awariach i nikt nie czyta go jako całości.
//
// Powtórzenia liczymy W OBRĘBIE JOBA. Ten sam skrypt w dwóch RÓŻNYCH jobach
// jest zwykle celowy (`test:e2e` jedzie osobno na bazie z seedem i bez), więc
// nie jest defektem.
//
// Warstwa wykonawcza (odczyt package.json i katalogu workflowów, kod wyjścia)
// żyje w `scripts/check-gate-coverage.ts`; ten moduł jest czysty.

/** Plik workflow poddany skanowi. */
export interface WorkflowSource {
  readonly file: string;
  readonly yaml: string;
}

/** Jedno wywołanie skryptu z package.json w workflow. */
export interface GateInvocation {
  readonly file: string;
  /** Nazwa joba (`verify`, `pgtap`, …); `<root>` gdy nie da się jej ustalić. */
  readonly job: string;
  readonly script: string;
  /** Numer linii, żeby raport prowadził wprost do miejsca. */
  readonly line: number;
}

/** `bun run x`, `bunx run x` - obie formy są w repo w użyciu. */
const RUN_RE = /\bbun(?:x)?\s+run\s+([A-Za-z0-9:_-]+)/g;
/** Klucz joba: dokładnie dwie spacje wcięcia pod `jobs:`. */
const JOB_RE = /^ {2}([A-Za-z0-9_-]+):\s*$/;

/**
 * Wywołania skryptów w workflowach, z przypisaniem do joba.
 *
 * Parsowanie liniowe, bez biblioteki YAML - tak samo jak
 * `workflowEnvContract.ts`, żeby bramki workflowów nie różniły się tym, jak
 * czytają ten sam plik.
 */
export function scanGateInvocations(workflows: readonly WorkflowSource[]): GateInvocation[] {
  const out: GateInvocation[] = [];
  for (const { file, yaml } of workflows) {
    let job = "<root>";
    let insideJobs = false;
    const lines = yaml.split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (/^jobs:\s*$/.test(line)) {
        insideJobs = true;
        continue;
      }
      if (insideJobs) {
        const jobMatch = JOB_RE.exec(line);
        if (jobMatch !== null) job = jobMatch[1];
      }
      RUN_RE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = RUN_RE.exec(line)) !== null) {
        out.push({ file, job, script: match[1], line: i + 1 });
      }
    }
  }
  return out;
}

/** Ten sam skrypt wywołany w jednym jobie więcej niż raz. */
export interface DuplicateInvocation {
  readonly file: string;
  readonly job: string;
  readonly script: string;
  readonly lines: readonly number[];
}

export interface GateCoverageReport {
  /** Wszystkie bramki `check:*` z package.json - liczba kontrolna skanu. */
  readonly totalGates: number;
  /** Bramki bez ANI JEDNEGO wywołania w workflowach. */
  readonly unwired: readonly string[];
  /** Skrypty wywoływane w workflow, których nie ma w package.json. */
  readonly unknown: readonly GateInvocation[];
  /** Bramki uruchamiane w tym samym jobie wielokrotnie. */
  readonly duplicated: readonly DuplicateInvocation[];
}

export function analyzeGateCoverage(
  scripts: readonly string[],
  invocations: readonly GateInvocation[],
): GateCoverageReport {
  const known = new Set(scripts);
  const gates = scripts.filter((name) => name.startsWith("check:")).sort();
  const invoked = new Set(invocations.map((entry) => entry.script));

  const perJob = new Map<string, GateInvocation[]>();
  for (const entry of invocations) {
    if (!entry.script.startsWith("check:")) continue;
    const key = `${entry.file}::${entry.job}::${entry.script}`;
    const bucket = perJob.get(key);
    if (bucket === undefined) perJob.set(key, [entry]);
    else bucket.push(entry);
  }

  const duplicated: DuplicateInvocation[] = [];
  for (const bucket of perJob.values()) {
    if (bucket.length < 2) continue;
    duplicated.push({
      file: bucket[0].file,
      job: bucket[0].job,
      script: bucket[0].script,
      lines: bucket.map((entry) => entry.line),
    });
  }

  return {
    totalGates: gates.length,
    unwired: gates.filter((gate) => !invoked.has(gate)),
    unknown: invocations.filter((entry) => !known.has(entry.script)),
    duplicated: duplicated.sort((a, b) => a.script.localeCompare(b.script)),
  };
}

/**
 * Oblewa też na `totalGates === 0`: bramka, która po zmianie nazw skryptów
 * przestaje cokolwiek widzieć, wygląda identycznie jak bramka przechodząca.
 */
export function gateCoverageFailed(report: GateCoverageReport): boolean {
  return (
    report.totalGates === 0 ||
    report.unwired.length > 0 ||
    report.unknown.length > 0 ||
    report.duplicated.length > 0
  );
}

export function renderGateCoverageReport(report: GateCoverageReport): string {
  if (report.totalGates === 0) {
    return [
      "✗ [gate-coverage] nie znaleziono ANI JEDNEJ bramki `check:*` w package.json.",
      "  To nie jest zielone światło - to zepsuty skan albo przemianowane skrypty.",
    ].join("\n");
  }

  const lines: string[] = [];

  if (report.unwired.length > 0) {
    lines.push(
      `✗ [gate-coverage] ${report.unwired.length} bramek NIE JEST wpiętych w żaden workflow:`,
      ...report.unwired.map((gate) => `    ${gate}`),
      "",
      "Bramka, której nie uruchamia CI, jest dokumentacją intencji, nie bramką -",
      "i tak przeszły na produkcję: pusty pipeline zgłoszeń klubowych oraz",
      "zawężenie uprawnień w profiles_guard_verification. Wepnij krok w",
      ".github/workflows/ci.yml albo usuń skrypt, jeśli przestał być potrzebny.",
    );
  }

  if (report.unknown.length > 0) {
    lines.push(
      `✗ [gate-coverage] ${report.unknown.length} wywołań wskazuje na skrypt, którego nie ma w package.json:`,
      ...report.unknown.map(
        (entry) => `    ${entry.file}:${entry.line} (job ${entry.job})  bun run ${entry.script}`,
      ),
      "",
      "`bun run` na nieistniejącej nazwie wywala job dopiero w przebiegu, po",
      "instalacji zależności - a przy `continue-on-error` nie wywala go wcale.",
    );
  }

  if (report.duplicated.length > 0) {
    lines.push(
      `✗ [gate-coverage] ${report.duplicated.length} bramek jedzie w tym samym jobie więcej niż raz:`,
      ...report.duplicated.map(
        (entry) =>
          `    ${entry.script}  ${entry.file} (job ${entry.job}), linie: ${entry.lines.join(", ")}`,
      ),
      "",
      "Powtórzenie nie dokłada ani jednego sprawdzanego przypadku - dokłada tylko",
      "czas do pierwszej informacji zwrotnej. Zostaw JEDEN krok, a uzasadnienia",
      "z usuwanych komentarzy przenieś do niego.",
    );
  }

  if (lines.length === 0) {
    return `✓ Pokrycie bramek OK (${report.totalGates} bramek check:*, każda wpięta dokładnie raz na job).`;
  }
  return lines.join("\n");
}
