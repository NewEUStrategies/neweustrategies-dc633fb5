// Molekuła: JEDEN wiersz tabeli slotów reklamowych.
//
// Wiersz NIE rozmawia z bazą - akcje (edycja, kosz) oddaje wołającemu, więc
// dowód "usunięcie pyta o potwierdzenie" stoi tam, gdzie mieszka `confirmDialog`
// (organizm), a nie w markupie. Rodzaj kreacji jedzie przez
// `AD_SLOT_KIND_LABEL_KEYS`: nowy wariant `AdSlotKind` bez klucza nie skompiluje
// się, a brak wpisu w słowniku łapie bramka słownikowa.
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Trash2 as Trash } from "@/lib/lucide-shim";
import { AD_SLOT_KIND_LABEL_KEYS, type AdSlot } from "@/lib/ads/types";
import { ensureI18n as ensureAdsAdminI18n } from "@/lib/i18n-ads-admin";
import { AdConsentLabel } from "../atoms/AdConsentLabel";
import { AdSlotStatusLabel } from "../atoms/AdSlotStatusLabel";
import { AdTargetingSummary } from "../atoms/AdTargetingSummary";

export function AdSlotRow({
  slot,
  onEdit,
  onDelete,
  editLabel,
}: {
  slot: AdSlot;
  onEdit: (slot: AdSlot) => void;
  onDelete: (id: string) => void;
  editLabel: string;
}) {
  ensureAdsAdminI18n();
  const { t } = useTranslation();
  return (
    <tr className="border-b border-border hover:bg-muted/40">
      <td className="p-3 font-medium">{slot.name}</td>
      <td className="p-3">{t(AD_SLOT_KIND_LABEL_KEYS[slot.kind])}</td>
      <td className="p-3">
        <AdSlotStatusLabel status={slot.status} />
      </td>
      <td className="p-3">
        <AdConsentLabel requiresConsent={slot.requires_consent} />
      </td>
      <td className="p-3">
        <AdTargetingSummary targeting={slot.targeting} />
      </td>
      <td className="p-3 text-right space-x-2">
        <Button size="sm" variant="outline" onClick={() => onEdit(slot)}>
          {editLabel}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onDelete(slot.id)}>
          <Trash className="w-4 h-4" />
        </Button>
      </td>
    </tr>
  );
}
