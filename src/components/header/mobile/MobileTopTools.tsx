// Górny pas narzędzi drawera: wyszukiwarka, motyw, język.
// Wyszukiwarka otwiera istniejący `SearchOverlay` w trybie fullscreen,
// żeby zachować spójność z resztą chrome-u.
import { useState } from "react";
import { Search, Sun, Moon } from "lucide-react";
import { useTheme } from "@/components/ThemeProvider";
import { LangToggle } from "@/components/atoms/LangToggle";
import { SearchOverlay } from "@/components/SearchOverlay";
import type { TopTools } from "@/lib/mobileDrawer";

type Props = {
  tools: TopTools;
  isPl: boolean;
  onNavigate: () => void;
};

export function MobileTopTools({ tools, isPl, onNavigate }: Props) {
  const { theme, toggle } = useTheme();
  const [searchOpen, setSearchOpen] = useState(false);
  const anyTool = tools.search || tools.theme || tools.language;
  if (!anyTool) return null;

  const t = (pl: string, en: string) => (isPl ? pl : en);

  return (
    <div
      className="px-4 py-3 border-b border-border bg-background"
      role="group"
      aria-label={t("Narzędzia", "Tools")}
    >
      <div className="flex items-center gap-2">
        {tools.search && (
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            aria-label={t("Otwórz wyszukiwarkę", "Open search")}
            className="flex-1 inline-flex items-center gap-2 h-10 px-3 rounded-md border border-border bg-muted/40 text-sm text-muted-foreground hover:bg-muted transition"
          >
            <Search className="w-4 h-4" aria-hidden />
            <span>{t("Szukaj…", "Search…")}</span>
          </button>
        )}

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

      {tools.search && (
        <SearchOverlay
          open={searchOpen}
          onClose={() => {
            setSearchOpen(false);
            onNavigate();
          }}
          mode="fullscreen"
          heading={t("Szukaj", "Search")}
          liveResults={true}
          limit={8}
          lang={isPl ? "pl" : "en"}
        />
      )}
    </div>
  );
}
