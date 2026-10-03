// Bramka: `Trans` z react-i18next nie wchodzi do kodu produkcyjnego.
//
// DLACZEGO. `vendor-i18n` (vite.config.ts) to współdzielony chunk vendorowy
// statycznie osiągalny z entry - leży w domknięciu startowym KAŻDEJ strony.
// `Trans` jako jedyny eksport react-i18next ciągnie parser HTML
// (`html-parse-stringify` + `void-elements`). Zmierzone 2026-10-03
// (`check:bundle` w CI): jedno `<Trans>` w panelu /admin/i18n podniosło
// `vendor-i18n` o 3,9 KB, a domknięcie startowe o 4,1 KB gzip - koszt płacony
// przez każdego czytelnika strony publicznej za jedno zdanie panelu admina.
// Pogrubienia w tłumaczeniach robi się lokalnie (np. `renderBold`
// w `components/admin/i18n/WidgetI18nAuditPane.tsx`).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(process.cwd(), "src");

function productionSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__" || entry === "test") continue;
      productionSources(full, out);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Import `Trans` z react-i18next (także `Trans as X`), w jednej lub wielu liniach. */
const TRANS_IMPORT = /import\s*(?:type\s*)?\{[^}]*\bTrans\b[^}]*\}\s*from\s*["']react-i18next["']/;

describe("react-i18next Trans poza budżetem startowym", () => {
  it("żaden plik produkcyjny nie importuje Trans", () => {
    const offenders = productionSources(ROOT)
      .filter((file) => TRANS_IMPORT.test(readFileSync(file, "utf8")))
      .map((file) => relative(process.cwd(), file));
    expect(offenders).toEqual([]);
  });

  it("KONTROLA NEGATYWNA: wzorzec łapie import jedno- i wieloliniowy", () => {
    expect(TRANS_IMPORT.test('import { Trans, useTranslation } from "react-i18next";')).toBe(true);
    expect(
      TRANS_IMPORT.test("import {\n  useTranslation,\n  Trans as T,\n} from 'react-i18next';"),
    ).toBe(true);
    expect(TRANS_IMPORT.test('import { useTranslation } from "react-i18next";')).toBe(false);
    expect(TRANS_IMPORT.test('import { TranslateCard } from "./TranslateCard";')).toBe(false);
  });
});
