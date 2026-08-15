import { describe, expect, it } from "vitest";
import {
  classifyDefaultValues,
  declaresLocalT,
  defaultValueGateFailed,
  isScannable,
  parseObjectLiteral,
  removeDefaultValues,
  renderDefaultValueReport,
  reportDefaultValues,
  type DictionaryTrees,
} from "../i18nDefaultValue";

const TREES: DictionaryTrees = {
  pl: {
    admin: { save: "Zapisz", items_one: "1 pozycja", items_few: "{{count}} pozycje" },
    onlyPl: { text: "Tylko PL" },
  },
  en: {
    admin: { save: "Save", items_one: "1 item", items_other: "{{count}} items" },
  },
};

function classify(source: string, file = "src/x.tsx") {
  return classifyDefaultValues([{ file, source }], TREES);
}

function rewrite(source: string): string {
  return removeDefaultValues(source, classify(source)).source;
}

describe("parseObjectLiteral", () => {
  it("czyta właściwości najwyższego poziomu", () => {
    const literal = parseObjectLiteral(`{ a: 1, defaultValue: "x", count: n }`);
    expect(literal?.properties.map((p) => p.name)).toEqual(["a", "defaultValue", "count"]);
  });

  it("nie schodzi do zagnieżdżonego obiektu", () => {
    const literal = parseObjectLiteral(`{ opts: { defaultValue: "x" }, count: n }`);
    expect(literal?.properties.map((p) => p.name)).toEqual(["opts", "count"]);
  });

  it("nie myli przecinka w łańcuchu z separatorem właściwości", () => {
    const literal = parseObjectLiteral(`{ defaultValue: "a, b", count: n }`);
    expect(literal?.properties.map((p) => p.name)).toEqual(["defaultValue", "count"]);
  });

  it("odrzuca argument, który nie jest obiektem literalnym", () => {
    expect(parseObjectLiteral("opts")).toBeNull();
    expect(parseObjectLiteral("makeOpts({ defaultValue: 'x' })")).toBeNull();
  });
});

describe("klasyfikacja", () => {
  it("klucz obecny w PL i EN jest zbędny", () => {
    expect(classify(`t("admin.save", { defaultValue: "Zapisz" })`)[0].verdict).toBe("redundant");
  });

  it("klucz obecny tylko w PL jest NOŚNY - EN renderowałby tekst z kodu", () => {
    expect(classify(`t("onlyPl.text", { defaultValue: "Tylko PL" })`)[0].verdict).toBe(
      "load-bearing",
    );
  });

  it("klucz nieobecny nigdzie jest NOŚNY", () => {
    expect(classify(`t("ghost.key", "Duch")`)[0].verdict).toBe("load-bearing");
  });

  it("klucz składany w locie z LITERAŁEM to tekst w kodzie pod inną nazwą", () => {
    expect(classify('t(`admin.${x}`, { defaultValue: "Zapisz" })')[0].verdict).toBe("dynamic");
  });

  it("klucz w locie z WYRAŻENIEM to przepuszczenie wartości runtime'owej", () => {
    expect(classify("t(`admin.${x}`, { defaultValue: code })")[0].verdict).toBe(
      "runtime-passthrough",
    );
  });

  it('pusty literał to cichy zapas („nie renderuj nic"), nie tekst do przekładu', () => {
    expect(classify('t(`admin.${x}`, { defaultValue: "" })')[0].verdict).toBe(
      "runtime-passthrough",
    );
  });

  it("formy mnogie liczą się jako liść tekstowy", () => {
    expect(classify(`t("admin.items", { defaultValue: "pozycje", count: n })`)[0].verdict).toBe(
      "redundant",
    );
  });

  it("dokleja keyPrefix z haka - inaczej klucz wygląda na nieistniejący", () => {
    const source = `const { t } = useTranslation(undefined, { keyPrefix: "admin" });\nt("save", { defaultValue: "Zapisz" });`;
    const [site] = classify(source);
    expect(site.key).toBe("admin.save");
    expect(site.verdict).toBe("redundant");
  });

  it("i18n.t() omija hak, więc NIE dostaje keyPrefix", () => {
    const source = `const { t } = useTranslation(undefined, { keyPrefix: "admin" });\ni18n.t("admin.save", { defaultValue: "Zapisz" });`;
    expect(classify(source)[0].key).toBe("admin.save");
  });

  it("rozpoznaje interpolację w zapasie", () => {
    const site = classify('t("admin.save", { defaultValue: `Zapisz ${n}` })')[0];
    expect(site.interpolated).toBe(true);
  });

  it("nie widzi defaultValue w komentarzu", () => {
    expect(classify(`// t("admin.save", { defaultValue: "Zapisz" })`)).toHaveLength(0);
  });

  it("nie bierze split(/filter( za wywołanie t()", () => {
    expect(classify(`list.filter((x) => x).at(0)`)).toHaveLength(0);
  });

  it("plik z WŁASNYM `t` jest poza zasięgiem - to bliźniak językowy, nie i18next", () => {
    const source = [
      `const t = (pl: string, en: string) => (lang === "pl" ? pl : en);`,
      `const label = t("Kolumny", "Columns");`,
    ].join("\n");
    expect(declaresLocalT(source)).toBe(true);
    expect(classify(source)).toHaveLength(0);
  });

  it("deklaracja `t` w komentarzu nie wyłącza pliku ze skanu", () => {
    const source = [
      `// historycznie stało tu: const t = (pl, en) => ...`,
      `t("admin.save", { defaultValue: "Zapisz" });`,
    ].join("\n");
    expect(declaresLocalT(source)).toBe(false);
    expect(classify(source)[0].verdict).toBe("redundant");
  });
});

describe("przepisanie", () => {
  it("jedyna właściwość - znika cały argument opcji", () => {
    expect(rewrite(`t("admin.save", { defaultValue: "Zapisz" })`)).toBe(`t("admin.save")`);
  });

  it("właściwość z rodzeństwem po prawej - zostaje reszta", () => {
    expect(rewrite(`t("admin.items", { defaultValue: "pozycje", count: n })`)).toBe(
      `t("admin.items", { count: n })`,
    );
  });

  it("właściwość ostatnia - znika razem z poprzedzającym przecinkiem", () => {
    expect(rewrite(`t("admin.items", { count: n, defaultValue: "pozycje" })`)).toBe(
      `t("admin.items", { count: n })`,
    );
  });

  it("forma pozycyjna bez opcji", () => {
    expect(rewrite(`t("admin.save", "Zapisz")`)).toBe(`t("admin.save")`);
  });

  it("forma pozycyjna z obiektem opcji na trzeciej pozycji", () => {
    expect(rewrite(`t("admin.items", "pozycje", { count: n })`)).toBe(
      `t("admin.items", { count: n })`,
    );
  });

  it("zapis wielolinijkowy", () => {
    const source = [`t("admin.save", {`, `  defaultValue: "Zapisz",`, `  count: n,`, `})`].join(
      "\n",
    );
    expect(rewrite(source)).toBe([`t("admin.save", {`, `  count: n,`, `})`].join("\n"));
  });

  it("NIE rusza miejsc nośnych ani dynamicznych", () => {
    const source = `t("ghost.key", "Duch"); t(\`admin.\${x}\`, { defaultValue: "X" });`;
    expect(rewrite(source)).toBe(source);
  });

  it("wiele wystąpień w jednym pliku - offsety pozostają ważne", () => {
    const source = `t("admin.save", { defaultValue: "Zapisz" }) + t("admin.save", "Zapisz")`;
    expect(rewrite(source)).toBe(`t("admin.save") + t("admin.save")`);
  });

  it("przecinek w treści zapasu nie rozcina wywołania", () => {
    expect(rewrite(`t("admin.save", { defaultValue: "Zapisz, teraz", count: n })`)).toBe(
      `t("admin.save", { count: n })`,
    );
  });
});

describe("bramka", () => {
  it("zero wystąpień przechodzi", () => {
    const report = reportDefaultValues(classify(`t("admin.save")`));
    expect(defaultValueGateFailed(report)).toBe(false);
    expect(renderDefaultValueReport(report, 1)).toContain("OK");
  });

  it("każda klasa oblewa - także nośna i dynamiczna", () => {
    for (const source of [
      `t("admin.save", { defaultValue: "Zapisz" })`,
      `t("ghost.key", "Duch")`,
      't(`admin.${x}`, { defaultValue: "X" })',
    ]) {
      expect(defaultValueGateFailed(reportDefaultValues(classify(source)))).toBe(true);
    }
  });

  it("zasięg skanu pomija testy i fixture'y bramek", () => {
    expect(isScannable("src/components/X.tsx")).toBe(true);
    expect(isScannable("src/components/__tests__/X.test.tsx")).toBe(false);
    expect(isScannable("src/lib/ci/i18nKeyUsage.ts")).toBe(false);
    expect(isScannable("src/lib/x.css")).toBe(false);
  });
});
