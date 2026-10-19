// Role w kampaniach newslettera (def. 10: autor nie wysyła kampanii).
//
// DWA POZIOMY, BO DWIE SYTUACJE:
//   * funkcje, których obudowy nie przypina żaden test spoza wycinka S1 -
//     tick z panelu (`processDueCampaigns`) i tworzenie kampanii kuponowej -
//     stoją za `requireAdminEditor` wprost;
//   * `upsertCampaign` i `sendCampaign` mają w middleware `requireStaff`,
//     bo tę obudowę przypinają `newsletterCampaignCrud/Send.test.ts` (poza
//     manifestem S1 - zgłoszenie Z-S1-P1). Rolę sprawdza więc HANDLER:
//     odczyt kampanii klientem UŻYTKOWNIKA, którego polityka RLS
//     (`campaigns_staff_select`) wpuszcza wyłącznie admina i editora.
//     Atrapa niżej ma DWA klienty: użytkownika (autor - RLS nic mu nie
//     pokazuje) i serwisowy (widzi wszystko) - dokładnie ta asymetria
//     sprawiała, że autor wysyłał kampanie przez klienta serwisowego.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ok, supabaseFromStub, type RecordedChain } from "@/test/supabaseChain";
import { resetServerFnContext, serverFnMeta, setServerFnContext } from "@/test/serverFn";

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  sendEmail: vi.fn(),
  fetchSuppressedEmails: vi.fn(),
  evaluateSendGate: vi.fn(),
}));

vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/serverFn")).serverFnModuleMock(),
);
vi.mock("@/integrations/supabase/require-staff", () => ({
  requireStaff: { __mw: "requireStaff" },
  requireAdminEditor: { __mw: "requireAdminEditor" },
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (t: string) => adminDb.from(t), rpc: h.rpc },
}));
vi.mock("@/lib/email/provider.server", () => ({ sendEmail: h.sendEmail }));
vi.mock("@/lib/email/suppression.server", () => ({
  fetchSuppressedEmails: h.fetchSuppressedEmails,
}));
vi.mock("@/lib/email/reputationGate.server", () => ({ evaluateSendGate: h.evaluateSendGate }));

import {
  createCouponNewsletterCampaign,
  processDueCampaigns,
  sendCampaign,
  upsertCampaign,
} from "@/lib/newsletter-campaigns.functions";

/** Klient użytkownika (RLS) i klient serwisowy - osobne atrapy. */
const userDb = supabaseFromStub();
const adminDb = supabaseFromStub();
const CAMPAIGNS = "newsletter_campaigns";
const PROFILES = "profiles";
const CAMPAIGN_ID = "11111111-2222-3333-4444-555555555555";
const TENANT = "tenant-1";

const SOURCE = readFileSync(
  join(process.cwd(), "src/lib/newsletter-campaigns.functions.ts"),
  "utf8",
);

/** Ustawia, co widzi UŻYTKOWNIK: admin/editor - wiersz; autor - nic (RLS). */
function userSeesCampaign(visible: boolean): void {
  userDb.setResponse(CAMPAIGNS, (chain: RecordedChain) => {
    if (chain.has("update") || chain.has("insert")) return ok(null);
    return ok(visible ? { status: "draft" } : null);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  userDb.reset();
  adminDb.reset();
  userDb.setResponse(PROFILES, ok({ tenant_id: TENANT }));
  userSeesCampaign(false);
  // Klient serwisowy widzi i przejmie każdą kampanię - jeśli wysyłka
  // dojdzie do niego, test to zobaczy.
  adminDb.setResponse(CAMPAIGNS, () => ok({ id: CAMPAIGN_ID, tenant_id: TENANT, status: "draft" }));
  setServerFnContext({ supabase: { from: userDb.from, rpc: h.rpc }, userId: "author-1" });
  h.evaluateSendGate.mockResolvedValue({ allowed: true, errorCode: null });
});

afterEach(() => resetServerFnContext());

describe("obudowa (middleware)", () => {
  it("tick z panelu i tworzenie kampanii kuponowej: admin/editor", () => {
    expect(serverFnMeta(processDueCampaigns)?.middleware).toEqual([{ __mw: "requireAdminEditor" }]);
    expect(serverFnMeta(createCouponNewsletterCampaign)?.middleware).toEqual([
      { __mw: "requireAdminEditor" },
    ]);
    expect(serverFnMeta(createCouponNewsletterCampaign)?.method).toBe("POST");
  });

  it("zapis i wysyłka: admin/editor w middleware (Z-S1-P1) + bramka RLS w handlerze", () => {
    expect(serverFnMeta(upsertCampaign)?.middleware).toEqual([{ __mw: "requireAdminEditor" }]);
    expect(serverFnMeta(sendCampaign)?.middleware).toEqual([{ __mw: "requireAdminEditor" }]);
  });

  it("KAŻDA funkcja serwerowa pliku ma jednoelementową bramkę roli (zapis liczony bramką adminRouteAuthority)", () => {
    const functions = (SOURCE.match(/createServerFn\(/g) ?? []).length;
    const gated = (
      SOURCE.match(/\.middleware\(\[require(Staff|AdminEditor|PlatformAdmin|Admin)\]\)/g) ?? []
    ).length;
    expect(functions).toBeGreaterThan(0);
    expect(gated).toBe(functions);
  });
});

describe("autor nie wysyła i nie zapisuje kampanii (bramka w handlerze)", () => {
  it("sendCampaign: autor dostaje campaign_not_found ZANIM klient serwisowy cokolwiek ruszy", async () => {
    await expect(sendCampaign({ data: { id: CAMPAIGN_ID } })).rejects.toThrow("campaign_not_found");
    // Ani bramki reputacji, ani przejęcia, ani maila.
    expect(adminDb.chains).toHaveLength(0);
    expect(h.evaluateSendGate).not.toHaveBeenCalled();
    expect(h.sendEmail).not.toHaveBeenCalled();
    // Odczyt szedł klientem użytkownika, przypięty do kampanii i najemcy.
    const read = userDb.lastChain(CAMPAIGNS);
    expect(read?.argsOf("select")).toEqual(["status"]);
    expect(read?.calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([
      ["id", CAMPAIGN_ID],
      ["tenant_id", TENANT],
    ]);
  });

  it("sendCampaign: editor/admin (kampania widoczna w RLS) przechodzi do przejęcia", async () => {
    userSeesCampaign(true);
    // Przejęcie się nie udaje (atrapa nie zwraca wiersza z UPDATE…SELECT) -
    // ważne, że wysyłka doszła do klienta serwisowego.
    adminDb.setResponse(CAMPAIGNS, () => ok(null));

    await expect(sendCampaign({ data: { id: CAMPAIGN_ID } })).rejects.toThrow(
      "campaign_not_sendable",
    );
    expect(adminDb.chainsFor(CAMPAIGNS).some((c) => c.has("update"))).toBe(true);
  });

  it("upsertCampaign (edycja): autor dostaje jawną odmowę zamiast cichego „zapisano”", async () => {
    await expect(
      upsertCampaign({
        data: {
          id: CAMPAIGN_ID,
          name: "Edycja autora",
          subject_pl: "T",
          subject_en: "S",
          html_pl: "<p>a</p>",
          html_en: "<p>b</p>",
          editor: "html",
          audience_filter: {},
        },
      }),
    ).rejects.toThrow("campaign_not_found");
    expect(userDb.chainsFor(CAMPAIGNS).some((c) => c.has("update"))).toBe(false);
  });

  it("upsertCampaign (edycja): editor zapisuje jak dotąd", async () => {
    userSeesCampaign(true);

    await expect(
      upsertCampaign({
        data: {
          id: CAMPAIGN_ID,
          name: "Edycja redakcji",
          subject_pl: "T",
          subject_en: "S",
          html_pl: "<p>a</p>",
          html_en: "<p>b</p>",
          editor: "html",
          audience_filter: {},
        },
      }),
    ).resolves.toEqual({ id: CAMPAIGN_ID });
    expect(userDb.lastChain(CAMPAIGNS)?.has("update")).toBe(true);
  });
});
