// Molekuła: ostatnie odpowiedzi odchodzących klientów.
//
// Powód, komentarz, data i to, czy kontroferta została pokazana i przyjęta -
// z kodem kuponu, jeśli powstał. Trzy stany po prawej są rozłączne i mają
// znaczenie biznesowe: PRZYJĘTA (klient zostaje z rabatem), ODRZUCONA (widział
// ofertę i mimo to odszedł) i kreska (oferty nie było - np. wyłączona).
// Rozróżnienie „odrzucona" i „nie pokazano" jest jedynym sposobem, by odczytać
// z panelu, czy rabat nie działa, czy po prostu nie doszedł do klienta.
import { useTranslation } from "react-i18next";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { RetentionFeedbackRow } from "@/lib/retention/queries";

/** Ile odpowiedzi pokazujemy - przegląd, nie eksport. */
const VISIBLE_LIMIT = 25;

export function RetentionFeedbackList({ feedback }: { feedback: RetentionFeedbackRow[] }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "pl";
  const ta = (k: string, opts?: Record<string, unknown>) => t(`adminPricing.${k}`, opts);
  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString(lang === "en" ? "en-GB" : "pl-PL");
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{ta("retention.feedbackHeading")}</CardTitle>
      </CardHeader>
      <CardContent>
        {feedback.length === 0 ? (
          <p className="text-sm text-muted-foreground">{ta("retention.feedbackEmpty")}</p>
        ) : (
          <div className="space-y-2">
            {feedback.slice(0, VISIBLE_LIMIT).map((row) => (
              <div
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium">{row.reason_label}</div>
                  {row.comment && (
                    <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                      {row.comment}
                    </div>
                  )}
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    {fmtDate(row.created_at)}
                  </div>
                </div>
                <div className="shrink-0 text-right text-xs">
                  {row.offer_accepted ? (
                    <span className="rounded bg-primary/10 px-2 py-0.5 font-medium text-primary">
                      {ta("retention.offerAccepted")}
                      {row.coupon_code ? ` · ${row.coupon_code}` : ""}
                    </span>
                  ) : row.offer_shown ? (
                    <span className="rounded bg-muted px-2 py-0.5 text-muted-foreground">
                      {ta("retention.offerDeclined")}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
