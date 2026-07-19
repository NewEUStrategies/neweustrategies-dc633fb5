// Small site-chrome widgets (header/footer), extracted from SimpleWidgets.

import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useRouter } from "@tanstack/react-router";
import * as LucideIcons from "@/lib/lucide-shim";
import { useTheme } from "@/components/ThemeProvider";
import { localizedPath, stripLangPrefix, type AppLang } from "@/lib/i18n/localePath";
import { setClientLang } from "@/lib/i18n/localeRuntime";

export function LangSwitcherDropdown({ label }: { label: string }) {
  const { i18n } = useTranslation();
  const router = useRouter();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const current: AppLang = (i18n.language ?? "pl").startsWith("en") ? "en" : "pl";
  const next: AppLang = current === "pl" ? "en" : "pl";

  const switchLang = () => {
    if (current === next) return;
    setClientLang(next);
    void i18n.changeLanguage(next);
    try {
      localStorage.setItem("i18nextLng", next);
      document.documentElement.lang = next;
    } catch {
      /* noop */
    }
    const internal = stripLangPrefix(router.state.location.pathname).pathname;
    void router.navigate({
      href: localizedPath(internal, next),
      replace: true,
      resetScroll: false,
    });
  };

  useEffect(() => {
    const btn = buttonRef.current;
    if (!btn) return;
    btn.addEventListener("click", switchLang);
    return () => btn.removeEventListener("click", switchLang);
  }, [switchLang]);

  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={`${label}: ${current.toUpperCase()} → ${next.toUpperCase()}`}
      title={`${label}: ${current.toUpperCase()} → ${next.toUpperCase()}`}
      className="lang-switch"
    >
      <span
        className="lang-switch__container"
        aria-hidden
        data-state={current}
      >
        <span className="lang-switch__circle-container">
          <span className="lang-switch__flag-container">
            <span className="lang-switch__flag">
              {current === "pl" ? "🇵🇱" : "🇬🇧"}
            </span>
          </span>
        </span>
      </span>
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
