// Jedno źródło prawdy dla logotypu marki używanego w powierzchniach marketingowych
// (popup rejestracji, podgląd w adminie). Kolejność: ustawienia logowania
// (form_logo_url_*), następnie globalne logo motywu (Wygląd → Opcje motywu → Logo).
import { useSiteSetting } from "@/lib/useSiteSetting";
import { useAuthSettings } from "@/hooks/useAuthSettings";

interface ThemeLogoCfg {
  logo: {
    main: string;
    main_dark: string;
    /** Sygnet mobilny - zwykle kwadratowy, najlepszy do małych powierzchni. */
    mobile: string;
    mobile_dark: string;
    transparent: string;
    transparent_dark: string;
    /** Poziome logo rozwiniętego menu admina (Wygląd → Opcje motywu → Logo). */
    sidebar_expanded: string;
    sidebar_expanded_dark: string;
  };
}

const THEME_LOGO_DEFAULTS: ThemeLogoCfg = {
  logo: {
    main: "",
    main_dark: "",
    mobile: "",
    mobile_dark: "",
    transparent: "",
    transparent_dark: "",
    sidebar_expanded: "",
    sidebar_expanded_dark: "",
  },
};

/**
 * @param surface "dark" - powierzchnia ciemna (popup), preferuje warianty _dark.
 * @param shape   "horizontal" - najpierw poziome logo z menu admina
 *                (theme_options.logo.sidebar_expanded*), tak jak w AdminShell;
 *                "any" - kolejność jak dotychczas (logo formularza logowania).
 */
export function useBrandLogoUrl(
  surface: "dark" | "light" = "dark",
  shape: "horizontal" | "any" = "any",
): string | null {
  const auth = useAuthSettings();
  const theme = useSiteSetting<ThemeLogoCfg>("theme_options", THEME_LOGO_DEFAULTS);
  const l = theme?.logo ?? THEME_LOGO_DEFAULTS.logo;
  const dark = surface === "dark";

  // Poziome logo menu admina - identyczna kolejność jak SidebarBrand, żeby
  // popup pokazywał dokładnie ten znak, który admin widzi w panelu.
  const horizontal = dark
    ? [l.sidebar_expanded_dark, l.sidebar_expanded]
    : [l.sidebar_expanded, l.sidebar_expanded_dark];

  const branded = dark
    ? [auth.form_logo_url_dark, auth.form_logo_url, l.transparent_dark, l.main_dark]
    : [auth.form_logo_url, auth.form_logo_url_dark, l.transparent, l.main];

  const fallback = dark ? [l.transparent, l.main] : [l.main_dark];

  const candidates =
    shape === "horizontal"
      ? [...horizontal, ...branded, ...fallback]
      : [...branded, ...fallback, ...horizontal];

  return candidates.find((url) => typeof url === "string" && url.length > 0) ?? null;
}

/**
 * Sygnet marki dla małych, kwadratowych powierzchni (kafel ikony w banerze
 * cookie). Kolejność woli znak przycięty (mobile), potem logo transparentne, a
 * dopiero na końcu pełny lockup - w wariancie zgodnym z motywem, żeby ciemny
 * znak nie wylądował na ciemnym tle.
 */
export function useBrandMarkUrl(surface: "dark" | "light" = "light"): string | null {
  const theme = useSiteSetting<ThemeLogoCfg>("theme_options", THEME_LOGO_DEFAULTS);
  const l = theme?.logo ?? THEME_LOGO_DEFAULTS.logo;
  const dark = surface === "dark";

  const preferred = dark
    ? [l.mobile_dark, l.transparent_dark, l.main_dark]
    : [l.mobile, l.transparent, l.main];
  const fallback = dark
    ? [l.mobile, l.transparent, l.main]
    : [l.mobile_dark, l.transparent_dark, l.main_dark];

  return (
    [...preferred, ...fallback].find((url) => typeof url === "string" && url.length > 0) ?? null
  );
}
