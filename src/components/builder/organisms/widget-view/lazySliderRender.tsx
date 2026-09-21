// Leniwy `SliderRender` - wydzielony z `lazyWidgets.tsx`, żeby konsument
// (`PostsSliderWidget.tsx`) nie musiał importować całego rejestru.
//
// Granica podziału kodu jest DOKŁADNIE ta sama co wcześniej:
// `lazy(() => import("@/lib/builder/sliderVariants"))`, więc renderer slidera
// zostaje w swoim własnym chunku, a `sliderVariants` nie wpada do chunku
// wejściowego (tego pilnują `check:bundle` i `check:entry-purity`).
// `lazyWidgets.tsx` re-eksportuje `SliderRender` stąd, więc jego publiczny
// kontrakt eksportów - i lustro `src/test/eagerWidgetChunks.tsx` - są bez zmian.
//
// Powód wydzielenia (zakleszczenie w testach): patrz nagłówek `lazySuspense.tsx`.
//
// ZASADA: czysta glue, wyłączona z pomiaru pokrycia - zero logiki widgetu.
import { lazy, type ComponentProps, type ComponentType } from "react";
import { SliderRender as SliderRenderImpl } from "@/lib/builder/sliderVariants";
import { withSuspense } from "./lazySuspense";
import { createIsomorphicFn } from "@tanstack/react-start";

// Nested inside PostsSliderWidget: resolving only its outer chunk would still
// leave an empty hero in the first server shell. Keep the client edge lazy.
const getSliderRenderer = createIsomorphicFn()
  .server(() => SliderRenderImpl)
  .client(
    () =>
      lazy(() =>
        import("@/lib/builder/sliderVariants").then((m) => ({ default: m.SliderRender })),
      ) as ComponentType<ComponentProps<typeof SliderRenderImpl>>,
  );
const SliderRenderLazy = getSliderRenderer();

export const SliderRender = withSuspense(SliderRenderLazy);
