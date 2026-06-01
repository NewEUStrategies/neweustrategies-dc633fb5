import { Link } from "@tanstack/react-router";
import logoSrc from "@/assets/logo.png";
import { useSiteSetting } from "@/lib/useSiteSetting";
import { useTheme } from "@/components/ThemeProvider";

interface LogoProps {
  size?: "sm" | "md" | "lg";
  withWordmark?: boolean;
  /** Wariant: "main" (desktop), "mobile", "transparent". */
  variant?: "main" | "mobile" | "transparent";
}

const SIZE: Record<NonNullable<LogoProps["size"]>, string> = {
  sm: "w-8 h-8",
  md: "w-12 h-12 md:w-14 md:h-14",
  lg: "w-16 h-16",
};

type LogoCfg = {
  logo: {
    main: string; main_dark: string;
    mobile: string; mobile_dark: string;
    transparent: string; transparent_dark: string;
  };
};
const LOGO_DEFAULTS: LogoCfg = {
  logo: { main: "", main_dark: "", mobile: "", mobile_dark: "", transparent: "", transparent_dark: "" },
};

export function Logo({ size = "md", withWordmark = true, variant = "main" }: LogoProps) {
  const cfg = useSiteSetting<LogoCfg>("theme_options", LOGO_DEFAULTS);
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const l = cfg.logo ?? LOGO_DEFAULTS.logo;

  const pick = (light: string, dark: string) => (isDark ? dark || light : light || dark);
  const main = pick(l.main, l.main_dark);
  const resolved = (() => {
    if (variant === "mobile") return pick(l.mobile, l.mobile_dark) || main;
    if (variant === "transparent") return pick(l.transparent, l.transparent_dark) || main;
    return main;
  })();
  const src = resolved || logoSrc;

  return (
    <Link to="/" className="flex items-center gap-3" aria-label="New European Strategies - strona główna">
      <img src={src} alt="" className={SIZE[size]} width={56} height={56} />
      {withWordmark && !resolved && (
        <span className="leading-[1.05] font-display font-bold text-xl md:text-2xl">
          <span className="block">New</span>
          <span className="block text-brand">European</span>
          <span className="block">Strategies</span>
        </span>
      )}
    </Link>
  );
}
