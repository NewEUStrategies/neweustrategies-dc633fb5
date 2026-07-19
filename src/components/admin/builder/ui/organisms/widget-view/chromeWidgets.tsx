// Small site-chrome widgets (header/footer), extracted from SimpleWidgets.
import * as React from "react";
import { useTranslation } from "react-i18next";
import * as LucideIcons from "@/lib/lucide-shim";
import { useTheme } from "@/components/ThemeProvider";

export function LangSwitcherDropdown({ label }: { label: string }) {
  const { i18n } = useTranslation();
  const current: "pl" | "en" = (i18n.language ?? "pl").startsWith("en") ? "en" : "pl";
  const next: "pl" | "en" = current === "pl" ? "en" : "pl";
  const meta = {
    pl: { flag: "🇵🇱", label: "PL" },
    en: { flag: "🇬🇧", label: "EN" },
  } as const;
  const nextMeta = meta[next];

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
    <button
      type="button"
      aria-label={`${label}: ${nextMeta.label}`}
      title={`${label}: ${nextMeta.label}`}
      onClick={switchLang}
      className="inline-flex items-center gap-1.5 h-9 px-2.5 rounded-[6px] border border-border bg-background hover:bg-muted transition text-xs font-medium"
    >
      <span className="text-base leading-none">{nextMeta.flag}</span>
      <span>{nextMeta.label}</span>
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
