// Cele konwersji LinkedIn Ads zgłaszane przez Insight Tag - lista i lejek.
//
// Kolejność i grupy odpowiadają kategoriom LinkedIn Campaign Manager
// (Górny / Środkowy / Dolny lejek / Zamknięta transakcja), więc panel
// "Pixels" pokazuje pola w tej samej kolejności, w jakiej administrator
// wybiera kategorię przy tworzeniu konwersji. Moduł jest czysty (bez DOM
// i zgód), bo czytają go schemat ustawień i formularz panelu.

export const LINKEDIN_GOALS = [
  "page_view",
  "video_view",
  "event_registration",
  "account_signup",
  "download",
  "newsletter",
  "schedule",
  "contact_form",
  "club_application",
  "add_to_cart",
  "purchase",
] as const;

export type LinkedInGoal = (typeof LINKEDIN_GOALS)[number];

export type LinkedInFunnelStage = "top" | "middle" | "bottom" | "closed";

/** Sposób liczenia, który warto ustawić w Campaign Manager. */
export type LinkedInCounting = "one" | "every";

export interface LinkedInFunnelGroup {
  stage: LinkedInFunnelStage;
  goals: readonly LinkedInGoal[];
}

export const LINKEDIN_FUNNEL: readonly LinkedInFunnelGroup[] = [
  { stage: "top", goals: ["page_view", "video_view", "event_registration"] },
  {
    stage: "middle",
    goals: ["account_signup", "download", "newsletter", "schedule", "contact_form"],
  },
  { stage: "bottom", goals: ["club_application", "add_to_cart"] },
  { stage: "closed", goals: ["purchase"] },
];

export const LINKEDIN_GOAL_COUNTING: Readonly<Record<LinkedInGoal, LinkedInCounting>> = {
  page_view: "one",
  video_view: "one",
  event_registration: "one",
  account_signup: "one",
  download: "one",
  newsletter: "one",
  schedule: "one",
  contact_form: "one",
  club_application: "one",
  add_to_cart: "every",
  purchase: "every",
};
