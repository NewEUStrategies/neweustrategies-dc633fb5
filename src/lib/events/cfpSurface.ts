// Parsery odpowiedzi `jsonb` NABORU PRELEGENTÓW (panel, strona publiczna, panel
// prelegenta, panel recenzenta).
//
// DLACZEGO PARSER, A NIE RZUTOWANIE. RPC oddaje `jsonb`, więc typ po stronie
// klienta jest deklaracją intencji, nie faktem. Rzutowanie zamieniłoby zmianę
// nazwy klucza w SQL-u na pusty ekran bez jednego błędu w konsoli.
//
// BRAK DANYCH DEGRADUJE DO STANU BEZPIECZNEGO: nieczytelna faza naboru to
// `none` (strona nie pokazuje przycisku, który baza i tak odrzuci), nieznany
// stan zgłoszenia to `draft`, brak listy to pusta lista.
//
// KOLEJNOŚĆ USTALA BAZA (`ORDER BY ...` w SQL-u). Nie sortujemy ponownie.
import type { Json } from "@/integrations/supabase/types";
import {
  asOneOf,
  CFP_FIELD_TYPES,
  CFP_PHASES,
  CFP_RECOMMENDATIONS,
  CFP_SPEAKER_ROLES,
  CFP_STATUSES,
  CFP_SUBMISSION_STATUSES,
  CFP_TALK_LANGUAGES,
  SPEAKER_MATERIAL_KINDS,
  SPEAKER_MATERIAL_VISIBILITIES,
  type CfpFieldType,
  type CfpPhase,
  type CfpRecommendation,
  type CfpSpeakerRole,
  type CfpStatus,
  type CfpSubmissionStatus,
  type CfpTalkLanguage,
  type SpeakerMaterialKind,
  type SpeakerMaterialVisibility,
} from "@/lib/events/cfpEnums";

type Bag = Record<string, unknown>;

function bag(value: unknown): Bag {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Bag)
    : {};
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function strOrNull(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function num(value: unknown, fallback = 0): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : fallback;
}

function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = num(value, Number.NaN);
  return Number.isNaN(parsed) ? null : parsed;
}

function bool(value: unknown): boolean {
  return value === true;
}

function strings(value: unknown): string[] {
  return list(value).filter((item): item is string => typeof item === "string");
}

// ------------------------------------------------------------ wspólne kształty

export interface CfpFormat {
  key: string;
  labelPl: string;
  labelEn: string;
  durationMin: number;
}

export interface CfpCriterion {
  key: string;
  labelPl: string;
  labelEn: string;
  weight: number;
}

export interface CfpChoiceOption {
  value: string;
  labelPl: string;
  labelEn: string;
}

export interface CfpFieldDef {
  id: string;
  key: string;
  fieldType: CfpFieldType;
  labelPl: string;
  labelEn: string;
  helpPl: string;
  helpEn: string;
  isRequired: boolean;
  isActive: boolean;
  options: CfpChoiceOption[];
}

export interface CfpTrackOption {
  id: string;
  key: string;
  namePl: string;
  nameEn: string;
  isActive: boolean;
}

export function parseCfpFormats(value: unknown): CfpFormat[] {
  return list(value).map((raw) => {
    const row = bag(raw);
    return {
      key: str(row.key),
      labelPl: str(row.label_pl),
      labelEn: str(row.label_en),
      durationMin: num(row.duration_min),
    };
  });
}

export function parseCfpCriteria(value: unknown): CfpCriterion[] {
  return list(value).map((raw) => {
    const row = bag(raw);
    return {
      key: str(row.key),
      labelPl: str(row.label_pl),
      labelEn: str(row.label_en),
      weight: num(row.weight, 1),
    };
  });
}

export function parseCfpOptions(value: unknown): CfpChoiceOption[] {
  return list(value).map((raw) => {
    const row = bag(raw);
    return { value: str(row.value), labelPl: str(row.label_pl), labelEn: str(row.label_en) };
  });
}

export function parseCfpField(raw: unknown): CfpFieldDef {
  const row = bag(raw);
  return {
    id: str(row.id),
    key: str(row.key),
    fieldType: asOneOf(CFP_FIELD_TYPES, row.field_type, "text"),
    labelPl: str(row.label_pl),
    labelEn: str(row.label_en),
    helpPl: str(row.help_pl),
    helpEn: str(row.help_en),
    isRequired: bool(row.is_required),
    // Pole bez klucza `is_active` przychodzi z projekcji, która oddaje TYLKO
    // aktywne pytania (strona publiczna, recenzent) - brak znaczy „aktywne".
    isActive: row.is_active !== false,
    options: parseCfpOptions(row.options),
  };
}

function parseTracks(value: unknown): CfpTrackOption[] {
  return list(value).map((raw) => {
    const row = bag(raw);
    return {
      id: str(row.id),
      key: str(row.key),
      namePl: str(row.name_pl),
      nameEn: str(row.name_en),
      isActive: row.is_active !== false,
    };
  });
}

// ------------------------------------------------------------------ ustawienia

export interface CfpNamedOption {
  id: string;
  key: string;
  namePl: string;
  nameEn: string;
  isActive: boolean;
}

export interface CfpRoomOption {
  id: string;
  name: string;
  isActive: boolean;
}

export interface CfpSettings {
  eventId: string;
  eventSlug: string;
  eventStatus: string;
  eventTimezone: string;
  exists: boolean;
  status: CfpStatus;
  phase: CfpPhase;
  isOpen: boolean;
  opensAt: string | null;
  closesAt: string | null;
  introPl: string;
  introEn: string;
  guidelinesPl: string;
  guidelinesEn: string;
  formats: CfpFormat[];
  trackIds: string[];
  maxPerSubmitter: number;
  allowCoSpeakers: boolean;
  reviewBlind: boolean;
  scoreMax: number;
  reviewCriteria: CfpCriterion[];
  minReviews: number;
  speakerGroupId: string | null;
  speakerTicketTypeId: string | null;
  updatedAt: string | null;
  tracks: CfpTrackOption[];
  rooms: CfpRoomOption[];
  groups: CfpNamedOption[];
  tickets: CfpNamedOption[];
}

function parseNamed(value: unknown): CfpNamedOption[] {
  return parseTracks(value);
}

export function parseCfpSettings(value: Json | null): CfpSettings {
  const row = bag(value);
  const options = bag(row.options);
  return {
    eventId: str(row.event_id),
    eventSlug: str(row.event_slug),
    eventStatus: str(row.event_status),
    eventTimezone: str(row.event_timezone),
    exists: bool(row.exists),
    status: asOneOf(CFP_STATUSES, row.status, "draft"),
    phase: asOneOf(CFP_PHASES, row.phase, "none"),
    isOpen: bool(row.is_open),
    opensAt: strOrNull(row.opens_at),
    closesAt: strOrNull(row.closes_at),
    introPl: str(row.intro_pl),
    introEn: str(row.intro_en),
    guidelinesPl: str(row.guidelines_pl),
    guidelinesEn: str(row.guidelines_en),
    formats: parseCfpFormats(row.formats),
    trackIds: strings(row.track_ids),
    maxPerSubmitter: num(row.max_per_submitter, 3),
    allowCoSpeakers: row.allow_co_speakers !== false,
    reviewBlind: bool(row.review_blind),
    scoreMax: num(row.score_max, 5),
    reviewCriteria: parseCfpCriteria(row.review_criteria),
    minReviews: num(row.min_reviews, 2),
    speakerGroupId: strOrNull(row.speaker_group_id),
    speakerTicketTypeId: strOrNull(row.speaker_ticket_type_id),
    updatedAt: strOrNull(row.updated_at),
    tracks: parseTracks(options.tracks),
    rooms: list(options.rooms).map((raw) => {
      const room = bag(raw);
      return { id: str(room.id), name: str(room.name), isActive: room.is_active !== false };
    }),
    groups: parseNamed(options.groups),
    tickets: parseNamed(options.tickets),
  };
}

// ----------------------------------------------------------- liczniki panelu

export interface CfpCounts {
  total: number;
  draft: number;
  byStatus: Record<CfpSubmissionStatus, number>;
  needsReviews: number;
  minReviews: number;
}

export function parseCfpCounts(value: Json | null): CfpCounts {
  const row = bag(value);
  const byStatus = Object.fromEntries(
    CFP_SUBMISSION_STATUSES.map((status) => [status, num(row[status])]),
  ) as Record<CfpSubmissionStatus, number>;
  return {
    total: num(row.total),
    draft: byStatus.draft,
    byStatus,
    needsReviews: num(row.needs_reviews),
    minReviews: num(row.min_reviews, 2),
  };
}

// --------------------------------------------------------- agregaty ocen

export interface CfpRecommendationCounts {
  accept: number;
  maybe: number;
  reject: number;
  abstain: number;
}

export function parseRecommendations(value: unknown): CfpRecommendationCounts {
  const row = bag(value);
  return {
    accept: num(row.accept),
    maybe: num(row.maybe),
    reject: num(row.reject),
    abstain: num(row.abstain),
  };
}

export interface CfpReviewSummary {
  reviewsCount: number;
  conflictsCount: number;
  overallAvg: number | null;
  weightedAvg: number | null;
  recommendations: CfpRecommendationCounts;
}

function parseSummary(value: unknown): CfpReviewSummary {
  const row = bag(value);
  return {
    reviewsCount: num(row.reviews_count),
    conflictsCount: num(row.conflicts_count),
    overallAvg: numOrNull(row.overall_avg),
    weightedAvg: numOrNull(row.weighted_avg),
    recommendations: parseRecommendations(row.recommendations),
  };
}

// ------------------------------------------------------ szczegół (panel)

export interface CfpCrmLink {
  syncStatus: "ok" | "error" | "skipped";
  crmLeadId: string | null;
  lastError: string | null;
  syncedAt: string | null;
}

export interface CfpSpeakerEntry {
  id: string;
  personId: string | null;
  isPrimary: boolean;
  role: CfpSpeakerRole;
  firstName: string;
  lastName: string;
  email: string | null;
  jobTitle: string | null;
  companyText: string | null;
  crm: CfpCrmLink | null;
}

export interface CfpReviewEntry {
  id: string;
  reviewerName: string;
  scores: Record<string, number>;
  overall: number | null;
  recommendation: CfpRecommendation | null;
  commentPrivate: string;
  commentToSpeaker: string;
  conflictOfInterest: boolean;
  updatedAt: string | null;
}

export interface CfpSubmissionCore {
  id: string;
  eventId: string;
  status: CfpSubmissionStatus;
  titlePl: string;
  titleEn: string;
  abstractPl: string;
  abstractEn: string;
  talkLanguage: CfpTalkLanguage;
  formatKey: string | null;
  durationMin: number | null;
  trackId: string | null;
  topics: string[];
  answers: Record<string, unknown>;
  submittedAt: string | null;
}

export interface CfpSubmissionDetail extends CfpSubmissionCore {
  decisionNote: string;
  feedbackToSpeaker: string;
  decidedAt: string | null;
  notifiedStatus: string | null;
  notifiedAt: string | null;
  notifyError: string | null;
  sessionId: string | null;
  eventSlug: string;
  eventTimezone: string;
  eventStartsAt: string | null;
  eventEndsAt: string | null;
  person: {
    id: string;
    email: string | null;
    phone: string | null;
    consentMarketing: boolean;
  };
  speakers: CfpSpeakerEntry[];
  fields: CfpFieldDef[];
  reviews: CfpReviewEntry[];
  summary: CfpReviewSummary;
  scoreMax: number;
  reviewCriteria: CfpCriterion[];
  formats: CfpFormat[];
  minReviews: number;
  track: { id: string; namePl: string; nameEn: string } | null;
  session: {
    id: string;
    titlePl: string;
    titleEn: string;
    startsAt: string | null;
    endsAt: string | null;
    status: string;
  } | null;
}

function parseCore(raw: unknown): CfpSubmissionCore {
  const row = bag(raw);
  return {
    id: str(row.id),
    eventId: str(row.event_id),
    status: asOneOf(CFP_SUBMISSION_STATUSES, row.status, "draft"),
    titlePl: str(row.title_pl),
    titleEn: str(row.title_en),
    abstractPl: str(row.abstract_pl),
    abstractEn: str(row.abstract_en),
    talkLanguage: asOneOf(CFP_TALK_LANGUAGES, row.talk_language, "pl"),
    formatKey: strOrNull(row.format_key),
    durationMin: numOrNull(row.duration_min),
    trackId: strOrNull(row.track_id),
    topics: strings(row.topics),
    answers: bag(row.answers),
    submittedAt: strOrNull(row.submitted_at),
  };
}

function parseScores(value: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, score] of Object.entries(bag(value))) {
    if (typeof score === "number") out[key] = score;
  }
  return out;
}

function parseCrm(value: unknown): CfpCrmLink | null {
  if (typeof value !== "object" || value === null) return null;
  const row = bag(value);
  return {
    syncStatus: asOneOf(["ok", "error", "skipped"] as const, row.sync_status, "skipped"),
    crmLeadId: strOrNull(row.crm_lead_id),
    lastError: strOrNull(row.last_error),
    syncedAt: strOrNull(row.synced_at),
  };
}

function parseSpeakers(value: unknown): CfpSpeakerEntry[] {
  return list(value).map((raw) => {
    const row = bag(raw);
    return {
      id: str(row.id),
      personId: strOrNull(row.person_id),
      isPrimary: bool(row.is_primary),
      role: asOneOf(CFP_SPEAKER_ROLES, row.role, "speaker"),
      firstName: str(row.first_name),
      lastName: str(row.last_name),
      email: strOrNull(row.email),
      jobTitle: strOrNull(row.job_title),
      companyText: strOrNull(row.company_text),
      crm: parseCrm(row.crm),
    };
  });
}

function parseRecommendation(value: unknown): CfpRecommendation | null {
  return typeof value === "string" && (CFP_RECOMMENDATIONS as readonly string[]).includes(value)
    ? (value as CfpRecommendation)
    : null;
}

export function parseCfpSubmissionDetail(value: Json | null): CfpSubmissionDetail {
  const root = bag(value);
  const sub = bag(root.submission);
  const event = bag(root.event);
  const person = bag(root.person);
  const settings = bag(root.settings);
  const track = typeof root.track === "object" && root.track !== null ? bag(root.track) : null;
  const session =
    typeof root.session === "object" && root.session !== null ? bag(root.session) : null;
  return {
    ...parseCore(sub),
    decisionNote: str(sub.decision_note),
    feedbackToSpeaker: str(sub.feedback_to_speaker),
    decidedAt: strOrNull(sub.decided_at),
    notifiedStatus: strOrNull(sub.notified_status),
    notifiedAt: strOrNull(sub.notified_at),
    notifyError: strOrNull(sub.notify_error),
    sessionId: strOrNull(sub.session_id),
    eventSlug: str(event.slug),
    eventTimezone: str(event.timezone),
    eventStartsAt: strOrNull(event.starts_at),
    eventEndsAt: strOrNull(event.ends_at),
    person: {
      id: str(person.id),
      email: strOrNull(person.email),
      phone: strOrNull(person.phone),
      consentMarketing:
        strOrNull(person.consent_marketing_at) !== null &&
        strOrNull(person.consent_withdrawn_at) === null,
    },
    speakers: parseSpeakers(root.speakers),
    fields: list(root.fields).map(parseCfpField),
    reviews: list(root.reviews).map((raw) => {
      const row = bag(raw);
      return {
        id: str(row.id),
        reviewerName: str(row.reviewer_name),
        scores: parseScores(row.scores),
        overall: numOrNull(row.overall),
        recommendation: parseRecommendation(row.recommendation),
        commentPrivate: str(row.comment_private),
        commentToSpeaker: str(row.comment_to_speaker),
        conflictOfInterest: bool(row.conflict_of_interest),
        updatedAt: strOrNull(row.updated_at),
      };
    }),
    summary: parseSummary(root.summary),
    scoreMax: num(settings.score_max, 5),
    reviewCriteria: parseCfpCriteria(settings.review_criteria),
    formats: parseCfpFormats(settings.formats),
    minReviews: num(settings.min_reviews, 2),
    track:
      track === null
        ? null
        : { id: str(track.id), namePl: str(track.name_pl), nameEn: str(track.name_en) },
    session:
      session === null
        ? null
        : {
            id: str(session.id),
            titlePl: str(session.title_pl),
            titleEn: str(session.title_en),
            startsAt: strOrNull(session.starts_at),
            endsAt: strOrNull(session.ends_at),
            status: str(session.status),
          },
  };
}

// ------------------------------------------------------ strona publiczna

export interface CfpPublic {
  eventId: string;
  eventSlug: string;
  timezone: string;
  phase: CfpPhase;
  isOpen: boolean;
  opensAt: string | null;
  closesAt: string | null;
  introPl: string;
  introEn: string;
  guidelinesPl: string;
  guidelinesEn: string;
  formats: CfpFormat[];
  tracks: CfpTrackOption[];
  fields: CfpFieldDef[];
  allowCoSpeakers: boolean;
  maxPerSubmitter: number;
}

/** `null` = nie ma takiego (opublikowanego) wydarzenia w tym najemcy. */
export function parseCfpPublic(value: Json | null): CfpPublic | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const row = bag(value);
  return {
    eventId: str(row.event_id),
    eventSlug: str(row.event_slug),
    timezone: str(row.timezone),
    phase: asOneOf(CFP_PHASES, row.phase, "none"),
    isOpen: bool(row.is_open),
    opensAt: strOrNull(row.opens_at),
    closesAt: strOrNull(row.closes_at),
    introPl: str(row.intro_pl),
    introEn: str(row.intro_en),
    guidelinesPl: str(row.guidelines_pl),
    guidelinesEn: str(row.guidelines_en),
    formats: parseCfpFormats(row.formats),
    tracks: parseTracks(row.tracks),
    fields: list(row.fields).map(parseCfpField),
    allowCoSpeakers: row.allow_co_speakers !== false,
    maxPerSubmitter: num(row.max_per_submitter, 3),
  };
}

// ------------------------------------------------------ moje zgłoszenia

export interface CfpMySpeaker {
  isPrimary: boolean;
  role: CfpSpeakerRole;
  firstName: string;
  lastName: string;
  email: string | null;
  jobTitle: string | null;
  companyText: string | null;
}

export interface CfpMySubmission extends CfpSubmissionCore {
  withdrawnAt: string | null;
  confirmedAt: string | null;
  declinedAt: string | null;
  updatedAt: string | null;
  sessionId: string | null;
  feedbackToSpeaker: string;
  speakers: CfpMySpeaker[];
  reviewsCount: number;
  overallAvg: number | null;
}

export interface CfpMyPerson {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  jobTitle: string | null;
  companyText: string | null;
  consentMarketing: boolean;
}

export interface CfpMySubmissions {
  eventId: string;
  eventSlug: string;
  timezone: string;
  maxPerSubmitter: number;
  scoreMax: number;
  person: CfpMyPerson | null;
  items: CfpMySubmission[];
}

export function parseMyCfpSubmissions(value: Json | null): CfpMySubmissions | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const row = bag(value);
  const person = typeof row.person === "object" && row.person !== null ? bag(row.person) : null;
  return {
    eventId: str(row.event_id),
    eventSlug: str(row.event_slug),
    timezone: str(row.timezone),
    maxPerSubmitter: num(row.max_per_submitter, 3),
    scoreMax: num(row.score_max, 5),
    person:
      person === null
        ? null
        : {
            id: str(person.id),
            firstName: str(person.first_name),
            lastName: str(person.last_name),
            email: strOrNull(person.email),
            jobTitle: strOrNull(person.job_title),
            companyText: strOrNull(person.company_text),
            consentMarketing: bool(person.consent_marketing),
          },
    items: list(row.items).map((raw) => {
      const item = bag(raw);
      const summary = bag(item.review_summary);
      return {
        ...parseCore(item),
        withdrawnAt: strOrNull(item.withdrawn_at),
        confirmedAt: strOrNull(item.confirmed_at),
        declinedAt: strOrNull(item.declined_at),
        updatedAt: strOrNull(item.updated_at),
        sessionId: strOrNull(item.session_id),
        feedbackToSpeaker: str(item.feedback_to_speaker),
        speakers: list(item.speakers).map((rawSpeaker) => {
          const speaker = bag(rawSpeaker);
          return {
            isPrimary: bool(speaker.is_primary),
            role: asOneOf(CFP_SPEAKER_ROLES, speaker.role, "speaker"),
            firstName: str(speaker.first_name),
            lastName: str(speaker.last_name),
            email: strOrNull(speaker.email),
            jobTitle: strOrNull(speaker.job_title),
            companyText: strOrNull(speaker.company_text),
          };
        }),
        reviewsCount: num(summary.reviews_count),
        overallAvg: numOrNull(summary.overall_avg),
      };
    }),
  };
}

// ------------------------------------------------------ panel prelegenta

export interface SpeakerPanelSession {
  sessionId: string;
  titlePl: string;
  titleEn: string;
  startsAt: string | null;
  endsAt: string | null;
  status: string;
  role: CfpSpeakerRole;
  roomName: string | null;
  trackNamePl: string | null;
  trackNameEn: string | null;
}

export interface SpeakerPanelMaterial {
  id: string;
  kind: SpeakerMaterialKind;
  titlePl: string;
  titleEn: string;
  url: string;
  visibility: SpeakerMaterialVisibility;
  isPublished: boolean;
  submissionId: string | null;
  sessionId: string | null;
}

export interface SpeakerPanelProfile {
  speakerProfileId: string;
  headlinePl: string;
  headlineEn: string;
  bioPl: string;
  bioEn: string;
  topicsPl: string[];
  topicsEn: string[];
  languages: string[];
  cardPhotoUrl: string;
}

export interface SpeakerPanel {
  eventId: string;
  eventSlug: string;
  timezone: string;
  isReviewer: boolean;
  submissionsCount: number;
  hasPerson: boolean;
  profile: SpeakerPanelProfile | null;
  sessions: SpeakerPanelSession[];
  materials: SpeakerPanelMaterial[];
}

export function parseSpeakerPanel(value: Json | null): SpeakerPanel | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const row = bag(value);
  const profile = typeof row.profile === "object" && row.profile !== null ? bag(row.profile) : null;
  return {
    eventId: str(row.event_id),
    eventSlug: str(row.event_slug),
    timezone: str(row.timezone),
    isReviewer: bool(row.is_reviewer),
    submissionsCount: num(row.submissions_count),
    hasPerson: typeof row.person === "object" && row.person !== null,
    profile:
      profile === null
        ? null
        : {
            speakerProfileId: str(profile.speaker_profile_id),
            headlinePl: str(profile.headline_pl),
            headlineEn: str(profile.headline_en),
            bioPl: str(profile.bio_pl),
            bioEn: str(profile.bio_en),
            topicsPl: strings(profile.topics_pl),
            topicsEn: strings(profile.topics_en),
            languages: strings(profile.languages),
            cardPhotoUrl: str(profile.card_photo_url),
          },
    sessions: list(row.sessions).map((raw) => {
      const session = bag(raw);
      return {
        sessionId: str(session.session_id),
        titlePl: str(session.title_pl),
        titleEn: str(session.title_en),
        startsAt: strOrNull(session.starts_at),
        endsAt: strOrNull(session.ends_at),
        status: str(session.status),
        role: asOneOf(CFP_SPEAKER_ROLES, session.role, "speaker"),
        roomName: strOrNull(session.room_name),
        trackNamePl: strOrNull(session.track_name_pl),
        trackNameEn: strOrNull(session.track_name_en),
      };
    }),
    materials: list(row.materials).map((raw) => {
      const material = bag(raw);
      return {
        id: str(material.id),
        kind: asOneOf(SPEAKER_MATERIAL_KINDS, material.kind, "link"),
        titlePl: str(material.title_pl),
        titleEn: str(material.title_en),
        url: str(material.url),
        visibility: asOneOf(SPEAKER_MATERIAL_VISIBILITIES, material.visibility, "organizers"),
        isPublished: bool(material.is_published),
        submissionId: strOrNull(material.submission_id),
        sessionId: strOrNull(material.session_id),
      };
    }),
  };
}

// ------------------------------------------------------ panel recenzenta

export interface CfpReviewerSpeaker {
  firstName: string;
  lastName: string;
  role: CfpSpeakerRole;
  jobTitle: string | null;
  companyText: string | null;
}

function parseReviewerSpeakers(value: unknown): CfpReviewerSpeaker[] | null {
  if (!Array.isArray(value)) return null;
  return value.map((raw) => {
    const row = bag(raw);
    return {
      firstName: str(row.first_name),
      lastName: str(row.last_name),
      role: asOneOf(CFP_SPEAKER_ROLES, row.role, "speaker"),
      jobTitle: strOrNull(row.job_title),
      companyText: strOrNull(row.company_text),
    };
  });
}

export interface CfpMyReviewBrief {
  overall: number | null;
  recommendation: CfpRecommendation | null;
  conflictOfInterest: boolean;
}

export interface CfpQueueItem {
  id: string;
  status: CfpSubmissionStatus;
  titlePl: string;
  titleEn: string;
  talkLanguage: CfpTalkLanguage;
  formatKey: string | null;
  trackNamePl: string | null;
  trackNameEn: string | null;
  submittedAt: string | null;
  /** `null` = ocena w ciemno (tożsamość ukryta przez bazę). */
  speakers: CfpReviewerSpeaker[] | null;
  myReview: CfpMyReviewBrief | null;
}

export interface CfpReviewQueue {
  eventId: string;
  eventSlug: string;
  timezone: string;
  identityVisible: boolean;
  scoreMax: number;
  reviewCriteria: CfpCriterion[];
  items: CfpQueueItem[];
}

function parseMyReviewBrief(value: unknown): CfpMyReviewBrief | null {
  if (typeof value !== "object" || value === null) return null;
  const row = bag(value);
  return {
    overall: numOrNull(row.overall),
    recommendation: parseRecommendation(row.recommendation),
    conflictOfInterest: bool(row.conflict_of_interest),
  };
}

export function parseCfpReviewQueue(value: Json | null): CfpReviewQueue | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const row = bag(value);
  return {
    eventId: str(row.event_id),
    eventSlug: str(row.event_slug),
    timezone: str(row.timezone),
    identityVisible: bool(row.identity_visible),
    scoreMax: num(row.score_max, 5),
    reviewCriteria: parseCfpCriteria(row.review_criteria),
    items: list(row.items).map((raw) => {
      const item = bag(raw);
      return {
        id: str(item.id),
        status: asOneOf(CFP_SUBMISSION_STATUSES, item.status, "submitted"),
        titlePl: str(item.title_pl),
        titleEn: str(item.title_en),
        talkLanguage: asOneOf(CFP_TALK_LANGUAGES, item.talk_language, "pl"),
        formatKey: strOrNull(item.format_key),
        trackNamePl: strOrNull(item.track_name_pl),
        trackNameEn: strOrNull(item.track_name_en),
        submittedAt: strOrNull(item.submitted_at),
        speakers: parseReviewerSpeakers(item.speakers),
        myReview: parseMyReviewBrief(item.my_review),
      };
    }),
  };
}

export interface CfpMyReview {
  scores: Record<string, number>;
  overall: number | null;
  recommendation: CfpRecommendation | null;
  commentPrivate: string;
  commentToSpeaker: string;
  conflictOfInterest: boolean;
}

export interface CfpReviewDetail {
  submission: CfpSubmissionCore;
  identityVisible: boolean;
  speakers: CfpReviewerSpeaker[] | null;
  fields: CfpFieldDef[];
  formats: CfpFormat[];
  track: { namePl: string; nameEn: string } | null;
  scoreMax: number;
  reviewCriteria: CfpCriterion[];
  review: CfpMyReview | null;
}

export function parseCfpReviewDetail(value: Json | null): CfpReviewDetail {
  const row = bag(value);
  const track = typeof row.track === "object" && row.track !== null ? bag(row.track) : null;
  const review = typeof row.review === "object" && row.review !== null ? bag(row.review) : null;
  return {
    submission: parseCore(row.submission),
    identityVisible: bool(row.identity_visible),
    speakers: parseReviewerSpeakers(row.speakers),
    fields: list(row.fields).map(parseCfpField),
    formats: parseCfpFormats(row.formats),
    track: track === null ? null : { namePl: str(track.name_pl), nameEn: str(track.name_en) },
    scoreMax: num(row.score_max, 5),
    reviewCriteria: parseCfpCriteria(row.review_criteria),
    review:
      review === null
        ? null
        : {
            scores: parseScores(review.scores),
            overall: numOrNull(review.overall),
            recommendation: parseRecommendation(review.recommendation),
            commentPrivate: str(review.comment_private),
            commentToSpeaker: str(review.comment_to_speaker),
            conflictOfInterest: bool(review.conflict_of_interest),
          },
  };
}

// ------------------------------------------------------ drobne wyniki zapisów

export interface CfpWriteResult {
  id: string;
  status: CfpSubmissionStatus | "deleted";
}

export function parseCfpWriteResult(value: Json | null): CfpWriteResult {
  const row = bag(value);
  return {
    id: str(row.id),
    status: row.status === "deleted" ? "deleted" : asOneOf(CFP_SUBMISSION_STATUSES, row.status, "draft"),
  };
}

export interface CfpAcceptResult {
  id: string;
  sessionId: string | null;
  speakerProfileId: string | null;
  speakersEnrolled: number;
  registrationsCreated: number;
}

export function parseCfpAcceptResult(value: Json | null): CfpAcceptResult {
  const row = bag(value);
  return {
    id: str(row.id),
    sessionId: strOrNull(row.session_id),
    speakerProfileId: strOrNull(row.speaker_profile_id),
    speakersEnrolled: num(row.speakers_enrolled),
    registrationsCreated: num(row.registrations_created),
  };
}
