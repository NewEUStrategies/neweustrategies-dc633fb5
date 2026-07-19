import { useTranslation } from "react-i18next";
import { Moon, Sun } from "@/lib/lucide-shim";
import { useTheme } from "@/components/ThemeProvider";
import { cn } from "@/lib/utils";

export function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, toggle } = useTheme();
  const { t } = useTranslation();
  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? t("common.preview.lightMode") : t("common.preview.darkMode")}
      title={isDark ? t("common.preview.lightMode") : t("common.preview.darkMode")}
      className={cn(
        "inline-flex items-center justify-center rounded-full text-foreground hover:text-brand",
        "transition-all duration-200 ease-out active:scale-95",
        "w-9 h-9",
        className
      )}
    >
      <span
        key={isDark ? "sun" : "moon"}
        className="inline-flex items-center justify-center transition-transform duration-300 ease-out rotate-0"
      >
        {isDark ? (
          <Sun className="w-[18px] h-[18px]" aria-hidden="true" />
        ) : (
          <Moon className="w-[18px] h-[18px]" aria-hidden="true" />
        )}
      </span>
    </button>
  );
}
