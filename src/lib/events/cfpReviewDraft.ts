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

export interface CfpAcceptDraft {
  decisionNote: string;
  feedbackToSpeaker: string;
  register: boolean;
  schedule: boolean;
  startsAt: string;
  endsAt: string;
  roomId: string;
  trackId: string;
  format: CfpSessionFormat;
}

export function cfpAcceptDraftFrom(input: {
  decisionNote: string;
  feedbackToSpeaker: string;
  trackId: string | null;
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
  };
}

const MAX_SESSION_MS = 48 * 60 * 60 * 1000;

export function cfpAcceptIssue(draft: CfpAcceptDraft): string | null {
  if (draft.decisionNote.length > 2000 || draft.feedbackToSpeaker.length > 4000) {
    return "adminEventCfp.detail.validation.tooLong";
  }
  if (!draft.schedule) return null;
  const starts = Date.parse(draft.startsAt);
  const ends = Date.parse(draft.endsAt);
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
    schedule: draft.schedule
      ? {
          startsAt: draft.startsAt,
          endsAt: draft.endsAt,
          roomId: draft.roomId === "" ? null : draft.roomId,
          trackId: draft.trackId === "" ? null : draft.trackId,
          format: draft.format,
        }
      : null,
  };
}
