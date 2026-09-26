// Dostęp panelu organizatora do NABORU PRELEGENTÓW: ustawienia, pytania
// formularza, zgłoszenia (lista, szczegół, decyzja, przyjęcie), recenzenci,
// materiały prelegentów i ponowienie synchronizacji z CRM.
//
// AUTORYZACJA MIESZKA W BAZIE. Każda funkcja `admin_event_cfp_*` zaczyna się od
// `assert_event_admin_tenant()` (admin albo super_admin, nigdy redaktor) i
// bierze najemcę z profilu wołającego - ten moduł jest tylko transportem.
//
// TYPY WIERSZY Z WYGENEROWANYCH `Database`, odpowiedzi `jsonb` przez parsery
// z `cfpSurface.ts` - rzutowanie zamieniłoby zmianę klucza w SQL-u na cichy
// pusty ekran.
//
// KLUCZ POMINIĘTY (`undefined`) NIE WCHODZI DO PAYLOADU. SQL czyta
// `p_payload ? 'klucz'`, więc brak klucza znaczy „zostaw", a jawny `null`
// znaczy „wyczyść" (np. grupa prelegentów).
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";
import type {
  CfpDecisionStatus,
  CfpFieldType,
  CfpSessionFormat,
  CfpStatus,
  CfpSubmissionStatus,
} from "@/lib/events/cfpEnums";
import {
  parseCfpAcceptResult,
  parseCfpCounts,
  parseCfpSettings,
  parseCfpSubmissionDetail,
  type CfpAcceptResult,
  type CfpCounts,
  type CfpSettings,
  type CfpSubmissionDetail,
} from "@/lib/events/cfpSurface";

type Fns = Database["public"]["Functions"];

export type CfpFieldRow = Fns["admin_event_cfp_fields_list"]["Returns"][number];
export type CfpSubmissionRow = Fns["admin_event_cfp_submissions_list"]["Returns"][number];
export type CfpReviewerRow = Fns["admin_event_cfp_reviewers_list"]["Returns"][number];
export type CfpMaterialRow = Fns["admin_event_cfp_materials_list"]["Returns"][number];

/** Payload RPC: klucze `undefined` odpadają, jawne `null` zostaje. */
export function cfpPayload(input: Record<string, Json | undefined>): Json {
  const out: Record<string, Json> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function fail(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

/* ------------------------------------------------------------- ustawienia --- */

export async function fetchCfpSettings(eventId: string): Promise<CfpSettings> {
  const { data, error } = await supabase.rpc("admin_event_cfp_settings_get", {
    p_event_id: eventId,
  });
  fail(error);
  return parseCfpSettings(data);
}

export interface CfpSettingsInput {
  eventId: string;
  status?: CfpStatus;
  opensAt?: string | null;
  closesAt?: string | null;
  introPl?: string;
  introEn?: string;
  guidelinesPl?: string;
  guidelinesEn?: string;
  formats?: Array<{ key: string; label_pl: string; label_en: string; duration_min: number }>;
  trackIds?: string[];
  maxPerSubmitter?: number;
  allowCoSpeakers?: boolean;
  reviewBlind?: boolean;
  scoreMax?: number;
  reviewCriteria?: Array<{ key: string; label_pl: string; label_en: string; weight: number }>;
  minReviews?: number;
  speakerGroupId?: string | null;
  speakerTicketTypeId?: string | null;
}

export async function saveCfpSettings(input: CfpSettingsInput): Promise<CfpSettings> {
  const { data, error } = await supabase.rpc("admin_event_cfp_settings_save", {
    p_payload: cfpPayload({
      event_id: input.eventId,
      status: input.status,
      opens_at: input.opensAt,
      closes_at: input.closesAt,
      intro_pl: input.introPl,
      intro_en: input.introEn,
      guidelines_pl: input.guidelinesPl,
      guidelines_en: input.guidelinesEn,
      formats: input.formats,
      track_ids: input.trackIds,
      max_per_submitter: input.maxPerSubmitter,
      allow_co_speakers: input.allowCoSpeakers,
      review_blind: input.reviewBlind,
      score_max: input.scoreMax,
      review_criteria: input.reviewCriteria,
      min_reviews: input.minReviews,
      speaker_group_id: input.speakerGroupId,
      speaker_ticket_type_id: input.speakerTicketTypeId,
    }),
  });
  fail(error);
  return parseCfpSettings(data);
}

/* ---------------------------------------------------------------- pytania --- */

export async function fetchCfpFields(eventId: string): Promise<CfpFieldRow[]> {
  const { data, error } = await supabase.rpc("admin_event_cfp_fields_list", {
    p_event_id: eventId,
  });
  fail(error);
  return data ?? [];
}

export interface CfpFieldInput {
  id?: string;
  eventId?: string;
  key?: string;
  fieldType: CfpFieldType;
  labelPl: string;
  labelEn: string;
  helpPl: string;
  helpEn: string;
  isRequired: boolean;
  isActive: boolean;
  options: Array<{ value: string; label_pl: string; label_en: string }>;
}

export async function saveCfpField(input: CfpFieldInput): Promise<string> {
  const { data, error } = await supabase.rpc("admin_event_cfp_field_upsert", {
    p_payload: cfpPayload({
      id: input.id,
      event_id: input.eventId,
      key: input.key,
      field_type: input.fieldType,
      label_pl: input.labelPl,
      label_en: input.labelEn,
      help_pl: input.helpPl,
      help_en: input.helpEn,
      is_required: input.isRequired,
      is_active: input.isActive,
      options: input.options,
    }),
  });
  fail(error);
  return String(data);
}

export async function deleteCfpField(fieldId: string): Promise<void> {
  const { error } = await supabase.rpc("admin_event_cfp_field_delete", { p_field_id: fieldId });
  fail(error);
}

export async function reorderCfpFields(eventId: string, ids: string[]): Promise<void> {
  const { error } = await supabase.rpc("admin_event_cfp_fields_reorder", {
    p_payload: { event_id: eventId, ids },
  });
  fail(error);
}

/* ------------------------------------------------------------ zgłoszenia --- */

export type CfpSubmissionSort = "recent" | "score" | "title";

export interface CfpSubmissionsQuery {
  eventId: string;
  /** `all` nie jest wartością w bazie, tylko brakiem filtra. */
  status: Exclude<CfpSubmissionStatus, "draft"> | "all";
  trackId: string | "all";
  q: string;
  sort: CfpSubmissionSort;
  page: number;
  pageSize: number;
}

export interface CfpSubmissionsPage {
  rows: CfpSubmissionRow[];
  total: number;
}

export async function fetchCfpSubmissions(query: CfpSubmissionsQuery): Promise<CfpSubmissionsPage> {
  const q = query.q.trim();
  const { data, error } = await supabase.rpc("admin_event_cfp_submissions_list", {
    p_payload: cfpPayload({
      event_id: query.eventId,
      status: query.status === "all" ? undefined : query.status,
      track_id: query.trackId === "all" ? undefined : query.trackId,
      q: q === "" ? undefined : q,
      sort: query.sort,
      limit: query.pageSize,
      offset: query.page * query.pageSize,
    }),
  });
  fail(error);
  const rows = data ?? [];
  return { rows, total: rows[0]?.total_count ?? 0 };
}

export async function fetchCfpCounts(eventId: string): Promise<CfpCounts> {
  const { data, error } = await supabase.rpc("admin_event_cfp_submissions_counts", {
    p_event_id: eventId,
  });
  fail(error);
  return parseCfpCounts(data);
}

export async function fetchCfpSubmissionDetail(submissionId: string): Promise<CfpSubmissionDetail> {
  const { data, error } = await supabase.rpc("admin_event_cfp_submission_detail", {
    p_submission_id: submissionId,
  });
  fail(error);
  return parseCfpSubmissionDetail(data);
}

export interface CfpDecisionInput {
  id: string;
  status: CfpDecisionStatus;
  decisionNote?: string;
  feedbackToSpeaker?: string;
}

export async function decideCfpSubmission(input: CfpDecisionInput): Promise<void> {
  const { error } = await supabase.rpc("admin_event_cfp_submission_decide", {
    p_payload: cfpPayload({
      id: input.id,
      status: input.status,
      decision_note: input.decisionNote,
      feedback_to_speaker: input.feedbackToSpeaker,
    }),
  });
  fail(error);
}

export interface CfpAcceptInput {
  id: string;
  decisionNote?: string;
  feedbackToSpeaker?: string;
  register: boolean;
  schedule: {
    startsAt: string;
    endsAt: string;
    roomId: string | null;
    trackId: string | null;
    format: CfpSessionFormat;
  } | null;
}

export async function acceptCfpSubmission(input: CfpAcceptInput): Promise<CfpAcceptResult> {
  const { data, error } = await supabase.rpc("admin_event_cfp_submission_accept", {
    p_payload: cfpPayload({
      id: input.id,
      decision_note: input.decisionNote,
      feedback_to_speaker: input.feedbackToSpeaker,
      register: input.register,
      schedule:
        input.schedule === null
          ? undefined
          : {
              starts_at: input.schedule.startsAt,
              ends_at: input.schedule.endsAt,
              room_id: input.schedule.roomId,
              track_id: input.schedule.trackId,
              format: input.schedule.format,
            },
    }),
  });
  fail(error);
  return parseCfpAcceptResult(data);
}

/** Ponowienie synchronizacji osoby z CRM (most z 20260926090000). */
export async function retryCfpPersonCrm(personId: string): Promise<void> {
  const { error } = await supabase.rpc("admin_event_person_crm_retry", { p_person_id: personId });
  fail(error);
}

/* ------------------------------------------------------------ recenzenci --- */

export async function fetchCfpReviewers(eventId: string): Promise<CfpReviewerRow[]> {
  const { data, error } = await supabase.rpc("admin_event_cfp_reviewers_list", {
    p_event_id: eventId,
  });
  fail(error);
  return data ?? [];
}

export interface CfpReviewerInput {
  eventId: string;
  userId: string;
  trackIds?: string[];
  canSeeIdentity?: boolean;
  isActive?: boolean;
}

export async function setCfpReviewer(input: CfpReviewerInput): Promise<string> {
  const { data, error } = await supabase.rpc("admin_event_cfp_reviewer_set", {
    p_payload: cfpPayload({
      event_id: input.eventId,
      user_id: input.userId,
      track_ids: input.trackIds,
      can_see_identity: input.canSeeIdentity,
      is_active: input.isActive,
    }),
  });
  fail(error);
  return String(data);
}

/** `deleted` = recenzent bez ocen zniknął; `deactivated` = miał oceny, więc je zachowano. */
export async function removeCfpReviewer(reviewerId: string): Promise<"deleted" | "deactivated"> {
  const { data, error } = await supabase.rpc("admin_event_cfp_reviewer_remove", {
    p_reviewer_id: reviewerId,
  });
  fail(error);
  return data === "deleted" ? "deleted" : "deactivated";
}

/* ------------------------------------------------------------- materiały --- */

export async function fetchCfpMaterials(eventId: string): Promise<CfpMaterialRow[]> {
  const { data, error } = await supabase.rpc("admin_event_cfp_materials_list", {
    p_event_id: eventId,
  });
  fail(error);
  return data ?? [];
}

export async function publishCfpMaterial(materialId: string, isPublished: boolean): Promise<void> {
  const { error } = await supabase.rpc("admin_event_cfp_material_publish", {
    p_payload: { id: materialId, is_published: isPublished },
  });
  fail(error);
}
