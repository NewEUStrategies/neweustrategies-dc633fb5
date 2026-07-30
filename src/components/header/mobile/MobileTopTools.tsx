// Górny pas narzędzi drawera: motyw, język.
// Wyszukiwarka została usunięta z menu mobilnego na prośbę UX.
import { Sun, Moon } from "lucide-react";
import { useTheme } from "@/components/ThemeProvider";
import { LangToggle } from "@/components/atoms/LangToggle";
import type { TopTools } from "@/lib/mobileDrawer";

type Props = {
  tools: TopTools;
  isPl: boolean;
  onNavigate?: () => void;
};

export function MobileTopTools({ tools, isPl }: Props) {
  const { theme, toggle } = useTheme();
  const anyTool = tools.theme || tools.language;
  if (!anyTool) return null;

  const t = (pl: string, en: string) => (isPl ? pl : en);

  return (
    <div
      className="px-4 py-3 border-b border-border bg-background"
      role="group"
      aria-label={t("Narzędzia", "Tools")}
    >
      <div className="flex items-center justify-end gap-2">
        {tools.theme && (
          <button
            type="button"
            onClick={toggle}
            aria-label={t("Przełącz motyw", "Toggle theme")}
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
  );
}
