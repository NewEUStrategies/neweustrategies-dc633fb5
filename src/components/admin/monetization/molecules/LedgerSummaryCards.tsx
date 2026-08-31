// Molekuła: kafelki podsumowania rejestru (kwoty per waluta + liczniki).
import { useTranslation } from "react-i18next";
import { formatMoney } from "@/lib/billing/types";
import type { MonetizationSummary } from "@/lib/admin/monetization/model";

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[6px] border border-border p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}

export function LedgerSummaryCards({
  summary,
  lang,
}: {
  summary: MonetizationSummary;
  lang: "pl" | "en";
}) {
  const { t } = useTranslation();
  const paid =
    summary.paidTotals.length === 0
      ? t("adminMonetization.summary.noPaid", { lng: lang })
      : summary.paidTotals
          .map((total) => formatMoney(total.amountCents, total.currency, lang))
          .join(" / ");
  return (
    <div data-testid="ledger-summary" className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-5">
      <Card label={t("adminMonetization.summary.paid", { lng: lang })} value={paid} />
      <Card
        label={t("adminMonetization.summary.donations", { lng: lang })}
        value={String(summary.donationCount)}
      />
      <Card
        label={t("adminMonetization.summary.pending", { lng: lang })}
        value={String(summary.pendingCount)}
      />
      <Card
        label={t("adminMonetization.summary.grants", { lng: lang })}
        value={String(summary.activeGrants)}
      />
      <Card
        label={t("adminMonetization.summary.giftLinks", { lng: lang })}
        value={String(summary.activeGiftLinks)}
      />
    </div>
  );
}
