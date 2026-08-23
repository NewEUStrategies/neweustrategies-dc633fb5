// Molekuła: pasek zakładek panelu kuponów B2B.
//
// Zakładka bieżąca jest oznaczona `aria-selected` - to jedyny sygnał, po
// którym czytnik ekranu (i test) rozpoznaje, gdzie operator się znajduje;
// obramowanie i pogrubienie są tylko jego wizualnym odpowiednikiem. Regułę
// dopasowania trzyma `isCouponTabActive` (moduł reguł), bo różnica między
// dopasowaniem dokładnym a prefiksowym decyduje o tym, ile zakładek zapala
// się naraz.
import type { LucideIcon } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { isCouponTabActive, type CouponTabTarget } from "@/lib/admin/couponTabs";

export interface CouponTab extends CouponTabTarget {
  label: string;
  icon: LucideIcon;
}

interface CouponTabsNavProps {
  tabs: CouponTab[];
  pathname: string;
  ariaLabel: string;
}

export function CouponTabsNav({ tabs, pathname, ariaLabel }: CouponTabsNavProps) {
  return (
    <nav
      role="tablist"
      aria-label={ariaLabel}
      className="flex flex-wrap gap-1 border-b border-border/60"
    >
      {tabs.map((t) => {
        const active = isCouponTabActive(t, pathname);
        const Icon = t.icon;
        return (
          <Link
            key={t.to}
            to={t.to}
            role="tab"
            aria-selected={active}
            className={cn(
              "inline-flex items-center gap-2 px-3 py-2 text-sm rounded-t-[6px] transition-colors",
              "hover:bg-muted/40",
              active
                ? "border-b-2 border-brand text-foreground font-medium -mb-px"
                : "text-muted-foreground",
            )}
          >
            <Icon className="h-4 w-4" />
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
