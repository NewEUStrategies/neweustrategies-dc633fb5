// Organizm: tabela kuponów B2B - siedem kolumn i dwie akcje na wiersz.
//
// CO TU JEST DECYZJĄ, A NIE UKŁADEM.
//   1. STAN PUSTY I STAN AWARII SĄ NIEROZRÓŻNIALNE. Komponent zna wyłącznie
//      `loading` i długość listy, więc odmowa RLS wygląda dokładnie tak samo,
//      jak brak kuponów: napis „Brak wyników.” i zera w kaflach. Przeniesione
//      bez zmian - dodanie gałęzi błędu byłoby naprawą, nie ekstrakcją.
//   2. FILTROWANIE JEST NA ZEWNĄTRZ. Tabela dostaje wiersze JUŻ przefiltrowane
//      (`filterCoupons`), żeby definicja „wygasłego” nie powstała tu po raz
//      drugi.
//   3. USUNIĘCIE I PRZEŁĄCZENIE wychodzą zdarzeniami: potwierdzenie i mutacja
//      to sprawa trasy, tabela nie zna ani Supabase, ani react-query.
import { useTranslation } from "react-i18next";
// SŁOWNIK: klucze `adminCoupons.*` mieszkają w nakładce, którą trzeba jawnie
// dociągnąć - bez tego i18next zwraca sam klucz i na ekranie staje napis
// „adminCoupons.code”. Ani parytet, ani typy tego nie widzą (inwariant
// `check:i18n-overlay-imports`), dlatego wołanie stoi w tym pliku.
import { ensureI18n as ensureAdminCouponsI18n } from "@/lib/i18n-admin-coupons";
import { Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CouponActiveBadge } from "../atoms/CouponActiveBadge";
import { CouponDiscountCell } from "../atoms/CouponDiscountCell";
import { CouponTierBadge } from "../atoms/CouponTierBadge";
import { CouponUsesCell } from "../atoms/CouponUsesCell";
import { CouponValidityRange } from "../atoms/CouponValidityRange";
import { CouponCodeCell } from "../molecules/CouponCodeCell";
import { CouponRowActions } from "../molecules/CouponRowActions";
import type { B2bCouponRow } from "@/lib/billing/coupons";

/** Wiersz listy: kolumny bazowe kuponu + powiązania kampanii, planu i CRM. */
export type CouponAdminRow = B2bCouponRow & {
  campaign_id: string | null;
  grants_tier_key: string | null;
  grants_duration_days: number | null;
  assigned_company_id: string | null;
  assigned_lead_id: string | null;
};

interface CouponsTableProps {
  rows: CouponAdminRow[];
  loading: boolean;
  lang: string;
  onCopy: (code: string) => void;
  onToggle: (row: CouponAdminRow) => void;
  onDelete: (row: CouponAdminRow) => void;
}

export function CouponsTable({
  rows,
  loading,
  lang,
  onCopy,
  onToggle,
  onDelete,
}: CouponsTableProps) {
  ensureAdminCouponsI18n();
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("adminCoupons.couponList")}</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("adminCoupons.loading")}
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6">{t("adminCoupons.results")}</p>
        ) : (
          <div className="overflow-x-auto -mx-4 px-4">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground uppercase">
                <tr className="border-b border-border/60">
                  <th className="text-left py-2 pr-3">{t("adminCoupons.code")}</th>
                  <th className="text-left py-2 pr-3">{t("adminCoupons.discount")}</th>
                  <th className="text-left py-2 pr-3">{t("adminCoupons.uses")}</th>
                  <th className="text-left py-2 pr-3">{t("adminCoupons.validity")}</th>
                  <th className="text-left py-2 pr-3">{t("adminCoupons.planSubscription")}</th>
                  <th className="text-left py-2 pr-3">{t("adminCoupons.status")}</th>
                  <th className="text-right py-2">{t("adminCoupons.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} className="border-b border-border/40">
                    <td className="py-3 pr-3">
                      <CouponCodeCell
                        code={c.code}
                        name={c.name}
                        hasCampaign={Boolean(c.campaign_id)}
                        copyLabel="Kopiuj"
                        campaignLabel="kampania"
                        onCopy={onCopy}
                      />
                    </td>
                    <td className="py-3 pr-3">
                      <CouponDiscountCell
                        kind={c.discount_kind}
                        percent={c.discount_percent}
                        cents={c.discount_cents}
                        currency={c.currency}
                      />
                    </td>
                    <td className="py-3 pr-3">
                      <CouponUsesCell used={c.redemptions_count} max={c.max_redemptions} />
                    </td>
                    <td className="py-3 pr-3 text-xs">
                      <CouponValidityRange from={c.valid_from} until={c.valid_until} lang={lang} />
                    </td>
                    <td className="py-3 pr-3 text-xs">
                      <CouponTierBadge
                        tierKey={c.grants_tier_key}
                        durationDays={c.grants_duration_days}
                      />
                    </td>
                    <td className="py-3 pr-3">
                      <CouponActiveBadge
                        active={c.active}
                        activeLabel={t("adminCoupons.active2")}
                        inactiveLabel={t("adminCoupons.inactive2")}
                      />
                    </td>
                    <td className="py-3 text-right">
                      <CouponRowActions
                        active={c.active}
                        toggleLabel="toggle-active"
                        deleteLabel="delete"
                        onToggle={() => onToggle(c)}
                        onDelete={() => onDelete(c)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
