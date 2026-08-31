// Organizm: zakladka LINKI panelu prezentow - przeglad i cofanie.
import { useTranslation } from "react-i18next";
import "@/lib/i18n-gifting-admin";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Copy, X } from "lucide-react";
import { listGiftLinksAdmin, revokeGiftLinkAdmin } from "@/lib/gifting-admin.functions";
import { giftCapExhausted } from "@/lib/gifting/admin-model";
import { useGiftAdminSettingsQuery } from "../hooks";
import { StatusPill } from "../atoms/StatusPill";

export type LinkStatus = "all" | "active" | "revoked" | "expired";

export function LinksPanel({ dateLocale }: { dateLocale: string }) {
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
          <button
            key={f.id}
            type="button"
            onClick={() => setStatus(f.id)}
            className={`h-9 px-3 rounded-[6px] text-xs font-semibold border transition-colors ${
              status === f.id
                ? "bg-brand text-brand-foreground border-brand"
                : "border-border bg-background text-muted-foreground hover:text-foreground"
            }`}
          >
            {f.label}
          </button>
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
              {isLoading && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                    {t("giftingAdmin.common.loading")}
                  </td>
                </tr>
              )}
              {!isLoading && rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                    {t("giftingAdmin.links.empty")}
                  </td>
                </tr>
              )}
              {rows.map((r) => {
                const s = statusOf(r);
                const cap = r.max_redemptions;
                const exhausted = giftCapExhausted(r.redemption_count, cap);
                // Druga linia komorki darczyncy porownuje sie z tym, co
                // NAPRAWDE stanelo w pierwszej - nie z `creator_name`. Konto
                // bez `display_name` ma `creator_name === null`, wiec pierwsza
                // linia pokazuje juz adres; porownanie z nazwa przepuszczalo go
                // po raz drugi (te same dane osobowe dwa razy pod soba).
                const creatorLine = r.creator_name ?? r.creator_email ?? "-";
                return (
                  <tr key={r.id} className="hover:bg-muted/20">
                    <td className="px-3 py-2">
                      <div className="font-medium text-foreground line-clamp-1">
                        {r.post_title || r.post_slug || "-"}
                      </div>
                      <div className="text-[11px] text-muted-foreground line-clamp-1">
                        /{r.post_slug ?? ""}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="text-foreground line-clamp-1">{creatorLine}</div>
                      {r.creator_email && r.creator_email !== creatorLine && (
                        <div className="text-[11px] text-muted-foreground line-clamp-1">
                          {r.creator_email}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{fmtDate(r.created_at)}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {r.expires_at ? fmtDate(r.expires_at) : t("giftingAdmin.links.neverExpires")}
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {cap > 0 ? (
                        <span
                          className={exhausted ? "font-semibold text-destructive" : undefined}
                          title={exhausted ? t("giftingAdmin.links.capReached") : undefined}
                        >
                          {r.redemption_count} / {cap}
                        </span>
                      ) : (
                        r.redemption_count
                      )}
                      {/* Unikalni odbiorcy: klikniecia sa deduplikowane, wiec
                        ta liczba mowi, ILU LUDZI realnie otworzylo artykul. */}
                      <span className="ml-1 text-[11px] text-muted-foreground">
                        ({t("giftingAdmin.links.recipients", { count: r.unique_recipients })})
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <StatusPill status={s} label={t(`giftingAdmin.links.status.${s}`)} />
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          title={t("giftingAdmin.links.copyCode")}
                          onClick={() => {
                            navigator.clipboard.writeText(r.code);
                            toast.success(t("giftingAdmin.links.copyCode"));
                          }}
                          className="h-8 w-8 rounded-[6px] border border-border hover:bg-muted grid place-items-center text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <Copy className="w-3.5 h-3.5" aria-hidden />
                        </button>
                        {s === "active" && (
                          <button
                            type="button"
                            title={t("giftingAdmin.links.revoke")}
                            disabled={revoke.isPending}
                            onClick={() => {
                              if (window.confirm(t("giftingAdmin.links.confirmRevoke"))) {
                                revoke.mutate(r.id);
                              }
                            }}
                            className="h-8 w-8 rounded-[6px] border border-border hover:bg-destructive/10 hover:border-destructive/40 grid place-items-center text-muted-foreground hover:text-destructive transition-colors"
                          >
                            <X className="w-3.5 h-3.5" aria-hidden />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
