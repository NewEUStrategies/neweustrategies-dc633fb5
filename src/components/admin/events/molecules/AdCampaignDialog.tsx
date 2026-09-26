// Molekula: okno zapisu kampanii reklamowej wydarzenia (nowa albo edycja).
//
// STAN ZYJE W SZKICU (`adsFunnelDraft.ts`), a walidacja pokazuje sie dopiero
// po pierwszej probie zapisu - pole wypelniane nie krzyczy "blad" po pierwszej
// literze. Baza sprawdza to samo jeszcze raz; jej odmowe (np. duplikat
// kampanii) pokazuje wolajacy toastem.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { AdminFormEnumRow } from "@/components/admin/molecules/AdminFormEnumRow";
import { AdminFormSection } from "@/components/admin/molecules/AdminFormSection";
import { AdminFormTextRow } from "@/components/admin/molecules/AdminFormTextRow";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AD_CAMPAIGN_MATCH_KINDS,
  type AdCampaign,
  type AdCampaignInput,
  type AdCampaignMatchKind,
} from "@/lib/events/adsFunnelApi";
import {
  adCampaignDraftFrom,
  adCampaignDraftToInput,
  emptyAdCampaignDraft,
  validateAdCampaignDraft,
  type AdCampaignDraft,
  type AdCampaignDraftErrorKey,
  type AdCampaignDraftField,
} from "@/lib/events/adsFunnelDraft";
import { ensureAdsFunnelI18n } from "@/lib/i18n-admin-event-ads-funnel";

const MATCH_KIND_LABEL_KEYS: Record<AdCampaignMatchKind, string> = {
  utm_campaign: "adminEventAdsFunnel.matchKinds.utm_campaign",
  google_ads_campaign_id: "adminEventAdsFunnel.matchKinds.google_ads_campaign_id",
};

const ERROR_KEYS: Record<AdCampaignDraftErrorKey, string> = {
  matchValueRequired: "adminEventAdsFunnel.validation.matchValueRequired",
  matchValueDigits: "adminEventAdsFunnel.validation.matchValueDigits",
  matchValueInvalid: "adminEventAdsFunnel.validation.matchValueInvalid",
  labelRequired: "adminEventAdsFunnel.validation.labelRequired",
  labelTooLong: "adminEventAdsFunnel.validation.labelTooLong",
  conversionNameInvalid: "adminEventAdsFunnel.validation.conversionNameInvalid",
};

export function AdCampaignDialog({
  open,
  onOpenChange,
  campaign,
  eventId,
  saving,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `null` = nowa kampania. */
  campaign: AdCampaign | null;
  eventId: string;
  saving: boolean;
  onSubmit: (input: AdCampaignInput) => void;
}) {
  ensureAdsFunnelI18n();
  const { t } = useTranslation();
  const [draft, setDraft] = useState<AdCampaignDraft>(emptyAdCampaignDraft);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDraft(campaign === null ? emptyAdCampaignDraft() : adCampaignDraftFrom(campaign));
    setTouched(false);
  }, [open, campaign]);

  const errors = validateAdCampaignDraft(draft);
  const errorFor = (field: AdCampaignDraftField): string | null => {
    const found = touched ? errors.find((error) => error.field === field) : undefined;
    return found === undefined ? null : t(ERROR_KEYS[found.errorKey]);
  };
  const set = <K extends keyof AdCampaignDraft>(key: K, value: AdCampaignDraft[K]) =>
    setDraft((previous) => ({ ...previous, [key]: value }));

  const submit = () => {
    setTouched(true);
    if (errors.length > 0) return;
    onSubmit(adCampaignDraftToInput(draft, eventId));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="event-dialog-compact max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {t(
              draft.id === null
                ? "adminEventAdsFunnel.campaignDialog.createTitle"
                : "adminEventAdsFunnel.campaignDialog.editTitle",
            )}
          </DialogTitle>
        </DialogHeader>

        <AdminFormSection title={t("adminEventAdsFunnel.campaignDialog.section")} columns={2}>
          <AdminFormEnumRow<AdCampaignMatchKind>
            id="ad-campaign-match-kind"
            label={t("adminEventAdsFunnel.campaignDialog.matchKind")}
            value={draft.matchKind}
            options={AD_CAMPAIGN_MATCH_KINDS}
            labelFor={(option) => t(MATCH_KIND_LABEL_KEYS[option])}
            onValueChange={(value) => set("matchKind", value)}
          />
          <AdminFormTextRow
            id="ad-campaign-match-value"
            label={t("adminEventAdsFunnel.campaignDialog.matchValue")}
            value={draft.matchValue}
            onValueChange={(value) => set("matchValue", value)}
            hint={t(
              draft.matchKind === "utm_campaign"
                ? "adminEventAdsFunnel.campaignDialog.matchValueHintUtm"
                : "adminEventAdsFunnel.campaignDialog.matchValueHintGad",
            )}
            inputMode={draft.matchKind === "utm_campaign" ? "text" : "numeric"}
            maxLength={100}
            monospace
            error={errorFor("matchValue")}
          />
          <AdminFormTextRow
            id="ad-campaign-label"
            className="sm:col-span-2"
            label={t("adminEventAdsFunnel.campaignDialog.label")}
            value={draft.label}
            onValueChange={(value) => set("label", value)}
            maxLength={120}
            error={errorFor("label")}
          />
          <AdminFormTextRow
            id="ad-campaign-conversion"
            className="sm:col-span-2"
            label={t("adminEventAdsFunnel.campaignDialog.conversionName")}
            value={draft.conversionActionName}
            onValueChange={(value) => set("conversionActionName", value)}
            hint={t("adminEventAdsFunnel.campaignDialog.conversionNameHint")}
            maxLength={100}
            error={errorFor("conversionActionName")}
          />
        </AdminFormSection>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t("adminEventAdsFunnel.campaignDialog.cancel")}
          </Button>
          <Button onClick={submit} disabled={saving}>
            {t(
              saving
                ? "adminEventAdsFunnel.campaignDialog.saving"
                : "adminEventAdsFunnel.campaignDialog.save",
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
