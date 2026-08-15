// Górny pas narzędzi drawera: wyszukiwarka (lewa strona, sama ikona lupy),
// motyw i język (prawa strona).
import { Sun, Moon, Search } from "lucide-react";
import { useTheme } from "@/components/ThemeProvider";
import { LangToggle } from "@/components/atoms/LangToggle";
import { useTranslation } from "react-i18next";
import type { TopTools } from "@/lib/mobileDrawer";
import "@/lib/i18n-mobile-drawer";

type Props = {
  tools: TopTools;
  onNavigate?: () => void;
};

export function MobileTopTools({ tools, onNavigate }: Props) {
  const { t } = useTranslation();
  const { theme, toggle } = useTheme();
  const anyTool = tools.search || tools.theme || tools.language;
  if (!anyTool) return null;

  const openSearch = () => {
    // Zamykamy drawer, potem oddajemy klatkę na animację i otwieramy overlay
    // wyszukiwarki (ten sam, którego używa header desktop/mobile).
    onNavigate?.();
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent("neus:open-mobile-search"));
    }, 0);
  };

  return (
    <div
      className="px-4 py-3 border-b border-border bg-background"
      role="group"
      aria-label={t("mobileDrawer.tools")}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {tools.search && (
            <button
              type="button"
              onClick={openSearch}
              aria-label={t("mobileDrawer.openSearch")}
              className="inline-flex items-center justify-center h-10 w-10 rounded-md border border-border text-foreground hover:bg-muted transition shrink-0"
            >
              <Search className="w-4 h-4" aria-hidden />
            </button>
          )}
        </div>

        <div className="flex items-center justify-end gap-2">
          {tools.theme && (
            <button
              type="button"
              onClick={toggle}
              aria-label={t("mobileDrawer.toggleTheme")}
              className="inline-flex items-center justify-center h-10 w-10 rounded-md border border-border text-foreground hover:bg-muted transition shrink-0"
            >
              {theme === "dark" ? (
                <Sun className="w-4 h-4" aria-hidden />
              ) : (
                <Moon className="w-4 h-4" aria-hidden />
              )}
            </button>
          )}

          {tools.language && (
            <div className="inline-flex items-center justify-center h-10 px-2 rounded-md border border-border shrink-0">
              <LangToggle />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
