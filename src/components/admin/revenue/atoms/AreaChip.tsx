// Atom: obszar huba (katalog, paywall, kasa, CRM…) jako etykieta - na kartach
// diagnoz, w kondycji obszarów i w filtrach Diagnostyki (S7).
//
// SAM NAPIS, BEZ KOLORU ZNACZĄCEGO. Obszar to kategoria, nie ocena - kolor
// sugerowałby, że „Kasa" jest gorsza od „Kuponów". Ocenę niesie
// `SeverityLabel` obok. Nazwa przez jawną mapę `Record<RevenueArea, …>`:
// nowy obszar w `REVENUE_AREAS` bez napisu nie skompiluje się.
import { useTranslation } from "react-i18next";

import type { RevenueArea } from "@/lib/admin/revenue/hubTabs";
import { ensureI18n } from "@/lib/i18n-admin-revenue-shell";
import { cn } from "@/lib/utils";

const AREA_LABEL_KEY: Readonly<Record<RevenueArea, string>> = {
  catalog: "adminRevenue.area.catalog",
  paywall: "adminRevenue.area.paywall",
  metering: "adminRevenue.area.metering",
  checkout: "adminRevenue.area.checkout",
  coupons: "adminRevenue.area.coupons",
  retention: "adminRevenue.area.retention",
  dunning: "adminRevenue.area.dunning",
  funnel: "adminRevenue.area.funnel",
  crm: "adminRevenue.area.crm",
  newsletter: "adminRevenue.area.newsletter",
  workflows: "adminRevenue.area.workflows",
  journeys: "adminRevenue.area.journeys",
  events: "adminRevenue.area.events",
  clubs: "adminRevenue.area.clubs",
  sync: "adminRevenue.area.sync",
  data_quality: "adminRevenue.area.data_quality",
};

export interface AreaChipProps {
  area: RevenueArea;
  className?: string;
}

export function AreaChip({ area, className }: AreaChipProps) {
  ensureI18n();
  const { t } = useTranslation();
  return (
    <span
      data-area={area}
      className={cn(
        "inline-flex items-center rounded-md border border-border bg-muted/40 px-1.5 py-0.5 text-[11px] font-medium text-foreground",
        className,
      )}
    >
      {t(AREA_LABEL_KEY[area])}
    </span>
  );
}
