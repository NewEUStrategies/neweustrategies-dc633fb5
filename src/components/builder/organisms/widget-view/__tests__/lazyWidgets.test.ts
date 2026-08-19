import { describe, it, expect } from "vitest";
import * as lazyWidgets from "@/components/builder/organisms/widget-view/lazyWidgets";

// The split widgets WidgetView pulls from the lazy registry. Importing the
// module evaluates the React.lazy() factories without triggering their dynamic
// imports, so this stays a cheap structural guard: every name WidgetView relies
// on must resolve to a component (a renamed/removed export would break the
// builder at runtime).
const SPLIT_WIDGETS = [
  "NewsletterForm",
  "ContactFormView",
  "AuthFormWidget",
  "JoinUsForm",
  "InterestsCustomizer",
  "TtsPlayerHost",
  "PodcastLatestView",
  "WebStoriesCarouselView",
  "NewsTickerView",
  // Kluby dyskusyjne (spec §5.5)
  "ClubCardView",
  "ClubThreadsView",
  // Events ecosystem
  "EventScheduleView",
  "EventsListView",
  "EventCountdownView",
  "MeetingBookingView",
  "EventSponsorsView",
  "RatedListView",
  "TabsBlock",
  "CircularCarouselView",
  "AdSlotById",
  "DonationsWidgetView",
  "RichTextView",
  "ChartWidgetView",
  "DataMapWidgetView",
  // Mapa świata z łukami połączeń (silnik src/components/maps)
  "WorldMapWidgetView",
  "SliderRender",
  "AnimatedHeadingRender",
  // NES Digital Features
  "TimelineWidgetView",
  "SankeyWidgetView",
  "CompareWidgetView",
  "RiskMatrixWidgetView",
  "IndicatorWidgetView",
  "NetworkWidgetView",
  "CorridorMapWidgetView",
  "SourcesWidgetView",
  "MethodologyWidgetView",
  // Podział po typie z 2026-08-15 (ocena 2026-08-14: entry ciągnął komplet
  // widgetów; strona z pięcioma typami pobierała wszystkie 44)
  "PostListView",
  "TailoredMustReadsView",
  "PostsSliderWidget",
  "EventCountdownCardView",
  "PurchaseConfirmationView",
  "OnboardingFormView",
  "ProgressCarouselView",
  "RichHtmlView",
  "SearchButtonWidget",
  "AccountMenuWidget",
  "SpeakersWidget",
  "TeamMemberWidget",
  "AuthorProfileCardWidget",
  "InteractiveCircleWidget",
  "TocWidget",
  "PricingPlansView",
  "DynamicTagWidget",
  "GalleryLightboxZone",
  // Kanwowy click-to-edit (normalizeBuilderRichHtml -> node-html-parser)
  "Editable",
  // 2026-08-19: `TrendingNowView` figurował na tej liście DWA razy - dwie
  // gałęzie dopisały go niezależnie, a scalenie zostawiło obie kopie. Druga
  // asercja porównuje listę z kluczami modułu, więc duplikat czerwienił bramkę
  // na eksport, który jest poprawny. Każdy widget stoi na liście RAZ.
  //
  // Cięcie ścieżki bootowania (01253dc, chunk wejściowy 374 -> 253 KB gz).
  // Trzy widgety zeszły wtedy na leniwą krawędź, ale lista tutaj nie została
  // dopisana - a druga asercja tego pliku jest SYMETRYCZNA, więc bramka
  // czerwieniła się na eksporty, które są poprawne i realnie konsumowane
  // (WidgetView -> TrendingNowView; SimpleWidgets -> AccordionWidget,
  // SectionLabelWidgetView). Powód leniwości każdego z nich:
  //  * AccordionWidget - jedyny konsument sanitizeHtml/DOMPurify w SimpleWidgets;
  //    statyczna krawędź trzymała DOMPurify w chunku wejściowym,
  //  * SectionLabelWidgetView - wariantownia z lib/builder/sectionLabelVariants,
  //  * TrendingNowView - widok listy „na czasie" spod WidgetView; jego wpis stoi
  //    wyżej, przy `NewsTickerView` - dopisanie go PONOWNIE tutaj (scalenie
  //    c145e2f) czerwieniło strażnika, bo lista miała 59 pozycji wobec 58
  //    eksportów rejestru.
  "AccordionWidget",
  "SectionLabelWidgetView",
] as const;

describe("lazyWidgets registry", () => {
  const registry = lazyWidgets as Record<string, unknown>;

  it("exports every split widget as a component", () => {
    for (const name of SPLIT_WIDGETS) {
      expect(typeof registry[name]).toBe("function");
    }
  });

  it("does not leak unexpected exports", () => {
    expect(Object.keys(registry).sort()).toEqual([...SPLIT_WIDGETS].sort());
  });
});
