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
//   vi.mock("@/components/builder/organisms/widget-view/lazyWidgets", () =>
//     import("@/test/eagerWidgetChunks"),
//   );
//
// Zestaw eksportów MUSI być identyczny z modułem leniwym - pilnuje tego
// `src/lib/builder/ci/__tests__/eagerWidgetChunks.test.ts`.
export { NewsletterForm } from "@/components/NewsletterForm";
export { JoinUsForm } from "@/components/interests/JoinUsForm";
export { ContactFormView } from "@/components/blocks/ContactFormView";
export { AuthFormWidget } from "@/components/builder/organisms/widget-view/AuthFormWidget";
export { InterestsCustomizer } from "@/components/interests/InterestsCustomizer";
export { TtsPlayerHost } from "@/components/builder/molecules/TtsPlayerHost";
export { PodcastLatestView } from "@/components/builder/organisms/widget-view/PodcastLatestView";
export {
  ClubCardView,
  ClubThreadsView,
} from "@/components/builder/organisms/widget-view/ClubWidgets";
export { WebStoriesCarouselView } from "@/components/builder/organisms/widget-view/WebStoriesCarouselView";
export { NewsTickerView } from "@/components/builder/organisms/widget-view/NewsTickerView";
export { TrendingNowView } from "@/components/builder/organisms/widget-view/TrendingNowView";
export { EventScheduleView } from "@/components/builder/organisms/widget-view/EventScheduleView";
export { EventsListView } from "@/components/builder/organisms/widget-view/EventsListView";
export { EventCountdownView } from "@/components/builder/organisms/widget-view/EventCountdownView";
export { MeetingBookingView } from "@/components/builder/organisms/widget-view/MeetingBookingView";
export { EventSponsorsView } from "@/components/builder/organisms/widget-view/EventSponsorsView";
export { RatedListView } from "@/components/builder/organisms/widget-view/RatedListView";
export { TabsBlock } from "@/components/builder/organisms/widget-view/TabsBlock";
export { CircularCarouselView } from "@/components/builder/organisms/widget-view/CircularCarouselView";
export { AdSlotById } from "@/components/ads/AdSlotById";
export { DonationsWidgetView } from "@/components/donations/DonationsWidgetView";
export { RichTextView } from "@/components/builder/organisms/widget-view/RichTextView";
export { SliderRender } from "@/lib/builder/sliderVariants";
export { AnimatedHeadingRender } from "@/lib/builder/animatedHeadingVariants";
export {
  ChartWidgetView,
  DataMapWidgetView,
} from "@/components/builder/organisms/widget-view/DataVizWidgets";
export { WorldMapWidgetView } from "@/components/builder/organisms/widget-view/WorldMapWidget";
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
} from "@/components/builder/organisms/widget-view/FeatureWidgets";
// Podział po typie z 2026-08-15 - lustro musi wystawiać komplet rejestru,
// pilnuje tego src/lib/builder/ci/__tests__/eagerWidgetChunks.test.ts.
export { PostListView } from "@/components/builder/organisms/widget-view/PostListView";
export { TailoredMustReadsView } from "@/components/builder/organisms/widget-view/TailoredMustReadsView";
export { PostsSliderWidget } from "@/components/builder/organisms/widget-view/PostsSliderWidget";
export { EventCountdownCardView } from "@/components/builder/organisms/widget-view/EventCountdownCardView";
export { PurchaseConfirmationView } from "@/components/builder/organisms/widget-view/PurchaseConfirmationView";
export { OnboardingFormView } from "@/components/builder/organisms/widget-view/OnboardingFormView";
export { ProgressCarouselView } from "@/components/builder/organisms/widget-view/ProgressCarouselView";
export { RichHtmlView } from "@/components/builder/organisms/widget-view/RichHtmlView";
export { SearchButtonWidget } from "@/components/builder/organisms/widget-view/SearchButtonWidget";
export { AccountMenuWidget } from "@/components/builder/organisms/widget-view/AccountMenuWidget";
export { SpeakersWidget } from "@/components/builder/organisms/widget-view/SpeakersWidget";
export { TeamMemberWidget } from "@/components/builder/organisms/widget-view/TeamMemberWidget";
export { AuthorProfileCardWidget } from "@/components/builder/organisms/widget-view/AuthorProfileCardWidget";
export { InteractiveCircleWidget } from "@/components/builder/organisms/widget-view/InteractiveCircleWidget";
export { TocWidget } from "@/components/builder/organisms/widget-view/TocWidget";
export { PricingPlansView } from "@/components/builder/organisms/widget-view/PricingPlansView";
export { DynamicTagWidget } from "@/components/builder/organisms/widget-view/DynamicTagWidgets";
export { GalleryLightboxZone } from "@/components/builder/organisms/widget-view/GalleryLightbox";
export { Editable } from "@/components/builder/molecules/Editable";
// Dodane 19.08.2026: oba widgety były w `lazyWidgets`, a nie w tym lustrze, więc
// bramka wierności ustawień (`eagerWidgetChunks.test.ts`) była CZERWONA jeszcze
// przed pracą nad monetyzacją - sprawdzone na commicie bazowym gałęzi. Defekt
// należy do modułu kreatora, nie do monetyzacji; uzupełnienie jest tu wyłącznie
// dlatego, że bez niego cały zestaw testów nie może być zielony.
export { AccordionWidget } from "@/components/builder/organisms/widget-view/AccordionWidget";
export { SectionLabelWidgetView } from "@/lib/builder/sectionLabelVariants";
