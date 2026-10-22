// Zapytania i wspólne mutatory wygaszania (I9d-Y1): klucze z fabryki pod
// prefiksem najemcy (ta sama inwalidacja co szyna `data_retention.changed.v1`),
// mutator wykluczenia odświeża cały prefiks, zapis treści podmienia odczyt
// nowym tokenem CAS.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fns = vi.hoisted(() => ({
  getDataRetentionNewsletterDue: vi.fn(),
  getNewsletterSunsetCopy: vi.fn(),
  excludeNewsletterSubscriber: vi.fn(),
  includeNewsletterSubscriber: vi.fn(),
  saveNewsletterSunsetCopy: vi.fn(),
  previewNewsletterSunsetEmail: vi.fn(),
}));
vi.mock("../newsletterSunset.functions", () => fns);

import { dataRetentionKeys } from "../keys";
import { NEWSLETTER_SUNSET_EMPTY_OVERRIDES } from "../newsletterSunset";
import {
  dataRetentionNewsletterDueQueryOptions,
  newsletterSunsetCopyQueryOptions,
  useExcludeNewsletterSubscriber,
  useSaveNewsletterSunsetCopy,
} from "../newsletterSunsetQueries";

const TENANT = "t1";
let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  for (const fn of Object.values(fns)) fn.mockReset();
});

describe("zapytania wygaszania", () => {
  it("klucze z fabryki pod prefiksem najemcy; bez najemcy zapytanie wyłączone", () => {
    expect(dataRetentionNewsletterDueQueryOptions(TENANT).queryKey).toEqual(
      dataRetentionKeys.newsletterDue(TENANT),
    );
    expect(newsletterSunsetCopyQueryOptions(TENANT).queryKey).toEqual(
      dataRetentionKeys.newsletterCopy(TENANT),
    );
    expect(dataRetentionNewsletterDueQueryOptions(null).enabled).toBe(false);
  });

  it("wykluczenie odświeża cały prefiks najemcy (lista, podgląd, kategorie)", async () => {
    fns.excludeNewsletterSubscriber.mockResolvedValue({
      ok: true,
      data: { subscriberId: "s", excluded: true, cycleCancelled: false },
    });
    const spy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useExcludeNewsletterSubscriber(TENANT), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ subscriberId: "s", reason: "Partner" });
    });
    expect(fns.excludeNewsletterSubscriber).toHaveBeenCalledWith({
      data: { subscriberId: "s", reason: "Partner" },
    });
    expect(spy).toHaveBeenCalledWith({ queryKey: dataRetentionKeys.tenant(TENANT) });
  });

  it("zapis treści: udany zapis od razu podmienia odczyt (nowy token CAS)", async () => {
    const data = {
      overrides: NEWSLETTER_SUNSET_EMPTY_OVERRIDES,
      updatedAt: "2026-10-22T08:00:00Z",
    };
    fns.saveNewsletterSunsetCopy.mockResolvedValue({ ok: true, data });
    fns.getNewsletterSunsetCopy.mockResolvedValue({ state: "ready", data });
    const { result } = renderHook(() => useSaveNewsletterSunsetCopy(TENANT), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        overrides: NEWSLETTER_SUNSET_EMPTY_OVERRIDES,
        expectedUpdatedAt: null,
      });
    });
    expect(client.getQueryData(dataRetentionKeys.newsletterCopy(TENANT))).toEqual({
      state: "ready",
      data,
    });
  });

  it("konflikt zapisu nie nadpisuje odczytu", async () => {
    fns.saveNewsletterSunsetCopy.mockResolvedValue({
      ok: false,
      error: "conflict",
      reason: "stale_write",
    });
    const { result } = renderHook(() => useSaveNewsletterSunsetCopy(TENANT), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        overrides: NEWSLETTER_SUNSET_EMPTY_OVERRIDES,
        expectedUpdatedAt: "2026-10-22T08:00:00Z",
      });
    });
    expect(client.getQueryData(dataRetentionKeys.newsletterCopy(TENANT))).toBeUndefined();
  });
});
