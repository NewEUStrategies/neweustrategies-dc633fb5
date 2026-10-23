// Funkcje serwerowe panelu pomiaru (I9d-Y2, I9d-Y2b) - handler przez atrapę
// `createServerFn` (prawdziwy kod handlera, kontekst sesji wstrzyknięty).
// Dowody: role z dokładnych bramek (prośba - admin; mianownik -
// admin/redaktor), literalne nazwy RPC, najemca NIGDY z ładunku (schematy
// ścisłe), mapowanie kodów SQL na stany panelu. Od I9d-Y2b moduł NIE ma
// funkcji oznaczeń admina „mój tekst obejmuje pomiar" (RPC usunięte
// migracją 20261023090000 - wywołanie skończyłoby się błędem bramki
// `rpcContract` i 404 w bazie).
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ok, supabaseFromStub } from "@/test/supabaseChain";
import { resetServerFnContext, serverFnMeta, setServerFnContext } from "@/test/serverFn";

vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/serverFn")).serverFnModuleMock(),
);

import { requireAdmin, requireAdminEditor } from "@/integrations/supabase/require-staff";
import { NEWSLETTER_MEASUREMENT_EMPTY_OVERRIDES } from "../measurementReconfirm";
import * as measurementFunctions from "../measurement.functions";
import {
  getCampaignMeasurement,
  getNewsletterMeasurementCopy,
  getNewsletterMeasurementPreview,
  previewNewsletterMeasurementEmail,
  requestNewsletterMeasurement,
  saveNewsletterMeasurementCopy,
} from "../measurement.functions";

const TENANT = "19d40000-0000-4000-8000-0000000000a0";
const USER = "0a000000-0000-4000-8000-000000000001";
const CAMPAIGN = "11111111-2222-4333-8444-555555555555";
const STAMP = "2026-10-22T08:00:00.123456+00:00";

const db = supabaseFromStub();
const rpc = vi.fn();

beforeEach(() => {
  db.reset();
  rpc.mockReset();
  resetServerFnContext();
  setServerFnContext({ supabase: { from: db.from, rpc }, userId: USER });
  db.setResponse("profiles", ok({ tenant_id: TENANT }));
  db.setResponse("tenants", ok({ domain: "think.example" }));
});

describe("obudowa: role z dokładnych bramek SQL", () => {
  it.each([
    ["getNewsletterMeasurementPreview", getNewsletterMeasurementPreview, requireAdmin],
    ["requestNewsletterMeasurement", requestNewsletterMeasurement, requireAdmin],
    ["getNewsletterMeasurementCopy", getNewsletterMeasurementCopy, requireAdmin],
    ["saveNewsletterMeasurementCopy", saveNewsletterMeasurementCopy, requireAdmin],
    ["previewNewsletterMeasurementEmail", previewNewsletterMeasurementEmail, requireAdmin],
    ["getCampaignMeasurement", getCampaignMeasurement, requireAdminEditor],
  ])("%s: POST + właściwa rola", (_name, fn, middleware) => {
    const meta = serverFnMeta(fn);
    expect(meta?.method).toBe("POST");
    expect(meta?.middleware).toEqual([middleware]);
  });
});

describe("„Poproś o zgodę na pomiar”", () => {
  it("podgląd: RPC literałem bez parametrów (najemca z sesji), stany odmowy i braku migracji", async () => {
    rpc.mockResolvedValueOnce({
      data: {
        version: "email-measurement-2026-10-23",
        enabled: true,
        subscribers: 10,
        with_consent: 2,
        candidates: 7,
        suppressed: 1,
        requested: 0,
        pending: 0,
        mailed: 0,
        blocked: 0,
        skipped: 0,
        failed: 0,
        confirmed: 0,
        daily_cap: 200,
        last_requested_at: null,
      },
      error: null,
    });
    expect(await getNewsletterMeasurementPreview()).toMatchObject({
      state: "ready",
      data: { candidates: 7, suppressed: 1, dailyCap: 200 },
    });
    expect(rpc).toHaveBeenCalledWith("admin_newsletter_measurement_preview");
    rpc.mockResolvedValueOnce({ data: null, error: { message: "forbidden", code: "42501" } });
    expect(await getNewsletterMeasurementPreview()).toEqual({ state: "forbidden" });
    rpc.mockResolvedValueOnce({ data: null, error: { message: "nope", code: "PGRST202" } });
    expect(await getNewsletterMeasurementPreview()).toEqual({ state: "unavailable" });
  });

  it("start z potwierdzoną liczbą; lista urosła po podglądzie = `conflict`", async () => {
    rpc.mockResolvedValueOnce({ data: { requested: 7, version: "v1" }, error: null });
    expect(await requestNewsletterMeasurement({ data: { expected: 7 } })).toEqual({
      ok: true,
      data: { requested: 7, version: "v1" },
    });
    expect(rpc).toHaveBeenCalledWith("admin_newsletter_measurement_request", { p_expected: 7 });
    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "stale_preview", code: "40001" },
    });
    expect(await requestNewsletterMeasurement({ data: { expected: 7 } })).toEqual({
      ok: false,
      error: "conflict",
      reason: "stale_preview",
    });
  });

  it("zła liczba albo najemca w ładunku - odrzucone przed RPC", async () => {
    await expect(requestNewsletterMeasurement({ data: { expected: -1 } })).rejects.toThrow();
    await expect(requestNewsletterMeasurement({ data: { expected: 1.5 } })).rejects.toThrow();
    await expect(
      requestNewsletterMeasurement({ data: { expected: 1, tenantId: TENANT } }),
    ).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("bez oznaczeń admina (I9d-Y2b, wariant (b))", () => {
  it("moduł nie eksportuje funkcji oznaczeń „mój tekst obejmuje pomiar”", () => {
    const names = Object.keys(measurementFunctions);
    expect(names).not.toContain("getNewsletterConsentMeasurement");
    expect(names).not.toContain("markNewsletterConsentMeasurement");
    expect(names).not.toContain("MarkConsentMeasurementSchema");
  });
});

describe("mianownik kampanii", () => {
  it("RPC z kampanią; obca kampania (P0002) to błąd odczytu, nie cicha zero", async () => {
    rpc.mockResolvedValueOnce({
      data: { campaign_id: CAMPAIGN, sent: 5, measured: 2, unmeasured: 3, unknown: 0 },
      error: null,
    });
    expect(await getCampaignMeasurement({ data: { campaignId: CAMPAIGN } })).toEqual({
      state: "ready",
      data: { campaignId: CAMPAIGN, sent: 5, measured: 2, unmeasured: 3, unknown: 0 },
    });
    expect(rpc).toHaveBeenCalledWith("admin_newsletter_campaign_measurement", {
      p_campaign: CAMPAIGN,
    });
    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "campaign_not_found", code: "P0002" },
    });
    await expect(getCampaignMeasurement({ data: { campaignId: CAMPAIGN } })).rejects.toThrow(
      "campaign_not_found",
    );
    await expect(getCampaignMeasurement({ data: { campaignId: "nie-uuid" } })).rejects.toThrow();
  });
});

describe("treść maila prośby", () => {
  it("odczyt: wiersz `site_settings` najemcy z sesji pod własnym kluczem", async () => {
    db.setResponse("site_settings", ok({ value: null, updated_at: null }));
    expect(await getNewsletterMeasurementCopy()).toEqual({
      state: "ready",
      data: { overrides: NEWSLETTER_MEASUREMENT_EMPTY_OVERRIDES, updatedAt: null },
    });
    const read = db.chainsFor("site_settings")[0];
    expect(read?.argsOf("eq")).toEqual(["tenant_id", TENANT]);
    expect(read?.calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([
      ["tenant_id", TENANT],
      ["key", "newsletter_measurement_email"],
    ]);
  });

  it("zapis z tokenem CAS: brak zmienionego wiersza = `conflict`", async () => {
    db.setResponse("site_settings", ok([]));
    const result = await saveNewsletterMeasurementCopy({
      data: { overrides: NEWSLETTER_MEASUREMENT_EMPTY_OVERRIDES, expectedUpdatedAt: STAMP },
    });
    expect(result).toEqual({ ok: false, error: "conflict", reason: "stale_write" });
  });

  it("podgląd: ten sam render co wysyłka, atrapa tokenu w linku", async () => {
    const result = await previewNewsletterMeasurementEmail({
      data: { lang: "en", overrides: NEWSLETTER_MEASUREMENT_EMPTY_OVERRIDES },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.subject).toBe("May we measure opens and clicks in our newsletter?");
    expect(result.data.html).toContain(
      "https://think.example/api/public/newsletter/measurement?token=preview&amp;lang=en",
    );
  });
});
