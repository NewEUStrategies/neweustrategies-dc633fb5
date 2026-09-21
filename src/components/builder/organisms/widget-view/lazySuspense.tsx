// Wspólna glue podziału kodu dla rejestru leniwych widgetów: shimmer kanwy
// (`LazyFallback`) i opakowanie `React.lazy` w Suspense (`withSuspense`).
//
// PO CO OSOBNY MODUŁ. Do 2026-08-18 oba helpery były prywatne w
// `lazyWidgets.tsx`, więc każdy moduł, który potrzebował JEDNEGO leniwego
// komponentu z tego rejestru, musiał zaimportować CAŁY rejestr. Dla
// `PostsSliderWidget.tsx` (sam ładowany leniwie przez ten rejestr) tworzyło to
// cykl `lazyWidgets -> PostsSliderWidget -> lazyWidgets`. W produkcji cykl
// rozwiązywał się po ESM-owemu, ale w testach, gdzie rejestr jest podmieniany
// fabryką `vi.mock(... , () => import("@/test/eagerWidgetChunks"))`, fabryka
// czekała na import, który czekał na tę samą fabrykę - i przebieg wisiał do
// końca świata. Szczegóły i lista poszkodowanych plików: patrz
// docs/WDROZENIE_ZAKLESZCZENIE_LAZYWIDGETS_2026-08-18.md.
//
// ZASADA: ten plik to CZYSTA glue (jak `lazyWidgets.tsx`) - jest wyłączony
// z pomiaru pokrycia i nie wolno wkładać tu logiki widgetu.
import { memo, Suspense, type ComponentType, type NamedExoticComponent } from "react";
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

const FALLBACK = <LazyFallback />;

/** Wrap a `React.lazy` chunk in Suspense + typed prop forwarding. */
export function withSuspense<P extends object>(Lazy: ComponentType<P>): NamedExoticComponent<P> {
  // Parent queries and translation readiness can update during hydration.
  // Identical widget props must not invalidate its still-pending SSR boundary.
  return memo(function Suspended(props: P) {
    return (
      <Suspense fallback={FALLBACK}>
        <Lazy {...props} />
      </Suspense>
    );
  });
}
