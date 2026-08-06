// Sekcja informacyjna "Jak działają płatności" na /profile/payments.
// Wyjaśnia rolę Stripe jako operatora płatności i to, że dane karty nigdy nie
// trafiają na nasze serwery. Treść w PL/EN pochodzi z i18n-profile.
import { useTranslation } from "react-i18next";
import { CreditCard, Lock, ReceiptText, RefreshCw, ShieldCheck } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const POINTS = [
  { key: "processor", icon: CreditCard },
  { key: "noCardData", icon: Lock },
  { key: "security", icon: ShieldCheck },
  { key: "invoices", icon: ReceiptText },
  { key: "renewals", icon: RefreshCw },
] as const;

export function HowPaymentsWorkCard() {
  const { t } = useTranslation();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("profile.planPage.howPayments.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{t("profile.planPage.howPayments.intro")}</p>
        <ul className="space-y-3">
          {POINTS.map(({ key, icon: Icon }) => (
            <li key={key} className="flex gap-3">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-muted/40 text-foreground">
                <Icon className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="space-y-0.5">
                <span className="block text-sm font-semibold">
                  {t(`profile.planPage.howPayments.points.${key}.title`)}
                </span>
                <span className="block text-sm text-muted-foreground">
                  {t(`profile.planPage.howPayments.points.${key}.body`)}
                </span>
              </span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">
          {t("profile.planPage.howPayments.footnote")}
        </p>
      </CardContent>
    </Card>
  );
}
