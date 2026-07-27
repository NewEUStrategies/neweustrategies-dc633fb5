// Panel admin/analytics -> Stopka. Pokazuje sumaryczne wskazniki oraz top
// linki z podzialem na grupy (editorial/topics/community/institute/legal)
// oraz oddzielna kolumne dla konwersji formularza newslettera. Dane po stronie
// serwera przez requireAdmin (getFooterAnalytics), a UI konsumuje ten sam
// stack (Card/Table/Badge) co pozostale karty admin analytics.
import { useState, useMemo } from "react";
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

const GROUP_LABEL: Record<string, string> = {
  editorial: "Redakcja",
  topics: "Tematy",
  community: "Społeczność",
  institute: "Instytut",
  legal: "Prawne",
  unknown: "Inne",
};

const EVENT_LABEL: Record<string, string> = {
  footer_link_click: "Link stopki",
  footer_legal_click: "Link prawny",
  footer_newsletter_click: "Newsletter (link)",
  footer_newsletter_signup: "Newsletter (zapis)",
};

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
  const fetchData = useServerFn(getFooterAnalytics);
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [groupFilter, setGroupFilter] = useState<string>("all");

  const q = useQuery({
    queryKey: ["footer-analytics", days],
    queryFn: () => fetchData({ data: { days } }),
    staleTime: 60_000,
  });

  const rows = useMemo(() => {
    const all = q.data?.rows ?? [];
    return groupFilter === "all" ? all : all.filter((r) => r.group === groupFilter);
  }, [q.data, groupFilter]);

  const totals = q.data?.totals;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <MousePointerClick className="w-4 h-4" /> Kliknięcia w stopce
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Zdarzenia zbierane przez <code>/api/public/track</code> (GA4 równolegle, jeśli zgoda
            marketingowa aktywna). Okno: ostatnie {days} dni.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={String(days)} onValueChange={(v) => setDays(Number(v) as 7 | 30 | 90)}>
            <SelectTrigger className="h-8 w-[110px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">7 dni</SelectItem>
              <SelectItem value="30">30 dni</SelectItem>
              <SelectItem value="90">90 dni</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="h-8" onClick={() => q.refetch()}>
            Odśwież
          </Button>
        </div>
      </div>

      {q.isLoading ? (
        <div className="p-6 text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Ładowanie danych stopki…
        </div>
      ) : q.isError ? (
        <Card className="p-4 text-sm text-destructive">
          Nie udało się pobrać danych: {(q.error as Error).message}
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Stat
              icon={<MousePointerClick className="w-3 h-3" />}
              label="Wszystkie zdarzenia"
              value={totals?.total ?? 0}
            />
            <Stat
              icon={<LinkIcon className="w-3 h-3" />}
              label="Linki treści"
              value={totals?.link_clicks ?? 0}
            />
            <Stat
              icon={<ShieldCheck className="w-3 h-3" />}
              label="Linki prawne"
              value={totals?.legal_clicks ?? 0}
            />
            <Stat
              icon={<Mail className="w-3 h-3" />}
              label="Kliknięcia newsletter"
              value={totals?.newsletter_clicks ?? 0}
            />
            <Stat
              icon={<Mail className="w-3 h-3" />}
              label="Zapisy z newslettera"
              value={totals?.newsletter_signups ?? 0}
              hint={
                totals && totals.newsletter_clicks
                  ? `${((totals.newsletter_signups / totals.newsletter_clicks) * 100).toFixed(1)}% konwersji`
                  : undefined
              }
            />
          </div>

          <Card className="p-3">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div className="text-sm font-semibold">Top linki</div>
              <Select value={groupFilter} onValueChange={setGroupFilter}>
                <SelectTrigger className="h-8 w-[160px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Wszystkie grupy</SelectItem>
                  {Object.entries(GROUP_LABEL).map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {rows.length === 0 ? (
              <div className="text-xs text-muted-foreground py-6 text-center">
                Brak zdarzeń w wybranym oknie.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-muted-foreground border-b border-border">
                      <th className="text-left py-1.5 font-medium">Etykieta / URL</th>
                      <th className="text-left py-1.5 font-medium">Grupa</th>
                      <th className="text-left py-1.5 font-medium">Zdarzenie</th>
                      <th className="text-right py-1.5 font-medium">Kliknięcia</th>
                      <th className="text-right py-1.5 font-medium">Ostatnie</th>
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
                            {GROUP_LABEL[r.group] ?? r.group}
                          </Badge>
                        </td>
                        <td className="py-1.5">
                          <Badge variant="outline" className="text-[10px]">
                            {EVENT_LABEL[r.event_name] ?? r.event_name}
                          </Badge>
                        </td>
                        <td className="py-1.5 text-right tabular-nums">{r.clicks}</td>
                        <td className="py-1.5 text-right text-muted-foreground">
                          {r.last_at ? new Date(r.last_at).toLocaleString("pl-PL") : "-"}
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
