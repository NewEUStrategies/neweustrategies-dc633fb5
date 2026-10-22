// Zapytania i wspólne mutatory panelu pomiaru (I9d-Y2): klucze z fabryki
// `newsletterKeys` pod prefiksem `settings()` - istniejąca reguła szyny
// `newsletter_settings.changed.v1` (emitowana przez oznaczenie w SQL)
// odświeża stan treści zgody, podgląd prośby i treść maila w drugiej karcie;
// start prośby odświeża podgląd także po konflikcie; oznaczenie podmienia
// odczyt wynikiem.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fns = vi.hoisted(() => ({
  getCampaignMeasurement: vi.fn(),
  getNewsletterConsentMeasurement: vi.fn(),
  getNewsletterMeasurementCopy: vi.fn(),
  getNewsletterMeasurementPreview: vi.fn(),
  markNewsletterConsentMeasurement: vi.fn(),
  previewNewsletterMeasurementEmail: vi.fn(),
  requestNewsletterMeasurement: vi.fn(),
  saveNewsletterMeasurementCopy: vi.fn(),
}));
vi.mock("../measurement.functions", () => fns);

import { eventInvalidationMap } from "@/lib/realtime/eventInvalidationMap";
import type { DomainEventRow } from "@/lib/realtime/domainEvents";
import { newsletterKeys } from "@/lib/newsletter/keys";
import {
  campaignMeasurementQueryOptions,
  newsletterConsentMeasurementQueryOptions,
  newsletterMeasurementCopyQueryOptions,
  newsletterMeasurementPreviewQueryOptions,
  useMarkNewsletterConsentMeasurement,
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
    expect(newsletterConsentMeasurementQueryOptions().queryKey).toEqual(
      newsletterKeys.consentMeasurement(),
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

  it("zdarzenie `newsletter_settings.changed.v1` (oznaczenie w innej karcie) odświeża pomiar", () => {
    const rule = eventInvalidationMap["newsletter_settings.changed.v1"];
    const keys = rule(
      { tenant_id: "t1", payload: { op: "update" } } as unknown as DomainEventRow,
      {} as Parameters<typeof rule>[1],
    );
    for (const target of [
      newsletterKeys.consentMeasurement(),
      newsletterKeys.measurementPreview(),
      newsletterKeys.measurementCopy(),
    ]) {
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

  it("oznaczenie podmienia odczyt stanu treści i odświeża prefiks pomiaru", async () => {
    const data = { version: "v", fields: [] };
    fns.markNewsletterConsentMeasurement.mockResolvedValue({ ok: true, data });
    const spy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useMarkNewsletterConsentMeasurement(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ field: "policy_html_pl", marked: true });
    });
    expect(client.getQueryData(newsletterKeys.consentMeasurement())).toEqual({
      state: "ready",
      data,
    });
    expect(spy).toHaveBeenCalledWith({ queryKey: newsletterKeys.measurementAll() });
  });
});
