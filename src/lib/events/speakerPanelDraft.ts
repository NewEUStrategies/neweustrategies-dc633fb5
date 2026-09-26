// Szkice PANELU PRELEGENTA: profil sceniczny (nakładka) i materiał.
//
// TEMATY I JĘZYKI SĄ POLEM TEKSTOWYM PO PRZECINKACH - tak jak w formularzu
// zgłoszenia. Lista chipów byłaby ładniejsza, ale dwa różne edytory tego samego
// pojęcia w jednej ścieżce użytkownika to dwie różne pomyłki do nauczenia się.
//
// REGUŁY LUSTRZANE DO `event_my_speaker_profile_set` i
// `event_my_speaker_material_upsert` (`invalid_profile`, `invalid_url`, ...).
import type { SpeakerMaterialKind, SpeakerMaterialVisibility } from "@/lib/events/cfpEnums";
import type { SpeakerMaterialInput, SpeakerProfileInput } from "@/lib/events/cfpPublicApi";
import type { SpeakerPanelMaterial, SpeakerPanelProfile } from "@/lib/events/cfpSurface";
import { parseTopics } from "@/lib/events/cfpSubmissionDraft";

const HTTPS_PATTERN = /^https:\/\/\S{3,}$/i;

export interface SpeakerProfileDraft {
  headlinePl: string;
  headlineEn: string;
  bioPl: string;
  bioEn: string;
  topicsPl: string;
  topicsEn: string;
  languages: string;
  cardPhotoUrl: string;
}

export function speakerProfileDraftFrom(profile: SpeakerPanelProfile): SpeakerProfileDraft {
  return {
    headlinePl: profile.headlinePl,
    headlineEn: profile.headlineEn,
    bioPl: profile.bioPl,
    bioEn: profile.bioEn,
    topicsPl: profile.topicsPl.join(", "),
    topicsEn: profile.topicsEn.join(", "),
    languages: profile.languages.join(", "),
    cardPhotoUrl: profile.cardPhotoUrl,
  };
}

export function speakerProfileIssue(draft: SpeakerProfileDraft): string | null {
  if (draft.headlinePl.length > 200 || draft.headlineEn.length > 200) {
    return "eventCfp.speaker.profile.validation.headline";
  }
  if (draft.bioPl.length > 4000 || draft.bioEn.length > 4000) {
    return "eventCfp.speaker.profile.validation.bio";
  }
  const photo = draft.cardPhotoUrl.trim();
  if (photo !== "" && (!HTTPS_PATTERN.test(photo) || photo.length > 2048)) {
    return "eventCfp.speaker.profile.validation.photo";
  }
  const topics = [...parseTopics(draft.topicsPl), ...parseTopics(draft.topicsEn)];
  if (
    parseTopics(draft.topicsPl).length > 12 ||
    parseTopics(draft.topicsEn).length > 12 ||
    topics.some((topic) => topic.length > 60)
  ) {
    return "eventCfp.speaker.profile.validation.topics";
  }
  const languages = parseTopics(draft.languages.toLowerCase());
  if (languages.length > 10 || languages.some((code) => !/^[a-z]{2}$/.test(code))) {
    return "eventCfp.speaker.profile.validation.languages";
  }
  return null;
}

export function speakerProfilePayload(slug: string, draft: SpeakerProfileDraft): SpeakerProfileInput {
  return {
    slug,
    headlinePl: draft.headlinePl.trim(),
    headlineEn: draft.headlineEn.trim(),
    bioPl: draft.bioPl.trim(),
    bioEn: draft.bioEn.trim(),
    topicsPl: parseTopics(draft.topicsPl),
    topicsEn: parseTopics(draft.topicsEn),
    languages: parseTopics(draft.languages.toLowerCase()),
    cardPhotoUrl: draft.cardPhotoUrl.trim(),
  };
}

export interface SpeakerMaterialDraft {
  id: string | null;
  kind: SpeakerMaterialKind;
  titlePl: string;
  titleEn: string;
  url: string;
  visibility: SpeakerMaterialVisibility;
  sessionId: string;
}

export function emptySpeakerMaterialDraft(): SpeakerMaterialDraft {
  return {
    id: null,
    kind: "slides",
    titlePl: "",
    titleEn: "",
    url: "",
    visibility: "organizers",
    sessionId: "",
  };
}

export function speakerMaterialDraftFrom(material: SpeakerPanelMaterial): SpeakerMaterialDraft {
  return {
    id: material.id,
    kind: material.kind,
    titlePl: material.titlePl,
    titleEn: material.titleEn,
    url: material.url,
    visibility: material.visibility,
    sessionId: material.sessionId ?? "",
  };
}

export function speakerMaterialIssue(draft: SpeakerMaterialDraft): string | null {
  const pl = draft.titlePl.trim();
  const en = draft.titleEn.trim();
  if ((pl === "" && en === "") || pl.length > 200 || en.length > 200) {
    return "eventCfp.speaker.materials.validation.title";
  }
  const url = draft.url.trim();
  if (!HTTPS_PATTERN.test(url) || url.length > 2008) {
    return "eventCfp.speaker.materials.validation.url";
  }
  return null;
}

export function speakerMaterialPayload(slug: string, draft: SpeakerMaterialDraft): SpeakerMaterialInput {
  return {
    id: draft.id ?? undefined,
    slug,
    kind: draft.kind,
    titlePl: draft.titlePl.trim(),
    titleEn: draft.titleEn.trim(),
    url: draft.url.trim(),
    visibility: draft.visibility,
    sessionId: draft.sessionId === "" ? null : draft.sessionId,
  };
}
