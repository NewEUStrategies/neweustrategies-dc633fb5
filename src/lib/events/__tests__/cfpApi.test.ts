// Warstwa danych naboru: NAZWY funkcji i NAZWY argumentów RPC.
//
// Obiekt argumentów jest luźny dla `tsc`, więc przemianowany klucz (`event_id`
// -> `eventId`) przechodzi kompilację i kończy się odmową bazy albo - gorzej -
// pominięciem pola w PATCH-u. Każda funkcja ma tu przypadek, który czyta
// argumenty PO NAZWIE, oraz przypadek odmowy (błąd bazy wychodzi jako `Error`).
import { beforeEach, describe, expect, it, vi } from "vitest";

import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";

const h = vi.hoisted(() => ({ rpc: null as SupabaseRpcStub | null }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args?: Record<string, unknown>) => {
      if (h.rpc === null) throw new Error("test: brak atrapy RPC");
      return h.rpc.rpc(name, args);
    },
  },
}));

const api = await import("@/lib/events/cfpApi");
const pub = await import("@/lib/events/cfpPublicApi");

function stub(): SupabaseRpcStub {
  if (h.rpc === null) throw new Error("test");
  return h.rpc;
}

function payloadOf(name: string): Record<string, unknown> {
  const value = stub().lastCall(name)?.arg("p_payload");
  if (typeof value !== "object" || value === null) throw new Error(`test: brak p_payload w ${name}`);
  return value as Record<string, unknown>;
}

beforeEach(() => {
  h.rpc = supabaseRpcStub();
});

describe("cfpPayload", () => {
  it("klucze `undefined` odpadają, jawne `null` zostaje", () => {
    expect(api.cfpPayload({ a: 1, b: undefined, c: null })).toEqual({ a: 1, c: null });
  });
});

describe("panel: ustawienia i pytania", () => {
  it("odczyt i zapis ustawień (PATCH po obecności klucza)", async () => {
    stub().setData("admin_event_cfp_settings_get", { status: "open" });
    expect((await api.fetchCfpSettings("e1")).status).toBe("open");
    expect(stub().lastCall("admin_event_cfp_settings_get")?.arg("p_event_id")).toBe("e1");

    stub().setData("admin_event_cfp_settings_save", { status: "closed" });
    const saved = await api.saveCfpSettings({
      eventId: "e1",
      status: "closed",
      opensAt: null,
      trackIds: ["t1"],
      speakerGroupId: null,
    });
    expect(saved.status).toBe("closed");
    expect(payloadOf("admin_event_cfp_settings_save")).toEqual({
      event_id: "e1",
      status: "closed",
      opens_at: null,
      track_ids: ["t1"],
      speaker_group_id: null,
    });

    const full = {
      eventId: "e1",
      status: "open" as const,
      opensAt: "a",
      closesAt: "b",
      introPl: "ip",
      introEn: "ie",
      guidelinesPl: "gp",
      guidelinesEn: "ge",
      formats: [{ key: "k", label_pl: "p", label_en: "e", duration_min: 30 }],
      trackIds: [],
      maxPerSubmitter: 2,
      allowCoSpeakers: true,
      reviewBlind: false,
      scoreMax: 5,
      reviewCriteria: [{ key: "c", label_pl: "p", label_en: "e", weight: 1 }],
      minReviews: 1,
      speakerGroupId: "g",
      speakerTicketTypeId: "t",
    };
    await api.saveCfpSettings(full);
    expect(Object.keys(payloadOf("admin_event_cfp_settings_save")).sort()).toEqual(
      [
        "event_id",
        "status",
        "opens_at",
        "closes_at",
        "intro_pl",
        "intro_en",
        "guidelines_pl",
        "guidelines_en",
        "formats",
        "track_ids",
        "max_per_submitter",
        "allow_co_speakers",
        "review_blind",
        "score_max",
        "review_criteria",
        "min_reviews",
        "speaker_group_id",
        "speaker_ticket_type_id",
      ].sort(),
    );
  });

  it("pytania: lista, zapis, usunięcie i kolejność", async () => {
    stub().setData("admin_event_cfp_fields_list", [{ id: "f1" }]);
    expect(await api.fetchCfpFields("e1")).toEqual([{ id: "f1" }]);
    stub().setData("admin_event_cfp_fields_list", null);
    expect(await api.fetchCfpFields("e1")).toEqual([]);

    stub().setData("admin_event_cfp_field_upsert", "f9");
    const id = await api.saveCfpField({
      eventId: "e1",
      key: "exp",
      fieldType: "text",
      labelPl: "P",
      labelEn: "E",
      helpPl: "",
      helpEn: "",
      isRequired: false,
      isActive: true,
      options: [],
    });
    expect(id).toBe("f9");
    expect(payloadOf("admin_event_cfp_field_upsert")).toMatchObject({
      event_id: "e1",
      key: "exp",
      field_type: "text",
      label_pl: "P",
      is_required: false,
      is_active: true,
      options: [],
    });
    expect(payloadOf("admin_event_cfp_field_upsert")).not.toHaveProperty("id");

    stub().setData("admin_event_cfp_field_delete", true);
    await api.deleteCfpField("f1");
    expect(stub().lastCall("admin_event_cfp_field_delete")?.arg("p_field_id")).toBe("f1");

    stub().setData("admin_event_cfp_fields_reorder", 2);
    await api.reorderCfpFields("e1", ["b", "a"]);
    expect(payloadOf("admin_event_cfp_fields_reorder")).toEqual({ event_id: "e1", ids: ["b", "a"] });
  });
});

describe("panel: zgłoszenia", () => {
  it("lista: filtry „wszystkie” nie wychodzą, strona -> offset, total z okna", async () => {
    stub().setData("admin_event_cfp_submissions_list", [{ id: "s1", total_count: 41 }]);
    const page = await api.fetchCfpSubmissions({
      eventId: "e1",
      status: "all",
      trackId: "all",
      q: "  ",
      sort: "recent",
      page: 2,
      pageSize: 20,
    });
    expect(page.total).toBe(41);
    expect(payloadOf("admin_event_cfp_submissions_list")).toEqual({
      event_id: "e1",
      sort: "recent",
      limit: 20,
      offset: 40,
    });
    stub().setData("admin_event_cfp_submissions_list", null);
    const empty = await api.fetchCfpSubmissions({
      eventId: "e1",
      status: "accepted",
      trackId: "t1",
      q: " energia ",
      sort: "score",
      page: 0,
      pageSize: 25,
    });
    expect(empty).toEqual({ rows: [], total: 0 });
    expect(payloadOf("admin_event_cfp_submissions_list")).toMatchObject({
      status: "accepted",
      track_id: "t1",
      q: "energia",
      sort: "score",
    });
  });

  it("liczniki, szczegół, decyzja i ponowienie CRM", async () => {
    stub().setData("admin_event_cfp_submissions_counts", { total: 3 });
    expect((await api.fetchCfpCounts("e1")).total).toBe(3);

    stub().setData("admin_event_cfp_submission_detail", { submission: { id: "s1" } });
    expect((await api.fetchCfpSubmissionDetail("s1")).id).toBe("s1");
    expect(stub().lastCall("admin_event_cfp_submission_detail")?.arg("p_submission_id")).toBe("s1");

    stub().setData("admin_event_cfp_submission_decide", {});
    await api.decideCfpSubmission({ id: "s1", status: "rejected", decisionNote: "n" });
    expect(payloadOf("admin_event_cfp_submission_decide")).toEqual({
      id: "s1",
      status: "rejected",
      decision_note: "n",
    });

    stub().setData("admin_event_person_crm_retry", {});
    await api.retryCfpPersonCrm("p1");
    expect(stub().lastCall("admin_event_person_crm_retry")?.arg("p_person_id")).toBe("p1");
  });

  it("przyjęcie z planem i bez planu", async () => {
    stub().setData("admin_event_cfp_submission_accept", { id: "s1", speakers_enrolled: 2 });
    const result = await api.acceptCfpSubmission({ id: "s1", register: true, schedule: null });
    expect(result.speakersEnrolled).toBe(2);
    expect(payloadOf("admin_event_cfp_submission_accept")).toEqual({ id: "s1", register: true });

    await api.acceptCfpSubmission({
      id: "s1",
      decisionNote: "n",
      feedbackToSpeaker: "f",
      register: false,
      schedule: { startsAt: "a", endsAt: "b", roomId: null, trackId: "t1", format: "online" },
    });
    expect(payloadOf("admin_event_cfp_submission_accept")).toEqual({
      id: "s1",
      decision_note: "n",
      feedback_to_speaker: "f",
      register: false,
      schedule: { starts_at: "a", ends_at: "b", room_id: null, track_id: "t1", format: "online" },
    });
  });
});

describe("panel: recenzenci i materiały", () => {
  it("recenzenci", async () => {
    stub().setData("admin_event_cfp_reviewers_list", [{ id: "r1" }]);
    expect(await api.fetchCfpReviewers("e1")).toEqual([{ id: "r1" }]);
    stub().setData("admin_event_cfp_reviewers_list", null);
    expect(await api.fetchCfpReviewers("e1")).toEqual([]);

    stub().setData("admin_event_cfp_reviewer_set", "r2");
    expect(await api.setCfpReviewer({ eventId: "e1", userId: "u1", isActive: true })).toBe("r2");
    expect(payloadOf("admin_event_cfp_reviewer_set")).toEqual({ event_id: "e1", user_id: "u1", is_active: true });

    stub().setData("admin_event_cfp_reviewer_remove", "deleted");
    expect(await api.removeCfpReviewer("r1")).toBe("deleted");
    stub().setData("admin_event_cfp_reviewer_remove", "deactivated");
    expect(await api.removeCfpReviewer("r1")).toBe("deactivated");
    expect(stub().lastCall("admin_event_cfp_reviewer_remove")?.arg("p_reviewer_id")).toBe("r1");
  });

  it("materiały", async () => {
    stub().setData("admin_event_cfp_materials_list", [{ id: "m1" }]);
    expect(await api.fetchCfpMaterials("e1")).toEqual([{ id: "m1" }]);
    stub().setData("admin_event_cfp_materials_list", null);
    expect(await api.fetchCfpMaterials("e1")).toEqual([]);
    stub().setData("admin_event_cfp_material_publish", true);
    await api.publishCfpMaterial("m1", false);
    expect(payloadOf("admin_event_cfp_material_publish")).toEqual({ id: "m1", is_published: false });
  });

  it("odmowa bazy wychodzi jako Error z komunikatem plpgsql", async () => {
    stub().setError("admin_event_cfp_settings_get", "forbidden: nope");
    await expect(api.fetchCfpSettings("e1")).rejects.toThrow("forbidden: nope");
  });
});

describe("strona publiczna, prelegent i recenzent", () => {
  it("strona naboru i zapis szkicu", async () => {
    stub().setData("event_cfp_public", { phase: "open" });
    expect((await pub.fetchCfpPublic("kongres"))?.phase).toBe("open");
    expect(stub().lastCall("event_cfp_public")?.arg("p_slug")).toBe("kongres");

    stub().setData("event_cfp_submission_save", { id: "s1", status: "draft" });
    const result = await pub.saveCfpSubmission({
      slug: "kongres",
      speaker: { first_name: "A", last_name: "B", job_title: "", company_text: "", consent_marketing: false },
      titlePl: "T",
      formatKey: null,
      coSpeakers: [],
    });
    expect(result).toEqual({ id: "s1", status: "draft" });
    expect(payloadOf("event_cfp_submission_save")).toEqual({
      slug: "kongres",
      speaker: { first_name: "A", last_name: "B", job_title: "", company_text: "", consent_marketing: false },
      title_pl: "T",
      format_key: null,
      co_speakers: [],
    });
  });

  it("wysłanie, wycofanie, odpowiedź, moje zgłoszenia i panel", async () => {
    stub().setData("event_cfp_submission_submit", { id: "s1", status: "submitted" });
    expect((await pub.submitCfpSubmission("s1")).status).toBe("submitted");
    expect(payloadOf("event_cfp_submission_submit")).toEqual({ id: "s1" });

    stub().setData("event_cfp_submission_withdraw", { id: "s1", status: "deleted" });
    expect((await pub.withdrawCfpSubmission("s1")).status).toBe("deleted");

    stub().setData("event_cfp_submission_respond", { id: "s1", status: "confirmed" });
    expect((await pub.respondCfpSubmission("s1", true)).status).toBe("confirmed");
    expect(payloadOf("event_cfp_submission_respond")).toEqual({ id: "s1", confirm: true });

    stub().setData("event_my_cfp_submissions", { items: [] });
    expect((await pub.fetchMyCfpSubmissions("kongres"))?.items).toEqual([]);

    stub().setData("event_my_speaker_panel", null);
    expect(await pub.fetchSpeakerPanel("kongres")).toBeNull();
  });

  it("profil i materiały prelegenta", async () => {
    stub().setData("event_my_speaker_profile_set", {});
    await pub.saveSpeakerProfile({
      slug: "kongres",
      headlinePl: "H",
      headlineEn: "",
      bioPl: "",
      bioEn: "",
      topicsPl: ["a"],
      topicsEn: [],
      languages: ["pl"],
      cardPhotoUrl: "",
    });
    expect(payloadOf("event_my_speaker_profile_set")).toEqual({
      slug: "kongres",
      headline_pl: "H",
      headline_en: "",
      bio_pl: "",
      bio_en: "",
      topics_pl: ["a"],
      topics_en: [],
      languages: ["pl"],
      card_photo_url: "",
    });

    stub().setData("event_my_speaker_material_upsert", "m1");
    expect(
      await pub.saveSpeakerMaterial({
        slug: "kongres",
        kind: "slides",
        titlePl: "S",
        titleEn: "",
        url: "https://x",
        visibility: "public",
        sessionId: null,
      }),
    ).toBe("m1");
    expect(payloadOf("event_my_speaker_material_upsert")).toEqual({
      slug: "kongres",
      kind: "slides",
      title_pl: "S",
      title_en: "",
      url: "https://x",
      visibility: "public",
      session_id: null,
    });

    stub().setData("event_my_speaker_material_delete", true);
    await pub.deleteSpeakerMaterial("m1");
    expect(stub().lastCall("event_my_speaker_material_delete")?.arg("p_material_id")).toBe("m1");
  });

  it("kolejka, szczegół i zapis oceny", async () => {
    stub().setData("event_cfp_review_queue", { items: [] });
    expect((await pub.fetchCfpReviewQueue("kongres"))?.items).toEqual([]);

    stub().setData("event_cfp_review_get", { submission: { id: "s1" } });
    expect((await pub.fetchCfpReview("s1")).submission.id).toBe("s1");
    expect(stub().lastCall("event_cfp_review_get")?.arg("p_submission_id")).toBe("s1");

    stub().setData("event_cfp_review_save", { id: "r1" });
    await pub.saveCfpReview({
      submissionId: "s1",
      scores: { rel: 4 },
      overall: 4,
      recommendation: null,
      commentPrivate: "",
      commentToSpeaker: "",
      conflictOfInterest: false,
    });
    expect(payloadOf("event_cfp_review_save")).toEqual({
      submission_id: "s1",
      scores: { rel: 4 },
      overall: 4,
      recommendation: null,
      comment_private: "",
      comment_to_speaker: "",
      conflict_of_interest: false,
    });
  });

  it("odmowa bazy wychodzi jako Error", async () => {
    stub().setError("event_cfp_submission_submit", "missing_title: x");
    await expect(pub.submitCfpSubmission("s1")).rejects.toThrow("missing_title: x");
  });
});
