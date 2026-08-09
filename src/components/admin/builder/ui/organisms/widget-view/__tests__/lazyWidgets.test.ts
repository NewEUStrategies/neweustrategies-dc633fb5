import { describe, it, expect } from "vitest";
import * as lazyWidgets from "@/components/admin/builder/ui/organisms/widget-view/lazyWidgets";

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
