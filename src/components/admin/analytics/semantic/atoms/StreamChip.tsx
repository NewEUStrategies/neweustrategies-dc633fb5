/**
 * Atom: strumień analityczny jako chip z bramką zgody i rolą (autorytatywny vs
 * potwierdzający).
 *
 * Rola jest tu najważniejszą informacją: raport zarządczy cytuje wyłącznie
 * strumień autorytatywny, a chip mówi wprost, który to jest - zamiast pozostawiać
 * to domysłowi czytelnika dashboardu.
 */
import { useTranslation } from "react-i18next";
import "@/lib/i18n-admin-semantic";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { type StreamId, streamById } from "@/lib/analytics/semantic";

export function StreamChip({
  streamId,
  role,
}: {
  streamId: StreamId;
  role?: "authoritative" | "corroborating";
}) {
  const { t, i18n } = useTranslation();
  const stream = streamById(streamId);
  const isEn = i18n.language?.toLowerCase().startsWith("en");
  const label = isEn ? stream.labelEn : stream.labelPl;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className={
            "text-[10px] font-medium max-w-full " +
            (role === "authoritative"
              ? "border-primary/50 bg-primary/10 text-primary"
              : "border-border text-muted-foreground")
          }
        >
          <span className="truncate">{label}</span>
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs leading-relaxed space-y-1">
        <div className="font-semibold">{label}</div>
        <div>
          {t("adminAnalytics.semantic.streams.consentGate")}:{" "}
          {t(`adminAnalytics.semantic.consentGate.${stream.consentGate}`)}
        </div>
        <div>
          {t("adminAnalytics.semantic.streams.identityGrain")}:{" "}
          {t(`adminAnalytics.semantic.identityGrain.${stream.identityGrain}`)}
        </div>
        <div>
          {t("adminAnalytics.semantic.streams.dedupe")}:{" "}
          {t(`adminAnalytics.semantic.dedupe.${stream.dedupe}`, {
            minutes: stream.dedupeWindowMinutes ?? 0,
          })}
        </div>
        <div>
          {t("adminAnalytics.semantic.streams.latency")}:{" "}
          {stream.latencyHours === 0
            ? t("adminAnalytics.semantic.streams.latencyRealtime")
            : t("adminAnalytics.semantic.streams.latencyHours", { count: stream.latencyHours })}
        </div>
        {role ? (
          <div className="pt-1 border-t border-border/60">
            {role === "authoritative"
              ? t("adminAnalytics.semantic.authoritative")
              : t("adminAnalytics.semantic.corroborating")}
          </div>
        ) : null}
      </TooltipContent>
    </Tooltip>
  );
}
