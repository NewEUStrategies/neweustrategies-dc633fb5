// Admin edytory bloków wizualizacji danych: "chart" i "data-map".
// Arkusz danych (kategorie x serie) + ustawienia + PODGLĄD NA ŻYWO nad formą -
// autor widzi dokładnie ten sam render, który trafi na stronę publiczną
// (wspólny silnik src/components/charts).
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useBlocksI18n } from "@/lib/blocks/i18n";
import "@/lib/i18n-admin-blocks";
import type { Block, Json } from "@/lib/blocks/types";
// `toJson` zamiast `as unknown as Json` w miejscu użycia: podwójne
// rzutowanie omija kontrolę typów tak samo jak `as any`, tylko nie zapala
// reguły lintera - dlatego repo trzyma ten escape-hatch w JEDNYM
// audytowalnym miejscu, a bramka `check:unknown-casts` pilnuje, żeby nie
// rozsypał się po komponentach.
import { toJson } from "@/lib/content-model/json";
import { Plus, Trash2, TriangleAlert } from "lucide-react";
import { AdminSelect } from "../AdminSelect";
import {
  CHART_HEIGHT_MAX,
  CHART_HEIGHT_MIN,
  MAX_CATEGORIES,
  parseChartConfig,
  parseDataMapConfig,
  parseMapRegion,
} from "@/lib/charts/parse";
import {
  CATEGORICAL_SAFE_SERIES,
  MAP_REGIONS,
  mapRegionLabelKey,
  MAX_COLOR_SLOT,
  MAX_SERIES,
  PIE_MAX_SLICES,
  type ChartKind,
  type MapRegion,
} from "@/lib/charts/types";
import { pieModel } from "@/components/charts/pieModel";
import {
  isForecastMissingBand,
  pieFormAdvice,
  seriesOverSafePalette,
  PIE_CLOSE_SHARES_PP,
} from "@/lib/charts/honesty";
import { CHART_SLOTS, slotForSeries, SLOTS_CLASHING_WITH_SIGN } from "@/lib/charts/palette";
import { chartFormAdvice } from "@/lib/charts/formAdvice";
import {
  CHART_PALETTES,
  FOCUS_SERIES_MAX,
  isChartPalette,
  type ChartPalette,
} from "@/lib/charts/seriesStyle";
import {
  effectiveBand,
  isMetricDirection,
  METRIC_DIRECTIONS,
  type MetricDirection,
} from "@/lib/charts/status";
import {
  isProvenance,
  isReliability,
  MAX_CHART_SOURCES,
  PROVENANCES,
  RELIABILITIES,
  type Provenance,
  type Reliability,
} from "@/lib/charts/sources";
import type { ChartLang } from "@/lib/charts/format";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-charts";
import "@/lib/i18n-charts-editor";
import { geoAssetQueryOptions } from "@/lib/charts/geoQuery";
import { Chart } from "@/components/charts/Chart";
import { ChoroplethMap } from "@/components/charts/ChoroplethMap";
import { DataImportControl } from "@/components/admin/blocks/DataImportControl";
import { buildCountryIndex, tableToChartData, tableToMapValues } from "@/lib/charts/importTable";

interface Props {
  block: Block;
  onChange: (next: Block) => void;
}

const KIND_OPTIONS: ReadonlyArray<{ value: ChartKind; labelKey: string }> = [
  { value: "bar", labelKey: "kinds.bar" },
  { value: "bar-horizontal", labelKey: "kinds.barHorizontal" },
  { value: "line", labelKey: "kinds.line" },
  { value: "area", labelKey: "kinds.area" },
  { value: "pie", labelKey: "kinds.pie" },
  { value: "donut", labelKey: "kinds.donut" },
  // Wodospad jest narzędziem DOMYŚLNYM dla każdego pytania "od czego do
  // czego" - mostek EBITDA rok do roku, dekompozycja zmiany marży. Te same
  // dane słupkami obok siebie zmuszają czytelnika do dodawania w głowie.
  { value: "waterfall", labelKey: "kinds.waterfall" },
  // Histogram odpowiada na pytanie "jaki jest rozkład", a nie "ile jest".
  // Kolumna "Czego unikać" z tabeli doboru formy zabrania przy rozkładzie
  // średniej bez rozproszenia - stąd komplet pozycyjny w tabeli danych.
  { value: "histogram", labelKey: "kinds.histogram" },
  // Trzy formy na jedno pytanie o rozkład, bo różnią się tym, ILE ukrywają:
  // histogram grupuje w przedziały, boxplot podsumowuje pięcioma liczbami,
  // beeswarm nie ukrywa nic. Wybór między nimi zależy od liczby obserwacji
  // i model każdego z nich doradza autorowi, kiedy ta forma jest zła.
  { value: "boxplot", labelKey: "kinds.boxplot" },
  { value: "beeswarm", labelKey: "kinds.beeswarm" },
  // Punktowy czyta DWIE serie: pierwsza to os X, druga to os Y. Bez
  // drugiej serii model stawia na osi X pozycje w szeregu i sam to
  // zglasza, bo wtedy nie jest to wykres zaleznosci.
  { value: "scatter", labelKey: "kinds.scatter" },
  // Mapa ciepła czyta kategorie jako WIERSZE, a serie jako KOLUMNY, więc
  // ten sam blok danych, który daje słupki grupowane, daje macierz.
  { value: "heatmap", labelKey: "kinds.heatmap" },
  // Tornado czyta kategorie jako PARAMETRY, a dwie pierwsze serie jako
  // wyniki przy wartości niskiej i wysokiej. Wynik bazowy jest osobną
  // liczbą, nie kategorią - patrz `tornadoModelFromConfig`.
  { value: "tornado", labelKey: "kinds.tornado" },
  // CZTERY RODZAJE SEKCJI 1 DOŁOŻONE RAZEM, bo `chartKinds.test.ts` pyta
  // w obie strony: każdy rodzaj z `CHART_KINDS` musi tu być, a każda wartość
  // stąd musi być znanym rodzajem. Połowa podłączenia jest czerwona z obu
  // stron naraz.
  { value: "fan", labelKey: "kinds.fan" },
  { value: "index-base", labelKey: "kinds.indexBase" },
  { value: "percent-stacked", labelKey: "kinds.percentStacked" },
  { value: "small-multiples", labelKey: "kinds.smallMultiples" },
];

function Shell({ label, children }: { label: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-3 space-y-2 bg-muted/20">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      {children}
    </div>
  );
}

const inputCls = "w-full text-xs bg-background border border-border rounded px-2 py-2 h-9";
const areaCls =
  "w-full text-xs bg-background border border-border rounded px-2 py-2 min-h-[60px] resize-y";
const cellCls =
  "w-full min-w-[72px] text-xs bg-background border border-border rounded px-2 py-1.5 h-8 tabular-nums";

// ETYKIETY OPCJI SYSTEMU WYKRESÓW - klucze słownika JAWNIE, nie sklejane
// z wartości. `Record` po unii jest wyczerpujący: nowa paleta, kierunek,
// litera pochodzenia albo stopień wiarygodności dopisane w `src/lib/charts`
// bez etykiety tutaj NIE SKOMPILUJĄ SIĘ, zamiast wyjść w liście wyboru jako
// surowy klucz. Opcje idą z tablic źródłowych (`CHART_PALETTES` i in.), więc
// edytor nie może zaoferować wartości, której parser nie zna.
const PALETTE_LABEL_KEYS: Record<ChartPalette, string> = {
  focus: "palettes.focus",
  categorical: "palettes.categorical",
};

const DIRECTION_LABEL_KEYS: Record<MetricDirection, string> = {
  higher: "directions.higher",
  lower: "directions.lower",
  range: "directions.range",
};

const PROVENANCE_LABEL_KEYS: Record<Provenance, string> = {
  D: "provenances.D",
  W: "provenances.W",
  B: "provenances.B",
  E: "provenances.E",
  "?": "provenances.unknown",
};

const RELIABILITY_LABEL_KEYS: Record<Reliability, string> = {
  A: "reliabilities.A",
  B: "reliabilities.B",
  C: "reliabilities.C",
};

// ===== Chart =====

interface SeriesDraft {
  name: string;
  values: (number | null)[];
  colorSlot: number;
}

function readSeries(raw: Json | undefined, rows: number): SeriesDraft[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_SERIES).map((item, si) => {
    const o = (item ?? {}) as Record<string, Json>;
    const values = Array.isArray(o.values) ? o.values : [];
    return {
      name: String(o.name ?? ""),
      values: Array.from({ length: rows }, (_, i) => {
        const v = values[i];
        if (typeof v === "number" && Number.isFinite(v)) return v;
        if (typeof v === "string" && v.trim() !== "") {
          const n = Number(v.replace(",", "."));
          return Number.isFinite(n) ? n : null;
        }
        return null;
      }),
      colorSlot:
        typeof o.colorSlot === "number" && o.colorSlot >= 1 && o.colorSlot <= MAX_COLOR_SLOT
          ? Math.round(o.colorSlot)
          : slotForSeries(si),
    };
  });
}

function seriesToJson(series: SeriesDraft[]): Json[] {
  return series.map((s) => ({
    name: s.name,
    values: s.values.map((v) => (v === null ? null : v)),
    colorSlot: s.colorSlot,
  }));
}

// ---- Odniesienia: pasmo optimum, cel, źródła ----

function asRecord(raw: Json | undefined): Record<string, Json> {
  return raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
}

/**
 * Napis z treści do pola formy. Liczba wraca jako tekst, a obiekt i tablica
 * jako PUSTKA - `String()` wpisałby redaktorowi w pole „[object Object]",
 * które pierwsza edycja utrwaliłaby w dokumencie.
 */
function readText(raw: Json | undefined): string {
  if (typeof raw === "string") return raw;
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  return "";
}

/** Liczba z pola tekstowego: przecinek dziesiętny dozwolony, pustka i śmieć = brak. */
function parseDecimal(raw: string): number | null {
  const text = raw.trim().replace(",", ".");
  if (text === "") return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/** Ta sama koercja co `num` w `parseChartConfig` - pole pokazuje to, co narysuje wykres. */
function readDecimal(raw: Json | undefined): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string") return parseDecimal(raw);
  return null;
}

interface BandDraft {
  min: number | null;
  max: number | null;
  /** Identyfikator źródła z listy `sources`; "" = pasmo bez przypisu. */
  sourceId: string;
  demo: boolean;
}

function readBand(raw: Json | undefined): BandDraft {
  const o = asRecord(raw);
  return {
    min: readDecimal(o.min),
    max: readDecimal(o.max),
    sourceId: readText(o.sourceId).trim(),
    demo: o.demo === true,
  };
}

/**
 * Pasmo do zapisu. Pasmo bez krawędzi, bez źródła i bez flagi demo nie niesie
 * żadnej informacji, więc klucz ZNIKA z treści (`undefined` dla `write`),
 * zamiast zostawać pustym obiektem, który udaje ustawienie.
 */
function bandToJson(band: BandDraft): Json | undefined {
  if (band.min === null && band.max === null && band.sourceId === "" && !band.demo) {
    return undefined;
  }
  return { min: band.min, max: band.max, sourceId: band.sourceId, demo: band.demo };
}

/** Pola tekstowe źródła w kolejności opisu bibliograficznego (Chicago). */
const SOURCE_TEXT_FIELDS = [
  "author",
  "title",
  "container",
  "publisher",
  "published",
  "accessed",
  "url",
] as const;
type SourceTextField = (typeof SOURCE_TEXT_FIELDS)[number];

const SOURCE_FIELD_LABEL_KEYS: Record<SourceTextField, string> = {
  author: "sourceAuthor",
  title: "sourceTitle",
  container: "sourceContainer",
  publisher: "sourcePublisher",
  published: "sourcePublished",
  accessed: "sourceAccessed",
  url: "sourceUrl",
};

type SourceDraft = Record<SourceTextField, string> & {
  id: string;
  reliability: Reliability | "";
};

/**
 * Wiersze źródeł TAKIE, JAKIE SĄ w treści - także szkice bez tytułu i adresu,
 * które parser wykresu pomija. Autor musi widzieć wiersz, który właśnie
 * dodał, zanim wpisze w nim cokolwiek.
 */
function readSources(raw: Json | undefined): SourceDraft[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_CHART_SOURCES).map((item) => {
    const o = asRecord(item);
    return {
      id: readText(o.id).trim(),
      author: readText(o.author),
      title: readText(o.title),
      container: readText(o.container),
      publisher: readText(o.publisher),
      published: readText(o.published),
      accessed: readText(o.accessed),
      url: readText(o.url),
      reliability: isReliability(o.reliability) ? o.reliability : "",
    };
  });
}

function sourcesToJson(sources: SourceDraft[]): Json[] {
  return sources.map((s) => ({
    id: s.id,
    author: s.author,
    title: s.title,
    container: s.container,
    publisher: s.publisher,
    published: s.published,
    accessed: s.accessed,
    url: s.url,
    reliability: s.reliability === "" ? null : s.reliability,
  }));
}

/**
 * Identyfikator nowego źródła - JAWNY i stały. Bez niego parser nadaje
 * identyfikator pozycją, a ta zmienia się po usunięciu wiersza wyżej: pasmo
 * wskazywałoby wtedy cicho inne źródło niż to, które autor wybrał.
 */
function nextSourceId(sources: readonly SourceDraft[]): string {
  const used = new Set(sources.map((s) => s.id));
  let n = sources.length + 1;
  while (used.has(`s${n}`)) n += 1;
  return `s${n}`;
}

export function ChartBlock({ block, onChange }: Props) {
  const bt = useBlocksI18n();
  const categories = (Array.isArray(block.data.categories) ? block.data.categories : []).map((c) =>
    String(c ?? ""),
  );
  const series = readSeries(block.data.series, categories.length);
  const kind = String(block.data.variant ?? block.data.kind ?? "bar");
  const previewConfig = useMemo(() => parseChartConfig(block.data), [block.data]);
  // `keyPrefix` haka, nie sklejanie szablonem - inaczej bramka rozjazdu
  // kod<->słownik nie sprawdzi tych kluczy wcale.
  const { t: ct, i18n } = useTranslation("translation", { keyPrefix: "charts" });
  // Język do LICZB w zaleceniach formy (próg R², udział zasłoniętych punktów).
  // Treść zdania idzie przez `ct`, czyli w języku panelu, więc liczba
  // sformatowana innym językiem dawałaby angielskie zdanie z polskim
  // przecinkiem dziesiętnym.
  const lang: ChartLang = (i18n.language ?? "pl").startsWith("en") ? "en" : "pl";

  const patch = (data: Record<string, Json>) =>
    onChange({ ...block, data: { ...block.data, ...data } });

  const smoothing =
    typeof block.data.smoothing === "number"
      ? Math.max(0, Math.min(1, block.data.smoothing))
      : 0.55;

  const metricRaw = (block.data.metric ?? {}) as Record<string, Json>;
  const metric = {
    name: String(metricRaw.name ?? ""),
    expansion: String(metricRaw.expansion ?? ""),
    formula: String(metricRaw.formula ?? ""),
    measures: String(metricRaw.measures ?? ""),
    reading: String(metricRaw.reading ?? ""),
    levers: String(metricRaw.levers ?? ""),
    caution: String(metricRaw.caution ?? ""),
  };
  const patchMetric = (next: Partial<typeof metric>) =>
    patch({ metric: toJson({ ...metric, ...next }) });

  // Zapis z USUWANIEM: `undefined` znaczy „usuń klucz z treści", a nie
  // „zapisz undefined" - taki klucz ginąłby dopiero przy serializacji do
  // JSON-a, więc wyczyszczone ustawienie wracałoby po przeładowaniu strony.
  // Jedno wywołanie = jeden `onChange`: dwa kolejne `patch` z tego samego
  // renderu nadpisałyby się nawzajem, bo oba rozkładają ten sam `block.data`.
  const write = (changes: Record<string, Json | undefined>) =>
    onChange({
      ...block,
      data: Object.fromEntries(
        Object.entries({ ...block.data, ...changes }).filter(
          (entry): entry is [string, Json] => entry[1] !== undefined,
        ),
      ),
    });

  // ---- SYSTEM WYKRESÓW / ODNIESIENIA ----
  // Wartości spoza dziedziny (stara wersja edytora, ręczna edycja JSON-a)
  // wracają do tego, co narysuje parser: brak klucza palety to `focus`,
  // nieznany kierunek i pochodzenie to „brak".
  const palette: ChartPalette = isChartPalette(block.data.palette) ? block.data.palette : "focus";
  const direction = isMetricDirection(block.data.direction) ? block.data.direction : "";
  const provenance = isProvenance(block.data.provenance) ? block.data.provenance : "";
  const targetRaw = block.data.target;
  const target = readDecimal(
    typeof targetRaw === "number" || typeof targetRaw === "string"
      ? targetRaw
      : asRecord(targetRaw).value,
  );
  const band = readBand(block.data.band);
  const sources = readSources(block.data.sources);
  // Lista wyboru źródła pasma idzie z PARSERA, nie z wierszy formy: pasmo
  // wolno narysować tylko ze źródłem, które przeżyje parsowanie (ma tytuł
  // albo adres), więc autor nie może wskazać szkicu, który wykres pominie.
  const parsedSourceIds = previewConfig.sources.map((s) => s.id);
  const bandSourceDangling = band.sourceId !== "" && !parsedSourceIds.includes(band.sourceId);
  const bandWithoutSource =
    previewConfig.band !== null && effectiveBand(previewConfig.band, parsedSourceIds) === null;

  const patchBand = (next: Partial<BandDraft>) => write({ band: bandToJson({ ...band, ...next }) });
  const setSources = (next: SourceDraft[], extra: Record<string, Json | undefined> = {}) =>
    write({ sources: next.length > 0 ? sourcesToJson(next) : undefined, ...extra });

  // ---- OSTRZEŻENIA DYSCYPLINY ----
  // Reguły doboru formy i palety, których kod NIE MOŻE wymusić, bo mają
  // wyjątki - ale których milczenie kosztuje czytelność. Liczone z tego samego
  // configu, który idzie do podglądu, więc autor widzi ostrzeżenie obok
  // wykresu, którego ono dotyczy.
  const overSafePalette = seriesOverSafePalette(previewConfig, CATEGORICAL_SAFE_SERIES);
  const usedSlots = series.map((s) => s.colorSlot);
  const isPie = kind === "pie" || kind === "donut";
  const isWaterfall = kind === "waterfall";
  const sliceOverflow = isPie ? Math.max(0, categories.length - PIE_MAX_SLICES) : 0;
  // TRZY GRANICE PIERŚCIENIA, policzone z tego samego modelu, który rysuje
  // tarczę - inaczej ostrzeżenie mówiłoby o innym zestawie wycinków niż ten
  // w podglądzie obok. Udziały idą z modelu, bo mianownik (suma DODATNICH)
  // jest jego rozstrzygnięciem, a nie regułą uczciwości.
  const pieAdvice = useMemo(() => {
    if (!isPie) return [];
    // Język nie ma tu znaczenia: z modelu czytamy WYŁĄCZNIE liczby (udziały
    // i liczbę dodatnich), a tłumaczeniu podlega jedynie nazwa wycinka
    // zbiorczego, której to sprawdzenie nie dotyka.
    const model = pieModel(previewConfig, "pl");
    return pieFormAdvice(
      model.slices.map((s) => s.share),
      { positives: model.positives, maxSlices: PIE_MAX_SLICES },
    );
  }, [isPie, previewConfig]);
  // Terakota wypada z palety TYLKO na wykresie, który koduje znak czerwienią -
  // czyli na mostku. Na zwykłych kolumnach reguła nie obowiązuje i krzyczenie
  // o niej byłoby szumem.
  // ZALECENIA FORMY DLA AUTORA: „ten rodzaj jest tu złym wyborem, weź inny".
  // Do tego PR-a te zdania stały POD OPUBLIKOWANYM WYKRESEM, bo pisał je
  // render - czyli czytelnik dostawał instrukcję dla autora, której nie ma
  // jak wykonać. Teraz render pisze wyłącznie OBSERWACJĘ (`reading.*`),
  // a zalecenie (`advice.*`) trafia tutaj, obok pola, którym autor rodzaj
  // zmienia. Liczone z tego samego `previewConfig`, który idzie do podglądu.
  const formAdvice = useMemo(() => chartFormAdvice(previewConfig, lang), [previewConfig, lang]);
  const signClash =
    isWaterfall && usedSlots.some((slot) => SLOTS_CLASHING_WITH_SIGN.includes(slot));
  // OCHRA WOBEC AKCENTU NIE JEST TU OSTRZEŻENIEM, i to jest decyzja, nie
  // przeoczenie. Kolizja ochry z pomarańczowym akcentem marki (przy
  // deuteranopii dystans 1,6, czyli praktycznie ten sam kolor) jest FAKTEM
  // PALETY i pilnuje jej bramka `__tests__/palette.test.ts`. Autor nie ma
  // jednak żadnego pola, którym wprowadza akcent do wykresu: w silniku
  // `--chart-accent` występuje wyłącznie jako obwódka fokusu, czyli stan
  // przelotny i sterowany klawiaturą, nigdy jako kolor danych. Ostrzeżenie
  // odpalało się więc zawsze, gdy użyto slotu 2 - a slot 2 jest domyślnym
  // kolorem DRUGIEJ SERII, czyli komunikat wisiał nad niemal każdym wykresem
  // o dwóch seriach. Ostrzeżenie, które widać zawsze, uczy ignorowania
  // wszystkich ostrzeżeń, w tym tych o realnej kolizji znaku (`signClash`).

  const setCategories = (next: string[], nextSeries?: SeriesDraft[]) =>
    patch({
      categories: next,
      series: seriesToJson(nextSeries ?? series),
    });

  const setSeries = (next: SeriesDraft[]) => patch({ series: seriesToJson(next) });

  return (
    <Shell label={bt.editor("chart", "shellLabel")}>
      {/* Podgląd na żywo - dokładnie ten sam silnik, co strona publiczna. */}
      <div className="pointer-events-none">
        <Chart config={{ ...previewConfig, animate: false }} lang="pl" className="my-0" />
      </div>

      {overSafePalette > 0 && (
        <Warning text={ct("editor.tooManySeries", { max: CATEGORICAL_SAFE_SERIES })} />
      )}
      {sliceOverflow > 0 && <Warning text={ct("editor.tooManySlices", { max: PIE_MAX_SLICES })} />}
      {/* `tooMany` pokrywa się z `sliceOverflow` (oba mówią o przekroczeniu
          limitu wycinków), więc go nie powtarzamy - został w module
          uczciwości dla wywołujących bez własnego licznika kategorii. */}
      {pieAdvice.includes("tooFew") && <Warning text={ct("editor.pieTooFewSlices")} />}
      {pieAdvice.includes("tooClose") && (
        <Warning text={ct("editor.pieClosePercentages", { pp: PIE_CLOSE_SHARES_PP })} />
      )}
      {signClash && <Warning text={ct("editor.signClashesWithTerracotta")} />}
      {/* Klucz Reacta to NAZWA PORADY, nie indeks: lista zmienia się przy
          każdej edycji arkusza, a indeks kazałby Reactowi utrzymać stan
          ostrzeżenia, które zniknęło, na miejscu innego. */}
      {formAdvice.map((m) => (
        <Warning key={m.advice} text={ct(m.key, m.values)} />
      ))}

      <div className="grid grid-cols-2 gap-2">
        <AdminSelect
          className={inputCls}
          value={kind}
          onChange={(e) => patch({ kind: e.target.value, variant: e.target.value })}
        >
          {KIND_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {bt.editor("chart", o.labelKey)}
            </option>
          ))}
        </AdminSelect>
        <input
          className={inputCls}
          value={String(block.data.unit ?? "")}
          placeholder={bt.editor("chart", "unit")}
          onChange={(e) => patch({ unit: e.target.value })}
        />
      </div>

      <input
        className={inputCls}
        value={String(block.data.title ?? "")}
        placeholder={bt.editor("chart", "title")}
        onChange={(e) => patch({ title: e.target.value })}
      />
      <input
        className={inputCls}
        value={String(block.data.description ?? "")}
        placeholder={bt.editor("common", "subtitle")}
        onChange={(e) => patch({ description: e.target.value })}
      />

      {/* IMPORT Z PLIKU stoi NAD arkuszem, bo go NADPISUJE w całości.
          Pod spodem wyglądałby na „dopisz do tego, co jest" - a wczytanie
          pliku wymienia kategorie i serie, nie dokłada ich. */}
      <DataImportControl
        hint={bt.editor("dataImport", "hintChart")}
        onRows={(rows) => {
          const dane = tableToChartData(rows);
          patch({
            categories: dane.categories,
            series: seriesToJson(
              dane.series.map((s) => ({
                name: s.name,
                values: [...s.values],
                colorSlot: s.colorSlot,
              })),
            ),
          });
          return dane.problems;
        }}
      />

      {/* Arkusz danych: wiersz = kategoria, kolumny = serie. */}
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-1">
          <thead>
            <tr>
              <th className="text-left text-[10px] uppercase tracking-wide text-muted-foreground px-1">
                {bt.editor("chart", "category")}
              </th>
              {series.map((s, si) => (
                <th key={si} className="min-w-[96px] px-0">
                  <div className="flex items-center gap-1">
                    {/* WYBÓR KOLORU SERII, nie sama próbka. Paleta ma
                        `MAX_COLOR_SLOT` odcieni i bez tej kontrolki autor
                        dosięgałby wyłącznie tych, które silnik przydzieli sam.
                        Próbka zostaje - jest tłem kontrolki - więc autor widzi
                        kolor, zanim otworzy listę. Nazwy slotów mówią, co się
                        wybiera; przy odcieniach rozdzielnych dla daltonizmu
                        lista mówi to wprost, bo to jedyna informacja, której
                        nie da się odczytać z samego koloru. */}
                    <label className="relative h-4 w-4 shrink-0">
                      <span
                        aria-hidden
                        className="pointer-events-none absolute inset-0 rounded-[3px] border border-border"
                        style={{ background: `var(--chart-${s.colorSlot})` }}
                      />
                      <select
                        className="absolute inset-0 cursor-pointer opacity-0"
                        aria-label={bt.editor("chart", "seriesColor", {
                          name: s.name || String(si + 1),
                        })}
                        value={s.colorSlot}
                        onChange={(e) => {
                          const slot = Number(e.target.value);
                          setSeries(
                            series.map((x, i) => (i === si ? { ...x, colorSlot: slot } : x)),
                          );
                        }}
                      >
                        {CHART_SLOTS.map((slot) => (
                          <option key={slot.slot} value={slot.slot}>
                            {bt.editor(
                              "chart",
                              slot.cvdSafe ? "seriesColorSafe" : "seriesColorPlain",
                              { key: slot.key },
                            )}
                          </option>
                        ))}
                      </select>
                    </label>
                    <input
                      className={cellCls}
                      value={s.name}
                      placeholder={bt.editor("chart", "series", { n: si + 1 })}
                      onChange={(e) => {
                        const next = series.map((x, i) =>
                          i === si ? { ...x, name: e.target.value } : x,
                        );
                        setSeries(next);
                      }}
                    />
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-destructive"
                      aria-label={bt.editor("chart", "removeSeries", { name: s.name || si + 1 })}
                      onClick={() => setSeries(series.filter((_, i) => i !== si))}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </th>
              ))}
              <th className="w-8">
                {series.length < MAX_SERIES && (
                  <button
                    type="button"
                    className="inline-flex items-center justify-center w-7 h-7 rounded border border-border hover:border-foreground/50"
                    aria-label={bt.editor("chart", "addSeries")}
                    onClick={() =>
                      setSeries([
                        ...series,
                        {
                          name: "",
                          values: categories.map(() => null),
                          colorSlot: slotForSeries(series.length),
                        },
                      ])
                    }
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                )}
              </th>
            </tr>
          </thead>
          <tbody>
            {categories.map((cat, ci) => (
              <tr key={ci}>
                <td>
                  <input
                    className={cellCls}
                    value={cat}
                    placeholder={bt.editor("chart", "categoryN", { n: ci + 1 })}
                    onChange={(e) =>
                      setCategories(categories.map((c, i) => (i === ci ? e.target.value : c)))
                    }
                  />
                </td>
                {series.map((s, si) => (
                  <td key={si}>
                    <input
                      className={cellCls}
                      inputMode="decimal"
                      value={s.values[ci] === null ? "" : String(s.values[ci])}
                      placeholder="-"
                      onChange={(e) => {
                        const raw = e.target.value.trim().replace(",", ".");
                        const v = raw === "" ? null : Number(raw);
                        const next = series.map((x, i) =>
                          i === si
                            ? {
                                ...x,
                                values: x.values.map((old, vi) =>
                                  vi === ci ? (v === null || !Number.isFinite(v) ? null : v) : old,
                                ),
                              }
                            : x,
                        );
                        setSeries(next);
                      }}
                    />
                  </td>
                ))}
                <td>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-destructive"
                    aria-label={bt.editor("chart", "removeCategory", { name: cat || ci + 1 })}
                    onClick={() =>
                      setCategories(
                        categories.filter((_, i) => i !== ci),
                        series.map((s) => ({
                          ...s,
                          values: s.values.filter((_, i) => i !== ci),
                        })),
                      )
                    }
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* PALETA RÓL NIE CZYTA SLOTU SERII (do `FOCUS_SERIES_MAX` serii) -
          wybór koloru zostaje, bo działa po przełączeniu na paletę
          kategorialną, ale bez tego zdania autor zmieniałby kolor
          i nie widział żadnej zmiany w podglądzie. */}
      {palette === "focus" && series.length > 0 && (
        <p className="text-[10px] text-muted-foreground">
          {bt.editor("chart", "paletteFocusHint", { from: FOCUS_SERIES_MAX + 1 })}
        </p>
      )}
      {categories.length < MAX_CATEGORIES && (
        <button
          type="button"
          className="inline-flex items-center gap-1.5 text-xs px-2 py-1.5 rounded border border-border hover:border-foreground/50"
          onClick={() =>
            setCategories(
              [...categories, ""],
              series.map((s) => ({ ...s, values: [...s.values, null] })),
            )
          }
        >
          <Plus className="w-3.5 h-3.5" /> {bt.editor("chart", "addCategory")}
        </button>
      )}

      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={block.data.stacked === true}
            onChange={(e) => patch({ stacked: e.target.checked })}
          />
          {bt.editor("chart", "stacked")}
        </label>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={block.data.showLegend !== false}
            onChange={(e) => patch({ showLegend: e.target.checked })}
          />
          {bt.editor("common", "legend")}
        </label>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={block.data.showGrid !== false}
            onChange={(e) => patch({ showGrid: e.target.checked })}
          />
          {bt.editor("chart", "grid")}
        </label>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={block.data.showValues === true}
            onChange={(e) => patch({ showValues: e.target.checked })}
          />
          {bt.editor("chart", "showValues")}
        </label>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={block.data.animate !== false}
            onChange={(e) => patch({ animate: e.target.checked })}
          />
          {bt.editor("common", "animate")}
        </label>
      </div>

      <div className="grid grid-cols-[1fr_auto] gap-2 items-center">
        <input
          type="range"
          min={CHART_HEIGHT_MIN}
          max={CHART_HEIGHT_MAX}
          step={10}
          value={Number(block.data.height ?? 320)}
          onChange={(e) => patch({ height: Number(e.target.value) })}
          aria-label={bt.editor("chart", "height")}
        />
        <span className="text-xs tabular-nums text-muted-foreground w-14 text-right">
          {Number(block.data.height ?? 320)}px
        </span>
      </div>
      {/* ---- PODPIS UCZCIWOŚCIOWY ----
          Jednostka, źródło, DATA DANYCH, `n` i trzy zdania. Cztery z tych pól
          autor pominąłby, gdyby ich nie było w formie - a wykres bez nich
          wygląda dokładnie tak samo i znaczy co innego. */}
      <FieldGroup label={bt.editor("chart", "honestyLabel")}>
        <input
          className={inputCls}
          value={String(block.data.source ?? "")}
          placeholder={bt.editor("chart", "source")}
          onChange={(e) => patch({ source: e.target.value })}
        />
        <div className="grid grid-cols-2 gap-2">
          <input
            className={inputCls}
            value={String(block.data.sourceDate ?? "")}
            placeholder={bt.editor("chart", "sourceDate")}
            onChange={(e) => patch({ sourceDate: e.target.value })}
          />
          <input
            className={inputCls}
            inputMode="numeric"
            value={block.data.sampleSize == null ? "" : String(block.data.sampleSize)}
            placeholder={bt.editor("chart", "sampleSize")}
            onChange={(e) => {
              const raw = e.target.value.trim();
              patch({ sampleSize: raw === "" ? null : Number(raw) });
            }}
          />
        </div>
        <input
          className={inputCls}
          value={String(block.data.notesShows ?? "")}
          placeholder={bt.editor("chart", "notesShows")}
          onChange={(e) => patch({ notesShows: e.target.value })}
        />
        <input
          className={inputCls}
          value={String(block.data.notesSurprising ?? "")}
          placeholder={bt.editor("chart", "notesSurprising")}
          onChange={(e) => patch({ notesSurprising: e.target.value })}
        />
        <input
          className={inputCls}
          value={String(block.data.notesHidden ?? "")}
          placeholder={bt.editor("chart", "notesHidden")}
          onChange={(e) => patch({ notesHidden: e.target.value })}
        />
        {!String(block.data.notesHidden ?? "").trim() && (
          <Warning text={ct("editor.missingNotes")} />
        )}
      </FieldGroup>

      {/* ---- SYSTEM WYKRESÓW / ODNIESIENIA (specyfikacja 2026-10) ----
          Paleta, kierunek wskaźnika, pochodzenie liczb, cel, pasmo optimum
          i jego źródło. Pasmo jest TWIERDZENIEM („norma to 2-4%"), więc
          bez źródła z listy niżej albo flagi demo silnik go nie narysuje -
          ostrzeżenie mówi to autorowi tutaj, a nie dopiero czytelnikowi. */}
      <FieldGroup label={bt.editor("chart", "referenceLabel")}>
        <div className="grid grid-cols-2 gap-2">
          <AdminSelect
            className={inputCls}
            value={palette}
            onChange={(e) => patch({ palette: e.target.value })}
            aria-label={bt.editor("chart", "palette")}
          >
            {CHART_PALETTES.map((p) => (
              <option key={p} value={p}>
                {bt.editor("chart", PALETTE_LABEL_KEYS[p])}
              </option>
            ))}
          </AdminSelect>
          <AdminSelect
            className={inputCls}
            value={direction}
            onChange={(e) => write({ direction: e.target.value || undefined })}
            aria-label={bt.editor("chart", "direction")}
          >
            <option value="">{bt.editor("chart", "directions.none")}</option>
            {METRIC_DIRECTIONS.map((d) => (
              <option key={d} value={d}>
                {bt.editor("chart", DIRECTION_LABEL_KEYS[d])}
              </option>
            ))}
          </AdminSelect>
          <AdminSelect
            className={inputCls}
            value={provenance}
            onChange={(e) => write({ provenance: e.target.value || undefined })}
            aria-label={bt.editor("chart", "provenance")}
          >
            <option value="">{bt.editor("chart", "provenances.none")}</option>
            {PROVENANCES.map((p) => (
              <option key={p} value={p}>
                {bt.editor("chart", PROVENANCE_LABEL_KEYS[p])}
              </option>
            ))}
          </AdminSelect>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={block.data.demo === true}
              onChange={(e) => patch({ demo: e.target.checked })}
            />
            {bt.editor("chart", "demo")}
          </label>
        </div>
        <textarea
          className={areaCls}
          rows={2}
          value={readText(block.data.caption)}
          placeholder={bt.editor("chart", "caption")}
          aria-label={bt.editor("chart", "caption")}
          onChange={(e) => patch({ caption: e.target.value })}
        />
        {/* Cel: `{ value }` albo BRAK klucza - pusty obiekt celu nie jest
            stanem, który parser umie odróżnić od „cel = nic". */}
        <DecimalInput
          value={target}
          placeholder={bt.editor("chart", "target")}
          onCommit={(v) => write({ target: v === null ? undefined : { value: v } })}
        />
        <div className="grid grid-cols-2 gap-2">
          <DecimalInput
            value={band.min}
            placeholder={bt.editor("chart", "bandMin")}
            onCommit={(v) => patchBand({ min: v })}
          />
          <DecimalInput
            value={band.max}
            placeholder={bt.editor("chart", "bandMax")}
            onCommit={(v) => patchBand({ max: v })}
          />
        </div>
        <div className="grid grid-cols-[1fr_auto] gap-2 items-center">
          <AdminSelect
            className={inputCls}
            value={band.sourceId}
            onChange={(e) => patchBand({ sourceId: e.target.value })}
            aria-label={bt.editor("chart", "bandSource")}
          >
            <option value="">{bt.editor("chart", "bandSourceNone")}</option>
            {previewConfig.sources.map((s) => (
              <option key={s.id} value={s.id}>
                {[s.author, s.title || s.url].filter(Boolean).join(" - ")}
              </option>
            ))}
            {/* Identyfikator wskazujący w próżnię ZOSTAJE na liście (jak kod
                kraju spoza zasobu w edytorze mapy) - inaczej lista pokazałaby
                „bez źródła", a zapis przy pierwszej zmianie zgubiłby wskazanie
                bez słowa. */}
            {bandSourceDangling && (
              <option value={band.sourceId}>
                {bt.editor("chart", "bandSourceMissing", { id: band.sourceId })}
              </option>
            )}
          </AdminSelect>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={band.demo}
              onChange={(e) => patchBand({ demo: e.target.checked })}
            />
            {bt.editor("chart", "bandDemo")}
          </label>
        </div>
        {bandWithoutSource && <Warning text={bt.editor("chart", "bandWithoutSource")} />}

        {/* ŹRÓDŁA - przypisy w stylu chicagowskim. Pola w kolejności opisu
            bibliograficznego, żeby autor wypełniał je tak, jak się je czyta. */}
        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground pt-1">
          {bt.editor("chart", "sourcesLabel")}
        </div>
        <p className="text-[10px] text-muted-foreground">{bt.editor("chart", "sourcesHint")}</p>
        {sources.map((s, si) => (
          <div key={si} className="space-y-1.5 rounded border border-border/60 p-2">
            <div className="flex items-center gap-2">
              <span className="flex-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {bt.editor("chart", "sourceN", { n: si + 1 })}
              </span>
              <button
                type="button"
                className="text-muted-foreground hover:text-destructive"
                aria-label={bt.editor("chart", "removeSource", {
                  name: s.title || s.author || si + 1,
                })}
                onClick={() =>
                  // Usunięcie źródła, na które wskazuje pasmo, zdejmuje też
                  // wskazanie - w tym samym zapisie, żeby pasmo nie zostało
                  // z identyfikatorem prowadzącym donikąd.
                  setSources(
                    sources.filter((_, i) => i !== si),
                    s.id !== "" && s.id === band.sourceId
                      ? { band: bandToJson({ ...band, sourceId: "" }) }
                      : {},
                  )
                }
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {SOURCE_TEXT_FIELDS.map((field) => (
                <input
                  key={field}
                  className={inputCls}
                  inputMode={field === "url" ? "url" : undefined}
                  value={s[field]}
                  placeholder={bt.editor("chart", SOURCE_FIELD_LABEL_KEYS[field])}
                  aria-label={bt.editor("chart", SOURCE_FIELD_LABEL_KEYS[field])}
                  onChange={(e) =>
                    setSources(
                      sources.map((x, i) => (i === si ? { ...x, [field]: e.target.value } : x)),
                    )
                  }
                />
              ))}
              <AdminSelect
                className={inputCls}
                value={s.reliability}
                onChange={(e) => {
                  const next = e.target.value;
                  setSources(
                    sources.map((x, i) =>
                      i === si ? { ...x, reliability: isReliability(next) ? next : "" } : x,
                    ),
                  );
                }}
                aria-label={bt.editor("chart", "sourceReliability")}
              >
                <option value="">{bt.editor("chart", "reliabilities.none")}</option>
                {RELIABILITIES.map((r) => (
                  <option key={r} value={r}>
                    {bt.editor("chart", RELIABILITY_LABEL_KEYS[r])}
                  </option>
                ))}
              </AdminSelect>
            </div>
          </div>
        ))}
        {sources.length < MAX_CHART_SOURCES && (
          <button
            type="button"
            className="inline-flex items-center gap-1.5 text-xs px-2 py-1.5 rounded border border-border hover:border-foreground/50"
            onClick={() =>
              setSources([
                ...sources,
                {
                  id: nextSourceId(sources),
                  author: "",
                  title: "",
                  container: "",
                  publisher: "",
                  published: "",
                  accessed: "",
                  url: "",
                  reliability: "",
                },
              ])
            }
          >
            <Plus className="w-3.5 h-3.5" /> {bt.editor("chart", "addSource")}
          </button>
        )}
      </FieldGroup>

      {/* ---- KSZTAŁT I PROGNOZA ---- */}
      <FieldGroup label={bt.editor("chart", "shapeLabel")}>
        <div className="grid grid-cols-[1fr_auto] gap-2 items-center">
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={Math.round(smoothing * 100)}
            onChange={(e) => patch({ smoothing: Number(e.target.value) / 100 })}
            aria-label={bt.editor("chart", "smoothing")}
          />
          <span className="text-xs tabular-nums text-muted-foreground w-14 text-right">
            {Math.round(smoothing * 100)}%
          </span>
        </div>
        <p className="text-[10px] text-muted-foreground">{bt.editor("chart", "smoothingHint")}</p>
        <div className="grid grid-cols-2 gap-2">
          {/* NUMER KATEGORII, NIE INDEKS - i dlatego to pole przelicza w obie
              strony. Etykieta mówi redaktorowi „od kategorii numer", a ludzie
              liczą kategorie od jednej: pierwsza to 1. Silnik trzyma tę samą
              wartość jako INDEKS liczony od zera (`forecastFrom` wchodzi do
              `i >= forecastFrom` i do `catCenter(forecastFrom)`), więc bez
              przeliczenia redaktor wpisujący 2 dostawał prognozę od TRZECIEJ
              kategorii - o jedną za daleko, cicho i na każdym wykresie.
              Zamiana strony zapisu na liczenie od jednej byłaby gorsza:
              przeniosłaby korektę o jeden do silnika, czyli do kodu, który
              indeksuje tablice. */}
          <input
            className={inputCls}
            inputMode="numeric"
            value={
              typeof block.data.forecastFrom === "number" ? String(block.data.forecastFrom + 1) : ""
            }
            placeholder={bt.editor("chart", "forecastFrom")}
            onChange={(e) => {
              const raw = e.target.value.trim();
              const numer = Number(raw);
              patch({
                forecastFrom: raw === "" || !Number.isFinite(numer) ? null : Math.round(numer) - 1,
              });
            }}
          />
          <input
            className={inputCls}
            inputMode="numeric"
            value={block.data.forecastBandPct == null ? "" : String(block.data.forecastBandPct)}
            placeholder={bt.editor("chart", "forecastBandPct")}
            onChange={(e) => {
              const raw = e.target.value.trim();
              patch({ forecastBandPct: raw === "" ? 0 : Number(raw) });
            }}
          />
        </div>
        <p className="text-[10px] text-muted-foreground">
          {bt.editor("chart", "forecastFromHint")}
        </p>
        {isForecastMissingBand(previewConfig) && (
          <Warning text={ct("editor.forecastWithoutBand")} />
        )}
      </FieldGroup>

      {/* ---- WYJAŚNIENIE WSKAŹNIKA ----
          Tooltip o STAŁYCH pięciu polach. Pozostałe pola pokazują się dopiero
          po podaniu skrótu, bo bez nazwy nie ma czego zaczepić ikony. */}
      <FieldGroup label={bt.editor("chart", "metricLabel")}>
        <input
          className={inputCls}
          value={metric.name}
          placeholder={bt.editor("chart", "metricName")}
          onChange={(e) => patchMetric({ name: e.target.value })}
        />
        {metric.name.trim() !== "" && (
          <>
            <input
              className={inputCls}
              value={metric.expansion}
              placeholder={bt.editor("chart", "metricExpansion")}
              onChange={(e) => patchMetric({ expansion: e.target.value })}
            />
            <input
              className={inputCls}
              value={metric.formula}
              placeholder={bt.editor("chart", "metricFormula")}
              onChange={(e) => patchMetric({ formula: e.target.value })}
            />
            <input
              className={inputCls}
              value={metric.measures}
              placeholder={bt.editor("chart", "metricMeasures")}
              onChange={(e) => patchMetric({ measures: e.target.value })}
            />
            <input
              className={inputCls}
              value={metric.reading}
              placeholder={bt.editor("chart", "metricReading")}
              onChange={(e) => patchMetric({ reading: e.target.value })}
            />
            <input
              className={inputCls}
              value={metric.levers}
              placeholder={bt.editor("chart", "metricLevers")}
              onChange={(e) => patchMetric({ levers: e.target.value })}
            />
            <input
              className={inputCls}
              value={metric.caution}
              placeholder={bt.editor("chart", "metricCaution")}
              onChange={(e) => patchMetric({ caution: e.target.value })}
            />
          </>
        )}
      </FieldGroup>
    </Shell>
  );
}

/**
 * Pole liczby z WŁASNYM SZKICEM tekstu. Zapis idzie liczbą (kontrakt
 * `parseChartConfig`: `{ value: number }`, krawędzie pasma), ale pole
 * sterowane samą liczbą zjadałoby znaki w trakcie pisania: po „2," pokazałoby
 * z powrotem „2" i ułamka nie dałoby się wpisać. Wpis niebędący liczbą
 * zapisuje BRAK, bo tyle właśnie narysuje wykres - podgląd nad formą nie może
 * pokazywać starej liczby pod polem, w którym stoi co innego.
 *
 * Szkic ustępuje wartości z treści tylko wtedy, gdy ta zmieniła się z zewnątrz
 * (cofnięcie, wklejenie bloku) i mówi już co innego niż szkic - wzorzec
 * „poprzednia wartość w stanie", bez efektu i bez podwójnego renderu.
 */
function DecimalInput({
  value,
  placeholder,
  onCommit,
}: {
  value: number | null;
  placeholder: string;
  onCommit: (next: number | null) => void;
}) {
  const [draft, setDraft] = useState(value === null ? "" : String(value));
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    if (parseDecimal(draft) !== value) setDraft(value === null ? "" : String(value));
  }
  return (
    <input
      className={inputCls}
      inputMode="decimal"
      value={draft}
      placeholder={placeholder}
      aria-label={placeholder}
      onChange={(e) => {
        setDraft(e.target.value);
        onCommit(parseDecimal(e.target.value));
      }}
    />
  );
}

/** Sekcja formy z podpisem - grupuje pola, których autor inaczej nie znajdzie. */
function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5 rounded-md border border-border/60 p-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      {children}
    </div>
  );
}

/**
 * Ostrzeżenie dyscypliny. NIE BLOKUJE zapisu - mówi, co się psuje, i zostawia
 * decyzję autorowi. Blokada byłaby tu gorsza: reguły doboru formy mają
 * wyjątki, których kod nie zna, a zablokowany autor obchodzi walidację
 * zamiast czytać powód.
 */
function Warning({ text }: { text: string }) {
  return (
    <p
      className="flex items-start gap-1.5 text-[11px] leading-snug"
      style={{ color: "var(--chart-negative-text)" }}
    >
      <TriangleAlert className="mt-px h-3 w-3 shrink-0" aria-hidden />
      <span>{text}</span>
    </p>
  );
}

// ===== Data map =====

interface MapRowDraft {
  id: string;
  value: number | null;
}

function readMapValues(raw: Json | undefined): MapRowDraft[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const o = (item ?? {}) as Record<string, Json>;
    const v = o.value;
    return {
      id: String(o.id ?? "").toUpperCase(),
      value: typeof v === "number" && Number.isFinite(v) ? v : null,
    };
  });
}

export function DataMapBlock({ block, onChange }: Props) {
  const bt = useBlocksI18n();
  // Region idzie przez parser bloku, a nie przez porównanie z dwoma literałami:
  // ta sama droga, co w renderze publicznym, więc podgląd nad formą pokazuje
  // DOKŁADNIE to, co zobaczy czytelnik - także wtedy, gdy w treści siedzi
  // region z nowszej wersji edytora.
  const region: MapRegion = parseMapRegion(block.data.region);
  const rows = readMapValues(block.data.values);
  const previewConfig = useMemo(() => parseDataMapConfig(block.data), [block.data]);

  // Lista krajów z tego samego statycznego zasobu, który rysuje mapę -
  // zero dodatkowych danych w bundlu, opcje zawsze zgodne z geometrią.
  const geo = useQuery(geoAssetQueryOptions(region));
  const countryOptions = useMemo(
    () =>
      (geo.data?.countries ?? [])
        .map((c) => ({ id: c.id, label: `${c.pl} (${c.id})` }))
        .sort((a, b) => a.label.localeCompare(b.label, "pl")),
    [geo.data],
  );

  const patch = (data: Record<string, Json>) =>
    onChange({ ...block, data: { ...block.data, ...data } });

  const setRows = (next: MapRowDraft[]) =>
    patch({ values: next.map((r) => ({ id: r.id, value: r.value })) });

  return (
    <Shell label={bt.editor("dataMap", "shellLabel")}>
      <div className="pointer-events-none">
        <ChoroplethMap config={{ ...previewConfig, animate: false }} lang="pl" className="my-0" />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <AdminSelect
          className={inputCls}
          value={region}
          onChange={(e) => patch({ region: e.target.value })}
        >
          {/* Opcje WYPROWADZONE ze źródła regionów - wcześniej stały tu dwa
              ręcznie wpisane `<option>`, więc dołożenie regionu wymagało
              dotknięcia edytora i było o jedno przeoczenie od regionu, którego
              autor nie mógł wybrać, choć silnik już go umiał narysować. */}
          {MAP_REGIONS.map((r) => (
            <option key={r} value={r}>
              {bt.editor("dataMap", mapRegionLabelKey(r))}
            </option>
          ))}
        </AdminSelect>
        <input
          className={inputCls}
          value={String(block.data.unit ?? "")}
          placeholder={bt.editor("dataMap", "unit")}
          onChange={(e) => patch({ unit: e.target.value })}
        />
      </div>
      <input
        className={inputCls}
        value={String(block.data.title ?? "")}
        placeholder={bt.editor("dataMap", "title")}
        onChange={(e) => patch({ title: e.target.value })}
      />
      <input
        className={inputCls}
        value={String(block.data.description ?? "")}
        placeholder={bt.editor("common", "subtitle")}
        onChange={(e) => patch({ description: e.target.value })}
      />

      {/* Skorowidz nazw powstaje z TEGO SAMEGO zasobu, który rysuje mapę,
          więc kraj spoza wybranego regionu wyjdzie jako nierozpoznany
          zamiast wejść do danych i nigdy się nie narysować. */}
      <DataImportControl
        hint={bt.editor("dataImport", "hintMap")}
        onRows={(rowsIn) => {
          const wynik = tableToMapValues(rowsIn, buildCountryIndex(geo.data?.countries ?? []));
          patch({ values: wynik.values.map((v) => ({ id: v.id, value: v.value })) });
          return wynik.problems;
        }}
      />

      <div className="space-y-1.5">
        {rows.map((row, ri) => (
          <div key={ri} className="flex items-center gap-2">
            <AdminSelect
              className={`${inputCls} flex-1`}
              value={row.id}
              onChange={(e) =>
                setRows(rows.map((r, i) => (i === ri ? { ...r, id: e.target.value } : r)))
              }
            >
              <option value="">{bt.editor("dataMap", "selectCountry")}</option>
              {countryOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
              {/* Zachowaj kod spoza listy (np. zanim zasób się wczyta). */}
              {row.id && !countryOptions.some((o) => o.id === row.id) && (
                <option value={row.id}>{row.id}</option>
              )}
            </AdminSelect>
            <input
              className={`${cellCls} w-28`}
              inputMode="decimal"
              value={row.value === null ? "" : String(row.value)}
              placeholder={bt.editor("dataMap", "value")}
              onChange={(e) => {
                const raw = e.target.value.trim().replace(",", ".");
                const v = raw === "" ? null : Number(raw);
                setRows(
                  rows.map((r, i) =>
                    i === ri ? { ...r, value: v === null || !Number.isFinite(v) ? null : v } : r,
                  ),
                );
              }}
            />
            <button
              type="button"
              className="text-muted-foreground hover:text-destructive"
              aria-label={bt.editor("dataMap", "removeRow", { name: row.id || ri + 1 })}
              onClick={() => setRows(rows.filter((_, i) => i !== ri))}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        <button
          type="button"
          className="inline-flex items-center gap-1.5 text-xs px-2 py-1.5 rounded border border-border hover:border-foreground/50"
          onClick={() => setRows([...rows, { id: "", value: null }])}
        >
          <Plus className="w-3.5 h-3.5" /> {bt.editor("dataMap", "addCountry")}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={block.data.showLegend !== false}
            onChange={(e) => patch({ showLegend: e.target.checked })}
          />
          {bt.editor("common", "legend")}
        </label>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={block.data.animate !== false}
            onChange={(e) => patch({ animate: e.target.checked })}
          />
          {bt.editor("common", "animate")}
        </label>
      </div>
      <input
        className={inputCls}
        value={String(block.data.source ?? "")}
        placeholder={bt.editor("dataMap", "source")}
        onChange={(e) => patch({ source: e.target.value })}
      />
    </Shell>
  );
}
