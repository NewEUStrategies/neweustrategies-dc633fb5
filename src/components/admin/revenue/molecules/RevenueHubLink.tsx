// Molekuła: odnośnik z ekranu modułu do zakładki huba „Przychód i lejek"
// (SPEC §2.7, montaż I9) - „Zautomatyzuj komunikację" w studiu wydarzenia,
// „Przychód ze wszystkich wydarzeń", baner automatyzacji, potwierdzenia
// zgłoszeń do klubów.
//
// JEDEN KSZTAŁT DLA WSZYSTKICH MODUŁÓW. Obrysowany przycisk `sm` - ten sam co
// odnośniki „Otwórz moduł" w studiu wydarzenia i pasek „Powiązane moduły";
// napis podaje moduł (ze swojego słownika), adres i bramkę roli - ta
// molekuła, więc nowy odnośnik do huba nie może zapomnieć ani o roli, ani
// o hydratacji (`useRevenueHubTab`).
//
// ADRES PRZEZ KONTRAKT HUBA. Zakładka to `RevenueTabId`, parametry to
// `RevenueHubSearch` (`?new=1&template=`, `?sec=events`) - ten sam walidator
// (`parseRevenueHubSearch`) przyjmie je po drugiej stronie; kokpit ma jeden
// adres (`/admin/revenue`), reszta - `/admin/revenue/$tab`.
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";

import { useRevenueHubTab } from "@/components/admin/revenue/molecules/useRevenueHubTab";
import { Button } from "@/components/ui/button";
import type { RevenueHubSearch, RevenueTabId } from "@/lib/revenue/search";
import { cn } from "@/lib/utils";

export interface RevenueHubLinkProps {
  tab: RevenueTabId;
  search?: RevenueHubSearch;
  children: ReactNode;
  className?: string;
}

export function RevenueHubLink({ tab, search, children, className }: RevenueHubLinkProps) {
  const visible = useRevenueHubTab(tab);
  if (!visible) return null;
  return (
    <Button asChild size="sm" variant="outline" className={cn("w-fit", className)}>
      {tab === "overview" ? (
        <Link to="/admin/revenue" search={search} data-hub-tab={tab}>
          {children}
        </Link>
      ) : (
        <Link to="/admin/revenue/$tab" params={{ tab }} search={search} data-hub-tab={tab}>
          {children}
        </Link>
      )}
    </Button>
  );
}
