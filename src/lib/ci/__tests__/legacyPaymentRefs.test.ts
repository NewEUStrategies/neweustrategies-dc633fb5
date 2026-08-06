// Kontrakt bramki „bez żywych referencji do poprzedniego operatora płatności"
// + jej self-test na REALNYM repozytorium.
//
// Poprzednia wersja bramki (`scripts/check-no-paddle.ts`) skanowała wyłącznie
// `src/` i `scripts/`. Poza jej zasięgiem został `.github/`, gdzie
// `billing-nightly.yml` eksportował `PADDLE_SANDBOX_API_KEY`, podczas gdy sonda
// czytała `STRIPE_SANDBOX_API_KEY`. Nocny przebieg co dobę spał 40 minut i
// kończył się na zielono, nie wykonując ani jednego żądania do operatora.
//
// Ostatni blok testów odtwarza dokładnie tamten plik i sprawdza, że bramka
// dziś go zatrzymuje - a potem, że realne repo jest czyste.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MIGRATION_SCAN_FROM,
  commentSyntaxFor,
  isScannable,
  renderLegacyPaymentRefsReport,
  scanLegacyPaymentRefs,
  scanSource,
  stripComments,
} from "@/lib/ci/legacyPaymentRefs";

const WORKFLOWS_DIR = ".github/workflows";

describe("rozpoznanie składni komentarzy", () => {
  it("mapuje rozszerzenia na właściwą składnię", () => {
    expect(commentSyntaxFor("src/lib/x.ts")).toBe("c-like");
    expect(commentSyntaxFor("src/styles/x.css")).toBe("c-like");
    expect(commentSyntaxFor(".github/workflows/ci.yml")).toBe("hash");
    expect(commentSyntaxFor("supabase/migrations/1_a.sql")).toBe("sql");
    expect(commentSyntaxFor("package.json")).toBe("none");
  });

  it("dla `.env.example` wybiera najdłuższy pasujący sufiks, nie pierwszy z brzegu", () => {
    expect(commentSyntaxFor(".env.example")).toBe("hash");
  });

  it("odrzuca pliki spoza zasięgu bramki", () => {
    expect(commentSyntaxFor("docs/AUDYT.md")).toBeNull();
    expect(commentSyntaxFor("public/logo.svg")).toBeNull();
  });
});

describe("usuwanie komentarzy - składnia C", () => {
  it("wycina komentarz liniowy i blokowy, zostawia kod", () => {
    const lines = stripComments(
      ["// dawniej Paddle", 'const provider = "stripe";', "/* Paddle", "nadal komentarz */"].join(
        "\n",
      ),
      "c-like",
    );
    expect(lines[0].trim()).toBe("");
    expect(lines[1]).toContain("stripe");
    expect(lines[2].trim()).toBe("");
    expect(lines[3].trim()).toBe("");
  });

  it("nie ucina adresu URL na `//`", () => {
    const [line] = stripComments('const url = "https://paddle.example/v1";', "c-like");
    expect(line).toContain("paddle.example");
  });

  it("widzi nazwę w literale, nawet gdy literał zawiera `//`", () => {
    const hits = scanSource("src/x.ts", 'const u = "a//b-paddle";');
    expect(hits).toHaveLength(1);
  });
});

describe("usuwanie komentarzy - składnia hash (YAML, .env)", () => {
  it("wycina komentarz, ale zostawia żywy eksport sekretu", () => {
    const yaml = [
      "# secrets.PADDLE_SANDBOX_API_KEY",
      "env:",
      "  PADDLE_SANDBOX_API_KEY: ${{ secrets.PADDLE_SANDBOX_API_KEY }}",
    ].join("\n");
    const hits = scanSource(".github/workflows/x.yml", yaml);
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(3);
  });

  it("nie traktuje `#` wewnątrz literału ani bez odstępu jako komentarza", () => {
    const [quoted] = stripComments('color: "#paddle"', "hash");
    expect(quoted).toContain("paddle");
    const [glued] = stripComments("tag: v1#paddle", "hash");
    expect(glued).toContain("paddle");
  });

  it("przepuszcza zakomentowaną nazwę zmiennej w .env.example", () => {
    expect(scanSource(".env.example", "# PADDLE_SANDBOX_API_KEY=")).toHaveLength(0);
    expect(scanSource(".env.example", "PADDLE_SANDBOX_API_KEY=abc")).toHaveLength(1);
  });
});

describe("usuwanie komentarzy - SQL i JSON", () => {
  it("wycina `--` i blok, zostawia definicję kolumny", () => {
    const sql = ["-- dawniej paddle", "/* paddle */", "  paddle_subscription_id text,"].join("\n");
    const hits = scanSource("supabase/migrations/20270101000000_x.sql", sql);
    expect(hits).toHaveLength(1);
    expect(hits[0].text).toContain("paddle_subscription_id");
  });

  it("w JSON każdy znak jest kodem - zależność jest żywą referencją", () => {
    const hits = scanSource(
      "package.json",
      '{ "dependencies": { "@paddle/paddle-node-sdk": "^3.8.0" } }',
    );
    expect(hits).toHaveLength(1);
  });
});

describe("zasięg skanu", () => {
  it("pomija pliki, które muszą zawierać wzorzec, żeby działać", () => {
    expect(isScannable("src/lib/ci/legacyPaymentRefs.ts")).toBe(false);
    expect(isScannable("src/lib/ci/__tests__/legacyPaymentRefs.test.ts")).toBe(false);
  });

  it("obejmuje warstwę CI - to była dziura, przez którą przeszedł martwy sekret", () => {
    expect(isScannable(".github/workflows/billing-nightly.yml")).toBe(true);
    expect(isScannable("package.json")).toBe(true);
    expect(isScannable(".env.example")).toBe(true);
  });

  it("zamraża historię migracji i pilnuje wyłącznie nowych plików", () => {
    expect(isScannable("supabase/migrations/20260729072626_initial.sql")).toBe(false);
    expect(isScannable(`supabase/migrations/${MIGRATION_SCAN_FROM}_cleanup.sql`)).toBe(false);
    expect(isScannable("supabase/migrations/20260901120000_nowa.sql")).toBe(true);
  });

  it("nie wchodzi w niemigracyjne pliki Supabase (seed, testy pgTAP)", () => {
    expect(isScannable("supabase/seed.sql")).toBe(false);
    expect(isScannable("supabase/tests/rls.sql")).toBe(false);
  });
});

describe("agregacja i raport", () => {
  it("sortuje trafienia po pliku i wierszu", () => {
    const hits = scanLegacyPaymentRefs([
      { file: "src/b.ts", source: 'const b = "paddle";' },
      { file: "src/a.ts", source: ["const x = 1;", 'const a = "paddle";'].join("\n") },
    ]);
    expect(hits.map((hit) => `${hit.file}:${hit.line}`)).toEqual(["src/a.ts:2", "src/b.ts:1"]);
  });

  it("odsiewa pliki spoza zasięgu jeszcze przed skanem", () => {
    expect(
      scanLegacyPaymentRefs([{ file: "docs/HISTORIA.md", source: "Paddle wszędzie" }]),
    ).toHaveLength(0);
  });

  it("raport sukcesu podaje liczbę plików, raport błędu - konkretną poprawkę", () => {
    expect(renderLegacyPaymentRefsReport([], 512)).toContain("512 plików");
    const failure = renderLegacyPaymentRefsReport(
      [{ file: ".github/workflows/x.yml", line: 3, text: "PADDLE_SANDBOX_API_KEY: x" }],
      1,
    );
    expect(failure).toContain(".github/workflows/x.yml:3");
    expect(failure).toContain("STRIPE_SANDBOX_API_KEY");
  });
});

describe("self-test na realnym repozytorium", () => {
  it("zatrzymuje DOKŁADNIE ten workflow, który przez cały czas przechodził", () => {
    const brokenHeader = [
      "# Konfiguracja (Settings -> Secrets and variables -> Actions):",
      "#   secrets.PADDLE_SANDBOX_API_KEY",
      "jobs:",
      "  renewal:",
      "    env:",
      "      PADDLE_SANDBOX_API_KEY: ${{ secrets.PADDLE_SANDBOX_API_KEY }}",
    ].join("\n");
    const hits = scanLegacyPaymentRefs([
      { file: ".github/workflows/billing-nightly.yml", source: brokenHeader },
    ]);
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(6);
  });

  it("realne workflow są dziś czyste", () => {
    const files = readdirSync(WORKFLOWS_DIR)
      .filter((file) => file.endsWith(".yml") || file.endsWith(".yaml"))
      .map((file) => ({
        file: `${WORKFLOWS_DIR}/${file}`,
        source: readFileSync(join(WORKFLOWS_DIR, file), "utf8"),
      }));
    expect(files.length).toBeGreaterThan(0);
    expect(scanLegacyPaymentRefs(files)).toEqual([]);
  });

  it("realny manifest i kontrakt konfiguracyjny są czyste", () => {
    const files = ["package.json", ".env.example"].map((file) => ({
      file,
      source: readFileSync(file, "utf8"),
    }));
    expect(scanLegacyPaymentRefs(files)).toEqual([]);
  });
});
