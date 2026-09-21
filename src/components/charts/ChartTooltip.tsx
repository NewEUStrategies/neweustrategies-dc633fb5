// TOOLTIP DANYCH - mówi ILE. Druga, całkowicie osobna funkcja to tooltip
// OBJAŚNIAJĄCY (`MetricTooltip`), który mówi CO TO ZNACZY i wisi przy nazwie
// wskaźnika, nie nad punktem. Mieszanie ich w jeden dymek daje ścianę tekstu
// nad punktem danych, w której nie widać ani liczby, ani definicji.
//
// Wartość jest tu elementem wiodącym (mocny kontrast, cyfry tabelaryczne),
// nazwa serii drugorzędna, klucz serii to KWADRATOWA próbka w kolorze slotu.
//
// JEDEN WSPÓLNY DYMEK NA WYKRES, nie osobny na serię, a serie w nim SORTOWANE
// MALEJĄCO PO WARTOŚCI - nie w kolejności definicji. Czytelnik porównuje wtedy
// dokładnie to, co widzi na prowadnicy: kolejność w dymku odpowiada kolejności
// w pionie na wykresie. Kolejność definicji jest przypadkowa wobec danych
// i zmusza do wodzenia wzrokiem tam i z powrotem.
// Pozycjonowany translate3d względem kontenera wykresu. Kolory wyłącznie
// z tokenów `--chart-tip-*`, więc w trybie jasnym dymek jest ODWRÓCONY wobec
// płyty, a w ciemnym PODNIESIONY - patrz komentarz przy tokenach w styles.css.
//
// ZACISKANIE DO KRAWĘDZI. Dymek NIGDZY nie wolno przyciąć: ani przez próg
// odbicia (sztywne 60% szerokości nie wie, jak szeroki jest dymek, więc przy
// wąskim wykresie wychodził poza LEWĄ krawędź), ani przez stałe -50% w pionie
// (punkt przy górnej krawędzi ucinał dymek o połowę). Dlatego komponent mierzy
// własny rozmiar po wyrenderowaniu i zaciska pozycję do wnętrza kontenera
// z marginesem bezpieczeństwa - odbicie w poziomie jest WYNIKIEM braku miejsca
// po żądanej stronie, nie stałego progu szerokości.
//
// `pointer-events: none` (w klasie `.neh-tooltip`) jest tu obowiązkowe:
// dymek, który łapie kursor, odbiera zdarzenia warstwie trafień i wykres
// zaczyna migotać przy każdym ruchu myszy nad punktem.
//
// Czysto wizualny duplikat danych - pełne wartości ZAWSZE niesie tabela
// w ChartFrame, bo tooltip nie istnieje ani na klawiaturze bez focusu, ani
// w druku, ani dla czytnika ekranu.
import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";

/** Margines bezpieczeństwa od krawędzi kontenera, w px. */
const EDGE_PAD = 4;
/** Odsunięcie dymka od kotwicy, w px. */
const ANCHOR_GAP = 12;

export interface TooltipRow {
  name: string;
  value: string;
  /** null = wiersz bez klucza koloru (np. suma, krok mostka). */
  colorSlot: number | null;
  /**
   * Seria pod kursorem. Wyróżniana WAGĄ FONTU, nie tłem wiersza: tło
   * wprowadziłoby do dymka drugą powierzchnię i konkurowało z próbką koloru,
   * a waga pisma jest nośnikiem, który nie zajmuje miejsca i nie koduje nic
   * poza "to ta, na której stoisz".
   */
  emphasised?: boolean;
}

interface ChartTooltipProps {
  visible: boolean;
  /** Pozycja kotwicy w px względem kontenera wykresu. */
  x: number;
  y: number;
  containerWidth: number;
  title: string;
  /** Dopisek pod tytułem - np. oznaczenie, że kategoria jest prognozą. */
  note?: string;
  rows: TooltipRow[];
}

export function ChartTooltip({
  visible,
  x,
  y,
  containerWidth,
  title,
  note,
  rows,
}: ChartTooltipProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  // Pomiar PO wyrenderowaniu, przed malowaniem - dymek jest niewidzialny
  // (opacity: 0) do czasu, aż znamy jego rozmiar i policzymy pozycję,
  // więc czytelnik nigdy nie widzi ramki "skaczącej" z pozycji surowej.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    setSize((prev) => (prev && prev.w === w && prev.h === h ? prev : { w, h }));
  });

  if (!visible || rows.length === 0) return null;

  let style: CSSProperties;
  if (size === null || (size.w === 0 && size.h === 0)) {
    // GAŁĄŹ AWARYJNA. Rozmiar nieznany: pierwszy przebieg przed pomiarem
    // (ukrywany opacity: 0) ALBO środowisko bez layoutu (jsdom raportuje
    // offsetWidth/Height = 0 zawsze). Zachowanie historyczne: odbicie przy
    // sztywnym progu 60% szerokości i wyśrodkowanie -50% w pionie. W praw-
    // dziwej przeglądarce pomiar zawsze dojeżdża i wygrywa gałąź zacisku.
    const flip = x > containerWidth * 0.6;
    style = {
      transform: `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0) translate(${
        flip ? "calc(-100% - 12px)" : "12px"
      }, -50%)`,
      ...(size === null ? { opacity: 0 } : {}),
    };
  } else {
    const { w, h } = size;
    // Kontener pozycjonujący to rodzic dymka; wysokość bierzemy z niego,
    // bo sygnatura komponentu przekazuje wyłącznie szerokość.
    const containerH = ref.current?.offsetParent?.clientHeight ?? h + 2 * EDGE_PAD;
    // Poziom: preferujemy stronę prawą, chyba że dymek wyszedłby poza prawą
    // krawędź - wtedy odbicie w lewo. Gdy NIE MIEŚCI SIĘ po żadnej stronie
    // (bardzo wąski wykres), wygrywa zacisk do wnętrza kontenera.
    let left = x + ANCHOR_GAP;
    if (left + w > containerWidth - EDGE_PAD) left = x - ANCHOR_GAP - w;
    left = Math.min(Math.max(left, EDGE_PAD), Math.max(containerWidth - w - EDGE_PAD, EDGE_PAD));
    // Pion: wyśrodkowanie na kotwicy, zaciśnięte do wnętrza kontenera.
    let top = y - h / 2;
    top = Math.min(Math.max(top, EDGE_PAD), Math.max(containerH - h - EDGE_PAD, EDGE_PAD));
    style = {
      transform: `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`,
    };
  }

  return (
    <div ref={ref} className="neh-tooltip" role="presentation" aria-hidden style={style}>
      {title && <div className="mb-1 font-medium opacity-80">{title}</div>}
      {note && (
        <div className="mb-1 text-[0.6875rem] uppercase tracking-wide opacity-60">{note}</div>
      )}
      <dl className="m-0 space-y-0.5">
        {rows.map((row, i) => (
          <div key={i} className="flex items-center justify-between gap-3">
            <dt className="flex min-w-0 items-center gap-1.5">
              {row.colorSlot !== null && (
                /* PRÓBKA KWADRATOWA, nie kreska. Kreska czyta się jako
                   fragment linii serii, czyli jako znacznik danych; kwadrat
                   czyta się jako klucz. Ta sama forma co próbka legendy. */
                <span
                  aria-hidden
                  className="h-2 w-2 shrink-0 rounded-[2px]"
                  style={{ background: `var(--chart-${row.colorSlot})` }}
                />
              )}
              <span className={`truncate ${row.emphasised ? "font-medium" : "opacity-80"}`}>
                {row.name}
              </span>
            </dt>
            <dd
              className={`m-0 shrink-0 tabular-nums ${
                row.emphasised ? "font-bold" : "font-semibold"
              }`}
            >
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
