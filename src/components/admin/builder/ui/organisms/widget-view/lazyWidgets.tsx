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
// Fallback contract: on PUBLIC pages it stays `null` (SSR fills the boundary,
// so it is ~never shown and zero layout shift is guaranteed). Inside the
// BUILDER canvas — a pure client render where the chunk genuinely loads on
// first mount — `null` made the widget blink out of existence for a moment,
// so the canvas shows a shimmer placeholder instead.
//
// What stays EAGER (deliberately): layout-critical, frequently above-the-fold
// or navigation widgets - heading, text, button, nav-link, mega-menu,
// post-list / carousel, categories, tags, cta, dark-featured-card. Splitting
// those would risk a visible pop-in on first paint.
import { lazy, Suspense, type ComponentProps } from "react";
import { useBuilderMode } from "@/lib/builder/modeContext";

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

const NewsletterFormImpl = lazy(() =>
  import("@/components/NewsletterForm").then((m) => ({ default: m.NewsletterForm })),
);
export function NewsletterForm(props: ComponentProps<typeof NewsletterFormImpl>) {
  return (
    <Suspense fallback={FALLBACK}>
      <NewsletterFormImpl {...props} />
    </Suspense>
  );
}

const JoinUsFormImpl = lazy(() =>
  import("@/components/interests/JoinUsForm").then((m) => ({ default: m.JoinUsForm })),
);
export function JoinUsForm(props: ComponentProps<typeof JoinUsFormImpl>) {
  return (
    <Suspense fallback={FALLBACK}>
      <JoinUsFormImpl {...props} />
    </Suspense>
  );
}

const InterestsCustomizerImpl = lazy(() =>
  import("@/components/interests/InterestsCustomizer").then((m) => ({
    default: m.InterestsCustomizer,
  })),
);
export function InterestsCustomizer(props: ComponentProps<typeof InterestsCustomizerImpl>) {
  return (
    <Suspense fallback={FALLBACK}>
      <InterestsCustomizerImpl {...props} />
    </Suspense>
  );
}

const TtsPlayerHostImpl = lazy(() =>
  import("@/components/admin/builder/ui/molecules/TtsPlayerHost").then((m) => ({
    default: m.TtsPlayerHost,
  })),
);
export function TtsPlayerHost(props: ComponentProps<typeof TtsPlayerHostImpl>) {
  return (
    <Suspense fallback={FALLBACK}>
      <TtsPlayerHostImpl {...props} />
    </Suspense>
  );
}

const PodcastLatestViewImpl = lazy(() =>
  import("@/components/admin/builder/ui/organisms/widget-view/PodcastLatestView").then((m) => ({
    default: m.PodcastLatestView,
  })),
);
export function PodcastLatestView(props: ComponentProps<typeof PodcastLatestViewImpl>) {
  return (
    <Suspense fallback={FALLBACK}>
      <PodcastLatestViewImpl {...props} />
    </Suspense>
  );
}

const WebStoriesCarouselViewImpl = lazy(() =>
  import("@/components/admin/builder/ui/organisms/widget-view/WebStoriesCarouselView").then(
    (m) => ({ default: m.WebStoriesCarouselView }),
  ),
);
export function WebStoriesCarouselView(props: ComponentProps<typeof WebStoriesCarouselViewImpl>) {
  return (
    <Suspense fallback={FALLBACK}>
      <WebStoriesCarouselViewImpl {...props} />
    </Suspense>
  );
}

const NewsTickerViewImpl = lazy(() =>
  import("@/components/admin/builder/ui/organisms/widget-view/NewsTickerView").then((m) => ({
    default: m.NewsTickerView,
  })),
);
export function NewsTickerView(props: ComponentProps<typeof NewsTickerViewImpl>) {
  return (
    <Suspense fallback={FALLBACK}>
      <NewsTickerViewImpl {...props} />
    </Suspense>
  );
}

const RatedListViewImpl = lazy(() =>
  import("@/components/admin/builder/ui/organisms/widget-view/RatedListView").then((m) => ({
    default: m.RatedListView,
  })),
);
export function RatedListView(props: ComponentProps<typeof RatedListViewImpl>) {
  return (
    <Suspense fallback={FALLBACK}>
      <RatedListViewImpl {...props} />
    </Suspense>
  );
}

const TabsBlockImpl = lazy(() =>
  import("@/components/admin/builder/ui/organisms/widget-view/TabsBlock").then((m) => ({
    default: m.TabsBlock,
  })),
);
export function TabsBlock(props: ComponentProps<typeof TabsBlockImpl>) {
  return (
    <Suspense fallback={FALLBACK}>
      <TabsBlockImpl {...props} />
    </Suspense>
  );
}

const AdSlotByIdImpl = lazy(() =>
  import("@/components/ads/AdSlotById").then((m) => ({ default: m.AdSlotById })),
);
export function AdSlotById(props: ComponentProps<typeof AdSlotByIdImpl>) {
  return (
    <Suspense fallback={FALLBACK}>
      <AdSlotByIdImpl {...props} />
    </Suspense>
  );
}

// Donations widget (public aggregate stats + CTA). Split off so pages that
// don't render it never pay for the query client wrapper / server-fn hook path.
const DonationsWidgetViewImpl = lazy(() =>
  import("@/components/donations/DonationsWidgetView").then((m) => ({
    default: m.DonationsWidgetView,
  })),
);
export function DonationsWidgetView(props: ComponentProps<typeof DonationsWidgetViewImpl>) {
  return (
    <Suspense fallback={FALLBACK}>
      <DonationsWidgetViewImpl {...props} />
    </Suspense>
  );
}

// The rich-text widget pulls in the whole blocks renderer (DOMPurify + every
// block view), so it is split out of the shared Header/Footer bundle and only
// downloaded on pages that actually embed rich content.
const RichTextViewImpl = lazy(() =>
  import("@/components/admin/builder/ui/organisms/widget-view/RichTextView").then((m) => ({
    default: m.RichTextView,
  })),
);
export function RichTextView(props: ComponentProps<typeof RichTextViewImpl>) {
  return (
    <Suspense fallback={FALLBACK}>
      <RichTextViewImpl {...props} />
    </Suspense>
  );
}

// The slider renderer is the single heaviest widget module (5 styled
// variants, drag/autoplay machinery, ~53 KB source). Pages without a slider
// never download it; SSR streaming keeps the hero HTML identical.
const SliderRenderImpl = lazy(() =>
  import("@/lib/builder/sliderVariants").then((m) => ({ default: m.SliderRender })),
);
export function SliderRender(props: ComponentProps<typeof SliderRenderImpl>) {
  return (
    <Suspense fallback={FALLBACK}>
      <SliderRenderImpl {...props} />
    </Suspense>
  );
}

// Animated headings carry a large per-variant animation catalog; they animate
// in anyway, so the deferred chunk is imperceptible.
const AnimatedHeadingRenderImpl = lazy(() =>
  import("@/lib/builder/animatedHeadingVariants").then((m) => ({
    default: m.AnimatedHeadingRender,
  })),
);
export function AnimatedHeadingRender(props: ComponentProps<typeof AnimatedHeadingRenderImpl>) {
  return (
    <Suspense fallback={FALLBACK}>
      <AnimatedHeadingRenderImpl {...props} />
    </Suspense>
  );
}

// Data-viz widgets pull in the whole SVG chart engine (scales, tooltips,
// choropleth) - split out so pages without charts never download it.
const ChartWidgetViewImpl = lazy(() =>
  import("@/components/admin/builder/ui/organisms/widget-view/DataVizWidgets").then((m) => ({
    default: m.ChartWidgetView,
  })),
);
export function ChartWidgetView(props: ComponentProps<typeof ChartWidgetViewImpl>) {
  return (
    <Suspense fallback={FALLBACK}>
      <ChartWidgetViewImpl {...props} />
    </Suspense>
  );
}

const DataMapWidgetViewImpl = lazy(() =>
  import("@/components/admin/builder/ui/organisms/widget-view/DataVizWidgets").then((m) => ({
    default: m.DataMapWidgetView,
  })),
);
export function DataMapWidgetView(props: ComponentProps<typeof DataMapWidgetViewImpl>) {
  return (
    <Suspense fallback={FALLBACK}>
      <DataMapWidgetViewImpl {...props} />
    </Suspense>
  );
}
