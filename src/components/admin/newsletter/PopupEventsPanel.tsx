// Raport zdarzeń popupu newslettera (impression / open / submit / success / error).
//
// Źródłem jest `newsletter_popup_events` przez RPC agregujące per dzień, więc
// panel nie ściąga surowych wierszy telemetrii do przeglądarki.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { Activity, MousePointerClick, Send, CheckCircle2, AlertTriangle } from "lucide-react";
import { ensureI18n as ensureNewsletterAdminI18n } from "@/lib/i18n-newsletter-admin";
import {
  getNewsletterPopupEventStats,
  type NewsletterPopupEventName,
} from "@/lib/newsletter-popup-events.functions";

const RANGES = [7, 30, 90] as const;

/**
 * Ikona + KLUCZ etykiety. Poprzednio siedzialy tu pary `{ pl, en }`, czyli
 * drugi slownik obok pliku i18n - niewidoczny dla bramki parytetu, wiec brak
 * jednego tlumaczenia nie mial jak sie ujawnic.
 */
const EVENT_META: Record<NewsletterPopupEventName, { icon: typeof Activity; labelKey: string }> = {
  impression: { icon: Activity, labelKey: "adminNewsletter.popupEvents.events.impression" },
  open: { icon: MousePointerClick, labelKey: "adminNewsletter.popupEvents.events.open" },
  submit: { icon: Send, labelKey: "adminNewsletter.popupEvents.events.submit" },
  success: { icon: CheckCircle2, labelKey: "adminNewsletter.popupEvents.events.success" },
  error: { icon: AlertTriangle, labelKey: "adminNewsletter.popupEvents.events.error" },
};

const ORDER: NewsletterPopupEventName[] = ["impression", "open", "submit", "success", "error"];

export function PopupEventsPanel() {
  ensureNewsletterAdminI18n();
  const { t } = useTranslation();
  const [days, setDays] = useState<number>(30);
  const fetchStats = useServerFn(getNewsletterPopupEventStats);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin", "newsletter-popup-events", days],
    queryFn: () => fetchStats({ data: { days } }),
  });

  const pct = useMemo(() => (value: number) => `${(value * 100).toFixed(1)}%`, []);

  return (
    <section className="bg-card border border-border rounded-xl p-5 space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-foreground">
            {t("adminNewsletter.popupEvents.title")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t("adminNewsletter.popupEvents.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-[6px] border border-border p-1">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setDays(r)}
              className={`rounded-[6px] px-3 py-1.5 text-xs font-medium transition-colors ${
                days === r
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted"
              }`}
            >
              {t("adminNewsletter.popupEvents.rangeDays", { days: r })}
            </button>
          ))}
        </div>
      </header>

      {isLoading && (
        <p className="text-sm text-muted-foreground">{t("adminNewsletter.popupEvents.loading")}</p>
      )}
      {isError && (
        <p className="text-sm text-destructive">{t("adminNewsletter.popupEvents.error")}</p>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
            {ORDER.map((key) => {
              const meta = EVENT_META[key];
              const Icon = meta.icon;
              return (
                <div key={key} className="rounded-[6px] border border-border bg-background p-3">
                  <div className="flex items-center gap-2 text-muted-foreground text-xs">
                    <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                    {t(meta.labelKey)}
                  </div>
                  <div className="mt-1 text-2xl font-semibold text-foreground tabular-nums">
                    {data.totals[key]}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
            <Ratio
              label={t("adminNewsletter.popupEvents.ratioSubmit")}
              value={pct(data.submitRate)}
            />
            <Ratio
              label={t("adminNewsletter.popupEvents.ratioSuccess")}
              value={pct(data.successRate)}
            />
            <Ratio
              label={t("adminNewsletter.popupEvents.ratioError")}
              value={pct(data.errorRate)}
            />
          </div>

          {data.days.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">
                      {t("adminNewsletter.popupEvents.colDay")}
                    </th>
                    {ORDER.map((key) => (
                      <th key={key} className="py-2 px-3 font-medium text-right">
                        {t(EVENT_META[key].labelKey)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.days.map((row) => (
                    <tr key={row.day} className="border-t border-border">
                      <td className="py-2 pr-3 text-foreground">{row.day}</td>
                      {ORDER.map((key) => (
                        <td key={key} className="py-2 px-3 text-right tabular-nums text-foreground">
                          {row.counts[key]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data.days.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {t("adminNewsletter.popupEvents.empty")}
            </p>
          )}
        </>
      )}
    </section>
  );
}

function Ratio({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[6px] border border-border bg-background p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold text-foreground tabular-nums">{value}</div>
    </div>
  );
}
