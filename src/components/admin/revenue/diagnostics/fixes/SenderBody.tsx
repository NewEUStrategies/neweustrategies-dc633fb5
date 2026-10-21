// Treść naprawy `newsletter_sender`: własny adres nadawcy i (opcjonalnie)
// nazwa. Adres nie trafia do faktów diagnostyki - jedzie wprost mutatorem
// modułu newslettera. Kształt sprawdza `SENDER_EMAIL_PATTERN` (ten sam
// predykat co `valid` specyfikacji), błąd mówi, CO poprawić.
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  QUICK_FIXES,
  type QuickFixBodyProps,
  type SenderPayload,
} from "@/lib/admin/revenue/quickFixes";
import { ensureI18n } from "@/lib/i18n-admin-revenue-diagnostics";

export default function SenderBody({
  value,
  onChange,
  disabled,
}: QuickFixBodyProps<SenderPayload>) {
  ensureI18n();
  const { t } = useTranslation();
  const emailId = useId();
  const nameId = useId();
  const hintId = useId();
  const errorId = useId();
  const touched = value.email.trim() !== "";
  const valid = QUICK_FIXES.newsletter_sender.valid?.(value) ?? true;
  const invalid = touched && !valid;

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label htmlFor={emailId}>{t("adminRevenue.fix.body.senderEmail")}</Label>
        <Input
          id={emailId}
          type="email"
          inputMode="email"
          autoComplete="off"
          value={value.email}
          onChange={(e) => onChange({ ...value, email: e.target.value })}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? `${hintId} ${errorId}` : hintId}
          disabled={disabled}
        />
        <p id={hintId} className="m-0 text-xs text-muted-foreground">
          {t("adminRevenue.fix.body.senderEmailHint")}
        </p>
        {invalid ? (
          <p id={errorId} className="m-0 text-xs text-destructive">
            {t("adminRevenue.fix.body.senderEmailInvalid")}
          </p>
        ) : null}
      </div>
      <div className="space-y-1">
        <Label htmlFor={nameId}>{t("adminRevenue.fix.body.senderName")}</Label>
        <Input
          id={nameId}
          value={value.name}
          onChange={(e) => onChange({ ...value, name: e.target.value })}
          disabled={disabled}
        />
      </div>
    </div>
  );
}
