// @vitest-environment node
// TEST BRAMKI NAZW IKON W CHROME - z KONTROLĄ NEGATYWNĄ.
//
// PO CO KONTROLA NEGATYWNA. Bramka statyczna ma jedną charakterystyczną
// awarię: przestaje cokolwiek znajdować (wzorzec przestaje pasować, bo zmienił
// się zapis konfiguracji) i od tej chwili jest ZIELONA ZAWSZE. Taka awaria nie
// daje żadnego sygnału - CI świeci, a bramki nie ma. Dlatego każdy wzorzec ma
// tu PARĘ: dowód, że poprawne wejście przechodzi, i dowód, że ZEPSUTE OBLEWA.
//
// WEJŚCIA SĄ ATRAPAMI, NIE PRAWDZIWYMI PLIKAMI - świadomie: test na prawdziwym
// drzewie mierzyłby stan repozytorium i zmieniałby wynik przy każdej zmianie
// konfiguracji, a przedmiotem dowodu jest INWARIANT, czyli reakcja na KSZTAŁT
// wejścia. Ta sama konwencja co `ssrBudgets.test.ts` i `gateCoverage.test.ts`.
import { describe, expect, it } from "vitest";
import {
  analyzeMenuIcons,
  bezKomentarzySql,
  collectIconNames,
  menuIconsFailed,
  renderMenuIconReport,
  type MenuIconSource,
} from "../menuIcons";

/** Zestaw testowy - celowo mały, żeby było widać, co jest w nim, a co poza. */
const KURATOROWANE = ["circle", "users", "calendar-days", "file-text", "messages-square"];

const analiza = (sources: MenuIconSource[]) => analyzeMenuIcons({ curated: KURATOROWANE, sources });

describe("collectIconNames - źródła TypeScriptowe", () => {
  it("czyta pole `icon` w obiekcie konfiguracji", () => {
    const found = collectIconNames({
      file: "src/lib/mobileBottomBar/config.ts",
      content: `export const ITEM = {\n  id: "home",\n  icon: "users",\n};\n`,
    });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ name: "users", line: 3, kind: "pole" });
  });

  it("czyta `iconName` i atrybut JSX `icon=`", () => {
    const found = collectIconNames({
      file: "src/components/chrome/Tab.tsx",
      content: `const a = { iconName: "users" };\nconst b = <Tab icon="circle" />;\n`,
    });
    expect(found.map((f) => f.name).sort()).toEqual(["circle", "users"]);
  });

  it("czyta stałą z domyślną ikoną", () => {
    const found = collectIconNames({
      file: "src/lib/events/eventPagesApi.ts",
      content: `export const EVENT_PAGE_DEFAULT_ICON = "file-text";\n`,
    });
    expect(found).toMatchObject([{ name: "file-text", kind: "stala" }]);
  });

  it("czyta WIELOLINIJKOWY katalog `icons: [...]` oferowany redakcji", () => {
    // Katalog ikon wątków klubowych jest zapisany dokładnie tak - gdyby wzorzec
    // działał tylko w obrębie linii, bramka widziałaby z niego jedną nazwę.
    const found = collectIconNames({
      file: "src/lib/clubs/threadIcons.ts",
      content: `const G = {\n  icons: [\n    "users",\n    "circle",\n  ],\n};\n`,
    });
    expect(found.map((f) => f.name)).toEqual(["users", "circle"]);
    expect(found.map((f) => f.line)).toEqual([3, 4]);
    expect(found.every((f) => f.kind === "katalog")).toBe(true);
  });

  it("NIE liczy nazwy zakomentowanej - komentarz nie jest konfiguracją", () => {
    // Bramka, która liczy komentarze, żąda naprawy zdania w dokumentacji
    // zamiast naprawy kodu; to najszybsza droga do usunięcia tej dokumentacji.
    const found = collectIconNames({
      file: "src/lib/chrome.ts",
      content: `// icon: "pencil-ruler"\n/* icon: "wrench" */\nconst a = { icon: "users" };\n`,
    });
    expect(found.map((f) => f.name)).toEqual(["users"]);
  });

  it("pusty zapis znaczy BEZ IKONY, a nie złą ikonę", () => {
    const found = collectIconNames({
      file: "src/lib/menus/tree.ts",
      content: `const node = { icon: "" };\n`,
    });
    expect(found).toEqual([]);
  });

  it("zapis z samych spacji też znaczy BEZ IKONY", () => {
    // Pole wyczyszczone w panelu potrafi zapisać się jako spacja; to nadal
    // „brak ikony", a nie nazwa, której zestaw nie pokrywa.
    const found = collectIconNames({
      file: "src/lib/menus/tree.ts",
      content: `const node = { icon: "   " };\nconst g = { icons: ["   ", "users"] };\n`,
    });
    expect(found.map((f) => f.name)).toEqual(["users"]);
  });

  it("sprowadza cztery zapisy tej samej ikony do jednej nazwy", () => {
    const found = collectIconNames({
      file: "src/lib/chrome.ts",
      content: [
        `const a = { icon: "calendar-days" };`,
        `const b = { icon: "CalendarDays" };`,
        `const c = { icon: "calendar_days" };`,
        `const d = { icon: "calendar days" };`,
      ].join("\n"),
    });
    expect(found.map((f) => f.name)).toEqual([
      "calendar-days",
      "calendar-days",
      "calendar-days",
      "calendar-days",
    ]);
  });
});

describe("collectIconNames - migracje SQL", () => {
  it("czyta payload `jsonb_build_object('icon', 'users')`", () => {
    const found = collectIconNames({
      file: "supabase/migrations/20260806090000_mobile_bottom_bar_default_items.sql",
      content: `INSERT INTO public.site_settings\nSELECT jsonb_build_object('id', 'network', 'icon', 'users');\n`,
    });
    expect(found).toMatchObject([{ name: "users", line: 2, kind: "sql-payload" }]);
  });

  it("czyta nazwę z literału JSON-a", () => {
    const found = collectIconNames({
      file: "supabase/migrations/20260711204000_workflow_engine.sql",
      content: `VALUES ('[{"params":{"icon":"messages-square"}}]'::jsonb);\n`,
    });
    expect(found).toMatchObject([{ name: "messages-square", kind: "sql-payload" }]);
  });

  it("czyta wartość ZAPASOWĄ z `COALESCE(… ->>'icon' …)`", () => {
    // To jest nazwa, którą dostanie KAŻDY wiersz bez własnej ikony - czyli
    // ikona najczęściej renderowana, a nie wyjątek.
    const found = collectIconNames({
      file: "supabase/migrations/20260823120000_event_builder_foundation.sql",
      content: `    COALESCE(NULLIF(btrim(COALESCE(p_payload->>'icon', '')), ''), 'CalendarDays'),\n`,
    });
    expect(found).toMatchObject([{ name: "calendar-days", kind: "sql-domyslna" }]);
  });

  it("czyta domyślną wartość kolumny `icon`", () => {
    const found = collectIconNames({
      file: "supabase/migrations/20260808090000_discussion_clubs_a1_structure.sql",
      content: `CREATE TABLE public.clubs (\n  icon              text NOT NULL DEFAULT 'MessagesSquare',\n);\n`,
    });
    expect(found).toMatchObject([{ name: "messages-square", line: 2, kind: "sql-domyslna" }]);
  });

  it("NIE liczy nazwy z komentarza SQL", () => {
    const found = collectIconNames({
      file: "supabase/migrations/x.sql",
      content: `-- 'icon', 'pencil-ruler'\n/* 'icon', 'wrench' */\nSELECT jsonb_build_object('icon', 'users');\n`,
    });
    expect(found.map((f) => f.name)).toEqual(["users"]);
  });
});

describe("bezKomentarzySql - maskowanie z zachowaniem numeracji linii", () => {
  it("zachowuje długość tekstu i znaki nowej linii", () => {
    const src = `SELECT 1; -- komentarz\nSELECT 2;\n`;
    const masked = bezKomentarzySql(src);
    expect(masked.length).toBe(src.length);
    expect(masked.split("\n")).toHaveLength(src.split("\n").length);
    expect(masked).toContain("SELECT 1;");
    expect(masked).not.toContain("komentarz");
  });

  it("NIE maskuje dywizów, które siedzą w napisie", () => {
    // `'users-round'` zawiera dywiz; gdyby maskowanie brało go za początek
    // komentarza, bramka zgubiłaby dokładnie te nazwy, po które przyszła.
    const masked = bezKomentarzySql(`SELECT jsonb_build_object('icon', 'users-round');`);
    expect(masked).toContain("users-round");
  });

  it("przepuszcza podwojony apostrof wewnątrz napisu", () => {
    const masked = bezKomentarzySql(`SELECT 'a''b' -- znika\n`);
    expect(masked).toContain("'a''b'");
    expect(masked).not.toContain("znika");
  });

  it("komentarz blokowy przez kilka linii NIE przesuwa numeracji", () => {
    // Numeracja jest jedyną rzeczą, po której człowiek trafia do miejsca
    // naruszenia; komentarz wielolinijkowy musi zostawić swoje `\\n`.
    const src = `SELECT 1;\n/* nic\n tutaj */\nSELECT jsonb_build_object('icon', 'users');\n`;
    const masked = bezKomentarzySql(src);
    expect(masked.split("\n")).toHaveLength(src.split("\n").length);
    expect(masked).not.toContain("tutaj");
    const found = collectIconNames({ file: "supabase/migrations/y.sql", content: src });
    expect(found).toMatchObject([{ name: "users", line: 4 }]);
  });
});

describe("analyzeMenuIcons - werdykt bramki", () => {
  const ZGODNE: MenuIconSource[] = [
    { file: "src/lib/mobileBottomBar/config.ts", content: `const a = { icon: "users" };\n` },
    {
      file: "supabase/migrations/a.sql",
      content: `SELECT jsonb_build_object('icon', 'circle');\n`,
    },
  ];

  it("konfiguracja mieszcząca się w zestawie PRZECHODZI", () => {
    const report = analiza(ZGODNE);
    expect(report.violations).toEqual([]);
    expect(menuIconsFailed(report)).toBe(false);
    expect(report.occurrences).toHaveLength(2);
    expect(report.scannedFiles).toBe(2);
    expect(report.curatedCount).toBe(KURATOROWANE.length);
  });

  it("KONTROLA NEGATYWNA: znana zła nazwa z kodu OBLEWA", () => {
    // `users-round` to prawdziwa nazwa z migracji 20260808120627 - dopóki nie
    // trafiła do zestawu, ściągała 109 KB gzip każdemu anonimowi na telefonie.
    const report = analiza([
      ...ZGODNE,
      {
        file: "src/lib/mobileBottomBar/config.ts",
        content: `const a = { icon: "users-round" };\n`,
      },
    ]);
    expect(menuIconsFailed(report)).toBe(true);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]).toMatchObject({ name: "users-round", raw: "users-round" });
  });

  it("KONTROLA NEGATYWNA: zła nazwa wpisana MIGRACJĄ też oblewa", () => {
    const report = analiza([
      {
        file: "supabase/migrations/b.sql",
        content: `SELECT jsonb_build_object('icon', 'crown');\n`,
      },
    ]);
    expect(menuIconsFailed(report)).toBe(true);
    expect(report.violations[0].name).toBe("crown");
  });

  it("zestaw kuratorowany jest normalizowany tak samo jak konfiguracja", () => {
    // Zestaw podany w PascalCase i konfiguracja w kebabie to ta sama lista -
    // inaczej bramka zgłaszałaby naruszenia tam, gdzie ich nie ma.
    const report = analyzeMenuIcons({
      curated: ["CalendarDays"],
      sources: [{ file: "src/lib/chrome.ts", content: `const a = { icon: "calendar-days" };\n` }],
    });
    expect(report.violations).toEqual([]);
    expect(report.curatedCount).toBe(1);
  });
});

describe("renderMenuIconReport - raport prowadzi do miejsca", () => {
  it("dla przebiegu czystego mówi, ile policzył", () => {
    const rendered = renderMenuIconReport(analiza([]));
    expect(rendered).toContain("✓");
    expect(rendered).toContain("5 ikon");
    expect(rendered).toContain("0 nazw");
  });

  it("dla naruszenia podaje plik, linię i lekarstwo", () => {
    const report = analiza([
      {
        file: "src/lib/mobileBottomBar/config.ts",
        content: `const a = {\n  icon: "pencil-ruler",\n};\n`,
      },
    ]);
    const rendered = renderMenuIconReport(report);
    expect(rendered).toContain("✗");
    expect(rendered).toContain("src/lib/mobileBottomBar/config.ts:2");
    expect(rendered).toContain("pencil-ruler");
    expect(rendered).toContain("curatedIconNames.ts");
  });
});
