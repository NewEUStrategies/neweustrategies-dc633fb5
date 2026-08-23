// Molekuła: JEDEN wiersz tabeli rozmieszczenia reklam.
//
// Nazwa slotu przychodzi propsem (organizm trzyma mapę `slot_id -> slot`),
// a `undefined` daje KRESKĘ: pozycja wskazująca nieistniejący slot musi być
// widoczna jako uszkodzona, a nie zniknąć z tabeli. Pozycja i typ strony jadą
// przez mapy kluczy - jedyna informacja o aktywności to znak "✓"/"-".
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Trash2 as Trash } from "@/lib/lucide-shim";
import { AD_PAGE_TYPE_LABEL_KEYS, AD_POSITION_LABEL_KEYS, type AdPlacement } from "@/lib/ads/types";
import { ensureI18n as ensureAdsAdminI18n } from "@/lib/i18n-ads-admin";

export function AdPlacementRow({
  placement,
  slotName,
  onEdit,
  onDelete,
  editLabel,
}: {
  placement: AdPlacement;
  slotName: string | undefined;
  onEdit: (placement: AdPlacement) => void;
  onDelete: (id: string) => void;
  editLabel: string;
}) {
  ensureAdsAdminI18n();
  const { t } = useTranslation();
  return (
    <tr className="border-b border-border hover:bg-muted/40">
      <td className="p-3 font-medium">{slotName ?? "-"}</td>
      <td className="p-3">{t(AD_POSITION_LABEL_KEYS[placement.position])}</td>
      <td className="p-3">{t(AD_PAGE_TYPE_LABEL_KEYS[placement.page_type])}</td>
      <td className="p-3">{placement.active ? "✓" : "-"}</td>
      <td className="p-3 text-right space-x-2">
        <Button size="sm" variant="outline" onClick={() => onEdit(placement)}>
          {editLabel}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onDelete(placement.id)}>
          <Trash className="w-4 h-4" />
        </Button>
      </td>
    </tr>
  );
}
