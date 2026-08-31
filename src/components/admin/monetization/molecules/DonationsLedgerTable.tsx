// Molekuła: tabela wpłat rejestru monetyzacji.
import { useTranslation } from "react-i18next";
import { formatMoney } from "@/lib/billing/types";
import { maskEmail, type DonationLedgerRow } from "@/lib/admin/monetization/model";
import { EnvironmentBadge } from "../atoms/EnvironmentBadge";
import { LedgerStatusPill } from "../atoms/LedgerStatusPill";
import { donationTone } from "../atoms/toneMap";

export function DonationsLedgerTable({
  rows,
  lang,
}: {
  rows: readonly DonationLedgerRow[];
  lang: "pl" | "en";
}) {
  const { t } = useTranslation();
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">{t("adminMonetization.empty", { lng: lang })}</p>
    );
  }
  return (
    <table className="w-full text-sm" data-testid="donations-table">
      <thead>
        <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
          <th className="py-2">{t("adminMonetization.donations.amount", { lng: lang })}</th>
          <th className="py-2">{t("adminMonetization.donations.status", { lng: lang })}</th>
          <th className="py-2">{t("adminMonetization.environment.label", { lng: lang })}</th>
          <th className="py-2">{t("adminMonetization.donations.donor", { lng: lang })}</th>
          <th className="py-2">{t("adminMonetization.donations.recurring", { lng: lang })}</th>
          <th className="py-2">{t("adminMonetization.donations.created", { lng: lang })}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} className="border-t border-border">
            <td className="py-2 font-medium">
              {formatMoney(row.amountCents, row.currency, lang)}
            </td>
            <td className="py-2">
              <LedgerStatusPill tone={donationTone(row.status)} label={row.status} />
            </td>
            <td className="py-2">
              <EnvironmentBadge
                environment={row.environment}
                label={t(`adminMonetization.environment.${row.environment}`, { lng: lang })}
              />
            </td>
            <td className="py-2 text-muted-foreground">
              {maskEmail(row.donorEmail) ??
                t("adminMonetization.donations.anonymous", { lng: lang })}
            </td>
            <td className="py-2 text-muted-foreground">
              {t(row.recurring ? "adminMonetization.donations.yes" : "adminMonetization.donations.no", {
                lng: lang,
              })}
            </td>
            <td className="py-2 text-muted-foreground">{row.createdAt.slice(0, 10)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
