// Molekuła: objaśnienie wskaźnika - CO znaczy liczba, JAK ją czytać, CO nią
// rusza i JAK wypada na tle rynku (SPEC §6.1, §6.5; UX §11-§14).
//
// DWA TRYBY, JEDNA TREŚĆ. Krótki (przy kaflu): skrót z rozwinięciem, wzór,
// jak czytać, „teraz” z oceną i kontekstem, „Więcej”. Pełny (słownik, BI,
// `?metric=`): wszystkie sekcje §6.1 - definicja, wzór, co mierzy, jak czytać,
// dźwignie, uważaj, porównanie z rynkiem (kontekst, okno, metoda, skala,
// pasma), pochodzenie liczby z rejestru, pary, źródła AKTYWNEGO kontekstu,
// pewność i stan na. Treść sekcji składa `MetricExplainerBody`, a okienko
// (`MetricExplainer`) tylko ją opakowuje - dzięki temu słownik wkłada to samo
// ciało do swojego arkusza bez drugiej kopii.
//
// POPOVER ≥ 640 PX, ARKUSZ < 640 PX - WYBÓR PRZY OTWARCIU. Na telefonie
// dymek z dwunastoma sekcjami nie mieści się nad kafelkiem, a arkusz od dołu
// daje pełną szerokość i przewijanie. Szerokość mierzymy `matchMedia`
// dopiero w obsłudze kliknięcia - nie w renderze, więc znacznik serwera
// i klienta jest identyczny (zamknięty przycisk), a obrót telefonu przy
// otwartym okienku nie przeskakuje między dwoma rodzajami okna.
//
// FOKUS. Okienko jest `dialog` z `aria-labelledby` na nagłówku wskaźnika;
// Escape i klik poza zamykają je i ODDAJĄ fokus ikonie (Popover: ręcznie,
// bo kotwicą jest `PopoverAnchor`, nie wyzwalacz Radiksa; arkusz:
// `useReturnFocus` z `ui/sheet`).
//
// DANE TO NIE NAPISY UI. Treść benchmarku przychodzi z serwera już w jednym
// języku; etykiety metryk i strumieni z rejestru wybiera `bi()` - jedyny
// dozwolony wybór języka danych (zakaz `lang === "pl" ?` dla napisów UI).
import { useId, useRef, useState, type ElementType, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import {
  bi,
  toBandsView,
  type LocalizedBenchmark,
  type LocalizedContext,
  type LocalizedSource,
} from "@/lib/analytics/semantic/benchmarks/adapter";
import {
  selectContext,
  type BenchmarkEvaluation,
} from "@/lib/analytics/semantic/benchmarks/evaluate";
import { benchmarkIndexEntry } from "@/lib/analytics/semantic/benchmarks/index";
import type {
  BenchContextSegment,
  BenchWindow,
  Measure,
} from "@/lib/analytics/semantic/benchmarks/types";
import { formatMetricValue } from "@/lib/analytics/semantic/format";
import { metricHelp } from "@/lib/analytics/semantic/metricHelp";
import { metricById, type MetricDefinition, type MetricId } from "@/lib/analytics/semantic/metrics";
import { streamById } from "@/lib/analytics/semantic/streams";
import type { ChartLang } from "@/lib/charts/format";
import { MAX_CHART_SOURCES } from "@/lib/charts/sources";
import "@/lib/i18n-admin-semantic";
import { ensureI18n } from "@/lib/i18n-admin-revenue-shell";
import { cn } from "@/lib/utils";
import { BenchmarkContextSelect } from "../atoms/BenchmarkContextSelect";
import { BenchmarkTierBadge, tierKey } from "../atoms/BenchmarkTierBadge";
import { MetricHelpButton } from "../atoms/MetricHelpButton";
import { SourceCitation } from "../atoms/SourceCitation";
import { benchmarkEntryFor, evaluateMetricValue, useBenchmark } from "../hooks/useBenchmark";
import { BenchmarkScale, type BenchmarkScaleState } from "./BenchmarkScale";

export type MetricExplainerMode = "short" | "full";

const WINDOW_KEY: Readonly<Record<BenchWindow, string>> = {
  month: "adminRevenue.benchmark.window.month",
  month_avg3: "adminRevenue.benchmark.window.month_avg3",
  quarter: "adminRevenue.benchmark.window.quarter",
  year: "adminRevenue.benchmark.window.year",
  ltm: "adminRevenue.benchmark.window.ltm",
  cohort_12m: "adminRevenue.benchmark.window.cohort_12m",
  cohort_m1: "adminRevenue.benchmark.window.cohort_m1",
  cohort_m3: "adminRevenue.benchmark.window.cohort_m3",
  cohort_m12: "adminRevenue.benchmark.window.cohort_m12",
  per_campaign: "adminRevenue.benchmark.window.per_campaign",
  per_customer: "adminRevenue.benchmark.window.per_customer",
  per_journey: "adminRevenue.benchmark.window.per_journey",
  snapshot: "adminRevenue.benchmark.window.snapshot",
};

const MEASURE_KEY: Readonly<Record<Measure, string>> = {
  level: "adminRevenue.benchmark.measure.level",
  change_yoy: "adminRevenue.benchmark.measure.change_yoy",
  change_mom_cmgr: "adminRevenue.benchmark.measure.change_mom_cmgr",
  share_of_base: "adminRevenue.benchmark.measure.share_of_base",
  attainment_vs_plan: "adminRevenue.benchmark.measure.attainment_vs_plan",
  cohort_survival: "adminRevenue.benchmark.measure.cohort_survival",
  ratio_of_flows: "adminRevenue.benchmark.measure.ratio_of_flows",
};

const DIRECTION_KEY: Readonly<Record<LocalizedContext["direction"], string>> = {
  higher: "adminRevenue.benchmark.direction.higher",
  lower: "adminRevenue.benchmark.direction.lower",
  range: "adminRevenue.benchmark.direction.range",
};

const CONFIDENCE_KEY: Readonly<Record<LocalizedBenchmark["confidence"], string>> = {
  low: "adminRevenue.benchmark.confidence.low",
  medium: "adminRevenue.benchmark.confidence.medium",
  high: "adminRevenue.benchmark.confidence.high",
};

/** Stan skali z powodu braku oceny - znacznik nie może udawać pomiaru. */
function scaleState(evaluation: BenchmarkEvaluation | null): BenchmarkScaleState | undefined {
  if (evaluation === null || evaluation.tier !== "none") return undefined;
  if (evaluation.why === "small_sample") return "small_sample";
  if (evaluation.why === "no_data") return "no_data";
  // Brak wartości to nie „brak oceny” - skala pokazuje wtedy same pasma.
  if (evaluation.why === "no_value") return undefined;
  return "none";
}

/** Źródła aktywnego kontekstu w jego kolejności, najwyżej tyle co przypisy wykresu (D11). */
function contextSources(
  ctx: Pick<LocalizedContext, "sourceIds">,
  sources: readonly LocalizedSource[],
): LocalizedSource[] {
  const out: LocalizedSource[] = [];
  for (const id of ctx.sourceIds) {
    const s = sources.find((x) => x.id === id);
    if (s) out.push(s);
    if (out.length === MAX_CHART_SOURCES) break;
  }
  return out;
}

/**
 * Poziom nagłówków sekcji idzie za tytułem okienka: w dymku tytuł to `h3`
 * (dymek stoi w treści karty z `h2`), w arkuszu - `SheetTitle` (`h2`).
 * Przeskok `h2 → h4` łamałby nawigację nagłówkami czytnika (axe
 * `heading-order`).
 */
type Level = 3 | 4;

function Section({
  title,
  level,
  children,
  className,
}: {
  title: string;
  level: Level;
  children: ReactNode;
  className?: string;
}) {
  const H: ElementType = level === 3 ? "h3" : "h4";
  return (
    <section className={cn("space-y-1", className)}>
      <H className="m-0 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </H>
      {children}
    </section>
  );
}

export interface MetricExplainerBodyProps {
  metricId?: MetricId;
  /** Wpis rejestru bez metryki (NPS, ACT) albo wpis niewiodący metryki. */
  benchKey?: string;
  /** Wartość w jednostce METRYKI (rejestr); pominięta = bez wiersza „teraz”. */
  value?: number | null;
  /** Liczebność próby - poniżej 50 ocena jest wstrzymana. */
  n?: number;
  /** Waluta kwoty (`money_minor`). */
  currency?: string;
  segment?: BenchContextSegment;
  /** Kontekst z adresu (`?ctx=`); nieznany spada do domyślnego. */
  ctx?: string;
  lang: ChartLang;
  mode: MetricExplainerMode;
  onCtxChange?: (ctxId: string) => void;
  /** „Więcej” w trybie krótkim; bez niego przycisku nie ma. */
  onMore?: () => void;
  /** Id nagłówka - okienko wiąże z nim `aria-labelledby`. */
  headingId: string;
  /** `sheet` = tytuł jako `SheetTitle` (nazwa okna dialogowego arkusza). */
  heading?: "popover" | "sheet";
}

export function MetricExplainerBody({
  metricId,
  benchKey,
  value,
  n,
  currency,
  segment,
  ctx,
  lang,
  mode,
  onCtxChange,
  onMore,
  headingId,
  heading = "popover",
}: MetricExplainerBodyProps) {
  ensureI18n();
  const { t } = useTranslation();
  const opts = { lng: lang };
  const { bench, sources, status, refetch } = useBenchmark({ metricId, benchKey, lang });
  const def: MetricDefinition | null = metricId ? metricById(metricId) : null;
  const help = metricId ? metricHelp(metricId, lang, bench) : null;
  const [localCtx, setLocalCtx] = useState<string | undefined>(ctx);
  const activeCtxId = onCtxChange ? ctx : (localCtx ?? ctx);
  const active = bench ? selectContext(bench, segment, activeCtxId) : null;

  const evaluation: BenchmarkEvaluation | null =
    value !== undefined && metricId
      ? evaluateMetricValue(metricId, value, bench, { n, currency, segment, ctxId: active?.id })
      : null;

  const abbr = bench?.abbr ?? help?.name ?? benchmarkIndexEntry(benchKey ?? "")?.abbr ?? "";
  const expansion = bench?.expansion ?? help?.expansion ?? "";
  const Title: ElementType = heading === "sheet" ? SheetTitle : "h3";
  const level: Level = heading === "sheet" ? 3 : 4;
  const Sub: ElementType = level === 3 ? "h4" : "h5";
  const changeCtx = (id: string): void => {
    if (onCtxChange) onCtxChange(id);
    else setLocalCtx(id);
  };

  const now =
    value !== undefined ? (
      <Section level={level} title={t("adminRevenue.benchmark.explainer.now", opts)}>
        <p className="m-0 flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold tabular-nums" data-explainer-value>
            {def ? formatMetricValue(value, def.unit, lang, "-", { currency }) : "-"}
          </span>
          {evaluation ? <BenchmarkTierBadge evaluation={evaluation} lang={lang} /> : null}
        </p>
        {active ? <p className="m-0 text-[11px] text-muted-foreground">{active.label}</p> : null}
      </Section>
    ) : null;

  const formula = help?.formula ?? bench?.formula ?? "";

  return (
    <div className="space-y-3 text-xs leading-relaxed" data-explainer-mode={mode}>
      <header className="space-y-0.5 pr-6">
        <Title id={headingId} className="m-0 text-sm font-semibold leading-5 text-foreground">
          {abbr}
          {expansion && expansion !== abbr ? (
            <span className="font-normal text-muted-foreground"> - {expansion}</span>
          ) : null}
        </Title>
        {bench && bench.name !== expansion ? (
          <p className="m-0 text-[11px] text-muted-foreground">{bench.name}</p>
        ) : null}
      </header>

      {mode === "full" && def ? (
        <Section level={level} title={t("adminRevenue.benchmark.explainer.definition", opts)}>
          <p className="m-0">{bi({ pl: def.definitionPl, en: def.definitionEn }, lang)}</p>
        </Section>
      ) : null}

      {formula ? (
        <Section level={level} title={t("adminRevenue.benchmark.explainer.formula", opts)}>
          <code className="block whitespace-pre-wrap break-words rounded-[6px] bg-muted/60 px-2 py-1.5 font-mono text-[11px] leading-snug">
            {formula}
          </code>
        </Section>
      ) : null}

      {mode === "full" && bench ? (
        <Section level={level} title={t("adminRevenue.benchmark.explainer.measures", opts)}>
          <p className="m-0">{bench.name}</p>
        </Section>
      ) : null}

      {bench?.interpretation ? (
        <Section level={level} title={t("adminRevenue.benchmark.explainer.reading", opts)}>
          <p className="m-0">{bench.interpretation}</p>
        </Section>
      ) : null}

      {now}

      {status === "loading" ? (
        <p className="m-0 text-muted-foreground" aria-busy="true" data-explainer-status="loading">
          {t("adminRevenue.benchmark.explainer.loading", opts)}
        </p>
      ) : null}
      {status === "error" ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2"
          data-explainer-status="error"
        >
          <span>{t("adminRevenue.benchmark.explainer.error", opts)}</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            onClick={refetch}
          >
            {t("adminRevenue.benchmark.explainer.retry", opts)}
          </Button>
        </div>
      ) : null}
      {status === "none" ? (
        <p className="m-0 text-muted-foreground" data-explainer-status="none">
          {t("adminRevenue.benchmark.explainer.noBenchmark", opts)}
        </p>
      ) : null}

      {mode === "short" && onMore ? (
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto p-0 text-xs font-semibold"
          onClick={onMore}
        >
          {t("adminRevenue.benchmark.explainer.more", opts)}
        </Button>
      ) : null}

      {mode === "full" && bench?.levers ? (
        <Section level={level} title={t("adminRevenue.benchmark.explainer.levers", opts)}>
          <p className="m-0">{bench.levers}</p>
        </Section>
      ) : null}

      {mode === "full" && (bench?.caveats.length || def?.guards.length) ? (
        <Section level={level} title={t("adminRevenue.benchmark.explainer.caveats", opts)}>
          <ul className="m-0 list-disc space-y-1 pl-4">
            {bench
              ? bench.caveats.map((c, i) => <li key={i}>{c.text}</li>)
              : def?.guards.map((g, i) => <li key={i}>{g}</li>)}
          </ul>
        </Section>
      ) : null}

      {mode === "full" && bench && active ? (
        <Section level={level} title={t("adminRevenue.benchmark.explainer.benchmark", opts)}>
          <BenchmarkContextSelect
            bench={bench}
            value={active.id}
            onChange={changeCtx}
            lang={lang}
          />
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px]">
            <dt className="text-muted-foreground">
              {t("adminRevenue.benchmark.explainer.window", opts)}
            </dt>
            <dd className="m-0">{t(WINDOW_KEY[active.window], opts)}</dd>
            <dt className="text-muted-foreground">
              {t("adminRevenue.benchmark.explainer.measure", opts)}
            </dt>
            <dd className="m-0">{t(MEASURE_KEY[active.measure], opts)}</dd>
            <dt className="text-muted-foreground">
              {t("adminRevenue.benchmark.explainer.direction", opts)}
            </dt>
            <dd className="m-0">{t(DIRECTION_KEY[active.direction], opts)}</dd>
          </dl>
          <BenchmarkScale
            context={active}
            value={evaluation && evaluation.tier !== "none" ? evaluation.value : null}
            state={scaleState(evaluation)}
            n={n}
            lang={lang}
            name={abbr}
            className="pt-1"
          />
          <Sub className="m-0 pt-1 text-[11px] font-semibold">
            {t("adminRevenue.benchmark.explainer.bands", opts)}
          </Sub>
          <ul className="m-0 list-none space-y-1 p-0">
            {toBandsView(active, lang).map((v, i) => (
              <li key={`${v.tier}-${i}`} className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium">{t(tierKey(v.tier), opts)}</span>
                <span className="tabular-nums">{v.label}</span>
                <span className="text-[10px] text-muted-foreground">
                  {v.basis === "B"
                    ? t("adminRevenue.benchmark.scale.basisB", opts)
                    : t("adminRevenue.benchmark.scale.basisE", opts)}
                </span>
                {active.bands[i]?.note ? (
                  <span className="basis-full text-[10px] text-muted-foreground">
                    {active.bands[i].note}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="m-0 text-[11px]">
            <span className="font-semibold">
              {t("adminRevenue.benchmark.explainer.method", opts)}:{" "}
            </span>
            {active.method}
          </p>
        </Section>
      ) : null}

      {mode === "full" ? (
        <Section level={level} title={t("adminRevenue.benchmark.explainer.provenance", opts)}>
          {def ? (
            <ul className="m-0 list-none space-y-1 p-0">
              {def.bindings.map((b) => {
                const stream = streamById(b.streamId);
                return (
                  <li key={b.streamId} className="rounded-[6px] border px-2 py-1">
                    <span className="font-medium">
                      {bi({ pl: stream.labelPl, en: stream.labelEn }, lang)}
                    </span>{" "}
                    <span className="text-[10px] text-muted-foreground">
                      (
                      {b.role === "authoritative"
                        ? t("adminAnalytics.semantic.authoritative", opts)
                        : t("adminAnalytics.semantic.corroborating", opts)}
                      )
                    </span>
                    <code className="mt-0.5 block break-words font-mono text-[10px] text-muted-foreground">
                      {b.formula}
                    </code>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="m-0" data-explainer-no-metric>
              <span className="font-semibold">
                {t("adminRevenue.benchmark.dictionary.noMetric", opts)}
              </span>
              {bench?.noMetricReason ? `: ${bench.noMetricReason}` : ""}
            </p>
          )}
        </Section>
      ) : null}

      {mode === "full" && bench && bench.pairs.length > 0 ? (
        <Section level={level} title={t("adminRevenue.benchmark.explainer.pairs", opts)}>
          <p className="m-0 flex flex-wrap gap-1">
            {bench.pairs.map((key) => (
              <span key={key} className="rounded-[6px] border px-1.5 text-[11px] font-medium">
                {benchmarkIndexEntry(key)?.abbr ?? key}
              </span>
            ))}
          </p>
        </Section>
      ) : null}

      {mode === "full" && bench && active ? (
        <Section level={level} title={t("adminRevenue.benchmark.explainer.sources", opts)}>
          <ol className="m-0 list-decimal space-y-2 pl-4">
            {contextSources(active, sources).map((s) => (
              <li key={s.id}>
                <SourceCitation source={s} lang={lang} />
              </li>
            ))}
          </ol>
        </Section>
      ) : null}

      {mode === "full" && bench ? (
        <p className="m-0 flex flex-wrap gap-x-3 border-t pt-2 text-[11px] text-muted-foreground">
          <span>
            {t("adminRevenue.benchmark.explainer.confidence", opts)}:{" "}
            {t(CONFIDENCE_KEY[bench.confidence], opts)}
          </span>
          <span>{t("adminRevenue.benchmark.explainer.asOf", { ...opts, date: bench.asOf })}</span>
          <span>
            {t("adminRevenue.benchmark.explainer.reviewBy", { ...opts, date: bench.reviewBy })}
          </span>
        </p>
      ) : null}
    </div>
  );
}

export interface MetricExplainerProps extends Omit<
  MetricExplainerBodyProps,
  "mode" | "headingId" | "heading" | "onMore"
> {
  mode?: MetricExplainerMode;
  /** „Więcej” oddaje pełny widok wołającemu (np. `?metric=` w BI); bez tego rozwija się w miejscu. */
  onOpenFull?: () => void;
  /** Nazwa do etykiety dostępnej ikony; domyślnie skrót z rejestru. */
  name?: string;
  className?: string;
}

/** Ikona objaśnienia + okienko (Popover albo arkusz od dołu). */
export function MetricExplainer({
  mode = "short",
  onOpenFull,
  name,
  className,
  ...body
}: MetricExplainerProps) {
  const headingId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [surface, setSurface] = useState<"popover" | "sheet">("popover");
  const [expanded, setExpanded] = useState(false);
  const effectiveMode: MetricExplainerMode = expanded ? "full" : mode;
  // Skrót z lekkiego indeksu (bez zapytania) - ten sam, który pokaże nagłówek
  // po wczytaniu treści; metryka bez benchmarku bierze skrót z rejestru.
  const label =
    name ??
    benchmarkEntryFor({ metricId: body.metricId, benchKey: body.benchKey })?.abbr ??
    (body.metricId ? metricHelp(body.metricId, body.lang).name : "");

  const toggle = (): void => {
    if (!open) {
      // Szerokość czytamy W CHWILI OTWARCIA (nie w renderze) - SSR i
      // pierwszy render klienta są identyczne, a obrót ekranu przy otwartym
      // okienku nie przeskakuje między dymkiem a arkuszem.
      const wide =
        typeof window === "undefined" || typeof window.matchMedia !== "function"
          ? true
          : window.matchMedia("(min-width: 640px)").matches;
      setSurface(wide ? "popover" : "sheet");
      setExpanded(false);
    }
    setOpen((o) => !o);
  };
  const more = (): void => {
    if (onOpenFull) {
      setOpen(false);
      onOpenFull();
    } else {
      setExpanded(true);
    }
  };

  const content = (heading: "popover" | "sheet") => (
    <MetricExplainerBody
      {...body}
      mode={effectiveMode}
      headingId={headingId}
      heading={heading}
      onMore={more}
    />
  );

  return (
    <span className={cn("inline-flex", className)}>
      <Popover
        open={open && surface === "popover"}
        onOpenChange={(next) => {
          if (!next) setOpen(false);
        }}
      >
        <PopoverAnchor asChild>
          <MetricHelpButton
            ref={buttonRef}
            metricId={body.metricId}
            benchKey={body.benchKey}
            lang={body.lang}
            name={label}
            expanded={open}
            onClick={toggle}
          />
        </PopoverAnchor>
        <PopoverContent
          align="start"
          aria-labelledby={headingId}
          className="max-h-[min(70vh,40rem)] w-[min(26rem,calc(100vw-2rem))] overflow-y-auto p-3"
          onCloseAutoFocus={(e) => {
            // Kotwicą jest `PopoverAnchor`, nie wyzwalacz Radiksa - powrót
            // fokusu na ikonę trzeba wskazać jawnie.
            e.preventDefault();
            buttonRef.current?.focus();
          }}
        >
          {content("popover")}
        </PopoverContent>
      </Popover>
      {surface === "sheet" ? (
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent
            side="bottom"
            aria-labelledby={headingId}
            aria-describedby={undefined}
            className="max-h-[90vh] overflow-y-auto p-4"
            onCloseAutoFocus={(e) => {
              // Safari nie ustawia fokusu na klikniętym przycisku, więc
              // „poprzednio aktywny element” bywa `<body>` - ikonę wskazujemy jawnie.
              e.preventDefault();
              buttonRef.current?.focus();
            }}
          >
            {content("sheet")}
          </SheetContent>
        </Sheet>
      ) : null}
    </span>
  );
}
