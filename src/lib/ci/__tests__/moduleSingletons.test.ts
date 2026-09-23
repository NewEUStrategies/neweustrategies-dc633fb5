// BRAMKA ZALEŻNOŚCI: pakiety ze stanem modułu mają w `bun.lock` jedną kopię.
//
// CO TEN PLIK DOWODZI.
//   1. ODCZYT PLIKU BLOKADY jest wierny formatowi, w którym bun go zapisuje:
//      przecinki na końcu list i obiektów, nazwy z zakresu (`@radix-ui/…`)
//      i wersje będące adresem (`xlsx@https://…`).
//   2. DRUGA KOPIA PILNOWANEGO PAKIETU ZAPALA BRAMKĘ także wtedy, gdy ma TĘ
//      SAMĄ wersję - dwie ścieżki w `node_modules` to dwie kopie stanu.
//   3. DUPLIKATY BEZ STANU NIE ZAPALAJĄ BRAMKI. `react-is` pod `pretty-format`
//      czy `@babel/parser` pod narzędziem tras to czyste funkcje - bramka,
//      która krzyczy na wszystko, przestaje być czytana.
//   4. WYJĄTEK DZIAŁA TYLKO DLA SWOJEJ ŚCIEŻKI i przestarzały wyjątek jest
//      błędem: lista może się tylko kurczyć.
//   5. PRAWDZIWY `bun.lock` REPOZYTORIUM spełnia inwariant. Ten przypadek
//      jest tu celowo - bramka biegnie w CI jako osobny krok, a test pilnuje
//      tego samego przy każdym `vitest run`.
//
// SKĄD TA BRAMKA. Dwa incydenty z 2026-09-22 (PR #389, PR #390) - opis
// w nagłówku `src/lib/ci/moduleSingletons.ts`.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  DUPLICATE_ALLOWLIST,
  findSingletonDuplicates,
  lockPackages,
  parseLockfileJson,
  renderSingletonReport,
  ruleFor,
  singletonCheckFailed,
  splitSpec,
  type LockPackage,
} from "@/lib/ci/moduleSingletons";

/** Minimalny `bun.lock` w formacie, w jakim zapisuje go bun (przecinki na końcu). */
function lockfile(packages: Record<string, string>): string {
  const rows = Object.entries(packages)
    .map(([path, spec]) => `    "${path}": ["${spec}", "", {}, "sha512-x"],`)
    .join("\n");
  return `{\n  "lockfileVersion": 1,\n  "workspaces": {\n    "": {\n      "name": "app",\n    },\n  },\n  "packages": {\n${rows}\n  }\n}\n`;
}

function pkg(path: string, version: string): LockPackage {
  const segments = path.split("/");
  const tail = segments.at(-1) ?? path;
  const scope = segments.at(-2);
  const name = scope !== undefined && scope.startsWith("@") ? `${scope}/${tail}` : tail;
  return { path, name, version };
}

describe("odczyt pliku blokady", () => {
  it("przecinki na końcu obiektów i list nie przeszkadzają", () => {
    expect(parseLockfileJson('{ "a": [1, 2, ], "b": { "c": true, }, }')).toEqual({
      a: [1, 2],
      b: { c: true },
    });
  });

  it("przecinek przed nawiasem WEWNĄTRZ napisu zostaje nietknięty", () => {
    expect(parseLockfileJson('{ "bin": "a,]b,}", }')).toEqual({ bin: "a,]b,}" });
  });

  it("cudzysłów poprzedzony ukośnikiem nie kończy napisu", () => {
    expect(parseLockfileJson('{ "s": "x\\",]", }')).toEqual({ s: 'x",]' });
  });

  it("nazwa z zakresu i wersja-adres rozdzielają się na pierwszej małpie po nazwie", () => {
    expect(splitSpec("@radix-ui/react-dialog@1.1.23")).toEqual({
      name: "@radix-ui/react-dialog",
      version: "1.1.23",
    });
    expect(splitSpec("xlsx@https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz")).toEqual({
      name: "xlsx",
      version: "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz",
    });
  });

  it("specyfikacja bez wersji oddaje samą nazwę", () => {
    expect(splitSpec("app")).toEqual({ name: "app", version: "" });
  });

  it("każda ścieżka instalacji staje się osobnym wpisem z nazwą i wersją", () => {
    const text = lockfile({
      "prosemirror-view": "prosemirror-view@1.42.4",
      "prosemirror-tables/prosemirror-view": "prosemirror-view@1.41.8",
      "@radix-ui/react-dialog": "@radix-ui/react-dialog@1.1.23",
    });

    expect(lockPackages(text)).toEqual([
      { path: "prosemirror-view", name: "prosemirror-view", version: "1.42.4" },
      {
        path: "prosemirror-tables/prosemirror-view",
        name: "prosemirror-view",
        version: "1.41.8",
      },
      { path: "@radix-ui/react-dialog", name: "@radix-ui/react-dialog", version: "1.1.23" },
    ]);
  });

  it("plik bez sekcji `packages` jest błędem formatu, a nie cichym „zero duplikatów”", () => {
    expect(() => lockPackages('{ "lockfileVersion": 1 }')).toThrow(/packages/);
  });

  it("wpis o nieznanym kształcie jest pomijany zamiast wywracać odczyt", () => {
    expect(lockPackages('{ "packages": { "a": "zły", "b": ["b@1.0.0"] } }')).toEqual([
      { path: "b", name: "b", version: "1.0.0" },
    ]);
  });
});

describe("które pakiety są pilnowane", () => {
  it("zakres z gwiazdką łapie każdy pakiet zakresu", () => {
    expect(ruleFor("@radix-ui/react-dismissable-layer")?.match).toBe("@radix-ui/*");
    expect(ruleFor("@tiptap/pm")?.match).toBe("@tiptap/*");
  });

  it("nazwa dokładna NIE łapie pakietów o wspólnym przedrostku", () => {
    expect(ruleFor("react")?.match).toBe("react");
    expect(ruleFor("react-is")).toBeUndefined();
    expect(ruleFor("react-dom")?.match).toBe("react-dom");
  });

  it("czyste funkcje bez stanu modułu nie są pilnowane", () => {
    expect(ruleFor("@babel/parser")).toBeUndefined();
    expect(ruleFor("@babel/types")).toBeUndefined();
  });
});

describe("wykrywanie drugiej kopii", () => {
  it("jedna kopia każdego pakietu - bramka zielona", () => {
    const report = findSingletonDuplicates(
      [pkg("prosemirror-view", "1.42.4"), pkg("react", "19.2.0")],
      undefined,
      [],
    );

    expect(singletonCheckFailed(report)).toBe(false);
    expect(renderSingletonReport(report)).toMatch(/OK/);
  });

  it("zagnieżdżona kopia pilnowanego pakietu zapala bramkę i jest nazwana w komunikacie", () => {
    const report = findSingletonDuplicates(
      [
        pkg("prosemirror-view", "1.42.4"),
        pkg("prosemirror-tables/prosemirror-view", "1.41.8"),
        pkg("prosemirror-gapcursor/prosemirror-view", "1.41.8"),
      ],
      undefined,
      [],
    );

    expect(singletonCheckFailed(report)).toBe(true);
    expect(report.duplicates).toHaveLength(1);
    expect(report.duplicates[0]?.copies.map((copy) => copy.path)).toEqual([
      "prosemirror-gapcursor/prosemirror-view",
      "prosemirror-tables/prosemirror-view",
      "prosemirror-view",
    ]);
    const text = renderSingletonReport(report);
    expect(text).toMatch(/prosemirror-view - `DecorationGroup.from`/);
    expect(text).toMatch(/1\.41\.8\s+prosemirror-tables\/prosemirror-view/);
    expect(text).toMatch(/JAK NAPRAWIĆ/);
  });

  it("druga kopia w TEJ SAMEJ wersji też jest drugą kopią stanu", () => {
    const report = findSingletonDuplicates(
      [
        pkg("@radix-ui/react-focus-scope", "1.1.8"),
        pkg("@radix-ui/react-dialog/@radix-ui/react-focus-scope", "1.1.8"),
      ],
      undefined,
      [],
    );

    expect(report.duplicates.map((dup) => dup.name)).toEqual(["@radix-ui/react-focus-scope"]);
  });

  it("dwie zagnieżdżone kopie bez kopii na górze drzewa też są duplikatem", () => {
    const report = findSingletonDuplicates(
      [pkg("a/@babel/traverse", "7.29.0"), pkg("b/@babel/traverse", "7.29.8")],
      undefined,
      [],
    );

    expect(report.duplicates.map((dup) => dup.name)).toEqual(["@babel/traverse"]);
  });

  it("duplikaty pakietów bez stanu nie zapalają bramki", () => {
    const report = findSingletonDuplicates(
      [
        pkg("react-is", "16.13.1"),
        pkg("pretty-format/react-is", "17.0.2"),
        pkg("@babel/parser", "7.29.2"),
        pkg("@tanstack/router-utils/@babel/parser", "7.29.9"),
      ],
      undefined,
      [],
    );

    expect(singletonCheckFailed(report)).toBe(false);
  });

  it("duplikaty są uporządkowane po nazwie - komunikat nie skacze między przebiegami", () => {
    const report = findSingletonDuplicates(
      [
        pkg("react", "19.2.0"),
        pkg("x/react", "18.3.1"),
        pkg("i18next", "25.0.0"),
        pkg("y/i18next", "24.0.0"),
      ],
      undefined,
      [],
    );

    expect(report.duplicates.map((dup) => dup.name)).toEqual(["i18next", "react"]);
  });
});

describe("lista wyjątków", () => {
  const copies = [pkg("@babel/core", "7.29.7"), pkg("tool/@babel/core", "7.29.0")];

  it("wyjątek dla zagnieżdżonej ścieżki gasi TEN duplikat", () => {
    const report = findSingletonDuplicates(copies, undefined, [
      { path: "tool/@babel/core", reason: "wyspa narzędzia testowego" },
    ]);

    expect(singletonCheckFailed(report)).toBe(false);
  });

  it("wyjątek dla innej ścieżki niczego nie gasi i sam jest przestarzały", () => {
    const report = findSingletonDuplicates(copies, undefined, [
      { path: "other/@babel/core", reason: "pomyłka" },
    ]);

    expect(report.duplicates.map((dup) => dup.name)).toEqual(["@babel/core"]);
    expect(report.staleAllowlist.map((entry) => entry.path)).toEqual(["other/@babel/core"]);
  });

  it("wyjątek, którego ścieżka zniknęła z pliku blokady, zapala bramkę", () => {
    const report = findSingletonDuplicates([pkg("@babel/core", "7.29.7")], undefined, [
      { path: "tool/@babel/core", reason: "już niepotrzebny" },
    ]);

    expect(singletonCheckFailed(report)).toBe(true);
    expect(renderSingletonReport(report)).toMatch(/nie są już potrzebne[\s\S]*tool\/@babel\/core/);
  });
});

describe("prawdziwy bun.lock repozytorium", () => {
  const lockText = readFileSync(resolve(process.cwd(), "bun.lock"), "utf8");

  it("każdy pilnowany pakiet ma jedną kopię, a lista wyjątków nie ma martwych wpisów", () => {
    const report = findSingletonDuplicates(lockPackages(lockText));

    expect(renderSingletonReport(report)).toMatch(/OK/);
  });

  it("każdy wyjątek ma zapisany powód", () => {
    for (const entry of DUPLICATE_ALLOWLIST) expect(entry.reason.trim()).not.toBe("");
  });

  it("odczyt widzi pakiety, które na pewno są w drzewie - bramka nie mierzy pustki", () => {
    const names = new Set(lockPackages(lockText).map((entry) => entry.name));

    for (const name of ["react", "react-dom", "prosemirror-view", "@tiptap/pm"]) {
      expect(names.has(name)).toBe(true);
    }
  });
});
