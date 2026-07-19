// Small site-chrome widgets (header/footer), extracted from SimpleWidgets.

import { useTranslation } from "react-i18next";
import * as LucideIcons from "@/lib/lucide-shim";
import { useTheme } from "@/components/ThemeProvider";

export function LangSwitcherDropdown({ label }: { label: string }) {
  const { i18n } = useTranslation();
  const current: "pl" | "en" = (i18n.language ?? "pl").startsWith("en") ? "en" : "pl";
  const next: "pl" | "en" = current === "pl" ? "en" : "pl";

  const switchLang = () => {
    void i18n.changeLanguage(next);
    try {
      localStorage.setItem("i18nextLng", next);
      document.documentElement.lang = next;
    } catch {
      /* noop */
    }
  };

  return (
    <label
      aria-label={`${label}: ${current.toUpperCase()} → ${next.toUpperCase()}`}
      title={`${label}: ${current.toUpperCase()} → ${next.toUpperCase()}`}
      className="lang-switch"
    >
      <input
        type="checkbox"
        className="lang-switch__checkbox"
        checked={current === "en"}
        onChange={switchLang}
        aria-label={`${label}: ${current.toUpperCase()} → ${next.toUpperCase()}`}
      />
      <span className="lang-switch__container">
        <span className="lang-switch__circle-container">
          <span className="lang-switch__flag-container">
            <span className="lang-switch__flag" aria-hidden>
              {current === "pl" ? "🇵🇱" : "🇬🇧"}
            </span>
          </span>
        </span>
      </span>
    </label>
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
