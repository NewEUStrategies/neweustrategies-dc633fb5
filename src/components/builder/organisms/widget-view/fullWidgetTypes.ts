import type { WidgetType } from "@/lib/builder/types";

// Content-only cases owned by WidgetView. Keep this small metadata module
// independent of renderers so routing a widget does not import its chunk.
// The dispatcher parity test checks the list against all three renderers.
export const FULL_WIDGET_TYPES = [
  "tts",
  "post-list",
  "carousel",
  "tailored-must-reads",
  "news-ticker",
  "trending-now",
  "event-schedule",
  "event-list",
  "event-countdown",
  "event-countdown-card",
  "purchase-confirmation",
  "meeting-booking",
  "event-sponsors",
  "chart",
  "data-map",
  "world-map",
  "feature-timeline",
  "feature-sankey",
  "feature-compare",
  "feature-risk-matrix",
  "feature-indicator",
  "feature-network",
  "feature-corridor-map",
  "feature-sources",
  "feature-methodology",
  "podcast-latest",
  "club-card",
  "club-threads",
  "club-hub",
  "web-stories-carousel",
  "categories",
  "tags",
  "join-us",
  "customize-interests",
  "onboarding-form",
  "progress-carousel",
  "circular-carousel",
  "travel-route-card",
  "cover-overlay-card",
  "promo-card",
  "tabs",
  "rated-list",
  "dark-featured-card",
  "ad-slot",
  "donations",
  "rich-text",
] as const satisfies readonly WidgetType[];

const fullWidgetTypes = new Set<WidgetType>(FULL_WIDGET_TYPES);

export function requiresFullWidgetView(type: WidgetType): boolean {
  return fullWidgetTypes.has(type);
}
