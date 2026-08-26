// Bramka CI: żaden klucz i18n używany na powierzchni MODUŁU WYDARZEŃ nie może
// istnieć wyłącznie w kodzie.
//
// DLACZEGO OSOBNO OD PARYTETU PL/EN. Parytet porównuje słowniki ze sobą, więc
// klucz nieobecny w OBU jest dla niego niewidzialny - a to najczęstszy sposób,
// w jaki panel pokazuje gołe klucze: `adminEvents.types.errors.capacity` wpisany
// w regułach domeny i nigdy nie dopisany do nakładki przechodzi `tsc`, przechodzi
// parytet i przechodzi przegląd, bo w kodzie wygląda identycznie jak klucz żywy.
//
// Ta bramka patrzy od strony KODU i traktuje `defaultValue` jako obciążenie,
// nie zabezpieczenie.
//
// ZAKRES OBEJMUJE `lib/events`, a nie tylko komponenty. Mapy `Record<Enum, string>`
// (`EVENT_FORMAT_LABEL_KEYS` i trzy siostrzane) oraz reguły katalogu zwracają
// KLUCZE, nie napisy - czyli cała warstwa, w której rozjazd jest niewidoczny,
// leży poza JSX-em.
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

const SCANNED_DIRS = ["src/components/admin/events", "src/lib/events"] as const;

/**
 * Trasy modułu leżą wśród setek innych, więc bierzemy je po nazwie.
 *
 * PREFIKSY SĄ DWA, bo trasy studium wydarzenia nazywają się `admin.events_.…` -
 * podkreślnik wypina je z układu `admin.events.tsx` i jednocześnie wypycha poza
 * `startsWith("admin.events.")`. Bez drugiego prefiksu piętnaście ekranów
 * studia wypadłoby ze skanu i mogłoby wołać klucze spoza słownika.
 */
const SCANNED_ROUTE_PREFIXES = ["admin.events.", "admin.events_."] as const;

/**
 * Korzenie, w których goły literał w kodzie jest referencją do klucza.
 * `adminEvents` obejmuje zarówno mapy etykiet enumów, jak i klucze reguł
 * katalogu zwracane przez `eventTypeDraftIssue` i `eventType*Failure`.
 */
const REFERENCE_PREFIXES = ["adminEvents"] as const;

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
 * Moduł renderuje etykiety enumów przez interpolację `adminEvents.formats.${row}`,
 * więc skaner widzi GAŁĄŹ, nie liść. Reklasyfikacja jest zyskiem: `prefix`
 * uruchamia MOCNIEJSZE sprawdzenie - porównuje ZBIORY podkluczy PL i EN, więc
 * łapie gałąź, w której jednemu językowi brakuje jednej wartości.
 */
function normalizeBranchReferences(usages: readonly KeyUsage[], pl: ResourceTree): KeyUsage[] {
  return usages.map((usage) =>
    usage.kind === "reference" && isTree(readKey(pl, usage.key))
      ? { ...usage, kind: "prefix" as const }
      : usage,
  );
}

describe("słownik modułu wydarzeń - bramka rozjazdu kod <-> PL/EN", () => {
  it("każdy klucz użyty w kodzie wydarzeń istnieje w PL i w EN", () => {
    loadOverlays();
    const pl = bundle("pl", corePl as ResourceTree);
    const en = bundle("en", coreEn as ResourceTree);
    const usage = normalizeBranchReferences(collectUsage(), pl);
    // Skan musi realnie coś znaleźć - inaczej zielona bramka nic nie dowodzi.
    expect(usage.length).toBeGreaterThan(40);

    const audit = auditKeyUsage(usage, { pl, en });

    expect(keyUsageFailed(audit), renderKeyUsageReport(audit)).toBe(false);
  });

  it("skan pokrywa mapy etykiet enumów (kanarek zasięgu)", () => {
    const keys = new Set(collectUsage().map((u) => u.key));
    // Cztery gałęzie renderowane przez `Record<Enum, string>` albo interpolację.
    // Gdyby skaner przestał je widzieć, bramka wyżej zrobiłaby się pusta i zielona.
    for (const key of [
      "adminEvents.formats.onsite",
      "adminEvents.registrationModes.rsvp",
      "adminEvents.registrationFlows.instant",
      "adminEvents.guestModes.teaser",
    ]) {
      expect(keys, `brak klucza ${key} w skanie`).toContain(key);
    }
  });

  it("żadne wywołanie t() w wydarzeniach nie polega na defaultValue", () => {
    // `defaultValue` zamienia brak klucza w cichą awarię: klucz nieobecny w OBU
    // słownikach przechodzi parytet, a użytkownik dostaje surową wartość z bazy -
    // po angielsku, w polskim interfejsie.
    const masked = collectUsage().filter((u) => u.defaultValue !== null);
    expect(masked.map((u) => `${u.file}:${u.line} ${u.key} -> "${u.defaultValue}"`)).toEqual([]);
  });
});
