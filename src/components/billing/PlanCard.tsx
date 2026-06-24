import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import type { AccessPlan } from "@/lib/billing/types";
import {
  formatMoney,
  planBadge,
  planDescription,
  planFeatures,
  planName,
} from "@/lib/billing/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

function intervalLabel(interval: AccessPlan["interval"], t: (key: string) => string): string {
  switch (interval) {
    case "day": return t("pricing.perDay");
    case "week": return t("pricing.perWeek");
    case "month": return t("pricing.perMonth");
    case "year": return t("pricing.perYear");
    case "once": return t("pricing.perOnce");
  }
}

export function PlanCard({ plan, isCurrent }: { plan: AccessPlan; isCurrent?: boolean }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const badge = planBadge(plan, lang);
  const features = planFeatures(plan, lang);

  return (
    <Card
      className={cn(
        "relative flex flex-col",
        plan.highlighted && "border-primary shadow-lg ring-2 ring-primary/20",
      )}
    >
      {(badge || plan.highlighted) && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <Badge variant="default">{badge || t("pricing.popular")}</Badge>
        </div>
      )}
      <CardHeader>
        <h3 className="text-xl font-bold">{planName(plan, lang)}</h3>
        {planDescription(plan, lang) && (
          <p className="text-sm text-muted-foreground">{planDescription(plan, lang)}</p>
        )}
        <div className="pt-4">
          <span className="text-4xl font-bold tracking-tight">
            {formatMoney(plan.price_cents, plan.currency, lang)}
          </span>
          <span className="ml-1 text-sm text-muted-foreground">{intervalLabel(plan.interval, t)}</span>
        </div>
        {plan.trial_days > 0 && (
          <p className="text-xs text-primary">{t("pricing.trial", { days: plan.trial_days })}</p>
        )}
      </CardHeader>
      <CardContent className="flex-1">
        <ul className="space-y-2">
          {features.map((f, i) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span>{f}</span>
            </li>
          ))}
        </ul>
      </CardContent>
      <CardFooter>
        {isCurrent ? (
          <Button className="w-full" disabled variant="outline">
            {t("pricing.current")}
          </Button>
        ) : (
          <Button asChild className="w-full" variant={plan.highlighted ? "default" : "outline"}>
            <Link to="/checkout/$planId" params={{ planId: plan.id }}>
              {t("pricing.choose")}
            </Link>
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
