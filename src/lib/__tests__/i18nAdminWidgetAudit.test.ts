// Nakładka panelu /admin/i18n (`i18n-admin-widget-audit`) - audyt tłumaczeń
// treści widgetów.
//
// CO DOWODZIMY:
//   * rejestracja PRZY IMPORCIE w obu językach, głęboko i z nadpisaniem
//     WŁASNEGO korzenia (`adminWidgetI18nAudit`) - jak każda nowoczesna
//     nakładka (`i18n-cart.ts`, `i18n-notifications.ts`);
//   * `ensureI18n()` po imporcie jest no-opem (bramka
//     `i18nOverlayIntegrity.gate.test.ts` sprawdza to dla wszystkich, tu -
//     punktowo, z kontrolą, że w ogóle jest eksportowane);
//   * nakładka nie dotyka kluczy rdzenia ani innych korzeni - pisze wyłącznie
//     pod `adminWidgetI18nAudit`;
//   * PL i EN mają ten sam zbiór kluczy (poza polskimi `_few`/`_many`)
//     i żaden napis EN nie jest kopią PL;
//   * liczba mnoga licznika: „1 problem / 2 problemy / 5 problemów" i
//     „1 wpisie/stronie / 2 wpisach/stronach" (wcześniej panel pisał
//     „1 problemów w 1 wpisach/stronach").
//
// Kolejność jest częścią testu: rdzeń (przez `i18nReal`) i zdjęcie rdzenia
// PRZED nakładką, potem nakładka importem dynamicznym pod szpiegiem.
import { describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";
import { pl as corePl } from "@/lib/locale/pl";
import { en as coreEn } from "@/lib/locale/en";
import { realT } from "@/test/i18nReal";

/** Zdjęcie rdzenia sprzed nakładki - i18next scala nakładki w eksport w miejscu. */
const CORE = structuredClone({ pl: corePl, en: coreEn });

const writes: Array<{
  lang: string;
  ns: string;
  tree: unknown;
  deep: boolean | undefined;
  overwrite: boolean | undefined;
}> = [];
const original = i18n.addResourceBundle.bind(i18n);
const spy = vi
  .spyOn(i18n, "addResourceBundle")
  .mockImplementation((lng, ns, resources, deep, overwrite) => {
    writes.push({ lang: lng, ns, tree: resources, deep, overwrite });
    return original(lng, ns, resources, deep, overwrite);
  });
const overlay = await import("@/lib/i18n-admin-widget-audit");
spy.mockRestore();

const PL_ONLY_PLURAL = /_(few|many)$/;

function leaves(node: unknown, prefix = ""): Array<[string, unknown]> {
  if (node === null || typeof node !== "object" || Array.isArray(node)) {
    return prefix === "" ? [] : [[prefix, node]];
  }
  return Object.entries(node).flatMap(([key, child]) =>
    leaves(child, prefix === "" ? key : `${prefix}.${key}`),
  );
}

describe("i18n-admin-widget-audit - rejestracja", () => {
  it("rejestruje PL i EN przy imporcie: translation, deep, overwrite", () => {
    expect(writes.map((w) => w.lang).sort()).toEqual(["en", "pl"]);
    for (const write of writes) {
      expect(write).toMatchObject({ ns: "translation", deep: true, overwrite: true });
    }
    expect(writes.find((w) => w.lang === "pl")?.tree).toBe(overlay.adminWidgetAuditPl);
    expect(writes.find((w) => w.lang === "en")?.tree).toBe(overlay.adminWidgetAuditEn);
    expect(overlay.adminWidgetAuditResources).toEqual({
      pl: overlay.adminWidgetAuditPl,
      en: overlay.adminWidgetAuditEn,
    });
  });

  it("ensureI18n() po imporcie nie pisze ponownie do magazynu", () => {
    const again = vi.spyOn(i18n, "addResourceBundle");
    try {
      overlay.ensureI18n();
      overlay.ensureI18n();
      expect(again).not.toHaveBeenCalled();
    } finally {
      again.mockRestore();
    }
  });

  it("pisze wyłącznie pod własny korzeń i nie powtarza kluczy rdzenia", () => {
    for (const write of writes) {
      expect(Object.keys(write.tree as object)).toEqual(["adminWidgetI18nAudit"]);
    }
    for (const lang of ["pl", "en"] as const) {
      expect(CORE[lang]).not.toHaveProperty("adminWidgetI18nAudit");
    }
  });
});

describe("i18n-admin-widget-audit - treść", () => {
  const plLeaves = leaves(overlay.adminWidgetAuditPl);
  const enLeaves = new Map(leaves(overlay.adminWidgetAuditEn));

  it("PL i EN mają ten sam zbiór kluczy (poza polskimi _few/_many)", () => {
    const plKeys = plLeaves.map(([key]) => key).filter((key) => !PL_ONLY_PLURAL.test(key));
    expect([...enLeaves.keys()].sort()).toEqual(plKeys.sort());
  });

  it("każdy napis jest niepusty, a EN nie jest kopią PL", () => {
    const copies = plLeaves
      .filter(([key, value]) => enLeaves.has(key) && enLeaves.get(key) === value)
      .map(([key]) => key);
    expect(copies).toEqual([]);
    for (const [, value] of [...plLeaves, ...enLeaves]) {
      expect(typeof value === "string" && value.trim().length > 0).toBe(true);
    }
  });

  it.each([
    [1, "1 problem", "1 issue"],
    [2, "2 problemy", "2 issues"],
    [5, "5 problemów", "5 issues"],
    [22, "22 problemy", "22 issues"],
  ])("licznik problemów: %i", (count, pl, en) => {
    const word = (lang: "pl" | "en") =>
      realT(lang)("adminWidgetI18nAudit.summaryIssues", { count });
    expect(`${count} ${word("pl")}`).toBe(pl);
    expect(`${count} ${word("en")}`).toBe(en);
  });

  it.each([
    [1, "w 1 wpisie/stronie", "across 1 entry"],
    [3, "w 3 wpisach/stronach", "across 3 entries"],
    [5, "w 5 wpisach/stronach", "across 5 entries"],
  ])("licznik wpisów: %i", (count, pl, en) => {
    expect(`w ${count} ${realT("pl")("adminWidgetI18nAudit.summaryEntries", { count })}`).toBe(pl);
    expect(`across ${count} ${realT("en")("adminWidgetI18nAudit.summaryEntries", { count })}`).toBe(
      en,
    );
  });

  it("komunikaty stanu odczytu mówią o stronach i wpisach audytu", () => {
    const t = realT("pl");
    expect(t("adminWidgetI18nAudit.readError")).toContain("stron i wpisów");
    expect(t("adminWidgetI18nAudit.coverageTruncated", { shown: 2, total: 9 })).toContain(
      "Przeskanowano 2 z 9 stron i wpisów",
    );
    expect(t("adminWidgetI18nAudit.coverageUnknown", { shown: 4 })).toContain(
      "(4 przeskanowanych)",
    );
    const tEn = realT("en");
    expect(tEn("adminWidgetI18nAudit.coverageTruncated", { shown: 2, total: 9 })).toContain(
      "Scanned 2 of 9 pages and posts",
    );
    expect(tEn("adminWidgetI18nAudit.coverageUnknown", { shown: 4 })).toContain("(4 scanned)");
  });
});
