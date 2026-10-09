// Wykres kołowy / pierścieniowy (donut).
//
// ŁUK NIE MA ZAOKRĄGLENIA NA ŻADNYM KOŃCU, 0 px z obu stron. W słupku jeden
// koniec jest krawędzią odniesienia (zero albo poziom skumulowany), a drugi
// końcem danych - dlatego jeden jest kwadratowy, a drugi zaokrąglony.
// W pierścieniu OBA końce łuku są granicami MIĘDZY KATEGORIAMI, czyli oba są
// krawędziami odniesienia. Zaokrąglenie któregokolwiek przesuwa granicę
// i zaniża udział. To ta sama reguła co przy podstawie słupka, tylko
// zastosowana dwa razy.
//
// ROZDZIELA JE PRZERWA KĄTOWA 2,5 px (`ARC_GAP_PX`), w kolorze płyty, bo
// przez przerwę widać kartę (`var(--card)`, także w eksporcie, który kładzie
// pod rysunek tło płyty). To jest GEOMETRIA, nie obrys: ta sama w obu
// motywach - obrys brałby grubość z tokena, który w ciemnym motywie jest
// cieńszy (`--chart-bar-edge`), czyli przełączenie motywu przesuwałoby
// granice wycinków. Przerwa niesie też granicę w skali szarości, gdzie same
// odcienie nie wystarczają.
//
// WYPEŁNIENIE PEŁNE (decyzja właściciela, PR2), jak słupek: kolor wycinka bez
// bladego wnętrza. Paleta ról (domyślna) maluje wycinek wyróżniony akcentem,
// a pozostałe stopniami neutralnymi; paleta kategorialna - slotami
// `SLOT_SEQUENCE` (patrz `pieModel`). Akcent ma na bieli 2,25:1, więc wycinek
// w akcencie dostaje DRUGI NOŚNIK: obwódkę 1 px w `--chart-accent-audit-
// graphic`, tej samej grubości w obu motywach.
//
// TABELA POD WYKRESEM, NIE LEGENDA Z PRÓBKAMI. Legenda podaje wyłącznie parę
// kolor-nazwa, więc czytelnik musi wykonać trzy skoki wzroku (łuk, próbka,
// nazwa) i wciąż nie dostaje liczby. Tabela stawia w jednym wierszu próbkę,
// nazwę, udział i wartość bezwzględną, w tej samej kolejności co łuki - czyli
// odczyt jednej kategorii jest jednym skokiem. Próbka w tabeli ma kolor łuku
// i jego obwódkę.
//
// Interakcja: hover/focus zmienia POWIERZCHNIĘ (wypełnienie),
// a NIGDY nie wysuwa łuku na zewnątrz - przesunięcie promieniowe zmienia
// długość łuku przy zewnętrznej krawędzi i zawyża udział, czyli robi dokładnie
// to, czego zabrania zasada o niezmiennym kodowaniu.
import { useCallback, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ChartConfig } from "@/lib/charts/types";
import { formatChartValue, formatPercent, type ChartLang } from "@/lib/charts/format";
import { estimateLabelWidth } from "@/lib/charts/measureText";
import { ARC_GAP_PX, ARC_LABEL_PAD } from "@/lib/charts/geometry";
import { useContainerWidth } from "@/hooks/useContainerWidth";
import { useTapAwayDismiss } from "@/hooks/useTapAwayDismiss";
import { useRevealOnScroll, revealClassName } from "@/hooks/useRevealOnScroll";
import { ROLE } from "@/lib/charts/roles";
import { ChartTooltip } from "./ChartTooltip";
import { sourceLine } from "./chartFacts";
import { FOCUS_MIX } from "./kindPaint";
import { pieModel, type PieSlice } from "./pieModel";
import { isSelectKey, type ChartSelectHandler } from "@/lib/charts/selection";
import "@/lib/i18n-charts";

/**
 * Obwódka wycinka: drugi nośnik akcentu na wycinku wyróżnionym, a na
 * pozostałych - brak. Kolor przez token, grubość przez arkusz (jedna w obu
 * motywach).
 */
function sliceEdge(slice: PieSlice): string {
  return slice.accent && slice.color === ROLE.acc ? ROLE.accFocus : "none";
}

/**
 * Tusz liczby wpisanej w łuk. Paleta kategorialna: tusz SLOTU, dobrany
 * kontrastem do nasyconego wypełnienia (>= 4,5:1). Paleta ról: stopnie
 * neutralne idą od łupka głównego do łupka drugiego i w okolicy 70-80%
 * rampy ani tusz płyty, ani tusz główny nie mają 4,5:1 (lepszy z nich
 * ~4,2:1, w obu motywach), więc żaden pojedynczy tusz nie przechodzi progu na
 * całej rampie - liczba idzie tuszem głównym z OBWÓDKĄ w kolorze płyty
 * (`data-halo`), czyli kontrast liczy się między literą a jej obwódką, nie
 * między literą a wycinkiem.
 */
function sliceInk(slice: PieSlice): { fill: string; halo: boolean } {
  return slice.color === `var(--chart-${slice.colorSlot})`
    ? { fill: `var(--chart-ink-${slice.colorSlot})`, halo: false }
    : { fill: ROLE.ink, halo: true };
}

/**
 * Kolejność malowania liczby w łuku z obwódką płyty - także ATRYBUTEM
 * PREZENTACYJNYM, nie tylko z arkusza (tak jak w mapie cieplnej). Kolor
 * i grubość obwódki (3 px, ta sama w obu motywach) niesie arkusz, a eksport
 * wkleja je ze stylu obliczonego; `paint-order` w atrybucie jest asekuracją
 * na wypadek, gdyby przeglądarka nie oddała go w stylu obliczonym - bez niego
 * plik wraca do kolejności domyślnej (obwódka NA literze) i cyfry giną pod
 * plamą w kolorze płyty.
 */
function haloProps(halo: boolean) {
  return halo ? { "data-halo": "true", paintOrder: "stroke" } : {};
}

interface PieChartProps {
  config: ChartConfig;
  lang: ChartLang;
  /**
   * Wskazanie oddane na zewnątrz - kliknięciem w wycinek albo Enterem na
   * wycinku, który ma fokus.
   *
   * `categoryIndex` jest tu indeksem WYCINKA, a nie kategorii z arkusza, i to
   * jest różnica z treścią: model tarczy zwija ogon rozkładu w jeden wycinek
   * zbiorczy, więc wycinków bywa mniej niż kategorii. Panel dostaje to, co
   * czytelnik naprawdę wskazał - łuk, który widzi.
   */
  onSelect?: ChartSelectHandler;
  /**
   * Nazwa dostępna rysunku PODANA Z ZEWNĄTRZ - patrz `CartesianChart`.
   */
  ariaLabel?: string;
}

function polar(cx: number, cy: number, r: number, angle: number): [number, number] {
  return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
}

function slicePath(
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number,
  a0: number,
  a1: number,
): string {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const [x0, y0] = polar(cx, cy, rOuter, a0);
  const [x1, y1] = polar(cx, cy, rOuter, a1);
  if (rInner <= 0) {
    return `M${cx} ${cy} L${x0} ${y0} A${rOuter} ${rOuter} 0 ${large} 1 ${x1} ${y1} Z`;
  }
  const [x2, y2] = polar(cx, cy, rInner, a1);
  const [x3, y3] = polar(cx, cy, rInner, a0);
  return `M${x0} ${y0} A${rOuter} ${rOuter} 0 ${large} 1 ${x1} ${y1} L${x2} ${y2} A${rInner} ${rInner} 0 ${large} 0 ${x3} ${y3} Z`;
}

export function PieChart({ config, lang, onSelect, ariaLabel }: PieChartProps) {
  const { ref: widthRef, width } = useContainerWidth<HTMLDivElement>(720);
  const { ref: revealRef, state: revealState } = useRevealOnScroll<HTMLDivElement>(config.animate, {
    onMount: true,
  });
  const [active, setActive] = useState<number | null>(null);
  const hintId = useId();
  // Owijka CAŁEGO układu (pierścień plus tabela klucza): tapnięcie w tabelę
  // nie może zdejmować wskazania z łuku, bo to jeden element interfejsu
  // rozłożony na dwie części.
  const rootRef = useRef<HTMLDivElement>(null);
  const clearActive = useCallback(() => setActive(null), []);
  useTapAwayDismiss(active !== null, rootRef, clearActive);
  // Prefiks przez `keyPrefix` haka - tylko taki widzi bramka rozjazdu
  // kod<->słownik; klucz sklejony template literalem wypada z kontroli
  // parytetu PL/EN.
  const { t: scoped } = useTranslation("translation", { keyPrefix: "charts" });
  const t = (key: string, values?: Record<string, string | number>): string =>
    scoped(key, { lng: lang, ...values });

  const donut = config.kind === "donut";
  // Wysokość jest USTAWIENIEM autora (schemat: 160..640 px), nie sugestią -
  // wcześniejsze ciche przycięcie do 420 px sprawiało, że suwak wysokości
  // powyżej tej wartości nic nie robił. Średnicę i tak ogranicza szerokość
  // kontenera (rOuter poniżej), więc wyższa karta = więcej powietrza wokół.
  const height = config.height;

  // useMemo dla stałej tożsamości tablicy wycinków - hover renderuje przy
  // każdym ruchu wskaźnika, a config w tych renderach jest ten sam.
  const { slices, total } = useMemo(() => pieModel(config, lang), [config, lang]);

  if (slices.length === 0) return null;

  const cx = width / 2;
  const cy = height / 2;
  const rOuter = Math.max(40, Math.min(width, height) / 2 - 12);
  const rInner = donut ? rOuter * 0.62 : 0;
  // PRZERWA 2,5 px LICZONA NA OSI PIERŚCIENIA, czyli w promieniu środkowym -
  // nie stały kąt. Stały kąt dawałby przy pierścieniu wąskim przerwę
  // niewidoczną, a przy szerokim rozjeżdżającą się szczelinę; przerwa
  // wyrażona w pikselach jest tą samą przerwą w każdej geometrii.
  const rMid = (rOuter + rInner) / 2;
  const gap = ARC_GAP_PX / 2 / rMid;
  const activeSlice = active !== null ? slices[active] : null;
  // JEDEN NADAWCA na kliknięcie i na klawisz: gdyby każda droga składała
  // ładunek u siebie, panel dostawałby przy klawiaturze inny kształt niż przy
  // myszy - a to jest dokładnie ta klasa różnicy, której nikt nie testuje.
  const wskaz = (i: number): void => {
    const s = slices[i];
    if (s === undefined || !onSelect) return;
    onSelect({
      kind: config.kind,
      categoryIndex: i,
      category: s.label,
      seriesIndex: config.series.length === 1 ? 0 : null,
      seriesName: config.series.length === 1 ? config.series[0].name : null,
      value: s.value,
    });
  };
  // Nazwa stanu PLUS jednostka, sklejone tym samym separatorem, którym rama
  // wykresu skleja fakty podpisu. Jednostki w tym silniku zaczynają się od
  // spacji (format wartości dokleja je bez separatora), więc do podpisu idzie
  // wersja obcięta.
  const unitCaption = config.unit.trim();
  const stateCaption = activeSlice ? activeSlice.label : t("frame.total");
  const centreCaption = unitCaption ? `${stateCaption} · ${unitCaption}` : stateCaption;
  const tooltipAnchor: [number, number] = activeSlice
    ? polar(cx, cy, (rOuter + rInner) / 2, (activeSlice.startAngle + activeSlice.endAngle) / 2)
    : [0, 0];

  return (
    <div ref={revealRef} className={revealClassName(revealState)}>
      {/* TABELA KLUCZA ZAWSZE POD pierścieniem. Dzięki temu w wąskich kartach
          dashboardu nie zabiera tarczy połowy szerokości: SVG dostaje pełny
          środek karty, a klucz pozostaje czytelny poniżej. `min-w-0` i `w-full`
          chronią oba elementy przed wypchnięciem karty przez dłuższą nazwę. */}
      <div ref={rootRef} className="flex min-w-0 flex-col items-center gap-4">
        <div
          ref={widthRef}
          // CEL EKSPORTU ramy (`[data-chart-canvas] svg`). Bez niego przyciski
          // PNG i SVG nad tarczą nie miały czego zapisać.
          data-chart-canvas
          className="relative w-full min-w-0 select-none"
          style={{ height, borderRadius: "var(--chart-radius)" }}
          // group (nie img): wycinki w środku są fokusowalne - rola img
          // czyniłaby je prezentacyjnymi dla czytników ekranu.
          role="group"
          aria-label={
            ariaLabel ??
            (config.title ? t("a11y.chart", { title: config.title }) : t("a11y.chartUntitled"))
          }
          aria-describedby={hintId}
          // ESCAPE CZYŚCI WSKAZANIE, i to nie jest ozdoba: wskazanie ustawia
          // się tu FOKUSEM (`onFocus` na wycinku), a fokus na klawiaturze
          // zostaje tam, gdzie go zostawiono. Bez Escape czytelnik, który
          // dojechał Tabem do wycinka, nie miał ŻADNEGO sposobu zdjęcia
          // dymka poza tapnięciem w tło - czyli akcji wskaźnikowej, której
          // na klawiaturze nie ma. Zdejmujemy sam stan, nie fokus: odebranie
          // fokusu wyrzuciłoby czytelnika na początek strony.
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              clearActive();
            } else if (isSelectKey(e.key) && active !== null && onSelect) {
              // Wycinek jest elementem fokusowalnym, więc Enter przychodzi
              // tutaj z ustawionym `active` - tym samym indeksem, który
              // ustawił fokus. Bez tego wybór istniałby wyłącznie myszą.
              e.preventDefault();
              wskaz(active);
            }
          }}
        >
          {/* Wskazówka WŁASNA dla tarczy: wycinki są osobnymi elementami
              fokusowalnymi, więc przechodzi się między nimi Tabem, a nie
              strzałkami. Wspólny `a11y.keyboardHint` mówiłby o strzałkach,
              które tu nic nie robią. */}
          <span id={hintId} className="sr-only">
            {t("a11y.keyboardHintSlices")}
          </span>
          <svg width={width} height={height} className="block">
            <g className="neh-pie-group">
              {slices.map((s, i) => {
                // Przerwa odejmowana z KAŻDEJ strony, ale nigdy tak, żeby
                // wycinek zniknął: przy udziale mniejszym od samej przerwy
                // zostawiamy szczelinę proporcjonalną, bo wycinek, który zniknął,
                // kłamie o strukturze bardziej niż wycinek zbyt wąski.
                const span = s.endAngle - s.startAngle;
                const inset = Math.min(gap, span / 4);
                return (
                  <path
                    key={i}
                    d={slicePath(cx, cy, rOuter, rInner, s.startAngle + inset, s.endAngle - inset)}
                    // Wypełnienie PEŁNE w kolorze wycinka (`pieModel`). Grubość
                    // obwódki niesie arkusz - jedna w obu motywach - bo `var()`
                    // w atrybutach prezentacyjnych SVG nie jest wspierane
                    // wszędzie.
                    fill={s.color}
                    stroke={sliceEdge(s)}
                    // MITER, nie round: oba końce łuku są granicami między
                    // kategoriami, a zaokrąglenie któregokolwiek przesuwa
                    // granicę i zaniża udział.
                    strokeLinejoin="miter"
                    data-active={active === i ? "true" : undefined}
                    data-accent={s.accent ? "true" : undefined}
                    style={{
                      ["--neh-arc-hover" as string]: `color-mix(in oklab, ${s.color} ${FOCUS_MIX.hover}%, var(--card))`,
                      ["--neh-arc-token" as string]: s.color,
                    }}
                    tabIndex={0}
                    role="img"
                    aria-label={t("a11y.slice", {
                      label: s.label,
                      value: formatChartValue(s.value, lang, config.unit),
                      share: formatPercent(s.share, lang),
                    })}
                    onClick={() => wskaz(i)}
                    className="neh-slice cursor-pointer"
                    // UCHWYT ZAPYTANIA zgodnie z konwencją repozytorium
                    // (`chartClasses.test.ts`): nowy uchwyt idzie na
                    // `data-role`, nie na klasę bez reguły. Tarcza była
                    // ostatnim renderem bez ani jednego uchwytu, więc testy
                    // rozróżniały ją po klasie `neh-slice`, czyli po
                    // WYGLĄDZIE - a wygląd wolno zmienić bez zmiany znaczenia.
                    data-role="slice"
                    // DOTYK: wejście wskaźnika ustawia stan (na dotyku
                    // `pointerenter` przychodzi przy dotknięciu), ale zjazd
                    // zdejmuje go wszędzie POZA dotykiem - tam `pointerleave`
                    // leci natychmiast po podniesieniu palca i gasił tooltip
                    // w tej samej chwili, w której się pojawił. Tapnięcie poza
                    // wykresem zdejmuje stan przez `useTapAwayDismiss`.
                    //
                    // Warunek na DOTYKU, nie na myszy: wyjątkiem jest dotyk,
                    // więc jego trzeba nazwać. Rysik ma hover jak mysz,
                    // a środowisko, które w ogóle nie podaje rodzaju
                    // wskaźnika, ma przy tym warunku zachowanie mysie, czyli
                    // to samo, co miało przed tą zmianą.
                    onPointerEnter={() => setActive(i)}
                    onPointerLeave={(e) => {
                      if (e.pointerType !== "touch") setActive(null);
                    }}
                    onFocus={() => setActive(i)}
                    onBlur={() => setActive(null)}
                  />
                );
              })}
              {/* Etykiety %: tylko wycinki >=8% - wewnątrz wypełnienia. Gdy autor
                włączy "Etykiety wartości", pod udziałem ląduje sama wartość
                (druga linia), więc przełącznik działa tak samo jak w wykresach
                kartezjańskich - wcześniej był dla koła cichym no-opem. */}
              {slices.map((s, i) => {
                // PRÓG Z GEOMETRII, nie stała procentowa. Etykieta musi się
                // zmieścić w łuku, a to zależy od grubości pierścienia i od
                // promienia - te same 8% przy pierścieniu grubym 38 px mieszczą
                // napis, a przy cienkim nie. Liczymy więc dostępną długość łuku
                // w promieniu środkowym i porównujemy z szerokością napisu
                // oszacowaną tą samą heurystyką, co marginesy osi.
                const arcLength = (s.endAngle - s.startAngle - 2 * gap) * rMid;
                const label = formatPercent(s.share, lang);
                if (arcLength < estimateLabelWidth(label, 12) + ARC_LABEL_PAD) return null;
                const mid = (s.startAngle + s.endAngle) / 2;
                const rLabel = donut ? rMid : rOuter * 0.66;
                const [lx, ly] = polar(cx, cy, rLabel, mid);
                const dy = config.showValues ? -2 : 4;
                // Liczba leży na PEŁNYM wypełnieniu, więc tusz idzie
                // z wycinka (`sliceInk`), nie z tekstu strony.
                const ink = sliceInk(s);
                return (
                  <g key={`t${i}`} pointerEvents="none">
                    <text
                      x={lx}
                      y={ly + dy}
                      textAnchor="middle"
                      fontSize={12}
                      fill={ink.fill}
                      {...haloProps(ink.halo)}
                      className="neh-arc-label neh-value-label tabular-nums"
                    >
                      {label}
                    </text>
                    {config.showValues && (
                      <text
                        x={lx}
                        y={ly + 11}
                        textAnchor="middle"
                        fontSize={11}
                        fill={ink.fill}
                        {...haloProps(ink.halo)}
                        className="neh-arc-label neh-pie-value tabular-nums"
                      >
                        {formatChartValue(s.value, lang, config.unit)}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
            {/* JEDNA LICZBA NAGŁÓWKOWA W ŚRODKU, z podpisem pod nią.
              Pod wskaźnikiem przełącza się na wartość wskazanego segmentu -
              wolno, bo pod dwoma warunkami, które spec nazywa wprost: podpis
              MÓWI, który stan jest widoczny (nazwa segmentu wobec "Suma"),
              a po zejściu wskaźnika liczba wraca do sumy. Środek, który
              zostaje na ostatnim segmencie, kłamie o całości. */}
            {donut && (
              <g pointerEvents="none" className="neh-fade">
                <text
                  x={cx}
                  y={cy - 4}
                  textAnchor="middle"
                  fontSize={22}
                  fill="var(--foreground)"
                  className="neh-total-label tabular-nums"
                >
                  {formatChartValue(activeSlice ? activeSlice.value : total, lang)}
                </text>
                {/* JEDNOSTKA POD LICZBĄ, nie w niej: zlepione razem dawały
                  napis, który przy długiej jednostce wychodził poza otwór
                  pierścienia. Podpis niesie NAZWĘ STANU i jednostkę, w tej
                  kolejności - bez nazwy stanu ta sama liczba raz znaczyłaby
                  całość, a raz jeden segment, i nic by tego nie odróżniało. */}
                <text x={cx} y={cy + 16} textAnchor="middle" fontSize={11} fill="var(--chart-ink3)">
                  {centreCaption}
                </text>
              </g>
            )}
          </svg>

          <ChartTooltip
            visible={activeSlice !== null}
            x={tooltipAnchor[0]}
            y={tooltipAnchor[1]}
            containerWidth={width}
            title={activeSlice?.label ?? ""}
            rows={
              activeSlice
                ? [
                    {
                      name: formatPercent(activeSlice.share, lang),
                      colorSlot: activeSlice.colorSlot,
                      // Próbka w kolorze ŁUKU - pod paletą ról wycinek nie ma
                      // koloru pod numerem slotu.
                      color: activeSlice.color,
                      value: formatChartValue(activeSlice.value, lang, config.unit),
                    },
                  ]
                : []
            }
            source={sourceLine(t, config)}
          />
        </div>

        <PieKeyTable
          slices={slices}
          lang={lang}
          unit={config.unit}
          active={active}
          onActivate={setActive}
          label={t("pie.keyTable")}
          labels={{
            category: t("frame.category"),
            share: t("frame.share"),
            value: t("frame.value"),
          }}
        />
      </div>
    </div>
  );
}

/**
 * Tabela klucza pod pierścieniem: próbka, nazwa, udział, wartość.
 *
 * PRAWDZIWA `<table>`, nie siatka z `div`ów. Kolumny liczb są wyrównane do
 * prawej i mają cyfry tabelaryczne, bo jedyny powód, dla którego ta tabela
 * istnieje, to porównywanie liczb wzrokiem w pionie - a to działa wyłącznie
 * przy wyrównanych rzędach wielkości. Znaczniki tabeli dają przy tym czytnikowi
 * ekranu nagłówki kolumn, czyli tę samą strukturę bez patrzenia.
 *
 * WIERSZ JEST POWIĄZANY Z ŁUKIEM w obie strony: wskazanie wiersza podświetla
 * łuk i odwrotnie. Tabela nie jest tu osobnym widokiem danych (ten jest
 * w ramie wykresu, pod przyciskiem), a KLUCZEM do grafiki obok - więc musi
 * odpowiadać na to samo wskazanie.
 */
function PieKeyTable({
  slices,
  lang,
  unit,
  active,
  onActivate,
  label,
  labels,
}: {
  slices: ReturnType<typeof pieModel>["slices"];
  lang: ChartLang;
  unit: string;
  active: number | null;
  onActivate: (index: number | null) => void;
  label: string;
  labels: { category: string; share: string; value: string };
}) {
  return (
    <table className="neh-pie-key mx-auto w-full max-w-xl table-fixed border-collapse text-xs">
      <caption className="sr-only">{label}</caption>
      {/* KOLUMNY O STAŁEJ SZEROKOŚCI, i to nie jest kwestia gustu. Wskazany
          wiersz jest oznaczony WAGĄ FONTU (tak jak wiersz serii we wspólnym
          tooltipie), a nie tłem: tło leżałoby wprost pod próbką koloru
          i przez kontrast jednoczesny zmieniałoby jej wygląd, czyli
          podświetlenie fałszowałoby klucz. Ale przy szerokościach liczonych
          z treści pogrubienie jednego wiersza rozpycha kolumnę i cała tabela
          skacze pod kursorem. Stałe kolumny zdejmują ten efekt do zera. */}
      <colgroup>
        <col className="w-1/2" />
        <col className="w-[22%]" />
        <col className="w-[28%]" />
      </colgroup>
      {/* NAGŁÓWKI KOLUMN SĄ, tylko niewidoczne. Bez nich czytelnik
          z czytnikiem ekranu dostaje w wierszu nazwę kategorii i dwie liczby,
          i nie ma z czego odczytać, która jest udziałem, a która wartością
          bezwzględną - a to jest cała informacja tej tabeli. Wzrokiem
          rozróżnia je układ i jednostka przy drugiej liczbie, więc widoczny
          nagłówek byłby tu szumem; dla czytnika układ nie istnieje.

          UKRYWAMY TREŚĆ KOMÓREK, NIE CAŁY `<thead>`: `sr-only` to pozycja
          absolutna, a nałożona na grupę wierszy tabeli wyjmuje ją ze struktury
          tabeli i `scope="col"` przestaje cokolwiek wiązać. Komórki zostają na
          swoich miejscach, a wiersz bez treści ma zerową wysokość. */}
      <thead>
        <tr>
          <th scope="col" className="p-0">
            <span className="sr-only">{labels.category}</span>
          </th>
          <th scope="col" className="p-0">
            <span className="sr-only">{labels.share}</span>
          </th>
          <th scope="col" className="p-0">
            <span className="sr-only">{labels.value}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {slices.map((s, i) => (
          <tr
            key={`${s.index ?? "rest"}-${s.label}`}
            data-active={active === i ? "true" : undefined}
            onPointerEnter={() => onActivate(i)}
            onPointerLeave={(e) => {
              if (e.pointerType !== "touch") onActivate(null);
            }}
          >
            <th scope="row" className="py-1 pr-3 text-left font-medium">
              <span className="flex items-center gap-1.5">
                {/* PRÓBKA = ŁUK: to samo pełne wypełnienie i ta sama obwódka
                    drugiego nośnika na wycinku wyróżnionym. Ramka 1 px stoi
                    na KAŻDEJ próbce (w kolorze wycinka, gdy obwódki nie ma),
                    więc wymiary próbek nie zależą od wyboru akcentu. */}
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 shrink-0 rounded-[2px] border"
                  data-accent={s.accent ? "true" : undefined}
                  style={{
                    background: s.color,
                    borderColor: sliceEdge(s) === "none" ? s.color : sliceEdge(s),
                  }}
                />
                <span className="min-w-0 truncate">{s.label}</span>
              </span>
            </th>
            <td className="py-1 pr-3 text-right tabular-nums">{formatPercent(s.share, lang)}</td>
            <td className="py-1 text-right tabular-nums text-muted-foreground">
              {formatChartValue(s.value, lang, unit)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
