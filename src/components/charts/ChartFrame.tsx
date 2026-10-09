// PANEL WYKRESU - rama wokół rysunku (specyfikacja 2026-10).
//
// UKŁAD:
//   * nagłówek: TYTUŁ (co widać albo wniosek), znaczek „demo" przy danych
//     demonstracyjnych, PODTYTUŁ z jednostką, źródłem i literą pochodzenia
//     („%. Źródło: Twoje dane (D)") oraz numerami przypisów;
//   * przyciski po prawej: „i" (jak czytać wykres), „⤢" (powiększenie
//     w szerokim oknie), PNG (podwójna rozdzielczość, tło motywu), SVG
//     (wektor z tłem i fontem);
//   * legenda w prawym górnym rogu, pod wykresem przy wielu seriach albo
//     w wąskim panelu; pozycja legendy ukrywa i pokazuje serię;
//   * ramka „Jak czytać" OBOK wykresu (pod nim w wąskim panelu): co pokazuje,
//     co zaskakuje, czego nie pokazuje;
//   * opcjonalny podpis pod wykresem, ostrzeżenia uczciwości, tabela danych.
//
// PODPIS UCZCIWOŚCIOWY zostaje: liczba obserwacji `n`, data danych,
// ostrzeżenie o uciętej osi i o udziałach, które się nie domykają - wykres
// łatwiej kłamie niż tabela, więc rama mówi to, czego autor sam nie napisze.
// Tabela danych zostaje kanałem dostępności: tooltip nigdy nie jest jedyną
// drogą do wartości.
//
// Legenda pisze nazwy serii WARIANTEM TEKSTOWYM koloru (próg 4,5:1), nie
// kolorem linii (3,0:1).
import { Fragment, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Table2, TriangleAlert } from "lucide-react";
import type { KindCaps } from "@/lib/charts/kindCaps";
import type { ChartLang } from "@/lib/charts/format";
import type { ChartMetric } from "@/lib/charts/types";
import type { ChartPalette } from "@/lib/charts/seriesStyle";
import {
  chicagoBibliography,
  safeSourceUrl,
  type ChartSource,
  type Provenance,
  type Reliability,
} from "@/lib/charts/sources";
import {
  nazwaPliku,
  pobierzPlik,
  svgDoPliku,
  svgDoPng,
  type WpisKlucza,
} from "@/lib/charts/exportImage";
import { cn } from "@/lib/utils";
import { MetricTooltip } from "./MetricTooltip";
import { ChartDialog } from "./ChartDialog";
import "@/lib/i18n-charts";

export interface LegendItem {
  /** Klucz Reacta i uchwyt przełącznika - slot, rola albo pozycja serii. */
  key: string;
  name: string;
  /** Kolor ZNACZNIKA (próg 3,0:1). */
  color: string;
  /** Kolor NAPISU (próg 4,5:1) - osobne pole, bo to nie ten sam kolor. */
  textColor: string;
  /** Kształt klucza: linia dla line/area, prostokąt dla reszty. */
  shape: "line" | "rect";
  /** Linia przerywana - drugi nośnik różnicy obok koloru. */
  dashed?: boolean;
  /** Pozycja przełącza widoczność serii na rysunku. */
  toggleable?: boolean;
}

export interface ChartCaption {
  source: string;
  sourceDate: string;
  unit: string;
  sampleSize: number | null;
  /** Oś wartości nie zaczyna się od zera - ucięcie MUSI być nazwane. */
  zeroBaselineBroken: boolean;
  /** Suma ZAOKRĄGLONYCH udziałów tarczy, gdy nie domyka 100%; null = w porządku. */
  shareSumMismatch: string | null;
  notesShows: string;
  notesSurprising: string;
  notesHidden: string;
  /** Opcjonalny podpis pod wykresem. */
  caption?: string;
}

/**
 * Rodzina rysunku - rozstrzyga o tekstach „Jak czytać". Rodziny wykresów idą
 * wprost z `KindCaps["family"]` (`src/lib/charts/kindCaps.ts`), plus `map`
 * dla kartogramu, który nie jest rodzajem wykresu.
 */
export type ChartFamily = KindCaps["family"] | "map";

/** Wpis klucza dołączanego do eksportu PNG - nazwa i kolor próbki. */
export interface ChartExportKeyItem {
  label: string;
  /** Kolor próbki; wyrażenie CSS z tokenami jest rozwiązywane przed rysowaniem. */
  color: string;
}

/** Fakty o wykresie, z których rama składa podtytuł, przypisy i „Jak czytać". */
export interface ChartPanelMeta {
  /** Paleta rysunku; brak = rysunek bez wyboru palety (np. kartogram). */
  palette?: ChartPalette;
  /** Rodzina rysunku dla tekstów „Jak czytać"; brak = teksty ogólne. */
  family?: ChartFamily;
  /**
   * Teksty „Jak czytać" GOTOWE (już przetłumaczone) - nadpisują zdania
   * słownika `charts.read.*` w oknie pomocy. Kartogram podaje tu własne
   * zdania (`chartsMap.*`), bo nie ma osi ani serii.
   */
  help?: { elements: string; colours: string; interactions: string };
  /**
   * Klucz do eksportu PNG podany przez rysunek. Brak = klucz zebrany
   * z legendy ramy (`.neh-legend`). Rysunek bez legendy serii (mapa, tarcza
   * z kluczem w tabeli) podaje go tutaj, żeby plik nie był bezimienny.
   */
  exportKey?: () => ChartExportKeyItem[];
  demo: boolean;
  provenance: Provenance | null;
  sources: readonly ChartSource[];
  /** Numeracja przypisów strony (artykuł); brak = numeracja w obrębie wykresu. */
  footnoteNumbers?: ReadonlyMap<string, number>;
  hasBand: boolean;
  hasTarget: boolean;
  zoomable: boolean;
}

interface ChartFrameProps {
  title: string;
  description: string;
  lang: ChartLang;
  /** Wyjaśnienie wskaźnika przy tytule; null = wykres go nie potrzebuje. */
  metric: ChartMetric | null;
  /** Legenda - renderowana przy >=2 pozycjach. */
  legend: LegendItem[];
  showLegend: boolean;
  caption: ChartCaption;
  /** Tabela danych - dostępnościowa alternatywa dla grafiki. */
  table: ReactNode;
  children: ReactNode;
  className?: string;
  /** Klucze pozycji legendy, których seria jest ukryta. */
  hiddenLegend?: ReadonlySet<string>;
  onToggleLegend?: (key: string) => void;
  /** Serie nazywają etykiety przy końcu linii - legenda zbędna. */
  legendSuppressed?: boolean;
  meta?: ChartPanelMeta;
  /** Rysunek w powiększeniu, w podanej wysokości. */
  renderExpanded?: (height: number) => ReactNode;
  /**
   * `panel` - pełna karta z przyciskami; `embedded` - bez karty i przycisków,
   * bo osadzenie (karta pulpitu) ma własny nagłówek i własny eksport.
   */
  variant?: "panel" | "embedded";
  /**
   * `false` - nagłówek bez przycisków PNG/SVG i „Jak czytać" bez akapitu
   * o eksporcie: rama nie ma rysunku do zapisania (pusty zestaw mapy),
   * a przycisk, który zawsze kończy się komunikatem o błędzie, wygląda na
   * zepsutą stronę. Domyślnie `true`.
   */
  exportable?: boolean;
  /** Okna dorzucane przez rysunek (definicja klikniętego punktu). */
  dialogs?: ReactNode;
}

const RELIABILITY_KEYS: Record<Reliability, string> = {
  A: "reliability.A",
  B: "reliability.B",
  C: "reliability.C",
};

const PROVENANCE_KEYS: Record<Provenance, string> = {
  D: "provenance.D",
  W: "provenance.W",
  B: "provenance.B",
  E: "provenance.E",
  "?": "provenance.unknown",
};

/** Usuwa wiodące „Źródło:" z podpisu autora - podtytuł dokleja je sam. */
function bareSource(raw: string): string {
  return raw.replace(/^\s*(źródło|zrodlo|source|sources|źródła)\s*:\s*/i, "").trim();
}

/** Próbka legendy 12 x 4 px; przerywana dla serii linii przerywanej. */
function swatchStyle(item: LegendItem): CSSProperties {
  if (item.dashed) {
    return {
      background: `repeating-linear-gradient(90deg, ${item.color} 0 4px, transparent 4px 6px)`,
    };
  }
  return { background: item.color };
}

/**
 * Klucz eksportu podany przez rysunek, z kolorami ROZWIĄZANYMI w ramie.
 * Płótno PNG nie zna `var(--chart-*)` ani `color-mix()`, więc kolor próbki
 * przechodzi przez styl obliczony elementu-sondy wewnątrz figury (tam, gdzie
 * obowiązują tokeny motywu), a napis bierze kolor tekstu figury.
 */
function kluczRysunku(figure: HTMLElement, items: readonly ChartExportKeyItem[]): WpisKlucza[] {
  const sonda = document.createElement("span");
  sonda.hidden = true;
  figure.appendChild(sonda);
  try {
    const textColor = getComputedStyle(figure).color;
    return items.map((item) => {
      sonda.style.color = "";
      sonda.style.color = item.color;
      const color = getComputedStyle(sonda).color || item.color;
      return { label: item.label, color, textColor: textColor || color };
    });
  } finally {
    sonda.remove();
  }
}

export function ChartFrame({
  title,
  description,
  lang,
  metric,
  legend,
  showLegend,
  caption,
  table,
  children,
  className,
  hiddenLegend,
  onToggleLegend,
  legendSuppressed = false,
  meta,
  renderExpanded,
  variant = "panel",
  exportable = true,
  dialogs,
}: ChartFrameProps) {
  const [tableOpen, setTableOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [expandedHeight, setExpandedHeight] = useState<number | null>(null);
  const [footnote, setFootnote] = useState<{ source: ChartSource; n: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const [exportError, setExportError] = useState(false);
  const figureRef = useRef<HTMLElement>(null);
  const plotRef = useRef<HTMLDivElement>(null);
  const expandedRef = useRef<HTMLDivElement>(null);
  // Prefiks przez `keyPrefix` haka - tylko taki widzi bramka rozjazdu
  // kod<->słownik.
  const { t: scoped } = useTranslation("translation", { keyPrefix: "charts" });
  const t = (key: string, values?: Record<string, string | number>): string =>
    scoped(key, { lng: lang, ...values });
  const tableId = useId();
  const titleId = useId();
  const panel = variant === "panel";
  // Legenda przy jednej serii to szum - tytuł nazywa jedyny kolor.
  const legendVisible = showLegend && legend.length >= 2 && !legendSuppressed;
  const legendPosition = legend.length > 4 ? "bottom" : "top";

  const sources = meta?.sources ?? [];
  const footnoteNumber = (source: ChartSource, index: number): number =>
    meta?.footnoteNumbers?.get(source.id) ?? index + 1;

  // PODTYTUŁ: jednostka, źródło i litera pochodzenia - „%. Źródło: Twoje dane (D)".
  const unit = caption.unit.trim();
  const provenance = meta?.provenance ?? null;
  const namedSource = bareSource(caption.source);
  const sourceName =
    meta?.demo === true
      ? t("panel.demoData")
      : namedSource !== ""
        ? namedSource
        : provenance !== null
          ? t(PROVENANCE_KEYS[provenance])
          : "";
  const sourcePart =
    sourceName !== ""
      ? `${t("panel.source", { source: sourceName })}${provenance !== null ? ` (${provenance})` : ""}`
      : "";
  const subtitle = [unit ? `${unit}.` : "", sourcePart].filter(Boolean).join(" ");
  const showHead = Boolean(
    title || description || metric || (panel && (subtitle || sources.length)),
  );

  const facts = [
    // Jednostka i źródło są w podtytule; w osadzeniu bez nagłówka zostają tu.
    !showHead && caption.unit ? t("caption.unit", { unit: caption.unit.trim() }) : "",
    caption.sampleSize !== null ? t("caption.sampleSize", { count: caption.sampleSize }) : "",
    caption.sourceDate ? t("caption.sourceDate", { date: caption.sourceDate }) : "",
  ].filter(Boolean);

  const notes = [
    [t("notes.shows"), caption.notesShows],
    [t("notes.surprising"), caption.notesSurprising],
    [t("notes.hidden"), caption.notesHidden],
  ].filter((row): row is [string, string] => Boolean(row[1]));

  /**
   * Eksport rysunku z kontenera - tło płyty OBECNEGO motywu, font strony.
   *
   * CEL EKSPORTU: `<svg>` w elemencie oznaczonym `data-chart-canvas`; klasa
   * `.neh-canvas` zostaje aliasem dla rysunków sprzed tego znacznika. Brak
   * rysunku to BŁĄD WIDOCZNY dla czytelnika, nie ciche nic: przycisk, który
   * po kliknięciu nie robi niczego, wygląda na zepsutą stronę.
   */
  const exportFrom = async (container: HTMLElement | null, type: "png" | "svg"): Promise<void> => {
    const svg =
      container?.querySelector<SVGSVGElement>("[data-chart-canvas] svg") ??
      container?.querySelector<SVGSVGElement>(".neh-canvas svg") ??
      null;
    const figure = figureRef.current;
    if (svg === null || figure === null) {
      setExportError(true);
      return;
    }
    setExportError(false);
    try {
      const styl = getComputedStyle(figure);
      const background =
        styl.getPropertyValue("--card").trim() || styl.backgroundColor || "#ffffff";
      const fontFamily = getComputedStyle(svg).fontFamily || styl.fontFamily;
      const name = nazwaPliku(title, lang === "en" ? "chart" : "wykres");
      if (type === "svg") {
        pobierzPlik(`${name}.svg`, svgDoPliku(svg, { background, fontFamily }));
        return;
      }
      // KLUCZ DOKLEJONY DO PNG - podany przez rysunek albo z próbek legendy,
      // które czytelnik widzi (pozycje ukryte pomijamy, bo nie ma ich na
      // rysunku).
      const exportKey = meta?.exportKey;
      const klucz = exportKey
        ? kluczRysunku(figure, exportKey())
        : [...figure.querySelectorAll(".neh-legend > li")].flatMap((li) => {
            if (li.querySelector('[aria-pressed="false"]')) return [];
            const probka = li.querySelector(".neh-legend-swatch");
            const nazwa = probka?.nextElementSibling ?? null;
            if (probka === null || nazwa === null) return [];
            const tekst = getComputedStyle(nazwa).color;
            const tlo = getComputedStyle(probka).backgroundColor;
            return [
              {
                label: nazwa.textContent ?? "",
                color: tlo === "" || tlo === "rgba(0, 0, 0, 0)" ? tekst : tlo,
                textColor: tekst,
              },
            ];
          });
      pobierzPlik(`${name}.png`, await svgDoPng(svg, { background, scale: 2, klucz }));
    } catch {
      setExportError(true);
    }
  };

  const openExpanded = (): void => {
    const vh = typeof window !== "undefined" ? window.innerHeight : 900;
    setExpandedHeight(Math.round(Math.min(vh * 0.6, 560)));
  };

  const copyLink = async (url: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const legendList = legendVisible ? (
    <ul
      className="neh-legend"
      data-position={legendPosition}
      role="list"
      aria-label={t("legend.label")}
    >
      {legend.map((item) => {
        const swatch = (
          <>
            <span aria-hidden className="neh-legend-swatch" style={swatchStyle(item)} />
            <span style={{ color: item.textColor }}>{item.name}</span>
          </>
        );
        return (
          <li key={item.key}>
            {item.toggleable && onToggleLegend ? (
              <button
                type="button"
                className="neh-legend-item"
                aria-pressed={!hiddenLegend?.has(item.key)}
                title={t("legend.toggle", { name: item.name })}
                onClick={() => onToggleLegend(item.key)}
              >
                {swatch}
              </button>
            ) : (
              <span className="neh-legend-item" style={{ cursor: "default" }}>
                {swatch}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  ) : null;

  const readBox =
    notes.length > 0 ? (
      <aside className="neh-read" aria-label={t("panel.howToReadShort")}>
        <div className="neh-read-title">{t("panel.howToReadShort")}</div>
        <dl className="m-0">
          {notes.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </aside>
    ) : null;

  const sourceList =
    sources.length > 0 ? (
      <ol className="m-0 list-none p-0">
        {sources.map((source, i) => (
          <li key={source.id} className="mb-1.5">
            <span className="mr-1 font-semibold tabular-nums">[{footnoteNumber(source, i)}]</span>
            {chicagoBibliography(source, lang).map((part, pi) =>
              part.italic ? (
                <em key={pi}>{part.text}</em>
              ) : part.quoted ? (
                <q key={pi}>{part.text}</q>
              ) : (
                <Fragment key={pi}>{part.text}</Fragment>
              ),
            )}
          </li>
        ))}
      </ol>
    ) : (
      <p>{t("panel.noSources")}</p>
    );

  return (
    <figure
      ref={figureRef}
      aria-labelledby={title ? titleId : undefined}
      // `cn` (tailwind-merge), nie sklejanie: klasa wołającego WYGRYWA z domyślną
      // - podgląd w edytorze podaje `my-0` i bez scalenia dostawał oba marginesy,
      // a o wyniku decydowała kolejność reguł w arkuszu, nie intencja.
      className={cn("neh-chart not-prose", panel ? "my-6 border bg-card p-4" : "my-0", className)}
      style={
        panel
          ? { borderColor: "var(--chart-grid)", borderRadius: "var(--chart-radius)" }
          : { boxShadow: "none" }
      }
    >
      {showHead && (
        <figcaption className="neh-panel-head">
          <div className="min-w-0 flex-1">
            {title && (
              <div id={titleId} className="neh-panel-title">
                {title}
                {meta?.demo && <span className="neh-badge">{t("panel.demo")}</span>}
              </div>
            )}
            {(subtitle || sources.length > 0) && (
              <p className="neh-panel-sub m-0">
                {subtitle}
                {sources.map((source, i) => {
                  const n = footnoteNumber(source, i);
                  return (
                    <button
                      key={source.id}
                      type="button"
                      className="neh-fn"
                      aria-label={t("footnote.marker", { n })}
                      onClick={() => {
                        setCopied(false);
                        setFootnote({ source, n });
                      }}
                    >
                      {n}
                    </button>
                  );
                })}
              </p>
            )}
            {metric && (
              <div className="neh-panel-sub">
                <MetricTooltip metric={metric} lang={lang} />
              </div>
            )}
            {description && <p className="neh-panel-sub m-0">{description}</p>}
          </div>
          {panel && (
            <div className="neh-tools">
              <button
                type="button"
                className="neh-btn"
                aria-label={t("panel.info")}
                title={t("panel.howToRead")}
                onClick={() => setHelpOpen(true)}
              >
                <span aria-hidden className="font-serif italic">
                  i
                </span>
              </button>
              {renderExpanded && (
                <button
                  type="button"
                  className="neh-btn"
                  aria-label={t("panel.expand")}
                  title={t("panel.expand")}
                  onClick={openExpanded}
                >
                  <span aria-hidden>⤢</span>
                </button>
              )}
              {exportable && (
                <>
                  <button
                    type="button"
                    className="neh-btn"
                    aria-label={t("panel.exportPng")}
                    title={t("panel.exportPng")}
                    onClick={() => void exportFrom(plotRef.current, "png")}
                  >
                    {t("panel.png")}
                  </button>
                  <button
                    type="button"
                    className="neh-btn"
                    aria-label={t("panel.exportSvg")}
                    title={t("panel.exportSvg")}
                    onClick={() => void exportFrom(plotRef.current, "svg")}
                  >
                    {t("panel.svg")}
                  </button>
                </>
              )}
            </div>
          )}
        </figcaption>
      )}

      <div className="neh-panel-body" data-has-read={readBox ? "true" : undefined}>
        <div className="neh-plot-stack">
          {legendPosition === "top" && legendList}
          <div ref={plotRef} className="neh-chart-body min-w-0">
            {children}
          </div>
          {legendPosition === "bottom" && legendList}
        </div>
        {readBox}
      </div>

      {caption.caption && <p className="neh-caption">{caption.caption}</p>}

      {exportError && (
        <p role="status" className="mt-2 text-xs" style={{ color: "var(--chart-negative-text)" }}>
          {t("panel.exportFailed")}
        </p>
      )}

      {/* Ostrzeżenie o uciętej osi - ikona PLUS tekst. */}
      {caption.zeroBaselineBroken && (
        <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            <strong className="font-semibold">{t("caption.zeroBaselineWarning")}</strong>{" "}
            {t("caption.zeroBaselineWarningHint")}
          </span>
        </p>
      )}

      {caption.shareSumMismatch !== null && (
        <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{t("pie.shareSumFailed", { sum: caption.shareSumMismatch })}</span>
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 text-xs text-muted-foreground">
          {!showHead && caption.source && <p className="m-0">{caption.source}</p>}
          {facts.length > 0 && <p className="m-0 tabular-nums">{facts.join(" · ")}</p>}
        </div>
        <button
          type="button"
          data-chart-table-toggle
          className="inline-flex items-center gap-1.5 rounded-[var(--chart-radius)] px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-expanded={tableOpen}
          aria-controls={tableId}
          onClick={() => setTableOpen((v) => !v)}
        >
          <Table2 className="h-3.5 w-3.5" aria-hidden />
          {tableOpen ? t("frame.hideData") : t("frame.showData")}
        </button>
      </div>

      <div id={tableId} data-chart-table hidden={!tableOpen} className="mt-3 overflow-x-auto">
        <div className="sr-only">{t("frame.dataTable")}</div>
        {table}
      </div>

      {/* ===== Okna ===== */}
      {panel && (
        <ChartDialog
          open={helpOpen}
          onClose={() => setHelpOpen(false)}
          title={t("panel.howToRead")}
          closeLabel={t("panel.close")}
        >
          {/* `meta.help` - zdania GOTOWE od rysunku (np. kartogram) - mają
              pierwszeństwo przed ogólnymi zdaniami słownika. */}
          <h3>{t("read.elements")}</h3>
          <p>{meta?.help?.elements ?? t("read.elementsText")}</p>
          <h3>{t("read.colors")}</h3>
          <p>
            {meta?.help?.colours ??
              (meta?.palette === "categorical"
                ? t("read.colorsCategorical")
                : t("read.colorsFocus"))}
          </p>
          {(meta?.hasBand || meta?.hasTarget) && (
            <>
              <h3>{t("read.band")}</h3>
              <p>{t("read.bandText")}</p>
            </>
          )}
          <h3>{t("read.interactions")}</h3>
          <p>{meta?.help?.interactions ?? t("read.interactionsText")}</p>
          {meta?.zoomable && <p>{t("read.zoomText")}</p>}
          {exportable && (
            <>
              <h3>{t("read.export")}</h3>
              <p>{t("read.exportText")}</p>
            </>
          )}
          <h3>{t("read.sources")}</h3>
          {sourceList}
        </ChartDialog>
      )}

      {panel && renderExpanded && (
        <ChartDialog
          open={expandedHeight !== null}
          onClose={() => setExpandedHeight(null)}
          title={title || t("panel.expand")}
          closeLabel={t("panel.close")}
          size="wide"
        >
          <div className="neh-panel-body" data-has-read={readBox ? "true" : undefined}>
            <div ref={expandedRef} className="min-w-0">
              {expandedHeight !== null && renderExpanded(expandedHeight)}
            </div>
            {readBox}
          </div>
          <div className="neh-dialog-actions">
            <button
              type="button"
              className="neh-btn"
              onClick={() => void exportFrom(expandedRef.current, "png")}
            >
              {t("panel.exportPng")}
            </button>
            <button
              type="button"
              className="neh-btn"
              onClick={() => void exportFrom(expandedRef.current, "svg")}
            >
              {t("panel.exportSvg")}
            </button>
          </div>
        </ChartDialog>
      )}

      <ChartDialog
        open={footnote !== null}
        onClose={() => setFootnote(null)}
        title={footnote ? t("footnote.title", { n: footnote.n }) : ""}
        closeLabel={t("panel.close")}
      >
        {footnote && (
          <FootnoteBody
            source={footnote.source}
            lang={lang}
            t={t}
            copied={copied}
            onCopy={(url) => void copyLink(url)}
          />
        )}
      </ChartDialog>

      {dialogs}
    </figure>
  );
}

function FootnoteBody({
  source,
  lang,
  t,
  copied,
  onCopy,
}: {
  source: ChartSource;
  lang: ChartLang;
  t: (key: string, values?: Record<string, string | number>) => string;
  copied: boolean;
  onCopy: (url: string) => void;
}) {
  const url = safeSourceUrl(source.url);
  return (
    <>
      <p>
        {chicagoBibliography(source, lang).map((part, i) =>
          part.italic ? (
            <em key={i}>{part.text}</em>
          ) : part.quoted ? (
            <q key={i}>{part.text}</q>
          ) : (
            <Fragment key={i}>{part.text}</Fragment>
          ),
        )}
      </p>
      <dl className="neh-dialog-grid">
        {source.reliability !== null && (
          <>
            <dt>{t("reliability.label")}</dt>
            <dd>{t(RELIABILITY_KEYS[source.reliability])}</dd>
          </>
        )}
        {source.published && (
          <>
            <dt>{t("footnote.published")}</dt>
            <dd>{source.published}</dd>
          </>
        )}
        {source.accessed && (
          <>
            <dt>{t("footnote.accessed")}</dt>
            <dd>{source.accessed}</dd>
          </>
        )}
      </dl>
      {url !== null && (
        <div className="neh-dialog-actions">
          <a className="neh-btn" href={url} target="_blank" rel="noopener noreferrer">
            {t("footnote.open")}
          </a>
          <button type="button" className="neh-btn" onClick={() => onCopy(url)}>
            {copied ? t("footnote.copied") : t("footnote.copy")}
          </button>
        </div>
      )}
    </>
  );
}

/**
 * JEDEN KOMUNIKAT POD TABELĄ DANYCH: defekt danych albo obserwacja o rysunku.
 * `key` jest identyfikatorem Reacta i UCHWYTEM ZAPYTANIA (`data-note`).
 */
export interface ChartNote {
  key: string;
  text: string;
  /** `true` = defekt DANYCH (czerwień tekstowa), `false` = obserwacja o rysunku. */
  defect: boolean;
}

/** Lista komunikatów pod tabelą danych - wspólna dla rodzajów statystycznych. */
export function ChartNotes({ notes }: { notes: readonly ChartNote[] }) {
  if (notes.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1 text-xs">
      {notes.map((note) => (
        <li
          key={note.key}
          data-note={note.key}
          style={{
            color: note.defect ? "var(--chart-negative-text)" : "var(--muted-foreground)",
          }}
        >
          {note.text}
        </li>
      ))}
    </ul>
  );
}

/** Wspólne klasy komórek tabeli danych. */
export const CHART_TABLE_CLS = {
  table: "w-full border-collapse text-sm",
  th: "border-b border-border px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground",
  thNum:
    "border-b border-border px-3 py-1.5 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground",
  td: "border-b border-border/60 px-3 py-1.5 text-left text-foreground",
  tdNum: "border-b border-border/60 px-3 py-1.5 text-right tabular-nums text-foreground",
} as const;
