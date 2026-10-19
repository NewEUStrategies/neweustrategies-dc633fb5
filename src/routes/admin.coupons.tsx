// Layout strony Kupony B2B - zakładki + Outlet dla podstron.
// Zakładki: lista, kampanie, realizacje, analityka.
//
// `?code=` (SPEC §2.6) - deep link z huba „Przychód i lejek" do listy kuponów
// zawężonej do jednego kodu. Walidator stoi TUTAJ i nie importuje niczego:
// `validateSearch` zostaje w niedzielonej części pliku trasy, czyli w chunku
// wejściowym każdej strony (budżet `public`/entry zamrożony).
import { createFileRoute, Link, Outlet, useLocation } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { BadgePercent, LayoutList, Send, ListChecks, BarChart3 } from "lucide-react";
import { adminPageHead } from "@/lib/adminPageHead";
import { ensureI18n as ensureAdminCouponsI18n } from "@/lib/i18n-admin-coupons";
import { cn } from "@/lib/utils";

/** Kod kuponu z adresu: litery, cyfry, `-`, `_`; reszta = brak filtra (nie przycinamy). */
const COUPON_CODE_RE = /^[A-Za-z0-9_-]{1,64}$/;

export const Route = createFileRoute("/admin/coupons")({
  // Router SCALA surowe zapytanie z wynikiem walidatora (`{...surowe, ...wynik}`),
  // więc odrzucenie musi być jawnym `undefined` - pominięty klucz zostałby
  // w wyszukiwaniu jako niezweryfikowany napis.
  validateSearch: (raw: Record<string, unknown>): { code?: string } => {
    const code = typeof raw.code === "string" ? raw.code.trim() : "";
    return { code: COUPON_CODE_RE.test(code) ? code : undefined };
  },
  head: () =>
    adminPageHead(
      "Kupony B2B",
      "Kody rabatowe B2B, kampanie masowe z kodem dla każdego odbiorcy, realizacje i analityka kuponów.",
    ),
  component: AdminCouponsLayout,
});

function AdminCouponsLayout() {
  ensureAdminCouponsI18n();
  const { t } = useTranslation();
  const { pathname } = useLocation();

  const tabs: Array<{
    to: string;
    exact?: boolean;
    label: string;
    icon: typeof LayoutList;
  }> = [
    {
      to: "/admin/coupons",
      exact: true,
      label: t("adminCoupons.layout.tabs.list"),
      icon: LayoutList,
    },
    { to: "/admin/coupons/campaigns", label: t("adminCoupons.layout.tabs.campaigns"), icon: Send },
    {
      to: "/admin/coupons/redemptions",
      label: t("adminCoupons.layout.tabs.redemptions"),
      icon: ListChecks,
    },
    {
      to: "/admin/coupons/analytics",
      label: t("adminCoupons.layout.tabs.analytics"),
      icon: BarChart3,
    },
  ];

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <BadgePercent className="h-5 w-5" />
          {t("adminCoupons.layout.title")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("adminCoupons.layout.subtitle")}</p>
      </header>

      <nav
        role="tablist"
        aria-label={t("adminCoupons.layout.tabsLabel")}
        className="flex flex-wrap gap-1 border-b border-border/60"
      >
        {tabs.map((tab) => {
          const active = tab.exact ? pathname === tab.to : pathname.startsWith(tab.to);
          const Icon = tab.icon;
          return (
            <Link
              key={tab.to}
              to={tab.to}
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
              {tab.label}
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
