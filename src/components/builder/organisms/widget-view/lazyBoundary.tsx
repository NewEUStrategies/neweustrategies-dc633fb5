// Granica Suspense dla leniwych widgetów - WYDZIELONA Z `lazyWidgets.tsx`.
//
// DLACZEGO. `PostsSliderWidget.tsx` jest ładowany PRZEZ rejestr `lazyWidgets`,
// a jednocześnie potrzebuje z niego `SliderRender` - czyli rejestr importuje
// widget, a widget rejestr. W produkcji ten cykl jest nieszkodliwy (bundler go
// rozplątuje, oba wiązania są leniwe), ale ZAKLESZCZA testy, które podmieniają
// rejestr na lustro eager (`src/test/eagerWidgetChunks.tsx`):
//
//   lazyWidgets (mock) → eagerWidgetChunks → PostsSliderWidget → lazyWidgets (mock)
//
// Fabryka `vi.mock` czeka wtedy na moduł, którego rozwiązanie czeka na nią.
// Worker vitest nie kończy się nigdy, a CAŁA suita staje na komunikacie
// „Timeout terminating forks worker" - bez ani jednej czerwonej asercji, więc
// bez wskazówki, gdzie szukać.
//
// Wspólna granica mieszka tu, żeby `sliderRenderLazy.tsx` mógł jej użyć bez
// importowania rejestru. Zachowanie jest IDENTYCZNE: ten sam shimmer tylko
// w kanwie buildera, `null` na stronach publicznych (SSR wypełnia granicę).
import { Suspense, type ComponentType, type ReactElement } from "react";
import { useBuilderMode } from "@/lib/content-model/editorCanvas";

/** Builder-only shimmer; `null` on public pages (SSR fills the boundary). */
export function LazyFallback() {
  const inBuilder = useBuilderMode() !== null;
  if (!inBuilder) return null;
  return (
    <div
      aria-hidden="true"
      data-lazy-widget-fallback
      className="skeleton-shimmer"
      style={{ minHeight: 48, width: "100%", borderRadius: 8, opacity: 0.7 }}
    />
  );
}

export const FALLBACK = <LazyFallback />;

/** Wrap a `React.lazy` chunk in Suspense + typed prop forwarding. */
export function withSuspense<P>(Lazy: ComponentType<P>): (props: P) => ReactElement {
  return function Suspended(props: P) {
    return (
      <Suspense fallback={FALLBACK}>
        {/* @ts-expect-error - React.lazy component signature is compatible at runtime. */}
        <Lazy {...props} />
      </Suspense>
    );
  };
}
