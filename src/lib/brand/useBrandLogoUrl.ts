// Jedno źródło prawdy dla logotypu marki używanego w powierzchniach marketingowych
// (popup rejestracji, podgląd w adminie). Kolejność: ustawienia logowania
// (form_logo_url_*), następnie globalne logo motywu (Wygląd → Opcje motywu → Logo).
import { useSiteSetting } from "@/lib/useSiteSetting";
import { useAuthSettings } from "@/hooks/useAuthSettings";

interface ThemeLogoCfg {
  logo: {
    main: string;
    main_dark: string;
    transparent: string;
    transparent_dark: string;
  };
}

const THEME_LOGO_DEFAULTS: ThemeLogoCfg = {
  logo: { main: "", main_dark: "", transparent: "", transparent_dark: "" },
};

/**
 * @param surface "dark" - powierzchnia ciemna (popup), preferuje warianty _dark.
 */
export function useBrandLogoUrl(surface: "dark" | "light" = "dark"): string | null {
  const auth = useAuthSettings();
  const theme = useSiteSetting<ThemeLogoCfg>("theme_options", THEME_LOGO_DEFAULTS);
  const l = theme?.logo ?? THEME_LOGO_DEFAULTS.logo;

  const candidates =
    surface === "dark"
      ? [
          auth.form_logo_url_dark,
          auth.form_logo_url,
          l.transparent_dark,
          l.main_dark,
          l.transparent,
          l.main,
        ]
      : [auth.form_logo_url, auth.form_logo_url_dark, l.transparent, l.main, l.main_dark];

  return candidates.find((url) => typeof url === "string" && url.length > 0) ?? null;
}
