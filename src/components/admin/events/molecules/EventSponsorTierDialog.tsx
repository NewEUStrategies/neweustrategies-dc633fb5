// Molekula: formularz jednego POZIOMU sponsorskiego.
//
// KLUCZ ZAMROZONY PO ZAPISIE - RPC zapisu nie czyta klucza przy edycji, wiec
// edytowalne pole obiecywaloby zmiane, ktora nigdy sie nie stanie.
//
// KORZYSCI SA LISTA W FORMULARZU, NIE OSOBNYM EKRANEM. Baza trzyma je w JSON-ie
// poziomu (`event_sponsor_tier_benefits`), a organizator ustawia je razem
// z nazwa poziomu - rozdzielenie tych dwoch krokow zostawialoby poziomy bez
// jednej korzysci.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AdminFormSection } from "@/components/admin/molecules/AdminFormSection";
import { AdminFormTextRow } from "@/components/admin/molecules/AdminFormTextRow";
import { AdminFormEnumRow } from "@/components/admin/molecules/AdminFormEnumRow";
import { AdminFormSwitchRow } from "@/components/admin/molecules/AdminFormSwitchRow";
import {
  SPONSOR_MAX_DESCRIPTION,
  SPONSOR_MAX_NAME,
  emptyTierDraft,
  tierDraftFromRow,
  tierDraftToInput,
  validateTierDraft,
  type TierDraft,
} from "@/lib/events/sponsorDraft";
import {
  SPONSOR_TIER_LOGO_SIZES,
  type EventSponsorTierRow,
  type SponsorTierInput,
  type SponsorTierLogoSize,
} from "@/lib/events/sponsorsApi";

interface EventSponsorTierDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: string;
  /** `null` = nowy poziom. */
  tier: EventSponsorTierRow | null;
  nextSortOrder: number;
  nextRank: number;
  isSaving: boolean;
  onSubmit: (input: SponsorTierInput) => void;
}

export function EventSponsorTierDialog({
  open,
  onOpenChange,
  eventId,
  tier,
  nextSortOrder,
  nextRank,
  isSaving,
  onSubmit,
}: EventSponsorTierDialogProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<TierDraft>(() => emptyTierDraft(nextSortOrder, nextRank));
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDraft(
      tier === null
        ? emptyTierDraft(nextSortOrder, nextRank)
        : tierDraftFromRow(tier as unknown as Record<string, unknown>),
    );
    setTouched(false);
  }, [open, tier, nextSortOrder, nextRank]);

  const errors = validateTierDraft(draft);
  const errorFor = (field: keyof TierDraft): string | null => {
    if (!touched) return null;
    const found = errors.find((error) => error.field === field);
    return found === undefined ? null : t(found.messageKey);
  };

  const set = <K extends keyof TierDraft>(key: K, value: TierDraft[K]) =>
    setDraft((previous) => ({ ...previous, [key]: value }));

  const submit = () => {
    setTouched(true);
    if (errors.length > 0) return;
    onSubmit(tierDraftToInput(draft, eventId));
  };

  const isNew = draft.id === null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {t(
              isNew
                ? "adminEventSponsors.tiers.dialog.createTitle"
                : "adminEventSponsors.tiers.dialog.editTitle",
            )}
          </DialogTitle>
          <DialogDescription>{t("adminEventSponsors.tiers.subtitle")}</DialogDescription>
        </DialogHeader>

        <AdminFormSection title={t("adminEventSponsors.tiers.title")} columns={2}>
          <AdminFormTextRow
            label={t("adminEventSponsors.tiers.dialog.key")}
            hint={t("adminEventSponsors.tiers.dialog.keyHint")}
            value={draft.key}
            onValueChange={(value) => set("key", value)}
            disabled={!isNew}
            monospace
            maxLength={49}
            error={errorFor("key")}
          />
          <AdminFormEnumRow<SponsorTierLogoSize>
            label={t("adminEventSponsors.tiers.dialog.logoSize")}
            value={draft.logoSize}
            options={SPONSOR_TIER_LOGO_SIZES}
            labelFor={(option) => t(`adminEventSponsors.logoSizes.${option}`)}
            onValueChange={(value) => set("logoSize", value)}
          />
          <AdminFormTextRow
            label={t("adminEventSponsors.tiers.dialog.namePl")}
            value={draft.namePl}
            onValueChange={(value) => set("namePl", value)}
            maxLength={SPONSOR_MAX_NAME}
            error={errorFor("namePl")}
          />
          <AdminFormTextRow
            label={t("adminEventSponsors.tiers.dialog.nameEn")}
            value={draft.nameEn}
            onValueChange={(value) => set("nameEn", value)}
            maxLength={SPONSOR_MAX_NAME}
          />
          <AdminFormTextRow
            label={t("adminEventSponsors.tiers.dialog.descriptionPl")}
            value={draft.descriptionPl}
            onValueChange={(value) => set("descriptionPl", value)}
            maxLength={SPONSOR_MAX_DESCRIPTION}
            rows={3}
          />
          <AdminFormTextRow
            label={t("adminEventSponsors.tiers.dialog.descriptionEn")}
            value={draft.descriptionEn}
            onValueChange={(value) => set("descriptionEn", value)}
            maxLength={SPONSOR_MAX_DESCRIPTION}
            rows={3}
          />
          <AdminFormTextRow
            label={t("adminEventSponsors.tiers.dialog.rank")}
            hint={t("adminEventSponsors.tiers.dialog.rankHint")}
            value={draft.rank}
            onValueChange={(value) => set("rank", value)}
            inputMode="numeric"
            error={errorFor("rank")}
          />
          <AdminFormTextRow
            label={t("adminEventSponsors.tiers.dialog.sortOrder")}
            value={draft.sortOrder}
            onValueChange={(value) => set("sortOrder", value)}
            inputMode="numeric"
          />
          <AdminFormTextRow
            label={t("adminEventSponsors.tiers.dialog.maxCompanies")}
            hint={t("adminEventSponsors.tiers.dialog.maxCompaniesHint")}
            value={draft.maxCompanies}
            onValueChange={(value) => set("maxCompanies", value)}
            inputMode="numeric"
            error={errorFor("maxCompanies")}
          />
          <AdminFormTextRow
            label={t("adminEventSponsors.labels.accentColor")}
            value={draft.accentColor}
            onValueChange={(value) => set("accentColor", value)}
            placeholder="#FA9346"
            monospace
            maxLength={7}
            error={errorFor("accentColor")}
          />
          <AdminFormSwitchRow
            label={t("adminEventSponsors.tiers.dialog.isActive")}
            checked={draft.isActive}
            onCheckedChange={(value) => set("isActive", value)}
          />
        </AdminFormSection>

        <AdminFormSection title={t("adminEventSponsors.labels.benefits")}>
          <div className="space-y-3">
            {draft.benefits.map((benefit, index) => (
              <div
                key={`benefit-${String(index)}`}
                className="grid gap-3 rounded-md border border-border/70 p-3 sm:grid-cols-2"
              >
                <AdminFormTextRow
                  label={t("adminEventSponsors.tiers.dialog.benefitPl")}
                  value={benefit.labelPl}
                  onValueChange={(value) =>
                    setDraft((previous) => ({
                      ...previous,
                      benefits: previous.benefits.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, labelPl: value } : item,
                      ),
                    }))
                  }
                  maxLength={SPONSOR_MAX_NAME}
                />
                <AdminFormTextRow
                  label={t("adminEventSponsors.tiers.dialog.benefitEn")}
                  value={benefit.labelEn}
                  onValueChange={(value) =>
                    setDraft((previous) => ({
                      ...previous,
                      benefits: previous.benefits.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, labelEn: value } : item,
                      ),
                    }))
                  }
                  maxLength={SPONSOR_MAX_NAME}
                />
                <AdminFormSwitchRow
                  label={t("adminEventSponsors.tiers.dialog.benefitHighlighted")}
                  checked={benefit.isHighlighted}
                  onCheckedChange={(value) =>
                    setDraft((previous) => ({
                      ...previous,
                      benefits: previous.benefits.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, isHighlighted: value } : item,
                      ),
                    }))
                  }
                />
                <div className="flex items-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setDraft((previous) => ({
                        ...previous,
                        benefits: previous.benefits.filter((_item, itemIndex) => itemIndex !== index),
                      }))
                    }
                  >
                    <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
                    {t("adminEventSponsors.tiers.dialog.removeBenefit")}
                  </Button>
                </div>
              </div>
            ))}
            {errorFor("benefits") === null ? null : (
              <p className="text-xs text-destructive" role="alert">
                {errorFor("benefits")}
              </p>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setDraft((previous) => ({
                  ...previous,
                  benefits: [
                    ...previous.benefits,
                    { labelPl: "", labelEn: "", isHighlighted: false },
                  ],
                }))
              }
            >
              <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
              {t("adminEventSponsors.tiers.dialog.addBenefit")}
            </Button>
          </div>
        </AdminFormSection>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            {t("adminEventSponsors.tiers.dialog.cancelAction")}
          </Button>
          <Button onClick={submit} disabled={isSaving}>
            {t("adminEventSponsors.tiers.dialog.saveAction")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
