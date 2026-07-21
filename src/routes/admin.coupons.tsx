// Layout strony Kupony B2B - zakładki + Outlet dla podstron.
// Zakładki: lista, kampanie, realizacje, analityka.
import { createFileRoute, Link, Outlet, useLocation } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { BadgePercent, LayoutList, Send, ListChecks, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/coupons")({
  component: AdminCouponsLayout,
});

function AdminCouponsLayout() {
  const { i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "pl";
  const L = (pl: string, en: string) => (lang === "pl" ? pl : en);
  const { pathname } = useLocation();

  const tabs = [
    {
      to: "/admin/coupons",
      exact: true,
      label: L("Kupony", "Coupons"),
      icon: LayoutList,
    },
    {
      to: "/admin/coupons/campaigns",
      label: L("Kampanie", "Campaigns"),
      icon: Send,
    },
    {
      to: "/admin/coupons/redemptions",
      label: L("Realizacje", "Redemptions"),
      icon: ListChecks,
    },
    {
      to: "/admin/coupons/analytics",
      label: L("Analityka", "Analytics"),
      icon: BarChart3,
    },
  ] as const;

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <BadgePercent className="h-5 w-5" />
          {L("Kupony B2B", "B2B coupons")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {L(
            "Zarządzaj kodami, kampaniami masowymi i analityką. Integracja z CRM, newsletterem i subskrypcjami platformy.",
            "Manage codes, bulk campaigns and analytics. Integrated with CRM, newsletter and platform subscriptions.",
          )}
        </p>
      </header>

      <nav
        role="tablist"
        aria-label={L("Zakładki kuponów", "Coupon tabs")}
        className="flex flex-wrap gap-1 border-b border-border/60"
      >
        {tabs.map((t) => {
          const active = t.exact ? pathname === t.to : pathname.startsWith(t.to);
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

      <div className="pt-2">
        <Outlet />
      </div>
    </div>
  );
}
