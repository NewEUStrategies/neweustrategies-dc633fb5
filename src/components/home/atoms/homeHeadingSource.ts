// SKĄD strona główna bierze TREŚĆ nagłówka poziomu 1 - czysta decyzja, bez
// Reacta. Renderem zajmuje się `HomeSrHeading.tsx`.
//
// PO CO OSOBNO. Funkcja czyta mapę `site_settings`, czyli dane, które
// w komponencie przyjeżdżają przez `useSuspenseQuery`. Trzymana w pliku
// komponentu dałaby się sprawdzić wyłącznie przez montaż strony głównej
// z klientem zapytań - najdroższe możliwe pokrycie najtańszej możliwej logiki
// (ten sam argument, co w `homeRenderMode.ts`). Osobny plik jest też wymogiem
// twardym: `react-refresh/only-export-components` przy `--max-warnings=0` nie
// przepuszcza eksportu funkcji z pliku komponentu.
import { SITE_DEFAULT_TITLE } from "@/lib/seo/meta";
import { parseSeoSettings, SEO_SETTINGS_KEY, siteTitleOverride } from "@/lib/seo/settings";
import { resolveSetting, type SettingsMap } from "@/lib/useSiteSetting";

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
