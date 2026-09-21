// SKĄD strona główna bierze nagłówek poziomu 1 - dwie czyste decyzje, bez
// Reacta. Renderem zajmuje się `HomeSrHeading.tsx`.
//
// PO CO OSOBNO. Obie funkcje czytają mapę `site_settings`, czyli dane, które
// w komponencie przyjeżdżają przez `useSuspenseQuery`. Trzymane w pliku
// komponentu dałyby się sprawdzić wyłącznie przez montaż strony głównej
// z klientem zapytań - najdroższe możliwe pokrycie najtańszej możliwej logiki
// (ten sam argument, co w `homeRenderMode.ts`).
import { SITE_DEFAULT_TITLE } from "@/lib/seo/meta";
import { parseSeoSettings, SEO_SETTINGS_KEY, siteTitleOverride } from "@/lib/seo/settings";
import { resolveSetting, type SettingsMap } from "@/lib/useSiteSetting";
import type { BuilderDocument } from "@/lib/builder/types";

/** Kształt `site_settings["header"]`, który czyta `components/Header.tsx`. */
type HeaderChromeSettings = { builder_data?: BuilderDocument | null };

/**
 * Tekst nagłówka: redakcyjny tytuł serwisu dla języka, a gdy go nie ma - stała
 * marki.
 *
 * TO SAMO ŹRÓDŁO, CO DOMYŚLNY `<title>` STRONY GŁÓWNEJ. `head()` czyta je
 * przez `siteTitle()` -> `brandDefaultsFor()`, czyli przez pamięć kluczowaną
 * hostem, którą root loader zasila z TEGO SAMEGO bloba `site_settings["seo"]`
 * (`/admin/settings/site-identity`). Oba wyjścia są więc bajtowo zgodne,
 * a redakcja zmienia je w jednym miejscu.
 *
 * DLACZEGO NIE `siteTitle()` WPROST: `brandDefaultsFor()` to pamięć modułu
 * wypełniana przez loader, w PRZEGLĄDARCE po hydratacji pusta - komponent,
 * który by ją czytał, dałby inny tekst na serwerze i inny na kliencie
 * (niezgodność hydratacji). Mapa ustawień przyjeżdża w dehydratacji zapytań,
 * więc jest identyczna po obu stronach.
 */
export function homeSrHeadingText(settings: SettingsMap, lang: "pl" | "en"): string {
  const seo = parseSeoSettings(
    resolveSetting<Record<string, unknown>>(settings, SEO_SETTINGS_KEY, {}),
  );
  return siteTitleOverride(seo, lang) || SITE_DEFAULT_TITLE[lang];
}

/**
 * Czy chrome nagłówka witryny wypisze własny `h1` (`HeaderSeoHeading`)?
 *
 * Odtwarza DOKŁADNIE obie bramki, na których `components/Header.tsx` zwraca
 * `HeaderSkeleton` zamiast nagłówka: brak danych ustawień (`dataUpdatedAt === 0`,
 * czyli zasiew awaryjny loadera) i brak kanwy nagłówka w ustawieniach. Czytamy
 * to z tego samego zapytania (`siteSettingsQueryOptions`), więc obie
 * powierzchnie widzą ten sam stan także po odświeżeniu danych w przeglądarce -
 * zapas znika dokładnie wtedy, gdy pojawia się nagłówek w powłoce.
 */
export function siteHeaderHasHomeHeading(settings: SettingsMap, dataUpdatedAt: number): boolean {
  if (dataUpdatedAt === 0) return false;
  const cfg = resolveSetting<HeaderChromeSettings>(settings, "header", {});
  return (cfg.builder_data?.sections?.length ?? 0) > 0;
}
