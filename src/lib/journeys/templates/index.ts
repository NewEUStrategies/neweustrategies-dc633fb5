// KATALOG SZABLONÓW ŚCIEŻEK - czternaście gotowych grafów z treścią PL/EN.
//
// Szablon jest DANYMI (graf, ustawienia, treści, odnośniki do wiedzy) -
// instalacja tworzy szkic u najemcy (`installJourneyTemplate`), który admin
// przegląda, testuje na żywo i publikuje. Silnik nie zna szablonów: po
// instalacji to zwykła ścieżka najemcy.
import { abandonedCheckout } from "./abandoned_checkout";
import { cancelScheduledSave } from "./cancel_scheduled_save";
import { clubApplicationFollowup } from "./club_application_followup";
import { clubApplicationReceived } from "./club_application_received";
import { eventAttendedUpsell } from "./event_attended_upsell";
import { eventRegistrationNurture } from "./event_registration_nurture";
import { newsletterWelcome } from "./newsletter_welcome";
import { paymentFailedCrm } from "./payment_failed_crm";
import { paywallNurture } from "./paywall_nurture";
import { pricingEnquiryB2b } from "./pricing_enquiry_b2b";
import { quotaExhaustedUpgrade } from "./quota_exhausted_upgrade";
import { trialEnding } from "./trial_ending";
import { welcomeOnboarding } from "./welcome_onboarding";
import { winback30d } from "./winback_30d";
import { JOURNEY_TEMPLATE_KEYS, type JourneyTemplate, type JourneyTemplateKey } from "./types";

export { JOURNEY_TEMPLATE_KEYS };
export type { JourneyTemplate, JourneyTemplateKey };

export const JOURNEY_TEMPLATES: Readonly<Record<JourneyTemplateKey, JourneyTemplate>> = {
  welcome_onboarding: welcomeOnboarding,
  newsletter_welcome: newsletterWelcome,
  paywall_nurture: paywallNurture,
  quota_exhausted_upgrade: quotaExhaustedUpgrade,
  abandoned_checkout: abandonedCheckout,
  trial_ending: trialEnding,
  payment_failed_crm: paymentFailedCrm,
  cancel_scheduled_save: cancelScheduledSave,
  winback_30d: winback30d,
  event_registration_nurture: eventRegistrationNurture,
  event_attended_upsell: eventAttendedUpsell,
  club_application_received: clubApplicationReceived,
  club_application_followup: clubApplicationFollowup,
  pricing_enquiry_b2b: pricingEnquiryB2b,
};

export function journeyTemplate(key: string): JourneyTemplate | null {
  return (JOURNEY_TEMPLATES as Record<string, JourneyTemplate | undefined>)[key] ?? null;
}

export function isTemplateAvailable(template: JourneyTemplate): boolean {
  return template.availability.status === "available";
}
