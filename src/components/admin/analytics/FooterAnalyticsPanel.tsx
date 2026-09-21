// Panel admin/analytics -> Stopka. Pokazuje sumaryczne wskazniki oraz top
// linki z podzialem na grupy (editorial/topics/community/institute/legal)
// oraz oddzielna kolumne dla konwersji formularza newslettera. Dane po stronie
// serwera przez requireAdmin (getFooterAnalytics), a UI konsumuje ten sam
// stack (Card/Table/Badge) co pozostale karty admin analytics.
//
// PIĘĆ INWARIANTÓW, KTÓRE TEN PANEL TRZYMA (każdy ma swój przypadek w
// `__tests__/footerAnalyticsPanel.test.tsx`):
//
//   1. KLUCZ CACHE NIESIE WARSZTAT. `["footer-analytics", tenantId, days]` plus
//      `enabled: Boolean(tenantId)` - bez identyfikatora najemcy dwa panele z
//      tym samym oknem trafiałyby w ten sam wpis cache, a `staleTime` nie
//      pozwalałby ponowić zapytania: administrator warsztatu B czytałby
//      etykiety i adresy warsztatu A BEZ ani jednego żądania sieciowego.
//   2. ZERO TYLKO ZE ZMIERZONEGO ODCZYTU. `isLoading` to `isPending &&
//      isFetching`, więc zapytanie wstrzymane brakiem sieci (`fetchStatus:
//      "paused"`) ma `isLoading === false` przy pustych danych. Stan "nie ma
//      pomiaru" jest tu osobną gałęzią (`noMeasurement`), bo `?? 0` na kafelku
//      byłoby twierdzeniem, że stopka nie zebrała ani jednego kliknięcia.
//   3. ODSETEK NIE PRZEKRACZA STU PROCENT. Licznik i mianownik konwersji
//      pochodzą z dwóch różnych lejków, więc zapisów bywa więcej niż kliknięć;
//      wskaźnik jest wtedy ograniczony do 100% i jawnie opisany jako
//      niedomknięty.
//   4. PUSTE OKNO TO NIE FILTR BEZ TRAFIEŃ. Dwa różne stany mają dwa różne
//      komunikaty, bo prowadzą do dwóch różnych decyzji operatora.
//   5. WSZYSTKIE NAPISY ZE SŁOWNIKA. Trasa `/admin/analytics` jest dwujęzyczna,
//      więc również daty idą przez locale interfejsu, a nie przez zaszyte
//      `pl-PL`.
import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Link as LinkIcon, MousePointerClick, Mail, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getFooterAnalytics } from "@/lib/analytics/footerAnalytics.functions";
import { useCurrentTenantId } from "@/lib/tenant";
import "@/lib/i18n-admin-analytics";

/** Grupy stopki znane słownikowi - kolejność jest kolejnością pozycji filtra. */
const GROUP_KEYS = ["editorial", "topics", "community", "institute", "legal", "unknown"] as const;

/** Znak zastępczy tam, gdzie liczby albo daty nie ma - nie jest napisem. */
const NO_VALUE = "-";

interface StatProps {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  hint?: string;
}
function Stat({ icon, label, value, hint }: StatProps) {
  return (
    <Card className="p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
        {icon}
        {label}
      </div>
      <div className="text-xl font-semibold tabular-nums mt-1">{value}</div>
      {hint ? <div className="text-[11px] text-muted-foreground mt-0.5">{hint}</div> : null}
    </Card>
  );
}

export function FooterAnalyticsPanel() {
  const { t, i18n } = useTranslation();
  const fetchData = useServerFn(getFooterAnalytics);
  const tenantId = useCurrentTenantId();
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [groupFilter, setGroupFilter] = useState<string>("all");

  const q = useQuery({
    queryKey: ["footer-analytics", tenantId ?? "", days],
    queryFn: () => fetchData({ data: { days } }),
    enabled: Boolean(tenantId),
    staleTime: 60_000,
  });

  const allRows = q.data?.rows ?? [];
  const rows = useMemo(() => {
    const all = q.data?.rows ?? [];
    return groupFilter === "all" ? all : all.filter((r) => r.group === groupFilter);
  }, [q.data, groupFilter]);

  const totals = q.data?.totals;
  // BRAK POMIARU: zapytanie nie wystartowało (brak najemcy) albo jest
  // wstrzymane (brak sieci). Ani ładowanie, ani awaria, ani zmierzone zero.
  const noMeasurement = !q.data && !q.isLoading && !q.isError;

  const locale = i18n.language === "en" ? "en-GB" : "pl-PL";

  /** Etykieta słownikowa dla klucza technicznego; nieznany klucz zostaje surowy. */
  const labelFor = (branch: "groups" | "events", raw: string): string => {
    const key = `adminAnalytics.footer.${branch}.${raw}`;
    return i18n.exists(key) ? t(key) : raw;
  };

  // Licznik i mianownik biegną z DWÓCH lejków: `footer_newsletter_signup` leci
  // przy każdym wyniku wysyłki formularza, a `footer_newsletter_click` tylko z
  // linku z "newsletter" w adresie. Nadwyżka zapisów nad kliknięciami jest więc
  // normalna - i musi być widoczna jako zastrzeżenie, nie jako odsetek powyżej
  // stu procent.
  const conversionHint = ((): string | undefined => {
    if (!totals || !totals.newsletter_clicks) return undefined;
    const open = totals.newsletter_signups > totals.newsletter_clicks;
    const raw = (totals.newsletter_signups / totals.newsletter_clicks) * 100;
    const pct = Math.min(100, raw).toFixed(1);
    return open
      ? t("adminAnalytics.footer.conversionOpen", { pct })
      : t("adminAnalytics.footer.conversion", { pct });
  })();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <MousePointerClick className="w-4 h-4" /> {t("adminAnalytics.footer.title")}
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            {t("adminAnalytics.footer.subtitle", { endpoint: "/api/public/track" })}{" "}
            {t("adminAnalytics.footer.windowInfo", { days })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={String(days)} onValueChange={(v) => setDays(Number(v) as 7 | 30 | 90)}>
            {/* Dwa comboboxy tego panelu stoją bez `<label>` powiązanego przez
                `htmlFor`, więc nazwa dostępna musi przyjść z `aria-label` -
                inaczej czytnik ekranu ogłasza dwa nieopisane comboboxy obok
                siebie i nie da się ich rozróżnić (WCAG 4.1.2). */}
            <SelectTrigger
              className="h-8 w-[110px] text-xs"
              aria-label={t("adminAnalytics.common.windowSelector")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">{t("adminAnalytics.timeRange.preset7d")}</SelectItem>
              <SelectItem value="30">{t("adminAnalytics.timeRange.preset30d")}</SelectItem>
              <SelectItem value="90">{t("adminAnalytics.timeRange.preset90d")}</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="h-8" onClick={() => q.refetch()}>
            {t("adminAnalytics.common.refresh")}
          </Button>
        </div>
      </div>

      {q.isLoading ? (
        <div className="p-6 text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> {t("adminAnalytics.footer.loading")}
        </div>
      ) : q.isError ? (
        <Card className="p-4 text-sm text-destructive">
          {t("adminAnalytics.footer.readFailed", { reason: (q.error as Error).message })}
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Stat
              icon={<MousePointerClick className="w-3 h-3" />}
              label={t("adminAnalytics.footer.kpiTotal")}
              value={noMeasurement ? NO_VALUE : (totals?.total ?? 0)}
              hint={noMeasurement ? t("adminAnalytics.footer.notMeasuredShort") : undefined}
            />
            <Stat
              icon={<LinkIcon className="w-3 h-3" />}
              label={t("adminAnalytics.footer.kpiLinkClicks")}
              value={noMeasurement ? NO_VALUE : (totals?.link_clicks ?? 0)}
              hint={noMeasurement ? t("adminAnalytics.footer.notMeasuredShort") : undefined}
            />
            <Stat
              icon={<ShieldCheck className="w-3 h-3" />}
              label={t("adminAnalytics.footer.kpiLegalClicks")}
              value={noMeasurement ? NO_VALUE : (totals?.legal_clicks ?? 0)}
              hint={noMeasurement ? t("adminAnalytics.footer.notMeasuredShort") : undefined}
            />
            <Stat
              icon={<Mail className="w-3 h-3" />}
              label={t("adminAnalytics.footer.kpiNewsletterClicks")}
              value={noMeasurement ? NO_VALUE : (totals?.newsletter_clicks ?? 0)}
              hint={noMeasurement ? t("adminAnalytics.footer.notMeasuredShort") : undefined}
            />
            <Stat
              icon={<Mail className="w-3 h-3" />}
              label={t("adminAnalytics.footer.kpiNewsletterSignups")}
              value={noMeasurement ? NO_VALUE : (totals?.newsletter_signups ?? 0)}
              hint={noMeasurement ? t("adminAnalytics.footer.notMeasuredShort") : conversionHint}
            />
          </div>

          <Card className="p-3">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div className="text-sm font-semibold">{t("adminAnalytics.footer.topLinks")}</div>
              <Select value={groupFilter} onValueChange={setGroupFilter}>
                <SelectTrigger
                  className="h-8 w-[160px] text-xs"
                  aria-label={t("adminAnalytics.common.groupFilter")}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("adminAnalytics.footer.allGroups")}</SelectItem>
                  {GROUP_KEYS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {t(`adminAnalytics.footer.groups.${k}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {noMeasurement ? (
              <div className="text-xs text-muted-foreground py-6 text-center">
                <div>{t("adminAnalytics.footer.notMeasured")}</div>
                <div className="mt-1">{t("adminAnalytics.footer.notMeasuredHint")}</div>
              </div>
            ) : allRows.length === 0 ? (
              <div className="text-xs text-muted-foreground py-6 text-center">
                {t("adminAnalytics.footer.emptyWindow")}
              </div>
            ) : rows.length === 0 ? (
              // FILTR BEZ TRAFIEŃ, nie puste okno. Komunikat o oknie kazałby
              // operatorowi szukać awarii pomiaru; tu wystarczy zdjąć filtr.
              <div className="text-xs text-muted-foreground py-6 text-center">
                <div>{t("adminAnalytics.common.noDataFilter")}</div>
                <div className="mt-1">{t("adminAnalytics.common.noDataFilterHint")}</div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-muted-foreground border-b border-border">
                      <th className="text-left py-1.5 font-medium">
                        {t("adminAnalytics.footer.colLabel")}
                      </th>
                      <th className="text-left py-1.5 font-medium">
                        {t("adminAnalytics.footer.colGroup")}
                      </th>
                      <th className="text-left py-1.5 font-medium">
                        {t("adminAnalytics.footer.colEvent")}
                      </th>
                      <th className="text-right py-1.5 font-medium">
                        {t("adminAnalytics.footer.colClicks")}
                      </th>
                      <th className="text-right py-1.5 font-medium">
                        {t("adminAnalytics.footer.colLastSeen")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr
                        key={`${r.event_name}::${r.href}`}
                        className="border-b border-border/60 last:border-0"
                      >
                        <td className="py-1.5">
                          <div className="font-medium truncate max-w-[320px]">{r.label}</div>
                          <div className="text-[10px] text-muted-foreground font-mono truncate max-w-[320px]">
                            {r.href}
                          </div>
                        </td>
                        <td className="py-1.5">
                          <Badge variant="outline" className="text-[10px]">
                            {labelFor("groups", r.group)}
                          </Badge>
                        </td>
                        <td className="py-1.5">
                          <Badge variant="outline" className="text-[10px]">
                            {labelFor("events", r.event_name)}
                          </Badge>
                        </td>
                        <td className="py-1.5 text-right tabular-nums">{r.clicks}</td>
                        <td className="py-1.5 text-right text-muted-foreground">
                          {r.last_at ? new Date(r.last_at).toLocaleString(locale) : NO_VALUE}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
