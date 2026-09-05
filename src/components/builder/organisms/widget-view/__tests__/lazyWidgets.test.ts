import { describe, it, expect } from "vitest";
import * as lazyWidgets from "@/components/builder/organisms/widget-view/lazyWidgets";

// The split widgets WidgetView pulls from the lazy registry. Importing the
// module evaluates the React.lazy() factories without triggering their dynamic
// imports, so this stays a cheap structural guard: every name WidgetView relies
// on must resolve to a component (a renamed/removed export would break the
// builder at runtime).
//
// UWAGA: druga asercja jest SYMETRYCZNA, więc brakujący wpis i zdublowany wpis
// czerwienią bramkę tak samo jak realna regresja eksportu - oba kierunki
// zdarzyły się tutaj przy scalaniu gałęzi 2026-08-19. Każdy widget stoi na tej
// liście dokładnie RAZ.
const SPLIT_WIDGETS = [
  // 2026-08-31: przeoczenie zdjete z eager-owej sciezki chrome.
  "CounterWidget",
  "NewsletterForm",
  "ContactFormView",
  "AuthFormWidget",
  "JoinUsForm",
  "InterestsCustomizer",
  "TtsPlayerHost",
  "PodcastLatestView",
  "WebStoriesCarouselView",
  "NewsTickerView",
  "TrendingNowView",
  // Kluby dyskusyjne (spec §5.5)
  "ClubCardView",
  "ClubThreadsView",
  "ClubHubView",
  "CoverOverlayCardView",
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
  "TravelRouteCardView",
  "InteractiveCircleWidget",
  "TocWidget",
  "PricingPlansView",
  "DynamicTagWidget",
  "GalleryLightboxZone",
  // Kanwowy click-to-edit (normalizeBuilderRichHtml -> node-html-parser)
  "Editable",
  // Cięcie ścieżki bootowania (01253dc, chunk wejściowy 374 -> 253 KB gz)
  // zepchnęło te dwa widgety na leniwą krawędź:
  //  * AccordionWidget - jedyny konsument sanitizeHtml/DOMPurify w SimpleWidgets;
  //    statyczna krawędź trzymała DOMPurify w chunku wejściowym,
  //  * SectionLabelWidgetView - wariantownia z lib/builder/sectionLabelVariants.
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

  // Rozjazd ma DWA kierunki i do 2026-08-19 oba wpadały w jedną surową
  // asercję `toEqual` dwóch tablic, więc diagnoza zaczynała się od czytania
  // diffa 58 nazw. Rozdzielone: duplikat łapie test niżej, a tutaj różnica
  // zbiorów nazywa kierunek i winowajcę wprost.
  it("does not leak unexpected exports", () => {
    const exported = Object.keys(registry);
    // `string[]`, nie krotka literalna - inaczej `includes(name: string)` nie typuje się.
    const listed: string[] = [...SPLIT_WIDGETS];
    // brakuje na liście: rejestr eksportuje, lista milczy (nowy widget bez wpisu)
    const missing = exported.filter((name) => !listed.includes(name));
    // nadmiar na liście: lista trzyma nazwę, której rejestr już nie eksportuje
    const extra = listed.filter((name) => !exported.includes(name));
    expect(
      { missing, extra },
      `brakuje na liście: ${missing.join(", ") || "(nic)"}; nadmiar na liście: ${extra.join(", ") || "(nic)"}`,
    ).toEqual({ missing: [], extra: [] });
  });

  // Zamyka kierunek „duplikat" na zawsze: różnica zbiorów wyżej jest liczona
  // przez `includes`, więc sama dwukrotnego wpisu NIE zobaczy.
  it("lists every widget exactly once", () => {
    const duplicates = [...new Set(SPLIT_WIDGETS.filter((n, i) => SPLIT_WIDGETS.indexOf(n) !== i))];
    expect(duplicates, `zdublowane wpisy na liście: ${duplicates.join(", ")}`).toEqual([]);
    expect(new Set(SPLIT_WIDGETS).size).toBe(SPLIT_WIDGETS.length);
  });
});
