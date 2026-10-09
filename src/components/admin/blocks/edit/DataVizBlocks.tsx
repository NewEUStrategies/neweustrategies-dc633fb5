// Admin edytory bloków wizualizacji danych: "chart" i "data-map".
// Arkusz danych (kategorie x serie) + ustawienia + PODGLĄD NA ŻYWO nad formą -
// autor widzi dokładnie ten sam render, który trafi na stronę publiczną
// (wspólny silnik src/components/charts).
//
// Edytor mapy żyje w `DataMapBlock.tsx`, a pomocniki formy i edytory
// odniesień wspólne dla obu bloków (źródła, pochodzenie liczb, podpis, data
// danych, `n`, trzy zdania) w `dataVizShared.tsx`. Ten plik re-eksportuje
// `DataMapBlock`, więc dyspozytor i testy importują oba edytory stąd.
//
// ARKUSZ DANYCH (PR2) to wspólna siatka `ChartDataGrid` z
// `src/components/admin/charts` - ta sama, którą ma arkusz widgetu buildera:
// komórki ze szkicem liczby, klawiatura arkusza, wklejenie zakresu z Excela,
// Arkuszy Google albo LibreOffice od komórki kotwicy, menu wiersza i kolumny,
// kolory serii z próbnikiem i seria wyróżniona. Ten edytor tylko przekłada
// jej stan na treść bloku (`readBlockGrid` / `blockGridChanges`) - JEDNYM
// zapisem, więc jedno działanie w arkuszu to jeden krok cofania.
import { useMemo, useRef } from "react";
import { useBlocksI18n } from "@/lib/blocks/i18n";
import "@/lib/i18n-admin-blocks";
import type { Block, Json } from "@/lib/blocks/types";
// `toJson` zamiast `as unknown as Json` w miejscu użycia: podwójne
// rzutowanie omija kontrolę typów tak samo jak `as any`, tylko nie zapala
// reguły lintera - dlatego repo trzyma ten escape-hatch w JEDNYM
// audytowalnym miejscu, a bramka `check:unknown-casts` pilnuje, żeby nie
// rozsypał się po komponentach.
import { toJson } from "@/lib/content-model/json";
import { AdminSelect } from "../AdminSelect";
import { useBlockEditorLang } from "../BlockEditorContext";
import { CHART_HEIGHT_MAX, CHART_HEIGHT_MIN, parseChartConfig } from "@/lib/charts/parse";
import { CATEGORICAL_SAFE_SERIES, PIE_MAX_SLICES, type ChartKind } from "@/lib/charts/types";
import { pieModel } from "@/components/charts/pieModel";
import {
  isForecastMissingBand,
  pieFormAdvice,
  seriesOverSafePalette,
  PIE_CLOSE_SHARES_PP,
} from "@/lib/charts/honesty";
import { SLOTS_CLASHING_WITH_SIGN } from "@/lib/charts/palette";
import { chartFormAdvice } from "@/lib/charts/formAdvice";
import { KIND_CAPS } from "@/lib/charts/kindCaps";
import { CHART_PALETTES, isChartPalette, type ChartPalette } from "@/lib/charts/seriesStyle";
import {
  effectiveBand,
  isMetricDirection,
  METRIC_DIRECTIONS,
  type MetricDirection,
} from "@/lib/charts/status";
import type { ChartLang } from "@/lib/charts/format";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-charts";
import "@/lib/i18n-charts-editor";
import { Chart } from "@/components/charts/Chart";
import { DataImportControl } from "@/components/admin/blocks/DataImportControl";
import { tableToChartData } from "@/lib/charts/importTable";
import { ChartDataGrid, type ChartDataGridHandle } from "@/components/admin/charts/ChartDataGrid";
import {
  blockGridChanges,
  gridReplace,
  readBlockGrid,
} from "@/components/admin/charts/chartGridState";
import { useBlockTablePaste } from "@/components/admin/charts/blockTablePaste";
import {
  asRecord,
  CaptionField,
  DecimalInput,
  DemoCheckbox,
  FieldGroup,
  inputCls,
  NotesFields,
  ProvenanceSelect,
  readDecimal,
  readText,
  Shell,
  SourceDateSampleFields,
  SourcesEditor,
  Warning,
} from "./dataVizShared";

export { DataMapBlock } from "./DataMapBlock";

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

// ETYKIETY OPCJI SYSTEMU WYKRESÓW - klucze słownika JAWNIE, nie sklejane
// z wartości. `Record` po unii jest wyczerpujący: nowa paleta albo kierunek
// dopisane w `src/lib/charts` bez etykiety tutaj NIE SKOMPILUJĄ SIĘ, zamiast
// wyjść w liście wyboru jako surowy klucz. Opcje idą z tablic źródłowych
// (`CHART_PALETTES` i in.), więc edytor nie może zaoferować wartości, której
// parser nie zna. Etykiety pochodzenia i wiarygodności żyją przy swoich
// edytorach w `dataVizShared.tsx`.
const PALETTE_LABEL_KEYS: Record<ChartPalette, string> = {
  focus: "palettes.focus",
  categorical: "palettes.categorical",
};

const DIRECTION_LABEL_KEYS: Record<MetricDirection, string> = {
  higher: "directions.higher",
  lower: "directions.lower",
  range: "directions.range",
};

// ===== Chart =====

// ---- Odniesienia: pasmo optimum, cel, źródła ----

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

export function ChartBlock({ block, onChange }: Props) {
  const bt = useBlocksI18n();
  // Stan arkusza (dane, kolory serii, oba wskaźniki akcentu) czyta jeden
  // adapter - ta sama koercja wartości co dotąd, a wskaźnik spoza zakresu
  // pokazuje się tak, jak narysuje go parser.
  const grid = useMemo(() => readBlockGrid(block.data), [block.data]);
  const categories = grid.model.categories;
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
  // Język DOKUMENTU (karta PL/EN edytora wpisu), nie panelu: wpis polski
  // edytowany w angielskim panelu ma podgląd z polskim zapisem liczb i serie
  // dokładane w arkuszu jako „Seria C", a nie „Series C".
  const docLang = useBlockEditorLang();
  const gridRef = useRef<ChartDataGridHandle>(null);

  // TABELA WKLEJONA NA KANWIE przy zaznaczonym bloku trafia tutaj, a nie do
  // nowego bloku tabeli pod wykresem - i przechodzi przez ten sam podgląd
  // układu co wklejka całej tabeli w siatkę.
  useBlockTablePaste(block.id, (table) =>
    gridRef.current?.openTablePreview(
      table.rows,
      table.truncated ? [{ code: "pasteTruncated" }] : [],
      "paste",
    ),
  );

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
  // nieznany kierunek i pochodzenie to „brak" (pochodzenie czyta
  // `ProvenanceSelect` ze wspólnego modułu).
  const palette: ChartPalette = isChartPalette(block.data.palette) ? block.data.palette : "focus";
  const direction = isMetricDirection(block.data.direction) ? block.data.direction : "";
  const targetRaw = block.data.target;
  const target = readDecimal(
    typeof targetRaw === "number" || typeof targetRaw === "string"
      ? targetRaw
      : asRecord(targetRaw).value,
  );
  const band = readBand(block.data.band);
  // Lista wyboru źródła pasma idzie z PARSERA, nie z wierszy formy: pasmo
  // wolno narysować tylko ze źródłem, które przeżyje parsowanie (ma tytuł
  // albo adres), więc autor nie może wskazać szkicu, który wykres pominie.
  const parsedSourceIds = previewConfig.sources.map((s) => s.id);
  const bandSourceDangling = band.sourceId !== "" && !parsedSourceIds.includes(band.sourceId);
  const bandWithoutSource =
    previewConfig.band !== null && effectiveBand(previewConfig.band, parsedSourceIds) === null;

  const patchBand = (next: Partial<BandDraft>) => write({ band: bandToJson({ ...band, ...next }) });

  // ---- OSTRZEŻENIA DYSCYPLINY ----
  // Reguły doboru formy i palety, których kod NIE MOŻE wymusić, bo mają
  // wyjątki - ale których milczenie kosztuje czytelność. Liczone z tego samego
  // configu, który idzie do podglądu, więc autor widzi ostrzeżenie obok
  // wykresu, którego ono dotyczy.
  const overSafePalette = seriesOverSafePalette(previewConfig, CATEGORICAL_SAFE_SERIES);
  const usedSlots = grid.model.series.map((s) => s.colorSlot);
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
  // PALETY i pilnuje jej bramka `__tests__/palette.test.ts`. Od PR2 próbnik
  // koloru serii w ogóle nie oferuje rodziny pomarańczu i żółci
  // (`PICKER_SLOTS`), więc nowa seria nie dostanie ochry z ręki autora,
  // a slot zapisany wcześniej widać w próbniku jako „spoza palety wyboru".
  // Ostrzeżenie, które widać zawsze, uczy ignorowania wszystkich ostrzeżeń,
  // w tym tych o realnej kolizji znaku (`signClash`).

  // Wybór palety stoi przy arkuszu, bo to on zmienia próbki serii - ale tylko
  // dla rodzajów, w których paleta coś zmienia na rysunku (`KIND_CAPS`).
  const paletteMatters = KIND_CAPS[previewConfig.kind].palette;

  return (
    <Shell label={bt.editor("chart", "shellLabel")}>
      {/* Podgląd na żywo - dokładnie ten sam silnik, co strona publiczna,
          w języku dokumentu i z działającym najechaniem (tooltip, legenda). */}
      <Chart config={{ ...previewConfig, animate: false }} lang={docLang} className="my-0" />

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
          pliku wymienia kategorie i serie, nie dokłada ich. Przed zapisem
          pokazuje podgląd układu (nagłówek, obrót, format liczb), a kolory
          i wyróżnienie idą za nazwą serii (`gridReplace`). */}
      <DataImportControl
        hint={bt.editor("dataImport", "hintChart")}
        preview="chart"
        onRows={(rows, layout) => {
          const dane = tableToChartData(
            rows,
            layout === undefined
              ? undefined
              : { header: layout.header, transpose: layout.transpose, locale: layout.locale },
          );
          write(blockGridChanges(gridReplace(grid, dane)));
          return dane.problems;
        }}
      />

      {paletteMatters && (
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
      )}

      {/* Arkusz danych: wiersz = kategoria, kolumny = serie. */}
      <ChartDataGrid
        ref={gridRef}
        value={grid}
        onChange={(next) => write(blockGridChanges(next))}
        kind={previewConfig.kind}
        palette={palette}
        docLang={docLang}
      />

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
        <SourceDateSampleFields data={block.data} write={write} />
        <NotesFields data={block.data} write={write} />
      </FieldGroup>

      {/* ---- SYSTEM WYKRESÓW / ODNIESIENIA (specyfikacja 2026-10) ----
          Kierunek wskaźnika, pochodzenie liczb, cel, pasmo optimum i jego
          źródło (paleta stoi przy arkuszu, bo zmienia próbki serii). Pasmo
          jest TWIERDZENIEM („norma to 2-4%"), więc bez źródła z listy niżej
          albo flagi demo silnik go nie narysuje - ostrzeżenie mówi to
          autorowi tutaj, a nie dopiero czytelnikowi. */}
      <FieldGroup label={bt.editor("chart", "referenceLabel")}>
        <div className="grid grid-cols-2 gap-2">
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
          <ProvenanceSelect data={block.data} write={write} />
          <DemoCheckbox data={block.data} write={write} />
        </div>
        <CaptionField data={block.data} write={write} />
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
            bibliograficznego, żeby autor wypełniał je tak, jak się je czyta.
            Usunięcie źródła, na które wskazuje pasmo, zdejmuje też
            wskazanie - w tym samym zapisie, żeby pasmo nie zostało
            z identyfikatorem prowadzącym donikąd. */}
        <SourcesEditor
          data={block.data}
          write={write}
          removeExtra={(removed) =>
            removed.id !== "" && removed.id === band.sourceId
              ? { band: bandToJson({ ...band, sourceId: "" }) }
              : {}
          }
        />
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
