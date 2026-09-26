// Fabryki obiektów uczestnika dla testów funkcji F1-F5.
//
// JEDYNA DROGA BUDOWANIA TYCH OBIEKTÓW W TESTACH (kontrakt B.6-18). Tory A/B/C
// rozszerzają kształty (`ParticipantRegistration`, `RegistrationManageView`)
// o pola opcjonalne. Gdyby każdy test składał literał sam, każde nowe pole
// wymagałoby edycji dziesiątek plików trzech torów naraz - czyli konfliktu przy
// scalaniu. Fabryka ma komplet pól z wartościami realistycznymi, a test
// nadpisuje tylko to, o czym mówi. Tor B DOPISUJE tu pola opcjonalne; niczego
// nie usuwa i nie zmienia wartości domyślnych.
//
// DANE SYNTETYCZNE: identyfikatory w kształcie UUID, adresy `example.org`.
import type { MyEventRegistrationSummary } from "@/components/events/participant/slots/slotTypes";
import type { EventParticipantOptions } from "@/lib/events/participantOptionsApi";
import {
  DEFAULT_PARTICIPANT_SETTINGS,
  type ParticipantSettings,
} from "@/lib/events/participantSettings";
import type { ParticipantRegistration } from "@/lib/events/participantTicketsApi";
import type { RegistrationManageView } from "@/lib/events/publicRegistrationApi";

export const PARTICIPANT_IDS = {
  event: "a1111111-1111-4111-8111-111111111111",
  registration: "a2222222-2222-4222-8222-222222222222",
  ticketType: "a3333333-3333-4333-8333-333333333333",
} as const;

export const PARTICIPANT_EVENT_SLUG = "forum-2030";

export function makeParticipantRegistration(
  overrides: Partial<ParticipantRegistration> = {},
): ParticipantRegistration {
  return {
    registrationId: PARTICIPANT_IDS.registration,
    eventId: PARTICIPANT_IDS.event,
    ticketTypeId: PARTICIPANT_IDS.ticketType,
    status: "approved",
    paymentStatus: "paid",
    createdAt: "2030-05-01T10:00:00.000Z",
    cancelledAt: null,
    paidAt: "2030-05-01T10:05:00.000Z",
    waitlistPosition: null,
    promotedAt: null,
    notifyEmail: true,
    notifySms: false,
    cancelReason: null,
    decisionSource: null,
    eventSlug: PARTICIPANT_EVENT_SLUG,
    eventTitlePl: "Forum 2030",
    eventTitleEn: "Forum 2030",
    eventStartsAt: "2030-06-10T08:00:00.000Z",
    eventEndsAt: "2030-06-10T16:00:00.000Z",
    eventTimezone: "Europe/Warsaw",
    orderStatus: "paid",
    amountCents: 12000,
    refundedCents: 0,
    currency: "PLN",
    webhooks: [],
    ...overrides,
  };
}

export function makeRegistrationManageView(
  overrides: Partial<RegistrationManageView> = {},
): RegistrationManageView {
  return {
    registrationId: PARTICIPANT_IDS.registration,
    eventId: PARTICIPANT_IDS.event,
    eventSlug: PARTICIPANT_EVENT_SLUG,
    ticketTypeId: PARTICIPANT_IDS.ticketType,
    status: "approved",
    paymentStatus: "paid",
    waitlistPosition: null,
    amountCents: 12000,
    currency: "PLN",
    ownedByCaller: false,
    ...overrides,
  };
}

export function makeEventParticipantOptions(
  overrides: Partial<EventParticipantOptions> = {},
): EventParticipantOptions {
  return {
    eventId: PARTICIPANT_IDS.event,
    timezone: "Europe/Warsaw",
    startsAt: "2030-06-10T08:00:00.000Z",
    endsAt: "2030-06-10T16:00:00.000Z",
    effectiveEnd: "2030-06-10T16:00:00.000Z",
    calendarExportEnabled: true,
    remindersEnabled: true,
    reminderEventLeadsMinutes: [1440, 60],
    sessionRemindersEnabled: true,
    sessionReminderLeadMinutes: 15,
    reminderSmsEnabled: false,
    transferEnabled: true,
    transferDeadlineAt: "2030-06-09T08:00:00.000Z",
    refundMode: "policy",
    refundDeadlineHours: 168,
    waitlistOfferHours: 24,
    certificateEnabled: false,
    surveyEnabled: false,
    surveyOpensAt: "2030-06-10T16:00:00.000Z",
    surveyClosesAt: "2030-06-24T16:00:00.000Z",
    ...overrides,
  };
}

export function makeParticipantSettings(
  overrides: Partial<ParticipantSettings> = {},
): ParticipantSettings {
  return {
    ...DEFAULT_PARTICIPANT_SETTINGS,
    reminderEventLeadsMinutes: [...DEFAULT_PARTICIPANT_SETTINGS.reminderEventLeadsMinutes],
    eventId: PARTICIPANT_IDS.event,
    hasRow: false,
    hasSessionCheckpoints: false,
    updatedAt: null,
    ...overrides,
  };
}

/**
 * Zgłoszenie wołającego w kształcie panelu „Moje" (`event_my_event_profile`
 * -> `registration`) - właściwość `registration` gniazd `EventMeSlotProps`.
 */
export function makeMyEventRegistrationSummary(
  overrides: Partial<MyEventRegistrationSummary> = {},
): MyEventRegistrationSummary {
  return {
    registrationId: PARTICIPANT_IDS.registration,
    status: "approved",
    paymentStatus: "paid",
    directoryOptOut: false,
    notifyEmail: true,
    notifySms: false,
    groups: [],
    ...overrides,
  };
}
