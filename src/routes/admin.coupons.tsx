// Layout strony Kupony B2B - zakładki + Outlet dla podstron.
// Zakładki: lista, kampanie, realizacje, analityka.
//
// Reguła podświetlenia zakładki (dokładne dopasowanie dla listy, prefiksowe dla
// pozostałych) mieszka w `lib/admin/couponTabs`, a sam pasek w molekule
// `CouponTabsNav` - tutaj zostaje wyłącznie język interfejsu i skład strony.
import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { BadgePercent, LayoutList, Send, ListChecks, BarChart3 } from "lucide-react";
import { CouponTabsNav, type CouponTab } from "@/components/admin/coupons/molecules/CouponTabsNav";

export const Route = createFileRoute("/admin/coupons")({
  component: AdminCouponsLayout,
});

function AdminCouponsLayout() {
  const { i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "pl";
  const L = (pl: string, en: string) => (lang === "pl" ? pl : en);
  const { pathname } = useLocation();

  const tabs: CouponTab[] = [
    { to: "/admin/coupons", exact: true, label: L("Kupony", "Coupons"), icon: LayoutList },
    { to: "/admin/coupons/campaigns", label: L("Kampanie", "Campaigns"), icon: Send },
    { to: "/admin/coupons/redemptions", label: L("Realizacje", "Redemptions"), icon: ListChecks },
    { to: "/admin/coupons/analytics", label: L("Analityka", "Analytics"), icon: BarChart3 },
  ];

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

      <CouponTabsNav
        tabs={tabs}
        pathname={pathname}
        ariaLabel={L("Zakładki kuponów", "Coupon tabs")}
      />

      <div className="pt-2">
        <Outlet />
      </div>
    </div>
  );
}
