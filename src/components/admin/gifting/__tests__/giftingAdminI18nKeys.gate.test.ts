// BRAMKA CI: zaden klucz i18n uzywany przez PANEL PREZENTOW nie moze istniec
// wylacznie w kodzie.
//
// PO CO OSOBNO OD PARYTETU PL/EN. Parytet porownuje slowniki ze soba, wiec
// klucz nieobecny w OBU jest dla niego niewidzialny - a to najczestszy sposob,
// w jaki panel pokazuje gole klucze. Ta bramka patrzy od strony KODU.
//
// DLACZEGO AKURAT TERAZ. Trasa `admin.gifting.tsx` zostala wlasnie rozbita na
// atomy, molekuly i organizmy. Przy takiej operacji klucze przenosi sie
// mechanicznie razem z JSX-em, a najlatwiej zgubic wtedy PRZESTRZEN NAZW:
// `t("links.filterAll")` zamiast `t("giftingAdmin.links.filterAll")` wyglada
// w nowym, malym pliku zupelnie naturalnie, przechodzi `tsc`, przechodzi
// przeglad i pokazuje gole "links.filterAll" dopiero na ekranie admina.
// Ta bramka pilnuje calego katalogu `src/components/admin/gifting` razem
// z trasa, wiec nowy plik jest objety automatycznie.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import i18n from "@/lib/i18n";
import { pl as corePl } from "@/lib/locale/pl";
import { en as coreEn } from "@/lib/locale/en";
import { readKey, type ResourceTree } from "@/lib/ci/i18nParity";
import {
  auditKeyUsage,
  keyUsageFailed,
  renderKeyUsageReport,
  scanKeyUsage,
  type KeyUsage,
} from "@/lib/ci/i18nKeyUsage";

const SCANNED_DIRS = ["src/components/admin/gifting"] as const;
const SCANNED_ROUTES = ["src/routes/admin.gifting.tsx"] as const;

/** Korzen, w ktorym goly literal w kodzie jest referencja do klucza. */
const REFERENCE_PREFIXES = ["giftingAdmin"] as const;

function isTree(value: unknown): value is ResourceTree {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Nakladki i18n rejestruja zasoby jako efekt uboczny importu. */
function loadOverlays(): void {
  const modules = import.meta.glob("/src/lib/i18n-*.ts", { eager: true });
  expect(Object.keys(modules).length).toBeGreaterThan(0);
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

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      // Pliki testowe sa poza skanem - to one deklaruja klucze-atrapy.
      if (entry === "__tests__") continue;
      out.push(...sourceFiles(path));
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry)) out.push(path);
  }
  return out;
}

function collectUsage(): KeyUsage[] {
  const files = [...SCANNED_DIRS.flatMap((dir) => sourceFiles(dir)), ...SCANNED_ROUTES];
  return files.flatMap((file) =>
    scanKeyUsage(file, readFileSync(file, "utf8"), {
      referencePrefixes: [...REFERENCE_PREFIXES],
    }),
  );
}

/**
 * Etykiety statusow i typow zdarzen skladamy interpolacja
 * (`giftingAdmin.links.status.${s}`), wiec skaner widzi GALAZ, nie lisc.
 * Reklasyfikacja na `prefix` uruchamia MOCNIEJSZE sprawdzenie: porownanie
 * ZBIOROW podkluczy PL i EN, czyli lapie galaz, w ktorej jednemu jezykowi
 * brakuje jednej wartosci.
 */
function normalizeBranchReferences(usages: readonly KeyUsage[], pl: ResourceTree): KeyUsage[] {
  return usages.map((usage) =>
    usage.kind === "reference" && isTree(readKey(pl, usage.key))
      ? { ...usage, kind: "prefix" as const }
      : usage,
  );
}

describe("slownik panelu prezentow - bramka rozjazdu kod <-> PL/EN", () => {
  it("skan realnie cos znajduje (bramka nie jest pusta i zielona)", () => {
    const usage = collectUsage();
    expect(usage.length).toBeGreaterThan(40);
  });

  it("kazdy klucz uzyty w panelu prezentow istnieje w PL i w EN", () => {
    loadOverlays();
    const pl = bundle("pl", corePl as ResourceTree);
    const en = bundle("en", coreEn as ResourceTree);
    const usage = normalizeBranchReferences(collectUsage(), pl);
    const audit = auditKeyUsage(usage, { pl, en });
    expect(keyUsageFailed(audit), renderKeyUsageReport(audit)).toBe(false);
  });

  it("KAZDY klucz panelu siedzi w przestrzeni `giftingAdmin.` (ekstrakcja nic nie zgubila)", () => {
    // To jest asercja wprost pod ryzyko rozbicia trasy na komponenty:
    // `t("links.filterAll")` w malym pliku wyglada naturalnie i nic go nie
    // zatrzymuje az do ekranu admina.
    const obce = collectUsage()
      .filter((u) => !u.key.startsWith("giftingAdmin."))
      .map((u) => `${u.file}:${u.line} ${u.key}`);
    expect(obce).toEqual([]);
  });

  it("kanarek zasiegu: skan widzi wszystkie trzy zakladki, atomy i molekule", () => {
    // Gdyby skaner przestal widziec ktorykolwiek z tych plikow, bramka wyzej
    // zrobilaby sie zielona przez sam brak danych.
    const keys = new Set(collectUsage().map((u) => u.key));
    for (const key of [
      "giftingAdmin.tabs.settings",
      "giftingAdmin.stats.active",
      "giftingAdmin.settings.capZeroWarning",
      "giftingAdmin.settings.errors",
      "giftingAdmin.links.confirmRevoke",
      "giftingAdmin.links.status",
      "giftingAdmin.audit.anonymous",
      "giftingAdmin.audit.type",
      "giftingAdmin.common.loading",
    ]) {
      expect(keys, `brak klucza ${key} w skanie`).toContain(key);
    }
  });

  it("jedyne `defaultValue` panelu to WARTOSC RUNTIME'OWA, nie tekst z kodu", () => {
    // `defaultValue` z literalem zamienia brak klucza w cicha awarie: klucz
    // nieobecny w OBU slownikach przechodzi parytet, a uzytkownik dostaje
    // tekst wpisany w kodzie. Panel audytu uzywa `defaultValue: e.event_type`,
    // czyli SUROWEJ nazwy nieznanego zdarzenia z bazy - to jest swiadomy
    // fallback dla typow, ktorych ten build nie zna, i skaner (slusznie)
    // nie liczy go jako zapasowego tekstu.
    const masked = collectUsage().filter((u) => u.defaultValue !== null);
    expect(masked.map((u) => `${u.file}:${u.line} ${u.key} -> "${u.defaultValue}"`)).toEqual([]);
  });

  it("galezie liczebnikowe PL maja komplet form (count w capNote i recipients)", () => {
    // Polskie liczebniki wymagaja `_one/_few/_many/_other`; brak jednej formy
    // pokazuje surowy klucz przy akurat tej liczbie linkow.
    loadOverlays();
    const pl = bundle("pl", corePl as ResourceTree);
    const links = readKey(pl, "giftingAdmin.links");
    expect(isTree(links)).toBe(true);
    const names = isTree(links) ? Object.keys(links) : [];
    for (const base of ["capNote", "recipients"]) {
      for (const form of ["one", "few", "many", "other"]) {
        expect(names, `brak formy ${base}_${form}`).toContain(`${base}_${form}`);
      }
    }
  });
});
