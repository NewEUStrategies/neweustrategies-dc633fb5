// Testy skanera „cichego rozjazdu słownika": co skaner musi ZOBACZYĆ
// (wywołania, template literale, referencje w stałych) i czego NIE ma widzieć
// (inne wywołania kończące się na `t(`, ścieżki importów, klucze zapytań).
import { describe, expect, it } from "vitest";
import {
  auditKeyUsage,
  parseCallArgs,
  readKeyPrefixScopes,
  keyUsageFailed,
  maskComments,
  renderKeyUsageReport,
  scanKeyReferences,
  scanKeyUsage,
  scanTranslationCalls,
} from "@/lib/ci/i18nKeyUsage";
import type { ResourceTree } from "@/lib/ci/i18nParity";

const PL: ResourceTree = {
  network: {
    connect: "Dodaj do sieci",
    mutual_one: "{{count}} wspólny kontakt",
    mutual_few: "{{count}} wspólne kontakty",
    mutual_many: "{{count}} wspólnych kontaktów",
    mutual_other: "{{count}} wspólnych kontaktów",
    reportReasons: { spam: "Spam", other: "Inne" },
  },
};

const EN: ResourceTree = {
  network: {
    connect: "Connect",
    mutual_one: "{{count}} mutual connection",
    mutual_other: "{{count}} mutual connections",
    reportReasons: { spam: "Spam", other: "Other" },
  },
};

describe("scanTranslationCalls", () => {
  it("czyta klucz z literału i podaje numer linii", () => {
    const src = ["const a = 1;", 'const label = t("network.connect");'].join("\n");
    expect(scanTranslationCalls("a.tsx", src)).toEqual([
      {
        key: "network.connect",
        kind: "literal",
        file: "a.tsx",
        line: 2,
        defaultValue: null,
        plural: false,
        returnsObjects: false,
      },
    ]);
  });

  it("wyłapuje defaultValue i count, także gdy opcje mają zagnieżdżone wywołania", () => {
    const src = 't("network.mutualLinkAria", { count: Math.max(0, n), defaultValue: "Zobacz" })';
    const [usage] = scanTranslationCalls("a.tsx", src);
    expect(usage.defaultValue).toBe("Zobacz");
    expect(usage.plural).toBe(true);
    expect(usage.key).toBe("network.mutualLinkAria");
  });

  it('czyta POZYCYJNY defaultValue - `t("k", "tekst")` i z opcjami w trzecim', () => {
    // Ta forma była dla skanera niewidzialna, a to ona siedziała w dialogu
    // historii ustawień: dziewięć kluczy nieobecnych w słowniku, polski tekst
    // w kodzie, angielski interfejs renderujący polszczyznę.
    const [a] = scanTranslationCalls("a.tsx", 't("network.ghost", "Nieznany autor")');
    expect(a.defaultValue).toBe("Nieznany autor");
    const [b] = scanTranslationCalls("a.tsx", 't("network.ghost", "Autor", { count: 2 })');
    expect(b.defaultValue).toBe("Autor");
    expect(b.plural).toBe(true);
  });

  it("obiekt opcji w drugim argumencie NIE jest brany za defaultValue", () => {
    const [usage] = scanTranslationCalls("a.tsx", 't("network.connect", { count: 2 })');
    expect(usage.defaultValue).toBeNull();
  });

  it("template literal z interpolacją daje prefiks gałęzi", () => {
    const src = "const x = t(`network.reportReasons.${reason}`);";
    expect(scanTranslationCalls("a.tsx", src)).toEqual([
      {
        key: "network.reportReasons",
        kind: "prefix",
        file: "a.tsx",
        line: 1,
        defaultValue: null,
        plural: false,
        returnsObjects: false,
      },
    ]);
  });

  it("template literal bez interpolacji jest zwykłym kluczem", () => {
    expect(scanTranslationCalls("a.tsx", "t(`network.connect`)")[0]).toMatchObject({
      key: "network.connect",
      kind: "literal",
    });
  });

  it("obsługuje i18n.t(...) i pomija metody kończące się na t(", () => {
    const src = [
      'i18n.t("network.connect");',
      "rows.at(0);",
      'items.split("network.nope");',
      "items.filter((x) => x);",
      'const s = fmt("network.nope2");',
    ].join("\n");
    expect(scanTranslationCalls("a.tsx", src).map((u) => u.key)).toEqual(["network.connect"]);
  });

  it("pomija klucz zbudowany ze zmiennej (łapie go dopiero skan referencji)", () => {
    expect(scanTranslationCalls("a.tsx", "t(emptyKey)")).toEqual([]);
  });

  it("nie wybucha na niedomkniętym wywołaniu", () => {
    expect(scanTranslationCalls("a.tsx", 't("network.connect"')).toEqual([]);
  });

  it("ignoruje wywołania w komentarzach i teksty ze spacjami", () => {
    const src = [
      '// t("network.commented")',
      "/* t(`network.blockComment`) */",
      't("chat: expert requires request")',
    ].join("\n");
    expect(scanTranslationCalls("a.tsx", src)).toEqual([]);
  });

  it("nie bierze `//` z wnętrza łańcucha za początek komentarza", () => {
    const src = ['const url = "https://example.test";', 't("network.connect");'].join("\n");
    expect(scanTranslationCalls("a.tsx", src).map((u) => u.line)).toEqual([2]);
  });
});

describe("maskComments", () => {
  it("zachowuje długość, linie i treść kodu", () => {
    const src = 'const a = 1; // t("x")\nconst b = 2;';
    const masked = maskComments(src);
    expect(masked).toHaveLength(src.length);
    expect(masked.split("\n")).toHaveLength(2);
    expect(masked).toContain("const a = 1;");
    expect(masked).not.toContain('t("x")');
  });
});

describe("scanKeyReferences", () => {
  it("łapie ścieżki kluczy w stałych i propsach pod zadanym korzeniem", () => {
    const src = [
      'const MAP = { must_be_connected: "network.errors.notConnected" };',
      '<List emptyKey="network.introductions.emptyBridge" />',
    ].join("\n");
    expect(scanKeyReferences("a.tsx", src, ["network"]).map((u) => u.key)).toEqual([
      "network.errors.notConnected",
      "network.introductions.emptyBridge",
    ]);
  });

  it("nie bierze ścieżek importów, kluczy zapytań ani innych korzeni", () => {
    const src = [
      'import "@/lib/i18n-network";',
      'const key = ["network", "policy-followers"];',
      'const other = "billing.invoice.title";',
    ].join("\n");
    expect(scanKeyReferences("a.tsx", src, ["network"])).toEqual([]);
  });

  it("bez podanych korzeni nie zgłasza nic (skan referencji jest opt-in)", () => {
    expect(scanKeyReferences("a.tsx", 'const k = "network.connect";', [])).toEqual([]);
  });
});

describe("scanKeyUsage", () => {
  it("scala wywołania i referencje bez duplikatów", () => {
    const src = [
      't("network.connect");',
      'const again = "network.connect";',
      'const ref = "network.other";',
    ].join("\n");
    const usage = scanKeyUsage("a.tsx", src, { referencePrefixes: ["network"] });
    expect(usage.map((u) => `${u.kind}:${u.key}`)).toEqual([
      "literal:network.connect",
      "reference:network.other",
    ]);
  });
});

describe("auditKeyUsage", () => {
  const trees = { pl: PL, en: EN };

  it("klucz obecny w obu słownikach nie jest zgłaszany", () => {
    const audit = auditKeyUsage(scanKeyUsage("a.tsx", 't("network.connect")'), trees);
    expect(keyUsageFailed(audit)).toBe(false);
    expect(renderKeyUsageReport(audit)).toBe("Brak rozjazdów słownika.");
  });

  it("formy mnogie zaspokajają klucz z count (PL few/many, EN one/other)", () => {
    const audit = auditKeyUsage(scanKeyUsage("a.tsx", 't("network.mutual", { count: 3 })'), trees);
    expect(keyUsageFailed(audit)).toBe(false);
  });

  it("brak w obu słownikach bez defaultValue idzie do `missing`", () => {
    const audit = auditKeyUsage(scanKeyUsage("a.tsx", 't("network.ghost")'), trees);
    expect(audit.missing.map((f) => f.reason)).toEqual(["missing_both"]);
    expect(audit.masked).toEqual([]);
  });

  it("brak zamaskowany defaultValue idzie do `masked` - to najgroźniejsza klasa", () => {
    const audit = auditKeyUsage(
      scanKeyUsage("a.tsx", 't("network.ghost", { defaultValue: "Zobacz" })'),
      trees,
    );
    expect(audit.missing).toEqual([]);
    expect(audit.masked).toHaveLength(1);
    expect(renderKeyUsageReport(audit)).toContain("ZAMASKOWANE defaultValue");
    expect(renderKeyUsageReport(audit)).toContain('defaultValue: "Zobacz"');
  });

  it("rozróżnia brak tylko w EN i tylko w PL", () => {
    const onlyPl: ResourceTree = { network: { a: "PL" } };
    const onlyEn: ResourceTree = { network: { b: "EN" } };
    const audit = auditKeyUsage(scanKeyUsage("a.tsx", 't("network.a"); t("network.b");'), {
      pl: onlyPl,
      en: onlyEn,
    });
    expect(audit.missing.map((f) => f.reason)).toEqual(["missing_en", "missing_pl"]);
  });

  it("gałąź dynamiczna z różnymi podkluczami PL/EN to `branch_mismatch`", () => {
    const pl: ResourceTree = { network: { reportReasons: { spam: "Spam", extra: "Nadmiar" } } };
    const audit = auditKeyUsage(scanKeyUsage("a.tsx", "t(`network.reportReasons.${r}`)"), {
      pl,
      en: EN,
    });
    expect(audit.branches).toHaveLength(1);
    expect(audit.branches[0].reason).toBe("branch_mismatch");
    expect(audit.branches[0].detail).toContain("extra");
  });

  it("gałąź dynamiczna, która nie prowadzi do obiektu, to `branch_missing`", () => {
    const audit = auditKeyUsage(scanKeyUsage("a.tsx", "t(`network.nosuch.${r}`)"), trees);
    expect(audit.branches.map((f) => f.reason)).toEqual(["branch_missing"]);
  });

  it("gałąź zgodna po odrzuceniu wariantów mnogich przechodzi", () => {
    const pl: ResourceTree = {
      network: { count: { item_one: "1", item_few: "2", item_many: "5" } },
    };
    const en: ResourceTree = { network: { count: { item_one: "1", item_other: "n" } } };
    const audit = auditKeyUsage(scanKeyUsage("a.tsx", "t(`network.count.${x}`)"), { pl, en });
    expect(audit.branches).toEqual([]);
  });

  it("ignoreKeys wycisza świadomie techniczne klucze", () => {
    const audit = auditKeyUsage(scanKeyUsage("a.tsx", 't("network.ghost")'), trees, {
      ignoreKeys: ["network.ghost"],
    });
    expect(keyUsageFailed(audit)).toBe(false);
  });

  it("klucz wołany z returnObjects jest zaspokojony TABLICĄ", () => {
    // `pricing.faq` i `pricing.comparisonMatrix.rows` leżą w słowniku jako
    // tablice - bez tego oba wyglądały na brak, choć są w obu językach.
    const tree: ResourceTree = { network: { faq: [{ q: "P", a: "O" }] } as never };
    const audit = auditKeyUsage(
      scanKeyUsage("a.tsx", 't("network.faq", { returnObjects: true })'),
      { pl: tree, en: tree },
    );
    expect(keyUsageFailed(audit)).toBe(false);
  });

  it("ten sam klucz BEZ returnObjects nadal oblewa - kod oczekuje napisu", () => {
    // Druga strona tego samego rozróżnienia: `t("network.faq")` bez opcji
    // dostaje tablicę, którą React wypisze jako tekst. Gdyby bramka przyjmowała
    // tablicę zawsze, ten defekt przechodziłby na zielono.
    const tree: ResourceTree = { network: { faq: [{ q: "P", a: "O" }] } as never };
    const audit = auditKeyUsage(scanKeyUsage("a.tsx", 't("network.faq")'), {
      pl: tree,
      en: tree,
    });
    expect(audit.missing.map((f) => f.reason)).toEqual(["missing_both"]);
  });
});

describe("platform dictionary scanner lexical and report edge cases", () => {
  it("parses escaped quotes and ignores delimiters inside both comment forms", () => {
    const source = '("a\\\"b", /* ), ignored */ { count: 2 }, // ignored )\n "third")';
    const call = parseCallArgs(source, 0);
    expect(call?.args).toHaveLength(3);
    expect(call?.end).toBe(source.length);
    expect(parseCallArgs("(value // no newline", 0)).toBeNull();
    expect(parseCallArgs("(value /* no close", 0)).toBeNull();
    expect(maskComments("x /* unfinished")).toMatch(/^x\s+$/);
  });
  it("does not invent static keys from concatenation or malformed calls", () => {
    for (const source of [
      "t()",
      't("network." + suffix)',
      "t(`.${key}`)",
      "t(`network.static` + suffix)",
    ])
      expect(scanTranslationCalls("x.ts", source)).toEqual([]);
    expect(readKeyPrefixScopes('useTranslation("translation", { keyPrefix: "network"')).toEqual([
      { at: 0, keyPrefix: null },
    ]);
  });
  it("reports partial leaf parity separately from missing parent branches", () => {
    const usages = scanTranslationCalls(
      "x.ts",
      't(`blocks.ui.pad_${size}`); t(`missing.ui.pad_${size}`); t("absent.key");',
    );
    const audit = auditKeyUsage(usages, {
      pl: { blocks: { ui: { pad_sm: "small", pad_lg: "large" } } },
      en: { blocks: { ui: { pad_sm: "small", pad_xl: "extra" } } },
    });
    expect(audit.branches.map((x) => x.reason)).toEqual([
      "partial_mismatch",
      "partial_parent_missing",
    ]);
    expect(audit.missing).toHaveLength(1);
    const report = renderKeyUsageReport(audit);
    expect(report).toContain("partial_parent_missing");
    expect(report).toContain("pad_lg");
    expect(report).toContain("absent.key");
  });
  it("does not treat a null, primitive or absent localized branch as an object", () => {
    const usage = scanTranslationCalls("x.ts", "t(`blocks.ui.pad_${size}`)");
    for (const en of [{ blocks: "plain" }, {}])
      expect(
        auditKeyUsage(usage, { pl: { blocks: { ui: { pad_sm: "small" } } }, en }).branches[0]
          .reason,
      ).toBe("partial_parent_missing");
  });
});
