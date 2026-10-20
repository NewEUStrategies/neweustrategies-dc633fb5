// Treść napraw liczbowych: limit darmowych artykułów dla gości
// (`metering_anon_limit`, rozwiązanie „własna liczba") i okno porzucenia kasy
// (`checkout_abandon_window`, 30-1440 minut). Pole przyjmuje tylko cyfry;
// wartość spoza zakresu jest ODRZUCANA komunikatem, nigdy przycinana (AGENTS),
// a „Zastosuj" pilnuje `valid` specyfikacji tym samym predykatem.
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { METERING_LIMIT_MAX } from "@/lib/access/meteringQueries";
import type { NumberPayload, QuickFixBodyProps } from "@/lib/admin/revenue/quickFixes";
import { ensureI18n } from "@/lib/i18n-admin-revenue-diagnostics";
import { REVENUE_LIMITS, isCheckoutAbandonMinutes } from "@/lib/revenue/limits";

export default function NumberBody({
  finding,
  option,
  value,
  onChange,
  disabled,
}: QuickFixBodyProps<NumberPayload>) {
  ensureI18n();
  const { t } = useTranslation();
  const id = useId();
  const hintId = useId();
  const errorId = useId();
  if (option.id !== "custom") return null;

  const minutes = finding.checkId === "checkout.abandon_window_default";
  const min = minutes ? REVENUE_LIMITS.checkoutAbandonMinutesMin : 1;
  const max = minutes ? REVENUE_LIMITS.checkoutAbandonMinutesMax : METERING_LIMIT_MAX;
  const inRange = (n: number | null) =>
    n !== null && (minutes ? isCheckoutAbandonMinutes(n) : Number.isInteger(n) && n >= min && n <= max);
  const invalid = value.value !== null && !inRange(value.value);

  return (
    <div className="space-y-1">
      <Label htmlFor={id}>
        {t(minutes ? "adminRevenue.fix.body.minutes" : "adminRevenue.fix.body.number")}
      </Label>
      <Input
        id={id}
        type="text"
        inputMode="numeric"
        className="max-w-[10rem]"
        value={value.value === null ? "" : String(value.value)}
        onChange={(e) => {
          const raw = e.target.value.trim();
          onChange({ value: /^\d{1,5}$/.test(raw) ? Number(raw) : null });
        }}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${hintId} ${errorId}` : hintId}
        disabled={disabled}
      />
      <p id={hintId} className="m-0 text-xs text-muted-foreground">
        {t("adminRevenue.fix.body.minutesHint", { min, max })}
      </p>
      {invalid ? (
        <p id={errorId} className="m-0 text-xs text-destructive">
          {t("adminRevenue.fix.body.numberInvalid")}
        </p>
      ) : null}
    </div>
  );
}
