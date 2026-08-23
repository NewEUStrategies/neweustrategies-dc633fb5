// Organizm: pasek dziesięciu kafli statystyk gifting.
//
// Kolejność kafli JEST decyzją (najpierw stan bieżący: aktywne, ten miesiąc;
// potem sumy; na końcu straty: wyczerpane, cofnięte, wygasłe) i zostaje tutaj.
// Panel stoi NAD nawigacją zakładek, więc przełączanie zakładek go nie
// odmontowuje i nie powtarza odczytu.
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { GiftStatCard, GiftStatSkeleton } from "@/components/admin/gifting/atoms/GiftStatCard";
import { getGiftAdminStats } from "@/lib/gifting-admin.functions";
import { ensureI18n as ensureGiftingAdminI18n } from "@/lib/i18n-gifting-admin";

export function GiftStatsPanel() {
  ensureGiftingAdminI18n();
  const { t } = useTranslation();
  const getStats = useServerFn(getGiftAdminStats);
  const { data, isLoading } = useQuery({
    queryKey: ["gift-admin", "stats"],
    queryFn: () => getStats(),
    staleTime: 30_000,
  });

  const cells: Array<{ label: string; value: number }> = data
    ? [
        { label: t("giftingAdmin.stats.active"), value: data.active_links },
        { label: t("giftingAdmin.stats.createdThisMonth"), value: data.created_this_month },
        { label: t("giftingAdmin.stats.redeemedThisMonth"), value: data.redeemed_this_month },
        { label: t("giftingAdmin.stats.totalCreated"), value: data.total_created },
        { label: t("giftingAdmin.stats.totalRedeemed"), value: data.total_redeemed },
        { label: t("giftingAdmin.stats.gifters"), value: data.unique_gifters },
        { label: t("giftingAdmin.stats.recipients"), value: data.unique_recipients },
        { label: t("giftingAdmin.stats.exhausted"), value: data.exhausted_links },
        { label: t("giftingAdmin.stats.revoked"), value: data.revoked_links },
        { label: t("giftingAdmin.stats.expired"), value: data.expired_links },
      ]
    : [];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {isLoading
        ? Array.from({ length: 10 }).map((_, i) => <GiftStatSkeleton key={i} />)
        : cells.map((c) => <GiftStatCard key={c.label} label={c.label} value={c.value} />)}
    </div>
  );
}
