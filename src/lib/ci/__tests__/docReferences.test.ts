// @vitest-environment node
//
// Żywe dokumenty odwołują się wyłącznie do istniejących poleceń i plików
// (audyt ED14: procedura przejęcia utrzymania i źródło prawdy SLA kazały
// uruchamiać skrypty usunięte w c3f0c0e72). Logika: src/lib/ci/docReferences.ts.
import { existsSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  type DocReferenceContext,
  findDocReferenceProblems,
  formatDocReferenceProblem,
} from "../docReferences";

/**
 * Dokumenty, według których ktoś DZIAŁA (procedury, umowa, architektura,
 * instrukcje agentów). Raporty z datą w nazwie to zapis historyczny - mogą
 * cytować stan z dnia pomiaru i tu ich nie ma.
 */
const LIVING_DOCS = [
  "AGENTS.md",
  "README.md",
  "governance/README.md",
  "docs/ARCHITECTURE.md",
  "docs/SEO.md",
  "docs/UMOWA_UTRZYMANIOWA.md",
  "docs/RUNBOOK_CIAGLOSC_WYKONAWCY.md",
  "docs/RUNBOOK_COMMUNITY.md",
  "docs/RUNBOOK_HUB_PRZYCHOD_LEJEK.md",
  "docs/RUNBOOK_MIGRACJE_LOVABLE.md",
] as const;

function fixture(
  files: Record<string, number | "dir">,
  scripts: readonly string[],
): DocReferenceContext {
  return {
    scripts: new Set(scripts),
    exists: (path) => path.replace(/\/$/, "") in files,
    lineCount: (path) => {
      const entry = files[path];
      return typeof entry === "number" ? entry : null;
    },
  };
}

describe("findDocReferenceProblems", () => {
  const ctx = fixture(
    {
      "scripts/generate-codeowners.ts": 80,
      ".github/workflows/ci.yml": 528,
      ".github/workflows/scheduler.yml": 290,
      "src/lib/stripe.server.ts": 40,
      "supabase/migrations": "dir",
      "package.json": 220,
    },
    ["test", "generate:codeowners", "check:sql-tenant-scope"],
  );
  const kinds = (text: string): string[] =>
    findDocReferenceProblems("doc.md", text, ctx).map(
      (problem) => `${problem.kind}:${problem.ref}`,
    );

  it("usunięty skrypt w kodzie inline i w bloku kodu", () => {
    expect(kinds("Egzekwowany przez `bun run check:ownership`.")).toEqual([
      "script:bun run check:ownership",
    ]);
    expect(
      kinds(
        "```bash\nbun install\nbun run check:workflow-env-contract   # komentarz\nbun run test\n```",
      ),
    ).toEqual(["script:bun run check:workflow-env-contract"]);
  });

  it("istniejące skrypty i pliki uruchamiane przez `bun run` przechodzą", () => {
    expect(
      kinds("`bun run generate:codeowners` i `bun run scripts/generate-codeowners.ts --check`"),
    ).toEqual([]);
    expect(kinds("`bun run scripts/check-ownership.ts`")).toEqual([
      "file:bun run scripts/check-ownership.ts",
    ]);
  });

  it("komentarz powłoki w bloku kodu nie jest poleceniem", () => {
    expect(kinds("```bash\nbun run test # dawniej: bun run check:ownership\n```")).toEqual([]);
  });

  it("brakująca ścieżka repo i linia poza plikiem", () => {
    expect(kinds("`src/lib/ci/workflowEnvContract.ts:37-49`")).toEqual([
      "path:src/lib/ci/workflowEnvContract.ts:37-49",
    ]);
    expect(kinds("`src/lib/stripe.server.ts:14` i `src/lib/stripe.server.ts:41-45`")).toEqual([
      "line-range:src/lib/stripe.server.ts:41-45",
    ]);
  });

  it("lista zakresów: sprawdzany jest KAŻDY zakres, nie tylko pierwszy", () => {
    expect(kinds("`src/lib/stripe.server.ts:1-3,10,38-40`")).toEqual([]);
    expect(kinds("`src/lib/stripe.server.ts:1-3,10,66-76`")).toEqual([
      "line-range:src/lib/stripe.server.ts:1-3,10,66-76",
    ]);
    expect(kinds("`src/lib/stripe.server.ts:14,41`")).toEqual([
      "line-range:src/lib/stripe.server.ts:14,41",
    ]);
  });

  it("numer linii workflow jest zakazany - także w zakresie pliku i pod gołą nazwą", () => {
    expect(kinds("`ci.yml:131` oraz `.github/workflows/scheduler.yml:94`")).toEqual([
      "workflow-line:ci.yml:131",
      "workflow-line:.github/workflows/scheduler.yml:94",
    ]);
    expect(kinds("`.github/workflows/ci.yml` (job `pgtap`)")).toEqual([]);
  });

  it("wzorce, skróty i nieznane gołe nazwy nie są odwołaniami do pliku", () => {
    expect(
      kinds(
        "`supabase/migrations/*.sql`, `supabase/migrations/…`, `src/{a,b}.ts`, `provider.server.ts:178`, `<plik>.sql`",
      ),
    ).toEqual([]);
  });
});

describe("żywe dokumenty - odwołania do poleceń i plików", () => {
  const scripts = new Set(
    Object.keys((JSON.parse(readFileSync("package.json", "utf8")) as { scripts: object }).scripts),
  );
  const ctx: DocReferenceContext = {
    scripts,
    exists: (path) => existsSync(path),
    lineCount: (path) =>
      existsSync(path) && statSync(path).isFile()
        ? readFileSync(path, "utf8").replace(/\n$/, "").split("\n").length
        : null,
  };

  it.each(LIVING_DOCS)("%s", (doc) => {
    const problems = findDocReferenceProblems(doc, readFileSync(doc, "utf8"), ctx);
    expect(problems.map(formatDocReferenceProblem)).toEqual([]);
  });
});
