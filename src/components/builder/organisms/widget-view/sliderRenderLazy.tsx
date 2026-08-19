// Leniwe wiązanie renderera slidera - WYDZIELONE Z `lazyWidgets.tsx`.
//
// Jedyny powód istnienia tego pliku: `PostsSliderWidget.tsx` potrzebuje
// `SliderRender`, a sam jest ładowany przez rejestr `lazyWidgets` - import
// wprost z rejestru zamykał cykl, który zakleszczał testy podmieniające rejestr
// na lustro eager (pełne uzasadnienie w nagłówku `lazyBoundary.tsx`).
//
// GRANICA PODZIAŁU KODU JEST TA SAMA: ten sam `React.lazy`, ten sam dynamiczny
// import `@/lib/builder/sliderVariants`, ten sam chunk, ten sam fallback.
// Rejestr `lazyWidgets` tylko re-eksportuje to wiązanie, więc dla wszystkich
// dotychczasowych konsumentów nic się nie zmienia.
import { lazy, type ComponentProps, type ComponentType } from "react";
import type { SliderRender as SliderRenderImpl } from "@/lib/builder/sliderVariants";
import { withSuspense } from "./lazyBoundary";

const SliderRenderLazy = lazy(() =>
  import("@/lib/builder/sliderVariants").then((m) => ({ default: m.SliderRender })),
) as ComponentType<ComponentProps<typeof SliderRenderImpl>>;

export const SliderRender = withSuspense(SliderRenderLazy);
