// Molekuła: tabela przydziałów członkostwa.
import { useTranslation } from "react-i18next";
import {
  donationEnvironmentIndex,
  grantEnvironment,
  grantStatus,
  type DonationLedgerRow,
  type GrantLedgerRow,
} from "@/lib/admin/monetization/model";
import { EnvironmentBadge } from "../atoms/EnvironmentBadge";
import { LedgerStatusPill } from "../atoms/LedgerStatusPill";
import { grantTone } from "../atoms/toneMap";

export function GrantsLedgerTable({
  rows,
  donations,
  lang,
  now,
}: {
  rows: readonly GrantLedgerRow[];
  donations: readonly DonationLedgerRow[];
  lang: "pl" | "en";
  now: Date;
}) {
  const { t } = useTranslation();
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">{t("adminMonetization.empty", { lng: lang })}</p>
    );
  }
  const index = donationEnvironmentIndex(donations);
  return (
    <table className="w-full text-sm" data-testid="grants-table">
      <thead>
        <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
          <th className="py-2">{t("adminMonetization.grants.tier", { lng: lang })}</th>
          <th className="py-2">{t("adminMonetization.grants.source", { lng: lang })}</th>
          <th className="py-2">{t("adminMonetization.environment.label", { lng: lang })}</th>
          <th className="py-2">{t("adminMonetization.grants.status", { lng: lang })}</th>
          <th className="py-2">{t("adminMonetization.grants.period", { lng: lang })}</th>
          <th className="py-2">{t("adminMonetization.grants.note", { lng: lang })}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const status = grantStatus(row, now);
          const environment = grantEnvironment(row, index);
          return (
            <tr key={row.id} className="border-t border-border">
              <td className="py-2 font-medium uppercase">{row.tierKey}</td>
              <td className="py-2 text-muted-foreground">{row.source}</td>
              <td className="py-2">
                <EnvironmentBadge
                  environment={environment}
                  label={t(`adminMonetization.environment.${environment}`, { lng: lang })}
                />
              </td>
              <td className="py-2">
                <LedgerStatusPill
                  tone={grantTone(status)}
                  label={t(`adminMonetization.grants.statuses.${status}`, { lng: lang })}
                />
              </td>
              <td className="py-2 text-muted-foreground">
                {row.startsAt.slice(0, 10)} -{" "}
                {row.expiresAt
                  ? row.expiresAt.slice(0, 10)
                  : t("adminMonetization.grants.indefinite", { lng: lang })}
              </td>
              <td className="py-2 text-muted-foreground">{row.note ?? ""}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
