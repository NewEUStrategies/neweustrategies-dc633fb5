// Eksporty rdzenia (`@/lib/locale/pl|en`) po rejestracji WSZYSTKICH nakładek.
//
// PO CO. Ponad dwadzieścia bramek i testów słowników (parytet, dryf kluczy,
// ratchety nakładek, testy kluczy per obszar) czyta `pl`/`en` z
// `@/lib/locale/*` jako CZYSTY rdzeń i porównuje z nim to, co wniosły nakładki
// `lib/i18n-*`. Dopóki `lib/i18n.ts` oddawał i18next te obiekty bez kopii,
// każda nakładka scalała się w nie w miejscu (i18next trzyma zasoby z `init`
// przez referencję, a `addResourceBundle(..., deep=true)` scala w obiekt ze
// store). W środowisku testów (happy-dom = ścieżka klienta, rdzeń PL z init)
// „rdzeń" PL był więc już słownikiem scalonym, a EN - nie: ratchet podmian
// w `i18nNotifications.test.ts` nie widział przez to siedmiu polskich podmian,
// a kilka testów broniło się ręcznym `structuredClone` przed importem nakładek.
//
// Tu: prawdziwe nakładki (wszystkie), oba języki - PL z init, EN dociągnięty
// leniwie przez `changeLanguage` - i zdjęcie eksportów sprzed pierwszej nakładki.
// Ścieżkę serwera (oba rdzenie z init) pilnuje `i18nServerRuntime.test.ts`.
import { afterAll, describe, expect, it } from "vitest";
import i18n from "@/lib/i18n";
import { pl as corePl } from "@/lib/locale/pl";
import { en as coreEn } from "@/lib/locale/en";

/** Zdjęcie eksportów - nakładki ładowane są dopiero w teście (glob leniwy). */
const PRISTINE = structuredClone({ pl: corePl, en: coreEn });
const LOADERS = import.meta.glob("/src/lib/i18n-*.ts");

/** Klucz żyjący wyłącznie w nakładce `i18n-admin-extras.ts` (kanarek jak w `scripts/lib/i18nDictionaries.ts`). */
const OVERLAY_ONLY_KEY = "admin.autosave.saving";

function leafCount(node: unknown): number {
  if (node === null || typeof node !== "object" || Array.isArray(node)) return 1;
  return Object.values(node).reduce<number>((sum, child) => sum + leafCount(child), 0);
}

afterAll(async () => {
  await i18n.changeLanguage("pl");
});

describe("eksporty `@/lib/locale/*` po rejestracji wszystkich nakładek", () => {
  it("rdzeń PL (init) i EN (leniwy) zostają czyste, a store ma rdzeń i nakładki", async () => {
    const paths = Object.keys(LOADERS).sort();
    expect(paths.length, "glob nakładek pusty - test byłby atrapą").toBeGreaterThan(100);
    for (const path of paths) await LOADERS[path]!();
    await i18n.changeLanguage("en");

    for (const lng of ["pl", "en"] as const) {
      const t = i18n.getFixedT(lng);
      expect(t(OVERLAY_ONLY_KEY), `${lng}: nakładki nie weszły`).not.toBe(OVERLAY_ONLY_KEY);
      expect(t("auth.signin"), `${lng}: brak rdzenia w store`).not.toBe("auth.signin");
      const store = i18n.getResourceBundle(lng, "translation");
      const core = lng === "pl" ? PRISTINE.pl : PRISTINE.en;
      expect(leafCount(store), `${lng}: nakładki nic nie dodały`).toBeGreaterThan(leafCount(core));
    }
    expect(corePl).toEqual(PRISTINE.pl);
    expect(coreEn).toEqual(PRISTINE.en);
  });
});
