// Organizm: rabaty i kupony na zakładce Oferta (SPEC §2.2 `offer`:
// „rabaty i kupony (`?sec=discounts`)").
//
// HUB POKAZUJE, MODUŁ PROWADZI. Kody, kampanie dla instytucji i skuteczność
// rabatów mają ekran-właściciela (`/admin/coupons…`, kontrakt deep linków
// SPEC §2.6) - karta nie powiela ich formularzy, tylko prowadzi do nich.
//
// `?sec=discounts` (odnośnik z Diagnostyki albo udostępniony adres) przewija
// do karty i przenosi na nią fokus - nagłówek jest celem nawigacji, więc
// czytnik ekranu ogłasza, gdzie wylądował.
import { Link } from "@tanstack/react-router";
import { useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { ensureI18n } from "@/lib/i18n-admin-revenue-tabs";

export interface DiscountsCardProps {
  /** `true`, gdy adres niesie `?sec=discounts` - karta dostaje fokus. */
  focused: boolean;
}

export function DiscountsCard({ focused }: DiscountsCardProps) {
  ensureI18n();
  const { t } = useTranslation();
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    if (!focused) return;
    headingRef.current?.scrollIntoView?.({ block: "start" });
    headingRef.current?.focus();
  }, [focused]);

  return (
    <section
      aria-labelledby={headingId}
      data-testid="offer-discounts"
      data-focused={focused ? "true" : undefined}
      className="min-w-0 space-y-2 rounded-[6px] border border-border p-3"
    >
      <div className="min-w-0 space-y-0.5">
        <h3
          id={headingId}
          ref={headingRef}
          tabIndex={-1}
          className="rounded-[6px] text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t("adminRevenue.offer.discounts.title")}
        </h3>
        <p className="m-0 text-xs text-muted-foreground">
          {t("adminRevenue.offer.discounts.description")}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm" variant="outline" className="h-7">
          <Link to="/admin/coupons">{t("adminRevenue.offer.discounts.codes")}</Link>
        </Button>
        <Button asChild size="sm" variant="outline" className="h-7">
          <Link to="/admin/coupons/campaigns">{t("adminRevenue.offer.discounts.campaigns")}</Link>
        </Button>
        <Button asChild size="sm" variant="outline" className="h-7">
          <Link to="/admin/coupons/analytics">{t("adminRevenue.offer.discounts.analytics")}</Link>
        </Button>
      </div>
    </section>
  );
}
