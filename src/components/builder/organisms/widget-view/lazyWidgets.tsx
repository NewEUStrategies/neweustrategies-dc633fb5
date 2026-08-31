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
// What stays EAGER (deliberately): chrome-critical navigation and the cheap
// inline JSX cases - heading, text (shell), button, nav-link, mega-menu, menu,
// lang-switcher, theme-toggle, image (logo / LCP candidate), icon, divider,
// spacer, copyright, social-icons, cta, dark-featured-card and
// the other small inline branches of SimpleWidgets.
// 2026-08-18: section-label i accordion przestały być eager - etykieta ciągnęła
// 21 wariantów (~39 kB źródeł), a akordeon był jedynym eager konsumentem
// sanitizeHtml/DOMPurify; oba żyją niżej w tym rejestrze. Two reasons: navigation
// must hydrate first (header interactivity), and chunks of a few hundred bytes
// do not compress - 45 takich plików kosztowało kiedyś ~22 KB samych nagłówków
// (patrz kronika w scripts/check-bundle-size.ts, wpis 2026-08-06 (2)).
//
// 2026-08-15: KONIEC „eager, bo tak wyszło". Ocena z 2026-08-14 zmierzyła, że
// WidgetView ciągnął do chunku wejściowego KOMPLET widgetów (442,1 kB źródeł,
// 16,3% entry) - strona używająca pięciu typów pobierała wszystkie 44. Od tej
// zmiany po typie dzielone są też: post-list/karuzela, tailored-must-reads,
// event-countdown-card, purchase-confirmation, onboarding-form,
// progress-carousel, rich-html (normalizeRichHtml -> node-html-parser, 202 kB
// źródła!), search-button, account-link, speakers, team-member,
// author-profile-card, interactive-circle, toc, pricing, dynamiczne tagi
// wpisu, lightbox galerii i slider z wpisów. SSR wypełnia każdą granicę
// Suspense na serwerze, więc HTML i LCP są identyczne - odroczony jest
// wyłącznie transfer JS na kliencie.
import { lazy, type ComponentProps, type ComponentType } from "react";
import { withSuspense } from "./lazySuspense";

import type { Editable as EditableImpl } from "../../molecules/Editable";

import type { NewsletterForm as NewsletterFormImpl } from "@/components/NewsletterForm";
import type { ContactFormView as ContactFormViewImpl } from "@/components/blocks/ContactFormView";
import type { AuthFormWidget as AuthFormWidgetImpl } from "./AuthFormWidget";
import type { JoinUsForm as JoinUsFormImpl } from "@/components/interests/JoinUsForm";
import type { InterestsCustomizer as InterestsCustomizerImpl } from "@/components/interests/InterestsCustomizer";
import type { TtsPlayerHost as TtsPlayerHostImpl } from "@/components/builder/molecules/TtsPlayerHost";
import type { PodcastLatestView as PodcastLatestViewImpl } from "./PodcastLatestView";
import type { WebStoriesCarouselView as WebStoriesCarouselViewImpl } from "./WebStoriesCarouselView";
import type { NewsTickerView as NewsTickerViewImpl } from "./NewsTickerView";
import type { TrendingNowView as TrendingNowViewImpl } from "./TrendingNowView";
import type { EventScheduleView as EventScheduleViewImpl } from "./EventScheduleView";
import type { EventsListView as EventsListViewImpl } from "./EventsListView";
import type {
  ClubCardView as ClubCardViewImpl,
  ClubThreadsView as ClubThreadsViewImpl,
} from "./ClubWidgets";
import type { EventCountdownView as EventCountdownViewImpl } from "./EventCountdownView";
import type { MeetingBookingView as MeetingBookingViewImpl } from "./MeetingBookingView";
import type { EventSponsorsView as EventSponsorsViewImpl } from "./EventSponsorsView";
import type { RatedListView as RatedListViewImpl } from "./RatedListView";
import type { CircularCarouselView as CircularCarouselViewImpl } from "./CircularCarouselView";
import type { TabsBlock as TabsBlockImpl } from "./TabsBlock";
import type { AdSlotById as AdSlotByIdImpl } from "@/components/ads/AdSlotById";
import type { DonationsWidgetView as DonationsWidgetViewImpl } from "@/components/donations/DonationsWidgetView";
import type { RichTextView as RichTextViewImpl } from "./RichTextView";
import type { AnimatedHeadingRender as AnimatedHeadingRenderImpl } from "@/lib/builder/animatedHeadingVariants";
import type {
  ChartWidgetView as ChartWidgetViewImpl,
  DataMapWidgetView as DataMapWidgetViewImpl,
} from "./DataVizWidgets";
import type { WorldMapWidgetView as WorldMapWidgetViewImpl } from "./WorldMapWidget";
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
import type { PostListView as PostListViewImpl } from "./PostListView";
import type { TailoredMustReadsView as TailoredMustReadsViewImpl } from "./TailoredMustReadsView";
import type { EventCountdownCardView as EventCountdownCardViewImpl } from "./EventCountdownCardView";
import type { PurchaseConfirmationView as PurchaseConfirmationViewImpl } from "./PurchaseConfirmationView";
import type { OnboardingFormView as OnboardingFormViewImpl } from "./OnboardingFormView";
import type { ProgressCarouselView as ProgressCarouselViewImpl } from "./ProgressCarouselView";
import type { RichHtmlView as RichHtmlViewImpl } from "./RichHtmlView";
import type { SearchButtonWidget as SearchButtonWidgetImpl } from "./SearchButtonWidget";
import type { AccountMenuWidget as AccountMenuWidgetImpl } from "./AccountMenuWidget";
import type { SpeakersWidget as SpeakersWidgetImpl } from "./SpeakersWidget";
import type { TeamMemberWidget as TeamMemberWidgetImpl } from "./TeamMemberWidget";
import type { AuthorProfileCardWidget as AuthorProfileCardWidgetImpl } from "./AuthorProfileCardWidget";
import type { TravelRouteCardView as TravelRouteCardViewImpl } from "./TravelRouteCardView";
import type { InteractiveCircleWidget as InteractiveCircleWidgetImpl } from "./InteractiveCircleWidget";
import type { TocWidget as TocWidgetImpl } from "./TocWidget";
import type { PricingPlansView as PricingPlansViewImpl } from "./PricingPlansView";
import type { DynamicTagWidget as DynamicTagWidgetImpl } from "./DynamicTagWidgets";
import type { GalleryLightboxZone as GalleryLightboxZoneImpl } from "./GalleryLightbox";
import type { AccordionWidget as AccordionWidgetImpl } from "./AccordionWidget";
import type { SectionLabelWidgetView as SectionLabelWidgetViewImpl } from "@/lib/builder/sectionLabelVariants";
import type { PostsSliderWidget as PostsSliderWidgetImpl } from "./PostsSliderWidget";
import type { CounterWidget as CounterWidgetImpl } from "./CounterWidget";

// `LazyFallback` i `withSuspense` żyją w `./lazySuspense`, żeby pojedynczy
// leniwy komponent dał się skonsumować bez importu całego rejestru (patrz
// nagłówek tamtego pliku - to naprawa zakleszczenia w testach).

// --- form / interaction widgets -------------------------------------------
const NewsletterFormLazy = lazy(() =>
  import("@/components/NewsletterForm").then((m) => ({ default: m.NewsletterForm })),
) as ComponentType<ComponentProps<typeof NewsletterFormImpl>>;
export const NewsletterForm = withSuspense(NewsletterFormLazy);

const JoinUsFormLazy = lazy(() =>
  import("@/components/interests/JoinUsForm").then((m) => ({ default: m.JoinUsForm })),
) as ComponentType<ComponentProps<typeof JoinUsFormImpl>>;
export const JoinUsForm = withSuspense(JoinUsFormLazy);

// Formularz kontaktowy (~28 KB źródła + zależności) i formularze auth
// (login/rejestracja/reset, ciągną AuthFormBlocks) renderują się pod widget
// switchem w SimpleWidgets - a SimpleWidgets jest w EAGER-owej ścieżce chrome
// (Header/Footer -> BuilderRenderer). Leniwe chunki zdejmują je z bundla
// wejściowego każdej strony; SSR wypełnia boundary, więc bez CLS.
const ContactFormViewLazy = lazy(() =>
  import("@/components/blocks/ContactFormView").then((m) => ({ default: m.ContactFormView })),
) as ComponentType<ComponentProps<typeof ContactFormViewImpl>>;
export const ContactFormView = withSuspense(ContactFormViewLazy);

const AuthFormWidgetLazy = lazy(() =>
  import("./AuthFormWidget").then((m) => ({ default: m.AuthFormWidget })),
) as ComponentType<ComponentProps<typeof AuthFormWidgetImpl>>;
export const AuthFormWidget = withSuspense(AuthFormWidgetLazy);

const InterestsCustomizerLazy = lazy(() =>
  import("@/components/interests/InterestsCustomizer").then((m) => ({
    default: m.InterestsCustomizer,
  })),
) as ComponentType<ComponentProps<typeof InterestsCustomizerImpl>>;
export const InterestsCustomizer = withSuspense(InterestsCustomizerLazy);

const TtsPlayerHostLazy = lazy(() =>
  import("@/components/builder/molecules/TtsPlayerHost").then((m) => ({
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

const TrendingNowViewLazy = lazy(() =>
  import("./TrendingNowView").then((m) => ({ default: m.TrendingNowView })),
) as ComponentType<ComponentProps<typeof TrendingNowViewImpl>>;
export const TrendingNowView = withSuspense(TrendingNowViewLazy);

// Widgety wydarzen: agenda (dialog profilu prelegenta + react-query),
// lista wydarzen i odliczanie - wszystkie poza bundlem wejsciowym chrome.
const EventScheduleViewLazy = lazy(() =>
  import("./EventScheduleView").then((m) => ({ default: m.EventScheduleView })),
) as ComponentType<ComponentProps<typeof EventScheduleViewImpl>>;
export const EventScheduleView = withSuspense(EventScheduleViewLazy);

const EventsListViewLazy = lazy(() =>
  import("./EventsListView").then((m) => ({ default: m.EventsListView })),
) as ComponentType<ComponentProps<typeof EventsListViewImpl>>;
export const EventsListView = withSuspense(EventsListViewLazy);

// Widgety klubow dyskusyjnych (spec §5.5). Leniwe z tego samego powodu, co
// reszta dynamicznych: warstwa danych klubow nie ma prawa wejsc do bundla,
// ktorym placi czytelnik strony bez zadnego widgetu klubowego.
const ClubCardViewLazy = lazy(() =>
  import("./ClubWidgets").then((m) => ({ default: m.ClubCardView })),
) as ComponentType<ComponentProps<typeof ClubCardViewImpl>>;
export const ClubCardView = withSuspense(ClubCardViewLazy);

const ClubThreadsViewLazy = lazy(() =>
  import("./ClubWidgets").then((m) => ({ default: m.ClubThreadsView })),
) as ComponentType<ComponentProps<typeof ClubThreadsViewImpl>>;
export const ClubThreadsView = withSuspense(ClubThreadsViewLazy);

const EventCountdownViewLazy = lazy(() =>
  import("./EventCountdownView").then((m) => ({ default: m.EventCountdownView })),
) as ComponentType<ComponentProps<typeof EventCountdownViewImpl>>;
export const EventCountdownView = withSuspense(EventCountdownViewLazy);

const MeetingBookingViewLazy = lazy(() =>
  import("./MeetingBookingView").then((m) => ({ default: m.MeetingBookingView })),
) as ComponentType<ComponentProps<typeof MeetingBookingViewImpl>>;
export const MeetingBookingView = withSuspense(MeetingBookingViewLazy);

const EventSponsorsViewLazy = lazy(() =>
  import("./EventSponsorsView").then((m) => ({ default: m.EventSponsorsView })),
) as ComponentType<ComponentProps<typeof EventSponsorsViewImpl>>;
export const EventSponsorsView = withSuspense(EventSponsorsViewLazy);

const RatedListViewLazy = lazy(() =>
  import("./RatedListView").then((m) => ({ default: m.RatedListView })),
) as ComponentType<ComponentProps<typeof RatedListViewImpl>>;
export const RatedListView = withSuspense(RatedListViewLazy);

const TabsBlockLazy = lazy(() =>
  import("./TabsBlock").then((m) => ({ default: m.TabsBlock })),
) as ComponentType<ComponentProps<typeof TabsBlockImpl>>;
export const TabsBlock = withSuspense(TabsBlockLazy);

// Karuzela okrężna: widget dekoracyjny, nie nawigacyjny i praktycznie nigdy
// nad zgięciem - trafiła do bundla WEJŚCIOWEGO przez statyczny import
// w WidgetView (zmierzone: 12.2 kB przed minifikacją w `assets/index-*.js`,
// płacone przez KAŻDEGO czytelnika, także na stronach bez karuzeli).
// Kryterium „eager" z nagłówka tego pliku jej nie obejmuje.
const CircularCarouselViewLazy = lazy(() =>
  import("./CircularCarouselView").then((m) => ({ default: m.CircularCarouselView })),
) as ComponentType<ComponentProps<typeof CircularCarouselViewImpl>>;
export const CircularCarouselView = withSuspense(CircularCarouselViewLazy);

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
// `SliderRender` mieszka w osobnym module, bo importuje go też
// `PostsSliderWidget` (sam ładowany leniwie z tego rejestru) - import całego
// rejestru zamykał tam cykl. Re-eksport trzyma kontrakt eksportów bez zmian.
export { SliderRender } from "./lazySliderRender";

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

// Mapa świata: własny chunk, bo ciągnie warstwę zapytań o publiczne profile
// i komponent mapy - a strona bez tego widgetu nie ma powodu za to płacić.
const WorldMapWidgetViewLazy = lazy(() =>
  import("./WorldMapWidget").then((m) => ({ default: m.WorldMapWidgetView })),
) as ComponentType<ComponentProps<typeof WorldMapWidgetViewImpl>>;
export const WorldMapWidgetView = withSuspense(WorldMapWidgetViewLazy);

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

// --- podział po typie z 2026-08-15 (ocena: entry ciągnął komplet widgetów) ---
// Listingi wpisów: post-list + karuzela dzielą jeden chunk (ten sam moduł),
// personalizowane must-reads i slider z wpisów mają własne - każdy ciągnie
// inną warstwę zapytań (postListQuery / useRecommendedPosts / sliderPostsQuery)
// i żadna z nich nie ma prawa jechać w chunku wejściowym chrome.
const PostListViewLazy = lazy(() =>
  import("./PostListView").then((m) => ({ default: m.PostListView })),
) as ComponentType<ComponentProps<typeof PostListViewImpl>>;
export const PostListView = withSuspense(PostListViewLazy);

const TailoredMustReadsViewLazy = lazy(() =>
  import("./TailoredMustReadsView").then((m) => ({ default: m.TailoredMustReadsView })),
) as ComponentType<ComponentProps<typeof TailoredMustReadsViewImpl>>;
export const TailoredMustReadsView = withSuspense(TailoredMustReadsViewLazy);

const PostsSliderWidgetLazy = lazy(() =>
  import("./PostsSliderWidget").then((m) => ({ default: m.PostsSliderWidget })),
) as ComponentType<ComponentProps<typeof PostsSliderWidgetImpl>>;
export const PostsSliderWidget = withSuspense(PostsSliderWidgetLazy);

const EventCountdownCardViewLazy = lazy(() =>
  import("./EventCountdownCardView").then((m) => ({ default: m.EventCountdownCardView })),
) as ComponentType<ComponentProps<typeof EventCountdownCardViewImpl>>;
export const EventCountdownCardView = withSuspense(EventCountdownCardViewLazy);

// Potwierdzenie zakupu ciągnie warstwę billingu (Stripe, subskrypcje, payments
// functions) - typowy czytelnik nigdy nie renderuje tego widgetu.
const PurchaseConfirmationViewLazy = lazy(() =>
  import("./PurchaseConfirmationView").then((m) => ({ default: m.PurchaseConfirmationView })),
) as ComponentType<ComponentProps<typeof PurchaseConfirmationViewImpl>>;
export const PurchaseConfirmationView = withSuspense(PurchaseConfirmationViewLazy);

const OnboardingFormViewLazy = lazy(() =>
  import("./OnboardingFormView").then((m) => ({ default: m.OnboardingFormView })),
) as ComponentType<ComponentProps<typeof OnboardingFormViewImpl>>;
export const OnboardingFormView = withSuspense(OnboardingFormViewLazy);

const ProgressCarouselViewLazy = lazy(() =>
  import("./ProgressCarouselView").then((m) => ({ default: m.ProgressCarouselView })),
) as ComponentType<ComponentProps<typeof ProgressCarouselViewImpl>>;
export const ProgressCarouselView = withSuspense(ProgressCarouselViewLazy);

// Widget `text`: sam shell zostaje w WidgetView, ale renderer HTML idzie lazy,
// bo normalizeBuilderRichHtml ciągnie node-html-parser (202 kB źródła) i silnik
// przypisów - najcięższa pojedyncza pozycja entry z inwentarza 2026-08-06.
const RichHtmlViewLazy = lazy(() =>
  import("./RichHtmlView").then((m) => ({ default: m.RichHtmlView })),
) as ComponentType<ComponentProps<typeof RichHtmlViewImpl>>;
export const RichHtmlView = withSuspense(RichHtmlViewLazy);

// --- chrome na żądanie: cięższe widgety nagłówka -----------------------------
// SSR renderuje przycisk/menu od razu (zero CLS), a hydratacja dociąga chunk;
// React odtwarza kliknięcia sprzed hydratacji na granicy Suspense, więc
// interakcja nie ginie. W entry zostają tylko lekkie chromeWidgets
// (lang-switcher, theme-toggle) i nawigacja (menu, mega-menu).
const SearchButtonWidgetLazy = lazy(() =>
  import("./SearchButtonWidget").then((m) => ({ default: m.SearchButtonWidget })),
) as ComponentType<ComponentProps<typeof SearchButtonWidgetImpl>>;
export const SearchButtonWidget = withSuspense(SearchButtonWidgetLazy);

const AccountMenuWidgetLazy = lazy(() =>
  import("./AccountMenuWidget").then((m) => ({ default: m.AccountMenuWidget })),
) as ComponentType<ComponentProps<typeof AccountMenuWidgetImpl>>;
export const AccountMenuWidget = withSuspense(AccountMenuWidgetLazy);

// --- widgety treści używane punktowo -----------------------------------------
const SpeakersWidgetLazy = lazy(() =>
  import("./SpeakersWidget").then((m) => ({ default: m.SpeakersWidget })),
) as ComponentType<ComponentProps<typeof SpeakersWidgetImpl>>;
export const SpeakersWidget = withSuspense(SpeakersWidgetLazy);

const TeamMemberWidgetLazy = lazy(() =>
  import("./TeamMemberWidget").then((m) => ({ default: m.TeamMemberWidget })),
) as ComponentType<ComponentProps<typeof TeamMemberWidgetImpl>>;
export const TeamMemberWidget = withSuspense(TeamMemberWidgetLazy);

const AuthorProfileCardWidgetLazy = lazy(() =>
  import("./AuthorProfileCardWidget").then((m) => ({ default: m.AuthorProfileCardWidget })),
) as ComponentType<ComponentProps<typeof AuthorProfileCardWidgetImpl>>;
export const AuthorProfileCardWidget = withSuspense(AuthorProfileCardWidgetLazy);

const TravelRouteCardViewLazy = lazy(() =>
  import("./TravelRouteCardView").then((m) => ({ default: m.TravelRouteCardView })),
) as ComponentType<ComponentProps<typeof TravelRouteCardViewImpl>>;
export const TravelRouteCardView = withSuspense(TravelRouteCardViewLazy);

const InteractiveCircleWidgetLazy = lazy(() =>
  import("./InteractiveCircleWidget").then((m) => ({ default: m.InteractiveCircleWidget })),
) as ComponentType<ComponentProps<typeof InteractiveCircleWidgetImpl>>;
export const InteractiveCircleWidget = withSuspense(InteractiveCircleWidgetLazy);

const TocWidgetLazy = lazy(() =>
  import("./TocWidget").then((m) => ({ default: m.TocWidget })),
) as ComponentType<ComponentProps<typeof TocWidgetImpl>>;
export const TocWidget = withSuspense(TocWidgetLazy);

const PricingPlansViewLazy = lazy(() =>
  import("./PricingPlansView").then((m) => ({ default: m.PricingPlansView })),
) as ComponentType<ComponentProps<typeof PricingPlansViewImpl>>;
export const PricingPlansView = withSuspense(PricingPlansViewLazy);

// Dynamiczne tagi wpisu (post-title, post-meta, post-cover, breadcrumbs, ...):
// jeden moduł, jeden chunk - renderują się wyłącznie w szablonach wpisu.
const DynamicTagWidgetLazy = lazy(() =>
  import("./DynamicTagWidgets").then((m) => ({ default: m.DynamicTagWidget })),
) as ComponentType<ComponentProps<typeof DynamicTagWidgetImpl>>;
export const DynamicTagWidget = withSuspense(DynamicTagWidgetLazy);

// Lightbox galerii: portal + focus trap dociągane dopiero na stronach z galerią.
const GalleryLightboxZoneLazy = lazy(() =>
  import("./GalleryLightbox").then((m) => ({ default: m.GalleryLightboxZone })),
) as ComponentType<ComponentProps<typeof GalleryLightboxZoneImpl>>;
export const GalleryLightboxZone = withSuspense(GalleryLightboxZoneLazy);

// Akordeon (FAQ): jedyny konsument sanitizeHtml (DOMPurify) w SimpleWidgets -
// wydzielony, żeby DOMPurify nie jechał w chunku wejściowym każdej strony.
const AccordionWidgetLazy = lazy(() =>
  import("./AccordionWidget").then((m) => ({ default: m.AccordionWidget })),
) as ComponentType<ComponentProps<typeof AccordionWidgetImpl>>;
export const AccordionWidget = withSuspense(AccordionWidgetLazy);

// Etykieta sekcji: 21 wariantów wizualnych (~39 kB źródeł) - nie chrome.
// Dogrzewane w warmWidgetChunks (etykiety sekcji na głównej ścieżce czytelniczej).
const SectionLabelWidgetViewLazy = lazy(() =>
  import("@/lib/builder/sectionLabelVariants").then((m) => ({
    default: m.SectionLabelWidgetView,
  })),
) as ComponentType<ComponentProps<typeof SectionLabelWidgetViewImpl>>;
export const SectionLabelWidgetView = withSuspense(SectionLabelWidgetViewLazy);

// Kanwowy click-to-edit: renderuje się WYŁĄCZNIE przy canEdit (kanwa buildera),
// a przez normalizeBuilderRichHtml ciągnie node-html-parser - statyczny import
// w WidgetView wciągał parser do chunku wejściowego każdej strony publicznej.
const EditableLazy = lazy(() =>
  import("../../molecules/Editable").then((m) => ({ default: m.Editable })),
) as ComponentType<ComponentProps<typeof EditableImpl>>;
export const Editable = withSuspense(EditableLazy);

// --- 2026-08-31: dwa statyczne importy rozstrzygniete jako PRZEOCZENIA ------
// Przeglad wszystkich 96 renderowalnych typow widgetow (71 leniwych / 25
// statycznych) wykazal, ze DZIESIEC statycznych typow nie jest objetych
// kontraktem "co zostaje eager" z naglowka tego pliku. Osiem z nich zostaje
// eager SWIADOMIE i ma to zapisane przy swoich `case` w SimpleWidgets.tsx;
// te dwa byly przeoczeniem i schodza tutaj.

// `counter` - animowany licznik Elementora we WLASNYM module (105 linii,
// petla requestAnimationFrame + IntersectionObserver). SimpleWidgets jest na
// eager-owej sciezce chrome (Header/Footer -> BuilderRenderer -> WidgetView),
// wiec statyczny import ladowal ten modul do chunku wejsciowego KAZDEJ strony,
// takze bez ani jednego licznika. Jedynym konsumentem modulu jest SimpleWidgets,
// wiec przeniesienie na `import()` FAKTYCZNIE zdejmuje krawedz z grafu - nie
// tylko odracza pobranie.
const CounterWidgetLazy = lazy(() =>
  import("./CounterWidget").then((m) => ({ default: m.CounterWidget })),
) as ComponentType<ComponentProps<typeof CounterWidgetImpl>>;
export const CounterWidget = withSuspense(CounterWidgetLazy);

// `text-rotate` - ROZWAZONE I ODRZUCONE NA PODSTAWIE POMIARU, nie przeczucia.
// Modul (240 linii) wygladal na blizniaczy przypadek `counter`: `animated-heading`
// obok niego jedzie leniwie od 2026-08-15. Ale `@/components/ui/text-rotate` ma
// DRUGIEGO statycznego importera na trasie PUBLICZNEJ -
// `components/careers/organisms/CareersHero.tsx` (`/zatrudniamy`), gdzie jest hero
// NAD ZGIECIEM, czyli import w pelni zasadny.
//
// To jest dokladnie mechanika z komentarza w BuilderRenderer.tsx (l. 133-142):
// `lazy()` odracza pobranie, ale NIE usuwa krawedzi w grafie, dopoki istnieje
// inny statyczny importer na publicznej trasie. POMIAR bramki potwierdzil to
// wprost - wersja lazifikujaca `text-rotate` razem z `counter` dala:
//   public  2684,0 -> 2685,8 KB (+1,8),
//   overall 4309,4 -> 4311,6 KB (+2,2),
//   najwiekszy chunk 270,9 -> 269,7 KB (-1,2).
// Czyli modul NIE opuscil budzetu PUBLIC (bo trasa karier trzyma go dalej),
// a doszedl narzut osobnego chunku. Zysk -1,2 KB na chunku startowym pochodzi
// z `counter`; `text-rotate` dolozyl do tego wylacznie koszt.
//
// Zeby ten widget faktycznie zszedl z budzetu PUBLIC, trzeba by zlazifikowac
// go TAKZE w CareersHero - a tam jest nad zgieciem, wiec byloby to pogorszenie
// LCP trasy karier w zamian za kilobajt. Zostaje eager, swiadomie.

