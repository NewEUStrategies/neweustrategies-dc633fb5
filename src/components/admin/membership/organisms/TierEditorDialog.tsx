// Organizm: okno edycji jednej warstwy członkostwa.
//
// Katalog warstw pokazuje kompaktowe kafle; pełna edycja (zakładki Podstawy /
// Benefity / Bramki) wjeżdża w oknie, dzięki czemu strona panelu nie rośnie
// wraz z liczbą warstw i nie trzeba przewijać kilku ekranów, żeby porównać
// warstwy.
import { useTranslation } from "react-i18next";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TierEditorCard } from "@/components/admin/membership/molecules/TierEditorCard";
import type { TierDraft } from "@/lib/admin/membershipDrafts";
import type { MembershipTierRow } from "@/lib/billing/tiers";

export function TierEditorDialog({
  tier,
  draft,
  saving,
  deleting,
  onOpenChange,
  onChange,
  onSave,
  onDelete,
}: {
  /** `null` = okno zamknięte; warstwa niesie też tożsamość okna. */
  tier: MembershipTierRow | null;
  draft: TierDraft | null;
  saving: boolean;
  deleting: boolean;
  onOpenChange: (next: boolean) => void;
  onChange: (patch: Partial<TierDraft>) => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const tm = (k: string, opts?: Record<string, unknown>) => t(`adminMembership.${k}`, opts);
  const open = Boolean(tier && draft);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto rounded-[6px] font-sans">
        {tier && draft && (
          <>
            <DialogHeader>
              <DialogTitle className="text-base">
                {tm("editDialog.title", { name: tier.name_pl })}
              </DialogTitle>
              <DialogDescription className="text-xs">{tm("editDialog.hint")}</DialogDescription>
            </DialogHeader>
            <TierEditorCard
              tier={tier}
              draft={draft}
              saving={saving}
              deleting={deleting}
              onChange={onChange}
              onSave={onSave}
              onDelete={onDelete}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
