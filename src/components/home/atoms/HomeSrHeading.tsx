// Nagłówek POZIOMU 1 strony głównej - zapasowy, `sr-only`, właścicielem jest
// sama strona główna.
//
// DLACZEGO WRÓCIŁ (regresja odziedziczona z `main`, bramka `e2e`:
// `e2e/ssr-completeness.spec.ts` wymaga DOKŁADNIE jednego `<h1>` w HTML-u
// serwera dla `/` i `/en`). 2026-09-14 ten atom został skasowany (commit
// ead1f02), a pięć minut później (e246675) jedyny `h1` strony głównej
// zamieszkał w chrome nagłówka witryny: `components/header/atoms/
// HeaderSeoHeading.tsx`, renderowany przez `components/Header.tsx` pod
// warunkiem `isHome`. Przeniesienie wyglądało na neutralne, ale przypięło
// najważniejszy nagłówek SEO serwisu do CUDZYCH DANYCH: `Header` zwraca
// `HeaderSkeleton` (zero nagłówków), gdy `site_settings` nie dojechały
// (`dataUpdatedAt === 0`) ALBO gdy nie ma w nich kanwy nagłówka
// (`header.builder_data.sections`). Przy martwym backendzie - a taki jest
// kontrakt suity e2e (placeholderowe poświadczenia Supabase) - strona główna
// zostawała więc BEZ ŻADNEGO `h1`: ani w powłoce, ani w treści.
//
// INWARIANT, KTÓREGO TEN ATOM PILNUJE: strona główna ma DOKŁADNIE JEDEN
// nagłówek poziomu 1, niezależnie od stanu bazy. Ten `h1` jest ZAPASEM, więc
// nie renderuje się, gdy nagłówek poziomu 1 wypisuje już ktoś inny:
//   * chrome nagłówka witryny (`HeaderSeoHeading`) - patrz
//     `siteHeaderHasHomeHeading`,
//   * sam dokument buildera strony głównej (widget z tagiem `h1` albo `<h1>`
//     w treści bogatej) - `builderDocHasTopHeading`.
// To ta sama reguła, którą dla stron CMS-owych trzyma `BuilderPageShell`
// (audyt 2026-08-06, korekta 2): DWA `h1` to defekt dostępności i SEO, a nie
// kosmetyka, więc zapas musi być WARUNKOWY, a nie bezwarunkowy.
//
// DLACZEGO `sr-only`, SKORO 2026-09-14 NAGŁÓWEK BYŁ WIDOCZNY. Nowsza decyzja
// repozytorium (`HeaderSeoHeading`, komentarz „wymóg redakcyjny") mówi wprost:
// `h1` ma istnieć w kodzie strony, ale nie ma być widoczny w layoucie - kanwa
// strony głównej rysuje własny hero i drugi, dorysowany pasek tytułu psułby
// projekt. Komentarz bramki e2e mówi to samo („strona główna używa H1
// `sr-only`"). `sr-only`, a nie `hidden`/`display:none` - nagłówek MUSI zostać
// w drzewie dostępności.
//
// TREŚĆ NIE JEST JUŻ DWUJĘZYCZNYM LITERAŁEM W KODZIE (dawny dług tego atomu,
// udokumentowany wtedy testem `it.fails`). Nagłówek bierze DOKŁADNIE to samo
// źródło co domyślny `<title>` strony głównej: redakcyjny tytuł serwisu
// z `site_settings["seo"]` (panel /admin/settings/site-identity) z fallbackiem
// na stałą marki. `head()` czyta go przez `siteTitle()` -> `brandDefaultsFor()`
// (pamięć kluczowana hostem, zasilana przez root loader z TEGO SAMEGO bloba),
// więc oba wyjścia są bajtowo zgodne, a redakcja zmienia je w jednym miejscu.
//
// DLACZEGO NIE `siteTitle()` WPROST. `brandDefaultsFor()` to pamięć modułu
// wypełniana przez root loader - w PRZEGLĄDARCE po hydratacji jest pusta, więc
// komponent czytający ją w fazie renderu dałby inny tekst na serwerze i inny
// na kliencie (niezgodność hydratacji). Mapa ustawień przyjeżdża natomiast
// w dehydratacji zapytań, więc jest identyczna po obu stronach.
import { builderDocHasTopHeading } from "@/lib/builder/headings";
import type { BuilderDocument } from "@/lib/builder/types";
import { SITE_DEFAULT_TITLE } from "@/lib/seo/meta";
import { parseSeoSettings, SEO_SETTINGS_KEY, siteTitleOverride } from "@/lib/seo/settings";
import { resolveSetting, type SettingsMap } from "@/lib/useSiteSetting";

/** Kształt `site_settings["header"]`, który czyta `components/Header.tsx`. */
type HeaderChromeSettings = { builder_data?: BuilderDocument | null };

/**
 * Tekst nagłówka: redakcyjny tytuł serwisu dla języka, a gdy go nie ma - stała
 * marki. Ta sama para co `siteTitle()` w `head()` strony głównej.
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
 * `HeaderSkeleton` zamiast nagłówka: brak danych ustawień i brak kanwy
 * nagłówka. Czytamy to z tego samego zapytania (`siteSettingsQueryOptions`),
 * więc obie powierzchnie widzą ten sam stan także po odświeżeniu danych
 * w przeglądarce - zapas znika dokładnie wtedy, gdy pojawia się nagłówek
 * w powłoce.
 */
export function siteHeaderHasHomeHeading(settings: SettingsMap, dataUpdatedAt: number): boolean {
  if (dataUpdatedAt === 0) return false;
  const cfg = resolveSetting<HeaderChromeSettings>(settings, "header", {});
  return (cfg.builder_data?.sections?.length ?? 0) > 0;
}

export interface HomeSrHeadingProps {
  /** Tekst nagłówka - patrz `homeSrHeadingText`. */
  title: string;
  /** Dokument kanwy strony głównej (`null` w trybie listy wpisów i przy pustce). */
  doc: BuilderDocument | null;
  /** Czy powłoka witryny wypisuje już `h1` - patrz `siteHeaderHasHomeHeading`. */
  siteHeaderHasHeading: boolean;
}

export function HomeSrHeading({ title, doc, siteHeaderHasHeading }: HomeSrHeadingProps) {
  if (siteHeaderHasHeading) return null;
  if (builderDocHasTopHeading(doc)) return null;
  return <h1 className="sr-only">{title}</h1>;
}
