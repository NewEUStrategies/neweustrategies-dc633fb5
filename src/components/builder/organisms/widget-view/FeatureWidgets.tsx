// Renderery widgetów buildera dla modułu NES Digital Features. Cienkie
// adaptery: treść widgetu (pola i18n *_pl/_en + textarea w formacie ";") ->
// konfiguracja komponentów src/components/features. Jedna implementacja
// silnika, obie platformy (builder canvas + publiczna strona).
//
// Ładowane przez lazyWidgets.tsx (React.lazy), więc kod modułu features nie
// trafia do współdzielonego bundla Header/Footer.
import type { WidgetNode } from "@/lib/builder/types";
import type { FeatureLang } from "@/lib/features/types";
import {
  parseTimelineData,
  parseSankeyData,
  parseCompareData,
  parseRiskData,
  parseSparkData,
  parseNetworkEdges,
  parseNetworkGroups,
  parseCorridors,
  parseCorridorMarkers,
  parseCountryCodes,
  parseSourceEntries,
} from "@/lib/features/parse";
import { Timeline } from "@/components/features/Timeline";
import { SankeyDiagram } from "@/components/features/SankeyDiagram";
import { CountryCompare } from "@/components/features/CountryCompare";
import { RiskMatrix } from "@/components/features/RiskMatrix";
import { IndicatorCard } from "@/components/features/IndicatorCard";
import { RelationNetwork } from "@/components/features/RelationNetwork";
import { CorridorMap } from "@/components/features/CorridorMap";
import { SourceLibrary } from "@/components/features/SourceLibrary";
import { MethodologyNote } from "@/components/features/MethodologyNote";
import { getStr, getNum, type Lang } from "./frame";

interface WidgetProps {
  node: WidgetNode;
  lang: Lang;
}

/** Rozwiązanie pola i18n: `${base}_${lang}` -> `${base}_pl` -> `${base}_en`. */
function i18nStr(c: WidgetNode["content"], base: string, lang: FeatureLang): string {
  return getStr(c, `${base}_${lang}`) || getStr(c, `${base}_pl`) || getStr(c, `${base}_en`);
}

const on = (c: WidgetNode["content"], key: string, dflt = true): boolean => {
  const v = getStr(c, key);
  if (v === "") return dflt;
  return v !== "off" && v !== "0" && v !== "false";
};

const clampHeight = (v: number, min: number, max: number, dflt: number): number =>
  Number.isFinite(v) && v > 0 ? Math.max(min, Math.min(max, v)) : dflt;

function frame(c: WidgetNode["content"], lang: FeatureLang) {
  return {
    title: i18nStr(c, "title", lang),
    description: i18nStr(c, "description", lang),
    source: i18nStr(c, "source", lang),
  };
}

export function TimelineWidgetView({ node, lang }: WidgetProps) {
  const c = node.content;
  return (
    <Timeline
      lang={lang}
      className="my-0"
      config={{
        ...frame(c, lang),
        events: parseTimelineData(getStr(c, "data")),
        animate: on(c, "animate"),
      }}
    />
  );
}

export function SankeyWidgetView({ node, lang }: WidgetProps) {
  const c = node.content;
  return (
    <SankeyDiagram
      lang={lang}
      className="my-0"
      config={{
        ...frame(c, lang),
        flows: parseSankeyData(getStr(c, "data")),
        unit: getStr(c, "unit"),
        height: clampHeight(getNum(c, "height", 340), 160, 640, 340),
        animate: on(c, "animate"),
      }}
    />
  );
}

export function CompareWidgetView({ node, lang }: WidgetProps) {
  const c = node.content;
  const { columns, rows } = parseCompareData(getStr(c, "data"));
  const rawHighlight = getNum(c, "highlight", -1);
  const highlight = rawHighlight >= 0 && rawHighlight < columns.length ? rawHighlight : null;
  return (
    <CountryCompare
      lang={lang}
      className="my-0"
      config={{ ...frame(c, lang), columns, rows, highlight, showBars: on(c, "showBars") }}
    />
  );
}

export function RiskMatrixWidgetView({ node, lang }: WidgetProps) {
  const c = node.content;
  return (
    <RiskMatrix
      lang={lang}
      className="my-0"
      config={{
        ...frame(c, lang),
        items: parseRiskData(getStr(c, "data")),
        axisXLabel: i18nStr(c, "axisXLabel", lang),
        axisYLabel: i18nStr(c, "axisYLabel", lang),
        animate: on(c, "animate"),
      }}
    />
  );
}

export function IndicatorWidgetView({ node, lang }: WidgetProps) {
  const c = node.content;
  const arrow = getStr(c, "deltaArrow");
  const tone = getStr(c, "deltaTone");
  return (
    <IndicatorCard
      className="my-0"
      config={{
        label: i18nStr(c, "label", lang),
        value: getStr(c, "value"),
        unit: getStr(c, "unit"),
        delta: getStr(c, "delta"),
        deltaLabel: i18nStr(c, "deltaLabel", lang),
        deltaArrow: arrow === "up" || arrow === "down" ? arrow : "none",
        deltaTone: tone === "positive" || tone === "negative" ? tone : "neutral",
        spark: parseSparkData(getStr(c, "spark")),
        source: i18nStr(c, "source", lang),
        href: getStr(c, "href"),
      }}
    />
  );
}

export function NetworkWidgetView({ node, lang }: WidgetProps) {
  const c = node.content;
  return (
    <RelationNetwork
      lang={lang}
      className="my-0"
      config={{
        ...frame(c, lang),
        edges: parseNetworkEdges(getStr(c, "edges")),
        groups: parseNetworkGroups(getStr(c, "groups")),
        height: clampHeight(getNum(c, "height", 420), 240, 720, 420),
        animate: on(c, "animate"),
      }}
    />
  );
}

export function CorridorMapWidgetView({ node, lang }: WidgetProps) {
  const c = node.content;
  const region = getStr(c, "region") === "world" ? "world" : "europe";
  return (
    <CorridorMap
      lang={lang}
      className="my-0"
      config={{
        ...frame(c, lang),
        region,
        corridors: parseCorridors(getStr(c, "corridors")),
        markers: parseCorridorMarkers(getStr(c, "markers")),
        highlightCountries: parseCountryCodes(getStr(c, "highlightCountries")),
        animate: on(c, "animate"),
      }}
    />
  );
}

export function SourcesWidgetView({ node, lang }: WidgetProps) {
  const c = node.content;
  return (
    <SourceLibrary
      lang={lang}
      className="my-0"
      config={{
        ...frame(c, lang),
        entries: parseSourceEntries(getStr(c, "entries")),
        sort: getStr(c, "sort") === "year-desc" ? "year-desc" : "authored",
        showSearch: on(c, "showSearch"),
      }}
    />
  );
}

export function MethodologyWidgetView({ node, lang }: WidgetProps) {
  const c = node.content;
  return (
    <MethodologyNote
      lang={lang}
      className="my-0"
      config={{
        title: i18nStr(c, "title", lang),
        version: getStr(c, "version"),
        updated: getStr(c, "updated"),
        html: i18nStr(c, "html", lang),
        defaultOpen: on(c, "defaultOpen", false),
      }}
    />
  );
}
