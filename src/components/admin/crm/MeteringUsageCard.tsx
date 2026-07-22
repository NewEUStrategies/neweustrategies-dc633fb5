// Karta pokazująca zużycie miesięcznego limitu bezpłatnych artykułów
// (Essential = 5/mies., odnawiane 1. dnia miesiąca kalendarzowego).
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Gauge } from "lucide-react";
import { getCrmLeadMonthlyMetering } from "@/lib/crm.functions";


type Props = { leadId: string; lang: "pl" | "en" };

type Usage = {
  used: number;
  monthly_limit: number;
  remaining: number;
  period_month: string;
  enabled: boolean;
  user_id: string;
} | null;

export function MeteringUsageCard({ leadId, lang }: Props) {
  const fn = useServerFn(getCrmLeadMonthlyMetering);
  const q = useQuery({
    queryKey: ["crm-lead-metering", leadId],
    queryFn: async () => {
      const r = (await fn({ data: { id: leadId } })) as { json: string };
      return JSON.parse(r.json) as Usage;
    },
    staleTime: 60_000,
  });

  const t = (pl: string, en: string) => (lang === "pl" ? pl : en);

  return (
    <section className="rounded-md border bg-card p-3">
      <div className="mb-2 flex items-center gap-2 text-[12px] font-medium">
        <Gauge className="h-3.5 w-3.5" />
        {t("Bezpłatne artykuły w tym miesiącu", "Free articles this month")}
      </div>
      {q.isLoading ? (
        <div className="text-[11px] text-muted-foreground">{t("Ładowanie…", "Loading…")}</div>
      ) : !q.data ? (
        <div className="text-[11px] text-muted-foreground">
          {t(
            "Brak powiązanego użytkownika (Essential wymaga rejestracji).",
            "No linked user (Essential requires sign-up).",
          )}
        </div>
      ) : (
        <UsageBar used={q.data.used} limit={q.data.monthly_limit} lang={lang} />
      )}
    </section>
  );
}

function UsageBar({ used, limit, lang }: { used: number; limit: number; lang: "pl" | "en" }) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const remaining = Math.max(limit - used, 0);
  const t = (pl: string, en: string) => (lang === "pl" ? pl : en);
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <div className="text-[18px] font-semibold tabular-nums">
          {used}
          <span className="text-[11px] font-normal text-muted-foreground"> / {limit}</span>
        </div>
        <div className="text-[10px] text-muted-foreground">
          {t("Pozostało", "Remaining")}: <span className="tabular-nums">{remaining}</span>
        </div>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-[6px] bg-muted">
        <div
          className="h-full rounded-[6px] bg-primary transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="text-[10px] text-muted-foreground">
        {t(
          "Licznik resetuje się 1. dnia miesiąca kalendarzowego.",
          "Counter resets on the 1st of the calendar month.",
        )}
      </div>
    </div>
  );
}
