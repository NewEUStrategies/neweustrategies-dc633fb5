// Cele konwersji X Ads zgłaszane pikselem X (`twq('event', 'tw-…', {...})`).
//
// Te same, potwierdzone wyniki co LinkedIn i Google Ads (wspólne nazwy celów),
// ułożone w tej samej kolejności lejka, więc panel "Pixels" wygląda w obu
// zakładkach tak samo. Każdy cel ma podany typ zdarzenia z X Events Manager
// (Events Manager -> Add events -> Define event -> Event type), który
// administrator wybiera przy tworzeniu zdarzenia. Moduł czysty (bez DOM i zgód).
import { LINKEDIN_FUNNEL, LINKEDIN_GOALS, type LinkedInFunnelStage } from "./linkedinGoals";

export const X_GOALS = LINKEDIN_GOALS;
export type XGoal = (typeof X_GOALS)[number];

export interface XFunnelGroup {
  stage: LinkedInFunnelStage;
  goals: readonly XGoal[];
}

export const X_FUNNEL: readonly XFunnelGroup[] = LINKEDIN_FUNNEL;

/** Typ zdarzenia w X Events Manager (nazwa jak w interfejsie X). */
export const X_EVENT_TYPES: Readonly<Record<XGoal, string>> = {
  page_view: "Page view",
  video_view: "Content view",
  event_registration: "Sign up",
  account_signup: "Sign up",
  download: "Download",
  newsletter: "Subscribe",
  schedule: "Lead",
  contact_form: "Lead",
  club_application: "Lead",
  add_to_cart: "Add to cart",
  purchase: "Purchase",
};

/** Cele, które X dostaje z kwotą i walutą transakcji. */
export const X_VALUE_GOALS: readonly XGoal[] = ["purchase"];
