// Odwołania w żywych dokumentach (runbooki, umowa, architektura) do poleceń
// i plików repozytorium (audyt ED14, „dokumentacja a kod").
//
// PO CO. Commit c3f0c0e72 (2026-10-05) usunął z package.json skrypty
// `check:ownership` i `check:workflow-env-contract` razem z plikami, a procedura
// przejęcia utrzymania (RUNBOOK_CIAGLOSC_WYKONAWCY.md, kroki 6 i 7) i źródło
// prawdy SLA (UMOWA_UTRZYMANIOWA.md) dalej kazały je uruchamiać - na czystej
// maszynie procedura padała. Odwołania `ci.yml:746` wskazywały poza plik
// o 528 liniach. Nikt tego nie widział, bo nic tego nie sprawdzało.
//
// CO SPRAWDZA (wyłącznie kod inline `…` i bloki ```…```):
//   * `bun run <skrypt>` - skrypt istnieje w package.json; `bun run <plik>` -
//     plik istnieje;
//   * ścieżka repo (`src/…`, `scripts/…`, `docs/…`, `.github/…` …) istnieje,
//     a `plik:N` / `plik:N-M` mieści się w pliku;
//   * `<workflow>.yml:N` jest ZAKAZANE - workflowy zmieniają się co kilka dni,
//     a numer linii gnije bez śladu; dokument wskazuje nazwę joba albo kroku.
// Ścieżki ze wzorcem (`*`, `{…}`, `<…>`, `…`) to nie odwołania do pliku.
//
// Moduł nie czyta dysku: kontekst wchodzi parametrem (test i fikstury).

export type DocReferenceKind = "script" | "file" | "path" | "line-range" | "workflow-line";

export interface DocReferenceProblem {
  readonly doc: string;
  readonly line: number;
  readonly ref: string;
  readonly kind: DocReferenceKind;
  readonly detail: string;
}

export interface DocReferenceContext {
  readonly scripts: ReadonlySet<string>;
  /** Czy plik albo katalog istnieje (ścieżka względna od korzenia repo). */
  exists(path: string): boolean;
  /** Liczba linii pliku; `null` dla katalogu albo braku. */
  lineCount(path: string): number | null;
}

const REPO_ROOTS = [
  "src",
  "scripts",
  "docs",
  "supabase",
  "governance",
  ".github",
  "e2e",
  "e2e-ab",
  "e2e-performance",
  "integration",
  "tools",
  "public",
  "drizzle",
] as const;

const ROOTED_PATH = new RegExp(
  `^(?:\\./)?(?:${REPO_ROOTS.map((root) => root.replace(".", "\\.")).join("|")})/`,
);
/** Goła nazwa pliku z rozszerzeniem (np. `ci.yml`, `vite.config.ts`). */
const BARE_FILE = /^[A-Za-z0-9_.-]+\.(?:ya?ml|ts|tsx|mjs|js|json|toml|md|sql)$/;
const PATTERN_CHARS = /[*{}<>…$]|\.\.\.|\s/;
const WORKFLOW_FILE = /\.ya?ml$/;
const REF_WITH_LINES = /^(.+?)(?::(\d+)(?:-(\d+))?(?:,\d+(?:-\d+)?)*)?$/;
const BUN_RUN = /\bbun run ([^\s`'";|&)]+)/g;

function checkBunRun(
  name: string,
  ctx: DocReferenceContext,
): { kind: DocReferenceKind; detail: string } | null {
  if (name.startsWith("<") || name.startsWith("$") || name.startsWith("-")) return null;
  const isFile = name.includes("/") || /\.(?:ts|mjs|js)$/.test(name);
  if (isFile) {
    return ctx.exists(name) ? null : { kind: "file", detail: `bun run: brak pliku ${name}` };
  }
  return ctx.scripts.has(name)
    ? null
    : { kind: "script", detail: `bun run: brak skryptu „${name}" w package.json` };
}

/** Plik, na który wskazuje odwołanie, albo `null`, gdy to nie odwołanie do pliku repo. */
function resolvePath(
  path: string,
  ctx: DocReferenceContext,
): { file: string | null; rooted: boolean } | null {
  if (PATTERN_CHARS.test(path)) return null;
  const clean = path.replace(/^\.\//, "");
  if (ROOTED_PATH.test(path)) return { file: ctx.exists(clean) ? clean : null, rooted: true };
  if (!BARE_FILE.test(clean)) return null;
  // Goła nazwa: korzeń repo albo katalog workflowów. Nieznana goła nazwa to
  // skrót („`provider.server.ts:178`" obok pełnej ścieżki) - nie zgadujemy.
  const candidate = [clean, `.github/workflows/${clean}`].find((item) => ctx.exists(item));
  return candidate ? { file: candidate, rooted: false } : null;
}

function checkInlineRef(
  raw: string,
  ctx: DocReferenceContext,
): { kind: DocReferenceKind; detail: string } | null {
  const parsed = REF_WITH_LINES.exec(raw.trim());
  if (!parsed) return null;
  const [, path, from, to] = parsed;
  const resolved = resolvePath(path!, ctx);
  if (!resolved) return null;
  if (!resolved.file) {
    return { kind: "path", detail: `brak ścieżki ${path} w repozytorium` };
  }
  if (from === undefined) return null;
  if (WORKFLOW_FILE.test(resolved.file) && resolved.file.startsWith(".github/workflows/")) {
    return {
      kind: "workflow-line",
      detail: `numer linii workflow (${raw}) - wskaż nazwę joba albo kroku`,
    };
  }
  const lines = ctx.lineCount(resolved.file);
  const last = Number(to ?? from);
  if (lines !== null && last > lines) {
    return { kind: "line-range", detail: `${raw}: plik ${resolved.file} ma ${lines} linii` };
  }
  return null;
}

export function findDocReferenceProblems(
  doc: string,
  text: string,
  ctx: DocReferenceContext,
): DocReferenceProblem[] {
  const problems: DocReferenceProblem[] = [];
  const push = (
    line: number,
    ref: string,
    issue: { kind: DocReferenceKind; detail: string } | null,
  ): void => {
    if (issue) problems.push({ doc, line, ref, ...issue });
  };
  let fenced = false;
  text.split("\n").forEach((content, index) => {
    const line = index + 1;
    if (/^\s*```/.test(content)) {
      fenced = !fenced;
      return;
    }
    // Blok kodu: polecenia `bun run` (komentarze powłoki pomijamy).
    if (fenced) {
      const command = content.replace(/(^|\s)#.*$/, "");
      for (const match of command.matchAll(BUN_RUN))
        push(line, match[0], checkBunRun(match[1]!, ctx));
      return;
    }
    for (const span of content.matchAll(/`([^`]+)`/g)) {
      const inner = span[1]!;
      const commands = [...inner.matchAll(BUN_RUN)];
      for (const match of commands) push(line, match[0], checkBunRun(match[1]!, ctx));
      if (commands.length === 0) push(line, inner, checkInlineRef(inner, ctx));
    }
  });
  return problems;
}

export function formatDocReferenceProblem(problem: DocReferenceProblem): string {
  return `${problem.doc}:${problem.line} [${problem.kind}] ${problem.detail}`;
}
