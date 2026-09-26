// Dziennik doręczeń uczestnika (`event_message_deliveries`) - katalog rodzajów,
// kanałów i stanów oraz ich etykiety w panelu komunikacji.
//
// PO CO CZYSTY MODUŁ. Rodzaj (`kind`), kanał i stan są w bazie tekstem
// z nazwanym CHECK-iem, więc typ z `types.ts` to `string` i kompilator nie
// zobaczy rodzaju, którego baza nie przyjmie. Listy stoją tu RAZ, a test
// parytetu (`participantDeliveryKinds.test.ts`) porównuje je z nazwanymi
// ograniczeniami migracji. Tory A/B/C tylko rezerwują doręczenia tymi
// rodzajami - nowy rodzaj to wpis w rejestrze Foundation (`PF-<X>-needs:`).
//
// ETYKIETY PRZEZ PEŁNE KLUCZE. `Record<Rodzaj, "pełny.klucz">` zamiast
// sklejania `adminEventParticipant.deliveries.kind.${kind}` - skaner kluczy
// widzi każdy liść, a brak etykiety dla nowego rodzaju jest błędem typu.

/** Rodzaje doręczeń (`event_message_deliveries_kind_values`). */
export const DELIVERY_KINDS = [
  "event_reminder",
  "session_reminder",
  "waitlist_offer",
  "waitlist_offer_expired",
  "waitlist_offer_refunded",
  "waitlist_joined",
  "transfer_offer",
  "transfer_completed",
  "transfer_revoked",
  "survey_invite",
  "certificate_ready",
] as const;
export type DeliveryKind = (typeof DELIVERY_KINDS)[number];

/** Kanały (`event_message_deliveries_channel_values`). */
export const DELIVERY_CHANNELS = ["email", "sms", "inapp"] as const;
export type DeliveryChannel = (typeof DELIVERY_CHANNELS)[number];

/** Stany wpisu (`event_message_deliveries_status_values`). */
export const DELIVERY_STATUSES = ["claimed", "sent", "skipped", "failed"] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const DELIVERY_KIND_LABEL_KEYS: Record<
  DeliveryKind,
  | "adminEventParticipant.deliveries.kind.eventReminder"
  | "adminEventParticipant.deliveries.kind.sessionReminder"
  | "adminEventParticipant.deliveries.kind.waitlistOffer"
  | "adminEventParticipant.deliveries.kind.waitlistOfferExpired"
  | "adminEventParticipant.deliveries.kind.waitlistOfferRefunded"
  | "adminEventParticipant.deliveries.kind.waitlistJoined"
  | "adminEventParticipant.deliveries.kind.transferOffer"
  | "adminEventParticipant.deliveries.kind.transferCompleted"
  | "adminEventParticipant.deliveries.kind.transferRevoked"
  | "adminEventParticipant.deliveries.kind.surveyInvite"
  | "adminEventParticipant.deliveries.kind.certificateReady"
> = {
  event_reminder: "adminEventParticipant.deliveries.kind.eventReminder",
  session_reminder: "adminEventParticipant.deliveries.kind.sessionReminder",
  waitlist_offer: "adminEventParticipant.deliveries.kind.waitlistOffer",
  waitlist_offer_expired: "adminEventParticipant.deliveries.kind.waitlistOfferExpired",
  waitlist_offer_refunded: "adminEventParticipant.deliveries.kind.waitlistOfferRefunded",
  waitlist_joined: "adminEventParticipant.deliveries.kind.waitlistJoined",
  transfer_offer: "adminEventParticipant.deliveries.kind.transferOffer",
  transfer_completed: "adminEventParticipant.deliveries.kind.transferCompleted",
  transfer_revoked: "adminEventParticipant.deliveries.kind.transferRevoked",
  survey_invite: "adminEventParticipant.deliveries.kind.surveyInvite",
  certificate_ready: "adminEventParticipant.deliveries.kind.certificateReady",
};

export const DELIVERY_CHANNEL_LABEL_KEYS: Record<
  DeliveryChannel,
  | "adminEventParticipant.deliveries.channel.email"
  | "adminEventParticipant.deliveries.channel.sms"
  | "adminEventParticipant.deliveries.channel.inapp"
> = {
  email: "adminEventParticipant.deliveries.channel.email",
  sms: "adminEventParticipant.deliveries.channel.sms",
  inapp: "adminEventParticipant.deliveries.channel.inapp",
};

export const DELIVERY_STATUS_LABEL_KEYS: Record<
  DeliveryStatus,
  | "adminEventParticipant.deliveries.status.claimed"
  | "adminEventParticipant.deliveries.status.sent"
  | "adminEventParticipant.deliveries.status.skipped"
  | "adminEventParticipant.deliveries.status.failed"
> = {
  claimed: "adminEventParticipant.deliveries.status.claimed",
  sent: "adminEventParticipant.deliveries.status.sent",
  skipped: "adminEventParticipant.deliveries.status.skipped",
  failed: "adminEventParticipant.deliveries.status.failed",
};

export function isDeliveryKind(value: unknown): value is DeliveryKind {
  return typeof value === "string" && (DELIVERY_KINDS as readonly string[]).includes(value);
}

export function isDeliveryChannel(value: unknown): value is DeliveryChannel {
  return typeof value === "string" && (DELIVERY_CHANNELS as readonly string[]).includes(value);
}

export function isDeliveryStatus(value: unknown): value is DeliveryStatus {
  return typeof value === "string" && (DELIVERY_STATUSES as readonly string[]).includes(value);
}
