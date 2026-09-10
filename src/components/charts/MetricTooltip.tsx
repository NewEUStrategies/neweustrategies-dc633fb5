// TOOLTIP OBJAŚNIAJĄCY - mówi CO ZNACZY wskaźnik. Osobny komponent od
// tooltipa danych, bo to osobna funkcja: tamten wisi nad punktem i podaje
// liczby, ten wisi przy NAZWIE wskaźnika i podaje definicję.
//
// PIĘĆ PÓL O STAŁEJ KOLEJNOŚCI (wzór, mierzy, czytanie, dźwignie, uwaga).
// Stała kolejność jest tu całą wartością: czytelnik, który raz zobaczył
// jeden taki dymek, w następnym wie, gdzie szukać progu interpretacyjnego,
// i nie musi czytać całości. Jeden akapit "opisu" tego nie daje.
//
// OTWIERANY NA HOVER, FOCUS I KLIK - wszystkie trzy, nie do wyboru. Bez
// wersji dotykowej wykres jest nieużywalny na telefonie (nie ma tam hovera),
// a bez focusu nieużywalny z klawiatury. Klik działa jak przełącznik, więc
// na dotyku dymek da się też zamknąć.
//
// MIERZONY DOPIERO PO WSTAWIENIU TREŚCI. Wysokość dymka zależy od długości
// tekstu, więc pomiar przed wstawieniem jest najczęstszą przyczyną dymków
// wychodzących za ekran. Pozycję liczymy w `useLayoutEffect` po tym, jak
// treść już jest w drzewie, i sprawdzamy WSZYSTKIE CZTERY krawędzie, także
// w rogach.
//
// PORTAL DO `<body>`. Dymek nie może być dzieckiem karty wykresu: karta ma
// `overflow` w kilku układach i własny kontekst nakładania, więc dymek
// przycinałby się do niej. `position: fixed` w portalu liczy się względem
// okna, a nie względem przodka z transformacją.
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Info } from "lucide-react";
import type { ChartMetric } from "@/lib/charts/types";
import type { ChartLang } from "@/lib/charts/format";
import "@/lib/i18n-charts";

interface MetricTooltipProps {
  metric: ChartMetric;
  lang: ChartLang;
}

/** Odstęp dymka od wywołującego i od krawędzi okna - ze skali 4 px. */
const OFFSET = 8;
const MARGIN = 8;
const MAX_WIDTH = 320;

export function MetricTooltip({ metric, lang }: MetricTooltipProps) {
  // Prefiks przez `keyPrefix` haka - tylko taki widzi bramka rozjazdu
  // kod<->słownik.
  const { t: scoped } = useTranslation("translation", { keyPrefix: "charts.metric" });
  const t = (key: string, values?: Record<string, string>): string =>
    scoped(key, { lng: lang, ...values });
  const [open, setOpen] = useState(false);
  // `pinned` odróżnia otwarcie KLIKIEM od otwarcia hoverem: kliknięty dymek
  // nie może zniknąć, gdy kursor zsunie się z ikony, bo na dotyku kursor
  // zsuwa się natychmiast.
  const [pinned, setPinned] = useState(false);
  const [style, setStyle] = useState<CSSProperties>({ opacity: 0 });
  const anchorRef = useRef<HTMLButtonElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const tipId = useId();
  // ZAMKNIĘCIE ESCAPE'M MUSI PRZEŻYĆ POWRÓT FOKUSU. Escape oddaje fokus
  // wywołującemu (tego wymaga dostępność: czytelnik nie może zostać z fokusem
  // w nicości), a wywołujący otwiera dymek NA FOKUS - więc bez tej flagi
  // `setOpen(false)` i `setOpen(true)` lądowały w jednej porcji aktualizacji
  // i dymek zostawał otwarty. Escape nie działał w ogóle.
  //
  // Ref, nie stan: flaga musi być widoczna dla `onFocus` wywołanego
  // SYNCHRONICZNIE przez `.focus()` w tym samym obiegu, a stan zmieniłby się
  // dopiero po przerenderowaniu. Kasuje ją każdy nowy zamiar czytelnika
  // (zjechanie kursorem i powrót, wyjście fokusem, klik), więc dymek nie
  // zostaje zamknięty na stałe.
  const dismissed = useRef(false);

  const place = useCallback(() => {
    const anchor = anchorRef.current;
    const tip = tipRef.current;
    if (!anchor || !tip) return;
    // Pomiar PO wstawieniu treści - `getBoundingClientRect` na dymku, który
    // już ma tekst. Wcześniejszy pomiar zwracałby wysokość pustego pudełka.
    const a = anchor.getBoundingClientRect();
    const box = tip.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Pion: pod ikoną, a gdy się nie mieści - nad nią. Gdy nie mieści się
    // ani tam, ani tam (dymek wyższy niż okno), dociskamy do górnej krawędzi
    // i pozwalamy mu się przewinąć własnym `overflow`.
    const below = a.bottom + OFFSET;
    const above = a.top - box.height - OFFSET;
    let top: number;
    if (below + box.height + MARGIN <= vh) top = below;
    else if (above >= MARGIN) top = above;
    else top = Math.max(MARGIN, Math.min(vh - box.height - MARGIN, below));

    // Poziom: wyśrodkowany na ikonie, dociśnięty do obu krawędzi.
    const centred = a.left + a.width / 2 - box.width / 2;
    const left = Math.max(MARGIN, Math.min(centred, vw - box.width - MARGIN));

    setStyle({ top: Math.round(top), left: Math.round(left), opacity: 1 });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onScrollOrResize = (): void => place();
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key === "Escape") {
        dismissed.current = true;
        setOpen(false);
        setPinned(false);
        anchorRef.current?.focus();
      }
    };
    // `capture` na scrollu, bo przewijać może dowolny przodek, nie okno.
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, place]);

  const rows: Array<[string, string]> = [
    [t("formula"), metric.formula],
    [t("measures"), metric.measures],
    [t("reading"), metric.reading],
    [t("levers"), metric.levers],
    [t("caution"), metric.caution],
  ].filter((row): row is [string, string] => Boolean(row[1]));

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        // Podkreślenie kropkowane PLUS ikona: dwa nośniki tego, że tu jest
        // wyjaśnienie. Sama ikona ginie w nagłówku, samo podkreślenie bywa
        // brane za link.
        className="neh-metric-trigger inline-flex items-center gap-1 rounded-[var(--chart-radius)] align-baseline text-inherit underline decoration-dotted decoration-from-font underline-offset-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={t("open", { name: metric.name })}
        aria-expanded={open}
        aria-describedby={open ? tipId : undefined}
        onPointerEnter={() => {
          dismissed.current = false;
          setOpen(true);
        }}
        onPointerLeave={() => {
          dismissed.current = false;
          if (!pinned) setOpen(false);
        }}
        onFocus={() => {
          if (!dismissed.current) setOpen(true);
        }}
        onBlur={() => {
          dismissed.current = false;
          if (!pinned) setOpen(false);
        }}
        onClick={() => {
          dismissed.current = false;
          setPinned((was) => !was || !open);
          setOpen((was) => !was || !pinned);
        }}
      >
        <span>{metric.name}</span>
        <Info className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={tipRef}
            id={tipId}
            role="tooltip"
            className="neh-metric-tip"
            style={{ ...style, maxWidth: MAX_WIDTH }}
          >
            <div className="neh-metric-tip-name">{metric.name}</div>
            {metric.expansion && <div className="neh-metric-tip-expansion">{metric.expansion}</div>}
            {rows.length > 0 && (
              <dl className="neh-metric-tip-rows">
                {rows.map(([label, value]) => (
                  <div key={label} className="neh-metric-tip-row">
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
