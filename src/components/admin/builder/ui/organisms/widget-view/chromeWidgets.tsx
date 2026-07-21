// Small site-chrome widgets (header/footer), extracted from SimpleWidgets.

import { useTranslation } from "react-i18next";
import { useRouter } from "@tanstack/react-router";
import * as LucideIcons from "@/lib/lucide-shim";
import { useTheme } from "@/components/ThemeProvider";
import { localizedPath, stripLangPrefix, type AppLang } from "@/lib/i18n/localePath";
import { setClientLang } from "@/lib/i18n/localeRuntime";

export function LangSwitcherDropdown({ label }: { label: string }) {
  const { i18n } = useTranslation();
  // warn:false - poza RouterProvider (testy jednostkowe, render izolowany)
  // przełącznik dalej działa: zmiana języka + twarde przejście na URL celu.
  const router = useRouter({ warn: false });
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
    const currentPath =
      router?.state?.location?.pathname ??
      (typeof window !== "undefined" ? window.location.pathname : "/");
    const internal = stripLangPrefix(currentPath).pathname;
    const target = localizedPath(internal, next);
    if (router) {
      try {
        void router.navigate({ href: target, replace: true, resetScroll: false });
        return;
      } catch {
        /* spadnij do twardej nawigacji */
      }
    }
    if (typeof window !== "undefined") window.location.href = target;
  };

  const activeHalf = "font-bold text-foreground bg-brand/15";
  const inactiveHalf = "text-foreground/40 hover:text-foreground/60";

  return (
    <button
      type="button"
      onClick={handleClick}
      onPointerDown={(e) => e.stopPropagation()}
      aria-label={`${label}: ${current.toUpperCase()} → ${next.toUpperCase()}`}
      title={`${label}: ${current.toUpperCase()} → ${next.toUpperCase()}`}
      className="lang-switch-simple inline-flex items-center rounded-[6px] border border-border bg-background hover:bg-muted transition-colors overflow-hidden"
      style={{
        height: 24,
        width: 52,
        fontSize: 11,
        letterSpacing: "0.02em",
        fontFamily: '"Red Hat Display", "Red Hat Display Fallback", system-ui, sans-serif',
      }}
    >
      <span
        className={`w-1/2 h-full inline-flex items-center justify-center ${current === "pl" ? activeHalf : inactiveHalf}`}
      >
        PL
      </span>
      <span
        className={`w-1/2 h-full inline-flex items-center justify-center ${current === "en" ? activeHalf : inactiveHalf}`}
      >
        EN
      </span>
    </button>
  );
}

export function ThemeToggleWidget() {
  const { theme, toggle } = useTheme();
  const { t } = useTranslation();
  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggle}
      onPointerDown={(e) => e.stopPropagation()}
      aria-label={isDark ? t("common.preview.lightMode") : t("common.preview.darkMode")}
      title={isDark ? t("common.preview.lightMode") : t("common.preview.darkMode")}
      className="inline-flex items-center justify-center w-8 h-8 rounded-full text-foreground hover:text-brand transition-colors duration-200 ease-out active:scale-95"
    >
      <span
        key={isDark ? "sun" : "moon"}
        className="inline-flex items-center justify-center transition-transform duration-300 ease-out"
      >
        {isDark ? (
          <LucideIcons.Sun className="w-4 h-4" aria-hidden="true" />
        ) : (
          <LucideIcons.Moon className="w-4 h-4" aria-hidden="true" />
        )}
      </span>
    </button>
  );
}
