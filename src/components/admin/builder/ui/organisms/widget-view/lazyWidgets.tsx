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
// only the *client* download is deferred. The `null` fallback guarantees zero
// layout shift; in steady state the chunk is already resolved (SSR) or arrives
// during intent-preloaded navigation.
//
// What stays EAGER (deliberately): layout-critical, frequently above-the-fold
// or navigation widgets - heading, text, button, nav-link, mega-menu,
// post-list / carousel, categories, tags, cta, dark-featured-card. Splitting
// those would risk a visible pop-in on first paint.
import { lazy, Suspense, type ComponentProps } from "react";

/** Shared zero-CLS fallback. SSR fills the boundary, so this is rarely shown. */
const FALLBACK = null;

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
