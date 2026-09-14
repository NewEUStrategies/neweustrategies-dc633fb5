import { useSuspenseQuery } from "@tanstack/react-query";

import { SITE_NAME } from "@/lib/seo/meta";
import { parseSeoSettings, SEO_SETTINGS_KEY, siteTitleOverride } from "@/lib/seo/settings";
import { useLang } from "@/lib/i18n/useLang";
import { resolveSetting, siteSettingsQueryOptions } from "@/lib/useSiteSetting";

/**
 * Jedyny nagłówek H1 strony głównej - przyczepiony do logo w headerze.
 *
 * Wymóg redakcyjny: H1 ma istnieć w kodzie strony (dla Google i asystentów AI),
 * ale nie ma być widoczny w layoucie - dlatego jest to `sr-only` etykieta obok
 * logo, a jego treść pochodzi z panelu SEO (`seo.site_title_pl` /
 * `seo.site_title_en`), więc redakcja edytuje ją w jednym miejscu.
 */
export function headerSeoHeadingText(seoRaw: unknown, lang: "pl" | "en"): string {
  return siteTitleOverride(parseSeoSettings(seoRaw), lang) || SITE_NAME;
}

export function HeaderSeoHeading() {
  const lang = useLang();
  const { data: settingsMap } = useSuspenseQuery(siteSettingsQueryOptions);
  const text = headerSeoHeadingText(
    resolveSetting<Record<string, unknown>>(settingsMap, SEO_SETTINGS_KEY, {}),
    lang,
  );
  return (
    <h1 className="sr-only" data-header-seo-heading>
      {text}
    </h1>
  );
}
