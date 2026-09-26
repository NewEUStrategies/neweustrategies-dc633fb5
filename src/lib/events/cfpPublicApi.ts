// Dostęp strony publicznej, prelegenta i recenzenta do NABORU PRELEGENTÓW.
//
// TRZY PŁASZCZYZNY, JEDEN KLIENT. Strona naboru (`event_cfp_public`) jest
// anonimowa; zgłoszenia, panel prelegenta i kolejka recenzenta idą z tokenem
// zalogowanego. Najemcę ustala baza z nagłówka hosta (`public_tenant_id()`),
// tożsamość - z `auth.uid()`. Żaden identyfikator osoby nie wychodzi z klienta.
//
// TEN MODUŁ JEDZIE W CHUNKU PUBLICZNYM - nie importuje niczego z panelu.
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type { CfpRecommendation, CfpSpeakerRole, CfpTalkLanguage } from "@/lib/events/cfpEnums";
import type { SpeakerMaterialKind, SpeakerMaterialVisibility } from "@/lib/events/cfpEnums";
import {
  parseCfpPublic,
  parseCfpReviewDetail,
  parseCfpReviewQueue,
  parseCfpWriteResult,
  parseMyCfpSubmissions,
  parseSpeakerPanel,
  type CfpMySubmissions,
  type CfpPublic,
  type CfpReviewDetail,
  type CfpReviewQueue,
  type CfpWriteResult,
  type SpeakerPanel,
} from "@/lib/events/cfpSurface";

function fail(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

function payload(input: Record<string, Json | undefined>): Json {
  const out: Record<string, Json> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/* ------------------------------------------------------- strona naboru --- */

export async function fetchCfpPublic(slug: string): Promise<CfpPublic | null> {
  const { data, error } = await supabase.rpc("event_cfp_public", { p_slug: slug });
  fail(error);
  return parseCfpPublic(data);
}

/* ------------------------------------------------------------ zgłoszenie --- */

export interface CfpSubmissionSaveInput {
  /** Brak = nowy szkic na wydarzeniu `slug`. */
  id?: string;
  slug?: string;
  speaker?: {
    first_name: string;
    last_name: string;
    job_title: string;
    company_text: string;
    consent_marketing: boolean;
  };
  titlePl?: string;
  titleEn?: string;
  abstractPl?: string;
  abstractEn?: string;
  talkLanguage?: CfpTalkLanguage;
  notifyLang?: "pl" | "en";
  formatKey?: string | null;
  trackId?: string | null;
  topics?: string[];
  answers?: Record<string, Json>;
  role?: CfpSpeakerRole;
  coSpeakers?: Array<{
    first_name: string;
    last_name: string;
    email: string | null;
    job_title: string;
    company_text: string;
    role: CfpSpeakerRole;
  }>;
}

export async function saveCfpSubmission(input: CfpSubmissionSaveInput): Promise<CfpWriteResult> {
  const { data, error } = await supabase.rpc("event_cfp_submission_save", {
    p_payload: payload({
      id: input.id,
      slug: input.slug,
      speaker: input.speaker,
      title_pl: input.titlePl,
      title_en: input.titleEn,
      abstract_pl: input.abstractPl,
      abstract_en: input.abstractEn,
      talk_language: input.talkLanguage,
      notify_lang: input.notifyLang,
      format_key: input.formatKey,
      track_id: input.trackId,
      topics: input.topics,
      answers: input.answers,
      role: input.role,
      co_speakers: input.coSpeakers,
    }),
  });
  fail(error);
  return parseCfpWriteResult(data);
}

export async function submitCfpSubmission(id: string): Promise<CfpWriteResult> {
  const { data, error } = await supabase.rpc("event_cfp_submission_submit", {
    p_payload: { id },
  });
  fail(error);
  return parseCfpWriteResult(data);
}

export async function withdrawCfpSubmission(id: string): Promise<CfpWriteResult> {
  const { data, error } = await supabase.rpc("event_cfp_submission_withdraw", {
    p_payload: { id },
  });
  fail(error);
  return parseCfpWriteResult(data);
}

export async function respondCfpSubmission(id: string, confirm: boolean): Promise<CfpWriteResult> {
  const { data, error } = await supabase.rpc("event_cfp_submission_respond", {
    p_payload: { id, confirm },
  });
  fail(error);
  return parseCfpWriteResult(data);
}

export async function fetchMyCfpSubmissions(slug: string): Promise<CfpMySubmissions | null> {
  const { data, error } = await supabase.rpc("event_my_cfp_submissions", { p_slug: slug });
  fail(error);
  return parseMyCfpSubmissions(data);
}

/* ------------------------------------------------------ panel prelegenta --- */

export async function fetchSpeakerPanel(slug: string): Promise<SpeakerPanel | null> {
  const { data, error } = await supabase.rpc("event_my_speaker_panel", { p_slug: slug });
  fail(error);
  return parseSpeakerPanel(data);
}

export interface SpeakerProfileInput {
  slug: string;
  headlinePl: string;
  headlineEn: string;
  bioPl: string;
  bioEn: string;
  topicsPl: string[];
  topicsEn: string[];
  languages: string[];
  cardPhotoUrl: string;
}

export async function saveSpeakerProfile(input: SpeakerProfileInput): Promise<void> {
  const { error } = await supabase.rpc("event_my_speaker_profile_set", {
    p_payload: {
      slug: input.slug,
      headline_pl: input.headlinePl,
      headline_en: input.headlineEn,
      bio_pl: input.bioPl,
      bio_en: input.bioEn,
      topics_pl: input.topicsPl,
      topics_en: input.topicsEn,
      languages: input.languages,
      card_photo_url: input.cardPhotoUrl,
    },
  });
  fail(error);
}

export interface SpeakerMaterialInput {
  id?: string;
  slug: string;
  kind: SpeakerMaterialKind;
  titlePl: string;
  titleEn: string;
  url: string;
  visibility: SpeakerMaterialVisibility;
  /** Pominięte = bez zmian (panel prelegenta nie przepina materiału do zgłoszenia). */
  submissionId?: string | null;
  sessionId: string | null;
}

export async function saveSpeakerMaterial(input: SpeakerMaterialInput): Promise<string> {
  const { data, error } = await supabase.rpc("event_my_speaker_material_upsert", {
    p_payload: payload({
      id: input.id,
      slug: input.slug,
      kind: input.kind,
      title_pl: input.titlePl,
      title_en: input.titleEn,
      url: input.url,
      visibility: input.visibility,
      submission_id: input.submissionId,
      session_id: input.sessionId,
    }),
  });
  fail(error);
  return String(data);
}

export async function deleteSpeakerMaterial(materialId: string): Promise<void> {
  const { error } = await supabase.rpc("event_my_speaker_material_delete", {
    p_material_id: materialId,
  });
  fail(error);
}

/* ------------------------------------------------------ panel recenzenta --- */

export async function fetchCfpReviewQueue(slug: string): Promise<CfpReviewQueue | null> {
  const { data, error } = await supabase.rpc("event_cfp_review_queue", { p_slug: slug });
  fail(error);
  return parseCfpReviewQueue(data);
}

export async function fetchCfpReview(submissionId: string): Promise<CfpReviewDetail> {
  const { data, error } = await supabase.rpc("event_cfp_review_get", {
    p_submission_id: submissionId,
  });
  fail(error);
  return parseCfpReviewDetail(data);
}

export interface CfpReviewInput {
  submissionId: string;
  scores: Record<string, number>;
  overall: number | null;
  recommendation: CfpRecommendation | null;
  commentPrivate: string;
  commentToSpeaker: string;
  conflictOfInterest: boolean;
}

export async function saveCfpReview(input: CfpReviewInput): Promise<void> {
  const { error } = await supabase.rpc("event_cfp_review_save", {
    p_payload: {
      submission_id: input.submissionId,
      scores: input.scores,
      overall: input.overall,
      recommendation: input.recommendation,
      comment_private: input.commentPrivate,
      comment_to_speaker: input.commentToSpeaker,
      conflict_of_interest: input.conflictOfInterest,
    },
  });
  fail(error);
}
