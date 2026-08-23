// Organizm: lista linków podarunkowych + cofanie.
//
// Filtr statusu jedzie DO ZAPYTANIA i do klucza cache, więc "cofnięte" liczy
// się w bazie na całym tenancie, a nie przez przesianie pierwszej strony.
// Cofnięcie jest nieodwracalne (odbiorcy tracą dostęp), więc idzie za
// potwierdzeniem, a po sukcesie unieważnia TRZY klucze: linki, statystyki i
// audyt (ale nie ustawienia - cofnięcie ich nie zmienia).
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { GiftFilterChip } from "@/components/admin/gifting/atoms/GiftFilterChip";
import { GiftLinkRow } from "@/components/admin/gifting/molecules/GiftLinkRow";
import { GiftTableState } from "@/components/admin/gifting/molecules/GiftTableState";
import { useGiftAdminSettingsQuery } from "@/components/admin/gifting/organisms/GiftSettingsPanel";
import { listGiftLinksAdmin, revokeGiftLinkAdmin } from "@/lib/gifting-admin.functions";
import { ensureI18n as ensureGiftingAdminI18n } from "@/lib/i18n-gifting-admin";

type LinkStatus = "all" | "active" | "revoked" | "expired";

export function GiftLinksPanel({ dateLocale }: { dateLocale: string }) {
  ensureGiftingAdminI18n();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [status, setStatus] = useState<LinkStatus>("all");
  const listLinks = useServerFn(listGiftLinksAdmin);
  const revokeLink = useServerFn(revokeGiftLinkAdmin);
  const { data: settings } = useGiftAdminSettingsQuery();

  const { data, isLoading } = useQuery({
    queryKey: ["gift-admin", "links", status],
    queryFn: () => listLinks({ data: { limit: 100, offset: 0, status } }),
  });

  const revoke = useMutation({
    mutationFn: (link_id: string) => revokeLink({ data: { link_id } }),
    onSuccess: () => {
      toast.success(t("giftingAdmin.links.revoked"));
      qc.invalidateQueries({ queryKey: ["gift-admin", "links"] });
      qc.invalidateQueries({ queryKey: ["gift-admin", "stats"] });
      qc.invalidateQueries({ queryKey: ["gift-admin", "audit"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const fmtDate = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat(dateLocale, { dateStyle: "short", timeStyle: "short" }).format(
          new Date(iso),
        )
      : "-";

  const filters: Array<{ id: LinkStatus; label: string }> = [
    { id: "all", label: t("giftingAdmin.links.filterAll") },
    { id: "active", label: t("giftingAdmin.links.filterActive") },
    { id: "revoked", label: t("giftingAdmin.links.filterRevoked") },
    { id: "expired", label: t("giftingAdmin.links.filterExpired") },
  ];

  const rows = data?.rows ?? [];
  // Budzet czytamy z LINKU (zamrozony przy tworzeniu), nie z biezacych
  // ustawien tenanta - inaczej kolumna klamalaby po kazdej zmianie suwaka.
  // Ustawienia sluza juz tylko do noty "domyslnie N" nad tabela.
  const defaultCap = settings?.max_redemptions_per_link ?? 0;

  const statusOf = (r: (typeof rows)[number]): "active" | "revoked" | "expired" => {
    if (r.revoked_at) return "revoked";
    if (r.expires_at && new Date(r.expires_at) <= new Date()) return "expired";
    return "active";
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {defaultCap > 0
          ? t("giftingAdmin.links.capNote", { count: defaultCap })
          : t("giftingAdmin.links.capNoteUnlimited")}
      </p>
      <div className="flex flex-wrap gap-2">
        {filters.map((f) => (
          <GiftFilterChip
            key={f.id}
            label={f.label}
            active={status === f.id}
            onSelect={() => setStatus(f.id)}
          />
        ))}
      </div>

      <div className="rounded-[6px] border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2">{t("giftingAdmin.links.col.post")}</th>
                <th className="text-left px-3 py-2">{t("giftingAdmin.links.col.gifter")}</th>
                <th className="text-left px-3 py-2">{t("giftingAdmin.links.col.created")}</th>
                <th className="text-left px-3 py-2">{t("giftingAdmin.links.col.expires")}</th>
                <th className="text-left px-3 py-2">{t("giftingAdmin.links.col.redemptions")}</th>
                <th className="text-left px-3 py-2">{t("giftingAdmin.links.col.status")}</th>
                <th className="text-right px-3 py-2">{t("giftingAdmin.links.col.actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <GiftTableState
                isLoading={isLoading}
                isEmpty={rows.length === 0}
                colSpan={7}
                loadingLabel={t("giftingAdmin.common.loading")}
                emptyLabel={t("giftingAdmin.links.empty")}
              />
              {rows.map((r) => (
                <GiftLinkRow
                  key={r.id}
                  row={r}
                  status={statusOf(r)}
                  formatDate={fmtDate}
                  revoking={revoke.isPending}
                  onCopy={() => {
                    navigator.clipboard.writeText(r.code);
                    toast.success(t("giftingAdmin.links.copyCode"));
                  }}
                  onRevoke={() => {
                    if (window.confirm(t("giftingAdmin.links.confirmRevoke"))) {
                      revoke.mutate(r.id);
                    }
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
