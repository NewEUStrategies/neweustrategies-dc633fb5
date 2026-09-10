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
// Pozycjonowany translate3d względem kontenera wykresu, z odbiciem przy
// prawej krawędzi. Kolory wyłącznie z tokenów `--chart-tip-*`, więc w trybie
// jasnym dymek jest ODWRÓCONY wobec płyty, a w ciemnym PODNIESIONY - patrz
// komentarz przy tokenach w styles.css.
//
// `pointer-events: none` (w klasie `.neh-tooltip`) jest tu obowiązkowe:
// dymek, który łapie kursor, odbiera zdarzenia warstwie trafień i wykres
// zaczyna migotać przy każdym ruchu myszy nad punktem.
//
// Czysto wizualny duplikat danych - pełne wartości ZAWSZE niesie tabela
// w ChartFrame, bo tooltip nie istnieje ani na klawiaturze bez focusu, ani
// w druku, ani dla czytnika ekranu.
import type { CSSProperties } from "react";

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
  if (!visible || rows.length === 0) return null;
  const flip = x > containerWidth * 0.6;
  const style: CSSProperties = {
    transform: `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0) translate(${
      flip ? "calc(-100% - 12px)" : "12px"
    }, -50%)`,
  };
  return (
    <div className="neh-tooltip" role="presentation" aria-hidden style={style}>
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
