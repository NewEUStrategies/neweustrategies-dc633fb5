// Rozgrzewanie najczęstszych leniwych chunków widgetów PO hydratacji.
//
// PO CO. Podział widgetów po typie (lazyWidgets) zdejmuje ich kod z chunku
// wejściowego, a SSR wypełnia każdą granicę Suspense przy pierwszym wejściu -
// tam nic nie miga. Luka zostaje przy nawigacji SPA: granica montowana w
// tranzycji NA NOWEJ stronie może pokazać pusty fallback, dopóki chunk się nie
// pobierze (uwaga z recenzji PR #240). Zamiast wracać do eager (odtworzyłoby to
// 442 kB źródeł w entry), po pierwszym malowaniu dociągamy w czasie BEZCZYNNOŚCI
// chunki typów, które niosą główną ścieżkę czytelniczą: tekst (RichHtmlView),
// listingi wpisów (PostListView) i dynamiczne tagi szablonu wpisu
// (DynamicTagWidgets). Po rozgrzaniu nawigacja SPA montuje je z cache HTTP -
// bez pustego kadru i bez podatku w chunku wejściowym.
//
// CZEGO CELOWO NIE ROBIMY: nie rozgrzewamy widgetów chrome (search-button,
// account-link, menu językowe) - te renderują się już na BIEŻĄCEJ stronie,
// więc React pobiera ich chunki w trakcie hydratacji bez naszej pomocy.

/** Jedno odroczenie na proces - kolejne wywołania są bezkosztowe. */
let scheduled = false;

/** Sygnał oszczędzania transferu: uszanuj `Save-Data` zamiast dociągać JS. */
function saveDataRequested(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return connection?.saveData === true;
}

type Defer = (run: () => void) => void;

/** `requestIdleCallback` z fallbackiem czasowym (Safari nie wspiera rIC). */
const idleDefer: Defer = (run) => {
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(() => run(), { timeout: 4000 });
    return;
  }
  setTimeout(run, 1500);
};

/**
 * Zaplanuj rozgrzanie wspólnych chunków widgetów. Wołane z efektu w
 * BuilderRenderer (czyli na każdej stronie publicznej i w kanwie), działa raz.
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
