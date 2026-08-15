import { describe, expect, it } from "vitest";
import {
  allowedOmissions,
  collectOverlays,
  compareWithRatchet,
  countsByFile,
  findMissingImports,
  flattenLiteralKeys,
  importsSpecifier,
  isOverlayFile,
  isScannable,
  keysOf,
  keysUsed,
  ratchetFailed,
  renderRatchetReport,
  renderReport,
  specifierFor,
  type ScannedSource,
} from "../i18nOverlayImports";

const OVERLAY: ScannedSource = {
  file: "src/lib/i18n-admin-users.ts",
  source: `import i18n from "./i18n";

const pl = {
  adminUsers: {
    inviteUser: "Zaproś użytkownika",
  },
  admin: {
    users: { roles: { user: "Użytkownik" } },
  },
};

const en = {
  adminUsers: { inviteUser: "Invite user" },
  admin: { users: { roles: { user: "User" } } },
};

i18n.addResourceBundle("pl", "translation", pl, true, true);
i18n.addResourceBundle("en", "translation", en, true, true);

export {};
`,
};

/** Rdzeń wnosi całą przestrzeń `admin` - nakładka tylko ją rozszerza. */
const CORE = new Set(["admin.title", "admin.users.delete", "common.save"]);

const consumer = (source: string, file = "src/routes/a.tsx"): ScannedSource => ({ file, source });
const gate = (sources: readonly ScannedSource[], overlays = collectOverlays([OVERLAY])) =>
  findMissingImports({ sources, overlays, coreKeys: CORE });

describe("rozpoznawanie nakładek", () => {
  it("bierze `src/lib/i18n-*.ts`, pomija rdzeń i katalog i18n/", () => {
    expect(isOverlayFile("src/lib/i18n-admin-users.ts")).toBe(true);
    expect(isOverlayFile("src/lib/i18n.ts")).toBe(false);
    expect(isOverlayFile("src/lib/i18n/format.ts")).toBe(false);
  });

  it("buduje specyfikator importu ze ścieżki", () => {
    expect(specifierFor("src/lib/i18n-admin-users.ts")).toBe("@/lib/i18n-admin-users");
  });

  it("spłaszcza drzewo do PEŁNYCH ścieżek liści", () => {
    expect(flattenLiteralKeys('{ a: { b: "x", c: "y" }, d: "z" }')).toEqual(["a.b", "a.c", "d"]);
  });

  it("gałąź pośrednia NIE jest kluczem - inaczej `a` fałszowałoby dopasowanie", () => {
    expect(flattenLiteralKeys('{ a: { b: "x" } }')).not.toContain("a");
  });

  it("czyta klucze z drzewa PL i zatrzymuje się przed drzewem EN", () => {
    expect(keysOf(OVERLAY.source)).toEqual(["adminUsers.inviteUser", "admin.users.roles.user"]);
  });

  it("plik bez drzewa `pl` zgłasza pustą listę zamiast zgadywać", () => {
    expect(keysOf('export const x = { adminUsers: { a: "b" } };')).toEqual([]);
  });

  it("pomija nakładkę, z której nic nie odczytał", () => {
    expect(collectOverlays([{ file: "src/lib/i18n-pusta.ts", source: "export {};" }])).toEqual([]);
  });
});

describe("użycie kluczy", () => {
  it("zbiera pełny klucz stały", () => {
    expect(keysUsed('t("adminUsers.inviteUser")')).toEqual(new Set(["adminUsers.inviteUser"]));
  });

  it("łapie też `i18n.t(...)` - sięga po instancję wprost", () => {
    expect(keysUsed('i18n.t("adminUsers.inviteUser")')).toEqual(new Set(["adminUsers.inviteUser"]));
  });

  it("pomija klucz sklejany - pełnej ścieżki nie da się odczytać statycznie", () => {
    expect(keysUsed("t(`adminUsers.${role}`)").size).toBe(0);
    expect(keysUsed("t(key)").size).toBe(0);
  });

  it("nie liczy własnej dokumentacji - komentarze są maskowane", () => {
    expect(keysUsed('// woła t("adminUsers.x")').size).toBe(0);
  });

  it("nie myli wywołania cudzej funkcji kończącej się na `t`", () => {
    expect(keysUsed('format("adminUsers.x")').size).toBe(0);
    expect(keysUsed('fmt("adminUsers.x")').size).toBe(0);
  });
});

describe("wykrywanie importu", () => {
  it("widzi import efektu ubocznego i import nazwany", () => {
    expect(importsSpecifier('import "@/lib/i18n-admin-users";', "@/lib/i18n-admin-users")).toBe(
      true,
    );
    expect(
      importsSpecifier('import { a } from "@/lib/i18n-admin-users";', "@/lib/i18n-admin-users"),
    ).toBe(true);
  });

  it("nie daje się nabrać na PREFIKS cudzej ścieżki", () => {
    // Gdyby dopasowanie było prefiksowe, brakujący import uznano by za obecny.
    expect(
      importsSpecifier('import "@/lib/i18n-admin-users-extra";', "@/lib/i18n-admin-users"),
    ).toBe(false);
  });

  it("nie liczy importu zaremowanego", () => {
    expect(importsSpecifier('// import "@/lib/i18n-admin-users";', "@/lib/i18n-admin-users")).toBe(
      false,
    );
  });
});

describe("bramka", () => {
  it("OBLEWA wywołanie klucza nakładki bez importu - defekt, który złapał człowiek", () => {
    expect(gate([OVERLAY, consumer('t("adminUsers.inviteUser")')])).toEqual([
      {
        file: "src/routes/a.tsx",
        key: "adminUsers.inviteUser",
        providers: ["@/lib/i18n-admin-users"],
      },
    ]);
  });

  it("przechodzi, gdy import jest obecny", () => {
    const src = 'import "@/lib/i18n-admin-users";\nt("adminUsers.inviteUser")';
    expect(gate([OVERLAY, consumer(src)])).toEqual([]);
  });

  it("NIE rusza kluczy rdzenia - wnosi je `src/lib/i18n.ts`", () => {
    expect(gate([OVERLAY, consumer('t("common.save")')])).toEqual([]);
  });

  it("KLUCZOWY PRZYPADEK: rdzenna przestrzeń rozszerzona przez nakładkę", () => {
    // `admin.users.delete` należy do rdzenia, choć nakładka dopisuje do `admin`
    // gałąź `admin.users.roles.*`. Granulacja przestrzeni uznałaby ten plik za
    // wadliwy i utopiła bramkę w kilkudziesięciu fałszywych trafieniach.
    expect(gate([OVERLAY, consumer('t("admin.users.delete")')])).toEqual([]);
    // …a gałąź wniesiona przez nakładkę nadal wymaga importu.
    expect(gate([OVERLAY, consumer('t("admin.users.roles.user")')])).toHaveLength(1);
  });

  it("klucz spoza rdzenia i spoza nakładek nie jest naszą sprawą", () => {
    expect(gate([OVERLAY, consumer('t("czegos.nie.ma")')])).toEqual([]);
  });

  it("wywołanie po GAŁĘZI (returnObjects) też wymaga importu", () => {
    expect(gate([OVERLAY, consumer('t("admin.users.roles", { returnObjects: true })')])).toEqual([
      {
        file: "src/routes/a.tsx",
        key: "admin.users.roles",
        providers: ["@/lib/i18n-admin-users"],
      },
    ]);
  });

  it("nakładka nie musi importować samej siebie", () => {
    expect(gate([OVERLAY])).toEqual([]);
  });

  it("wystarczy JEDNA z nakładek wnoszących ten klucz", () => {
    const second: ScannedSource = {
      file: "src/lib/i18n-inne.ts",
      source: 'const pl = {\n  adminUsers: { inviteUser: "Zaproś" },\n};\nconst en = {};',
    };
    const overlays = collectOverlays([OVERLAY, second]);
    const src = 'import "@/lib/i18n-inne";\nt("adminUsers.inviteUser")';
    expect(findMissingImports({ sources: [consumer(src)], overlays, coreKeys: CORE })).toEqual([]);
  });

  it("pomija testy i pomocniki testowe", () => {
    expect(isScannable("src/routes/a.tsx")).toBe(true);
    expect(isScannable("src/routes/__tests__/a.test.tsx")).toBe(false);
    expect(isScannable("src/test/i18nReal.ts")).toBe(false);
  });
});

describe("raport", () => {
  it("grupuje po pliku i podaje gotową linijkę naprawy", () => {
    const missing = gate([
      OVERLAY,
      consumer('t("adminUsers.inviteUser");\nt("admin.users.roles.user")'),
    ]);
    const rendered = renderReport(missing, 2);
    expect(rendered).toContain('import "@/lib/i18n-admin-users";');
    expect(rendered).toContain("adminUsers.inviteUser");
    expect(rendered).toContain("renderuje jego identyfikator");
    // Jeden plik = jedna sekcja, mimo dwóch brakujących kluczy.
    expect(rendered.match(/ {2}- src\/routes\/a\.tsx/g)).toHaveLength(1);
  });

  it("czysty stan raportuje liczbę przeskanowanych plików", () => {
    expect(renderReport([], 7)).toContain("7 plików");
  });
});

describe("dyrektywa świadomego pominięcia", () => {
  it("czyta specyfikator z komentarza - dyrektywa MUSI przetrwać maskowanie", () => {
    const src = "// i18n-overlay-imports: pomijamy @/lib/i18n-builder (waga chunka)";
    expect(allowedOmissions(src)).toEqual(new Set(["@/lib/i18n-builder"]));
  });

  it("plik z dyrektywą wypada z raportu, choć importu nie ma", () => {
    const src = [
      "// i18n-overlay-imports: pomijamy @/lib/i18n-admin-users (waga chunka)",
      't("adminUsers.inviteUser")',
    ].join("\n");
    expect(gate([OVERLAY, consumer(src)])).toEqual([]);
  });

  it("dyrektywa na CUDZY specyfikator nie zwalnia z tego, o który pyta bramka", () => {
    const src = [
      "// i18n-overlay-imports: pomijamy @/lib/i18n-builder (inna nakładka)",
      't("adminUsers.inviteUser")',
    ].join("\n");
    expect(gate([OVERLAY, consumer(src)])).toHaveLength(1);
  });
});

describe("ratchet", () => {
  const missing = (spec: Record<string, number>) =>
    Object.entries(spec).flatMap(([file, n]) =>
      Array.from({ length: n }, (_, i) => ({ file, key: `ns.k${i}`, providers: ["@/lib/i18n-x"] })),
    );

  it("nowy plik z brakiem OBLEWA - kod spod codemodu nie może zacząć z długiem", () => {
    const report = compareWithRatchet(missing({ "src/new.tsx": 1 }), new Map());
    expect(report.fresh).toHaveLength(1);
    expect(ratchetFailed(report)).toBe(true);
  });

  it("wzrost w znanym pliku oblewa", () => {
    const report = compareWithRatchet(missing({ "src/a.tsx": 3 }), new Map([["src/a.tsx", 2]]));
    expect(report.grown).toEqual([{ file: "src/a.tsx", was: 2, now: 3 }]);
    expect(ratchetFailed(report)).toBe(true);
  });

  it("spadek NIE oblewa - sprzątanie nie wymaga edycji baseline'u w tym samym commicie", () => {
    const report = compareWithRatchet(missing({ "src/a.tsx": 1 }), new Map([["src/a.tsx", 2]]));
    expect(ratchetFailed(report)).toBe(false);
    expect(report.improved).toEqual([{ file: "src/a.tsx", was: 2, now: 1 }]);
  });

  it("plik wyczyszczony do zera liczy się jako poprawa", () => {
    const report = compareWithRatchet([], new Map([["src/a.tsx", 2]]));
    expect(report.improved).toEqual([{ file: "src/a.tsx", was: 2, now: 0 }]);
    expect(ratchetFailed(report)).toBe(false);
  });

  it("liczy braki per plik", () => {
    expect(countsByFile(missing({ "src/a.tsx": 2, "src/b.tsx": 1 }))).toEqual(
      new Map([
        ["src/a.tsx", 2],
        ["src/b.tsx", 1],
      ]),
    );
  });

  it("raport nowego długu podaje GOTOWĄ linijkę naprawy, nie samą liczbę", () => {
    const entries = missing({ "src/new.tsx": 1 });
    const report = compareWithRatchet(entries, new Map());
    const rendered = renderRatchetReport(report, entries, 0);
    expect(rendered).toContain('dopisz: import "@/lib/i18n-x";');
    expect(rendered).toContain("i18n-overlay-imports: pomijamy");
  });

  it("stan bez zmian przechodzi cicho", () => {
    const report = compareWithRatchet(missing({ "src/a.tsx": 2 }), new Map([["src/a.tsx", 2]]));
    expect(renderRatchetReport(report, [], 1)).toContain("OK");
  });
});
