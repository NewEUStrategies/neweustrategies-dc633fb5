// Molekuła: skala oceny benchmarku - pasma jako segmenty i pozycja wartości
// (SPEC §6.1, AD-20, K-08).
//
// SKALA PORZĄDKOWA, NIE OŚ. Pasma mają otwarte końce („< 2,7 %”, „≥ 7 %”),
// których nie da się narysować w proporcji, a pasmo „normalny” od 3,5 do
// 4,9 % nie jest „dwa razy szersze” w żadnym sensie, który czytelnik miałby
// odczytać. Dlatego każde pasmo dostaje segment RÓWNEJ szerokości, a liczba
// segmentów to liczba pasm kontekstu (3-7, nie zawsze 5 - wskaźniki
// przedziałowe mają powtórzone poziomy po obu stronach optimum, V5).
// Znacznik wartości stoi w segmencie, który ją zawiera; w segmencie
// skończonym - proporcjonalnie do położenia, w otwartym - pośrodku.
//
// OPIS SŁOWNY JEST PEŁNY. `role="img"` dostaje nazwę, która mówi wszystko,
// co mówi rysunek: wskaźnik, wartość z oceną i każde pasmo z zakresem.
// Dla czytnika jest też tabela pasm (`sr-only`) z nagłówkami `scope`
// i podstawą B/E - tabela daje nawigację komórka po komórce, której nazwa
// obrazka nie daje.
//
// STANY BEZ OCENY NIE RYSUJĄ ZNACZNIKA. Mała próba, brak danych i brak oceny
// mówią to słowem pod skalą; znacznik w „krytycznym” przy n = 3 byłby
// fałszywą diagnozą.
//
// GEOMETRIA WSPÓLNA DLA MOTYWÓW: wysokości, odstępy i promienie stałe, kolory
// wyłącznie z `tierColor` (tokeny ról z `color-mix`).
import { useTranslation } from "react-i18next";
import {
  formatBenchValue,
  toBandsView,
  type BandView,
  type LocalizedContext,
} from "@/lib/analytics/semantic/benchmarks/adapter";
import { tierOf } from "@/lib/analytics/semantic/benchmarks/evaluate";
import type { ChartLang } from "@/lib/charts/format";
import { ROLE } from "@/lib/charts/roles";
import { tierColor, tierTextColor } from "@/lib/charts/benchmarkTier";
import { ensureI18n } from "@/lib/i18n-admin-revenue-shell";
import { cn } from "@/lib/utils";
import { tierKey } from "../atoms/BenchmarkTierBadge";

export type BenchmarkScaleState = "none" | "no_data" | "small_sample";

const STATE_KEY: Readonly<Record<BenchmarkScaleState, string>> = {
  none: "adminRevenue.benchmark.state.none",
  no_data: "adminRevenue.benchmark.state.no_data",
  small_sample: "adminRevenue.benchmark.state.small_sample",
};

export interface BenchmarkScaleProps {
  context: Pick<
    LocalizedContext,
    "id" | "label" | "unit" | "displayUnit" | "currency" | "bands" | "direction"
  >;
  /** Wartość w jednostce PASM kontekstu (po normalizacji); `null` = brak. */
  value: number | null;
  lang: ChartLang;
  /** Nazwa wskaźnika (skrót) - do opisu słownego. */
  name: string;
  /** Jawny stan bez oceny - znacznik się nie rysuje. */
  state?: BenchmarkScaleState;
  n?: number;
  className?: string;
}

/** Pozycja znacznika w procentach szerokości skali. */
function markerPosition(value: number, ctx: BenchmarkScaleProps["context"]): number | null {
  const evaluation = tierOf(value, ctx);
  if (evaluation.tier === "none") return null;
  // `tierOf` oddaje pasmo z TEJ tablicy (szuka po zawartości), więc indeks
  // jest jednoznaczny także przy powtórzonych poziomach przedziałowych.
  const index = ctx.bands.findIndex((b) => b === evaluation.band);
  if (index < 0) return null;
  const band = ctx.bands[index];
  const inside =
    band.min !== null && band.max !== null
      ? Math.min(1, Math.max(0, (value - band.min) / (band.max - band.min)))
      : 0.5;
  return ((index + inside) / ctx.bands.length) * 100;
}

export function BenchmarkScale({
  context,
  value,
  lang,
  name,
  state,
  n,
  className,
}: BenchmarkScaleProps) {
  ensureI18n();
  const { t } = useTranslation();
  const opts = { lng: lang };
  const views: BandView[] = toBandsView(context, lang);
  const marker = state === undefined && value !== null ? markerPosition(value, context) : null;
  const evaluation = marker !== null && value !== null ? tierOf(value, context) : null;

  const rangeText = (v: BandView): string =>
    v.from === ""
      ? t("adminRevenue.benchmark.scale.openStart", { ...opts, to: v.to })
      : v.to === ""
        ? t("adminRevenue.benchmark.scale.openEnd", { ...opts, from: v.from })
        : t("adminRevenue.benchmark.scale.bandRange", {
            ...opts,
            tier: t(tierKey(v.tier), opts),
            from: v.from,
            to: v.to,
          });
  const bandSentence = (v: BandView): string =>
    v.from === "" || v.to === "" ? `${t(tierKey(v.tier), opts)}: ${rangeText(v)}` : rangeText(v);

  const valueSentence =
    state !== undefined
      ? t(STATE_KEY[state], opts)
      : value === null
        ? t("adminRevenue.benchmark.state.no_value", opts)
        : t("adminRevenue.benchmark.scale.value", {
            ...opts,
            value: formatBenchValue(value, context, lang),
          }) +
          (evaluation && evaluation.tier !== "none"
            ? ` - ${t(tierKey(evaluation.tier), opts)}`
            : "");

  const description = [
    t("adminRevenue.benchmark.scale.label", { ...opts, name }),
    valueSentence,
    ...views.map(bandSentence),
  ].join(". ");

  return (
    <div className={cn("space-y-1.5", className)} data-scale={context.id}>
      <div role="img" aria-label={description} className="relative pt-2.5">
        {marker !== null ? (
          <span
            aria-hidden="true"
            data-marker
            className="absolute top-0 h-0 w-0 -translate-x-1/2 border-x-[5px] border-t-[7px] border-x-transparent"
            style={{ left: `${marker}%`, borderTopColor: ROLE.ink }}
          />
        ) : null}
        <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-[3px]">
          {views.map((v, i) => (
            <span
              key={`${v.tier}-${i}`}
              data-segment={v.tier}
              data-basis={v.basis}
              className="h-full flex-1"
              style={{
                backgroundColor: tierColor(v.tier),
                // Heurystyka (E) ma kreskowanie - podstawa pasma widoczna
                // także bez czytania tabeli.
                backgroundImage:
                  v.basis === "E"
                    ? `repeating-linear-gradient(135deg, transparent 0 3px, ${ROLE.panel} 3px 4px)`
                    : undefined,
              }}
            />
          ))}
        </div>
        <div aria-hidden="true" className="mt-1 flex text-[10px] leading-3 tabular-nums">
          {views.map((v, i) => (
            <span
              key={`${v.tier}-${i}`}
              className="min-w-0 flex-1 truncate text-center"
              style={{ color: tierTextColor(v.tier) }}
            >
              {v.label}
            </span>
          ))}
        </div>
      </div>
      {state !== undefined ? (
        <p className="m-0 text-[11px] leading-snug text-muted-foreground" data-scale-state={state}>
          {t(STATE_KEY[state], opts)}
          {state === "small_sample" && n !== undefined
            ? ` (${t("adminRevenue.benchmark.scale.sample", { ...opts, n })})`
            : ""}
        </p>
      ) : null}
      <table className="sr-only">
        <caption>
          {t("adminRevenue.benchmark.scale.caption", opts)}: {context.label}
        </caption>
        <thead>
          <tr>
            <th scope="col">{t("adminRevenue.benchmark.dictionary.colTier", opts)}</th>
            <th scope="col">{t("adminRevenue.benchmark.scale.colRange", opts)}</th>
            <th scope="col">{t("adminRevenue.benchmark.scale.colBasis", opts)}</th>
          </tr>
        </thead>
        <tbody>
          {views.map((v, i) => (
            <tr key={`${v.tier}-${i}`}>
              <th scope="row">{t(tierKey(v.tier), opts)}</th>
              <td>{v.label}</td>
              <td>
                {v.basis === "B"
                  ? t("adminRevenue.benchmark.scale.basisB", opts)
                  : t("adminRevenue.benchmark.scale.basisE", opts)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
