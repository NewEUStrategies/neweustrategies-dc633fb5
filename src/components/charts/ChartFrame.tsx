// Rama wykresu: karta w stylistyce platformy, nagłówek z opcjonalnym
// tooltipem objaśniającym wskaźnik, legenda, przełączany widok tabeli danych
// (kanał dostępności - tooltip NIGDY nie jest jedyną drogą do wartości)
// i PODPIS UCZCIWOŚCIOWY.
//
// PODPIS UCZCIWOŚCIOWY jest tu najważniejszą nowością i nie jest ozdobą.
// Wykres łatwiej kłamie niż tabela, bo działa szybciej niż świadoma kontrola,
// więc rama wymusza cztery rzeczy, których autor sam nie napisze:
//   * jednostkę i liczbę obserwacji `n` - wykres na trzech i na trzystu
//     obserwacjach wygląda tak samo, a znaczy co innego;
//   * źródło ORAZ datę danych (nie datę publikacji wpisu);
//   * ostrzeżenie, gdy oś wartości nie zaczyna się od zera - ucięta skala
//     zawyża wygląd różnic, więc ucięcie musi być NAZWANE, a nie tylko
//     widoczne dla kogoś, kto czyta podziałki;
//   * trzy zdania: co pokazuje, co jest zaskakujące, CZEGO NIE POKAZUJE.
//     Ostatnie odróżnia wykres analityczny od ilustracji.
//
// Legenda pisze nazwy serii WARIANTEM TEKSTOWYM slotu, nie kolorem linii:
// próg kontrastu dla tekstu to 4,5:1, dla linii 3,0:1, więc ochra jako linia
// jest w porządku, a jako napis nie. To najczęstszy błąd w wykresach -
// wygląda spójnie i nie przechodzi audytu dostępności.
//
// Czysto prezentacyjna, SSR-safe.
import { useId, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Table2, TriangleAlert } from "lucide-react";
import type { ChartLang } from "@/lib/charts/format";
import type { ChartMetric } from "@/lib/charts/types";
import { MetricTooltip } from "./MetricTooltip";
import "@/lib/i18n-charts";

export interface LegendItem {
  /** Klucz Reacta - slot albo nazwa semantyczna; nazwa serii bywa pusta. */
  key: string;
  name: string;
  /** Token koloru ZNACZNIKA (próg 3,0:1). */
  color: string;
  /**
   * Token koloru NAPISU (próg 4,5:1). Osobne pole, bo to nie ten sam kolor:
   * ochra jako próbka jest w porządku, jako napis nie przechodzi audytu.
   */
  textColor: string;
  /** Kształt klucza odzwierciedla znacznik: linia dla line/area, kwadrat dla reszty. */
  shape: "line" | "rect";
  /** Kreskowanie - drugi nośnik różnicy dla slotów poza zestawem bezpiecznym. */
  dashed?: boolean;
}

export interface ChartCaption {
  source: string;
  sourceDate: string;
  unit: string;
  sampleSize: number | null;
  /** Oś wartości nie zaczyna się od zera - ucięcie MUSI być nazwane. */
  zeroBaselineBroken: boolean;
  /**
   * Suma ZAOKRĄGLONYCH udziałów tarczy, gdy nie domyka 100% - już
   * sformatowana, np. "99,8%". `null` znaczy "nie ma czego zgłaszać": inny
   * rodzaj wykresu albo suma w tolerancji zaokrągleń.
   *
   * Tu, a nie pod tabelą danych, bo to nie jest przypis do tabeli: to
   * ostrzeżenie o tym, że STRUKTURA POKAZANA NA RYSUNKU się nie domyka,
   * i musi stać obok rysunku, tak samo jak ostrzeżenie o uciętej osi.
   */
  shareSumMismatch: string | null;
  notesShows: string;
  notesSurprising: string;
  notesHidden: string;
}

interface ChartFrameProps {
  title: string;
  description: string;
  lang: ChartLang;
  /** Wyjaśnienie wskaźnika przy tytule; null = wykres go nie potrzebuje. */
  metric: ChartMetric | null;
  /** Legenda - renderowana ZAWSZE przy >=2 seriach (patrz reguły dataviz). */
  legend: LegendItem[];
  showLegend: boolean;
  caption: ChartCaption;
  /** Tabela danych - dostępnościowa alternatywa dla grafiki. */
  table: ReactNode;
  children: ReactNode;
  className?: string;
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
}: ChartFrameProps) {
  const [tableOpen, setTableOpen] = useState(false);
  // Prefiks przez `keyPrefix` haka - tylko taki widzi bramka rozjazdu
  // kod<->słownik; klucz sklejony template literalem wypada z kontroli
  // parytetu PL/EN.
  const { t: scoped } = useTranslation("translation", { keyPrefix: "charts" });
  const t = (key: string, values?: Record<string, string | number>): string =>
    scoped(key, { lng: lang, ...values });
  const tableId = useId();
  // Legenda przy jednej serii to szum - tytuł nazywa jedyny kolor.
  const legendVisible = showLegend && legend.length >= 2;

  const facts = [
    caption.unit ? t("caption.unit", { unit: caption.unit.trim() }) : "",
    caption.sampleSize !== null ? t("caption.sampleSize", { count: caption.sampleSize }) : "",
    caption.sourceDate ? t("caption.sourceDate", { date: caption.sourceDate }) : "",
  ].filter(Boolean);

  const notes = [
    [t("notes.shows"), caption.notesShows],
    [t("notes.surprising"), caption.notesSurprising],
    [t("notes.hidden"), caption.notesHidden],
  ].filter((row): row is [string, string] => Boolean(row[1]));

  return (
    <figure
      className={[
        "neh-chart not-prose my-6 border border-border bg-card p-4 md:p-6",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {(title || description || metric) && (
        <figcaption className="mb-4">
          {title && (
            <div className="font-display text-lg font-semibold leading-snug text-foreground">
              {title}
            </div>
          )}
          {metric && (
            <div className="mt-1 text-sm text-muted-foreground">
              <MetricTooltip metric={metric} lang={lang} />
            </div>
          )}
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </figcaption>
      )}

      {legendVisible && (
        <ul className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5" role="list">
          {legend.map((item) => (
            <li key={item.key} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className={
                  item.shape === "line" ? "h-[3px] w-4 rounded-full" : "h-2.5 w-2.5 rounded-[3px]"
                }
                style={{
                  // Klucz serii poza zestawem bezpiecznym dla daltonizmu
                  // POWTARZA kreskowanie znacznika - inaczej legenda
                  // twierdziłaby, że serie różni sam odcień, a ich odległość
                  // po symulacji jest na to za mała.
                  background: item.dashed
                    ? `repeating-linear-gradient(90deg, ${item.color} 0 5px, transparent 5px 8px)`
                    : item.color,
                }}
              />
              <span className="text-xs" style={{ color: item.textColor }}>
                {item.name}
              </span>
            </li>
          ))}
        </ul>
      )}

      {children}

      {/* Ostrzeżenie o uciętej osi. Ikona PLUS tekst, bo sama ikona nie mówi,
          co jest ucięte, a sam tekst ginie w podpisie. */}
      {caption.zeroBaselineBroken && (
        <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            <strong className="font-semibold">{t("caption.zeroBaselineWarning")}</strong>{" "}
            {t("caption.zeroBaselineWarningHint")}
          </span>
        </p>
      )}

      {/* Suma kontrolna udziałów. Ta sama forma co ostrzeżenie o uciętej osi -
          ikona PLUS tekst - bo to ten sam gatunek komunikatu: rysunek pokazuje
          coś, czego liczby nie potwierdzają. */}
      {caption.shareSumMismatch !== null && (
        <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{t("pie.shareSumFailed", { sum: caption.shareSumMismatch })}</span>
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 text-xs text-muted-foreground">
          {caption.source && <p className="m-0">{caption.source}</p>}
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

      {/* Trzy zdania. Kolejność jest stała, żeby czytelnik wiedział, gdzie
          szukać zastrzeżenia - a zastrzeżenie jest tym, co odróżnia wykres
          analityczny od ilustracji. */}
      {notes.length > 0 && (
        <dl className="mt-4 grid gap-2 border-t border-border pt-3 text-xs">
          {notes.map(([label, value]) => (
            <div
              key={label}
              className="grid gap-0.5 sm:grid-cols-[minmax(0,9rem)_minmax(0,1fr)] sm:gap-3"
            >
              <dt className="font-semibold uppercase tracking-wide text-muted-foreground">
                {label}
              </dt>
              <dd className="m-0 text-foreground">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </figure>
  );
}

/**
 * JEDEN KOMUNIKAT POD TABELĄ DANYCH: defekt danych albo obserwacja o rysunku.
 *
 * `key` jest jednocześnie identyfikatorem Reacta i UCHWYTEM ZAPYTANIA
 * (`data-note`), po którym testy sprawdzają, że rysunek naprawdę powiedział
 * to, co miał powiedzieć - dlatego jest ścieżką słownika (`reading.tooFew`,
 * `honesty.checksumFailed`), a nie numerem porządkowym.
 */
export interface ChartNote {
  key: string;
  text: string;
  /**
   * `true` = defekt DANYCH (czerwień tekstowa), `false` = obserwacja
   * o rysunku (ink recesywny). Rozróżnienie jest w kolorze, bo lista, na
   * której wszystko krzyczy, uczy ignorowania całej listy.
   */
  defect: boolean;
}

/**
 * Lista komunikatów pod tabelą danych. WYDZIELONA Z PIĘCIU RENDERÓW, w których
 * stała bajt w bajt ta sama: histogram był piątym i przy przepisywaniu jej po
 * raz piąty wyszło, że jedyne, co je różniło, to fakt, że histogram jej nie
 * miał wcale (przez to nie pokazywał ANI JEDNEGO komunikatu uczciwości, choć
 * model liczy siedem flag, a słownik ma dla nich treści w obu językach).
 */
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
