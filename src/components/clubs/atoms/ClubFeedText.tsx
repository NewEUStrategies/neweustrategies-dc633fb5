// Atom: treść karty strumienia przycięta do trzech linii z „…więcej".
//
// DLACZEGO TRZY LINIE. Strumień jest skanowany, nie czytany: trzy linie to
// tyle, ile mieści się w jednym spojrzeniu i wystarcza, żeby zdecydować, czy
// wpis jest wart rozwinięcia. Dłuższy tekst pod każdą kartą zamienia kolumnę
// w ścianę, a krótszy nie niesie tezy.
//
// JAK. Zamiast `line-clamp` - wysokość w jednostkach linii (`3lh`) i pomiar
// przepełnienia. `line-clamp` nie daje się animować, a rozwinięcie ma płynnie
// odsłonić resztę tekstu: `max-height` przechodzi z trzech linii do zmierzonej
// wysokości całości, a po przejściu limit znika, żeby treść dociągnięta później
// (np. podgląd wzmianki) nigdy nie została ucięta.
//
// „…więcej" pojawia się DOPIERO po pomiarze, czyli tylko wtedy, gdy tekst
// faktycznie się nie mieści - krótki wpis nie dostaje martwej obietnicy.
// Rozwinięcie przenosi fokus na treść, bo przycisk znika razem z przycięciem.
//
// RÓWNE LINIE. Odstępy między akapitami i punktami nie są wielokrotnością
// wysokości linii, więc w przyciętym widoku trzecia linia bywała ucięta
// w pół glifu. Na czas zwinięcia odstępy pionowe znikają (linie leżą na
// siatce `1lh`), a wysokość docelowa rozwinięcia jest mierzona dopiero PO
// ich przywróceniu, w `useLayoutEffect` - przed pierwszym malowaniem.
//
// „…WIĘCEJ" MÓWI TYM SAMYM STOPNIEM CO TEKST. Typografia leży na opakowaniu,
// a przycisk ją dziedziczy (`[font-size:inherit]!` - globalny atom przycisku
// wymuszał 12 px pod tekstem 13 px, więc dopisek wyglądał na przyklejony).
//
// FOKUS W UKRYTEJ CZĘŚCI. Pudełko jest `overflow: clip`, nie `hidden`: Tab
// na link poniżej trzeciej linii nie przewija go już w środku, a wejście
// fokusu w treść rozwija ją - odnośnik nie może dostać fokusu niewidoczny.
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

const SETTLE_MS = 340;

export function ClubFeedText({
  children,
  lines = 3,
  className,
}: {
  children: ReactNode;
  /** Ile linii widać przed rozwinięciem. */
  lines?: number;
  /** Typografia kontenera - `lh` liczy się z JEGO wysokości linii, a „…więcej"
   *  dziedziczy z niej rozmiar. */
  className?: string;
}) {
  const { t } = useTranslation();
  const id = useId();
  const ref = useRef<HTMLDivElement | null>(null);
  const [overflowing, setOverflowing] = useState(false);
  // `collapsed` -> `opening` (animowana wysokość w px) -> `open` (bez limitu).
  const [phase, setPhase] = useState<"collapsed" | "opening" | "open">("collapsed");
  const [target, setTarget] = useState(0);

  useEffect(() => {
    const node = ref.current;
    if (node === null || phase !== "collapsed") return;
    const measure = (): void => setOverflowing(node.scrollHeight - node.clientHeight > 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [phase, children]);

  useEffect(() => {
    if (phase !== "opening") return;
    const timer = setTimeout(() => setPhase("open"), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  // Pomiar PO przywróceniu odstępów, przed malowaniem - przejście startuje
  // z trzech linii i kończy na prawdziwej wysokości całości.
  useLayoutEffect(() => {
    if (phase === "opening") setTarget(ref.current?.scrollHeight ?? 0);
  }, [phase]);

  const expand = (moveFocus: boolean): void => {
    setTarget(0);
    setPhase("opening");
    if (moveFocus) ref.current?.focus({ preventScroll: true });
  };

  return (
    // Długie tokeny (adres zapisu, numer aktu) łamią się w dowolnym miejscu -
    // w przyciętym pudełku `overflow: clip` ucięłyby się bez śladu.
    <div className={cn("relative [overflow-wrap:anywhere]", className)}>
      <div
        ref={ref}
        id={id}
        tabIndex={-1}
        data-feed-text={phase}
        onFocus={(event) => {
          if (phase === "collapsed" && overflowing && event.target !== event.currentTarget) {
            expand(false);
          }
        }}
        className={cn(
          "overflow-clip outline-none",
          "transition-[max-height] duration-300 ease-out motion-reduce:transition-none",
          phase === "collapsed" && "[&_*]:my-0!",
        )}
        style={
          phase === "collapsed" || (phase === "opening" && target === 0)
            ? { maxHeight: `calc(${lines} * 1lh)` }
            : phase === "opening"
              ? { maxHeight: `${target}px` }
              : undefined
        }
      >
        {children}
      </div>
      {phase === "collapsed" && overflowing ? (
        <button
          type="button"
          onClick={() => expand(true)}
          aria-expanded={false}
          aria-controls={id}
          data-testid="club-feed-more"
          className={cn(
            "absolute bottom-0 right-0 pl-14 font-medium text-muted-foreground [font-size:inherit]! [line-height:inherit]",
            "bg-gradient-to-r from-transparent via-card via-50% to-card",
            "transition-colors hover:text-primary hover:underline focus-visible:text-primary focus-visible:underline focus-visible:outline-none",
          )}
        >
          {t("club.hub.feed.more")}
        </button>
      ) : null}
    </div>
  );
}
