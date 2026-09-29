import { afterPageLoad } from "@/lib/performance/afterPageLoad";
// Reading widget code is warmed after sustained hover/focus on an internal
// AppLink. Warming all six modules at hydration downloaded article renderers
// on the homepage even when no article was opened. React.lazy still fetches
// widgets needed by the current page; intent warming helps the next navigation.

/** Jedno odroczenie na proces - kolejne wywołania są bezkosztowe. */
let scheduled = false;

/** Sygnał oszczędzania transferu: uszanuj `Save-Data` zamiast dociągać JS. */
function saveDataRequested(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return connection?.saveData === true;
}

type Defer = (run: () => void) => void;

/** Wait for load before considering CPU idle; images may still be in flight. */
const idleDefer: Defer = (run) => {
  afterPageLoad(run, 4000);
};

/**
 * Zaplanuj rozgrzanie wspólnych chunków widgetów po intencji nawigacji.
 * Działa raz na sesję aplikacji.
 * `defer` jest wstrzykiwalne wyłącznie dla testów.
 */
export function warmCommonWidgetChunks(defer: Defer = idleDefer): void {
  if (typeof window === "undefined" || scheduled) return;
  scheduled = true;
  if (saveDataRequested()) return;
  defer(() => {
    // Te same specyfikatory co w rejestrze lazyWidgets - Rollup rozwiązuje je
    // do tych samych chunków, więc rozgrzanie == wypełnienie cache przeglądarki.
    // Warming is optional. Offline/stale chunks must not create unhandled
    // rejections; React.lazy will report a failure if the widget is needed.
    void Promise.allSettled([
      import("./RichHtmlView"),
      import("./PostListView"),
      import("./DynamicTagWidgets"),
      // Ścieżka hero strony głównej: PostsSliderWidget + silnik wariantów
      // slidera. Loader "/" rozgrzewa DANE slidera, ale bez tych chunków
      // nawigacja SPA z artykułu na "/" montowała największy element nad
      // zgięciem jako pusty fallback Suspense, dopóki kod się nie pobrał.
      import("./PostsSliderWidget"),
      import("@/lib/builder/sliderVariants"),
      // Etykiety sekcji: od wydzielenia z SimpleWidgets (chunk wejściowy) są
      // lazy, a występują nad zgięciem większości stron z sekcjami buildera -
      // rozgrzanie eliminuje pusty kadr etykiety przy nawigacji SPA.
      import("@/lib/builder/sectionLabelVariants"),
    ]);
  });
}

/** Wyłącznie dla testów: zresetuj pamięć pojedynczego zaplanowania. */
export function resetWarmWidgetChunksForTests(): void {
  scheduled = false;
}
