// Bramka CI: parytet kluczy i tłumaczeń PL/EN dla nowych bloków, widgetów
// buildera i raportu porównawczego.
//
// Ładuje rdzenne słowniki (src/lib/locale/{pl,en}.ts) ORAZ wszystkie nakładki
// `src/lib/i18n-*.ts` (rejestrują własne fragmenty w instancji i18next), po
// czym porównuje pełne drzewa zasobów. Bramkowane są prefiksy powierzchni,
// które realnie mają dwie wersje językowe w UI - reszta różnic trafia do logu
// jako ostrzeżenie, żeby bramka nie stała się nieużywalnym szumem.
//
// Zapisuje reports/i18n-parity.json, który konsumuje raport zgodności wdrożenia.
import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import i18n from "@/lib/i18n";
import { pl as corePl } from "@/lib/locale/pl";
import { en as coreEn } from "@/lib/locale/en";
import {
  diffParity,
  parityFailed,
  renderParityReport,
  type ResourceTree,
} from "@/lib/ci/i18nParity";

// Powierzchnie objęte twardą bramką (brak klucza = czerwone CI).
const GATED_PREFIXES = [
  "blocks",
  "builder",
  "comparison",
  "countryCompare",
  "adminBlocks",
  "adminThemeDesign",
] as const;

// Klucze, dla których identyczny tekst PL i EN jest poprawny (nazwy własne,
// skróty, jednostki).
const IDENTICAL_ALLOWLIST: readonly string[] = [];

function loadOverlays(): void {
  // Nakładki rejestrują zasoby jako efekt uboczny importu.
  const modules = import.meta.glob("/src/lib/i18n-*.ts", { eager: true });
  expect(Object.keys(modules).length).toBeGreaterThan(0);
}

function bundle(lang: "pl" | "en", core: ResourceTree): ResourceTree {
  const registered = i18n.getResourceBundle(lang, "translation") as ResourceTree | undefined;
  return { ...core, ...(registered ?? {}) };
}

describe("parytet tłumaczeń PL/EN (bramka CI)", () => {
  it("każdy bramkowany klucz ma wersję PL i EN", () => {
    loadOverlays();

    const pl = bundle("pl", corePl as ResourceTree);
    const en = bundle("en", coreEn as ResourceTree);

    const gated = diffParity(pl, en, {
      gatedPrefixes: [...GATED_PREFIXES],
      identicalAllowlist: IDENTICAL_ALLOWLIST,
    });
    const full = diffParity(pl, en, { identicalAllowlist: IDENTICAL_ALLOWLIST });

    mkdirSync("reports", { recursive: true });
    writeFileSync(
      "reports/i18n-parity.json",
      `${JSON.stringify(
        {
          gatedPrefixes: GATED_PREFIXES,
          missing: [...gated.missingEn, ...gated.missingPl],
          missingEn: gated.missingEn,
          missingPl: gated.missingPl,
          untranslated: gated.untranslated,
          repoWide: {
            missingEn: full.missingEn.length,
            missingPl: full.missingPl.length,
            untranslated: full.untranslated.length,
          },
        },
        null,
        2,
      )}\n`,
    );

    if (parityFailed(full) && !parityFailed(gated)) {
      console.warn(
        `[i18n] Poza bramkowanymi prefiksami: ${full.missingEn.length} kluczy bez EN, ${full.missingPl.length} bez PL.`,
      );
    }

    expect(parityFailed(gated), renderParityReport(gated)).toBe(false);
  });
});
