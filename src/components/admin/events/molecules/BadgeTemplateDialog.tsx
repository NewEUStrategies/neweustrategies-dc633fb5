// Molekuła: formularz JEDNEGO szablonu identyfikatora.
//
// FORMAT WŁASNY WYMAGA OBU WYMIARÓW. `a6`/`a7`/`cr80` mają rozmiar zapisany w
// migracji, więc pola wymiarów są tam puste z sensem; przy `custom` puste pole
// znaczy „nie wiadomo, co wydrukować" i baza odmawia (`custom_dimensions_required`).
//
// ROZMIAR QR SPRAWDZAMY TYLKO PRZY WŁĄCZONYM KODZIE. Szablon bez kodu QR nie ma
// czego walidować, a błąd przy schowanym polu zablokowałby zapis bez widocznej
// przyczyny.
//
// WERSJA SZABLONU ROŚNIE PO STRONIE BAZY. Formularz jej nie wysyła - inaczej dwa
// otwarte okienka nadpisywałyby sobie numer, a rejestr wydruków przestałby
// odróżniać wydruk ze starej wersji od aktualnego.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
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
  BADGE_ORIENTATIONS,
  BADGE_PAPER_FORMATS,
  type BadgeOrientation,
  type BadgePaperFormat,
  type BadgeTemplateInput,
  type BadgeTemplateRow,
} from "@/lib/events/onsiteApi";
import {
  ONSITE_MAX_NAME,
  badgeTemplateDraftFromRow,
  badgeTemplateDraftToInput,
  emptyBadgeTemplateDraft,
  validateBadgeTemplateDraft,
  type BadgeTemplateDraft,
} from "@/lib/events/onsiteDraft";

interface BadgeTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: string;
  /** `null` = nowy szablon. */
  template: BadgeTemplateRow | null;
  isSaving: boolean;
  onSubmit: (input: BadgeTemplateInput) => void;
}

export function BadgeTemplateDialog({
  open,
  onOpenChange,
  eventId,
  template,
  isSaving,
  onSubmit,
}: BadgeTemplateDialogProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<BadgeTemplateDraft>(() => emptyBadgeTemplateDraft());
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDraft(
      template === null ? emptyBadgeTemplateDraft() : badgeTemplateDraftFromRow({ ...template }),
    );
    setTouched(false);
  }, [open, template]);

  const errors = validateBadgeTemplateDraft(draft);
  const errorFor = (field: string): string | null => {
    if (!touched) return null;
    const found = errors.find((error) => error.field === field);
    return found === undefined ? null : t(found.messageKey);
  };

  const set = <K extends keyof BadgeTemplateDraft>(key: K, value: BadgeTemplateDraft[K]) =>
    setDraft((previous) => ({ ...previous, [key]: value }));

  const submit = () => {
    setTouched(true);
    if (errors.length > 0) return;
    onSubmit(badgeTemplateDraftToInput(draft, eventId));
  };

  const isNew = draft.id === undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {t(
              isNew
                ? "adminEventOnsite.badges.dialog.createTitle"
                : "adminEventOnsite.badges.dialog.editTitle",
            )}
          </DialogTitle>
          <DialogDescription>{t("adminEventOnsite.badges.subtitle")}</DialogDescription>
        </DialogHeader>

        <AdminFormSection title={t("adminEventOnsite.badges.templatesTitle")} columns={2}>
          <AdminFormTextRow
            label={t("adminEventOnsite.badges.dialog.name")}
            value={draft.name}
            onValueChange={(value) => set("name", value)}
            maxLength={ONSITE_MAX_NAME}
            error={errorFor("name")}
            className="sm:col-span-2"
          />
          <AdminFormEnumRow<BadgePaperFormat>
            label={t("adminEventOnsite.badges.dialog.paperFormat")}
            value={draft.paperFormat as BadgePaperFormat}
            options={BADGE_PAPER_FORMATS}
            labelFor={(option) => t(`adminEventOnsite.paperFormats.${option}`)}
            onValueChange={(value) => set("paperFormat", value)}
          />
          <AdminFormEnumRow<BadgeOrientation>
            label={t("adminEventOnsite.badges.dialog.orientation")}
            value={draft.orientation as BadgeOrientation}
            options={BADGE_ORIENTATIONS}
            labelFor={(option) => t(`adminEventOnsite.orientations.${option}`)}
            onValueChange={(value) => set("orientation", value)}
          />
          <AdminFormTextRow
            label={t("adminEventOnsite.badges.dialog.widthMm")}
            value={draft.widthMm}
            onValueChange={(value) => set("widthMm", value)}
            inputMode="numeric"
            error={errorFor("widthMm")}
          />
          <AdminFormTextRow
            label={t("adminEventOnsite.badges.dialog.heightMm")}
            value={draft.heightMm}
            onValueChange={(value) => set("heightMm", value)}
            inputMode="numeric"
            error={errorFor("heightMm")}
          />
          <AdminFormSwitchRow
            label={t("adminEventOnsite.badges.dialog.showQr")}
            checked={draft.showQr}
            onCheckedChange={(value) => set("showQr", value)}
          />
          {draft.showQr ? (
            <AdminFormTextRow
              label={t("adminEventOnsite.badges.dialog.qrSizeMm")}
              value={draft.qrSizeMm}
              onValueChange={(value) => set("qrSizeMm", value)}
              inputMode="numeric"
              error={errorFor("qrSizeMm")}
            />
          ) : null}
          <AdminFormTextRow
            label={t("adminEventOnsite.badges.dialog.backgroundColor")}
            value={draft.backgroundColor}
            onValueChange={(value) => set("backgroundColor", value)}
            monospace
            error={errorFor("backgroundColor")}
          />
          <AdminFormTextRow
            label={t("adminEventOnsite.badges.dialog.backgroundImageUrl")}
            value={draft.backgroundImageUrl}
            onValueChange={(value) => set("backgroundImageUrl", value)}
            error={errorFor("backgroundImageUrl")}
          />
          <AdminFormSwitchRow
            label={t("adminEventOnsite.badges.dialog.doubleFold")}
            checked={draft.doubleFold}
            onCheckedChange={(value) => set("doubleFold", value)}
          />
          <AdminFormSwitchRow
            label={t("adminEventOnsite.badges.dialog.isDefault")}
            checked={draft.isDefault}
            onCheckedChange={(value) => set("isDefault", value)}
          />
        </AdminFormSection>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            {t("adminEventOnsite.actions.cancel")}
          </Button>
          <Button onClick={submit} disabled={isSaving}>
            {t("adminEventOnsite.actions.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
