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
// spacer, copyright, social-icons, section-label, cta, dark-featured-card and
// the other small inline branches of SimpleWidgets. Two reasons: navigation
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
import { lazy, Suspense, type ComponentProps, type ComponentType, type ReactElement } from "react";
import { useBuilderMode } from "@/lib/content-model/editorCanvas";

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
import type { SliderRender as SliderRenderImpl } from "@/lib/builder/sliderVariants";
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
import type { InteractiveCircleWidget as InteractiveCircleWidgetImpl } from "./InteractiveCircleWidget";
import type { TocWidget as TocWidgetImpl } from "./TocWidget";
import type { PricingPlansView as PricingPlansViewImpl } from "./PricingPlansView";
import type { DynamicTagWidget as DynamicTagWidgetImpl } from "./DynamicTagWidgets";
import type { GalleryLightboxZone as GalleryLightboxZoneImpl } from "./GalleryLightbox";
import type { PostsSliderWidget as PostsSliderWidgetImpl } from "./PostsSliderWidget";

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
function withSuspense<P>(Lazy: ComponentType<P>): (props: P) => ReactElement {
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

// Kanwowy click-to-edit: renderuje się WYŁĄCZNIE przy canEdit (kanwa buildera),
// a przez normalizeBuilderRichHtml ciągnie node-html-parser - statyczny import
// w WidgetView wciągał parser do chunku wejściowego każdej strony publicznej.
const EditableLazy = lazy(() =>
  import("../../molecules/Editable").then((m) => ({ default: m.Editable })),
) as ComponentType<ComponentProps<typeof EditableImpl>>;
export const Editable = withSuspense(EditableLazy);
