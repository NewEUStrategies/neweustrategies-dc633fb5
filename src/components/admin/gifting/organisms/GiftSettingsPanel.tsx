// Organizm: formularz ustawień gifting per tenant.
//
// Formularz pracuje na DRAFCIE z lib/gifting/admin-model - jedno źródło prawdy
// dla zakresów (lustro CHECK-ów SQL), walidacji i semantyki "0 = bez limitu".
// Zapis jest możliwy wyłącznie wtedy, gdy draft daje kompletny payload
// (`draftToGiftAdminSettings !== null`), coś się realnie zmieniło i nie trwa
// poprzedni zapis. Brak wiersza w bazie czyni formularz brudnym Z DEFINICJI -
// jedno kliknięcie utrwala efektywne domyślne, które i tak już obowiązują.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { GiftEligibilityFieldset } from "@/components/admin/gifting/molecules/GiftEligibilityFieldset";
import { GiftLimitField } from "@/components/admin/gifting/molecules/GiftLimitField";
import {
  draftToGiftAdminSettings,
  giftAdminSettingsEqual,
  toGiftAdminDraft,
  validateGiftAdminDraft,
  type GiftAdminLimitField,
  type GiftAdminSettings,
  type GiftAdminSettingsDraft,
} from "@/lib/gifting/admin-model";
import { getGiftAdminSettings, updateGiftAdminSettings } from "@/lib/gifting-admin.functions";
import { ensureI18n as ensureGiftingAdminI18n } from "@/lib/i18n-gifting-admin";

/**
 * Ustawienia tenanta - jeden klucz cache dla zakladki Ustawienia i tabeli
 * linkow (kolumna "otwarcia / cap"), wiec zapis natychmiast odswieza oba.
 */
export function useGiftAdminSettingsQuery() {
  const getSettings = useServerFn(getGiftAdminSettings);
  return useQuery({
    queryKey: ["gift-admin", "settings"],
    queryFn: () => getSettings(),
    staleTime: 30_000,
  });
}

export function GiftSettingsPanel() {
  ensureGiftingAdminI18n();
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const updateSettings = useServerFn(updateGiftAdminSettings);
  const { data, isLoading } = useGiftAdminSettingsQuery();

  const [draft, setDraft] = useState<GiftAdminSettingsDraft | null>(null);

  const persistedSettings: GiftAdminSettings | null = data
    ? {
        enabled: data.enabled,
        monthly_limit: data.monthly_limit,
        link_ttl_days: data.link_ttl_days,
        max_redemptions_per_link: data.max_redemptions_per_link,
        eligibility: data.eligibility,
      }
    : null;

  const effective = draft ?? (persistedSettings ? toGiftAdminDraft(persistedSettings) : null);

  const save = useMutation({
    mutationFn: (payload: GiftAdminSettings) => updateSettings({ data: payload }),
    onSuccess: () => {
      toast.success(t("giftingAdmin.settings.saved"));
      setDraft(null);
      qc.invalidateQueries({ queryKey: ["gift-admin", "settings"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading || !effective || !persistedSettings || !data) {
    return <p className="text-sm text-muted-foreground">{t("giftingAdmin.common.loading")}</p>;
  }

  const issues = validateGiftAdminDraft(effective);
  const payload = draftToGiftAdminSettings(effective);
  // Brak wiersza w bazie = zapis zawsze dozwolony (utrwala efektywne domyslne);
  // przy istniejacym wierszu wymagamy realnej zmiany.
  const isDirty =
    !data.persisted || (payload !== null && !giftAdminSettingsEqual(payload, persistedSettings));
  const canSave = payload !== null && isDirty && !save.isPending;

  const setField = (field: GiftAdminLimitField) => (value: number | null) =>
    setDraft({ ...effective, [field]: value });

  const updatedAt =
    data.persisted && data.updated_at
      ? new Intl.DateTimeFormat(i18n.language === "en" ? "en-GB" : "pl-PL", {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date(data.updated_at))
      : null;

  return (
    <div className="max-w-2xl space-y-5">
      {!data.persisted && (
        <p className="rounded-[6px] border border-border bg-muted/40 px-4 py-3 text-xs text-muted-foreground">
          {t("giftingAdmin.settings.defaultsNotice")}
        </p>
      )}

      <label className="flex items-start gap-3 p-4 rounded-[6px] border border-border bg-card cursor-pointer">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 rounded-[3px] border-border accent-brand"
          checked={effective.enabled}
          onChange={(e) => setDraft({ ...effective, enabled: e.target.checked })}
        />
        <div>
          <div className="text-sm font-semibold text-foreground">
            {t("giftingAdmin.settings.enabled")}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {t("giftingAdmin.settings.enabledHint")}
          </p>
        </div>
      </label>

      <GiftEligibilityFieldset
        value={effective.eligibility}
        onChange={(eligibility) => setDraft({ ...effective, eligibility })}
      />

      <div className="grid gap-5 sm:grid-cols-2">
        <GiftLimitField
          field="monthly_limit"
          label={t("giftingAdmin.settings.monthlyLimit")}
          hint={t("giftingAdmin.settings.monthlyLimitHint")}
          value={effective.monthly_limit}
          issue={issues.monthly_limit}
          onChange={setField("monthly_limit")}
        />
        <GiftLimitField
          field="link_ttl_days"
          label={t("giftingAdmin.settings.ttl")}
          hint={t("giftingAdmin.settings.ttlHint")}
          value={effective.link_ttl_days}
          issue={issues.link_ttl_days}
          onChange={setField("link_ttl_days")}
        />
        <GiftLimitField
          field="max_redemptions_per_link"
          label={t("giftingAdmin.settings.cap")}
          hint={t("giftingAdmin.settings.capHint")}
          value={effective.max_redemptions_per_link}
          issue={issues.max_redemptions_per_link}
          zeroWarning={t("giftingAdmin.settings.capZeroWarning")}
          onChange={setField("max_redemptions_per_link")}
        />
      </div>

      <div className="flex items-center gap-3 pt-2">
        <button
          type="button"
          disabled={!canSave}
          onClick={() => payload && save.mutate(payload)}
          className="inline-flex items-center gap-2 h-10 px-4 rounded-[6px] bg-brand text-brand-foreground text-sm font-semibold hover:bg-brand/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
          {t("giftingAdmin.settings.save")}
        </button>
        {updatedAt && (
          <span className="text-xs text-muted-foreground">
            {t("giftingAdmin.settings.updatedAt", { when: updatedAt })}
          </span>
        )}
      </div>
    </div>
  );
}
