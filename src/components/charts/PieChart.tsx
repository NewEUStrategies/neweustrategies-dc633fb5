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
// ROZDZIELA JE PRZERWA KĄTOWA 2,5 px, nie obrys w kolorze płyty. Obrys
// zajmował miejsce, które należy się obwódce serii: bez przerwy obwódki dwóch
// sąsiednich łuków stykają się i dają fałszywy trzeci kolor na granicy.
// Przerwa niesie też granicę w skali szarości, gdzie same odcienie nie
// wystarczają.
//
// Wypełnienie w wariancie bladym, jak słupek: blade wnętrze plus mocna
// obwódka. Tożsamość jest tu trudniejsza niż w słupkach - w słupku każdy
// element ma własną etykietę na osi, a w pierścieniu łuki stykają się i nie ma
// osi, do której można je przypiąć. Obwódka 1,5 px na pierścieniu grubym 38 px
// to około 4% powierzchni łuku, czyli za mało, żeby z odległości nieść kolor.
// Dlatego wariant blady wymaga TRZECH rzeczy jednocześnie: wartości wpisanej
// w łuk tam, gdzie kąt na to pozwala, TABELI KLUCZA obok pierścienia
// i kolejności malejącej od godziny dwunastej.
//
// TABELA OBOK, NIE LEGENDA Z PRÓBKAMI. Legenda podaje wyłącznie parę
// kolor-nazwa, więc czytelnik musi wykonać trzy skoki wzroku (łuk, próbka,
// nazwa) i wciąż nie dostaje liczby. Tabela stawia w jednym wierszu próbkę,
// nazwę, udział i wartość bezwzględną, w tej samej kolejności co łuki - czyli
// odczyt jednej kategorii jest jednym skokiem. Próbka w tabeli powtarza PARĘ
// wnętrze plus obwódka, dokładnie tę, którą ma łuk: sam kolor obwódki nie
// wskazywałby wycinka, bo na łuku niesie go blade wnętrze o innej jasności.
//
// Interakcja: hover/focus zmienia POWIERZCHNIĘ (wypełnienie i obwódkę),
// a NIGDY nie wysuwa łuku na zewnątrz - przesunięcie promieniowe zmienia
// długość łuku przy zewnętrznej krawędzi i zawyża udział, czyli robi dokładnie
// to, czego zabrania zasada o niezmiennym kodowaniu.
import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ChartConfig } from "@/lib/charts/types";
import { formatChartValue, formatPercent, type ChartLang } from "@/lib/charts/format";
import { estimateLabelWidth } from "@/lib/charts/measureText";
import { ARC_GAP_PX, ARC_LABEL_PAD } from "@/lib/charts/geometry";
import { useContainerWidth } from "@/hooks/useContainerWidth";
import { useTapAwayDismiss } from "@/hooks/useTapAwayDismiss";
import { useRevealOnScroll, revealClassName } from "@/hooks/useRevealOnScroll";
import { ChartTooltip } from "./ChartTooltip";
import { pieModel } from "./pieModel";
import "@/lib/i18n-charts";

interface PieChartProps {
  config: ChartConfig;
  lang: ChartLang;
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

export function PieChart({ config, lang }: PieChartProps) {
  const { ref: widthRef, width } = useContainerWidth<HTMLDivElement>(720);
  const { ref: revealRef, state: revealState } = useRevealOnScroll<HTMLDivElement>(config.animate);
  const [active, setActive] = useState<number | null>(null);
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
  const rMid = (rOuter + rInner) / 2 || rOuter;
  const gap = ARC_GAP_PX / 2 / rMid;
  const activeSlice = active !== null ? slices[active] : null;
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
      {/* TABELA KLUCZA OBOK, a poniżej progu `sm` POD pierścieniem. W jednej
          kolumnie tarcza zjadałaby całą szerokość telefonu i tabela zeszłaby
          do dwóch znaków na kolumnę; ułożona pod spodem zachowuje wyrównanie
          liczb do prawej, które jest jedynym powodem, dla którego jest
          tabelą, a nie listą. `min-w-0` na kolumnie pierścienia jest tu
          konieczne: bez niego `flex-1` nie kurczy się poniżej wewnętrznej
          szerokości SVG i tabela wypycha kartę. */}
      <div ref={rootRef} className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div
          ref={widthRef}
          className="relative min-w-0 flex-1 select-none"
          style={{ height, borderRadius: "var(--chart-radius)" }}
          // group (nie img): wycinki w środku są fokusowalne - rola img
          // czyniłaby je prezentacyjnymi dla czytników ekranu.
          role="group"
          aria-label={
            config.title ? t("a11y.chart", { title: config.title }) : t("a11y.chartUntitled")
          }
        >
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
                    // Blade wnętrze plus mocna obwódka - ten sam wariant, co
                    // słupek. Grubość obwódki niesie arkusz (`--chart-bar-edge`,
                    // 1,5 px na jasnym i 1,25 px na ciemnym), bo `var()`
                    // w atrybutach prezentacyjnych SVG nie jest wspierane
                    // wszędzie.
                    fill={`var(--chart-${s.colorSlot}-inner)`}
                    stroke={`var(--chart-${s.colorSlot}-edge)`}
                    // MITER, nie round: oba końce łuku są granicami między
                    // kategoriami, a zaokrąglenie któregokolwiek przesuwa
                    // granicę i zaniża udział.
                    strokeLinejoin="miter"
                    data-active={active === i ? "true" : undefined}
                    style={{
                      ["--neh-arc-hover" as string]: `var(--chart-${s.colorSlot}-hover)`,
                      ["--neh-arc-token" as string]: `var(--chart-${s.colorSlot})`,
                    }}
                    tabIndex={0}
                    role="img"
                    aria-label={t("a11y.slice", {
                      label: s.label,
                      value: formatChartValue(s.value, lang, config.unit),
                      share: formatPercent(s.share, lang),
                    })}
                    className="neh-slice cursor-pointer"
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
                return (
                  <g
                    key={`t${i}`}
                    pointerEvents="none"
                    // TUSZ SLOTU PODANY, ale NIE UŻYTY NA EKRANIE. Na bladym
                    // wnętrzu (1,20-1,28:1 do płyty) obowiązuje tusz
                    // semantyczny: `--chart-ink-N` jest dobrany kontrastem do
                    // NASYCONEGO wypełnienia i na bladym bywa bielą na jasnym.
                    // Ale w DRUKU łuk wraca do wariantu solidnego, i wtedy ten
                    // sam napis leży na nasyconym kolorze: tusz semantyczny ma
                    // na granacie 2,25:1, a ink slotu 8,07:1. Arkusz przełącza
                    // to w `@media print`, więc obie wartości muszą być
                    // dostępne na elemencie.
                    style={{
                      ["--neh-arc-ink" as string]: `var(--chart-ink-${s.colorSlot})`,
                    }}
                  >
                    <text
                      x={lx}
                      y={ly + dy}
                      textAnchor="middle"
                      fontSize={12}
                      fill="var(--foreground)"
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
                        fill="var(--foreground)"
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
                <text
                  x={cx}
                  y={cy + 16}
                  textAnchor="middle"
                  fontSize={11}
                  fill="var(--muted-foreground)"
                >
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
                      value: formatChartValue(activeSlice.value, lang, config.unit),
                    },
                  ]
                : []
            }
          />
        </div>

        <PieKeyTable
          slices={slices}
          lang={lang}
          unit={config.unit}
          active={active}
          onActivate={setActive}
          label={t("pie.keyTable")}
        />
      </div>
    </div>
  );
}

/**
 * Tabela klucza obok pierścienia: próbka, nazwa, udział, wartość.
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
}: {
  slices: ReturnType<typeof pieModel>["slices"];
  lang: ChartLang;
  unit: string;
  active: number | null;
  onActivate: (index: number | null) => void;
  label: string;
}) {
  return (
    <table className="neh-pie-key w-full shrink-0 table-fixed border-collapse text-xs sm:w-56">
      <caption className="sr-only">{label}</caption>
      {/* KOLUMNY O STAŁEJ SZEROKOŚCI, i to nie jest kwestia gustu. Wskazany
          wiersz jest oznaczony WAGĄ FONTU (tak jak wiersz serii we wspólnym
          tooltipie), a nie tłem: tło leżałoby wprost pod bladą próbką koloru
          i przez kontrast jednoczesny zmieniałoby jej wygląd, czyli
          podświetlenie fałszowałoby klucz. Ale przy szerokościach liczonych
          z treści pogrubienie jednego wiersza rozpycha kolumnę i cała tabela
          skacze pod kursorem. Stałe kolumny zdejmują ten efekt do zera. */}
      <colgroup>
        <col className="w-1/2" />
        <col className="w-[22%]" />
        <col className="w-[28%]" />
      </colgroup>
      <tbody>
        {slices.map((s, i) => (
          <tr
            key={`${s.colorSlot}-${s.label}`}
            data-active={active === i ? "true" : undefined}
            onPointerEnter={() => onActivate(i)}
            onPointerLeave={(e) => {
              if (e.pointerType !== "touch") onActivate(null);
            }}
          >
            <th scope="row" className="py-1 pr-3 text-left font-medium">
              <span className="flex items-center gap-1.5">
                {/* PARA wnętrze plus obwódka, dokładnie jak na łuku. Sama
                    obwódka nie wskazywałaby wycinka: na łuku kolor niesie
                    blade wnętrze, a obwódka jest jego krawędzią. */}
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 shrink-0 rounded-[2px] border"
                  style={{
                    background: `var(--chart-${s.colorSlot}-inner)`,
                    borderColor: `var(--chart-${s.colorSlot}-edge)`,
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
