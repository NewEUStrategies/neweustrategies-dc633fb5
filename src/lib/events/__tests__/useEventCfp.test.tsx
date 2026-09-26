// Hooki naboru: klucze cache, wyłączanie zapytań i ZASIĘG unieważnień.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW - pilnowane niżej:
// Najważniejsze zobowiązania: (1) każda mutacja panelu unieważnia CAŁĄ gałąź
// `["event-cfp", eventId]` (a przyjęcie także agendę, zapisy i rejestr
// prelegentów tego wydarzenia); (2) mutacje uczestnika unieważniają jego gałąź
// `["event-cfp-me", slug]`; (3) zapytanie bez identyfikatora nie startuje.
import { waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderHookWithQueryClient } from "@/test/renderWithQueryClient";

const api = vi.hoisted(() => ({
  fetchCfpSettings: vi.fn(async () => ({ status: "open" })),
  saveCfpSettings: vi.fn(async () => ({ status: "closed" })),
  fetchCfpFields: vi.fn(async () => [{ id: "f1" }]),
  saveCfpField: vi.fn(async () => "f1"),
  deleteCfpField: vi.fn(async () => undefined),
  reorderCfpFields: vi.fn(async () => undefined),
  fetchCfpSubmissions: vi.fn(async () => ({ rows: [], total: 0 })),
  fetchCfpCounts: vi.fn(async () => ({ total: 1 })),
  fetchCfpSubmissionDetail: vi.fn(async () => ({ id: "s1" })),
  decideCfpSubmission: vi.fn(async () => undefined),
  acceptCfpSubmission: vi.fn(async () => ({ id: "s1" })),
  retryCfpPersonCrm: vi.fn(async () => undefined),
  fetchCfpReviewers: vi.fn(async () => []),
  setCfpReviewer: vi.fn(async () => "r1"),
  removeCfpReviewer: vi.fn(async () => "deleted"),
  fetchCfpMaterials: vi.fn(async () => []),
  publishCfpMaterial: vi.fn(async () => undefined),
}));

const pub = vi.hoisted(() => ({
  fetchCfpPublic: vi.fn(async () => ({ phase: "open" })),
  fetchMyCfpSubmissions: vi.fn(async () => ({ items: [] })),
  fetchSpeakerPanel: vi.fn(async () => null),
  fetchCfpReviewQueue: vi.fn(async () => ({ items: [] })),
  fetchCfpReview: vi.fn(async () => ({ submission: { id: "s1" } })),
  saveCfpSubmission: vi.fn(async () => ({ id: "s1", status: "draft" })),
  submitCfpSubmission: vi.fn(async () => ({ id: "s1", status: "submitted" })),
  withdrawCfpSubmission: vi.fn(async () => ({ id: "s1", status: "withdrawn" })),
  respondCfpSubmission: vi.fn(async () => ({ id: "s1", status: "confirmed" })),
  saveSpeakerProfile: vi.fn(async () => undefined),
  saveSpeakerMaterial: vi.fn(async () => "m1"),
  deleteSpeakerMaterial: vi.fn(async () => undefined),
  saveCfpReview: vi.fn(async () => undefined),
}));

vi.mock("@/lib/events/cfpApi", () => api);
vi.mock("@/lib/events/cfpPublicApi", () => pub);

const admin = await import("@/lib/events/useEventCfp");
const me = await import("@/lib/events/useCfpMe");

const QUERY = {
  eventId: "e1",
  status: "all" as const,
  trackId: "all",
  q: " x ",
  sort: "recent" as const,
  page: 0,
  pageSize: 25,
};

beforeEach(() => {
  for (const fn of [...Object.values(api), ...Object.values(pub)]) fn.mockClear();
});

describe("cfpKeys / cfpMeKeys", () => {
  it("wszystkie klucze panelu leżą pod gałęzią wydarzenia", () => {
    const branch = admin.cfpKeys.event("e1");
    for (const key of [
      admin.cfpKeys.settings("e1"),
      admin.cfpKeys.fields("e1"),
      admin.cfpKeys.submissions(QUERY),
      admin.cfpKeys.counts("e1"),
      admin.cfpKeys.detail("e1", "s1"),
      admin.cfpKeys.reviewers("e1"),
      admin.cfpKeys.materials("e1"),
    ]) {
      expect(key.slice(0, branch.length)).toEqual([...branch]);
    }
    // Fraza z samymi spacjami to ten sam wpis cache, co fraza przycięta.
    expect(admin.cfpKeys.submissions(QUERY)[3]).toMatchObject({ q: "x" });
  });

  it("klucze uczestnika leżą pod gałęzią sluga", () => {
    const branch = me.cfpMeKeys.slug("kongres");
    for (const key of [
      me.cfpMeKeys.submissions("kongres"),
      me.cfpMeKeys.panel("kongres"),
      me.cfpMeKeys.queue("kongres"),
      me.cfpMeKeys.review("kongres", "s1"),
    ]) {
      expect(key.slice(0, branch.length)).toEqual([...branch]);
    }
    expect(me.cfpPublicKeys.slug("kongres")).toEqual(["event-cfp-public", "kongres"]);
  });
});

describe("zapytania panelu", () => {
  it("czytają dane i nie startują bez wydarzenia", async () => {
    const settings = renderHookWithQueryClient(() => admin.useCfpSettings("e1"));
    await waitFor(() => expect(settings.result.current.data).toEqual({ status: "open" }));
    const fields = renderHookWithQueryClient(() => admin.useCfpFields("e1"));
    await waitFor(() => expect(fields.result.current.data).toEqual([{ id: "f1" }]));
    const list = renderHookWithQueryClient(() => admin.useCfpSubmissions(QUERY));
    await waitFor(() => expect(list.result.current.data).toEqual({ rows: [], total: 0 }));
    const counts = renderHookWithQueryClient(() => admin.useCfpCounts("e1"));
    await waitFor(() => expect(counts.result.current.data).toEqual({ total: 1 }));
    const detail = renderHookWithQueryClient(() => admin.useCfpSubmissionDetail("e1", "s1"));
    await waitFor(() => expect(detail.result.current.data).toEqual({ id: "s1" }));
    const reviewers = renderHookWithQueryClient(() => admin.useCfpReviewers("e1"));
    await waitFor(() => expect(reviewers.result.current.data).toEqual([]));
    const materials = renderHookWithQueryClient(() => admin.useCfpMaterials("e1"));
    await waitFor(() => expect(materials.result.current.data).toEqual([]));

    renderHookWithQueryClient(() => admin.useCfpSettings(""));
    renderHookWithQueryClient(() => admin.useCfpFields(""));
    renderHookWithQueryClient(() => admin.useCfpSubmissions({ ...QUERY, eventId: "" }));
    renderHookWithQueryClient(() => admin.useCfpCounts(""));
    renderHookWithQueryClient(() => admin.useCfpSubmissionDetail("e1", null));
    renderHookWithQueryClient(() => admin.useCfpReviewers(""));
    renderHookWithQueryClient(() => admin.useCfpMaterials(""));
    expect(api.fetchCfpSettings).toHaveBeenCalledTimes(1);
    expect(api.fetchCfpFields).toHaveBeenCalledTimes(1);
    expect(api.fetchCfpSubmissions).toHaveBeenCalledTimes(1);
    expect(api.fetchCfpCounts).toHaveBeenCalledTimes(1);
    expect(api.fetchCfpSubmissionDetail).toHaveBeenCalledTimes(1);
    expect(api.fetchCfpReviewers).toHaveBeenCalledTimes(1);
    expect(api.fetchCfpMaterials).toHaveBeenCalledTimes(1);
  });
});

describe("mutacje panelu", () => {
  it("zapis ustawień wpisuje odpowiedź do cache i unieważnia gałąź", async () => {
    const { result, queryClient } = renderHookWithQueryClient(() => admin.useSaveCfpSettings("e1"));
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await result.current.mutateAsync({ eventId: "e1" });
    expect(queryClient.getQueryData(admin.cfpKeys.settings("e1"))).toEqual({ status: "closed" });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: admin.cfpKeys.event("e1") });
  });

  it.each([
    ["useSaveCfpField", "saveCfpField", { labelPl: "x" }],
    ["useDeleteCfpField", "deleteCfpField", "f1"],
    ["useDecideCfpSubmission", "decideCfpSubmission", { id: "s1", status: "waitlisted" }],
    ["useRetryCfpCrm", "retryCfpPersonCrm", "p1"],
    ["useSetCfpReviewer", "setCfpReviewer", { eventId: "e1", userId: "u1" }],
    ["useRemoveCfpReviewer", "removeCfpReviewer", "r1"],
  ] as const)("%s woła %s i unieważnia gałąź wydarzenia", async (hook, fn, input) => {
    const useHook = admin[hook] as (eventId: string) => {
      mutateAsync: (input: unknown) => Promise<unknown>;
    };
    const { result, queryClient } = renderHookWithQueryClient(() => useHook("e1"));
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await result.current.mutateAsync(input);
    expect(api[fn].mock.calls[0]?.[0 as number]).toEqual(input);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: admin.cfpKeys.event("e1") });
  });

  it("kolejność pytań i publikacja materiału przekazują argumenty", async () => {
    const reorder = renderHookWithQueryClient(() => admin.useReorderCfpFields("e1"));
    await reorder.result.current.mutateAsync(["b", "a"]);
    expect(api.reorderCfpFields).toHaveBeenCalledWith("e1", ["b", "a"]);
    const publish = renderHookWithQueryClient(() => admin.usePublishCfpMaterial("e1"));
    await publish.result.current.mutateAsync({ id: "m1", isPublished: true });
    expect(api.publishCfpMaterial).toHaveBeenCalledWith("m1", true);
  });

  it("przyjęcie unieważnia także agendę, zapisy i rejestr prelegentów wydarzenia", async () => {
    const { result, queryClient } = renderHookWithQueryClient(() =>
      admin.useAcceptCfpSubmission("e1"),
    );
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await result.current.mutateAsync({ id: "s1", register: true, schedule: null });
    const keys = invalidate.mock.calls.map((call) => call[0]?.queryKey);
    expect(keys).toContainEqual(admin.cfpKeys.event("e1"));
    expect(keys).toContainEqual(["admin-event-speakers", "e1"]);
    expect(keys).toContainEqual(["admin", "event", "e1", "speakers"]);
    expect(keys.length).toBe(5);
  });
});

describe("zapytania i mutacje uczestnika", () => {
  it("strona naboru: wyłączona do montażu i bez sluga", async () => {
    renderHookWithQueryClient(() => me.useCfpPublic("kongres", false));
    renderHookWithQueryClient(() => me.useCfpPublic(""));
    expect(pub.fetchCfpPublic).not.toHaveBeenCalled();
    const { result } = renderHookWithQueryClient(() => me.useCfpPublic("kongres"));
    await waitFor(() => expect(result.current.data).toEqual({ phase: "open" }));
  });

  it("dane osobiste startują tylko z sesją", async () => {
    renderHookWithQueryClient(() => me.useMyCfpSubmissions("kongres", false));
    renderHookWithQueryClient(() => me.useSpeakerPanel("kongres", false));
    renderHookWithQueryClient(() => me.useCfpReviewQueue("kongres", false));
    renderHookWithQueryClient(() => me.useCfpReview("kongres", null));
    expect(pub.fetchMyCfpSubmissions).not.toHaveBeenCalled();
    expect(pub.fetchSpeakerPanel).not.toHaveBeenCalled();
    expect(pub.fetchCfpReviewQueue).not.toHaveBeenCalled();
    expect(pub.fetchCfpReview).not.toHaveBeenCalled();

    const mine = renderHookWithQueryClient(() => me.useMyCfpSubmissions("kongres", true));
    await waitFor(() => expect(mine.result.current.data).toEqual({ items: [] }));
    const panel = renderHookWithQueryClient(() => me.useSpeakerPanel("kongres", true));
    await waitFor(() => expect(panel.result.current.isSuccess).toBe(true));
    const queue = renderHookWithQueryClient(() => me.useCfpReviewQueue("kongres", true));
    await waitFor(() => expect(queue.result.current.data).toEqual({ items: [] }));
    const review = renderHookWithQueryClient(() => me.useCfpReview("kongres", "s1"));
    await waitFor(() => expect(review.result.current.data).toEqual({ submission: { id: "s1" } }));
    expect(pub.fetchCfpReview).toHaveBeenCalledWith("s1");
  });

  it.each([
    ["useSaveCfpSubmission", "saveCfpSubmission", { slug: "kongres" }],
    ["useSubmitCfpSubmission", "submitCfpSubmission", "s1"],
    ["useWithdrawCfpSubmission", "withdrawCfpSubmission", "s1"],
    ["useSaveSpeakerProfile", "saveSpeakerProfile", { slug: "kongres" }],
    ["useSaveSpeakerMaterial", "saveSpeakerMaterial", { slug: "kongres" }],
    ["useDeleteSpeakerMaterial", "deleteSpeakerMaterial", "m1"],
    ["useSaveCfpReview", "saveCfpReview", { submissionId: "s1" }],
  ] as const)("%s woła %s i unieważnia gałąź sluga", async (hook, fn, input) => {
    const useHook = me[hook] as (slug: string) => {
      mutateAsync: (input: unknown) => Promise<unknown>;
    };
    const { result, queryClient } = renderHookWithQueryClient(() => useHook("kongres"));
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await result.current.mutateAsync(input);
    expect(pub[fn].mock.calls[0]?.[0 as number]).toEqual(input);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: me.cfpMeKeys.slug("kongres") });
  });

  it("odpowiedź na przyjęcie rozkłada argumenty", async () => {
    const { result } = renderHookWithQueryClient(() => me.useRespondCfpSubmission("kongres"));
    await result.current.mutateAsync({ id: "s1", confirm: false });
    expect(pub.respondCfpSubmission).toHaveBeenCalledWith("s1", false);
  });
});
