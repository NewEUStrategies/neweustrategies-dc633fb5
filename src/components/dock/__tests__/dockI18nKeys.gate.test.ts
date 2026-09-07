// Bramka CI: żaden klucz i18n używany w PRZESTRZENI ROBOCZEJ CZŁONKA nie może
// istnieć wyłącznie w kodzie.
//
// ── DLACZEGO OSOBNO OD PARYTETU PL/EN ───────────────────────────────────
// Parytet porównuje słowniki ZE SOBĄ, więc klucz nieobecny w OBU jest dla
// niego niewidzialny. Co więcej, bramka parytetu blokuje tylko prefiksy
// z listy `GATED_PREFIXES` - a „dock" na tej liście NIE STOI, czyli rozjazd
// w tym module jest dziś wyłącznie ostrzeżeniem w logu. Ta bramka domyka to
// od strony KODU dla powierzchni, która renderuje kilkadziesiąt napisów.
//
// ── DLACZEGO WŁAŚNIE TERAZ ──────────────────────────────────────────────
// Bramka `check:i18n-overlay-imports` jest ŚLEPA na `i18n-dock.ts`: jej
// skaner szuka eksportu `const pl`, a ten plik eksportuje `dockPl` - czyli
// dla nakładki doku widzi ZERO kluczy. Dziewięć plików doku wołało `dock.*`
// bez `import "@/lib/i18n-dock"` i żadna bramka tego nie zgłaszała. Import
// jest już wszędzie dopisany, a ten plik pilnuje drugiej połowy: że każdy
// wołany klucz naprawdę istnieje w obu językach.
//
// Wzorzec (skan + `auditKeyUsage` + kanarek zasięgu) wzięty z bramek
// `clubI18nKeys` i `networkI18nKeys` - moduł o własnej powierzchni dostaje
// własną bramkę wpiętą w `check:i18n-parity`.
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
import { dockEn, dockPl } from "@/lib/i18n-dock";

const SCANNED_DIRS = ["src/components/dock", "src/lib/dock"] as const;

/** Prefiksy, pod którymi goły literał w kodzie jest referencją do klucza. */
const REFERENCE_PREFIXES = ["dock"] as const;

function isTree(value: unknown): value is ResourceTree {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

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
      // Pliki testowe są poza skanem - to one deklarują klucze-atrapy.
      if (entry === "__tests__") continue;
      out.push(...sourceFiles(path));
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry)) out.push(path);
  }
  return out;
}

function collectUsage(): KeyUsage[] {
  const out: KeyUsage[] = [];
  for (const file of SCANNED_DIRS.flatMap((dir) => sourceFiles(dir))) {
    out.push(
      ...scanKeyUsage(file, readFileSync(file, "utf8"), {
        referencePrefixes: [...REFERENCE_PREFIXES],
      }),
    );
  }
  return out;
}

/**
 * Dok przekazuje GAŁĘZIE, nie pełne klucze: `t(`dock.tools.${tool}`)`,
 * `t(`dock.saved.filters.${value}`)`, `t(`dock.todos.priority.${value}`)`.
 * Skaner widzi wtedy goły literał i klasyfikuje go jako liść, więc bez tej
 * normalizacji bramka zgłaszałaby brak dla każdej takiej gałęzi.
 *
 * Reklasyfikacja jest ZYSKIEM: `prefix` uruchamia MOCNIEJSZE sprawdzenie -
 * porównuje ZBIORY podkluczy PL i EN, czyli łapie gałąź, w której jednemu
 * językowi brakuje jednej wartości. Gałąź nieistniejąca po żadnej stronie
 * nadal oblewa, tyle że jako `branch_missing`.
 */
function normalizeBranchReferences(usages: readonly KeyUsage[], pl: ResourceTree): KeyUsage[] {
  return usages.map((usage) =>
    usage.kind === "reference" && isTree(readKey(pl, usage.key))
      ? { ...usage, kind: "prefix" as const }
      : usage,
  );
}

describe("słownik przestrzeni roboczej - bramka rozjazdu kod <-> PL/EN", () => {
  it("każdy klucz użyty w kodzie doku istnieje w PL i w EN", () => {
    loadOverlays();
    const pl = bundle("pl", corePl as ResourceTree);
    const en = bundle("en", coreEn as ResourceTree);
    const usage = normalizeBranchReferences(collectUsage(), pl);
    // Skan musi realnie coś znaleźć - inaczej zielona bramka nic nie dowodzi.
    expect(usage.length).toBeGreaterThan(40);

    const audit = auditKeyUsage(usage, { pl, en });
    expect(keyUsageFailed(audit), renderKeyUsageReport(audit)).toBe(false);
  });

  it("skan pokrywa gałęzie renderowane przez interpolację (kanarek zasięgu)", () => {
    const keys = new Set(
      normalizeBranchReferences(collectUsage(), dockPl as ResourceTree).map((u) => u.key),
    );
    for (const key of [
      "dock.tools",
      "dock.saved.filters",
      "dock.todos.priority",
      "dock.notes.scope",
    ]) {
      expect(keys, `brak gałęzi ${key} w skanie`).toContain(key);
    }
  });

  it("żadne wywołanie t() w doku nie polega na defaultValue", () => {
    // `defaultValue` zamienia brak klucza w cichą awarię: klucz nieobecny
    // w OBU słownikach przechodzi parytet, a użytkownik dostaje tekst
    // wpisany w kod - po polsku, także w interfejsie angielskim.
    const masked = collectUsage().filter((u) => u.defaultValue !== null);
    expect(masked.map((u) => `${u.file}:${u.line} ${u.key} -> "${u.defaultValue}"`)).toEqual([]);
  });
});

describe("liczby mnogie: PL ma cztery formy, EN dwie", () => {
  const chatPl = dockPl.dock.chat as Record<string, string>;
  const chatEn = dockEn.dock.chat as Record<string, string>;

  it("`minimizedMore` ma polskie formy _one/_few/_many/_other", () => {
    // Regresja: jedna forma drukowała „Jeszcze 1 zminimalizowane rozmowy",
    // i to była wartość NAJCZĘSTSZA - limit widocznych pigułek to 2, więc
    // pierwsza ukryta rozmowa daje count=1.
    for (const suffix of ["_one", "_few", "_many", "_other"]) {
      expect(chatPl, `brak minimizedMore${suffix} w PL`).toHaveProperty(`minimizedMore${suffix}`);
    }
    // Forma bez sufiksu MUSI zniknąć - i18next wolałby ją od wariantów.
    expect(chatPl).not.toHaveProperty("minimizedMore");
  });

  it("angielski ma _one i _other, i to są DWA RÓŻNE napisy", () => {
    expect(chatEn).toHaveProperty("minimizedMore_one");
    expect(chatEn).toHaveProperty("minimizedMore_other");
    expect(chatEn.minimizedMore_one).not.toBe(chatEn.minimizedMore_other);
    expect(chatEn).not.toHaveProperty("minimizedMore");
  });

  it("i18next FAKTYCZNIE wybiera właściwą formę dla 1, 2 i 5", () => {
    // Asercja wykonawcza, nie strukturalna: sam zestaw kluczy nie dowodzi,
    // że reguła mnogości dla polskiego jest w tej instancji aktywna.
    const t = i18n.getFixedT("pl");
    expect(t("dock.chat.minimizedMore", { count: 1 })).toBe(
      chatPl.minimizedMore_one?.replace("{{count}}", "1"),
    );
    expect(t("dock.chat.minimizedMore", { count: 2 })).toBe(
      chatPl.minimizedMore_few?.replace("{{count}}", "2"),
    );
    expect(t("dock.chat.minimizedMore", { count: 5 })).toBe(
      chatPl.minimizedMore_many?.replace("{{count}}", "5"),
    );
  });
});

describe("parytet drzewa doku", () => {
  function flatten(tree: unknown, prefix = ""): string[] {
    if (!isTree(tree)) return [prefix];
    return Object.entries(tree).flatMap(([key, value]) =>
      flatten(value, prefix ? `${prefix}.${key}` : key),
    );
  }

  it("PL i EN mają ten sam zbiór kluczy, z wyjątkiem polskich form mnogich", () => {
    const pl = new Set(flatten(dockPl));
    const en = new Set(flatten(dockEn));
    // `_few` i `_many` istnieją tylko po polsku - parytet zwalnia z nich EN.
    const plOnly = [...pl].filter((key) => !en.has(key) && !/_(few|many)$/.test(key));
    const enOnly = [...en].filter((key) => !pl.has(key));
    expect(plOnly, "klucze tylko w PL").toEqual([]);
    expect(enOnly, "klucze tylko w EN").toEqual([]);
  });
});
