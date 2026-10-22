// Statystyki na kanwie (S8, SPEC §6.3 „Statystyki na kanwie”) - chipy liczb
// przy kartach kroków: wejścia albo wysłane, otwarcia ludzkie, kliknięcia,
// CTOR z oceną `BenchmarkTierBadge`, czekający i werdykt testu A/B.
//
// WARSTWA, NIE CZĘŚĆ KARTY. Kanwa (S8.3) rysuje karty kroków; nakładka leży
// nad nimi w tych samych współrzędnych (`layoutJourney` z S8.1, przed
// `scale(z)`), więc zoom i przewijanie działają bez liczenia czegokolwiek tu.
// Chipy stoją w pasku przy dolnej krawędzi karty (`JOURNEY_STATS_STRIP`) -
// karta S8.3 zostawia ten pas wolny, gdy statystyki są włączone. Pas leży
// wewnątrz karty, bo krawędzie, etykiety gałęzi i przyciski „+” zajmują
// środek odstępów między rzędami.
//
// `aria-hidden`: liczby kroku czytnik słyszy RAZ - w nazwie karty
// („Krok 3 z 7: Wyślij e-mail «…», 380 wysłanych”), którą S8.3 składa
// z `journeyNodeStatsSummary`. Dymki (`title`) są dla myszy; ten sam tekst
// MPP mówi widoczna legenda (`JourneyStatsLegend`) i zakładka „Wyniki”.
// Z `onSelectNode` pasek chipów przyjmuje mysz (dymki, klik = wybór kroku jak
// klik w kartę, którą pasek przykrywa); bez niego cała nakładka jest
// przezroczysta dla kliknięć. Klawiatura i tak działa na karcie.
//
// `?stats=off` (`hidden`) - nakładka nie rysuje nic: ani chipów, ani miejsca.
// Liczb benchmarków tu nie ma - ocena CTOR z rejestru S6.
import { useMemo } from "react";
import { FlaskConical, Mail, MailOpen, MousePointerClick, Timer, UserPlus } from "lucide-react";
import { useTranslation } from "react-i18next";

import { BenchmarkTierBadge } from "@/components/admin/analytics/semantic/atoms/BenchmarkTierBadge";
import type { JourneyLayout } from "@/lib/admin/journeys/layout";
import {
  journeyAbSummary,
  journeyAbVerdict,
  journeyEmailRates,
} from "@/lib/admin/journeys/results";
import { translateSummary } from "@/lib/admin/journeys/summaries";
import { chartLangFrom, formatPercent, type ChartLang } from "@/lib/charts/format";
import { formatNumber } from "@/lib/i18n/format";
import { ensureI18n } from "@/lib/i18n-admin-journeys-results";
import type { JourneyNodeStats, JourneyStatsDto } from "@/lib/journeys/dto";
import { cn } from "@/lib/utils";
import { useJourneyBenchmarks, type JourneyRateEvaluator } from "../results/JourneyEmailsTable";

/**
 * Pas chipów przy dolnej krawędzi karty kroku (px, współrzędne kanwy).
 * Karta S8.3 rezerwuje `height + inset` od dołu, gdy statystyki są włączone.
 */
export const JOURNEY_STATS_STRIP = { height: 20, inset: 6 } as const;

export interface JourneyStatsOverlayProps {
  /** Statystyki okna (`journeyStatsQueryOptions`); brak = nic do pokazania. */
  stats: JourneyStatsDto | null | undefined;
  /** Układ kanwy (`layoutJourney`) - pozycje i rozmiary kart. */
  layout: Pick<JourneyLayout, "nodes" | "width" | "height">;
  /** `?stats=off` - nakładka znika w całości. */
  hidden?: boolean;
  /** Szablon ścieżki - wybiera wpisy rejestru S6 (porzucona kasa ma własne). */
  templateKey?: string | null;
  /** Język liczb i oceny; domyślnie język interfejsu. */
  lang?: ChartLang;
  /** Klik w pasek chipów = wybór kroku (pasek przykrywa fragment karty). */
  onSelectNode?: (nodeId: string) => void;
}

export function JourneyStatsOverlay({
  stats,
  layout,
  hidden = false,
  templateKey = null,
  lang: langProp,
  onSelectNode,
}: JourneyStatsOverlayProps) {
  ensureI18n();
  const { i18n } = useTranslation();
  const lang = langProp ?? chartLangFrom(i18n.language);
  const byId = useMemo(
    () => new Map((stats?.nodes ?? []).map((node) => [node.nodeId, node])),
    [stats],
  );
  const hasEmail = (stats?.nodes ?? []).some((node) => node.email !== null);
  const evaluate = useJourneyBenchmarks(templateKey, lang, !hidden && hasEmail);

  if (hidden || !stats) return null;

  return (
    <div
      aria-hidden="true"
      data-testid="journey-stats-overlay"
      className="pointer-events-none absolute left-0 top-0"
      style={{ width: layout.width, height: layout.height }}
    >
      {layout.nodes.map((node) => {
        const own = byId.get(node.id);
        if (!own) return null;
        return (
          <div
            key={node.id}
            data-node-id={node.id}
            className={cn(
              "absolute flex items-center justify-end gap-1 overflow-hidden",
              onSelectNode ? "pointer-events-auto cursor-pointer" : undefined,
            )}
            style={{
              left: node.x + JOURNEY_STATS_STRIP.inset,
              top: node.y + node.height - JOURNEY_STATS_STRIP.height - JOURNEY_STATS_STRIP.inset,
              width: node.width - JOURNEY_STATS_STRIP.inset * 2,
              height: JOURNEY_STATS_STRIP.height,
            }}
            onClick={onSelectNode ? () => onSelectNode(node.id) : undefined}
          >
            <NodeChips
              node={own}
              variants={stats.variants.filter((variant) => variant.nodeId === node.id)}
              evaluate={evaluate}
              lang={lang}
            />
          </div>
        );
      })}
    </div>
  );
}

const CHIP =
  "inline-flex h-5 shrink-0 items-center gap-1 rounded-[6px] border border-border bg-background px-1.5 text-[10px] font-medium leading-none tabular-nums text-foreground";

function NodeChips({
  node,
  variants,
  evaluate,
  lang,
}: {
  node: JourneyNodeStats;
  variants: JourneyStatsDto["variants"];
  evaluate: JourneyRateEvaluator;
  lang: ChartLang;
}) {
  const { t } = useTranslation();
  const number = (value: number) => formatNumber(value, lang);
  const percent = (value: number | null) => (value === null ? "—" : formatPercent(value, lang));

  if (node.email) {
    const rates = journeyEmailRates(node.email);
    const ctorEvaluation = evaluate("ctor", rates.ctor, node.email.uniqueHumanOpens);
    return (
      <>
        <span
          className={CHIP}
          data-chip="sent"
          title={t("adminJourneys.statsOverlay.chip.sent", { value: number(node.email.sent) })}
        >
          <Mail className="h-3 w-3" />
          {number(node.email.sent)}
        </span>
        <span
          className={CHIP}
          data-chip="opens"
          title={t("adminJourneys.statsOverlay.chip.opens", { value: percent(rates.openRate) })}
        >
          <MailOpen className="h-3 w-3" />
          {percent(rates.openRate)}
        </span>
        <span
          className={CHIP}
          data-chip="clicks"
          title={t("adminJourneys.statsOverlay.chip.clicks", { value: percent(rates.clickRate) })}
        >
          <MousePointerClick className="h-3 w-3" />
          {percent(rates.clickRate)}
        </span>
        <span
          className={CHIP}
          data-chip="ctor"
          title={t("adminJourneys.statsOverlay.chip.ctor", { value: percent(rates.ctor) })}
        >
          CTOR {percent(rates.ctor)}
        </span>
        {ctorEvaluation ? (
          <BenchmarkTierBadge evaluation={ctorEvaluation} lang={lang} className="shrink-0" />
        ) : null}
      </>
    );
  }

  const abText =
    node.type === "ab_split"
      ? translateSummary(
          t,
          journeyAbSummary(journeyAbVerdict(variants), (points) =>
            formatNumber(points, lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
          ),
        )
      : null;

  return (
    <>
      <span
        className={CHIP}
        data-chip="entered"
        title={t("adminJourneys.statsOverlay.chip.entered", { value: number(node.entered) })}
      >
        <UserPlus className="h-3 w-3" />
        {number(node.entered)}
      </span>
      {node.waitingNow > 0 ? (
        <span
          className={CHIP}
          data-chip="waiting"
          title={t("adminJourneys.statsOverlay.chip.waiting", { value: number(node.waitingNow) })}
        >
          <Timer className="h-3 w-3" />
          {number(node.waitingNow)}
        </span>
      ) : null}
      {abText ? (
        <span className={cn(CHIP, "min-w-0 shrink")} data-chip="ab" title={abText}>
          <FlaskConical className="h-3 w-3 shrink-0" />
          <span className="truncate">{abText}</span>
        </span>
      ) : null}
    </>
  );
}

/**
 * Widoczna legenda nakładki (MPP) - S8.3 stawia ją przy wyborze okna
 * statystyk, bo chipy są `aria-hidden` i mają tylko dymki myszy.
 */
export function JourneyStatsLegend({ className }: { className?: string }) {
  ensureI18n();
  const { t } = useTranslation();
  return (
    <p className={cn("m-0 text-[11px] text-muted-foreground", className)}>
      {t("adminJourneys.statsOverlay.legend")}
    </p>
  );
}
