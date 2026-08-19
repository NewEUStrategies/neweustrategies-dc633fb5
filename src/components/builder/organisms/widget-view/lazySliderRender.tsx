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
import type { SliderRender as SliderRenderImpl } from "@/lib/builder/sliderVariants";
import { withSuspense } from "./lazySuspense";

const SliderRenderLazy = lazy(() =>
  import("@/lib/builder/sliderVariants").then((m) => ({ default: m.SliderRender })),
) as ComponentType<ComponentProps<typeof SliderRenderImpl>>;

export const SliderRender = withSuspense(SliderRenderLazy);
