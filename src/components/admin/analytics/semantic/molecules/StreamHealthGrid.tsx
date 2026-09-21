/**
 * Molekuła: dostępność sześciu strumieni w wybranym oknie.
 *
 * Odpowiada na pytanie, którego dashboardy dotąd nie zadawały: czego w liczbach
 * NIE MA. Odróżniamy trzy przypadki - brak konfiguracji, nieudany odczyt i pusty
 * zbiór - bo każdy prowadzi do innej decyzji, a wszystkie trzy wyglądały wcześniej
 * identycznie: jako zero.
 *
 * CZWARTY stan powstaje z rejestru, nie z DTO: pusty zbiór w strumieniu za
 * bramką „analityka” (`first_party`, `web_vitals`, `ga4`) jest nieodróżnialny od
 * braku zgody odwiedzającego, bo te strumienie zbierają zdarzenia przy KAŻDEJ
 * odsłonie - więc zero jest tam strukturalnie podejrzane, a decyzja operatora
 * jest ODWROTNA niż przy braku ruchu („popraw baner zgody” kontra „popraw
 * dystrybucję treści”). Strumienie za bramką marketingową i za opt-inem mailowym
 * zostają przy „brak danych w oknie”: ich zero znaczy najczęściej, że w oknie po
 * prostu nie było kampanii.
 *
 * Siatka: 1 kolumna na telefonie, 2 na tablecie, 3 na desktopie - spójnie z
 * pozostałymi kartami panelu analityki.
 */
import { useTranslation } from "react-i18next";
import "@/lib/i18n-admin-semantic";
import { CheckCircle2, CircleSlash, ShieldAlert, TriangleAlert, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { STREAMS, type ConsentGate } from "@/lib/analytics/semantic";
import type { SemanticStreamHealth } from "@/lib/analytics/semantic/snapshot.functions";
import { ChipButton } from "../atoms/ChipButton";

/** Statusy kafelka - klucze gałęzi `adminAnalytics.semantic.streams.*`. */
type StatusKey = "available" | "not_configured" | "read_failed" | "no_data" | "gated";

/**
 * Status kafelka: kod przyczyny z DTO CZYTANY W KONTEKŚCIE bramki zgody strumienia.
 *
 * Brak kodu przyczyny to stan „nie wiemy, dlaczego pusto” (ładunek częściowy albo
 * starszy) - spada wtedy na najsłabsze możliwe zdanie, czyli „brak danych w oknie”.
 * Kodu `no_data` nie wolno w takiej sytuacji podnieść do zdania o zgodzie, bo
 * byłoby to orzekanie z niczego.
 */
function statusKeyOf(health: SemanticStreamHealth, consentGate: ConsentGate): StatusKey {
  if (health.available) return "available";
  if (health.reason === undefined) return "no_data";
  if (health.reason === "no_data" && consentGate === "analytics") return "gated";
  return health.reason;
}

function StatusIcon({ status }: { status: StatusKey }) {
  if (status === "available") return <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />;
  if (status === "read_failed")
    return <TriangleAlert className="h-4 w-4 shrink-0 text-amber-500" />;
  if (status === "not_configured")
    return <XCircle className="h-4 w-4 shrink-0 text-muted-foreground" />;
  // Bramka zgody to stan WYMAGAJĄCY reakcji (baner), nie spokojna pustka.
  if (status === "gated") return <ShieldAlert className="h-4 w-4 shrink-0 text-amber-500" />;
  return <CircleSlash className="h-4 w-4 shrink-0 text-muted-foreground" />;
}

export function StreamHealthGrid({ streams }: { streams: readonly SemanticStreamHealth[] }) {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language?.toLowerCase().startsWith("en");
  const byId = new Map(streams.map((s) => [s.streamId, s]));

  return (
    <Card className="p-4 space-y-3">
      <div>
        <h3 className="text-sm font-semibold leading-none">
          {t("adminAnalytics.semantic.streams.title")}
        </h3>
        <p className="mt-1.5 text-xs text-muted-foreground">
          {t("adminAnalytics.semantic.streams.subtitle")}
        </p>
      </div>

      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {STREAMS.map((stream) => {
          const health = byId.get(stream.id) ?? {
            streamId: stream.id,
            available: false,
            reason: "read_failed" as const,
          };
          const statusKey = statusKeyOf(health, stream.consentGate);
          return (
            <li
              key={stream.id}
              className="rounded-md border border-border bg-muted/20 p-2.5 min-w-0"
            >
              <div className="flex items-start gap-2">
                <StatusIcon status={statusKey} />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium leading-4 break-words">
                    {isEn ? stream.labelEn : stream.labelPl}
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    {t(`adminAnalytics.semantic.streams.${statusKey}`)}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    <Badge variant="outline" className="text-[10px]">
                      {t(`adminAnalytics.semantic.consentGate.${stream.consentGate}`)}
                    </Badge>
                    <Tooltip>
                      {/* Zastrzeżenia strumienia („widok liczony po 1,5 s
                          obecności”, „odsłony autora są pomijane”) nie istnieją
                          nigdzie indziej w drzewie, więc wyzwalacz musi być
                          przyciskiem - `Badge` renderuje `div` bez fokusa. */}
                      <TooltipTrigger asChild>
                        <ChipButton className="text-[10px] font-medium border-border text-muted-foreground cursor-help">
                          {t(`adminAnalytics.semantic.identityGrain.${stream.identityGrain}`)}
                        </ChipButton>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs space-y-1 text-xs leading-relaxed">
                        <div className="font-semibold">
                          {t("adminAnalytics.semantic.streams.caveats")}
                        </div>
                        <ul className="space-y-1">
                          {stream.caveats.map((c, idx) => (
                            <li key={idx}>{c}</li>
                          ))}
                        </ul>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
