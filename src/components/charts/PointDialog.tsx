// OKNO PUNKTU - kliknięcie punktu albo słupka otwiera definicję wskaźnika
// razem z klikniętą wartością i jej oceną.
//
// KOLEJNOŚĆ PÓL JEST STAŁA: wartość, status, zmiana, jednostka, kierunek,
// przedział, wzór, co mierzy, interpretacja. Czytelnik, który raz zobaczył
// takie okno, wie, gdzie w następnym szukać oceny - tak samo jak w tooltipie
// objaśniającym wskaźnik.
import { useTranslation } from "react-i18next";
import type { ChartConfig } from "@/lib/charts/types";
import { formatChartValue, formatSignedPercent, type ChartLang } from "@/lib/charts/format";
import {
  DIRECTION_KEYS,
  changeTone,
  changeToneColor,
  effectiveBand,
  meaningKey,
  percentChange,
  rangeStatus,
} from "@/lib/charts/status";
import type { ChartPointDetail } from "@/lib/charts/selection";
import { ChartDialog } from "./ChartDialog";
import { statusFact } from "./chartFacts";
import "@/lib/i18n-charts";

interface PointDialogProps {
  config: ChartConfig;
  lang: ChartLang;
  point: ChartPointDetail | null;
  onClose: () => void;
}

export function PointDialog({ config, lang, point, onClose }: PointDialogProps) {
  const { t: scoped } = useTranslation("translation", { keyPrefix: "charts" });
  const t = (key: string, values?: Record<string, string | number>): string =>
    scoped(key, { lng: lang, ...values });
  const band = effectiveBand(
    config.band,
    config.sources.map((s) => s.id),
  );
  const unit = config.unit.trim();
  const metric = config.metric;

  const rows: [string, string, string | undefined][] = [];
  if (point !== null) {
    rows.push([
      t("point.value"),
      point.value === null ? t("frame.missing") : formatChartValue(point.value, lang, config.unit),
      undefined,
    ]);
    if (config.direction !== null || band !== null) {
      const status = statusFact(t, point.value, band, config.direction);
      rows.push([status.label, status.value, status.color]);
    }
    const change = percentChange(point.previous, point.value);
    if (change !== null) {
      rows.push([
        t("tip.change"),
        formatSignedPercent(change, lang),
        changeToneColor(changeTone(change, config.direction)),
      ]);
    }
    if (unit) rows.push([t("point.unit"), unit, undefined]);
    if (config.direction !== null) {
      rows.push([t("direction.label"), t(DIRECTION_KEYS[config.direction]), undefined]);
    }
    if (band !== null) {
      rows.push([
        t("point.band"),
        `${formatChartValue(band.min, lang, config.unit)} - ${formatChartValue(band.max, lang, config.unit)}`,
        undefined,
      ]);
    }
    if (metric?.formula) rows.push([t("point.formula"), metric.formula, undefined]);
    if (metric?.measures) rows.push([t("point.measures"), metric.measures, undefined]);
  }

  const interpretation =
    point === null
      ? ""
      : [
          config.direction !== null || band !== null
            ? t(meaningKey(rangeStatus(point.value, band, config.direction), config.direction))
            : "",
          metric?.reading ?? "",
        ]
          .filter(Boolean)
          .join(" ");

  const heading =
    point === null
      ? ""
      : [metric?.name || point.seriesName, point.category].filter(Boolean).join(" · ");

  return (
    <ChartDialog
      open={point !== null}
      onClose={onClose}
      title={heading}
      closeLabel={t("panel.close")}
    >
      {metric?.expansion && <p className="text-[var(--chart-ink3)]">{metric.expansion}</p>}
      <dl className="neh-dialog-grid">
        {rows.map(([label, value, color]) => (
          <div key={label} className="contents">
            <dt>{label}</dt>
            <dd style={color ? { color } : undefined}>{value}</dd>
          </div>
        ))}
      </dl>
      {interpretation && (
        <>
          <h3>{t("point.interpretation")}</h3>
          <p>{interpretation}</p>
        </>
      )}
    </ChartDialog>
  );
}
