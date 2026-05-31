import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Moon, Sun, Search, Menu, X } from "lucide-react";
import { useState } from "react";
import { useTheme } from "./ThemeProvider";
import logo from "@/assets/logo.png";

export function Header() {
  const { t, i18n } = useTranslation();
  const { theme, toggle } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);

  const setLang = (lng: "pl" | "en") => i18n.changeLanguage(lng);
  const lang = i18n.language ?? "pl";

  const nav = [
    { label: t("nav.analyses"), to: "/" },
    { label: t("nav.interviews"), to: "/" },
    { label: t("nav.policyPapers"), to: "/" },
    { label: t("nav.reports"), to: "/" },
    { label: t("nav.events"), to: "/" },
    { label: t("nav.about"), to: "/" },
  ];

  return (
    <header className="sticky top-0 z-50 bg-background/90 backdrop-blur border-b border-border">
      <div className="max-w-[1400px] mx-auto px-4 lg:px-8">
        <div className="flex items-center justify-between h-20">
          <Link to="/" className="flex items-center gap-3">
            <img src={logo} alt="New European Strategies" className="w-10 h-10" width={40} height={40} />
            <div className="hidden sm:block leading-tight">
              <div className="font-display font-bold text-base">New European</div>
              <div className="font-display font-bold text-base text-brand">Strategies</div>
            </div>
          </Link>

          <nav className="hidden lg:flex items-center gap-7">
            {nav.map((item) => (
              <Link
                key={item.label}
                to={item.to}
                className="text-xs font-semibold tracking-wider text-foreground/80 hover:text-brand transition-colors"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <button
              aria-label="Search"
              className="p-2 rounded-full hover:bg-muted transition"
            >
              <Search className="w-4 h-4" />
            </button>

            <div className="hidden sm:flex items-center gap-1 text-xs font-semibold">
              <button
                onClick={() => setLang("pl")}
                className={`px-2 py-1 rounded ${lang.startsWith("pl") ? "bg-brand text-brand-foreground" : "hover:bg-muted"}`}
              >
                PL
              </button>
              <button
                onClick={() => setLang("en")}
                className={`px-2 py-1 rounded ${lang.startsWith("en") ? "bg-brand text-brand-foreground" : "hover:bg-muted"}`}
              >
                EN
              </button>
            </div>

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
          <div className="lg:hidden border-t border-border py-4 flex flex-col gap-3">
            {nav.map((item) => (
              <Link
                key={item.label}
                to={item.to}
                className="text-sm font-semibold tracking-wider text-foreground/80"
              >
                {item.label}
              </Link>
            ))}
          </div>
        )}
      </div>
    </header>
  );
}
