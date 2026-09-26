// Parsery odpowiedzi `jsonb` naboru prelegentów.
//
// Kontrakt, którego pilnujemy: (1) nazwy kluczy SQL -> pola klienta jeden do
// jednego, (2) brak albo śmieć w danych degraduje do stanu BEZPIECZNEGO (faza
// `none`, stan `draft`, pusta lista), nigdy do wyjątku przy renderze.
import { describe, expect, it } from "vitest";

import {
  parseCfpAcceptResult,
  parseCfpCounts,
  parseCfpCriteria,
  parseCfpField,
  parseCfpFormats,
  parseCfpOptions,
  parseCfpPublic,
  parseCfpReviewDetail,
  parseCfpReviewQueue,
  parseCfpSettings,
  parseCfpSubmissionDetail,
  parseCfpWriteResult,
  parseMyCfpSubmissions,
  parseRecommendations,
  parseSpeakerPanel,
} from "@/lib/events/cfpSurface";
import type { Json } from "@/integrations/supabase/types";

const FORMAT = { key: "talk", label_pl: "Wykład", label_en: "Talk", duration_min: 30 };
const CRITERION = { key: "rel", label_pl: "Trafność", label_en: "Relevance", weight: "2" };
const FIELD = {
  id: "f1",
  key: "exp",
  field_type: "select",
  label_pl: "Doświadczenie",
  label_en: "Experience",
  help_pl: "p",
  help_en: "e",
  is_required: true,
  is_active: false,
  options: [{ value: "a", label_pl: "A", label_en: "A-en" }],
};

describe("kształty wspólne", () => {
  it("formy, kryteria i opcje czytają klucze SQL, a śmieć daje wartości zerowe", () => {
    expect(parseCfpFormats([FORMAT, "x"])).toEqual([
      { key: "talk", labelPl: "Wykład", labelEn: "Talk", durationMin: 30 },
      { key: "", labelPl: "", labelEn: "", durationMin: 0 },
    ]);
    expect(parseCfpFormats(null)).toEqual([]);
    expect(parseCfpCriteria([CRITERION, { weight: "abc" }])).toEqual([
      { key: "rel", labelPl: "Trafność", labelEn: "Relevance", weight: 2 },
      { key: "", labelPl: "", labelEn: "", weight: 1 },
    ]);
    expect(parseCfpOptions([{ value: 1 }])).toEqual([{ value: "", labelPl: "", labelEn: "" }]);
  });

  it("pytanie: nieznany typ -> tekst, brak `is_active` -> aktywne", () => {
    expect(parseCfpField(FIELD)).toEqual({
      id: "f1",
      key: "exp",
      fieldType: "select",
      labelPl: "Doświadczenie",
      labelEn: "Experience",
      helpPl: "p",
      helpEn: "e",
      isRequired: true,
      isActive: false,
      options: [{ value: "a", labelPl: "A", labelEn: "A-en" }],
    });
    const bare = parseCfpField({ field_type: "rich" });
    expect(bare.fieldType).toBe("text");
    expect(bare.isActive).toBe(true);
    expect(bare.isRequired).toBe(false);
  });

  it("liczba z napisu, a napis nieliczbowy = brak liczby", () => {
    const parsed = parseCfpSubmissionDetail({ submission: { duration_min: "abc" }, summary: { overall_avg: "x" } });
    expect(parsed.durationMin).toBeNull();
    expect(parsed.summary.overallAvg).toBeNull();
  });

  it("rekomendacje: brak liczników = zera", () => {
    expect(parseRecommendations({ accept: 2, maybe: "1" })).toEqual({
      accept: 2,
      maybe: 1,
      reject: 0,
      abstain: 0,
    });
  });
});

describe("parseCfpSettings", () => {
  it("czyta ustawienia i opcje wyboru (ścieżki, sale, grupy, bilety)", () => {
    const settings = parseCfpSettings({
      event_id: "e1",
      event_slug: "kongres",
      event_status: "published",
      event_timezone: "Europe/Warsaw",
      exists: true,
      status: "open",
      phase: "open",
      is_open: true,
      opens_at: "2026-09-01T10:00:00+00:00",
      closes_at: "",
      intro_pl: "Wstęp",
      intro_en: "Intro",
      guidelines_pl: "Zasady",
      guidelines_en: "Rules",
      formats: [FORMAT],
      track_ids: ["t1", 2],
      max_per_submitter: 2,
      allow_co_speakers: false,
      review_blind: true,
      score_max: 10,
      review_criteria: [CRITERION],
      min_reviews: 0,
      speaker_group_id: "g1",
      speaker_ticket_type_id: null,
      updated_at: "2026-09-02T10:00:00+00:00",
      options: {
        tracks: [{ id: "t1", key: "energy", name_pl: "Energia", name_en: "Energy", is_active: false }],
        rooms: [{ id: "r1", name: "Sala A" }, { id: "r2", name: "Sala B", is_active: false }],
        groups: [{ id: "g1", key: "speakers", name_pl: "Prelegenci", name_en: "Speakers" }],
        tickets: [],
      },
    });
    expect(settings).toMatchObject({
      eventId: "e1",
      eventSlug: "kongres",
      eventStatus: "published",
      exists: true,
      status: "open",
      phase: "open",
      isOpen: true,
      opensAt: "2026-09-01T10:00:00+00:00",
      closesAt: null,
      trackIds: ["t1"],
      maxPerSubmitter: 2,
      allowCoSpeakers: false,
      reviewBlind: true,
      scoreMax: 10,
      minReviews: 0,
      speakerGroupId: "g1",
      speakerTicketTypeId: null,
    });
    expect(settings.tracks[0]).toEqual({
      id: "t1",
      key: "energy",
      namePl: "Energia",
      nameEn: "Energy",
      isActive: false,
    });
    expect(settings.rooms).toEqual([
      { id: "r1", name: "Sala A", isActive: true },
      { id: "r2", name: "Sala B", isActive: false },
    ]);
    expect(settings.groups[0]?.namePl).toBe("Prelegenci");
    expect(settings.tickets).toEqual([]);
  });

  it("pusta odpowiedź = bezpieczne wartości domyślne (szkic, bez fazy)", () => {
    const settings = parseCfpSettings(null);
    expect(settings.status).toBe("draft");
    expect(settings.phase).toBe("none");
    expect(settings.allowCoSpeakers).toBe(true);
    expect(settings.maxPerSubmitter).toBe(3);
    expect(settings.scoreMax).toBe(5);
    expect(settings.minReviews).toBe(2);
    expect(settings.rooms).toEqual([]);
  });
});

describe("parseCfpCounts", () => {
  it("liczniki per stan, a brakujące stany = 0", () => {
    const counts = parseCfpCounts({ total: 4, draft: 1, submitted: 3, needs_reviews: 2, min_reviews: 3 });
    expect(counts.total).toBe(4);
    expect(counts.draft).toBe(1);
    expect(counts.byStatus.submitted).toBe(3);
    expect(counts.byStatus.accepted).toBe(0);
    expect(counts.needsReviews).toBe(2);
    expect(counts.minReviews).toBe(3);
    expect(parseCfpCounts(null).minReviews).toBe(2);
  });
});

describe("parseCfpSubmissionDetail", () => {
  const detail = {
    submission: {
      id: "s1",
      event_id: "e1",
      status: "under_review",
      title_pl: "Tytuł",
      title_en: "Title",
      abstract_pl: "Streszczenie",
      abstract_en: "",
      talk_language: "en",
      format_key: "talk",
      duration_min: 30,
      track_id: "t1",
      topics: ["a", 1],
      answers: { exp: "a" },
      submitted_at: "2026-09-03T10:00:00+00:00",
      decision_note: "n",
      feedback_to_speaker: "f",
      decided_at: null,
      notified_status: "accepted",
      notified_at: "2026-09-04T10:00:00+00:00",
      notify_error: null,
      session_id: "ses1",
    },
    event: { slug: "kongres", timezone: "Europe/Warsaw", starts_at: "2026-10-01T08:00:00+00:00" },
    person: {
      id: "p1",
      email: "a@b.pl",
      phone: null,
      consent_marketing_at: "2026-09-01T00:00:00+00:00",
      consent_withdrawn_at: null,
    },
    speakers: [
      {
        id: "sp1",
        person_id: "p1",
        is_primary: true,
        role: "speaker",
        first_name: "Anna",
        last_name: "Nowak",
        email: "a@b.pl",
        job_title: "CEO",
        company_text: null,
        crm: { sync_status: "error", crm_lead_id: null, last_error: "x", synced_at: "2026-09-03T10:00:00+00:00" },
      },
      { id: "sp2", person_id: null, role: "boss", first_name: "Jan", last_name: "Kowalski", crm: null },
    ],
    fields: [FIELD],
    reviews: [
      {
        id: "r1",
        reviewer_name: "Rec",
        scores: { rel: 4, bad: "x" },
        overall: 4,
        recommendation: "accept",
        comment_private: "p",
        comment_to_speaker: "s",
        conflict_of_interest: false,
        updated_at: "2026-09-03T11:00:00+00:00",
      },
      { id: "r2", recommendation: "strong", conflict_of_interest: true },
    ],
    summary: {
      reviews_count: 2,
      conflicts_count: 1,
      overall_avg: "4.5",
      weighted_avg: null,
      recommendations: { accept: 1 },
    },
    settings: { score_max: 5, review_criteria: [CRITERION], formats: [FORMAT], min_reviews: 3 },
    track: { id: "t1", name_pl: "Energia", name_en: "Energy" },
    session: {
      id: "ses1",
      title_pl: "Sesja",
      title_en: "Session",
      starts_at: "2026-10-01T09:00:00+00:00",
      ends_at: "2026-10-01T09:30:00+00:00",
      status: "draft",
    },
  };

  it("czyta zgłoszenie, osoby z kartą CRM, oceny i agregaty", () => {
    const parsed = parseCfpSubmissionDetail(detail as unknown as Json);
    expect(parsed).toMatchObject({
      id: "s1",
      status: "under_review",
      talkLanguage: "en",
      formatKey: "talk",
      durationMin: 30,
      topics: ["a"],
      answers: { exp: "a" },
      decisionNote: "n",
      feedbackToSpeaker: "f",
      decidedAt: null,
      notifiedStatus: "accepted",
      sessionId: "ses1",
      eventSlug: "kongres",
      eventEndsAt: null,
      person: { id: "p1", email: "a@b.pl", phone: null, consentMarketing: true },
      scoreMax: 5,
      minReviews: 3,
      track: { id: "t1", namePl: "Energia", nameEn: "Energy" },
      session: { id: "ses1", status: "draft", endsAt: "2026-10-01T09:30:00+00:00" },
    });
    expect(parsed.speakers[0]?.crm).toEqual({
      syncStatus: "error",
      crmLeadId: null,
      lastError: "x",
      syncedAt: "2026-09-03T10:00:00+00:00",
    });
    expect(parsed.speakers[1]).toMatchObject({ role: "speaker", isPrimary: false, crm: null, email: null });
    expect(parsed.reviews[0]?.scores).toEqual({ rel: 4 });
    expect(parsed.reviews[0]?.recommendation).toBe("accept");
    expect(parsed.reviews[1]?.recommendation).toBeNull();
    expect(parsed.reviews[1]?.overall).toBeNull();
    expect(parsed.summary).toEqual({
      reviewsCount: 2,
      conflictsCount: 1,
      overallAvg: 4.5,
      weightedAvg: null,
      recommendations: { accept: 1, maybe: 0, reject: 0, abstain: 0 },
    });
    expect(parsed.fields[0]?.key).toBe("exp");
  });

  it("wycofana zgoda, brak ścieżki i sesji, nieznany stan CRM", () => {
    const parsed = parseCfpSubmissionDetail({
      ...detail,
      person: { id: "p1", consent_marketing_at: "2026-09-01", consent_withdrawn_at: "2026-09-02" },
      speakers: [{ id: "x", crm: { sync_status: "weird" } }],
      track: null,
      session: null,
    } as unknown as Json);
    expect(parsed.person.consentMarketing).toBe(false);
    expect(parsed.track).toBeNull();
    expect(parsed.session).toBeNull();
    expect(parsed.speakers[0]?.crm?.syncStatus).toBe("skipped");
    expect(parseCfpSubmissionDetail(null).status).toBe("draft");
    expect(parseCfpSubmissionDetail(null).person.consentMarketing).toBe(false);
  });
});

describe("parseCfpPublic", () => {
  it("brak wydarzenia (null albo lista) = null", () => {
    expect(parseCfpPublic(null)).toBeNull();
    expect(parseCfpPublic([] as Json)).toBeNull();
  });

  it("czyta fazę, teksty, formy, ścieżki i pytania", () => {
    const cfp = parseCfpPublic({
      event_id: "e1",
      event_slug: "kongres",
      timezone: "Europe/Warsaw",
      phase: "scheduled",
      is_open: false,
      opens_at: "2026-10-01T00:00:00+00:00",
      closes_at: null,
      intro_pl: "Wstęp",
      formats: [FORMAT],
      tracks: [{ id: "t1", key: "k", name_pl: "Energia", name_en: "Energy" }],
      fields: [FIELD],
      allow_co_speakers: true,
      max_per_submitter: 1,
    });
    expect(cfp).toMatchObject({
      phase: "scheduled",
      isOpen: false,
      closesAt: null,
      introPl: "Wstęp",
      introEn: "",
      allowCoSpeakers: true,
      maxPerSubmitter: 1,
    });
    expect(cfp?.tracks[0]?.isActive).toBe(true);
    expect(parseCfpPublic({ phase: "bogus" })?.phase).toBe("none");
  });
});

describe("parseMyCfpSubmissions", () => {
  it("null = brak wydarzenia; osoba opcjonalna; podsumowanie ocen z `review_summary`", () => {
    expect(parseMyCfpSubmissions(null)).toBeNull();
    const mine = parseMyCfpSubmissions({
      event_id: "e1",
      event_slug: "kongres",
      timezone: "Europe/Warsaw",
      max_per_submitter: 2,
      score_max: 10,
      person: {
        id: "p1",
        first_name: "Anna",
        last_name: "Nowak",
        email: "a@b.pl",
        job_title: null,
        company_text: "NES",
        consent_marketing: true,
      },
      items: [
        {
          id: "s1",
          status: "accepted",
          title_pl: "T",
          withdrawn_at: null,
          confirmed_at: null,
          declined_at: null,
          updated_at: "2026-09-01T00:00:00+00:00",
          session_id: "ses",
          feedback_to_speaker: "Brawo",
          speakers: [{ is_primary: true, role: "host", first_name: "Anna", last_name: "Nowak" }],
          review_summary: { reviews_count: 3, overall_avg: 4.2 },
        },
      ],
    });
    expect(mine?.person).toEqual({
      id: "p1",
      firstName: "Anna",
      lastName: "Nowak",
      email: "a@b.pl",
      jobTitle: null,
      companyText: "NES",
      consentMarketing: true,
    });
    expect(mine?.maxPerSubmitter).toBe(2);
    expect(mine?.items[0]).toMatchObject({
      status: "accepted",
      sessionId: "ses",
      feedbackToSpeaker: "Brawo",
      reviewsCount: 3,
      overallAvg: 4.2,
    });
    expect(mine?.items[0]?.speakers[0]).toMatchObject({ isPrimary: true, role: "host", email: null });
    expect(parseMyCfpSubmissions({ person: null, items: [{}] })?.person).toBeNull();
    expect(parseMyCfpSubmissions({ items: [{}] })?.items[0]?.overallAvg).toBeNull();
  });
});

describe("parseSpeakerPanel", () => {
  it("panel z profilem, sesjami i materiałami", () => {
    expect(parseSpeakerPanel(null)).toBeNull();
    const panel = parseSpeakerPanel({
      event_id: "e1",
      event_slug: "kongres",
      timezone: "Europe/Warsaw",
      is_reviewer: true,
      submissions_count: 2,
      person: { id: "p1" },
      profile: {
        speaker_profile_id: "sp1",
        headline_pl: "H",
        headline_en: "",
        bio_pl: "B",
        bio_en: "",
        topics_pl: ["a"],
        topics_en: [],
        languages: ["pl"],
        card_photo_url: "https://x.pl/a.jpg",
      },
      sessions: [
        {
          session_id: "ses1",
          title_pl: "S",
          title_en: "S-en",
          starts_at: "2026-10-01T09:00:00+00:00",
          ends_at: null,
          status: "published",
          role: "moderator",
          room_name: "A",
          track_name_pl: "Energia",
          track_name_en: null,
        },
      ],
      materials: [
        {
          id: "m1",
          kind: "slides",
          title_pl: "Slajdy",
          title_en: "",
          url: "https://x.pl/s.pdf",
          visibility: "public",
          is_published: true,
          submission_id: null,
          session_id: "ses1",
        },
        { id: "m2", kind: "zip", visibility: "all" },
      ],
    });
    expect(panel).toMatchObject({ isReviewer: true, submissionsCount: 2, hasPerson: true });
    expect(panel?.profile).toMatchObject({ speakerProfileId: "sp1", topicsPl: ["a"], languages: ["pl"] });
    expect(panel?.sessions[0]).toMatchObject({ role: "moderator", roomName: "A", trackNameEn: null, endsAt: null });
    expect(panel?.materials[0]).toMatchObject({ kind: "slides", visibility: "public", isPublished: true, sessionId: "ses1" });
    expect(panel?.materials[1]).toMatchObject({ kind: "link", visibility: "organizers" });
    const empty = parseSpeakerPanel({ person: null, profile: null });
    expect(empty?.hasPerson).toBe(false);
    expect(empty?.profile).toBeNull();
    expect(empty?.sessions).toEqual([]);
  });
});

describe("parseCfpReviewQueue i parseCfpReviewDetail", () => {
  it("kolejka: ocena w ciemno = `speakers: null`, własna ocena opcjonalna", () => {
    expect(parseCfpReviewQueue(null)).toBeNull();
    const queue = parseCfpReviewQueue({
      event_id: "e1",
      event_slug: "kongres",
      timezone: "Europe/Warsaw",
      identity_visible: false,
      score_max: 5,
      review_criteria: [CRITERION],
      items: [
        {
          id: "s1",
          status: "submitted",
          title_pl: "T",
          talk_language: "pl",
          format_key: null,
          track_name_pl: "E",
          track_name_en: "E-en",
          submitted_at: "2026-09-01T00:00:00+00:00",
          speakers: null,
          my_review: null,
        },
        {
          id: "s2",
          status: "nope",
          speakers: [{ first_name: "A", last_name: "B", role: "x", job_title: "J", company_text: null }],
          my_review: { overall: 3, recommendation: "maybe", conflict_of_interest: true },
        },
      ],
    });
    expect(queue?.identityVisible).toBe(false);
    expect(queue?.items[0]).toMatchObject({ speakers: null, myReview: null, formatKey: null });
    expect(queue?.items[1]).toMatchObject({
      status: "submitted",
      talkLanguage: "pl",
      speakers: [{ firstName: "A", lastName: "B", role: "speaker", jobTitle: "J", companyText: null }],
      myReview: { overall: 3, recommendation: "maybe", conflictOfInterest: true },
    });
  });

  it("szczegół: ścieżka i własna ocena opcjonalne", () => {
    const full = parseCfpReviewDetail({
      submission: { id: "s1", status: "under_review", title_pl: "T" },
      identity_visible: true,
      speakers: [{ first_name: "A" }],
      fields: [FIELD],
      formats: [FORMAT],
      track: { name_pl: "E", name_en: "E-en" },
      score_max: 7,
      review_criteria: [CRITERION],
      review: {
        scores: { rel: 5 },
        overall: 5,
        recommendation: "accept",
        comment_private: "p",
        comment_to_speaker: "s",
        conflict_of_interest: false,
      },
    });
    expect(full.submission.id).toBe("s1");
    expect(full.identityVisible).toBe(true);
    expect(full.track).toEqual({ namePl: "E", nameEn: "E-en" });
    expect(full.scoreMax).toBe(7);
    expect(full.review).toEqual({
      scores: { rel: 5 },
      overall: 5,
      recommendation: "accept",
      commentPrivate: "p",
      commentToSpeaker: "s",
      conflictOfInterest: false,
    });
    const bare = parseCfpReviewDetail({ track: null, review: null, speakers: "x" });
    expect(bare.track).toBeNull();
    expect(bare.review).toBeNull();
    expect(bare.speakers).toBeNull();
  });
});

describe("drobne wyniki zapisów", () => {
  it("wynik zapisu rozróżnia usunięty szkic", () => {
    expect(parseCfpWriteResult({ id: "s1", status: "deleted" })).toEqual({ id: "s1", status: "deleted" });
    expect(parseCfpWriteResult({ id: "s1", status: "submitted" })).toEqual({ id: "s1", status: "submitted" });
    expect(parseCfpWriteResult(null)).toEqual({ id: "", status: "draft" });
  });

  it("wynik przyjęcia", () => {
    expect(
      parseCfpAcceptResult({
        id: "s1",
        session_id: "ses",
        speaker_profile_id: "sp",
        speakers_enrolled: 2,
        registrations_created: 1,
      }),
    ).toEqual({
      id: "s1",
      sessionId: "ses",
      speakerProfileId: "sp",
      speakersEnrolled: 2,
      registrationsCreated: 1,
    });
    expect(parseCfpAcceptResult(null).sessionId).toBeNull();
  });
});
