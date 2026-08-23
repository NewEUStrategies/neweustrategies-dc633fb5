// Molekuła: wiersz logu audytu gifting.
//
// Dwie decyzje o uczciwości audytu: (1) "anonimowy odbiorca" pojawia się TYLKO
// przy otwarciu bez aktora - przy innych zdarzeniach brak aktora to kreska, bo
// „anonimowy twórca linku" byłby nieprawdą; (2) etykieta typu ma `defaultValue`
// z surowym `event_type`, więc zdarzenie, którego ten build nie zna, jedzie do
// interfejsu NIETKNIĘTE zamiast wypaść z tabeli. To `defaultValue` jest całą
// treścią zachowania - musi zostać dokładnie tutaj.
import { useTranslation } from "react-i18next";
import { GiftEventPill } from "@/components/admin/gifting/atoms/GiftEventPill";
import type { GiftEventAdminRow } from "@/lib/gifting-admin.functions";
import { ensureI18n as ensureGiftingAdminI18n } from "@/lib/i18n-gifting-admin";

export function GiftEventRow({
  event,
  formatDate,
}: {
  event: GiftEventAdminRow;
  formatDate: (iso: string) => string;
}) {
  ensureGiftingAdminI18n();
  const { t } = useTranslation();
  const e = event;

  return (
    <tr className="hover:bg-muted/20">
      <td className="px-3 py-2 text-muted-foreground tabular-nums whitespace-nowrap">
        {formatDate(e.created_at)}
      </td>
      <td className="px-3 py-2">
        <GiftEventPill
          type={e.event_type}
          label={t(`giftingAdmin.audit.type.${e.event_type}`, {
            defaultValue: e.event_type,
          })}
        />
      </td>
      <td className="px-3 py-2 text-foreground">
        <span className="line-clamp-1">{e.post_title || "-"}</span>
      </td>
      <td className="px-3 py-2">
        {e.event_type === "redeemed" && !e.actor_id ? (
          <span className="text-muted-foreground italic">{t("giftingAdmin.audit.anonymous")}</span>
        ) : (
          <span className="text-foreground line-clamp-1">
            {e.actor_name ?? e.actor_email ?? "-"}
          </span>
        )}
      </td>
      <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
        {e.code.slice(0, 10)}...
      </td>
    </tr>
  );
}
