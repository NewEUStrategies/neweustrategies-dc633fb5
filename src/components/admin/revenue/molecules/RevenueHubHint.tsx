// Molekuła: wiersz-drogowskaz z ekranu modułu do huba „Przychód i lejek"
// (SPEC §2.7, montaż I9) - zdanie, co hub zrobi za moduł, i jeden odnośnik
// („Wieloetapowe ścieżki są w hubie" w automatyzacjach, „Zautomatyzuj
// potwierdzenia zgłoszeń" w klubach).
//
// GEOMETRIA PASKA SYGNAŁU. Ten sam obrys, tło karty i odstępy co pasek
// `RevenueSignalChip` (`variant="bar"`) - dwa elementy huba na ekranie modułu
// wyglądają jak jedna rodzina i nie dokładają nowych klas do arkusza (css ma
// zapas ~0,2 KB, D-08).
//
// BEZ ROLI - BEZ WIERSZA. Bramka (`useRevenueHubTab`) obejmuje cały wiersz, nie
// tylko odnośnik: zdanie o hubie dla roli, która do niego nie wejdzie, byłoby
// obietnicą bez drogi.
import type { ReactNode } from "react";

import { RevenueHubLink } from "@/components/admin/revenue/molecules/RevenueHubLink";
import { useRevenueHubTab } from "@/components/admin/revenue/molecules/useRevenueHubTab";
import type { RevenueHubSearch, RevenueTabId } from "@/lib/revenue/search";
import { cn } from "@/lib/utils";

export interface RevenueHubHintProps {
  tab: RevenueTabId;
  search?: RevenueHubSearch;
  hint: ReactNode;
  action: ReactNode;
  className?: string;
}

export function RevenueHubHint({ tab, search, hint, action, className }: RevenueHubHintProps) {
  const visible = useRevenueHubTab(tab);
  if (!visible) return null;
  return (
    <div
      data-testid="revenue-hub-hint"
      data-hub-tab={tab}
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-[6px] border bg-card px-3 py-2",
        className,
      )}
    >
      <p className="text-sm text-muted-foreground">{hint}</p>
      <RevenueHubLink tab={tab} search={search}>
        {action}
      </RevenueHubLink>
    </div>
  );
}
