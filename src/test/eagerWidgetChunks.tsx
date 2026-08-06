// Test helper: EAGER lustro `widget-view/lazyWidgets.tsx`.
//
// PO CO
// 33 widgety idą przez `React.lazy` + `Suspense`. W teście pierwszy render
// pokazuje fallback, a dynamiczny import domyka się dopiero po kilku obrotach
// pętli zdarzeń - test, który MIERZY zachowanie renderera (np. bramka wierności
// ustawień), widziałby wtedy pustkę i uznał każde ustawienie za martwe. Czekanie
// przez `await act(async …)` nie jest wyjściem: drenuje kolejkę Reacta, a
// widgety z pętlą `requestAnimationFrame` przekładają się w nieskończoność.
//
// Warstwa `lazyWidgets` to CZYSTA glue podziału kodu (dlatego jest wykluczona z
// pomiaru pokrycia). Podmiana jej na te same komponenty importowane statycznie
// nie zmienia więc niczego w zachowaniu widgetu - usuwa tylko granicę Suspense.
//
// UŻYCIE
//   vi.mock("@/components/admin/builder/ui/organisms/widget-view/lazyWidgets", () =>
//     import("@/test/eagerWidgetChunks"),
//   );
//
// Zestaw eksportów MUSI być identyczny z modułem leniwym - pilnuje tego
// `src/lib/builder/ci/__tests__/eagerWidgetChunks.test.ts`.
export { NewsletterForm } from "@/components/NewsletterForm";
export { JoinUsForm } from "@/components/interests/JoinUsForm";
export { ContactFormView } from "@/components/blocks/ContactFormView";
export { AuthFormWidget } from "@/components/admin/builder/ui/organisms/widget-view/AuthFormWidget";
export { InterestsCustomizer } from "@/components/interests/InterestsCustomizer";
export { TtsPlayerHost } from "@/components/admin/builder/ui/molecules/TtsPlayerHost";
export { PodcastLatestView } from "@/components/admin/builder/ui/organisms/widget-view/PodcastLatestView";
export { WebStoriesCarouselView } from "@/components/admin/builder/ui/organisms/widget-view/WebStoriesCarouselView";
export { NewsTickerView } from "@/components/admin/builder/ui/organisms/widget-view/NewsTickerView";
export { EventScheduleView } from "@/components/admin/builder/ui/organisms/widget-view/EventScheduleView";
export { EventsListView } from "@/components/admin/builder/ui/organisms/widget-view/EventsListView";
export { EventCountdownView } from "@/components/admin/builder/ui/organisms/widget-view/EventCountdownView";
export { MeetingBookingView } from "@/components/admin/builder/ui/organisms/widget-view/MeetingBookingView";
export { EventSponsorsView } from "@/components/admin/builder/ui/organisms/widget-view/EventSponsorsView";
export { RatedListView } from "@/components/admin/builder/ui/organisms/widget-view/RatedListView";
export { TabsBlock } from "@/components/admin/builder/ui/organisms/widget-view/TabsBlock";
export { CircularCarouselView } from "@/components/admin/builder/ui/organisms/widget-view/CircularCarouselView";
export { AdSlotById } from "@/components/ads/AdSlotById";
export { DonationsWidgetView } from "@/components/donations/DonationsWidgetView";
export { RichTextView } from "@/components/admin/builder/ui/organisms/widget-view/RichTextView";
export { SliderRender } from "@/lib/builder/sliderVariants";
export { AnimatedHeadingRender } from "@/lib/builder/animatedHeadingVariants";
export {
  ChartWidgetView,
  DataMapWidgetView,
} from "@/components/admin/builder/ui/organisms/widget-view/DataVizWidgets";
export {
  TimelineWidgetView,
  SankeyWidgetView,
  CompareWidgetView,
  RiskMatrixWidgetView,
  IndicatorWidgetView,
  NetworkWidgetView,
  CorridorMapWidgetView,
  SourcesWidgetView,
  MethodologyWidgetView,
} from "@/components/admin/builder/ui/organisms/widget-view/FeatureWidgets";
