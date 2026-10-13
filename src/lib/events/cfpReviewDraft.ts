// Szkice OKIEN DECYZJI w naborze: ocena recenzenta, decyzja organizatora
// i przyjęcie z planem sesji.
//
// JEDEN PLIK, BO TRZY MAŁE FORMULARZE O TEJ SAMEJ NATURZE: kilka pól, reguły
// lustrzane do jednej funkcji SQL i ładunek. Każdy ma własny zestaw funkcji,
// nic nie jest współdzielone przez przypadek.
import type { CfpDecisionStatus, CfpRecommendation, CfpSessionFormat } from "@/lib/events/cfpEnums";
import type { CfpAcceptInput, CfpDecisionInput } from "@/lib/events/cfpApi";
import type { CfpReviewInput } from "@/lib/events/cfpPublicApi";
import type { CfpCriterion, CfpMyReview } from "@/lib/events/cfpSurface";
import { eventLocalInputToIso } from "@/lib/events/eventLocalInput";
import { eventTimeZone } from "@/lib/events/timezone";

// ------------------------------------------------------------ ocena recenzenta

export interface CfpReviewDraft {
  scores: Record<string, number | null>;
  overall: number | null;
  recommendation: CfpRecommendation | null;
  commentPrivate: string;
  commentToSpeaker: string;
  conflictOfInterest: boolean;
}

export function cfpReviewDraftFrom(
  review: CfpMyReview | null,
  criteria: readonly CfpCriterion[],
): CfpReviewDraft {
  return {
    scores: Object.fromEntries(
      criteria.map((criterion) => [criterion.key, review?.scores[criterion.key] ?? null]),
    ),
    overall: review?.overall ?? null,
    recommendation: review?.recommendation ?? null,
    commentPrivate: review?.commentPrivate ?? "",
    commentToSpeaker: review?.commentToSpeaker ?? "",
    conflictOfInterest: review?.conflictOfInterest ?? false,
  };
}

/** `null` = szkic jest do wysłania; inaczej klucz komunikatu. */
export function cfpReviewIssue(draft: CfpReviewDraft): string | null {
  if (draft.overall === null && !draft.conflictOfInterest && draft.recommendation !== "abstain") {
    return "eventCfp.review.validation.overall";
  }
  if (draft.commentPrivate.length > 4000 || draft.commentToSpeaker.length > 4000) {
    return "eventCfp.review.validation.comments";
  }
  return null;
}

export function cfpReviewPayload(submissionId: string, draft: CfpReviewDraft): CfpReviewInput {
  const scores: Record<string, number> = {};
  for (const [key, value] of Object.entries(draft.scores)) {
    if (value !== null) scores[key] = value;
  }
  return {
    submissionId,
    scores,
    overall: draft.overall,
    recommendation: draft.recommendation,
    commentPrivate: draft.commentPrivate.trim(),
    commentToSpeaker: draft.commentToSpeaker.trim(),
    conflictOfInterest: draft.conflictOfInterest,
  };
}

/** Skala 1..max jako lista (przyciski oceny). */
export function scoreScale(scoreMax: number): number[] {
  return Array.from({ length: Math.max(0, scoreMax) }, (_, index) => index + 1);
}

// --------------------------------------------------------- decyzja organizatora

export interface CfpDecisionDraft {
  status: CfpDecisionStatus;
  decisionNote: string;
  feedbackToSpeaker: string;
}

export function cfpDecisionIssue(draft: CfpDecisionDraft): string | null {
  if (draft.status === "rejected" && draft.decisionNote.trim().length < 3) {
    return "adminEventCfp.detail.validation.noteRequired";
  }
  if (draft.decisionNote.length > 2000 || draft.feedbackToSpeaker.length > 4000) {
    return "adminEventCfp.detail.validation.tooLong";
  }
  return null;
}

export function cfpDecisionPayload(id: string, draft: CfpDecisionDraft): CfpDecisionInput {
  return {
    id,
    status: draft.status,
    decisionNote: draft.decisionNote.trim(),
    feedbackToSpeaker: draft.feedbackToSpeaker.trim(),
  };
}

// ---------------------------------------------------------- przyjęcie z planem
//
// TERMIN SESJI JEST ZEGAREM W STREFIE WYDARZENIA (klasa OPS-15) - tak jak
// w dialogu sesji agendy, do której ten szkic trafia. Kalendarz czytał go
// w strefie PRZEGLĄDARKI: „9:30" wpisane w Londynie dla kongresu w Warszawie
// lądowało w programie o 10:30. Pola niosą `YYYY-MM-DDTHH:mm` w strefie
// `timeZone`, a chwile liczy `eventLocalInputToIso` (reguła Postgresa dla
// luki i zakładki). Szkic jest zawsze nowy, więc nie ma chwil z bazy.

export interface CfpAcceptDraft {
  decisionNote: string;
  feedbackToSpeaker: string;
  register: boolean;
  schedule: boolean;
  /** `YYYY-MM-DDTHH:mm` w strefie `timeZone` albo `""`. */
  startsAt: string;
  endsAt: string;
  roomId: string;
  trackId: string;
  format: CfpSessionFormat;
  /** Strefa wydarzenia (IANA, zwalidowana), w której pola terminu są zegarem. */
  timeZone: string;
}

/** Pole terminu sesji -> chwila w UTC albo `null` (pole puste albo niepełne). */
export function cfpAcceptInstant(
  draft: CfpAcceptDraft,
  field: "startsAt" | "endsAt",
): string | null {
  return eventLocalInputToIso(draft[field], draft.timeZone);
}

export function cfpAcceptDraftFrom(input: {
  decisionNote: string;
  feedbackToSpeaker: string;
  trackId: string | null;
  /** `events.timezone` - nieznana `Intl` degraduje do strefy domyślnej serwisu. */
  timeZone: string | null | undefined;
}): CfpAcceptDraft {
  return {
    decisionNote: input.decisionNote,
    feedbackToSpeaker: input.feedbackToSpeaker,
    register: true,
    schedule: false,
    startsAt: "",
    endsAt: "",
    roomId: "",
    trackId: input.trackId ?? "",
    format: "onsite",
    timeZone: eventTimeZone({ timezone: input.timeZone }),
  };
}

const MAX_SESSION_MS = 48 * 60 * 60 * 1000;

export function cfpAcceptIssue(draft: CfpAcceptDraft): string | null {
  if (draft.decisionNote.length > 2000 || draft.feedbackToSpeaker.length > 4000) {
    return "adminEventCfp.detail.validation.tooLong";
  }
  if (!draft.schedule) return null;
  // Chwile w strefie wydarzenia - te same, które pójdą do bazy. Długość sesji
  // liczy się na chwilach, więc noc zmiany czasu nie skraca jej ani nie wydłuża.
  const startsIso = cfpAcceptInstant(draft, "startsAt");
  const endsIso = cfpAcceptInstant(draft, "endsAt");
  const starts = startsIso === null ? Number.NaN : Date.parse(startsIso);
  const ends = endsIso === null ? Number.NaN : Date.parse(endsIso);
  if (
    Number.isNaN(starts) ||
    Number.isNaN(ends) ||
    ends <= starts ||
    ends - starts > MAX_SESSION_MS
  ) {
    return "adminEventCfp.accept.validation.schedule";
  }
  return null;
}

export function cfpAcceptPayload(id: string, draft: CfpAcceptDraft): CfpAcceptInput {
  return {
    id,
    decisionNote: draft.decisionNote.trim(),
    feedbackToSpeaker: draft.feedbackToSpeaker.trim(),
    register: draft.register,
    // `cfpAcceptIssue` odcina plan bez obu chwil, więc `""` tu nie dociera;
    // gdyby jednak dotarł, baza odmówi go jako nieczytelnej daty.
    schedule: draft.schedule
      ? {
          startsAt: cfpAcceptInstant(draft, "startsAt") ?? "",
          endsAt: cfpAcceptInstant(draft, "endsAt") ?? "",
          roomId: draft.roomId === "" ? null : draft.roomId,
          trackId: draft.trackId === "" ? null : draft.trackId,
          format: draft.format,
        }
      : null,
  };
}
