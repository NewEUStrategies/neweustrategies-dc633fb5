// Molekuła: wiersz tabeli linków podarunkowych.
//
// Decyzje, które tu mieszkają: tytuł wpisu albo slug albo kreska; e-mail
// darczyńcy pokazany tylko wtedy, gdy NIE dubluje nazwy; "bez wygaśnięcia" dla
// braku daty; kolumna otwarć czyta budżet ZAMROŻONY NA LINKU (nie bieżące
// ustawienia tenanta - inaczej kolumna kłamałaby po każdej zmianie suwaka);
// przycisk cofnięcia istnieje TYLKO dla linku aktywnego.
//
// Formatowanie daty przychodzi domknięciem, żeby molekuła nie znała decyzji o
// locale (ta należy do trasy: uiLocale).
import { Copy, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { GiftStatusPill } from "@/components/admin/gifting/atoms/GiftStatusPill";
import { giftCapExhausted } from "@/lib/gifting/admin-model";
import type { GiftLinkAdminRow } from "@/lib/gifting-admin.functions";
import { ensureI18n as ensureGiftingAdminI18n } from "@/lib/i18n-gifting-admin";

export function GiftLinkRow({
  row,
  status,
  formatDate,
  revoking,
  onCopy,
  onRevoke,
}: {
  row: GiftLinkAdminRow;
  status: "active" | "revoked" | "expired";
  formatDate: (iso: string | null) => string;
  revoking: boolean;
  onCopy: () => void;
  onRevoke: () => void;
}) {
  ensureGiftingAdminI18n();
  const { t } = useTranslation();
  const r = row;
  const s = status;
  const cap = r.max_redemptions;
  const exhausted = giftCapExhausted(r.redemption_count, cap);

  return (
    <tr className="hover:bg-muted/20">
      <td className="px-3 py-2">
        <div className="font-medium text-foreground line-clamp-1">
          {r.post_title || r.post_slug || "-"}
        </div>
        <div className="text-[11px] text-muted-foreground line-clamp-1">/{r.post_slug ?? ""}</div>
      </td>
      <td className="px-3 py-2">
        <div className="text-foreground line-clamp-1">
          {r.creator_name ?? r.creator_email ?? "-"}
        </div>
        {r.creator_email && r.creator_email !== r.creator_name && (
          <div className="text-[11px] text-muted-foreground line-clamp-1">{r.creator_email}</div>
        )}
      </td>
      <td className="px-3 py-2 text-muted-foreground">{formatDate(r.created_at)}</td>
      <td className="px-3 py-2 text-muted-foreground">
        {r.expires_at ? formatDate(r.expires_at) : t("giftingAdmin.links.neverExpires")}
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
        <GiftStatusPill status={s} label={t(`giftingAdmin.links.status.${s}`)} />
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center justify-end gap-1">
          <button
            type="button"
            title={t("giftingAdmin.links.copyCode")}
            onClick={onCopy}
            className="h-8 w-8 rounded-[6px] border border-border hover:bg-muted grid place-items-center text-muted-foreground hover:text-foreground transition-colors"
          >
            <Copy className="w-3.5 h-3.5" aria-hidden />
          </button>
          {s === "active" && (
            <button
              type="button"
              title={t("giftingAdmin.links.revoke")}
              disabled={revoking}
              onClick={onRevoke}
              className="h-8 w-8 rounded-[6px] border border-border hover:bg-destructive/10 hover:border-destructive/40 grid place-items-center text-muted-foreground hover:text-destructive transition-colors"
            >
              <X className="w-3.5 h-3.5" aria-hidden />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}
