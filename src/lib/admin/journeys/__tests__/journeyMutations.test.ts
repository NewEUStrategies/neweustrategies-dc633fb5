// Mutatory ścieżek (S8) - hooki nad zapisami S5.
//
// CO TEN PLIK DOWODZI.
//   1. Pusta ścieżka = `createJourney` + OD RAZU `saveJourneyDraft` pustego
//      grafu z wyzwalaczem, tokenem z utworzenia; nieudany drugi zapis nie
//      gubi ścieżki (`draftSaved: false`).
//   2. `ok:false` nie rzuca i nie unieważnia niczego; sukces unieważnia
//      wyłącznie klucze `journeyKeys` dotknięte zapisem.
//   3. Zapis szkicu wpisuje nowy token do cache szczegółu ZAMIAST go
//      unieważniać (autozapis nie refetchuje w trakcie pisania).
//   4. Ustawienia silnika odświeżają też kartę „Retencja danych”.
//   5. Komunikat błędu: kod S5 + znany powód RPC.
import { act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  createJourney: vi.fn(),
  saveJourneyDraft: vi.fn(),
  installJourneyTemplate: vi.fn(),
  saveJourneyEmailContent: vi.fn(),
  publishJourney: vi.fn(),
  setJourneyStatus: vi.fn(),
  saveJourneySettings: vi.fn(),
  enrollJourneyTest: vi.fn(),
  skipJourneyWait: vi.fn(),
  exitJourneyEnrollment: vi.fn(),
}));

vi.mock("@/lib/journeys/journeys.functions", () => ({
  createJourney: (input: unknown) => h.createJourney(input),
  saveJourneyDraft: (input: unknown) => h.saveJourneyDraft(input),
  installJourneyTemplate: (input: unknown) => h.installJourneyTemplate(input),
  saveJourneyEmailContent: (input: unknown) => h.saveJourneyEmailContent(input),
  publishJourney: (input: unknown) => h.publishJourney(input),
  setJourneyStatus: (input: unknown) => h.setJourneyStatus(input),
  saveJourneySettings: (input: unknown) => h.saveJourneySettings(input),
  enrollJourneyTest: (input: unknown) => h.enrollJourneyTest(input),
  skipJourneyWait: (input: unknown) => h.skipJourneyWait(input),
  exitJourneyEnrollment: (input: unknown) => h.exitJourneyEnrollment(input),
}));

import {
  invalidateJourneyQueries,
  mutationErrorText,
  useCreateJourney,
  useEnrollJourneyTest,
  useExitJourneyEnrollment,
  useInstallJourneyTemplate,
  usePublishJourney,
  useSaveJourneyDraft,
  useSaveJourneyEmailContent,
  useSaveJourneySettings,
  useSetJourneyStatus,
  useSkipJourneyWait,
} from "../journeyMutations";
import type { JourneyDetailDto, JourneyDetailRead } from "../journeyEditor.functions";
import { renderHookWithQueryClient } from "@/test/renderWithQueryClient";
import { realT } from "@/test/i18nReal";
import "@/lib/i18n-admin-journeys";
import "@/lib/i18n-admin-journeys-list";
import { emptyJourneyGraph } from "@/lib/journeys/graph";
import { journeyKeys } from "@/lib/journeys/keys";
import { newsletterKeys } from "@/lib/newsletter/keys";
import { dataRetentionKeys } from "@/lib/privacy/keys";
import type { QueryClient } from "@tanstack/react-query";

const T = "11111111-1111-4111-8111-111111111111";
const J = "4cab3de7-f976-404a-b54e-c37337942b7e";
const L = "434b9215-1ddc-4b35-aaf2-84ed79898881";
const E = "c37321d8-4fb5-4c59-8b70-277e4ba45ba5";
const AT = "2026-10-20T09:57:10.333703+00:00";
const AT2 = "2026-10-20T10:00:00.000000+00:00";
const CREATED = { ok: true, data: { id: J, updatedAt: AT, status: "draft" } } as const;
const FAILURE = { ok: false, error: "duplicate", reason: "key_taken", detail: null } as const;

function invalidated(queryClient: QueryClient): unknown[][] {
  return (queryClient.invalidateQueries as unknown as ReturnType<typeof vi.fn>).mock.calls.map(
    ([filters]) => (filters as { queryKey: unknown[] }).queryKey,
  );
}

function spy(queryClient: QueryClient) {
  vi.spyOn(queryClient, "invalidateQueries");
}

beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockReset();
});

describe("useCreateJourney - pusta ścieżka z wyzwalaczem", () => {
  const input = {
    key: "powitanie",
    name: "Powitanie",
    category: "marketing" as const,
    legalBasis: null,
    description: null,
    triggerEventType: "account.registered.v1",
  };

  it("tworzy i od razu zapisuje pusty graf z wyzwalaczem, tokenem z utworzenia", async () => {
    h.createJourney.mockResolvedValue(CREATED);
    h.saveJourneyDraft.mockResolvedValue({
      ok: true,
      data: { id: J, updatedAt: AT2, status: "draft" },
    });
    const { result, queryClient } = renderHookWithQueryClient(() => useCreateJourney(T));
    spy(queryClient);
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.mutateAsync(input);
    });
    expect(h.createJourney).toHaveBeenCalledWith({
      data: {
        key: "powitanie",
        name: "Powitanie",
        category: "marketing",
        legalBasis: null,
        description: null,
      },
    });
    expect(h.saveJourneyDraft).toHaveBeenCalledWith({
      data: {
        journeyId: J,
        expectedUpdatedAt: AT,
        draft: {
          graph: emptyJourneyGraph(),
          settings: { triggerEventType: "account.registered.v1" },
        },
      },
    });
    expect(outcome).toEqual({
      ok: true,
      data: { id: J, updatedAt: AT2, status: "draft" },
      draftSaved: true,
      draftError: null,
    });
    expect(invalidated(queryClient)).toContainEqual(journeyKeys.listAll());
    expect(invalidated(queryClient)).toContainEqual(journeyKeys.engineHealth(T));
  });

  it("nieudany zapis szkicu nie gubi ścieżki", async () => {
    h.createJourney.mockResolvedValue(CREATED);
    const draftFailure = {
      ok: false,
      error: "invalid",
      reason: "draft_invalid",
      detail: "settings",
    };
    h.saveJourneyDraft.mockResolvedValue(draftFailure);
    const { result } = renderHookWithQueryClient(() => useCreateJourney(T));
    const outcome = await act(() => result.current.mutateAsync(input));
    expect(outcome).toEqual({
      ok: true,
      data: CREATED.data,
      draftSaved: false,
      draftError: draftFailure,
    });
  });

  it("zajęty klucz: wynik ok:false, bez zapisu szkicu i bez unieważnień", async () => {
    h.createJourney.mockResolvedValue(FAILURE);
    const { result, queryClient } = renderHookWithQueryClient(() => useCreateJourney(T));
    spy(queryClient);
    const outcome = await act(() => result.current.mutateAsync(input));
    expect(outcome).toEqual(FAILURE);
    expect(h.saveJourneyDraft).not.toHaveBeenCalled();
    expect(invalidated(queryClient)).toEqual([]);
  });

  it("bez wyzwalacza tylko tworzy", async () => {
    h.createJourney.mockResolvedValue(CREATED);
    const { result } = renderHookWithQueryClient(() => useCreateJourney(T));
    const outcome = await act(() =>
      result.current.mutateAsync({ ...input, triggerEventType: undefined }),
    );
    expect(outcome).toMatchObject({ ok: true, draftSaved: false });
    expect(h.saveJourneyDraft).not.toHaveBeenCalled();
  });
});

describe("szkic i treść", () => {
  function seedDetail(queryClient: QueryClient) {
    const detail: JourneyDetailRead<JourneyDetailDto> = {
      state: "ready",
      data: {
        definition: {
          id: J,
          key: "k",
          name: "Stara",
          description: "opis",
          status: "draft",
          category: "marketing",
          legalBasis: null,
          templateKey: null,
          publishedVersionId: null,
          createdAt: AT,
          updatedAt: AT,
        },
        draft: null,
        draftValid: false,
        draftRaw: {},
        draftIssue: "settings.triggerEventType",
        versions: [],
        contents: [],
        templateMatches: {},
      },
    };
    queryClient.setQueryData(journeyKeys.detail(J), detail);
  }

  it("zapis szkicu wpisuje nowy token i szkic do cache, unieważnia tylko listę", async () => {
    h.saveJourneyDraft.mockResolvedValue({
      ok: true,
      data: { id: J, updatedAt: AT2, status: "draft" },
    });
    const { result, queryClient } = renderHookWithQueryClient(() => useSaveJourneyDraft(J));
    seedDetail(queryClient);
    spy(queryClient);
    const draft = { graph: emptyJourneyGraph(), settings: { triggerEventType: "paywall.hit.v1" } };
    await act(() =>
      result.current.mutateAsync({ expectedUpdatedAt: AT, draft, name: "Nowa", description: "" }),
    );
    expect(h.saveJourneyDraft).toHaveBeenCalledWith({
      data: { journeyId: J, expectedUpdatedAt: AT, draft, name: "Nowa", description: "" },
    });
    const cached = queryClient.getQueryData<JourneyDetailRead<JourneyDetailDto>>(
      journeyKeys.detail(J),
    );
    expect(cached).toMatchObject({
      state: "ready",
      data: {
        definition: { updatedAt: AT2, name: "Nowa", description: null },
        draft,
        draftValid: true,
        draftIssue: null,
      },
    });
    expect(invalidated(queryClient)).toEqual([journeyKeys.listAll()]);
  });

  it("konflikt szkicu nie rusza cache", async () => {
    h.saveJourneyDraft.mockResolvedValue({
      ok: false,
      error: "conflict",
      reason: "conflict",
      detail: null,
    });
    const { result, queryClient } = renderHookWithQueryClient(() => useSaveJourneyDraft(J));
    seedDetail(queryClient);
    spy(queryClient);
    const outcome = await act(() =>
      result.current.mutateAsync({
        expectedUpdatedAt: AT,
        draft: { graph: emptyJourneyGraph(), settings: { triggerEventType: "paywall.hit.v1" } },
      }),
    );
    expect(outcome.ok).toBe(false);
    expect(
      queryClient.getQueryData<JourneyDetailRead<JourneyDetailDto>>(journeyKeys.detail(J)),
    ).toMatchObject({ data: { definition: { updatedAt: AT } } });
    expect(invalidated(queryClient)).toEqual([]);
  });

  it("treść maila odświeża szczegół (flaga „treść = szablon” z serwera)", async () => {
    h.saveJourneyEmailContent.mockResolvedValue({ ok: true, data: { id: "c", updatedAt: AT2 } });
    const { result, queryClient } = renderHookWithQueryClient(() =>
      useSaveJourneyEmailContent(T, J),
    );
    spy(queryClient);
    const input = {
      nodeId: "welcome",
      variant: "A",
      subjectPl: "Temat",
      subjectEn: null,
      preheaderPl: null,
      preheaderEn: null,
      doc: { version: 1, blocks: [] },
    };
    await act(() => result.current.mutateAsync(input));
    expect(h.saveJourneyEmailContent).toHaveBeenCalledWith({ data: { journeyId: J, ...input } });
    expect(invalidated(queryClient)).toContainEqual(journeyKeys.detail(J));
  });
});

describe("pozostałe mutatory - unieważnienia po sukcesie", () => {
  it("instalacja szablonu", async () => {
    h.installJourneyTemplate.mockResolvedValue(CREATED);
    const { result, queryClient } = renderHookWithQueryClient(() => useInstallJourneyTemplate(T));
    spy(queryClient);
    const input = {
      templateKey: "trial_ending" as const,
      key: "proba",
      name: "Próba",
      locale: "en" as const,
    };
    await act(() => result.current.mutateAsync(input));
    expect(h.installJourneyTemplate).toHaveBeenCalledWith({ data: input });
    expect(invalidated(queryClient)).toContainEqual(journeyKeys.listAll());
  });

  it("publikacja i status: lista, szczegół, statystyki, kontakty, zdrowie", async () => {
    h.publishJourney.mockResolvedValue({
      ok: true,
      data: { id: J, versionId: "v", version: 1, graphChecksum: "c", updatedAt: AT2 },
    });
    h.setJourneyStatus.mockResolvedValue({
      ok: true,
      data: { id: J, updatedAt: AT2, status: "paused" },
    });
    const publish = renderHookWithQueryClient(() => usePublishJourney(T, J));
    spy(publish.queryClient);
    await act(() => publish.result.current.mutateAsync({ expectedUpdatedAt: AT, mode: "drain" }));
    expect(h.publishJourney).toHaveBeenCalledWith({
      data: { journeyId: J, expectedUpdatedAt: AT, mode: "drain" },
    });
    const status = renderHookWithQueryClient(() => useSetJourneyStatus(T));
    spy(status.queryClient);
    await act(() =>
      status.result.current.mutateAsync({ journeyId: J, status: "paused", expectedUpdatedAt: AT }),
    );
    for (const qc of [publish.queryClient, status.queryClient]) {
      expect(invalidated(qc)).toEqual([
        journeyKeys.listAll(),
        journeyKeys.detail(J),
        journeyKeys.statsFor(J),
        journeyKeys.enrollmentsFor(J),
        journeyKeys.engineHealth(T),
      ]);
    }
  });

  it("ustawienia silnika: wynik do cache, ustawienia, zdrowie, karta retencji i pomiar newslettera", async () => {
    const settings = {
      enabled: true,
      marketingCapPer7d: 3,
      quietStart: "21:00",
      quietEnd: "08:00",
      timezone: "Europe/Warsaw",
      defaultTaskAssigneeId: null,
      machineOpenSeconds: 2,
      senderName: "Anna",
      replyTo: null,
      openTrackingEnabled: false,
      updatedAt: AT2,
      exists: true,
    };
    h.saveJourneySettings.mockResolvedValue({ ok: true, data: settings });
    const { result, queryClient } = renderHookWithQueryClient(() => useSaveJourneySettings(T));
    spy(queryClient);
    await act(() =>
      result.current.mutateAsync({
        patch: { open_tracking_enabled: false },
        expectedUpdatedAt: null,
      }),
    );
    expect(h.saveJourneySettings).toHaveBeenCalledWith({
      data: { patch: { open_tracking_enabled: false }, expectedUpdatedAt: null },
    });
    expect(queryClient.getQueryData(journeyKeys.settings(T))).toEqual({
      state: "ready",
      data: settings,
    });
    expect(invalidated(queryClient)).toEqual([
      journeyKeys.settings(T),
      journeyKeys.engineHealth(T),
      dataRetentionKeys.tenant(T),
      // I9d-Y2 (Z-I9c-09): przełącznik pomiaru jest wspólny ze ścieżkami
      // i kampaniami - podgląd „Poproś o zgodę na pomiar" pokazuje jego stan.
      newsletterKeys.measurementAll(),
    ]);
  });

  it("test na sobie, pominięcie czekania i wyjście kontaktu", async () => {
    h.enrollJourneyTest.mockResolvedValue({ ok: true, data: { enrollmentId: E, leadId: L } });
    h.skipJourneyWait.mockResolvedValue({ ok: true, data: { enrollmentId: E } });
    h.exitJourneyEnrollment.mockResolvedValue({ ok: true, data: { exited: true } });
    const enroll = renderHookWithQueryClient(() => useEnrollJourneyTest(T, J));
    spy(enroll.queryClient);
    await act(() => enroll.result.current.mutateAsync());
    expect(h.enrollJourneyTest).toHaveBeenCalledWith({ data: { journeyId: J } });
    expect(invalidated(enroll.queryClient)).toContainEqual(journeyKeys.forLead(L));
    const skip = renderHookWithQueryClient(() => useSkipJourneyWait(T, J));
    await act(() => skip.result.current.mutateAsync({ enrollmentId: E }));
    expect(h.skipJourneyWait).toHaveBeenCalledWith({ data: { enrollmentId: E } });
    const exit = renderHookWithQueryClient(() => useExitJourneyEnrollment(T, J));
    spy(exit.queryClient);
    await act(() => exit.result.current.mutateAsync({ enrollmentId: E, leadId: L }));
    expect(h.exitJourneyEnrollment).toHaveBeenCalledWith({ data: { enrollmentId: E } });
    expect(invalidated(exit.queryClient)).toContainEqual(journeyKeys.forLead(L));
    expect(invalidated(exit.queryClient)).toContainEqual(journeyKeys.enrollmentsFor(J));
  });

  it("wyjątek (np. brak aal2) dochodzi do komponentu", async () => {
    h.setJourneyStatus.mockRejectedValue(new Error("Forbidden: mfa_required - verify"));
    const { result } = renderHookWithQueryClient(() => useSetJourneyStatus(T));
    await expect(
      act(() =>
        result.current.mutateAsync({ journeyId: J, status: "archived", expectedUpdatedAt: null }),
      ),
    ).rejects.toThrow(/mfa_required/);
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe("invalidateJourneyQueries i komunikat błędu", () => {
  it("bez ścieżki, leada i najemcy unieważnia tylko listę", async () => {
    const { queryClient } = renderHookWithQueryClient(() => null);
    spy(queryClient);
    await invalidateJourneyQueries(queryClient, { tenantId: null });
    expect(invalidated(queryClient)).toEqual([journeyKeys.listAll()]);
  });

  it("kod S5 + znany powód RPC; nieznany powód - sam kod", () => {
    const pl = realT("pl");
    expect(mutationErrorText(pl, { error: "duplicate", reason: "key_taken" })).toBe(
      `${pl("adminJourneys.mutationError.duplicate")} ${pl("adminJourneys.common.reason.key_taken")}`,
    );
    expect(mutationErrorText(pl, { error: "invalid", reason: "cos_innego" })).toBe(
      pl("adminJourneys.mutationError.invalid"),
    );
    expect(mutationErrorText(realT("en"), { error: "conflict", reason: null })).toBe(
      realT("en")("adminJourneys.mutationError.conflict"),
    );
  });
});
