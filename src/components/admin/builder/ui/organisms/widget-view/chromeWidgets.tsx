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
    <button
      type="button"
      aria-label={`${label}: ${current.toUpperCase()} → ${next.toUpperCase()}`}
      title={`${label}: ${current.toUpperCase()} → ${next.toUpperCase()}`}
      onClick={switchLang}
      className="group relative inline-flex h-9 w-[6.75rem] items-center rounded-full border border-border bg-muted/60 p-1 shadow-inner transition hover:bg-muted"
    >
      {/* Two-tone national-flag track */}
      <span className="absolute inset-[3px] flex overflow-hidden rounded-full">
        <span
          aria-hidden
          className="flex h-full w-1/2 items-center justify-start pl-2.5"
          style={{
            background: "linear-gradient(180deg, #ffffff 50%, #dc143c 50%)",
          }}
        >
          <span className="text-[10px] font-bold tracking-wider text-foreground/90 drop-shadow-sm">
            PL
          </span>
        </span>
        <span
          aria-hidden
          className="flex h-full w-1/2 items-center justify-end pr-2.5"
          style={{ background: "#1e3a8a" }}
        >
          <span className="text-[10px] font-bold tracking-wider text-white/90 drop-shadow-sm">
            EN
          </span>
        </span>
      </span>

      {/* Sliding thumb with active flag */}
      <span
        aria-hidden
        className={`absolute top-1 z-10 flex h-7 w-7 items-center justify-center rounded-full border border-white/80 bg-white text-lg shadow-[0_2px_6px_rgba(0,0,0,0.25)] transition-transform duration-300 ease-out will-change-transform ${
          current === "pl" ? "translate-x-0" : "translate-x-[4.25rem]"
        }`}
      >
        {current === "pl" ? "🇵🇱" : "🇬🇧"}
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
