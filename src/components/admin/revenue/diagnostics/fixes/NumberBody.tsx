// Treść napraw liczbowych: limit darmowych artykułów dla gości
// (`metering_anon_limit`, rozwiązanie „własna liczba") i okno porzucenia kasy
// (`checkout_abandon_window`, 30-1440 minut). Pole pokazuje DOKŁADNIE to, co
// wpisano (tekst trzymamy lokalnie); wpis nieliczbowy albo spoza zakresu jest
// ODRZUCANY komunikatem, nigdy przycinany ani czyszczony (AGENTS), a
// „Zastosuj" pilnuje `valid` specyfikacji (ładunek `null` = niekompletne).
import { useId, useState } from "react";
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
  const [text, setText] = useState(value.value === null ? "" : String(value.value));
  if (option.id !== "custom") return null;

  const minutes = finding.checkId === "checkout.abandon_window_default";
  const min = minutes ? REVENUE_LIMITS.checkoutAbandonMinutesMin : 1;
  const max = minutes ? REVENUE_LIMITS.checkoutAbandonMinutesMax : METERING_LIMIT_MAX;
  const inRange = (n: number | null) =>
    n !== null &&
    (minutes ? isCheckoutAbandonMinutes(n) : Number.isInteger(n) && n >= min && n <= max);
  const parsed = /^\d{1,6}$/.test(text.trim()) ? Number(text.trim()) : null;
  const invalid = text.trim() !== "" && !inRange(parsed);

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
        value={text}
        onChange={(e) => {
          const raw = e.target.value;
          setText(raw);
          const next = /^\d{1,6}$/.test(raw.trim()) ? Number(raw.trim()) : null;
          onChange({ value: next !== null && inRange(next) ? next : null });
        }}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${hintId} ${errorId}` : hintId}
        disabled={disabled}
      />
      <p id={hintId} className="m-0 text-xs text-muted-foreground">
        {t(minutes ? "adminRevenue.fix.body.minutesHint" : "adminRevenue.fix.body.numberHint", {
          min,
          max,
        })}
      </p>
      {invalid ? (
        <p id={errorId} className="m-0 text-xs text-destructive">
          {t("adminRevenue.fix.body.numberInvalid")}
        </p>
      ) : null}
    </div>
  );
}
