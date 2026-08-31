// Molekuła: tabela linków prezentowych. Linki nie należą do żadnego konta
// operatora, więc nie mają znacznika środowiska - filtr ich nie zawęża.
import { useTranslation } from "react-i18next";
import {
  giftLinkStatus,
  maskGiftCode,
  type GiftLinkLedgerRow,
} from "@/lib/admin/monetization/model";
import { LedgerStatusPill } from "../atoms/LedgerStatusPill";
import { giftLinkTone } from "../atoms/toneMap";

export function GiftLinksLedgerTable({
  rows,
  lang,
  now,
}: {
  rows: readonly GiftLinkLedgerRow[];
  lang: "pl" | "en";
  now: Date;
}) {
  const { t } = useTranslation();
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">{t("adminMonetization.empty", { lng: lang })}</p>
    );
  }
  return (
    <table className="w-full text-sm" data-testid="gift-links-table">
      <thead>
        <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
          <th className="py-2">{t("adminMonetization.giftLinks.code", { lng: lang })}</th>
          <th className="py-2">{t("adminMonetization.giftLinks.status", { lng: lang })}</th>
          <th className="py-2">{t("adminMonetization.giftLinks.redemptions", { lng: lang })}</th>
          <th className="py-2">{t("adminMonetization.giftLinks.created", { lng: lang })}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const status = giftLinkStatus(row, now);
          return (
            <tr key={row.id} className="border-t border-border">
              <td className="py-2 font-mono text-xs">{maskGiftCode(row.code)}</td>
              <td className="py-2">
                <LedgerStatusPill
                  tone={giftLinkTone(status)}
                  label={t(`adminMonetization.giftLinks.statuses.${status}`, { lng: lang })}
                />
              </td>
              <td className="py-2 text-muted-foreground">
                {row.redemptionCount} /{" "}
                {row.maxRedemptions > 0
                  ? row.maxRedemptions
                  : t("adminMonetization.giftLinks.unlimited", { lng: lang })}
              </td>
              <td className="py-2 text-muted-foreground">{row.createdAt.slice(0, 10)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
