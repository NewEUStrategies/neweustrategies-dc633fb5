// Molekuła: bramka uprawnienia - kto w ogóle zobaczy przycisk „Udostępnij pełny
// artykuł" i wygeneruje link.
//
// Radiogroup zamiast selecta: dwie opcje z realnymi konsekwencjami biznesowymi
// czyta się lepiej obok siebie. Kolejność renderowania = GIFT_ELIGIBILITY_OPTIONS.
import { useTranslation } from "react-i18next";
import { GIFT_ELIGIBILITY_OPTIONS } from "@/lib/gifting/admin-model";
import type { GiftEligibility } from "@/lib/gifting/model";
import { ensureI18n as ensureGiftingAdminI18n } from "@/lib/i18n-gifting-admin";

export function GiftEligibilityFieldset({
  value,
  onChange,
}: {
  value: GiftEligibility;
  onChange: (next: GiftEligibility) => void;
}) {
  ensureGiftingAdminI18n();
  const { t } = useTranslation();

  return (
    <fieldset className="rounded-[6px] border border-border bg-card p-4">
      <legend className="px-1 text-sm font-semibold text-foreground">
        {t("giftingAdmin.settings.eligibility")}
      </legend>
      <p className="text-xs text-muted-foreground mb-3">
        {t("giftingAdmin.settings.eligibilityHint")}
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {GIFT_ELIGIBILITY_OPTIONS.map((option) => (
          <label
            key={option}
            className={`flex cursor-pointer items-start gap-3 rounded-[6px] border p-3 transition-colors ${
              value === option ? "border-brand bg-brand/5" : "border-border hover:bg-muted/40"
            }`}
          >
            <input
              type="radio"
              name="gift-admin-eligibility"
              className="mt-1 h-4 w-4 border-border accent-brand"
              value={option}
              checked={value === option}
              onChange={() => onChange(option)}
            />
            <span>
              <span className="block text-sm font-semibold text-foreground">
                {t(`giftingAdmin.settings.eligibilityOptions.${option}.label`)}
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">
                {t(`giftingAdmin.settings.eligibilityOptions.${option}.hint`)}
              </span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
