// Pasek informacyjny w koszyku (EN): pokazuje datę i godzinę ostatniego
// pobrania kursu NBP oraz jednoznacznie sygnalizuje, czy widoczne kwoty w EUR
// wynikają ze ŚWIEŻEGO kursu (< 6 h, tabela A NBP) czy z fallbacku (ostatnia
// znana kotwica). Nie renderujemy niczego w wariancie PLN - tam kurs nie ma
// wpływu na wyświetlone kwoty i pasek tylko zaszumiłby UI.
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatDate } from "@/lib/i18n/format";

interface FxStatusResponse {
  status: "ok" | "stale" | "fallback" | "rate_limited";
  eurPln: number;
  effectiveDate: string | null;
  source: "nbp" | "fallback" | "override";
  fetchedAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastAttempts: number;
  stale: boolean;
}

async function fetchFxStatus(): Promise<FxStatusResponse | null> {
  try {
    const res = await fetch("/api/public/fx-rate", { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    return (await res.json()) as FxStatusResponse;
  } catch {
    return null;
  }
}

function formatTime(iso: string, lang: string): string {
  const d = new Date(iso);
  return `${formatDate(d, lang)}, ${d.toLocaleTimeString(
    lang.startsWith("en") ? "en-GB" : "pl-PL",
    {
      hour: "2-digit",
      minute: "2-digit",
    },
  )}`;
}

export function FxRateNotice({ displayCurrency }: { displayCurrency: "PLN" | "EUR" }) {
  const { t, i18n } = useTranslation();
  const { data } = useQuery({
    queryKey: ["fx-rate-status"],
    queryFn: fetchFxStatus,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  if (displayCurrency !== "EUR" || !data) return null;

  const fetchedIso = data.lastSuccessAt ?? data.fetchedAt;
  const isFresh = data.status === "ok";
  const isFallback = data.source !== "nbp";
  const Icon = isFresh ? CheckCircle2 : isFallback ? AlertTriangle : Info;
  const toneCls = isFresh
    ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-800 dark:text-emerald-300"
    : isFallback
      ? "border-amber-500/30 bg-amber-500/5 text-amber-800 dark:text-amber-300"
      : "border-muted bg-muted/30 text-muted-foreground";

  return (
    <div
      className={`flex items-start gap-2 rounded-[6px] border px-3 py-2 text-[11px] leading-snug ${toneCls}`}
      role="status"
    >
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <div className="space-y-0.5">
        <div className="font-medium">
          {isFresh
            ? t("checkout.fx.freshTitle")
            : isFallback
              ? t("checkout.fx.fallbackTitle")
              : t("checkout.fx.staleTitle")}
        </div>
        <div className="opacity-90">
          {t("checkout.fx.rate", { rate: data.eurPln.toFixed(4) })}
          {data.effectiveDate ? ` · ${t("checkout.fx.tableA", { date: data.effectiveDate })}` : ""}
        </div>
        {fetchedIso && (
          <div className="opacity-80">
            {t("checkout.fx.fetchedAt", { when: formatTime(fetchedIso, i18n.language) })}
          </div>
        )}
        {isFallback && data.lastError && (
          <div className="opacity-80">{t("checkout.fx.reason", { reason: data.lastError })}</div>
        )}
      </div>
    </div>
  );
}
