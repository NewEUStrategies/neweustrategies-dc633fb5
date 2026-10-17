import { Link } from "@tanstack/react-router";

import { useSiteSetting } from "@/lib/useSiteSetting";
import { useTheme } from "@/components/ThemeProvider";
import { renderedMediaUrl } from "@/lib/cropSizes";

interface LogoProps {
  size?: "sm" | "md" | "lg" | "xl";
  withWordmark?: boolean;
  /** Wariant: "main" (desktop), "mobile", "transparent". */
  variant?: "main" | "mobile" | "transparent";
}

const SIZE: Record<NonNullable<LogoProps["size"]>, string> = {
  sm: "w-8 h-8",
  md: "w-12 h-12 md:w-14 md:h-14",
  lg: "w-16 h-16",
  xl: "w-24 h-24",
};

type LogoCfg = {
  logo: {
    main: string;
    main_dark: string;
    mobile: string;
    mobile_dark: string;
    transparent: string;
    transparent_dark: string;
  };
};
const LOGO_DEFAULTS: LogoCfg = {
  logo: {
    main: "",
    main_dark: "",
    mobile: "",
    mobile_dark: "",
    transparent: "",
    transparent_dark: "",
  },
};

export function Logo({ size = "md", withWordmark = true, variant = "main" }: LogoProps) {
  const cfg = useSiteSetting<LogoCfg>("theme_options", LOGO_DEFAULTS);
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const l = cfg.logo ?? LOGO_DEFAULTS.logo;

  const pick = (light: string, dark: string) => (isDark ? dark || light : light || dark);
  const main = pick(l.main, l.main_dark);
  const resolved = (() => {
    // W dark mode nie schodzimy do jasnego wariantu mobilnego - lepszy jest
    // desktopowy `main_dark` (białe napisy) niż ciemne logo na ciemnym tle.
    if (variant === "mobile") return (isDark ? l.mobile_dark : l.mobile) || main;
    if (variant === "transparent") return (isDark ? l.transparent_dark : l.transparent) || main;
    return main;
  })();
  // Eager `<img>` w powłoce (reset hasła - w chrome'ie serwisu obok paska
  // mobilnego `Header`; AuthPortal na /login bez nagłówka, rejestracja
  // `ssr: false`) dostaje od Reacta auto-preload kluczowany SUROWYM `src`.
  // Adres względny `/media/...` jak w paskach chrome'u (`lib/brand/headerLogo`):
  // gdy na resecie hasła to ten sam plik co logo paska mobilnego (motyw bez
  // osobnego wariantu `mobile`), oba `<img>` mają jeden klucz i `<head>`
  // dostaje jeden preload, a na hostach najemców i podglądu nie ma drugiego
  // pobrania z kanonicznego originu. Wybór wariantu zostaje własny; napis-strażnik jak w helperze -
  // wartość innego typu z wiersza ustawień nie wywraca SSR.
  const src = typeof resolved === "string" && resolved ? renderedMediaUrl(resolved) : "";
  const showWordmark = withWordmark && !resolved;

  return (
    <Link
      to="/"
      className="flex items-center gap-3"
      aria-label="New European Strategies - strona główna"
    >
      {src ? (
        <img
          src={src}
          alt=""
          className={SIZE[size]}
          width={56}
          height={56}
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
      ) : (
        <span className={SIZE[size]} aria-hidden="true" />
      )}

      {showWordmark && (
        <span className="leading-[1.05] font-display font-bold text-xl md:text-2xl">
          <span className="block">New</span>
          <span className="block text-brand">European</span>
          <span className="block">Strategies</span>
        </span>
      )}
    </Link>
  );
}
