// Zakładki sekcji wyników wyszukiwarki premium: Wszystko / Tytuły /
// Rodzaje treści / Tematyka / Osoby i organizacje. Stan mieszka w URL
// (parametr tab; "all" nieserializowane). Wzorzec ARIA tablist/tab.
// Każda zakładka ma tooltip (Radix) z opisem, co obejmuje - + fallback
// przez atrybut title dla trybu tylko-klawiatura/kontekstu bez hovera.
import { useTranslation } from "react-i18next";
import { FileText, Info, Layers, LayoutGrid, Tags, Users } from "@/lib/lucide-shim";
import { SEARCH_TABS, type SearchTab } from "@/lib/search/facetModel";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface Props {
  active: SearchTab;
  counts?: Partial<Record<SearchTab, number>>;
  onPick: (tab: SearchTab) => void;
}

const TAB_ICON: Record<SearchTab, typeof FileText> = {
  all: Layers,
  titles: FileText,
  types: LayoutGrid,
  topics: Tags,
  people: Users,
};

export function SearchSectionTabs({ active, counts, onPick }: Props) {
  const { t } = useTranslation();
  return (
    <TooltipProvider delayDuration={200}>
      <div
        role="tablist"
        aria-label={t("search.title")}
        className="flex flex-wrap items-center gap-1 border-b border-border"
      >
        {SEARCH_TABS.map((tab) => {
          const Icon = TAB_ICON[tab];
          const isActive = tab === active;
          const count = counts?.[tab];
          const label = t(`search.tabs.${tab}`);
          const hint = t(`search.tab_hints.${tab}`);
          const hintId = `search-tab-hint-${tab}`;
          return (
            <Tooltip key={tab}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-describedby={hintId}
                  title={`${label} - ${hint}`}
                  onClick={() => onPick(tab)}
                  className={`group -mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm transition-colors ${
                    isActive
                      ? "border-brand font-semibold text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
                  }`}
                >
                  <Icon className="w-4 h-4" aria-hidden />
                  {label}
                  {typeof count === "number" && (
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[10px] tabular-nums leading-none ${
                        isActive ? "bg-brand/15 text-brand-ink" : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {count}
                    </span>
                  )}
                  <Info
                    className="w-3 h-3 opacity-40 transition-opacity group-hover:opacity-80"
                    aria-hidden
                  />
                </button>
              </TooltipTrigger>
              <TooltipContent
                id={hintId}
                side="bottom"
                align="start"
                className="max-w-[280px] text-xs leading-relaxed"
              >
                <p className="font-semibold text-[11px] uppercase tracking-wider mb-1 opacity-80">
                  {label}
                </p>
                <p>{hint}</p>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
