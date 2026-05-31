import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Moon, Sun, Search, Menu, X, ChevronDown, Mail, Facebook, Twitter, Youtube, Instagram, Linkedin, Send } from "lucide-react";
import { useState } from "react";
import { useTheme } from "./ThemeProvider";
import logo from "@/assets/logo.png";

export function Header() {
  const { t, i18n } = useTranslation();
  const { theme, toggle } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);
  const lang = i18n.language ?? "pl";

  const setLang = (lng: "pl" | "en") => i18n.changeLanguage(lng);

  const nav: { label: string; hasSub?: boolean }[] = [
    { label: t("nav.analyses"), hasSub: true },
    { label: t("nav.interviews"), hasSub: true },
    { label: t("nav.policyPapers"), hasSub: true },
    { label: t("nav.reports"), hasSub: true },
    { label: t("nav.events"), hasSub: true },
    { label: t("nav.about"), hasSub: true },
  ];

  return (
    <header className="bg-background border-b border-border">
      {/* Utility bar */}
      <div className="border-b border-border">
        <div className="max-w-[1400px] mx-auto px-4 lg:px-8 h-11 flex items-center justify-between text-xs">
          <div className="flex items-center gap-5">
            <a href="#newsletter" className="flex items-center gap-2 font-semibold text-foreground hover:text-brand transition">
              <span className="w-7 h-7 rounded-full bg-brand text-brand-foreground inline-flex items-center justify-center">
                <Send className="w-3.5 h-3.5" />
              </span>
              {t("nav.newsletter")}
            </a>
            <div className="hidden sm:flex items-center gap-3 text-muted-foreground">
              <a href="#" aria-label="Facebook" className="hover:text-brand"><Facebook className="w-4 h-4" /></a>
              <a href="#" aria-label="X" className="hover:text-brand"><Twitter className="w-4 h-4" /></a>
              <a href="#" aria-label="YouTube" className="hover:text-brand"><Youtube className="w-4 h-4" /></a>
              <a href="#" aria-label="Instagram" className="hover:text-brand"><Instagram className="w-4 h-4" /></a>
              <a href="#" aria-label="LinkedIn" className="hover:text-brand"><Linkedin className="w-4 h-4" /></a>
              <a href="#" aria-label="Email" className="hover:text-brand"><Mail className="w-4 h-4" /></a>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden sm:inline text-muted-foreground">
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
              <button
                key={item.label}
                className="flex items-center gap-1 text-xs font-bold tracking-wider text-foreground hover:text-brand transition"
              >
                {item.label}
                {item.hasSub && <ChevronDown className="w-3 h-3" />}
              </button>
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
              <button
                key={item.label}
                className="text-left text-sm font-semibold tracking-wider text-foreground/80"
              >
                {item.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </header>
  );
}
