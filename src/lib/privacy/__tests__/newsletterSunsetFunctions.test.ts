// Funkcje serwerowe wygaszania w karcie „Retencja danych" (I9d-Y1) - handler
// przez atrapę `createServerFn` (prawdziwy kod handlera, kontekst sesji
// wstrzyknięty). Autoryzację pilnuje bramka `check:authz-snapshot`; tu
// dodatkowo dowód, że KAŻDA funkcja deklaruje `requireAdmin` (jak reszta karty).
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fail, ok, supabaseFromStub } from "@/test/supabaseChain";
import { resetServerFnContext, serverFnMeta, setServerFnContext } from "@/test/serverFn";

vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/serverFn")).serverFnModuleMock(),
);

import { requireAdmin } from "@/integrations/supabase/require-staff";
import { NEWSLETTER_SUNSET_EMPTY_OVERRIDES } from "../newsletterSunset";
import {
  excludeNewsletterSubscriber,
  getDataRetentionNewsletterDue,
  getNewsletterSunsetCopy,
  includeNewsletterSubscriber,
  NEWSLETTER_SUNSET_DUE_LIMIT,
  previewNewsletterSunsetEmail,
  saveNewsletterSunsetCopy,
} from "../newsletterSunset.functions";

const TENANT = "19d40000-0000-4000-8000-0000000000a0";
const USER = "0a000000-0000-4000-8000-000000000001";
const SUB = "6f9e6f6e-0000-4000-8000-0000000000b1";
const STAMP = "2026-10-22T08:00:00.123456+00:00";

const db = supabaseFromStub();
const rpc = vi.fn();

const DUE = {
  counts: { candidates: 0, requested: 0, mailed: 0, due: 0, excluded: 0 },
  items: [],
  excluded: [],
  response_days: 30,
  daily_cap: 200,
  open_tracking_enabled: true,
  enabled: true,
  enforced: false,
  cutoff: "2025-10-22T08:00:00+00:00",
  period_months: 12,
};

beforeEach(() => {
  db.reset();
  rpc.mockReset();
  resetServerFnContext();
  setServerFnContext({ supabase: { from: db.from, rpc }, userId: USER });
  db.setResponse("profiles", ok({ tenant_id: TENANT }));
  db.setResponse("tenants", ok({ domain: "think.example" }));
});

describe("obudowa: ta sama bramka co reszta karty", () => {
  it.each([
    ["getDataRetentionNewsletterDue", getDataRetentionNewsletterDue],
    ["excludeNewsletterSubscriber", excludeNewsletterSubscriber],
    ["includeNewsletterSubscriber", includeNewsletterSubscriber],
    ["getNewsletterSunsetCopy", getNewsletterSunsetCopy],
    ["saveNewsletterSunsetCopy", saveNewsletterSunsetCopy],
    ["previewNewsletterSunsetEmail", previewNewsletterSunsetEmail],
  ])("%s: POST + requireAdmin", (_name, fn) => {
    const meta = serverFnMeta(fn);
    expect(meta?.method).toBe("POST");
    expect(meta?.middleware).toContain(requireAdmin);
  });
});

describe('lista „do wygaszenia"', () => {
  it("RPC literałem z limitem listy; najemca NIE idzie w parametrach", async () => {
    rpc.mockResolvedValue({ data: DUE, error: null });
    const result = await getDataRetentionNewsletterDue();
    expect(rpc).toHaveBeenCalledWith("admin_data_retention_newsletter_due", {
      p_limit: NEWSLETTER_SUNSET_DUE_LIMIT,
    });
    expect(result).toMatchObject({ state: "ready", data: { responseDays: 30, dailyCap: 200 } });
  });

  it("odmowa (42501) i baza bez migracji (PGRST202) to stany karty", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "forbidden", code: "42501" } });
    expect(await getDataRetentionNewsletterDue()).toEqual({ state: "forbidden" });
    rpc.mockResolvedValueOnce({ data: null, error: { message: "nope", code: "PGRST202" } });
    expect(await getDataRetentionNewsletterDue()).toEqual({ state: "unavailable" });
  });
});

describe("wykluczenie adresu i cofnięcie", () => {
  it("powód 3-500 znaków po obcięciu: krótszy i dłuższy ODRZUCONE przed RPC", async () => {
    await expect(
      excludeNewsletterSubscriber({ data: { subscriberId: SUB, reason: "  ok " } }),
    ).rejects.toThrow();
    await expect(
      excludeNewsletterSubscriber({ data: { subscriberId: SUB, reason: "x".repeat(501) } }),
    ).rejects.toThrow();
    await expect(
      excludeNewsletterSubscriber({ data: { subscriberId: "nie-uuid", reason: "Partner" } }),
    ).rejects.toThrow();
    // Najemca z payloadu odrzucony (schemat ścisły).
    await expect(
      excludeNewsletterSubscriber({
        data: { subscriberId: SUB, reason: "Partner", tenantId: TENANT },
      }),
    ).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("wykluczenie: powód obcięty, wynik z anulowaniem prośby", async () => {
    rpc.mockResolvedValue({
      data: { subscriber_id: SUB, excluded: true, cycle_cancelled: true },
      error: null,
    });
    const result = await excludeNewsletterSubscriber({
      data: { subscriberId: SUB, reason: "  Prenumerata instytucjonalna  " },
    });
    expect(rpc).toHaveBeenCalledWith("admin_data_retention_newsletter_exclude", {
      p_subscriber_id: SUB,
      p_reason: "Prenumerata instytucjonalna",
    });
    expect(result).toEqual({
      ok: true,
      data: { subscriberId: SUB, excluded: true, cycleCancelled: true },
    });
  });

  it("cofnięcie: subskrybent spoza najemcy (P0002) -> `not_found` z powodem RPC", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "exclusion_not_found", code: "P0002" },
    });
    expect(
      await includeNewsletterSubscriber({ data: { subscriberId: SUB, reason: "Koniec umowy" } }),
    ).toEqual({ ok: false, error: "not_found", reason: "exclusion_not_found" });
    expect(rpc.mock.calls[0][0]).toBe("admin_data_retention_newsletter_include");
  });
});

describe("treść prośby (site_settings najemcy z sesji)", () => {
  it("odczyt: wiersz najemcy z profilu sesji, filtr kluczem; brak wiersza = puste nadpisania", async () => {
    db.setResponse("site_settings", ok(null));
    expect(await getNewsletterSunsetCopy()).toEqual({
      state: "ready",
      data: { overrides: NEWSLETTER_SUNSET_EMPTY_OVERRIDES, updatedAt: null },
    });
    const chain = db.lastChain("site_settings");
    expect(chain?.calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([
      ["tenant_id", TENANT],
      ["key", "newsletter_sunset_email"],
    ]);
  });

  it("konto bez profilu najemcy: odmowa, bez zapytania o treść", async () => {
    db.setResponse("profiles", ok({ tenant_id: null }));
    expect(await getNewsletterSunsetCopy()).toEqual({ state: "forbidden" });
    expect(db.chainsFor("site_settings")).toEqual([]);
  });

  it("pierwszy zapis (bez tokenu): INSERT w wierszu najemcy z autorem", async () => {
    const overrides = {
      ...NEWSLETTER_SUNSET_EMPTY_OVERRIDES,
      pl: { ...NEWSLETTER_SUNSET_EMPTY_OVERRIDES.pl, cta: "Zostaję" },
    };
    db.setResponse("site_settings", ok({ value: overrides, updated_at: STAMP }));
    const result = await saveNewsletterSunsetCopy({
      data: { overrides, expectedUpdatedAt: null },
    });
    expect(result).toEqual({ ok: true, data: { overrides, updatedAt: STAMP } });
    const insert = db.lastChain("site_settings")?.argsOf("insert")?.[0] as Record<string, unknown>;
    expect(insert).toMatchObject({
      tenant_id: TENANT,
      key: "newsletter_sunset_email",
      value: overrides,
      updated_by: USER,
    });
  });

  it("równoległy pierwszy zapis innej karty (23505) -> konflikt, nie nadpisanie", async () => {
    db.setResponse("site_settings", fail("duplicate key", "23505"));
    expect(
      await saveNewsletterSunsetCopy({
        data: { overrides: NEWSLETTER_SUNSET_EMPTY_OVERRIDES, expectedUpdatedAt: null },
      }),
    ).toMatchObject({ ok: false, error: "conflict" });
  });

  it("zapis z tokenem CAS: UPDATE warunkowy; zero wierszy = konflikt", async () => {
    db.setResponse("site_settings", ok([]));
    expect(
      await saveNewsletterSunsetCopy({
        data: { overrides: NEWSLETTER_SUNSET_EMPTY_OVERRIDES, expectedUpdatedAt: STAMP },
      }),
    ).toMatchObject({ ok: false, error: "conflict", reason: "stale_write" });
    const chain = db.lastChain("site_settings");
    expect(chain?.has("update")).toBe(true);
    expect(chain?.calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([
      ["tenant_id", TENANT],
      ["key", "newsletter_sunset_email"],
      ["updated_at", STAMP],
    ]);
  });

  it("pole ponad limit ODRZUCONE przez walidator (nie przycięte)", async () => {
    await expect(
      saveNewsletterSunsetCopy({
        data: {
          overrides: {
            ...NEWSLETTER_SUNSET_EMPTY_OVERRIDES,
            en: { ...NEWSLETTER_SUNSET_EMPTY_OVERRIDES.en, subject: "x".repeat(151) },
          },
          expectedUpdatedAt: null,
        },
      }),
    ).rejects.toThrow();
    expect(db.chainsFor("site_settings")).toEqual([]);
  });

  it("podgląd: ten sam render co wysyłka, na originie najemcy, treść niezapisana z edytora", async () => {
    const result = await previewNewsletterSunsetEmail({
      data: {
        lang: "en",
        overrides: {
          ...NEWSLETTER_SUNSET_EMPTY_OVERRIDES,
          en: { ...NEWSLETTER_SUNSET_EMPTY_OVERRIDES.en, heading: "Still with us, {firstName}?" },
        },
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.html).toContain("Still with us, Anna?");
    expect(result.data.html).toContain(
      "https://think.example/api/public/newsletter/keep?token=preview&amp;lang=en",
    );
    expect(result.data.subject).toContain("Do you still want our newsletter?");
  });
});
