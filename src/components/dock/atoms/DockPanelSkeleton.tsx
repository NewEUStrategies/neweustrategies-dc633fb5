// Atom: szkielet panelu doku na czas dociągania jego paczki i pierwszego
// zapytania.
//
// ── CO ZASTĘPUJE ─────────────────────────────────────────────────────────
// `<Suspense fallback={null}>`. Po kliknięciu zakładki nie pojawiało się NIC,
// dopóki kod panelu nie dojechał z sieci - czyli jedyne potwierdzenie, że
// klik został przyjęty, dawała 700-milisekundowa animacja zakładki. To jest
// mierzalna część odczuwanej powolności, niezależna od samego transferu.
//
// ── DLACZEGO GEOMETRIA JEST PRZEPISANA Z `DockPanelShell` ────────────────
// Szkielet ma DOKŁADNIE ten sam prostokąt co prawdziwy panel
// (`rounded-[10px]`, obramowanie, `h-[70vh] max-h-[560px] sm:w-[380px]`).
// Gdyby był mniejszy, podmiana szkieletu na treść byłaby drugim przeskokiem
// układu - a szkielet istnieje właśnie po to, żeby przeskoku nie było.
// Zmiana wymiarów w `DockPanelShell` musi więc iść razem z tym plikiem;
// pilnuje tego `dockSkeletonGeometry.gate.test.tsx`.
//
// ── DLACZEGO OPÓŹNIONE WEJŚCIE ───────────────────────────────────────────
// Klatka `route-skeleton-in` startuje po 140 ms (`both`, więc do tego czasu
// element jest przezroczysty). Otwarcie z rozgrzanej paczki
// (`prefetchDockPanel` na najechanie) mieści się poniżej tego progu, więc
// użytkownik NIE widzi mignięcia szkieletu - dostaje od razu treść. Szkielet
// pokazuje się tylko wtedy, gdy naprawdę jest na co czekać. Ten sam wzorzec
// i ta sama klatka co `RouteLoadingSkeleton`.
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import "@/lib/i18n-dock";

/**
 * Szerokości wierszy szkieletu. Stała tablica, nie `Math.random()`: losowanie
 * w ciele renderu daje inny wynik na serwerze i na kliencie, czyli dokładnie
 * ten rozjazd pierwszego przejścia, którego pilnuje `ssrRenderSafety`.
 */
const ROW_WIDTHS = ["w-11/12", "w-3/4", "w-5/6", "w-2/3", "w-10/12", "w-7/12"] as const;

/** Wiersz listy - `.skeleton-shimmer` to wspólny połysk repozytorium. */
function Row({ className }: { className?: string }) {
  return <div className={cn("skeleton-shimmer rounded-[6px]", className)} />;
}

export interface DockPanelSkeletonProps {
  /**
   * Ile wierszy udawać. Domyślnie sześć - tyle mieści się w oknie panelu bez
   * przewijania, więc szkielet nie sugeruje dłuższej listy niż realna.
   */
  rows?: number;
  className?: string;
}

/**
 * Szkielet panelu narzędzia (zadania, notatki, zapisane, kalendarz).
 *
 * `role="status"` + `aria-live="polite"` + `aria-busy` to ta sama umowa, co
 * w granicy leniwej kasy (`LazyEmbeddedCheckoutDialog`): czytnik ekranu
 * dostaje jedno zwięzłe powiadomienie „wczytywanie", a nie ciszę.
 */
export function DockPanelSkeleton({ rows = 6, className }: DockPanelSkeletonProps) {
  const { t } = useTranslation();
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className={cn(
        "pointer-events-auto flex w-full flex-col overflow-hidden rounded-[10px] border border-border bg-card shadow-2xl",
        "h-[70vh] max-h-[560px] sm:w-[380px]",
        "animate-[route-skeleton-in_260ms_ease-out_140ms_both]",
        className,
      )}
      data-dock-skeleton
    >
      {/* Nagłówek: ikona + tytuł + przycisk zamknięcia - te same trzy pola. */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Row className="h-4 w-4 shrink-0 rounded-full" />
        <Row className="h-4 w-28" />
        <Row className="ml-auto h-6 w-6 shrink-0" />
      </div>
      {/* Pasek narzędzi panelu (pole tekstowe albo filtry). */}
      <div className="space-y-2 border-b border-border p-3">
        <Row className="h-9 w-full" />
        <div className="flex gap-1">
          <Row className="h-6 w-16" />
          <Row className="h-6 w-20" />
          <Row className="h-6 w-16" />
        </div>
      </div>
      {/* Nierówne szerokości wierszy czytają się jak lista tekstu; równe
          wyglądałyby jak tabela, czyli jak zawieszony interfejs. Wzorzec
          deterministyczny (modulo indeksu), bo losowość w renderze rozjeżdża
          pierwsze przejście serwera i klienta. */}
      <div className="min-h-0 flex-1 space-y-px overflow-hidden">
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="flex items-center gap-2 px-3 py-2.5">
            <Row className="h-4 w-4 shrink-0 rounded-full" />
            <Row className={cn("h-4", ROW_WIDTHS[index % ROW_WIDTHS.length])} />
          </div>
        ))}
      </div>
      <span className="sr-only">{t("dock.loading")}</span>
    </div>
  );
}

/**
 * Szkielet lewej szyny skrzynki czatu. Osobny, bo skrzynka nie jest oknem
 * w rogu - jest kolumną pełnej wysokości przy lewej krawędzi
 * (`w-[320px] max-w-[85vw]`, jak `ChatSideDrawer`).
 */
export function DockDrawerSkeleton({ bottomOffset }: { bottomOffset: number }) {
  const { t } = useTranslation();
  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-40 flex"
      style={{ bottom: `${Math.max(bottomOffset, 0)}px` }}
    >
      <div
        role="status"
        aria-live="polite"
        aria-busy="true"
        data-dock-skeleton
        className={cn(
          "pointer-events-auto flex h-full w-[320px] max-w-[85vw] flex-col border-r border-border/70",
          "bg-card/95 shadow-xl backdrop-blur-md supports-[backdrop-filter]:bg-card/80",
          "animate-[route-skeleton-in_260ms_ease-out_140ms_both]",
        )}
      >
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <Row className="h-4 w-4 shrink-0 rounded-full" />
          <Row className="h-4 w-20" />
          <Row className="ml-auto h-5 w-16" />
        </div>
        <div className="space-y-2 border-b border-border p-2">
          <Row className="h-8 w-full" />
          <div className="flex gap-1.5">
            <Row className="h-6 w-16" />
            <Row className="h-6 w-16" />
            <Row className="h-6 w-20" />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          {Array.from({ length: 7 }, (_, index) => (
            <div key={index} className="flex items-center gap-2 px-3 py-2.5">
              <Row className="h-8 w-8 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <Row className="h-3.5 w-2/3" />
                <Row className="h-3 w-5/6" />
              </div>
            </div>
          ))}
        </div>
        <span className="sr-only">{t("dock.loading")}</span>
      </div>
    </div>
  );
}
