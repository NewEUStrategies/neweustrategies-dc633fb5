// Jedno źródło prawdy dla linków do mediów społecznościowych platformy.
//
// Redakcja wprowadza adresy w Admin → Wygląd → Opcje motywu → "Ikony social"
// (site_settings.theme_options.header.socials). Każdy widget social czyta stąd
// wartości, więc zmiana linku w jednym miejscu aktualizuje cały serwis.
import { useContext } from "react";
import { QueryClient, QueryClientContext, useQuery } from "@tanstack/react-query";
import { resolveSetting, siteSettingsQueryOptions } from "@/lib/useSiteSetting";


export type GlobalSocialLinks = {
  facebook: string;
  twitter: string;
  instagram: string;
  linkedin: string;
  youtube: string;
  spotify: string;
  email: string;
};

export type SocialLinksSource = "auto" | "global" | "own";

/** Ścieżka w site_settings, gdzie trzymamy globalne linki social. */
export const GLOBAL_SOCIALS_SETTINGS_PATH = "theme_options.header.socials";

/** Adres panelu admina, w którym edytuje się globalne linki social. */
export const GLOBAL_SOCIALS_ADMIN_HREF = "/admin/theme-options";

const EMPTY_LINKS: GlobalSocialLinks = {
  facebook: "",
  twitter: "",
  instagram: "",
  linkedin: "",
  youtube: "",
  spotify: "",
  email: "",
};

const DEFAULTS = { header: { socials: EMPTY_LINKS } } as const;

/**
 * Globalne linki social z ustawień witryny (współdzielony bulk query).
 *
 * Poza drzewem QueryClientProvider (izolowane renderowanie widgetu w testach
 * i w podglądach) zwraca puste linki zamiast rzucać - widget ma wtedy działać
 * na własnych adresach.
 */
export function useGlobalSocialLinks(): GlobalSocialLinks {
  const hasClient = useContext(QueryClientContext) != null;
  const options = useSiteSetting<{ header: { socials: GlobalSocialLinks } }>("theme_options", {
    header: { socials: { ...DEFAULTS.header.socials } },
  });
  if (!hasClient) return EMPTY_LINKS;
  return options.header?.socials ?? EMPTY_LINKS;
}


function readGlobal(global: GlobalSocialLinks | undefined, key: string): string {
  if (!global) return "";
  if (key === "x") return global.twitter || "";
  const value = (global as unknown as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

/**
 * Rozwiązuje adres jednej platformy zgodnie z wybranym źródłem:
 *  - `own`    → wyłącznie link wpisany w widgecie,
 *  - `global` → wyłącznie link globalny z opcji motywu,
 *  - `auto`   → link z widgetu, a gdy pusty - globalny (domyślne, nierujnujące).
 */
export function resolveSocialHref(
  ownHref: string,
  global: GlobalSocialLinks | undefined,
  key: string,
  source: SocialLinksSource = "auto",
): string {
  const globalHref = readGlobal(global, key);
  if (source === "own") return ownHref;
  if (source === "global") return globalHref;
  return ownHref || globalHref;
}
