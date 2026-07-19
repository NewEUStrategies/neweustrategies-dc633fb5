// Small site-chrome widgets (header/footer), extracted from SimpleWidgets.

import { useTranslation } from "react-i18next";
import { useRouter } from "@tanstack/react-router";
import * as LucideIcons from "@/lib/lucide-shim";
import { useTheme } from "@/components/ThemeProvider";
import { localizedPath, stripLangPrefix, type AppLang } from "@/lib/i18n/localePath";
import { setClientLang } from "@/lib/i18n/localeRuntime";

export function LangSwitcherDropdown({ label }: { label: string }) {
  const { i18n } = useTranslation();
  const router = useRouter();
  const current: AppLang = (i18n.language ?? "pl").startsWith("en") ? "en" : "pl";
  const next: AppLang = current === "pl" ? "en" : "pl";

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setClientLang(next);
    void i18n.changeLanguage(next);
    try {
      localStorage.setItem("i18nextLng", next);
      document.documentElement.lang = next;
    } catch {
      /* noop */
    }
    const internal = stripLangPrefix(router.state.location.pathname).pathname;
    const target = localizedPath(internal, next);
    try {
      void router.navigate({ href: target, replace: true, resetScroll: false });
    } catch {
      window.location.href = target;
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      onPointerDown={(e) => e.stopPropagation()}
      aria-label={`${label}: ${current.toUpperCase()} → ${next.toUpperCase()}`}
      title={`${label}: ${current.toUpperCase()} → ${next.toUpperCase()}`}
      className="lang-switch-simple inline-flex items-center justify-center rounded-[6px] border border-border bg-background hover:bg-muted transition-colors font-semibold"
      style={{ height: 24, minWidth: 48, padding: "0 8px", fontSize: 11, letterSpacing: "0.02em", fontFamily: '"Red Hat Display", system-ui, sans-serif' }}
    >
      <span className={current === "pl" ? "text-foreground" : "text-muted-foreground"}>PL</span>
      <span className="text-muted-foreground mx-1" aria-hidden="true">|</span>
      <span className={current === "en" ? "text-foreground" : "text-muted-foreground"}>EN</span>
    </button>
  );
}

export function ThemeToggleWidget() {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? "Przełącz na tryb jasny" : "Przełącz na tryb ciemny"}
      title={isDark ? "Tryb ciemny (kliknij, aby zmienić)" : "Tryb jasny (kliknij, aby zmienić)"}
      className="inline-flex items-center justify-center rounded-[2px] hover:opacity-80 transition-opacity"
      style={{ width: 14, height: 14 }}
    >
      {isDark ? (
        <LucideIcons.Sun className="w-3.5 h-3.5" style={{ color: "#FA9346" }} />
      ) : (
        <LucideIcons.Moon className="w-3.5 h-3.5" />
      )}
    </button>
  );
}
