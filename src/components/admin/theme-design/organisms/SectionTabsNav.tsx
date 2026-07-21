// Organism: sticky, responsive tab navigation for the editor sections.
// Purely presentational - the active value + change handler come from the
// parent <Tabs> controller.
import { useTranslation } from "react-i18next";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TAB_ITEMS } from "../lib";
import "@/lib/i18n-admin-theme-design";

export function SectionTabsNav() {
  const { t } = useTranslation();
  return (
    <div className="sticky top-0 z-20 -mx-1 px-1 py-2 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/70 border-b border-border">
      <TabsList className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 h-auto gap-1.5 bg-transparent p-0">
        {TAB_ITEMS.map((tab) => (
          <TabsTrigger
            key={tab.value}
            value={tab.value}
            className="w-full h-9 px-3 rounded-none text-xs font-medium bg-muted/40 border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors data-[state=active]:bg-brand data-[state=active]:text-[color:var(--brand-foreground)] data-[state=active]:border-brand data-[state=active]:shadow-sm"
          >
            {t(tab.labelKey)}
          </TabsTrigger>
        ))}
      </TabsList>
    </div>
  );
}
