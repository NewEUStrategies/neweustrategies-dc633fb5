// Zakładki sekcji wyników wyszukiwarki premium: Wszystko / Tytuły /
// Rodzaje treści / Tematyka / Osoby i organizacje. Stan mieszka w URL
// (parametr tab; "all" nieserializowane). Wzorzec ARIA tablist/tab.
import { useTranslation } from "react-i18next";
import { FileText, Layers, LayoutGrid, Tags, Users } from "@/lib/lucide-shim";
import { SEARCH_TABS, type SearchTab } from "@/lib/search/facetModel";

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
    <div
      role="tablist"
      aria-label={t("search.title")}
      className="flex flex-wrap items-center gap-1 border-b border-border"
    >
      {SEARCH_TABS.map((tab) => {
        const Icon = TAB_ICON[tab];
        const isActive = tab === active;
        const count = counts?.[tab];
        return (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onPick(tab)}
            className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm transition-colors ${
              isActive
                ? "border-brand font-semibold text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
            }`}
          >
            <Icon className="w-4 h-4" aria-hidden />
            {t(`search.tabs.${tab}`)}
            {typeof count === "number" && (
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] tabular-nums leading-none ${
                  isActive ? "bg-brand/15 text-brand-ink" : "bg-muted text-muted-foreground"
                }`}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
