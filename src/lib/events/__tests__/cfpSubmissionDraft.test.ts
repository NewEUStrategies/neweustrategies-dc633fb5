// Szkice po stronie uczestnika: zgłoszenie, ocena recenzenta, decyzja
// i przyjęcie organizatora, profil prelegenta i materiał.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW - pilnowane niżej:
// Każda reguła jest lustrem odmowy bazy (`missing_title`, `score_required`,
// `note_required`, `invalid_schedule`, `invalid_profile`, `invalid_url`).
import { describe, expect, it } from "vitest";

import {
  answerToDraft,
  CFP_MAX_CO_SPEAKERS,
  cfpAnswersPayload,
  cfpSubmissionDraftFromItem,
  cfpSubmissionSaveInput,
  emptyCfpSubmissionDraft,
  emptyCoSpeakerDraft,
  parseTopics,
  toRegistrationFormField,
  validateCfpDraftSave,
  validateCfpDraftSubmit,
  type CfpSubmissionDraft,
} from "@/lib/events/cfpSubmissionDraft";
import {
  cfpAcceptDraftFrom,
  cfpAcceptIssue,
  cfpAcceptPayload,
  cfpDecisionIssue,
  cfpDecisionPayload,
  cfpReviewDraftFrom,
  cfpReviewIssue,
  cfpReviewPayload,
  scoreScale,
} from "@/lib/events/cfpReviewDraft";
import {
  emptySpeakerMaterialDraft,
  speakerMaterialDraftFrom,
  speakerMaterialIssue,
  speakerMaterialPayload,
  speakerProfileDraftFrom,
  speakerProfileIssue,
  speakerProfilePayload,
} from "@/lib/events/speakerPanelDraft";
import {
  parseCfpPublic,
  parseMyCfpSubmissions,
  type CfpFieldDef,
  type CfpPublic,
} from "@/lib/events/cfpSurface";

function field(overrides: Partial<CfpFieldDef>): CfpFieldDef {
  return {
    id: "f",
    key: "k",
    fieldType: "text",
    labelPl: "P",
    labelEn: "E",
    helpPl: "",
    helpEn: "",
    isRequired: false,
    isActive: true,
    options: [],
    ...overrides,
  };
}

function cfp(overrides: Partial<CfpPublic> = {}): CfpPublic {
  const base = parseCfpPublic({ phase: "open", is_open: true, allow_co_speakers: true });
  if (base === null) throw new Error("test");
  return { ...base, ...overrides };
}

const PERSON = {
  id: "p1",
  firstName: "Anna",
  lastName: "Nowak",
  email: "a@b.pl",
  jobTitle: "CEO",
  companyText: "NES",
  consentMarketing: true,
};

function validDraft(): CfpSubmissionDraft {
  return {
    ...emptyCfpSubmissionDraft(PERSON, "pl"),
    titlePl: "Tytuł wystąpienia",
    abstractPl: "Streszczenie wystąpienia dłuższe niż dwadzieścia znaków.",
  };
}

const issues = (draft: CfpSubmissionDraft, publicCfp: CfpPublic = cfp()) =>
  validateCfpDraftSubmit(draft, publicCfp).map((issue) => issue.field);

describe("szkic zgłoszenia", () => {
  it("pusty szkic bierze dane osoby (albo puste pola bez osoby)", () => {
    expect(emptyCfpSubmissionDraft(PERSON, "en")).toMatchObject({
      id: null,
      firstName: "Anna",
      lastName: "Nowak",
      jobTitle: "CEO",
      companyText: "NES",
      consentMarketing: true,
      talkLanguage: "en",
      role: "speaker",
      coSpeakers: [],
    });
    expect(emptyCfpSubmissionDraft(null, "pl")).toMatchObject({
      firstName: "",
      lastName: "",
      consentMarketing: false,
    });
  });

  it("szkic z istniejącego zgłoszenia: odpowiedzi jako napisy, współprelegenci bez zgłaszającego", () => {
    const mine = parseMyCfpSubmissions({
      items: [
        {
          id: "s1",
          status: "draft",
          title_pl: "T",
          title_en: "E",
          abstract_pl: "A",
          talk_language: "en",
          format_key: "talk",
          track_id: "t1",
          topics: ["x", "y"],
          answers: { yes: true, no: false, n: 5, list: ["a", 1], text: "t", obj: {} },
          speakers: [
            { is_primary: true, role: "host", first_name: "Anna", last_name: "Nowak" },
            {
              is_primary: false,
              role: "panelist",
              first_name: "Jan",
              last_name: "K",
              email: null,
              job_title: null,
              company_text: "X",
            },
          ],
        },
        {
          id: "s2",
          speakers: [
            { is_primary: false, first_name: "B", last_name: "C", email: "b@c.pl", job_title: "J" },
          ],
        },
      ],
    });
    const item = mine?.items[0];
    if (item === undefined) throw new Error("test");
    const draft = cfpSubmissionDraftFromItem(item, null);
    expect(draft).toMatchObject({
      id: "s1",
      role: "host",
      formatKey: "talk",
      trackId: "t1",
      topics: "x, y",
      talkLanguage: "en",
      answers: { yes: "true", no: "", n: "5", list: ["a"], text: "t", obj: "" },
      coSpeakers: [
        {
          firstName: "Jan",
          lastName: "K",
          email: "",
          jobTitle: "",
          companyText: "X",
          role: "panelist",
        },
      ],
    });
    const second = mine?.items[1];
    if (second === undefined) throw new Error("test");
    expect(cfpSubmissionDraftFromItem(second, PERSON)).toMatchObject({
      role: "speaker",
      formatKey: "",
      trackId: "",
      coSpeakers: [{ firstName: "B", email: "b@c.pl", jobTitle: "J", companyText: "" }],
    });
  });

  it("odpowiedzi -> wartości kontrolek i z powrotem w typach pytań", () => {
    expect(answerToDraft(undefined)).toBe("");
    const defs = [
      field({ key: "c", fieldType: "checkbox" }),
      field({ key: "m", fieldType: "multiselect" }),
      field({ key: "n", fieldType: "number" }),
      field({ key: "bad", fieldType: "number" }),
      field({ key: "t", fieldType: "text" }),
      field({ key: "e", fieldType: "text" }),
      field({ key: "m2", fieldType: "multiselect" }),
    ];
    expect(
      cfpAnswersPayload(defs, {
        c: "true",
        m: ["a"],
        n: " 7 ",
        bad: "x",
        t: " hej ",
        e: "  ",
        m2: "zly",
      }),
    ).toEqual({ c: true, m: ["a"], n: 7, bad: "x", t: "hej", m2: [] });
  });

  it("tematy: przecinki, bez pustych i bez powtórzeń", () => {
    expect(parseTopics(" a, b ,, a,c ")).toEqual(["a", "b", "c"]);
  });

  it("zapis szkicu wymaga tylko imienia i nazwiska", () => {
    expect(validateCfpDraftSave(validDraft())).toEqual([]);
    expect(
      validateCfpDraftSave({ ...validDraft(), firstName: " ", lastName: "" }).map(
        (issue) => issue.messageKey,
      ),
    ).toEqual(["eventCfp.submit.validation.firstName", "eventCfp.submit.validation.lastName"]);
  });

  it("wysłanie: tytuł i streszczenie w którymkolwiek języku", () => {
    expect(issues(validDraft())).toEqual([]);
    expect(issues({ ...validDraft(), titlePl: "x", titleEn: "" })).toEqual(["title"]);
    expect(issues({ ...validDraft(), titlePl: "", titleEn: "Title" })).toEqual([]);
    expect(issues({ ...validDraft(), abstractPl: "za krótko" })).toEqual(["abstract"]);
    expect(issues({ ...validDraft(), abstractPl: "", abstractEn: "x".repeat(20) })).toEqual([]);
  });

  it("forma i ścieżka są wymagane, gdy organizator je skonfigurował", () => {
    const withLists = cfp({
      formats: [{ key: "talk", labelPl: "W", labelEn: "T", durationMin: 30 }],
      tracks: [{ id: "t1", key: "k", namePl: "E", nameEn: "E", isActive: true }],
    });
    expect(issues(validDraft(), withLists)).toEqual(["format", "track"]);
    expect(issues({ ...validDraft(), formatKey: "talk", trackId: "t1" }, withLists)).toEqual([]);
    expect(issues({ ...validDraft(), formatKey: "gone", trackId: "t1" }, withLists)).toEqual([
      "format",
    ]);
  });

  it("wymagane pytania organizatora", () => {
    const withFields = cfp({
      fields: [
        field({ key: "c", fieldType: "checkbox", isRequired: true }),
        field({ key: "m", fieldType: "multiselect", isRequired: true }),
        field({ key: "t", fieldType: "text", isRequired: true }),
        field({ key: "opt", fieldType: "text", isRequired: false }),
      ],
    });
    expect(issues(validDraft(), withFields)).toEqual(["answer:c", "answer:m", "answer:t"]);
    expect(
      issues({ ...validDraft(), answers: { c: "true", m: ["a"], t: "x" } }, withFields),
    ).toEqual([]);
    expect(issues({ ...validDraft(), answers: { c: "", m: [], t: "  " } }, withFields)).toEqual([
      "answer:c",
      "answer:m",
      "answer:t",
    ]);
  });

  it("współprelegenci: wyłączeni, za dużo, bez nazwiska, zły albo powtórzony e-mail", () => {
    const co = { ...emptyCoSpeakerDraft(), firstName: "Jan", lastName: "K" };
    expect(issues({ ...validDraft(), coSpeakers: [co] })).toEqual([]);
    expect(issues({ ...validDraft(), coSpeakers: [co] }, cfp({ allowCoSpeakers: false }))).toEqual([
      "coSpeakers",
    ]);
    const tooMany = Array.from({ length: CFP_MAX_CO_SPEAKERS + 1 }, () => co);
    expect(issues({ ...validDraft(), coSpeakers: tooMany })).toEqual(["coSpeakers"]);
    expect(issues({ ...validDraft(), coSpeakers: [{ ...co, lastName: " " }] })).toEqual([
      "coSpeakers",
    ]);
    expect(issues({ ...validDraft(), coSpeakers: [{ ...co, firstName: "" }] })).toEqual([
      "coSpeakers",
    ]);
    expect(issues({ ...validDraft(), coSpeakers: [{ ...co, email: "zly" }] })).toEqual([
      "coSpeakers",
    ]);
    expect(
      issues({
        ...validDraft(),
        coSpeakers: [
          { ...co, email: "a@b.pl" },
          { ...co, email: "A@B.pl " },
        ],
      }),
    ).toEqual(["coSpeakers"]);
    expect(issues({ ...validDraft(), coSpeakers: [{ ...co, email: "jan@x.pl" }] })).toEqual([]);
  });

  it("ładunek zapisu: slug tylko dla nowego szkicu, puste pola jako `null`", () => {
    const publicCfp = cfp({ fields: [field({ key: "t" })] });
    const input = cfpSubmissionSaveInput(
      {
        ...validDraft(),
        firstName: " Anna ",
        topics: "a, b",
        answers: { t: " x " },
        coSpeakers: [
          {
            firstName: " Jan ",
            lastName: " K ",
            email: " JAN@X.PL ",
            jobTitle: " ",
            companyText: "",
            role: "moderator",
          },
          { ...emptyCoSpeakerDraft(), firstName: "B", lastName: "C" },
        ],
      },
      { slug: "kongres", cfp: publicCfp, notifyLang: "en" },
    );
    expect(input).toMatchObject({
      id: undefined,
      slug: "kongres",
      speaker: {
        first_name: "Anna",
        last_name: "Nowak",
        job_title: "CEO",
        company_text: "NES",
        consent_marketing: true,
      },
      notifyLang: "en",
      formatKey: null,
      trackId: null,
      topics: ["a", "b"],
      answers: { t: "x" },
      role: "speaker",
      coSpeakers: [
        {
          first_name: "Jan",
          last_name: "K",
          email: "jan@x.pl",
          job_title: "",
          company_text: "",
          role: "moderator",
        },
        {
          first_name: "B",
          last_name: "C",
          email: null,
          job_title: "",
          company_text: "",
          role: "speaker",
        },
      ],
    });
    const saved = cfpSubmissionSaveInput(
      { ...validDraft(), id: "s1", formatKey: "talk", trackId: "t1" },
      { slug: "kongres", cfp: publicCfp, notifyLang: "pl" },
    );
    expect(saved).toMatchObject({ id: "s1", slug: undefined, formatKey: "talk", trackId: "t1" });
  });

  it("pytanie naboru jako pole zapisu: `url` rysuje się jak adres (typ `file`)", () => {
    expect(toRegistrationFormField(field({ fieldType: "url", key: "u" })).fieldType).toBe("file");
    expect(toRegistrationFormField(field({ fieldType: "select", key: "s" }))).toMatchObject({
      id: "f",
      key: "s",
      fieldType: "select",
      isRequired: false,
      options: [],
    });
  });
});

describe("ocena recenzenta", () => {
  const criteria = [
    { key: "rel", labelPl: "T", labelEn: "R", weight: 2 },
    { key: "depth", labelPl: "G", labelEn: "D", weight: 1 },
  ];

  it("szkic z istniejącej oceny albo pusty", () => {
    expect(cfpReviewDraftFrom(null, criteria)).toEqual({
      scores: { rel: null, depth: null },
      overall: null,
      recommendation: null,
      commentPrivate: "",
      commentToSpeaker: "",
      conflictOfInterest: false,
    });
    expect(
      cfpReviewDraftFrom(
        {
          scores: { rel: 4 },
          overall: 4,
          recommendation: "accept",
          commentPrivate: "p",
          commentToSpeaker: "s",
          conflictOfInterest: true,
        },
        criteria,
      ),
    ).toMatchObject({ scores: { rel: 4, depth: null }, overall: 4, conflictOfInterest: true });
  });

  it("ocena ogólna wymagana, chyba że wstrzymanie albo konflikt; komentarze do 4000", () => {
    const draft = cfpReviewDraftFrom(null, criteria);
    expect(cfpReviewIssue(draft)).toBe("eventCfp.review.validation.overall");
    expect(cfpReviewIssue({ ...draft, recommendation: "abstain" })).toBeNull();
    expect(cfpReviewIssue({ ...draft, conflictOfInterest: true })).toBeNull();
    expect(cfpReviewIssue({ ...draft, overall: 3 })).toBeNull();
    expect(cfpReviewIssue({ ...draft, overall: 3, commentPrivate: "x".repeat(4001) })).toBe(
      "eventCfp.review.validation.comments",
    );
    expect(cfpReviewIssue({ ...draft, overall: 3, commentToSpeaker: "x".repeat(4001) })).toBe(
      "eventCfp.review.validation.comments",
    );
  });

  it("ładunek pomija kryteria bez oceny i przycina komentarze; skala 1..max", () => {
    expect(
      cfpReviewPayload("s1", {
        ...cfpReviewDraftFrom(null, criteria),
        scores: { rel: 5, depth: null },
        overall: 5,
        commentPrivate: " p ",
        commentToSpeaker: " s ",
      }),
    ).toEqual({
      submissionId: "s1",
      scores: { rel: 5 },
      overall: 5,
      recommendation: null,
      commentPrivate: "p",
      commentToSpeaker: "s",
      conflictOfInterest: false,
    });
    expect(scoreScale(3)).toEqual([1, 2, 3]);
    expect(scoreScale(-1)).toEqual([]);
  });
});

describe("decyzja i przyjęcie organizatora", () => {
  it("odrzucenie wymaga notatki; długości pól", () => {
    const base = { status: "rejected" as const, decisionNote: "", feedbackToSpeaker: "" };
    expect(cfpDecisionIssue(base)).toBe("adminEventCfp.detail.validation.noteRequired");
    expect(cfpDecisionIssue({ ...base, decisionNote: "ok!" })).toBeNull();
    expect(cfpDecisionIssue({ ...base, status: "waitlisted" })).toBeNull();
    expect(
      cfpDecisionIssue({ ...base, status: "waitlisted", decisionNote: "x".repeat(2001) }),
    ).toBe("adminEventCfp.detail.validation.tooLong");
    expect(
      cfpDecisionIssue({ ...base, status: "waitlisted", feedbackToSpeaker: "x".repeat(4001) }),
    ).toBe("adminEventCfp.detail.validation.tooLong");
    expect(
      cfpDecisionPayload("s1", {
        status: "under_review",
        decisionNote: " n ",
        feedbackToSpeaker: " f ",
      }),
    ).toEqual({ id: "s1", status: "under_review", decisionNote: "n", feedbackToSpeaker: "f" });
  });

  it("przyjęcie bez planu jest poprawne; plan wymaga poprawnego okna do 48 h", () => {
    const draft = cfpAcceptDraftFrom({ decisionNote: "n", feedbackToSpeaker: "f", trackId: null });
    expect(draft).toMatchObject({ register: true, schedule: false, trackId: "", format: "onsite" });
    expect(
      cfpAcceptDraftFrom({ decisionNote: "", feedbackToSpeaker: "", trackId: "t1" }).trackId,
    ).toBe("t1");
    expect(cfpAcceptIssue(draft)).toBeNull();
    expect(cfpAcceptIssue({ ...draft, decisionNote: "x".repeat(2001) })).toBe(
      "adminEventCfp.detail.validation.tooLong",
    );
    expect(cfpAcceptIssue({ ...draft, feedbackToSpeaker: "x".repeat(4001) })).toBe(
      "adminEventCfp.detail.validation.tooLong",
    );
    const scheduled = {
      ...draft,
      schedule: true,
      startsAt: "2026-10-01T09:00:00.000Z",
      endsAt: "2026-10-01T09:30:00.000Z",
    };
    expect(cfpAcceptIssue(scheduled)).toBeNull();
    expect(cfpAcceptIssue({ ...scheduled, endsAt: "" })).toBe(
      "adminEventCfp.accept.validation.schedule",
    );
    expect(cfpAcceptIssue({ ...scheduled, endsAt: scheduled.startsAt })).toBe(
      "adminEventCfp.accept.validation.schedule",
    );
    expect(cfpAcceptIssue({ ...scheduled, endsAt: "2026-10-03T09:00:01.000Z" })).toBe(
      "adminEventCfp.accept.validation.schedule",
    );
    expect(cfpAcceptPayload("s1", draft)).toEqual({
      id: "s1",
      decisionNote: "n",
      feedbackToSpeaker: "f",
      register: true,
      schedule: null,
    });
    expect(
      cfpAcceptPayload("s1", { ...scheduled, roomId: "r1", trackId: "", format: "hybrid" })
        .schedule,
    ).toEqual({
      startsAt: "2026-10-01T09:00:00.000Z",
      endsAt: "2026-10-01T09:30:00.000Z",
      roomId: "r1",
      trackId: null,
      format: "hybrid",
    });
    expect(
      cfpAcceptPayload("s1", { ...scheduled, roomId: "", trackId: "t1" }).schedule,
    ).toMatchObject({
      roomId: null,
      trackId: "t1",
    });
  });
});

describe("panel prelegenta", () => {
  const profile = {
    speakerProfileId: "sp1",
    headlinePl: "H",
    headlineEn: "",
    bioPl: "B",
    bioEn: "",
    topicsPl: ["a", "b"],
    topicsEn: [],
    languages: ["pl", "en"],
    cardPhotoUrl: "",
  };

  it("profil: tematy i języki jako tekst, reguły lustrzane do `invalid_profile`", () => {
    const draft = speakerProfileDraftFrom(profile);
    expect(draft).toMatchObject({ topicsPl: "a, b", topicsEn: "", languages: "pl, en" });
    expect(speakerProfileIssue(draft)).toBeNull();
    expect(speakerProfileIssue({ ...draft, headlineEn: "x".repeat(201) })).toBe(
      "eventCfp.speaker.profile.validation.headline",
    );
    expect(speakerProfileIssue({ ...draft, bioPl: "x".repeat(4001) })).toBe(
      "eventCfp.speaker.profile.validation.bio",
    );
    expect(speakerProfileIssue({ ...draft, cardPhotoUrl: "http://x.pl/a.jpg" })).toBe(
      "eventCfp.speaker.profile.validation.photo",
    );
    expect(
      speakerProfileIssue({ ...draft, cardPhotoUrl: `https://x.pl/${"a".repeat(2050)}` }),
    ).toBe("eventCfp.speaker.profile.validation.photo");
    expect(speakerProfileIssue({ ...draft, cardPhotoUrl: "https://x.pl/a.jpg" })).toBeNull();
    const thirteen = Array.from({ length: 13 }, (_, i) => `t${i}`).join(",");
    expect(speakerProfileIssue({ ...draft, topicsPl: thirteen })).toBe(
      "eventCfp.speaker.profile.validation.topics",
    );
    expect(speakerProfileIssue({ ...draft, topicsEn: thirteen })).toBe(
      "eventCfp.speaker.profile.validation.topics",
    );
    expect(speakerProfileIssue({ ...draft, topicsEn: "x".repeat(61) })).toBe(
      "eventCfp.speaker.profile.validation.topics",
    );
    expect(speakerProfileIssue({ ...draft, languages: "polski" })).toBe(
      "eventCfp.speaker.profile.validation.languages",
    );
    const eleven = Array.from({ length: 11 }, (_, i) => `a${String.fromCharCode(97 + i)}`).join(
      ",",
    );
    expect(speakerProfileIssue({ ...draft, languages: eleven })).toBe(
      "eventCfp.speaker.profile.validation.languages",
    );
    expect(
      speakerProfilePayload("kongres", { ...draft, languages: "PL, en", headlinePl: " H " }),
    ).toEqual({
      slug: "kongres",
      headlinePl: "H",
      headlineEn: "",
      bioPl: "B",
      bioEn: "",
      topicsPl: ["a", "b"],
      topicsEn: [],
      languages: ["pl", "en"],
      cardPhotoUrl: "",
    });
  });

  it("materiał: tytuł w jednym języku, adres https; ładunek bez przepinania zgłoszenia", () => {
    const empty = emptySpeakerMaterialDraft();
    expect(empty).toMatchObject({
      id: null,
      kind: "slides",
      visibility: "organizers",
      sessionId: "",
    });
    expect(speakerMaterialIssue(empty)).toBe("eventCfp.speaker.materials.validation.title");
    const draft = { ...empty, titleEn: "Slides", url: "https://x.pl/s.pdf" };
    expect(speakerMaterialIssue(draft)).toBeNull();
    expect(speakerMaterialIssue({ ...draft, titlePl: "x".repeat(201) })).toBe(
      "eventCfp.speaker.materials.validation.title",
    );
    expect(speakerMaterialIssue({ ...draft, url: "ftp://x" })).toBe(
      "eventCfp.speaker.materials.validation.url",
    );
    expect(speakerMaterialIssue({ ...draft, url: `https://x.pl/${"a".repeat(2000)}` })).toBe(
      "eventCfp.speaker.materials.validation.url",
    );
    expect(speakerMaterialPayload("kongres", { ...draft, url: " https://x.pl/s.pdf " })).toEqual({
      id: undefined,
      slug: "kongres",
      kind: "slides",
      titlePl: "",
      titleEn: "Slides",
      url: "https://x.pl/s.pdf",
      visibility: "organizers",
      sessionId: null,
    });
    const material = {
      id: "m1",
      kind: "video" as const,
      titlePl: "N",
      titleEn: "V",
      url: "https://v",
      visibility: "public" as const,
      isPublished: true,
      submissionId: null,
      sessionId: "ses1",
    };
    const fromSaved = speakerMaterialDraftFrom(material);
    expect(fromSaved).toEqual({
      id: "m1",
      kind: "video",
      titlePl: "N",
      titleEn: "V",
      url: "https://v",
      visibility: "public",
      sessionId: "ses1",
    });
    expect(speakerMaterialPayload("k", fromSaved)).toMatchObject({ id: "m1", sessionId: "ses1" });
    expect(speakerMaterialDraftFrom({ ...material, sessionId: null }).sessionId).toBe("");
  });
});
