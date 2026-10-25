// @vitest-environment node
//
// Dokumenty wdrożenia migracji: docs/RUNBOOK_MIGRACJE_LOVABLE.md (dla ludzi)
// i docs/LOVABLE_WIEDZA_PROJEKTU.md (wiedza projektu, którą właściciel wkleja
// agentowi Lovable) cytują narzędzia repozytorium, a komunikaty bramek
// i generatora lustra odsyłają do sekcji runbooka po numerze.
//
// DLACZEGO TEST. Literówka w dokumencie nie czerwieni żadnej bramki, a myli
// wdrożenie, które dzieje się raz i na produkcji: agent uruchamia skrypt,
// którego nie ma, czeka na status, którego zapytanie `migrations:deploy-sql`
// nigdy nie zwróci, albo tworzy wyzwalacz, którego bramka pasów nie rozpozna
// (main czerwony zaraz po wdrożeniu). Przenumerowanie runbooka zostawia martwe
// odsyłacze w komunikatach CI. Dlatego test porównuje dokumenty z eksportami
// kodu, a nie z napisami przepisanymi ręcznie do testu.
//
// Wyszukiwanie odwołań siedzi w małych funkcjach z własnymi przypadkami
// (trafienie i pudło), żeby zielony wynik na prawdziwych dokumentach nie brał
// się z wyrażenia, które niczego nie łapie.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEPLOY_SQL_USAGE, PENDING_STATUS, VERIFY_PROBLEM } from "@/lib/ci/migrationDeploySql";
import { IMMUTABILITY_BASE_ENV } from "@/lib/ci/migrationImmutability";
import {
  DEPLOY_TRIGGER_SQL,
  DEPLOY_TRIGGER_TAG,
  JOURNAL_FREEZE_IDX,
} from "@/lib/ci/migrationLaneParity";
import { JOURNAL_CONFLICT_FIX, deployLine } from "@/lib/migrations/drizzleMirror";
import { MIRROR_USAGE } from "@/lib/migrations/drizzleMirrorCli";

const RUNBOOK_PATH = "docs/RUNBOOK_MIGRACJE_LOVABLE.md";
const KNOWLEDGE_PATH = "docs/LOVABLE_WIEDZA_PROJEKTU.md";
const RUNBOOK_NAME = "RUNBOOK_MIGRACJE_LOVABLE.md";
const THIS_FILE = "src/lib/ci/__tests__/lovableDeployDocs.test.ts";
/** Limit wiedzy projektu Lovable (docs.lovable.dev/features/knowledge). */
const KNOWLEDGE_MAX_CHARS = 10_000;
/** Kod, który może cytować runbook; `docs/` czytamy osobno (tylko odwołania wprost). */
const CODE_ROOTS = ["src", "scripts"];
const CODE_EXT = /\.(?:ts|tsx|mjs|cjs|js|sh)$/;
/** Dokumenty spoza `docs/`, które odsyłają do runbooka. */
const OTHER_DOCS = ["AGENTS.md", "README.md", "supabase/tests/README.md"];

/**
 * Tematy, które oba dokumenty muszą omawiać (decyzje właściciela z PR przełączenia),
 * z napisami, bez których temat jest pominięty.
 */
const REQUIRED_TOPICS: readonly (readonly [string, readonly string[]])[] = [
  [
    "korekta profiles.discoverable po wpisie 0001 (migracje 20261025090020 i 20261025090030)",
    ["profiles.discoverable", "20261025090020", "20261025090030"],
  ],
  [
    "bramka niezmienności plików migracji i jej rejestr wyjątków",
    ["check:migration-immutability", "MIGRATION_EDIT_ALLOWLIST"],
  ],
  [
    "post-deploy czyta ZMIENNE repozytorium, nie sekrety o tych nazwach",
    ["ZMIENNE repozytorium", "SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_URL"],
  ],
  [
    "22 pliki appliedOutOfBand: osobny PR po zapytaniu weryfikacyjnym tylko do odczytu",
    ["appliedOutOfBand", "weryfikacyjn", "tylko do odczytu"],
  ],
  ["drizzle/ zostaje na czas Lovable Cloud (runbook §8)", ["dopóki baza jest na Lovable Cloud"]],
];

const read = (path: string): string => readFileSync(path, "utf8");
const RUNBOOK = read(RUNBOOK_PATH);
const KNOWLEDGE = read(KNOWLEDGE_PATH);
const DOCS = [
  [RUNBOOK_PATH, RUNBOOK],
  [KNOWLEDGE_PATH, KNOWLEDGE],
] as const;

/** Cele `bun run <cel>`: nazwa skryptu z package.json albo ścieżka pliku (z `/`). */
function bunRunTargets(text: string): string[] {
  return [...text.matchAll(/\bbun run ([^\s`'"„”,;()]+)/g)].map((m) => m[1]!.replace(/[.:]+$/, ""));
}

/** Cele `bun run`, których nie ma (bez powtórzeń): skrypt spoza `scripts` albo nieistniejący plik. */
function missingBunRunTargets(text: string, scripts: Readonly<Record<string, string>>): string[] {
  const missing = bunRunTargets(text).filter((target) =>
    target.includes("/") ? !existsSync(target) : !Object.hasOwn(scripts, target),
  );
  return [...new Set(missing)];
}

/**
 * Wystąpienia `quote` ze słowami rozdzielonymi czymś innym niż jedna spacja (np. końcem
 * linii) - cytat, który przestał być dosłowny i nie da się go już porównać ze statusem.
 */
function brokenQuotes(text: string, quote: string): string[] {
  const words = quote.split(" ").map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return [...text.matchAll(new RegExp(words.join("\\s+"), "g"))]
    .map(([found]) => found)
    .filter((found) => found !== quote);
}

/** Numery sekcji runbooka z nagłówków `## N. ...` i `### N.M ...`. */
function sectionNumbers(markdown: string): Set<string> {
  return new Set([...markdown.matchAll(/^#{2,4} (\d+(?:\.\d+)*)\.? /gm)].map((m) => m[1]!));
}

const SECTION_REF = /§(\d+(?:\.\d+)*)/g;

/** Każde `§N` - w runbooku, wiedzy i w kodzie, który cytuje runbook, `§` znaczy sekcję runbooka. */
function anySectionRefs(text: string): string[] {
  return [...text.matchAll(SECTION_REF)].map((m) => m[1]!);
}

/** Odwołanie wprost: `RUNBOOK_MIGRACJE_LOVABLE.md §N` (także z backtickiem albo nawiasem przed `§`). */
function explicitRunbookRefs(text: string): string[] {
  return [...text.matchAll(/RUNBOOK_MIGRACJE_LOVABLE\.md`?[ (]*§(\d+(?:\.\d+)*)/g)].map(
    (m) => m[1]!,
  );
}

/** Wartości podstawiane za placeholdery w szablonach nazw wyzwalacza. */
const TRIGGER_PLACEHOLDERS: Readonly<Record<string, string>> = {
  "<NR_PR>": "540",
  "<NR>": "540",
  "<YYYYMMDD>": "20261101",
};

/**
 * Nazwy wyzwalacza z tekstu, po podstawieniu placeholderów, jako tag dziennika:
 * `pr<NR_PR>_deployment_completion` -> `0403_pr540_deployment_completion`
 * (prefiks `NNNN_` albo jego brak -> `0403_`). Nieznany placeholder zostaje, więc
 * tag nie przejdzie `DEPLOY_TRIGGER_TAG`.
 */
function triggerTags(text: string): { readonly written: string; readonly tag: string }[] {
  return [...text.matchAll(/[\w<>]*_deployment_completion\b/g)].map(([written]) => {
    const name = written.replace(/<[A-Z_]+>/g, (ph) => TRIGGER_PLACEHOLDERS[ph] ?? ph);
    const tag = /^\d{4,}_/.test(name) ? name : `0403_${name.replace(/^NNNN_/, "")}`;
    return { written, tag };
  });
}

/** Pliki kodu pod `root` (rekurencyjnie, bez node_modules). */
function codeFiles(root: string): string[] {
  return readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((rel) => CODE_EXT.test(rel) && !rel.split(/[\\/]/).includes("node_modules"))
    .map((rel) => join(root, rel).replaceAll("\\", "/"));
}

describe("funkcje pomocnicze testu: wyszukiwanie odwołań", () => {
  it("bunRunTargets zbiera skrypty i ścieżki, pomija bun install, zdejmuje końcową interpunkcję", () => {
    const text = [
      "`bun run migrations:mirror --check`, potem bun run check:migration-lanes.",
      "bun run migrations:deploy-sql -- --pending --from 399",
      "`bun run scripts/split-migration.ts supabase/migrations/<plik>.sql`",
      "najpierw bun install",
    ].join("\n");
    expect(bunRunTargets(text)).toEqual([
      "migrations:mirror",
      "check:migration-lanes",
      "migrations:deploy-sql",
      "scripts/split-migration.ts",
    ]);
  });

  it("missingBunRunTargets zgłasza nieznany skrypt i nieistniejący plik", () => {
    const scripts = { "check:migration-lanes": "bun run scripts/check-migration-lanes.ts" };
    const text =
      "bun run check:migration-lanes; bun run check:drizzle-registry; bun run scripts/nie-ma-mnie.ts; bun run scripts/split-migration.ts; bun run check:drizzle-registry";
    expect(missingBunRunTargets(text, scripts)).toEqual([
      "check:drizzle-registry",
      "scripts/nie-ma-mnie.ts",
    ]);
  });

  it("sectionNumbers czyta numery z nagłówków ## i ###, pomija nagłówki bez numeru", () => {
    const md =
      "# Tytuł\n\n## 4. Wdrożenie\n\n### 4.2 Polecenie\n\n## Wdrożenie bazy\n\n#### 6.3.1 Szczegół\n";
    expect([...sectionNumbers(md)]).toEqual(["4", "4.2", "6.3.1"]);
  });

  it("explicitRunbookRefs łapie odwołania wprost do runbooka migracji, nie do innych dokumentów", () => {
    const text = [
      "docs/RUNBOOK_MIGRACJE_LOVABLE.md §6.3.",
      "`docs/RUNBOOK_MIGRACJE_LOVABLE.md` §4.2",
      "docs/RUNBOOK_MIGRACJE_LOVABLE.md (§3.1 sekcja PR, §4 wdrożenie)",
      "docs/RUNBOOK_HUB_PRZYCHOD_LEJEK.md §7.3, runbook §8.2",
    ].join("\n");
    expect(explicitRunbookRefs(text)).toEqual(["6.3", "4.2", "3.1"]);
    expect(anySectionRefs("§5, §6.3. i (§4)")).toEqual(["5", "6.3", "4"]);
  });

  it("brokenQuotes znajduje cytat złamany między liniami, pomija dosłowny", () => {
    const text = "nie ma „INNY HASH W\n   REJESTRZE”, a tu jest „INNY HASH W REJESTRZE”.";
    expect(brokenQuotes(text, "INNY HASH W REJESTRZE")).toEqual(["INNY HASH W\n   REJESTRZE"]);
    expect(brokenQuotes("POMINIETY: when nie wiekszy", "POMINIETY: when nie wiekszy")).toEqual([]);
  });

  it("triggerTags podstawia placeholdery; zła nazwa nie przechodzi DEPLOY_TRIGGER_TAG", () => {
    const tags = triggerTags(
      "`pr<NR_PR>_deployment_completion`, `NNNN_pr<NR>_deployment_completion.sql`, `lovable_<YYYYMMDD>_deployment_completion`, `0329_pr520_deployment_completion`, `deploy_<NR>_deployment_completion`, `pr<NUMER>_deployment_completion`",
    ).map((t) => t.tag);
    expect(tags).toEqual([
      "0403_pr540_deployment_completion",
      "0403_pr540_deployment_completion",
      "0403_lovable_20261101_deployment_completion",
      "0329_pr520_deployment_completion",
      "0403_deploy_540_deployment_completion",
      "0403_pr<NUMER>_deployment_completion",
    ]);
    expect(tags.map((tag) => DEPLOY_TRIGGER_TAG.test(tag))).toEqual([
      true,
      true,
      true,
      true,
      false,
      false,
    ]);
  });
});

describe("docs/LOVABLE_WIEDZA_PROJEKTU.md - wiedza projektu Lovable", () => {
  it(`mieści się w limicie wiedzy projektu (${KNOWLEDGE_MAX_CHARS} znaków)`, () => {
    // Długość w jednostkach UTF-16: dla tekstu bez znaków spoza BMP równa liczbie
    // znaków, a nigdy od niej mniejsza - więc limit nie jest zaniżony.
    expect(KNOWLEDGE.length).toBeLessThanOrEqual(KNOWLEDGE_MAX_CHARS);
  });
});

describe.each(DOCS)("%s - zgodność z narzędziami", (_path, text) => {
  it("cytuje kanoniczny wyzwalacz wdrożenia dosłownie (DEPLOY_TRIGGER_SQL)", () => {
    expect(text).toContain(DEPLOY_TRIGGER_SQL);
  });

  it("każda nazwa wyzwalacza, po podstawieniu placeholderów, przechodzi DEPLOY_TRIGGER_TAG", () => {
    const found = triggerTags(text);
    expect(found.filter((t) => !DEPLOY_TRIGGER_TAG.test(t.tag))).toEqual([]);
    expect(found.map((t) => t.written)).toEqual(
      expect.arrayContaining([
        "pr<NR_PR>_deployment_completion",
        "lovable_<YYYYMMDD>_deployment_completion",
      ]),
    );
  });

  it("cytuje dosłownie każdy status zapytań migrations:deploy-sql, każde wystąpienie w jednej linii", () => {
    const statuses = [...Object.values(PENDING_STATUS), ...Object.values(VERIFY_PROBLEM)];
    expect(statuses.filter((status) => !text.includes(status))).toEqual([]);
    expect(statuses.flatMap((status) => brokenQuotes(text, status))).toEqual([]);
  });

  it("każde `bun run <cel>` wskazuje skrypt z package.json albo istniejący plik", () => {
    const { scripts } = JSON.parse(read("package.json")) as {
      scripts: Readonly<Record<string, string>>;
    };
    expect(bunRunTargets(text).length).toBeGreaterThan(5);
    expect(missingBunRunTargets(text, scripts)).toEqual([]);
  });

  it("nie zawiera półpauzy ani pauzy (U+2013, U+2014) - w dokumentach repo myślnik to „-”", () => {
    expect(text.match(/[\u2013\u2014]/g) ?? []).toEqual([]);
  });

  it("zakazuje ręcznych zapisów w obu rejestrach migracji", () => {
    expect(text).toContain(
      "Nie zapisuj niczego do drizzle.__drizzle_migrations ani do supabase_migrations.schema_migrations",
    );
  });

  it(`podaje granicę historii dziennika zgodną z JOURNAL_FREEZE_IDX (${JOURNAL_FREEZE_IDX})`, () => {
    expect(text).toContain(`0000-${String(JOURNAL_FREEZE_IDX).padStart(4, "0")}`);
  });

  it.each(REQUIRED_TOPICS)("omawia: %s", (_topic, needles) => {
    expect(needles.filter((needle) => !text.includes(needle))).toEqual([]);
  });
});

describe("docs/RUNBOOK_MIGRACJE_LOVABLE.md - zgodność z kodem", () => {
  const sections = sectionNumbers(RUNBOOK);

  it("ma sekcje, do których odsyłają komunikaty bramek i generatora", () => {
    expect([...sections]).toEqual(expect.arrayContaining(["3.1", "4", "4.2", "5", "6.3", "6.4"]));
  });

  it("każde odwołanie §N do runbooka (runbook, wiedza, kod, dokumenty) wskazuje istniejącą sekcję", () => {
    const refs: { readonly from: string; readonly section: string }[] = [];
    const add = (from: string, found: readonly string[]): void => {
      for (const section of found) refs.push({ from, section });
    };
    add(RUNBOOK_PATH, anySectionRefs(RUNBOOK));
    add(KNOWLEDGE_PATH, anySectionRefs(KNOWLEDGE));
    for (const file of CODE_ROOTS.flatMap(codeFiles)) {
      if (file === THIS_FILE) continue;
      const text = read(file);
      if (text.includes(RUNBOOK_NAME)) add(file, anySectionRefs(text));
    }
    const docs = readdirSync("docs")
      .filter((name) => name.endsWith(".md"))
      .map((name) => `docs/${name}`)
      .filter((file) => file !== RUNBOOK_PATH && file !== KNOWLEDGE_PATH);
    for (const file of [...docs, ...OTHER_DOCS]) add(file, explicitRunbookRefs(read(file)));

    const fromCode = refs.filter((r) => r.from.startsWith("src/lib/")).map((r) => r.section);
    expect(fromCode).toEqual(expect.arrayContaining(["3.1", "4.2", "5", "6.3"]));
    expect(
      refs.filter((r) => !sections.has(r.section)).map((r) => `${r.from}: §${r.section}`),
    ).toEqual([]);
  });

  it("synopsy poleceń są takie, jak drukują CLI generatora i pomocnika wdrożenia", () => {
    const synopsis = (usage: string): string => usage.split("\n")[0]!.replace(/^U[żz]ycie: /, "");
    expect(RUNBOOK).toContain(synopsis(MIRROR_USAGE));
    expect(RUNBOOK).toContain(synopsis(DEPLOY_SQL_USAGE));
  });

  it("szablon sekcji „Wdrożenie bazy” zaczyna się linią, którą wypisuje generator", () => {
    const prefix = deployLine([{ idx: 399, tag: "0399_x" }]).split("399")[0]!;
    expect(prefix).toMatch(/idx $/);
    expect(RUNBOOK).toContain(`- ${prefix}<OD>-<DO> (<tag>, ...)`);
  });

  it("cytuje przepis na konflikt dziennika dosłownie, jak generator i bramka", () => {
    expect(RUNBOOK).toContain(JOURNAL_CONFLICT_FIX);
  });

  it("nazywa zmienną bazy porównania bramki niezmienności i wartość JOURNAL_FREEZE_IDX", () => {
    expect(RUNBOOK).toContain(`\`${IMMUTABILITY_BASE_ENV}\``);
    expect(RUNBOOK).toContain(`\`JOURNAL_FREEZE_IDX\` = ${JOURNAL_FREEZE_IDX}`);
  });
});

describe("AGENTS.md", () => {
  // AGENTS.md czyta każdy agent (także Lovable bez wklejonej wiedzy projektu), więc to jedyny
  // pewny kanał zasady wdrożenia: przekazanie SQL-a migracji narzędziu Lovable (dawna faza A)
  // wykonałoby go drugi raz w tej samej partii.
  const agents = read("AGENTS.md");

  it("reguła migracji wskazuje generator lustra (migrations:mirror)", () => {
    expect(agents).toContain("migrations:mirror");
  });

  it("wdrożenie = jedno wywołanie narzędzia Lovable z kanonicznym wyzwalaczem, nigdy z SQL-em migracji", () => {
    expect(agents).toContain(`\`${DEPLOY_TRIGGER_SQL}\``);
    expect(agents).toContain("never the migration SQL itself");
    expect(agents).toContain("migrations:deploy-sql --pending");
  });

  it("adopcja wpisów bota odsyła do runbooka §5 i wyklucza wpisy szkodliwe i wyzwalacze", () => {
    expect(agents).toContain("RUNBOOK_MIGRACJE_LOVABLE.md` §5");
    expect(agents).toContain("never 0001-like harmful entries");
  });
});
