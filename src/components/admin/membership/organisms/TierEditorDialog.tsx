// Organizm: okno edycji jednej warstwy członkostwa.
//
// Katalog warstw pokazuje kompaktowe kafle; pełna edycja (zakładki Podstawy /
// Benefity / Bramki) wjeżdża w oknie, dzięki czemu strona panelu nie rośnie
// wraz z liczbą warstw i nie trzeba przewijać kilku ekranów, żeby porównać
// warstwy.
//
// ADRES = STAN (SPEC §2.6). Okno otwiera klucz warstwy (`?tier=<key>` - link
// z huba, z Cennika albo odświeżona strona), nie identyfikator wiersza: klucz
// jest tym, co admin widzi w mapowaniu planów i nadaniach. Klucz, którego nie
// ma w katalogu (warstwa usunięta, stary link), daje jawny komunikat w oknie,
// a nie ciche nieotwarcie - inaczej link z huba wyglądałby na zepsuty.
import { useTranslation } from "react-i18next";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TierEditorCard } from "@/components/admin/membership/molecules/TierEditorCard";
import type { TierCoreDraft } from "@/components/admin/membership/tierCoreDraft";
import { tierName, type MembershipTierRow } from "@/lib/billing/tiers";

export function TierEditorDialog({
  tierKey,
  tier,
  draft,
  loading,
  saving,
  deleting,
  canSave,
  onOpenChange,
  onChange,
  onSave,
  onDelete,
}: {
  /** Klucz otwartej warstwy; `null` = okno zamknięte. */
  tierKey: string | null;
  /** Wiersz bazowy edycji; `null` = brak warstwy o tym kluczu. */
  tier: MembershipTierRow | null;
  draft: TierCoreDraft | null;
  /** Katalog jeszcze się wczytuje - „brak warstwy" byłby fałszywy. */
  loading: boolean;
  saving: boolean;
  deleting: boolean;
  canSave: boolean;
  onOpenChange: (next: boolean) => void;
  onChange: (patch: Partial<TierCoreDraft>) => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  const { t, i18n } = useTranslation();
  const tm = (k: string, opts?: Record<string, unknown>) => t(`adminMembership.${k}`, opts);
  const lang = i18n.language === "en" ? "en" : "pl";
  const open = tierKey !== null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto rounded-[6px] p-0 font-sans">
        <DialogHeader className="px-5 pt-5">
          <DialogTitle className="text-base">
            {tm("editDialog.title", { name: tier ? tierName(tier, lang) : (tierKey ?? "") })}
          </DialogTitle>
          <DialogDescription className="text-[10px]">{tm("editDialog.hint")}</DialogDescription>
        </DialogHeader>
        {tier && draft ? (
          <TierEditorCard
            tier={tier}
            draft={draft}
            saving={saving}
            deleting={deleting}
            canSave={canSave}
            onChange={onChange}
            onSave={onSave}
            onDelete={onDelete}
          />
        ) : loading ? (
          <p role="status" className="px-5 pb-5 text-sm text-muted-foreground">
            {t("common.loading")}
          </p>
        ) : (
          <p role="alert" className="px-5 pb-5 text-sm text-muted-foreground">
            {tm("editDialog.notFound", { key: tierKey ?? "" })}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
