// Zapytania i wspólne mutatory panelu pomiaru (I9d-Y2, I9d-Y2b): klucze
// z fabryki `newsletterKeys` pod prefiksem `settings()` - istniejąca reguła
// szyny `newsletter_settings.changed.v1` odświeża podgląd prośby i treść
// maila w drugiej karcie; start prośby odświeża podgląd także po
// konflikcie. Od I9d-Y2b nie ma zapytania o stan treści zgody ani mutatora
// oznaczeń admina (wariant (b): treść zgody na newsletter nie daje pomiaru).
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fns = vi.hoisted(() => ({
  getCampaignMeasurement: vi.fn(),
  getNewsletterMeasurementCopy: vi.fn(),
  getNewsletterMeasurementPreview: vi.fn(),
  previewNewsletterMeasurementEmail: vi.fn(),
  requestNewsletterMeasurement: vi.fn(),
  saveNewsletterMeasurementCopy: vi.fn(),
}));
vi.mock("../measurement.functions", () => fns);

import { eventInvalidationMap } from "@/lib/realtime/eventInvalidationMap";
import type { DomainEventRow } from "@/lib/realtime/domainEvents";
import { newsletterKeys } from "@/lib/newsletter/keys";
import * as measurementQueries from "../measurementQueries";
import {
  campaignMeasurementQueryOptions,
  newsletterMeasurementCopyQueryOptions,
  newsletterMeasurementPreviewQueryOptions,
  useRequestNewsletterMeasurement,
} from "../measurementQueries";

let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function covered(keys: readonly (readonly unknown[])[], target: readonly unknown[]): boolean {
  return keys.some((key) => key.every((part, index) => target[index] === part));
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  for (const fn of Object.values(fns)) fn.mockReset();
});

describe("klucze i szyna", () => {
  it("klucze z fabryki; mianownik kampanii pod prefiksem kampanii, bez kampanii wyłączony", () => {
    expect(newsletterMeasurementPreviewQueryOptions().queryKey).toEqual(
      newsletterKeys.measurementPreview(),
    );
    expect(newsletterMeasurementCopyQueryOptions().queryKey).toEqual(
      newsletterKeys.measurementCopy(),
    );
    expect(campaignMeasurementQueryOptions("c1").queryKey).toEqual(
      newsletterKeys.campaignMeasurement("c1"),
    );
    expect(covered([newsletterKeys.campaignsAll()], newsletterKeys.campaignMeasurement("c1"))).toBe(
      true,
    );
    expect(campaignMeasurementQueryOptions(null).enabled).toBe(false);
  });

  it("zdarzenie `newsletter_settings.changed.v1` (zapis w innej karcie) odświeża pomiar", () => {
    const rule = eventInvalidationMap["newsletter_settings.changed.v1"];
    const keys = rule(
      { tenant_id: "t1", payload: { op: "update" } } as unknown as DomainEventRow,
      {} as Parameters<typeof rule>[1],
    );
    for (const target of [newsletterKeys.measurementPreview(), newsletterKeys.measurementCopy()]) {
      expect(covered(keys, target), target.join("/")).toBe(true);
    }
  });
});

describe("mutatory", () => {
  it("start prośby odświeża podgląd - także po konflikcie (admin potwierdza nową liczbę)", async () => {
    fns.requestNewsletterMeasurement.mockResolvedValue({
      ok: false,
      error: "conflict",
      reason: "stale_preview",
    });
    const spy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useRequestNewsletterMeasurement(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ expected: 5 });
    });
    expect(fns.requestNewsletterMeasurement).toHaveBeenCalledWith({ data: { expected: 5 } });
    expect(spy).toHaveBeenCalledWith({ queryKey: newsletterKeys.measurementPreview() });
  });

  it("bez zapytania o stan treści zgody i mutatora oznaczeń (I9d-Y2b)", () => {
    const names = Object.keys(measurementQueries);
    expect(names).not.toContain("newsletterConsentMeasurementQueryOptions");
    expect(names).not.toContain("useMarkNewsletterConsentMeasurement");
    expect(Object.keys(newsletterKeys)).not.toContain("consentMeasurement");
  });
});
