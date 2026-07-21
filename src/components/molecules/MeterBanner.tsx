import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import type { MeterState } from "@/lib/access/metering";
import "@/lib/i18n-paywall";

/**
 * Licznik meteringu nad artykułem odblokowanym "na licznik":
 * "Darmowy artykuł X z N w tym miesiącu" + CTA do cennika (i rejestracji dla
 * anonimów). Renderowany tylko dla granted=true i show_counter=true - czytelnik
 * z pełnym uprawnieniem (subskrypcja/zakup/organizacja) nigdy go nie widzi.
 */
export function MeterBanner({ meter }: { meter: MeterState }) {
  const { t } = useTranslation();
  const { session } = useAuth();

  if (!meter.granted || !meter.showCounter || meter.monthlyLimit <= 0) return null;

  const used = Math.min(meter.used, meter.monthlyLimit);
  const pct = Math.round((used / meter.monthlyLimit) * 100);

  return (
    <aside
      role="status"
      aria-live="polite"
      className="mb-6 rounded-lg border border-border bg-muted/40 px-4 py-3"
      data-testid="meter-banner"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {t("paywall.meter.counter", { used, limit: meter.monthlyLimit })}
          </p>
          <p className="text-xs text-muted-foreground">
            {meter.remaining > 0
              ? t("paywall.meter.remaining", { count: meter.remaining })
              : t("paywall.meter.lastOne")}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {!session && (
            <Link
              to="/login"
              search={{ mode: "signup" }}
              className="text-sm font-medium text-brand-ink hover:underline"
            >
              {t("paywall.meter.createAccount")}
            </Link>
          )}
          <Link to="/pricing" className="text-sm font-medium text-brand-ink hover:underline">
            {t("paywall.meter.seePlans")}
          </Link>
        </div>
      </div>
      <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-border" aria-hidden="true">
        <div
          className="h-full rounded-full bg-brand transition-[width] duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </aside>
  );
}
