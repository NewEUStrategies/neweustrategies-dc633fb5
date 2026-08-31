// Organizm: kafelki statystyk panelu prezentow.
import { useTranslation } from "react-i18next";
import "@/lib/i18n-gifting-admin";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getGiftAdminStats } from "@/lib/gifting-admin.functions";

export function StatsPanel() {
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
        ? Array.from({ length: 10 }).map((_, i) => (
            <div
              key={i}
              className="h-20 rounded-[6px] border border-border bg-muted/30 animate-pulse"
            />
          ))
        : cells.map((c) => (
            <div key={c.label} className="rounded-[6px] border border-border bg-card p-3">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {c.label}
              </div>
              <div className="mt-1 font-display text-2xl font-bold">{c.value.toLocaleString()}</div>
            </div>
          ))}
    </div>
  );
}
