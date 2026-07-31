// Licznik meteringu w warstwie treści - nad artykułem odblokowanym "na licznik":
// "Darmowy artykuł X z N w tym miesiącu", wyraźne "zostało N", segmentowy
// wskaźnik zużycia (atom QuotaMeter) i data odnowienia limitu + CTA do cennika
// (i rejestracji dla anonimów). Renderowany wyłącznie, gdy meterCounterVisible
// (granted + show_counter + realny limit) - czytelnik z pełnym uprawnieniem
// (subskrypcja/zakup/organizacja) nigdy go nie widzi.
//
// Liczby NIE pochodzą wprost z zamrożonego stanu per artykuł: latestMeterNumbers
// scala go z żywym stanem miesiąca (useMeterQuota + zasiew po każdej
// konsumpcji), więc powrót do przeczytanego artykułu pokazuje bieżące zużycie,
// a nie snapshot z chwili pierwszego odblokowania.
// Stylistyka rodziny banerów treści (GiftBanner): tokeny semantyczne,
// rounded-[5px], kółko z ikoną; ostatni darmowy artykuł podbija tonację brand.
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Gauge } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import {
  formatMeterResetDate,
  latestMeterNumbers,
  meterCounterVisible,
  useMeterQuota,
  type MeterState,
} from "@/lib/access/metering";
import { QuotaMeter } from "@/components/atoms/QuotaMeter";
import "@/lib/i18n-paywall";

export function MeterBanner({ meter }: { meter: MeterState }) {
  const { t, i18n } = useTranslation();
  const { session } = useAuth();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";
  const visible = meterCounterVisible(meter);
  const { data: quota } = useMeterQuota(visible);

  if (!visible) return null;

  const { used, monthlyLimit, remaining } = latestMeterNumbers(meter, quota ?? null);
  const shownUsed = Math.min(used, monthlyLimit);
  const last = remaining <= 0;

  return (
    <aside
      role="status"
      aria-live="polite"
      data-testid="meter-banner"
      data-meter-remaining={remaining}
      className={[
        "no-print mb-6 rounded-[5px] border px-4 py-3",
        last
          ? "border-brand/30 bg-gradient-to-r from-brand/10 to-transparent"
          : "border-border bg-muted/40",
      ].join(" ")}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span
          className={[
            "grid h-9 w-9 shrink-0 place-items-center rounded-full",
            last ? "bg-brand/15" : "bg-muted",
          ].join(" ")}
        >
          <Gauge
            className={last ? "h-4 w-4 text-brand-ink" : "h-4 w-4 text-muted-foreground"}
            aria-hidden
          />
        </span>
        <div className="min-w-[12rem] flex-1">
          <p className="text-[13px] font-bold leading-tight text-foreground">
            {t("paywall.meter.counter", { used: shownUsed, limit: monthlyLimit })}
          </p>
          <p className="text-[12px] leading-snug text-muted-foreground">
            {last ? (
              <span className="font-medium text-brand-ink">{t("paywall.meter.lastOne")}</span>
            ) : (
              t("paywall.meter.remaining", { count: remaining })
            )}{" "}
            <span>{t("paywall.meter.resetsOn", { date: formatMeterResetDate(lang) })}</span>
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
          <Link
            to="/pricing"
            className="inline-flex h-8 shrink-0 items-center justify-center rounded-[5px] border border-border bg-background px-3 text-[12px] font-semibold text-foreground transition-colors hover:bg-muted hover:text-brand"
          >
            {t("paywall.meter.seePlans")}
          </Link>
        </div>
      </div>
      <QuotaMeter
        used={shownUsed}
        limit={monthlyLimit}
        label={t("paywall.meter.progressLabel")}
        valueText={t("paywall.meter.progressValue", { used: shownUsed, limit: monthlyLimit })}
        className="mt-2.5"
      />
    </aside>
  );
}
