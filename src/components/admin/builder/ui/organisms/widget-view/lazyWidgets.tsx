// Code-split registry for heavy, non-critical builder widgets.
//
// WidgetView is pulled into the shared/entry bundle on every page (Header and
// Footer both render BuilderRenderer -> WidgetView). Statically importing every
// widget renderer therefore shipped forms, the TTS player, ad slots, podcast /
// web-stories / news-ticker / rated-list / tabs renderers to every visitor up
// front, even on pages that never render them.
//
// Each widget below is wrapped in React.lazy + Suspense so its code lives in a
// separate chunk loaded on demand. With TanStack Start's streaming SSR the
// dynamic import resolves on the server, so the rendered HTML is identical -
// only the *client* download is deferred.
//
// Runtime uses `React.lazy(() => import(...))`; types come from `import type`
// so the compiler still sees widget prop shapes without dragging the widget
// module into this file's static graph (the split boundary would otherwise
// collapse - the earlier version imported the real implementations statically
// which defeated the whole point of the file).
//
// Fallback contract: on PUBLIC pages it stays `null` (SSR fills the boundary,
// so it is ~never shown and zero layout shift is guaranteed). Inside the
// BUILDER canvas - a pure client render where the chunk genuinely loads on
// first mount - `null` made the widget blink out of existence for a moment,
// so the canvas shows a shimmer placeholder instead.
//
// What stays EAGER (deliberately): layout-critical, frequently above-the-fold
// or navigation widgets - heading, text, button, nav-link, mega-menu,
// post-list / carousel, categories, tags, cta, dark-featured-card. Splitting
// those would risk a visible pop-in on first paint.
import { lazy, Suspense, type ComponentProps, type ComponentType } from "react";
import { useBuilderMode } from "@/lib/builder/modeContext";

import type { NewsletterForm as NewsletterFormImpl } from "@/components/NewsletterForm";
import type { JoinUsForm as JoinUsFormImpl } from "@/components/interests/JoinUsForm";
import type { InterestsCustomizer as InterestsCustomizerImpl } from "@/components/interests/InterestsCustomizer";
import type { TtsPlayerHost as TtsPlayerHostImpl } from "@/components/admin/builder/ui/molecules/TtsPlayerHost";
import type { PodcastLatestView as PodcastLatestViewImpl } from "./PodcastLatestView";
import type { WebStoriesCarouselView as WebStoriesCarouselViewImpl } from "./WebStoriesCarouselView";
import type { NewsTickerView as NewsTickerViewImpl } from "./NewsTickerView";
import type { RatedListView as RatedListViewImpl } from "./RatedListView";
import type { TabsBlock as TabsBlockImpl } from "./TabsBlock";
import type { AdSlotById as AdSlotByIdImpl } from "@/components/ads/AdSlotById";
import type { DonationsWidgetView as DonationsWidgetViewImpl } from "@/components/donations/DonationsWidgetView";
import type { RichTextView as RichTextViewImpl } from "./RichTextView";
import type { SliderRender as SliderRenderImpl } from "@/lib/builder/sliderVariants";
import type { AnimatedHeadingRender as AnimatedHeadingRenderImpl } from "@/lib/builder/animatedHeadingVariants";
import type {
  ChartWidgetView as ChartWidgetViewImpl,
  DataMapWidgetView as DataMapWidgetViewImpl,
} from "./DataVizWidgets";
import type {
  TimelineWidgetView as TimelineWidgetViewImpl,
  SankeyWidgetView as SankeyWidgetViewImpl,
  CompareWidgetView as CompareWidgetViewImpl,
  RiskMatrixWidgetView as RiskMatrixWidgetViewImpl,
  IndicatorWidgetView as IndicatorWidgetViewImpl,
  NetworkWidgetView as NetworkWidgetViewImpl,
  CorridorMapWidgetView as CorridorMapWidgetViewImpl,
  SourcesWidgetView as SourcesWidgetViewImpl,
  MethodologyWidgetView as MethodologyWidgetViewImpl,
} from "./FeatureWidgets";

/** Builder-only shimmer; `null` on public pages (SSR fills the boundary). */
function LazyFallback() {
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
function withSuspense<P>(Lazy: ComponentType<P>): (props: P) => JSX.Element {
  return function Suspended(props: P) {
    return (
      <Suspense fallback={FALLBACK}>
        {/* @ts-expect-error - React.lazy component signature is compatible at runtime. */}
        <Lazy {...props} />
      </Suspense>
    );
  };
}

// --- form / interaction widgets -------------------------------------------
const NewsletterFormLazy = lazy(() =>
  import("@/components/NewsletterForm").then((m) => ({ default: m.NewsletterForm })),
) as ComponentType<ComponentProps<typeof NewsletterFormImpl>>;
export const NewsletterForm = withSuspense(NewsletterFormLazy);

const JoinUsFormLazy = lazy(() =>
  import("@/components/interests/JoinUsForm").then((m) => ({ default: m.JoinUsForm })),
) as ComponentType<ComponentProps<typeof JoinUsFormImpl>>;
export const JoinUsForm = withSuspense(JoinUsFormLazy);

const InterestsCustomizerLazy = lazy(() =>
  import("@/components/interests/InterestsCustomizer").then((m) => ({
    default: m.InterestsCustomizer,
  })),
) as ComponentType<ComponentProps<typeof InterestsCustomizerImpl>>;
export const InterestsCustomizer = withSuspense(InterestsCustomizerLazy);

const TtsPlayerHostLazy = lazy(() =>
  import("@/components/admin/builder/ui/molecules/TtsPlayerHost").then((m) => ({
    default: m.TtsPlayerHost,
  })),
) as ComponentType<ComponentProps<typeof TtsPlayerHostImpl>>;
export const TtsPlayerHost = withSuspense(TtsPlayerHostLazy);

// --- media / listing widgets ----------------------------------------------
const PodcastLatestViewLazy = lazy(() =>
  import("./PodcastLatestView").then((m) => ({ default: m.PodcastLatestView })),
) as ComponentType<ComponentProps<typeof PodcastLatestViewImpl>>;
export const PodcastLatestView = withSuspense(PodcastLatestViewLazy);

const WebStoriesCarouselViewLazy = lazy(() =>
  import("./WebStoriesCarouselView").then((m) => ({ default: m.WebStoriesCarouselView })),
) as ComponentType<ComponentProps<typeof WebStoriesCarouselViewImpl>>;
export const WebStoriesCarouselView = withSuspense(WebStoriesCarouselViewLazy);

const NewsTickerViewLazy = lazy(() =>
  import("./NewsTickerView").then((m) => ({ default: m.NewsTickerView })),
) as ComponentType<ComponentProps<typeof NewsTickerViewImpl>>;
export const NewsTickerView = withSuspense(NewsTickerViewLazy);

const RatedListViewLazy = lazy(() =>
  import("./RatedListView").then((m) => ({ default: m.RatedListView })),
) as ComponentType<ComponentProps<typeof RatedListViewImpl>>;
export const RatedListView = withSuspense(RatedListViewLazy);

const TabsBlockLazy = lazy(() =>
  import("./TabsBlock").then((m) => ({ default: m.TabsBlock })),
) as ComponentType<ComponentProps<typeof TabsBlockImpl>>;
export const TabsBlock = withSuspense(TabsBlockLazy);

// --- ads / donations ------------------------------------------------------
const AdSlotByIdLazy = lazy(() =>
  import("@/components/ads/AdSlotById").then((m) => ({ default: m.AdSlotById })),
) as ComponentType<ComponentProps<typeof AdSlotByIdImpl>>;
export const AdSlotById = withSuspense(AdSlotByIdLazy);

const DonationsWidgetViewLazy = lazy(() =>
  import("@/components/donations/DonationsWidgetView").then((m) => ({
    default: m.DonationsWidgetView,
  })),
) as ComponentType<ComponentProps<typeof DonationsWidgetViewImpl>>;
export const DonationsWidgetView = withSuspense(DonationsWidgetViewLazy);

// --- rich text (pulls the blocks renderer + sanitizer) --------------------
const RichTextViewLazy = lazy(() =>
  import("./RichTextView").then((m) => ({ default: m.RichTextView })),
) as ComponentType<ComponentProps<typeof RichTextViewImpl>>;
export const RichTextView = withSuspense(RichTextViewLazy);

// --- heavy visual widgets --------------------------------------------------
const SliderRenderLazy = lazy(() =>
  import("@/lib/builder/sliderVariants").then((m) => ({ default: m.SliderRender })),
) as ComponentType<ComponentProps<typeof SliderRenderImpl>>;
export const SliderRender = withSuspense(SliderRenderLazy);

const AnimatedHeadingRenderLazy = lazy(() =>
  import("@/lib/builder/animatedHeadingVariants").then((m) => ({
    default: m.AnimatedHeadingRender,
  })),
) as ComponentType<ComponentProps<typeof AnimatedHeadingRenderImpl>>;
export const AnimatedHeadingRender = withSuspense(AnimatedHeadingRenderLazy);

// --- data-viz (shared chart engine) ---------------------------------------
const ChartWidgetViewLazy = lazy(() =>
  import("./DataVizWidgets").then((m) => ({ default: m.ChartWidgetView })),
) as ComponentType<ComponentProps<typeof ChartWidgetViewImpl>>;
export const ChartWidgetView = withSuspense(ChartWidgetViewLazy);

const DataMapWidgetViewLazy = lazy(() =>
  import("./DataVizWidgets").then((m) => ({ default: m.DataMapWidgetView })),
) as ComponentType<ComponentProps<typeof DataMapWidgetViewImpl>>;
export const DataMapWidgetView = withSuspense(DataMapWidgetViewLazy);

// --- NES Digital Features (one shared "features" chunk) -------------------
const TimelineWidgetViewLazy = lazy(() =>
  import("./FeatureWidgets").then((m) => ({ default: m.TimelineWidgetView })),
) as ComponentType<ComponentProps<typeof TimelineWidgetViewImpl>>;
export const TimelineWidgetView = withSuspense(TimelineWidgetViewLazy);

const SankeyWidgetViewLazy = lazy(() =>
  import("./FeatureWidgets").then((m) => ({ default: m.SankeyWidgetView })),
) as ComponentType<ComponentProps<typeof SankeyWidgetViewImpl>>;
export const SankeyWidgetView = withSuspense(SankeyWidgetViewLazy);

const CompareWidgetViewLazy = lazy(() =>
  import("./FeatureWidgets").then((m) => ({ default: m.CompareWidgetView })),
) as ComponentType<ComponentProps<typeof CompareWidgetViewImpl>>;
export const CompareWidgetView = withSuspense(CompareWidgetViewLazy);

const RiskMatrixWidgetViewLazy = lazy(() =>
  import("./FeatureWidgets").then((m) => ({ default: m.RiskMatrixWidgetView })),
) as ComponentType<ComponentProps<typeof RiskMatrixWidgetViewImpl>>;
export const RiskMatrixWidgetView = withSuspense(RiskMatrixWidgetViewLazy);

const IndicatorWidgetViewLazy = lazy(() =>
  import("./FeatureWidgets").then((m) => ({ default: m.IndicatorWidgetView })),
) as ComponentType<ComponentProps<typeof IndicatorWidgetViewImpl>>;
export const IndicatorWidgetView = withSuspense(IndicatorWidgetViewLazy);

const NetworkWidgetViewLazy = lazy(() =>
  import("./FeatureWidgets").then((m) => ({ default: m.NetworkWidgetView })),
) as ComponentType<ComponentProps<typeof NetworkWidgetViewImpl>>;
export const NetworkWidgetView = withSuspense(NetworkWidgetViewLazy);

const CorridorMapWidgetViewLazy = lazy(() =>
  import("./FeatureWidgets").then((m) => ({ default: m.CorridorMapWidgetView })),
) as ComponentType<ComponentProps<typeof CorridorMapWidgetViewImpl>>;
export const CorridorMapWidgetView = withSuspense(CorridorMapWidgetViewLazy);

const SourcesWidgetViewLazy = lazy(() =>
  import("./FeatureWidgets").then((m) => ({ default: m.SourcesWidgetView })),
) as ComponentType<ComponentProps<typeof SourcesWidgetViewImpl>>;
export const SourcesWidgetView = withSuspense(SourcesWidgetViewLazy);

const MethodologyWidgetViewLazy = lazy(() =>
  import("./FeatureWidgets").then((m) => ({ default: m.MethodologyWidgetView })),
) as ComponentType<ComponentProps<typeof MethodologyWidgetViewImpl>>;
export const MethodologyWidgetView = withSuspense(MethodologyWidgetViewLazy);
