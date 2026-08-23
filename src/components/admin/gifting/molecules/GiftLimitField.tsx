// Molekuła: jedno pole limitu w ustawieniach gifting (label + input + komunikat).
//
// Zakres i atrybuty min/max pochodzą z GIFT_ADMIN_BOUNDS, więc przeglądarka,
// walidacja draftu i CHECK w bazie egzekwują DOKŁADNIE ten sam przedział.
// Puste pole trzymamy jako null (issue "required") - nigdy nie koercjujemy go
// do 0, bo 0 znaczy tu "bez limitu", czyli obejście paywalla.
//
// Molekuła zna czysty lib (admin-model), nie zna react-query ani Supabase.
import { useTranslation } from "react-i18next";
import {
  GIFT_ADMIN_BOUNDS,
  parseGiftAdminLimitInput,
  type GiftAdminDraftIssue,
  type GiftAdminLimitField,
} from "@/lib/gifting/admin-model";
import { ensureI18n as ensureGiftingAdminI18n } from "@/lib/i18n-gifting-admin";

export function GiftLimitField({
  field,
  label,
  hint,
  value,
  issue,
  zeroWarning,
  onChange,
}: {
  field: GiftAdminLimitField;
  label: string;
  hint: string;
  value: number | null;
  issue: GiftAdminDraftIssue | undefined;
  /** Ostrzezenie pokazywane, gdy wartosc = 0 (limit wylaczony). */
  zeroWarning?: string;
  onChange: (value: number | null) => void;
}) {
  ensureGiftingAdminI18n();
  const { t } = useTranslation();
  const bounds = GIFT_ADMIN_BOUNDS[field];
  const inputId = `gift-admin-${field}`;
  const messageId = `${inputId}-message`;

  return (
    <div>
      <label htmlFor={inputId} className="block text-sm font-semibold text-foreground mb-1">
        {label}
      </label>
      <input
        id={inputId}
        type="number"
        inputMode="numeric"
        min={bounds.min}
        max={bounds.max}
        step={1}
        value={value ?? ""}
        onChange={(e) => onChange(parseGiftAdminLimitInput(e.target.value))}
        aria-invalid={issue ? true : undefined}
        aria-describedby={messageId}
        className={`h-10 w-40 rounded-[6px] border bg-background px-3 text-sm ${
          issue ? "border-destructive focus-visible:outline-destructive" : "border-border"
        }`}
      />
      <p
        id={messageId}
        className={`text-xs mt-1 ${issue ? "text-destructive" : "text-muted-foreground"}`}
      >
        {issue
          ? t(`giftingAdmin.settings.errors.${issue}`, { min: bounds.min, max: bounds.max })
          : hint}
      </p>
      {!issue && zeroWarning && value === 0 && (
        <p className="text-xs mt-1 font-medium text-amber-600 dark:text-amber-500" role="alert">
          {zeroWarning}
        </p>
      )}
    </div>
  );
}
