// Widget „Cennik" w trybie synchronizacji z katalogiem: karty budowane są
// z tabeli public.access_plans (te same dane co /pricing i panel admina),
// a CTA prowadzi do /checkout/$planId - czyli do transakcji Paddle.
// Dzięki temu ceny w builderze nigdy nie rozjeżdżają się z operatorem.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppLink } from "@/components/atoms/AppLink";
import { billingKeys } from "@/lib/billing/keys";
import { fetchActivePlans } from "@/lib/billing/queries";
import { formatMoney, planBadge, planFeatures, planName } from "@/lib/billing/types";
import type { AccessPlan } from "@/lib/billing/types";

export interface PricingPlansViewProps {
  lang: "pl" | "en";
  /** Filtr okresu rozliczenia; "all" pokazuje wszystkie aktywne plany. */
  interval?: string;
  /** Lista tier_key (CSV) - zawęża karty do wybranych warstw. */
  tierKeysCsv?: string;
  limit?: number;
  ctaLabel?: string;
}

// Klucze MUSZA pokrywac caly enum `plan_interval` z src/lib/billing/types.ts.
// Brak wpisu nie wywala renderu - po cichu gubi sufiks okresu, wiec plan
// dwutygodniowy pokazywal sama cene, bez informacji "za jaki czas".
const INTERVAL_LABEL: Record<string, { pl: string; en: string }> = {
  day: { pl: "/dzień", en: "/day" },
  week: { pl: "/tydz.", en: "/week" },
  two_weeks: { pl: "/2 tyg.", en: "/2 wks" },
  month: { pl: "/mies.", en: "/mo" },
  quarter: { pl: "/kwartał", en: "/quarter" },
  year: { pl: "/rok", en: "/yr" },
  one_time: { pl: " jednorazowo", en: " once" },
};

export function PricingPlansView({
  lang,
  interval = "all",
  tierKeysCsv = "",
  limit = 0,
  ctaLabel,
}: PricingPlansViewProps) {
  const plansQ = useQuery({ queryKey: billingKeys.plansActive(), queryFn: fetchActivePlans });

  const plans = useMemo<AccessPlan[]>(() => {
    const all = plansQ.data ?? [];
    const keys = tierKeysCsv
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    let out = all;
    if (interval && interval !== "all") out = out.filter((p) => p.interval === interval);
    if (keys.length > 0) out = out.filter((p) => (p.tier_key ? keys.includes(p.tier_key) : false));
    return limit > 0 ? out.slice(0, limit) : out;
  }, [plansQ.data, interval, tierKeysCsv, limit]);

  if (plansQ.isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-64 animate-pulse rounded-lg border border-border bg-muted/40" />
        ))}
      </div>
    );
  }

  if (plans.length === 0) {
    return (
      <p className="cms-meta text-muted-foreground">
        {lang === "pl" ? "Brak aktywnych planów." : "No active plans."}
      </p>
    );
  }

  const cta = ctaLabel?.trim() || (lang === "pl" ? "Wybierz" : "Choose");

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {plans.map((p) => {
        const features = planFeatures(p, lang);
        const badge = planBadge(p, lang);
        const period = INTERVAL_LABEL[p.interval]?.[lang] ?? "";
        return (
          <div
            key={p.id}
            className={`relative flex flex-col rounded-lg border p-6 ${
              p.highlighted ? "border-brand bg-brand/5 shadow-lg" : "border-border bg-card"
            }`}
          >
            {badge && (
              <span className="absolute -top-3 left-6 rounded-full bg-brand px-3 py-1 text-[11px] font-semibold text-brand-foreground">
                {badge}
              </span>
            )}
            <h3 className="cms-post-title mb-2">{planName(p, lang)}</h3>
            <div className="mb-4 flex items-baseline gap-1">
              <span className="text-3xl font-bold">
                {formatMoney(p.price_cents, p.currency, lang)}
              </span>
              <span className="cms-meta text-muted-foreground">{period}</span>
            </div>
            <ul className="cms-post-excerpt mb-6 flex-1 space-y-2">
              {features.map((f, j) => (
                <li key={j} className="flex items-start gap-2">
                  <span className="mt-0.5 text-brand">✓</span>
                  {f}
                </li>
              ))}
            </ul>
            <AppLink
              href={`/checkout/${p.id}`}
              className={`rounded px-4 py-2 text-center text-sm font-medium ${
                p.highlighted
                  ? "bg-brand text-brand-foreground"
                  : "border border-border hover:bg-muted"
              }`}
            >
              {cta}
            </AppLink>
          </div>
        );
      })}
    </div>
  );
}
