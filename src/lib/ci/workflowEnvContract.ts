// Inwariant CI: KAŻDA ZMIENNA ŚRODOWISKOWA EKSPORTOWANA PRZEZ WORKFLOW MUSI
// MIEĆ ODBIORCĘ.
//
// ── KLASA BŁĘDU, KTÓRA TO WYMUSIŁA ──────────────────────────────────────────
// `billing-nightly.yml` eksportował `PADDLE_SANDBOX_API_KEY`, a sonda czytała
// `STRIPE_SANDBOX_API_KEY`. Nikt nie miał jak tego zauważyć, bo obie strony są
// SKŁADNIOWO POPRAWNE i po obu stronach brak wartości jest legalnym stanem:
// workflow spokojnie eksportuje pusty sekret, a sonda ma świadomie zaprojektowane
// „brak kluczy = zielone wyjście z ostrzeżeniem" (żeby nie wywracać CI na forku).
// Złożenie tych dwóch rozsądnych decyzji dało przebieg, który co dobę spał
// 40 minut, kończył się na zielono i nie sprawdzał NICZEGO.
//
// Bramka „bez starego operatora" złapałaby akurat ten egzemplarz po nazwie
// sekretu, ale nie złapie następnego: literówki, przemianowania zmiennej w
// skrypcie, skopiowanego bloku `env:` z innego joba. Ta bramka jest od KLASY,
// nie od egzemplarza - i jest niezależna od nazwy dostawcy.
//
// ── CO DOKŁADNIE SPRAWDZA ───────────────────────────────────────────────────
// Kierunek „martwy eksport": klucz zadeklarowany w bloku `env:` workflow, po
// który NIKT nie sięga. Odbiorcą jest cokolwiek z poniższych:
//   1. kod repo - `process.env.KEY`, `process.env["KEY"]`, `import.meta.env.KEY`,
//      `env.KEY` w wywołaniach `getEnv("KEY")` / `vi.stubEnv("KEY", ...)`,
//   2. shell w tym samym workflow - `$KEY`, `${KEY}`, `${{ env.KEY }}`,
//   3. narzędzie zewnętrzne z jawnej, komentowanej listy `TOOL_CONSUMED`.
//
// Kierunku odwrotnego („skrypt czyta zmienną, której workflow nie eksportuje")
// bramka ŚWIADOMIE nie pilnuje: opcjonalne zmienne z sensownym domyślnym są
// normą, więc byłby to generator fałszywych alarmów, a nie inwariant.
//
// Warstwa wykonawcza (odczyt plików) żyje w
// `scripts/check-workflow-env-contract.ts`; ten moduł jest czysty i testowalny.

/**
 * Zmienne konsumowane przez narzędzia, a nie przez kod repo. Każda pozycja to
 * świadome zwolnienie - dopisanie czegokolwiek tutaj wymaga uzasadnienia.
 */
export const TOOL_CONSUMED: ReadonlySet<string> = new Set([
  // bun/npm: rejestr, z którego instalowane są zależności w CI.
  "npm_config_registry",
  // Node: rozmiar sterty dla build/dev.
  "NODE_OPTIONS",
  "NODE_ENV",
  // Playwright: lokalizacja przeglądarek i pomijanie pobierania.
  "PLAYWRIGHT_BROWSERS_PATH",
  "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD",
  // Supabase CLI.
  "SUPABASE_ACCESS_TOKEN",
  "SUPABASE_DB_PASSWORD",
]);

/** Zmienne, które GitHub Actions wstrzykuje samo - nikt ich nie „eksportuje". */
export const GITHUB_PROVIDED = /^(GITHUB|RUNNER|ACTIONS|CI$)/;

export interface WorkflowFile {
  readonly file: string;
  readonly yaml: string;
}

export interface SourceFile {
  readonly file: string;
  readonly source: string;
}

export interface EnvDeclaration {
  readonly file: string;
  readonly line: number;
  readonly key: string;
}

export interface WorkflowEnvReport {
  /** Wszystkie deklaracje `env:` znalezione w workflow. */
  readonly declared: readonly EnvDeclaration[];
  /** Deklaracje bez żadnego odbiorcy - to są błędy. */
  readonly orphaned: readonly EnvDeclaration[];
  /** Liczba różnych kluczy odczytywanych przez kod repo. */
  readonly consumedKeys: number;
}

/** `  KEY: wartość` - klucz env musi być SCREAMING_SNAKE lub npm_config_*. */
const ENV_ENTRY_RE = /^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/;
/** `env:` otwierające mapę (bez wartości w tej samej linii). */
const ENV_BLOCK_RE = /^(\s*)env\s*:\s*(#.*)?$/;
/** `KEY: |` / `KEY: >-` - wartość jest wielolinijkowym skalarem, nie mapą. */
const BLOCK_SCALAR_RE = /^[|>][-+]?\d*\s*$/;

/**
 * Wyciąga deklaracje `env:` z YAML-a workflow bez parsera YAML.
 *
 * Zamiast pełnego parsowania szukamy bloków `env:` i zbieramy wpisy o WIĘKSZYM
 * wcięciu, kończąc blok na pierwszym wierszu z wcięciem <= wcięcie `env:`.
 * To dokładnie ta część gramatyki, której workflow używa, i - w odróżnieniu od
 * regexpa po całym pliku - nie łapie `with:`, `outputs:` ani `jobs:`.
 *
 * Wiersze komentarza i puste są przezroczyste (nie zamykają bloku), bo w
 * workflow komentarz na kolumnie 0 potrafi stać w środku mapy. Treść skalara
 * blokowego (`KEY: |`) jest pomijana w całości - `foo: bar` w środku takiego
 * skalara to dane, nie deklaracja zmiennej.
 */
export function extractEnvDeclarations(file: string, yaml: string): EnvDeclaration[] {
  const declarations: EnvDeclaration[] = [];
  const lines = yaml.split("\n");
  let blockIndent: number | null = null;
  let scalarIndent: number | null = null;

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) return;

    const indent = line.length - line.trimStart().length;

    if (scalarIndent !== null && indent > scalarIndent) return;
    scalarIndent = null;

    if (blockIndent !== null && indent <= blockIndent) blockIndent = null;

    const blockMatch = ENV_BLOCK_RE.exec(line);
    if (blockMatch) {
      blockIndent = blockMatch[1].length;
      return;
    }

    if (blockIndent === null) return;

    const entry = ENV_ENTRY_RE.exec(line);
    if (!entry) return;

    declarations.push({ file, line: index + 1, key: entry[2] });
    if (BLOCK_SCALAR_RE.test(entry[3])) scalarIndent = indent;
  });

  return declarations;
}

const CONSUMER_PATTERNS: readonly RegExp[] = [
  // process.env.KEY / process.env["KEY"] / process.env['KEY']
  /process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g,
  /process\.env\[\s*["'`]([A-Za-z_][A-Za-z0-9_]*)["'`]\s*\]/g,
  // import.meta.env.KEY / import.meta.env["KEY"]
  /import\.meta\.env\.([A-Za-z_][A-Za-z0-9_]*)/g,
  /import\.meta\.env\[\s*["'`]([A-Za-z_][A-Za-z0-9_]*)["'`]\s*\]/g,
  // getEnv("KEY") - wspólny akcesor serwerowy (src/lib/stripe.server.ts i in.)
  /getEnv\(\s*["'`]([A-Za-z_][A-Za-z0-9_]*)["'`]/g,
  // vi.stubEnv("KEY", ...) - testy deklarują kontrakt tak samo wiążąco.
  /stubEnv\(\s*["'`]([A-Za-z_][A-Za-z0-9_]*)["'`]/g,
];

/** `const env = process.env` - alias, przez który idą dalsze odczyty. */
const ALIAS_RE = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*process\.env\b/g;
/** `const { A, B } = process.env` - destrukturyzacja to też odczyt. */
const DESTRUCTURED_RE = /(?:const|let|var)\s*\{([^}]*)\}\s*=\s*process\.env\b/g;
const IDENTIFIER_RE = /[A-Za-z_][A-Za-z0-9_]*/g;

/**
 * Wszystkie nazwy zmiennych, po które kod repo faktycznie sięga.
 *
 * Obsługa aliasu (`const env = process.env; env.SCHEDULER_JOB`) i
 * destrukturyzacji nie jest ozdobnikiem: `scripts/scheduler-tick.mjs` czyta tak
 * KOMPLET swoich siedmiu zmiennych, więc detektor bez tego zgłaszałby siedem
 * fałszywych alarmów naraz - a bramka, która krzyczy bez powodu, przestaje być
 * czytana i pierwszy PRAWDZIWY martwy eksport przejdzie razem z szumem.
 */
export function collectConsumedKeys(sources: readonly SourceFile[]): Set<string> {
  const keys = new Set<string>();

  for (const { source } of sources) {
    for (const pattern of CONSUMER_PATTERNS) {
      for (const match of source.matchAll(pattern)) keys.add(match[1]);
    }

    for (const match of source.matchAll(DESTRUCTURED_RE)) {
      for (const identifier of match[1].matchAll(IDENTIFIER_RE)) keys.add(identifier[0]);
    }

    for (const match of source.matchAll(ALIAS_RE)) {
      const alias = match[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const aliasedRead = new RegExp(`\\b${alias}\\.([A-Za-z_][A-Za-z0-9_]*)`, "g");
      for (const read of source.matchAll(aliasedRead)) keys.add(read[1]);
    }
  }

  return keys;
}

/** Czy klucz jest użyty w samym workflow (shell `$KEY` albo `${{ env.KEY }}`). */
export function usedInWorkflow(yaml: string, key: string): boolean {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `\\$${escaped}\\b|\\$\\{${escaped}\\b|env\\.${escaped}\\b|inputs\\.${escaped}\\b`,
  ).test(yaml);
}

export function analyzeWorkflowEnvContract(
  workflows: readonly WorkflowFile[],
  sources: readonly SourceFile[],
): WorkflowEnvReport {
  const consumed = collectConsumedKeys(sources);
  const declared: EnvDeclaration[] = [];
  const orphaned: EnvDeclaration[] = [];

  for (const workflow of workflows) {
    for (const declaration of extractEnvDeclarations(workflow.file, workflow.yaml)) {
      declared.push(declaration);
      const { key } = declaration;
      if (consumed.has(key)) continue;
      if (TOOL_CONSUMED.has(key)) continue;
      if (GITHUB_PROVIDED.test(key)) continue;
      if (usedInWorkflow(workflow.yaml, key)) continue;
      orphaned.push(declaration);
    }
  }

  return { declared, orphaned, consumedKeys: consumed.size };
}

export function workflowEnvContractFailed(report: WorkflowEnvReport): boolean {
  return report.orphaned.length > 0;
}

export function renderWorkflowEnvContractReport(report: WorkflowEnvReport): string {
  if (report.orphaned.length === 0) {
    return (
      `✓ Kontrakt env workflow ⇄ kod OK (${report.declared.length} deklaracji w workflow, ` +
      `${report.consumedKeys} nazw odczytywanych przez repo - zero martwych eksportów).`
    );
  }

  const lines = [
    `✗ ${report.orphaned.length} zmiennych eksportowanych przez workflow, których NIKT nie czyta:`,
  ];
  for (const { file, line, key } of report.orphaned) lines.push(`    ${file}:${line}  ${key}`);
  lines.push(
    "  Martwy eksport znaczy jedno z dwóch i oba są błędem:",
    "    a) skrypt czyta INNĄ nazwę (literówka / przemianowanie) - krok wykonuje się",
    "       bez konfiguracji i zwykle kończy się cicho na zielono,",
    "    b) zmienna jest reliktem po usuniętym kroku - usuń ją z workflow.",
    "  Narzędzie zewnętrzne jako odbiorca: dopisz klucz do TOOL_CONSUMED",
    "  w src/lib/ci/workflowEnvContract.ts razem z uzasadnieniem.",
  );
  return lines.join("\n");
}
