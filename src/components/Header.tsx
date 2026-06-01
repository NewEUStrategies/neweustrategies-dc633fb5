import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Moon, Sun, Search, Menu, X, Mail, Facebook, Twitter, Youtube, Instagram, Linkedin, Send, LogIn, LayoutDashboard } from "@/lib/lucide-shim";
import { useEffect, useRef, useState } from "react";
import { useTheme } from "./ThemeProvider";
import { useAuth } from "@/hooks/useAuth";
import { useSiteSetting } from "@/lib/useSiteSetting";
import { BuilderRenderer } from "@/components/admin/builder/BuilderRenderer";
import type { BuilderDocument } from "@/lib/builder/types";
import logo from "@/assets/logo.png";

type ThemeOptions = {
  logo: {
    main: string; main_dark: string; mobile: string; mobile_dark: string;
    transparent: string; organization: string;
    bookmark_ios: string; bookmark_windows: string; add_to_home_screen: boolean;
  };
  header: {
    main_menu: {
      hover_effect: "color-border" | "underline" | "background" | "scale" | "none";
      sticky: boolean; smart_sticky: boolean; glass_effect: boolean;
      item_spacing: number; icon_spacing: number;
      submenu_bg_from: string; submenu_bg_to: string;
    };
    search: {
      enabled: boolean; heading: string;
      mode: "standalone" | "dropdown" | "fullscreen";
      live_results: boolean; live_limit: number; more_menu_search: boolean;
    };
  };
};

const THEME_DEFAULTS: ThemeOptions = {
  logo: { main: "", main_dark: "", mobile: "", mobile_dark: "", transparent: "", organization: "", bookmark_ios: "", bookmark_windows: "", add_to_home_screen: true },
  header: {
    main_menu: { hover_effect: "color-border", sticky: true, smart_sticky: false, glass_effect: false, item_spacing: 12, icon_spacing: 5, submenu_bg_from: "", submenu_bg_to: "" },
    search: { enabled: true, heading: "Search", mode: "standalone", live_results: true, live_limit: 5, more_menu_search: true },
  },
};

const HOVER_CLASS: Record<ThemeOptions["header"]["main_menu"]["hover_effect"], string> = {
  "color-border": "border-b-2 border-transparent hover:border-brand hover:text-brand",
  underline: "hover:underline underline-offset-8 decoration-2 hover:text-brand",
  background: "rounded hover:bg-muted hover:text-brand",
  scale: "hover:scale-110 hover:text-brand",
  none: "hover:text-brand",
};

type MenuItem = { label_pl: string; label_en: string; url: string };

export function Header() {
  const { t, i18n } = useTranslation();
  const { theme, toggle } = useTheme();
  const { session, isStaff } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const lang = i18n.language ?? "pl";

  const setLang = (lng: "pl" | "en") => i18n.changeLanguage(lng);

  const menu = useSiteSetting<{ items: MenuItem[] }>("menu_primary", { items: [] });
  const themeOpts = useSiteSetting<ThemeOptions>("theme_options", THEME_DEFAULTS);
  const headerCfg = useSiteSetting<{
    show_newsletter: boolean; show_socials: boolean;
    social_facebook: string; social_twitter: string; social_youtube: string;
    social_instagram: string; social_linkedin: string; contact_email: string;
    builder_data?: BuilderDocument | null;
  }>("header", {
    show_newsletter: true,
    show_socials: true,
    social_facebook: "#", social_twitter: "#", social_youtube: "#", social_instagram: "#", social_linkedin: "#",
    contact_email: "",
  });

  // Smart-sticky: hide on scroll down, show on scroll up. Sticky: always fixed at top.
  const [navHidden, setNavHidden] = useState(false);
  const lastY = useRef(0);
  const { sticky, smart_sticky, glass_effect, hover_effect, item_spacing } = themeOpts.header.main_menu;
  useEffect(() => {
    if (!smart_sticky) return;
    const onScroll = () => {
      const y = window.scrollY;
      setNavHidden(y > 80 && y > lastY.current);
      lastY.current = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [smart_sticky]);

  const logoSrc = theme === "dark"
    ? (themeOpts.logo.main_dark || themeOpts.logo.main || logo)
    : (themeOpts.logo.main || logo);

  if (headerCfg.builder_data && headerCfg.builder_data.sections?.length) {
    return (
      <header className="bg-background border-b border-border">
        <BuilderRenderer doc={headerCfg.builder_data} lang={lang.startsWith("pl") ? "pl" : "en"} />
      </header>
    );
  }

  const defaultNav: MenuItem[] = [
    { label_pl: t("nav.analyses"), label_en: t("nav.analyses"), url: "#" },
    { label_pl: t("nav.interviews"), label_en: t("nav.interviews"), url: "#" },
    { label_pl: t("nav.policyPapers"), label_en: t("nav.policyPapers"), url: "#" },
    { label_pl: t("nav.reports"), label_en: t("nav.reports"), url: "#" },
    { label_pl: t("nav.events"), label_en: t("nav.events"), url: "#" },
    { label_pl: t("nav.about"), label_en: t("nav.about"), url: "#" },
  ];
  const nav = (menu.items?.length ? menu.items : defaultNav).map((m) => ({
    label: lang.startsWith("pl") ? m.label_pl : m.label_en,
    url: m.url,
  }));

  return (
    <header className="bg-background border-b border-border">

      {/* Utility bar */}
      <div className="border-b border-border">
        <div className="max-w-[1400px] mx-auto px-4 lg:px-8 h-11 flex items-center justify-between text-xs">
          <div className="flex items-center gap-5">
            {headerCfg.show_newsletter && (
              <a href="#newsletter" className="flex items-center gap-2 font-semibold text-foreground hover:text-brand transition">
                <span className="w-7 h-7 rounded-full bg-brand text-brand-foreground inline-flex items-center justify-center">
                  <Send className="w-3.5 h-3.5" />
                </span>
                {t("nav.newsletter")}
              </a>
            )}
            {headerCfg.show_socials && (
              <div className="hidden sm:flex items-center gap-3 text-muted-foreground">
                <a href={headerCfg.social_facebook || "#"} aria-label="Facebook" className="hover:text-brand"><Facebook className="w-4 h-4" /></a>
                <a href={headerCfg.social_twitter || "#"} aria-label="X" className="hover:text-brand"><Twitter className="w-4 h-4" /></a>
                <a href={headerCfg.social_youtube || "#"} aria-label="YouTube" className="hover:text-brand"><Youtube className="w-4 h-4" /></a>
                <a href={headerCfg.social_instagram || "#"} aria-label="Instagram" className="hover:text-brand"><Instagram className="w-4 h-4" /></a>
                <a href={headerCfg.social_linkedin || "#"} aria-label="LinkedIn" className="hover:text-brand"><Linkedin className="w-4 h-4" /></a>
                {headerCfg.contact_email && (
                  <a href={`mailto:${headerCfg.contact_email}`} aria-label="Email" className="hover:text-brand"><Mail className="w-4 h-4" /></a>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            {session && isStaff ? (
              <Link to="/admin" className="hidden sm:inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline">
                <LayoutDashboard className="w-3.5 h-3.5" /> {lang.startsWith("pl") ? "Panel" : "Dashboard"}
              </Link>
            ) : (
              <span className="hidden sm:inline-flex items-center gap-2 text-xs">
                <Link to="/login" className="inline-flex items-center gap-1 font-semibold text-muted-foreground hover:text-brand">
                  <LogIn className="w-3.5 h-3.5" /> {lang.startsWith("pl") ? "Zaloguj" : "Sign in"}
                </Link>
                <span className="text-muted-foreground/40">|</span>
                <Link to="/login" search={{ mode: "signup" }} className="font-semibold text-brand hover:underline">
                  {lang.startsWith("pl") ? "Zarejestruj" : "Sign up"}
                </Link>
              </span>
            )}
            <span className="hidden md:inline text-muted-foreground">
              {lang.startsWith("pl") ? "Zmień język" : "Switch language"}
            </span>
            <button
              onClick={() => setLang("en")}
              aria-label="English"
              className={`text-base leading-none transition ${lang.startsWith("en") ? "opacity-100" : "opacity-60 hover:opacity-100"}`}
            >
              🇬🇧
            </button>
            <button
              onClick={() => setLang("pl")}
              aria-label="Polski"
              className={`text-base leading-none transition ${lang.startsWith("pl") ? "opacity-100" : "opacity-60 hover:opacity-100"}`}
            >
              🇵🇱
            </button>
          </div>
        </div>
      </div>

      {/* Centered logo */}
      <div className="max-w-[1400px] mx-auto px-4 lg:px-8 py-6 flex justify-center">
        <Link to="/" className="flex items-center gap-3">
          <img src={logo} alt="New European Strategies" className="w-12 h-12 md:w-14 md:h-14" width={56} height={56} />
          <div className="leading-[1.05]">
            <div className="font-display font-bold text-xl md:text-2xl">New</div>
            <div className="font-display font-bold text-xl md:text-2xl text-brand">European</div>
            <div className="font-display font-bold text-xl md:text-2xl">Strategies</div>
          </div>
        </Link>
      </div>

      {/* Nav bar */}
      <div className="border-t border-border">
        <div className="max-w-[1400px] mx-auto px-4 lg:px-8 h-14 flex items-center justify-between gap-4">
          <button
            aria-label="Search"
            className="flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-foreground transition"
          >
            <Search className="w-4 h-4" />
            <span className="hidden sm:inline">{t("nav.search")}</span>
          </button>

          <nav className="hidden lg:flex items-center gap-7">
            {nav.map((item) => (
              <a
                key={item.label}
                href={item.url || "#"}
                className="flex items-center gap-1 text-xs font-bold tracking-wider text-foreground hover:text-brand transition"
              >
                {item.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <button
              onClick={toggle}
              aria-label="Toggle theme"
              className="p-2 rounded-full hover:bg-muted transition"
            >
              {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <button
              onClick={() => setMobileOpen((o) => !o)}
              className="lg:hidden p-2 rounded-full hover:bg-muted"
              aria-label="Menu"
            >
              {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {mobileOpen && (
          <div className="lg:hidden border-t border-border py-4 px-4 flex flex-col gap-3">
            {nav.map((item) => (
              <a
                key={item.label}
                href={item.url || "#"}
                className="text-left text-sm font-semibold tracking-wider text-foreground/80"
              >
                {item.label}
              </a>
            ))}
          </div>
        )}
      </div>
    </header>
  );
}
