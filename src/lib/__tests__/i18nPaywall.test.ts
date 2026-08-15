// Słownik paywalla (PL/EN) - trzy bramki w jednym pliku, wzorem suit
// słownikowych obok (i18nChat) i bramki kodu sieci (networkI18nKeys):
//
//  1. STRUKTURA BUNDLE'A: parytet drzew, brak pustych liści, brak pauzy "—"
//     (standard redakcyjny: zwykły dywiz), parytet PLACEHOLDERÓW - klucz
//     przetłumaczony bez {{used}}/{{limit}} renderuje się poprawnie w jednym
//     języku i gubi liczby w drugim, czego parytet samych kluczy nie widzi.
//  2. KOD <-> SŁOWNIK: każdy klucz użyty na powierzchni paywalla (komponent
//     ściany + licznik treści) istnieje w PL i EN, bez maskowania defaultValue.
//  3. PRAWDZIWA ODMIANA: i18next musi dobierać polskie formy one/few/many po
//     count - licznik "zostały 2 darmowe artykuły" czyta czytelnik, nie test
//     z atrapą, więc mierzymy realne napisy z realnej instancji i18n.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import i18n from "@/lib/i18n";
import { realT } from "@/test/i18nReal";
import { paywallPl, paywallEn } from "@/lib/i18n-paywall";
import { pl as corePl } from "@/lib/locale/pl";
import { en as coreEn } from "@/lib/locale/en";
import type { ResourceTree } from "@/lib/ci/i18nParity";
import {
  auditKeyUsage,
  keyUsageFailed,
  renderKeyUsageReport,
  scanKeyUsage,
  type KeyUsage,
} from "@/lib/ci/i18nKeyUsage";

// Powierzchnia paywalla: ściana + licznik meteringu w warstwie treści.
// (QuotaMeter świadomie poza listą - atom dostaje gotowe napisy propsami.)
const SCANNED_FILES = [
  "src/components/Paywall.tsx",
  "src/components/molecules/MeterBanner.tsx",
] as const;

const PL = paywallPl as unknown as Record<string, unknown>;
const EN = paywallEn as unknown as Record<string, unknown>;

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

function leafPaths(tree: Record<string, unknown>, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const [p, v] of leafPaths(value as Record<string, unknown>, path)) out.set(p, v);
    } else if (typeof value === "string") {
      out.set(path, value);
    }
  }
  return out;
}

const baseKeys = (paths: Iterable<string>): Set<string> =>
  new Set([...paths].map((k) => k.replace(PLURAL_SUFFIX, "")));

describe("słownik paywalla - struktura PL/EN", () => {
  it("PL i EN mają identyczną strukturę kluczy (po zwinięciu form mnogich)", () => {
    const plKeys = baseKeys(leafPaths(PL).keys());
    const enKeys = baseKeys(leafPaths(EN).keys());
    const onlyPl = [...plKeys].filter((k) => !enKeys.has(k));
    const onlyEn = [...enKeys].filter((k) => !plKeys.has(k));
    expect({ onlyPl, onlyEn }).toEqual({ onlyPl: [], onlyEn: [] });
  });

  it("nie ma pustych liści ani pauzy — (standard: zwykły dywiz)", () => {
    for (const [lang, tree] of [
      ["pl", PL],
      ["en", EN],
    ] as const) {
      for (const [path, text] of leafPaths(tree)) {
        expect(text.trim(), `${lang}:${path} jest puste`).not.toBe("");
        expect(text.includes("—"), `${lang}:${path} zawiera pauzę —`).toBe(false);
      }
    }
  });

  it("każdy klucz niesie te same placeholdery w obu językach", () => {
    // Zbiór {{nazw}} per klucz bazowy (formy mnogie jednego klucza łączymy) -
    // rozjazd oznacza zgubioną liczbę/datę w jednym z języków.
    const placeholders = (text: string): string[] =>
      [...text.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]);
    const perBaseKey = (tree: Record<string, unknown>): Map<string, Set<string>> => {
      const out = new Map<string, Set<string>>();
      for (const [path, text] of leafPaths(tree)) {
        const base = path.replace(PLURAL_SUFFIX, "");
        const bucket = out.get(base) ?? new Set<string>();
        for (const name of placeholders(text)) bucket.add(name);
        out.set(base, bucket);
      }
      return out;
    };

    const plVars = perBaseKey(PL);
    const enVars = perBaseKey(EN);
    const drift: string[] = [];
    for (const [key, plSet] of plVars) {
      const enSet = enVars.get(key) ?? new Set<string>();
      const onlyPl = [...plSet].filter((v) => !enSet.has(v));
      const onlyEn = [...enSet].filter((v) => !plSet.has(v));
      if (onlyPl.length > 0 || onlyEn.length > 0) {
        drift.push(`${key}: tylko PL [${onlyPl.join(", ")}] / tylko EN [${onlyEn.join(", ")}]`);
      }
    }
    expect(drift).toEqual([]);
  });
});

describe("słownik paywalla - bramka rozjazdu kod <-> PL/EN", () => {
  function loadOverlays(): void {
    // Nakładki i18n rejestrują zasoby efektem ubocznym importu.
    const modules = import.meta.glob("/src/lib/i18n-*.ts", { eager: true });
    expect(Object.keys(modules).length).toBeGreaterThan(0);
  }

  function isTree(value: unknown): value is ResourceTree {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function deepMerge(base: ResourceTree, overlay: ResourceTree): ResourceTree {
    const out: ResourceTree = { ...base };
    for (const [key, value] of Object.entries(overlay)) {
      const existing = out[key];
      out[key] = isTree(value) && isTree(existing) ? deepMerge(existing, value) : value;
    }
    return out;
  }

  function bundle(lang: "pl" | "en", core: ResourceTree): ResourceTree {
    const registered = i18n.getResourceBundle(lang, "translation");
    return deepMerge(core, isTree(registered) ? registered : {});
  }

  function collectUsage(): KeyUsage[] {
    const out: KeyUsage[] = [];
    for (const file of SCANNED_FILES) {
      out.push(
        ...scanKeyUsage(file, readFileSync(file, "utf8"), { referencePrefixes: ["paywall"] }),
      );
    }
    return out;
  }

  it("każdy klucz użyty na powierzchni paywalla istnieje w PL i w EN", () => {
    loadOverlays();
    const usage = collectUsage();
    // Skan musi realnie coś znaleźć - inaczej zielona bramka nic nie dowodzi.
    expect(usage.length).toBeGreaterThan(30);

    const audit = auditKeyUsage(usage, {
      pl: bundle("pl", corePl as ResourceTree),
      en: bundle("en", coreEn as ResourceTree),
    });
    expect(keyUsageFailed(audit), renderKeyUsageReport(audit)).toBe(false);
  });

  it("skan pokrywa całą macierz komunikatów ściany (kanarek zasięgu)", () => {
    const keys = new Set(collectUsage().map((u) => u.key));
    // Po jednym kluczu na tryb reguły, wariant meteringu, lejek zakupowy,
    // bramkę hasła i licznik treści: gdyby skaner przestał widzieć `t()`
    // w tych plikach, bramka wyżej zrobiłaby się pusta i zielona.
    for (const key of [
      "paywall.membersOnly",
      "paywall.paidOnly",
      "paywall.passwordLocked",
      "paywall.meter.registerTitle",
      "paywall.meter.exhaustedDesc",
      "paywall.meter.counter",
      "paywall.meter.lastOne",
      "paywall.trialBadge",
      "paywall.checkoutFail",
      "paywall.seeAllPlans",
    ]) {
      expect(keys, `brak klucza ${key} w skanie`).toContain(key);
    }
  });

  it("żadne wywołanie t() na paywallu nie polega na defaultValue", () => {
    const masked = collectUsage().filter((u) => u.defaultValue !== null);
    expect(masked.map((u) => `${u.file}:${u.line} ${u.key} -> "${u.defaultValue}"`)).toEqual([]);
  });
});

describe("słownik paywalla - realna odmiana liczby (i18next, nie atrapa)", () => {
  it("PL: licznik pozostałych artykułów odmienia się przez one/few/many", () => {
    const t = realT("pl");
    expect(t("paywall.meter.remaining", { count: 1 })).toBe(
      "Pozostał Ci jeszcze 1 darmowy artykuł.",
    );
    expect(t("paywall.meter.remaining", { count: 2 })).toBe(
      "Pozostały Ci jeszcze 2 darmowe artykuły.",
    );
    expect(t("paywall.meter.remaining", { count: 5 })).toBe(
      "Pozostało Ci jeszcze 5 darmowych artykułów.",
    );
    // 22 wraca do formy few - najczęstszy błąd ręcznych map liczby mnogiej.
    expect(t("paywall.meter.remaining", { count: 22 })).toBe(
      "Pozostały Ci jeszcze 22 darmowe artykuły.",
    );
  });

  it("PL: obietnica ściany rejestracji odmienia pulę konta", () => {
    const t = realT("pl");
    expect(t("paywall.meter.registerDesc", { count: 1 })).toBe(
      "Załóż bezpłatne konto i czytaj 1 artykuł premium miesięcznie bez opłat.",
    );
    expect(t("paywall.meter.registerDesc", { count: 3 })).toBe(
      "Załóż bezpłatne konto i czytaj 3 artykuły premium miesięcznie bez opłat.",
    );
    expect(t("paywall.meter.registerDesc", { count: 5 })).toBe(
      "Załóż bezpłatne konto i czytaj 5 artykułów premium miesięcznie bez opłat.",
    );
  });

  it("EN: one/other bez polskich form pośrednich", () => {
    const t = realT("en");
    expect(t("paywall.meter.remaining", { count: 1 })).toBe("You have 1 free article left.");
    expect(t("paywall.meter.remaining", { count: 5 })).toBe("You have 5 free articles left.");
    expect(t("paywall.meter.registerDesc", { count: 1 })).toBe(
      "Create a free account and read 1 premium article a month at no cost.",
    );
  });

  it("interpolacja zużycia i limitu działa w obu językach", () => {
    expect(realT("pl")("paywall.meter.exhaustedDesc", { used: 3, limit: 5 })).toBe(
      "Przeczytano 3 z 5 darmowych artykułów w tym miesiącu. Wybierz plan, aby czytać bez ograniczeń.",
    );
    expect(realT("en")("paywall.meter.exhaustedDesc", { used: 3, limit: 5 })).toBe(
      "You have read 3 of 5 free articles this month. Choose a plan to read without limits.",
    );
  });
});
