// Molekula: formularz jednego MATERIALU sponsora.
//
// ADRES JEST WYMAGANY I SPRAWDZANY. Material bez adresu jest pozycja, ktora na
// stronie publicznej nie prowadzi nigdzie; dopuszczamy `https://` albo sciezke
// wewnetrzna, bo paczki logotypow leza w naszym magazynie.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AdminFormSection } from "@/components/admin/molecules/AdminFormSection";
import { AdminFormTextRow } from "@/components/admin/molecules/AdminFormTextRow";
import { AdminFormEnumRow } from "@/components/admin/molecules/AdminFormEnumRow";
import { AdminFormSwitchRow } from "@/components/admin/molecules/AdminFormSwitchRow";
import {
  SPONSOR_MAX_NAME,
  emptyMaterialDraft,
  materialDraftFromRow,
  materialDraftToInput,
  validateMaterialDraft,
  type MaterialDraft,
} from "@/lib/events/sponsorDraft";
import {
  SPONSOR_MATERIAL_KINDS,
  type SponsorMaterialInput,
  type SponsorMaterialKind,
} from "@/lib/events/sponsorsApi";

interface SponsorMaterialDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sponsorId: string;
  /** `null` = nowy material. */
  material: Record<string, unknown> | null;
  nextSortOrder: number;
  isSaving: boolean;
  onSubmit: (input: SponsorMaterialInput) => void;
}

export function SponsorMaterialDialog({
  open,
  onOpenChange,
  sponsorId,
  material,
  nextSortOrder,
  isSaving,
  onSubmit,
}: SponsorMaterialDialogProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<MaterialDraft>(() => emptyMaterialDraft(nextSortOrder));
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDraft(
      material === null ? emptyMaterialDraft(nextSortOrder) : materialDraftFromRow(material),
    );
    setTouched(false);
  }, [open, material, nextSortOrder]);

  const errors = validateMaterialDraft(draft);
  const errorFor = (field: keyof MaterialDraft): string | null => {
    if (!touched) return null;
    const found = errors.find((error) => error.field === field);
    return found === undefined ? null : t(found.messageKey);
  };

  const set = <K extends keyof MaterialDraft>(key: K, value: MaterialDraft[K]) =>
    setDraft((previous) => ({ ...previous, [key]: value }));

  const submit = () => {
    setTouched(true);
    if (errors.length > 0) return;
    onSubmit(materialDraftToInput(draft, sponsorId));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {t(
              draft.id === null
                ? "adminEventSponsors.sponsors.materials.dialog.createTitle"
                : "adminEventSponsors.sponsors.materials.dialog.editTitle",
            )}
          </DialogTitle>
        </DialogHeader>

        <AdminFormSection title={t("adminEventSponsors.labels.materials")} columns={2}>
          <AdminFormEnumRow<SponsorMaterialKind>
            label={t("adminEventSponsors.sponsors.materials.dialog.kind")}
            value={draft.kind}
            options={SPONSOR_MATERIAL_KINDS}
            labelFor={(option) => t(`adminEventSponsors.materialKinds.${option}`)}
            onValueChange={(value) => set("kind", value)}
          />
          <AdminFormTextRow
            label={t("adminEventSponsors.sponsors.materials.dialog.sortOrder")}
            value={draft.sortOrder}
            onValueChange={(value) => set("sortOrder", value)}
            inputMode="numeric"
            error={errorFor("sortOrder")}
          />
          <AdminFormTextRow
            label={t("adminEventSponsors.sponsors.materials.dialog.titlePl")}
            value={draft.titlePl}
            onValueChange={(value) => set("titlePl", value)}
            maxLength={SPONSOR_MAX_NAME}
            error={errorFor("titlePl")}
          />
          <AdminFormTextRow
            label={t("adminEventSponsors.sponsors.materials.dialog.titleEn")}
            value={draft.titleEn}
            onValueChange={(value) => set("titleEn", value)}
            maxLength={SPONSOR_MAX_NAME}
          />
          <AdminFormTextRow
            className="sm:col-span-2"
            label={t("adminEventSponsors.sponsors.materials.dialog.url")}
            value={draft.url}
            onValueChange={(value) => set("url", value)}
            placeholder="https://"
            error={errorFor("url")}
          />
          <AdminFormSwitchRow
            label={t("adminEventSponsors.sponsors.materials.dialog.isPublished")}
            checked={draft.isPublished}
            onCheckedChange={(value) => set("isPublished", value)}
          />
        </AdminFormSection>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            {t("adminEventSponsors.sponsors.materials.dialog.cancelAction")}
          </Button>
          <Button onClick={submit} disabled={isSaving}>
            {t("adminEventSponsors.sponsors.materials.dialog.saveAction")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
