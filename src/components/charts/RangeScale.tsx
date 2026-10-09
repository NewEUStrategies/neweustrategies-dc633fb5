// SKALA PRZEDZIAŁU karty KPI - gdzie leży wynik względem normy.
//
// Pasek 12 px z zaokrągleniem 6 px, trzy strefy: poniżej przedziału, optimum
// i powyżej. Kolor strefy zależy od KIERUNKU wskaźnika: dla konwersji strefa
// poniżej jest „za nisko" (czerwień 16%), a powyżej „lepiej" (dodatni 16%);
// dla kosztu odwrotnie. Znacznik wartości to pionowa kreska 4 x 20 px w tuszu
// z obwódką 2 px w kolorze płyty, więc odcina się od każdej strefy.
//
// PODPOWIEDZI SŁOWNE przy strefach („Za nisko: poniżej 2%") - kolor strefy
// nigdy nie jest jedynym nośnikiem znaczenia. Bez przedziału ze źródłem karta
// mówi „brak benchmarku" i gdzie go dodać, zamiast rysować skalę zgadywaną.
import { useTranslation } from "react-i18next";
import { formatChartValue, type ChartLang } from "@/lib/charts/format";
import { ROLE } from "@/lib/charts/roles";
import { rangeStatus, STATUS_KEYS, statusSymbol, type MetricDirection } from "@/lib/charts/status";
import "@/lib/i18n-charts";

interface RangeScaleProps {
  value: number | null;
  band: { min: number; max: number } | null;
  direction: MetricDirection | null;
  unit: string;
  lang: ChartLang;
}

/** Tło strefy: kolor roli przy 16% krycia, przez `color-mix`, bez hexa. */
function tint(role: string, pct: number): string {
  return `color-mix(in srgb, ${role} ${pct}%, transparent)`;
}

export function RangeScale({ value, band, direction, unit, lang }: RangeScaleProps) {
  const { t: scoped } = useTranslation("translation", { keyPrefix: "charts" });
  const t = (key: string, values?: Record<string, string | number>): string =>
    scoped(key, { lng: lang, ...values });

  if (band === null) {
    return (
      <div className="mt-3 text-xs" data-role="range-scale" data-state="none">
        <div className="font-semibold" style={{ color: ROLE.sAltText }}>
          ? {t("kpi.noBenchmark")}
        </div>
        <div style={{ color: ROLE.ink3 }}>{t("kpi.noBenchmarkHint")}</div>
      </div>
    );
  }

  const width = band.max - band.min || Math.abs(band.max) || 1;
  // Skala nie schodzi poniżej zera, gdy ani norma, ani wynik nie są ujemne -
  // strefa „poniżej 0 ms" byłaby obietnicą wyniku, który nie istnieje.
  const floor = band.min >= 0 && (value ?? 0) >= 0 ? 0 : -Infinity;
  const lo = Math.max(floor, Math.min(band.min - width * 0.5, value ?? band.min));
  const hi = Math.max(band.max + width * 0.5, value ?? band.max);
  const pos = (v: number): number => ((v - lo) / (hi - lo || 1)) * 100;
  const a = pos(band.min);
  const b = pos(band.max);
  const fmt = (v: number): string => formatChartValue(v, lang, unit);
  const belowIsGood = direction === "lower";
  const aboveIsGood = direction === "higher";
  const status = rangeStatus(value, band, direction);

  const zones = [
    {
      key: "below",
      from: 0,
      to: a,
      color: belowIsGood ? tint(ROLE.pos, 16) : tint(ROLE.neg, 16),
      hint: belowIsGood
        ? t("kpi.betterLow", { value: fmt(band.min) })
        : t("kpi.tooLow", { value: fmt(band.min) }),
    },
    {
      key: "optimum",
      from: a,
      to: b,
      color: tint(ROLE.acc, 18),
      hint: t("kpi.optimum", { min: fmt(band.min), max: fmt(band.max) }),
    },
    {
      key: "above",
      from: b,
      to: 100,
      color: aboveIsGood ? tint(ROLE.pos, 16) : tint(ROLE.warn, 16),
      hint: aboveIsGood
        ? t("kpi.betterHigh", { value: fmt(band.max) })
        : t("kpi.tooHigh", { value: fmt(band.max) }),
    },
  ].filter((z) => z.to - z.from > 0.5);

  const label =
    value === null
      ? t("kpi.scale")
      : t("kpi.marker", {
          value: fmt(value),
          status: `${statusSymbol(status, value, band)} ${t(STATUS_KEYS[status])}`,
        });

  return (
    <div className="mt-3" data-role="range-scale" data-status={status}>
      <div className="relative" style={{ height: 20 }} role="img" aria-label={label}>
        <div
          className="absolute inset-x-0 overflow-hidden"
          style={{ top: 4, height: 12, borderRadius: 6 }}
        >
          {zones.map((z) => (
            <div
              key={z.key}
              data-zone={z.key}
              className="absolute inset-y-0"
              style={{ left: `${z.from}%`, width: `${z.to - z.from}%`, background: z.color }}
            />
          ))}
        </div>
        {value !== null && (
          <div
            data-role="range-marker"
            className="absolute top-0"
            style={{
              left: `${Math.max(0, Math.min(100, pos(value)))}%`,
              width: 4,
              height: 20,
              transform: "translateX(-50%)",
              borderRadius: 2,
              background: ROLE.ink,
              boxShadow: `0 0 0 2px ${ROLE.panel}`,
            }}
          />
        )}
      </div>
      {/* PODPOWIEDZI STREF jako lista z próbką koloru strefy - zawijana, nie
          ucinana: w wąskiej karcie trzy etykiety pod trzema strefami nie
          mieszczą się w szerokości stref, a ucięta podpowiedź nie mówi nic. */}
      <ul
        className="m-0 mt-1 flex list-none flex-wrap gap-x-3 gap-y-0.5 p-0 text-[11px] leading-snug"
        style={{ color: ROLE.ink3 }}
      >
        {zones.map((z) => (
          <li key={z.key} className="inline-flex items-center gap-1" data-zone-hint={z.key}>
            <span
              aria-hidden
              className="inline-block h-2 w-2 shrink-0 rounded-[2px]"
              style={{ background: z.color, boxShadow: `inset 0 0 0 1px ${ROLE.line2}` }}
            />
            {z.hint}
          </li>
        ))}
      </ul>
    </div>
  );
}
