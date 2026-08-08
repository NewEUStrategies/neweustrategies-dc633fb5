// Bramka CI: żaden klucz i18n używany na powierzchni KLUBÓW DYSKUSYJNYCH nie
// może istnieć wyłącznie w kodzie.
//
// DLACZEGO OSOBNO OD PARYTETU PL/EN. Parytet porównuje słowniki ze sobą, więc
// klucz nieobecny w OBU jest dla niego niewidzialny. Audyt wdrożenia modułu
// (PR 196-204) znalazł dokładnie ten wzorzec w czterech miejscach naraz,
// a wszystkie cztery przeszły przez review z zielonym CI:
//
//   * `club.memberRole.*` - słownik ma `club.role.*`, więc masowa zmiana roli
//     w panelu członków renderowała gołe klucze w droplistcie;
//   * `adminClubs.invites.*` - słownik ma `adminClubs.invitations.*`, więc
//     katalog elementów pokazywał dwadzieścia gołych kluczy;
//   * `adminClubs.invites.statusName.*` z `defaultValue: row.status` - tabela
//     zaproszeń wypisywała surowy angielski status z bazy w polskim UI;
//   * `club.sort.subscribed` i `club.replySort.stance` - wartości słownika
//     kodu bez wpisu w słowniku języka.
//
// Żadnego z nich nie dało się zobaczyć porównaniem PL z EN. Ta bramka patrzy
// od strony KODU i traktuje `defaultValue` jako obciążenie, nie zabezpieczenie.
//
// Zakres: komponenty produktowe, komponenty panelu, warstwa danych i trasy -
// czyli wszystko, co renderuje napis w tym module.
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

const SCANNED_DIRS = [
  "src/components/clubs",
  "src/components/admin/clubs",
  "src/lib/clubs",
] as const;

/** Trasy modułu leżą wśród setek innych, więc bierzemy je po nazwie. */
const SCANNED_ROUTE_PREFIXES = ["club.", "admin.community.clubs."] as const;

// Korzenie, w których goły literał w kodzie jest referencją do klucza
// (mapy kodów RPC -> klucz, propsy `i18nPrefix` / `hintPrefix`, słowniki
// rodzajów wątku przekazywane do `VocabRow`).
const REFERENCE_PREFIXES = ["club", "adminClubs", "clubElements"] as const;

function isTree(value: unknown): value is ResourceTree {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Nakładki i18n rejestrują zasoby jako efekt uboczny importu. */
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

function routeFiles(): string[] {
  return readdirSync("src/routes")
    .filter((name) => SCANNED_ROUTE_PREFIXES.some((prefix) => name.startsWith(prefix)))
    .filter((name) => /\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name))
    .map((name) => join("src/routes", name));
}

function collectUsage(): KeyUsage[] {
  const out: KeyUsage[] = [];
  const files = [...SCANNED_DIRS.flatMap((dir) => sourceFiles(dir)), ...routeFiles()];
  for (const file of files) {
    out.push(
      ...scanKeyUsage(file, readFileSync(file, "utf8"), {
        referencePrefixes: [...REFERENCE_PREFIXES],
      }),
    );
  }
  return out;
}

/**
 * Ten moduł przekazuje w propsach GAŁĘZIE, nie pełne klucze: `ClubEnumSelect`
 * dostaje `i18nPrefix="club.visibility"` i sam dokleja wartość słownika kodu,
 * `VocabRow` w katalogu elementów robi to samo przez `prefix`. Skaner widzi
 * goły literał i klasyfikuje go jako `reference` (czyli liść), więc bez tej
 * normalizacji bramka zgłaszałaby `missing_both` dla każdej takiej gałęzi.
 *
 * Reklasyfikacja jest zyskiem, nie ustępstwem: `prefix` uruchamia MOCNIEJSZE
 * sprawdzenie - porównuje ZBIORY podkluczy PL i EN, więc łapie gałąź, w której
 * jednemu językowi brakuje jednej wartości (dokładnie ten przypadek co
 * `club.sort.subscribed`). Gałąź nieistniejąca po żadnej stronie nadal oblewa,
 * tyle że jako `branch_missing`.
 */
function normalizeBranchReferences(usages: readonly KeyUsage[], pl: ResourceTree): KeyUsage[] {
  return usages.map((usage) =>
    usage.kind === "reference" && isTree(readKey(pl, usage.key))
      ? { ...usage, kind: "prefix" as const }
      : usage,
  );
}

describe("słownik klubów dyskusyjnych - bramka rozjazdu kod <-> PL/EN", () => {
  it("każdy klucz użyty w kodzie klubów istnieje w PL i w EN", () => {
    loadOverlays();
    const pl = bundle("pl", corePl as ResourceTree);
    const en = bundle("en", coreEn as ResourceTree);
    const usage = normalizeBranchReferences(collectUsage(), pl);
    // Skan musi realnie coś znaleźć - inaczej zielona bramka nic nie dowodzi.
    expect(usage.length).toBeGreaterThan(200);

    const audit = auditKeyUsage(usage, { pl, en });

    expect(keyUsageFailed(audit), renderKeyUsageReport(audit)).toBe(false);
  });

  it("skan pokrywa słowniki dynamiczne modułu (kanarek zasięgu)", () => {
    const keys = new Set(collectUsage().map((u) => u.key));
    // Po jednym kluczu na każdą gałąź, która jest renderowana przez interpolację
    // `${prefix}.${value}`. To są dokładnie te miejsca, w których rozjazd nie
    // rzuca się w oczy - gdyby skaner przestał je widzieć, bramka wyżej zrobiła
    // by się pusta i zielona.
    for (const key of [
      "club.kind",
      "club.role",
      "club.reason",
      "club.sort",
      "club.replySort",
      "club.stance",
      "club.report.reason",
      "club.anchorType",
      "club.visibility",
      "adminClubs.invitations.statusName",
    ]) {
      expect(keys, `brak gałęzi ${key} w skanie`).toContain(key);
    }
  });

  it("żadne wywołanie t() w klubach nie polega na defaultValue", () => {
    // `defaultValue` zamienia brak klucza w cichą awarię: klucz nieobecny
    // w OBU słownikach przechodzi parytet, a użytkownik dostaje surową wartość
    // z bazy - po angielsku, w polskim interfejsie.
    const masked = collectUsage().filter((u) => u.defaultValue !== null);
    expect(masked.map((u) => `${u.file}:${u.line} ${u.key} -> "${u.defaultValue}"`)).toEqual([]);
  });
});
