// SZABLONY ŚCIEŻEK - kontrakt danych (szablony żyją w kodzie, instalacja =
// szkic u najemcy przez `admin_journey_create` + treści maili).
//
// Szablon niesie: kategorię (usługa wyłącznie z podstawą prawną), wyzwalacz
// i ustawienia wersji, graf, treść każdego maila PL/EN (EmailDoc v1) oraz
// odnośniki do wiedzy „Insider marketingowy" (identyfikatory KPI, scenariuszy
// i frameworków z `docs/benchmarki/insider-2026-10-19` - liczby benchmarków
// czyta S6/S8 z pakietu, szablon ich nie powiela).
import type { EmailDoc, EmailI18n } from "@/lib/newsletter/emailDoc";
import type { JourneyGraph, JourneySettings } from "../graph";
import type { JourneyCategory } from "../limits";

export const JOURNEY_TEMPLATE_KEYS = [
  "welcome_onboarding",
  "newsletter_welcome",
  "paywall_nurture",
  "quota_exhausted_upgrade",
  "abandoned_checkout",
  "trial_ending",
  "payment_failed_crm",
  "cancel_scheduled_save",
  "winback_30d",
  "event_registration_nurture",
  "event_attended_upsell",
  "club_application_received",
  "club_application_followup",
  "pricing_enquiry_b2b",
] as const;
export type JourneyTemplateKey = (typeof JOURNEY_TEMPLATE_KEYS)[number];

export interface JourneyTemplateEmail {
  /** Węzeł `send_email` grafu, do którego należy treść (wariant A). */
  nodeId: string;
  subject: EmailI18n;
  preheader: EmailI18n;
  doc: EmailDoc;
}

export type JourneyTemplateAvailability =
  | { status: "available" }
  /** Szablon czeka na zdarzenie, którego szyna jeszcze nie emituje. */
  | { status: "unavailable"; awaitedEvent: string };

export interface JourneyTemplateKnowledge {
  kpis: readonly string[];
  scenarios: readonly string[];
  frameworks: readonly string[];
}

export interface JourneyTemplate {
  key: JourneyTemplateKey;
  category: JourneyCategory;
  /** Podstawa prawna komunikacji usługowej (PL/EN); `null` dla marketingu. */
  legalBasis: EmailI18n | null;
  availability: JourneyTemplateAvailability;
  /** Przepis automatyzacji zastępowany przez szablon (ostrzeżenie i wyłączenie w S8). */
  replacesWorkflowTemplate: string | null;
  settings: JourneySettings;
  graph: JourneyGraph;
  emails: readonly JourneyTemplateEmail[];
  knowledge: JourneyTemplateKnowledge;
}
