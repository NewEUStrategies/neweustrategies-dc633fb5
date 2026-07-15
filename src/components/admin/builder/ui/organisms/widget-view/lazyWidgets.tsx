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
import { Suspense, type ComponentProps } from "react";
import { useBuilderMode } from "@/lib/builder/modeContext";
import { NewsletterForm as NewsletterFormImpl } from "@/components/NewsletterForm";
import { JoinUsForm as JoinUsFormImpl } from "@/components/interests/JoinUsForm";
import { InterestsCustomizer as InterestsCustomizerImpl } from "@/components/interests/InterestsCustomizer";
import { TtsPlayerHost as TtsPlayerHostImpl } from "@/components/admin/builder/ui/molecules/TtsPlayerHost";
import { PodcastLatestView as PodcastLatestViewImpl } from "./PodcastLatestView";
import { WebStoriesCarouselView as WebStoriesCarouselViewImpl } from "./WebStoriesCarouselView";
import { NewsTickerView as NewsTickerViewImpl } from "./NewsTickerView";
import { RatedListView as RatedListViewImpl } from "./RatedListView";
import { TabsBlock as TabsBlockImpl } from "./TabsBlock";
import { AdSlotById as AdSlotByIdImpl } from "@/components/ads/AdSlotById";
import { DonationsWidgetView as DonationsWidgetViewImpl } from "@/components/donations/DonationsWidgetView";
import { RichTextView as RichTextViewImpl } from "./RichTextView";
import { SliderRender as SliderRenderImpl } from "@/lib/builder/sliderVariants";
import { AnimatedHeadingRender as AnimatedHeadingRenderImpl } from "@/lib/builder/animatedHeadingVariants";
import {
  ChartWidgetView as ChartWidgetViewImpl,
  DataMapWidgetView as DataMapWidgetViewImpl,
} from "./DataVizWidgets";
import {
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

export function NewsletterForm(props: ComponentProps<typeof NewsletterFormImpl>) {
  return (
    <Suspense fallback={FALLBACK}>
      <NewsletterFormImpl {...props} />
    </Suspense>
  );
}

export function JoinUsForm(props: ComponentProps<typeof JoinUsFormImpl>) {
  return (
    <Suspense fallback={FALLBACK}>
      <JoinUsFormImpl {...props} />
    </Suspense>
  );
}

export function InterestsCustomizer(props: ComponentProps<typeof InterestsCustomizerImpl>) {
  return (
    <Suspense fallback={FALLBACK}>
      <InterestsCustomizerImpl {...props} />
    </Suspense>
  );
}

export function TtsPlayerHost(props: ComponentProps<typeof TtsPlayerHostImpl>) {
  return (
    <Suspense fallback={FALLBACK}>
      <TtsPlayerHostImpl {...props} />
    </Suspense>
  );
}

export function PodcastLatestView(props: ComponentProps<typeof PodcastLatestViewImpl>) {
  return (
    <Suspense fallback={FALLBACK}>
      <PodcastLatestViewImpl {...props} />
    </Suspense>
  );
}

export function WebStoriesCarouselView(props: ComponentProps<typeof WebStoriesCarouselViewImpl>) {
  return (
    <Suspense fallback={FALLBACK}>
      <WebStoriesCarouselViewImpl {...props} />
    </Suspense>
  );
}

export function NewsTickerView(props: ComponentProps<typeof NewsTickerViewImpl>) {
  return (
    <Suspense fallback={FALLBACK}>
      <NewsTickerViewImpl {...props} />
    </Suspense>
  );
}

export function RatedListView(props: ComponentProps<typeof RatedListViewImpl>) {
  return (
    <Suspense fallback={FALLBACK}>
      <RatedListViewImpl {...props} />
    </Suspense>
  );
}

export function TabsBlock(props: ComponentProps<typeof TabsBlockImpl>) {
  return (
    <Suspense fallback={FALLBACK}>
      <TabsBlockImpl {...props} />
    </Suspense>
  );
}

export function AdSlotById(props: ComponentProps<typeof AdSlotByIdImpl>) {
  return (
    <Suspense fallback={FALLBACK}>
      <AdSlotByIdImpl {...props} />
    </Suspense>
  );
}

// Donations widget (public aggregate stats + CTA). Split off so pages that
// don't render it never pay for the query client wrapper / server-fn hook path.
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
export function SliderRender(props: ComponentProps<typeof SliderRenderImpl>) {
  return (
    <Suspense fallback={FALLBACK}>
      <SliderRenderImpl {...props} />
    </Suspense>
  );
}

// Animated headings carry a large per-variant animation catalog; they animate
// in anyway, so the deferred chunk is imperceptible.
export function AnimatedHeadingRender(props: ComponentProps<typeof AnimatedHeadingRenderImpl>) {
  return (
    <Suspense fallback={FALLBACK}>
      <AnimatedHeadingRenderImpl {...props} />
    </Suspense>
  );
}

// Data-viz widgets pull in the whole SVG chart engine (scales, tooltips,
// choropleth) - split out so pages without charts never download it.
export function ChartWidgetView(props: ComponentProps<typeof ChartWidgetViewImpl>) {
  return (
    <Suspense fallback={FALLBACK}>
      <ChartWidgetViewImpl {...props} />
    </Suspense>
  );
}

export function DataMapWidgetView(props: ComponentProps<typeof DataMapWidgetViewImpl>) {
  return (
    <Suspense fallback={FALLBACK}>
      <DataMapWidgetViewImpl {...props} />
    </Suspense>
  );
}

// NES Digital Features - wszystkie renderery żyją w jednym module (FeatureWidgets),
// więc dzielą jeden chunk "features" dociągany tylko na stronach, które osadzają
// któryś z tych widgetów. SSR streaming renderuje je serwerowo (HTML bez zmian).
export function TimelineWidgetView(props: ComponentProps<typeof TimelineWidgetViewImpl>) {
  return (
    <Suspense fallback={FALLBACK}>
      <TimelineWidgetViewImpl {...props} />
    </Suspense>
  );
}

export function SankeyWidgetView(props: ComponentProps<typeof SankeyWidgetViewImpl>) {
  return (
    <Suspense fallback={FALLBACK}>
      <SankeyWidgetViewImpl {...props} />
    </Suspense>
  );
}

export function CompareWidgetView(props: ComponentProps<typeof CompareWidgetViewImpl>) {
  return (
    <Suspense fallback={FALLBACK}>
      <CompareWidgetViewImpl {...props} />
    </Suspense>
  );
}

export function RiskMatrixWidgetView(props: ComponentProps<typeof RiskMatrixWidgetViewImpl>) {
  return (
    <Suspense fallback={FALLBACK}>
      <RiskMatrixWidgetViewImpl {...props} />
    </Suspense>
  );
}

export function IndicatorWidgetView(props: ComponentProps<typeof IndicatorWidgetViewImpl>) {
  return (
    <Suspense fallback={FALLBACK}>
      <IndicatorWidgetViewImpl {...props} />
    </Suspense>
  );
}

export function NetworkWidgetView(props: ComponentProps<typeof NetworkWidgetViewImpl>) {
  return (
    <Suspense fallback={FALLBACK}>
      <NetworkWidgetViewImpl {...props} />
    </Suspense>
  );
}

export function CorridorMapWidgetView(props: ComponentProps<typeof CorridorMapWidgetViewImpl>) {
  return (
    <Suspense fallback={FALLBACK}>
      <CorridorMapWidgetViewImpl {...props} />
    </Suspense>
  );
}

export function SourcesWidgetView(props: ComponentProps<typeof SourcesWidgetViewImpl>) {
  return (
    <Suspense fallback={FALLBACK}>
      <SourcesWidgetViewImpl {...props} />
    </Suspense>
  );
}

export function MethodologyWidgetView(props: ComponentProps<typeof MethodologyWidgetViewImpl>) {
  return (
    <Suspense fallback={FALLBACK}>
      <MethodologyWidgetViewImpl {...props} />
    </Suspense>
  );
}
