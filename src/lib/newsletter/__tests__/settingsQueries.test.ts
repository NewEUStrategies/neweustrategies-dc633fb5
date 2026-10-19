// USTAWIENIA NEWSLETTERA - zapis grupami z CAS i scaleniem (`settingsQueries.ts`,
// def. 9, D-S1-03).
//
// CO TEN PLIK DOWODZI.
//   1. Patch = wyłącznie kolumny GRUPY zmienione względem bazy szkicu
//      (pełny wiersz w szkicu nie przecieka; kolejność kluczy jsonb to nie zmiana).
//   2. RPC wołane literałem nazwy, z SUROWYM tokenem.
//   3. „Dwie karty, dwie grupy - obie zmiany przetrwały": 40001, świeży wiersz
//      bez zmian w kolumnach patchu → jedno ponowienie z nowym tokenem.
//   4. Konflikt prawdziwy (ta sama kolumna) → 40001 do ekranu, bez ponowienia.
//   5. Unieważnianie = reguły szyny `newsletter_settings.changed.v1`
//      i `newsletter_subscriber.*` (def. 17).
//   6. Szew zgodności rozkłada pełny wiersz na grupy z tokenem z cache.
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider, type QueryKey } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { NewsletterSettings } from "@/hooks/useNewsletterSettings";
import type { NlDoc } from "@/lib/newsletter-builder/types";

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  fresh: vi.fn(),
  tenantId: null as string | null,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (fn: string, args: unknown) => h.rpc(fn, args) },
}));
vi.mock("@/hooks/newsletterSettingsData", () => ({
  fetchNewsletterSettings: () => h.fresh(),
}));
vi.mock("@/lib/tenant", () => ({ useCurrentTenantId: () => h.tenantId }));

import { defaultNewsletterSettings } from "@/hooks/useNewsletterSettings";
import { STALE_WRITE_CODE, isStaleWriteError } from "@/lib/billing/planQueries";
import { newsletterKeys } from "@/lib/newsletter/keys";
import type { DomainEventRow, DomainEventType } from "@/lib/realtime/domainEvents";
import {
  invalidationKeysFor,
  registerInvalidationExtension,
} from "@/lib/realtime/eventInvalidationMap";
import { ADMIN_HUB_INVALIDATION } from "@/lib/realtime/eventInvalidationMap.admin";
import {
  audienceInvalidationKeys,
  diffNewsletterSettings,
  newsletterSettingsInvalidationKeys,
  patchNewsletterSettings,
  planNewsletterSettingsGroups,
  saveNewsletterSettingsByGroups,
  usePatchNewsletterSettings,
  useSaveNewsletterSettings,
} from "../settingsQueries";

const TENANT = "11111111-1111-4111-a111-111111111111";
const T0 = "2026-10-19T10:00:00.100001+00:00";
const T1 = "2026-10-19T10:00:05.200002+00:00";
const T2 = "2026-10-19T10:00:09.300003+00:00";

const stale = () => Object.assign(new Error("stale_write"), { code: "40001" });

function row(overrides: Partial<NewsletterSettings> = {}): NewsletterSettings {
  return { ...defaultNewsletterSettings(), tenant_id: TENANT, updated_at: T0, ...overrides };
}

beforeEach(() => {
  h.rpc.mockReset();
  h.fresh.mockReset();
  h.tenantId = TENANT;
});

describe("diffNewsletterSettings", () => {
  it("tylko kolumny grupy, tylko zmienione - pełny wiersz w szkicu nie przecieka", () => {
    const base = row();
    const draft = row({ sender_name: "Redakcja", popup_title_pl: "Inny tytuł", heading_pl: "X" });
    expect(diffNewsletterSettings(base, draft, "overview")).toEqual({ sender_name: "Redakcja" });
    expect(diffNewsletterSettings(base, draft, "popup")).toEqual({ popup_title_pl: "Inny tytuł" });
    expect(diffNewsletterSettings(base, draft, "inline")).toEqual({ heading_pl: "X" });
    expect(diffNewsletterSettings(base, draft, "builder")).toEqual({});
  });

  it("kolejność kluczy w kolumnie jsonb to nie zmiana; zmiana wartości w środku - tak", () => {
    const design = { theme: "dark", grid: 2 } as unknown as NewsletterSettings["popup_design"];
    const reordered = { grid: 2, theme: "dark" } as unknown as NewsletterSettings["popup_design"];
    const changed = { grid: 3, theme: "dark" } as unknown as NewsletterSettings["popup_design"];
    expect(
      diffNewsletterSettings(
        row({ popup_design: design }),
        row({ popup_design: reordered }),
        "popup",
      ),
    ).toEqual({});
    expect(
      diffNewsletterSettings(
        row({ popup_design: design }),
        row({ popup_design: changed }),
        "popup",
      ),
    ).toEqual({
      popup_design: changed,
    });
  });
});

describe("patchNewsletterSettings - wywołanie RPC", () => {
  it("literał nazwy, grupa, patch i SUROWY token", async () => {
    h.rpc.mockResolvedValue({ data: { updated_at: T1, changed: ["sender_name"] }, error: null });
    const result = await patchNewsletterSettings("overview", {
      base: row(),
      draft: row({ sender_name: "Redakcja" }),
      expectedUpdatedAt: T0,
    });
    expect(h.rpc).toHaveBeenCalledWith("admin_newsletter_settings_patch", {
      p_group: "overview",
      p_patch: { sender_name: "Redakcja" },
      p_expected_updated_at: T0,
    });
    expect(result).toEqual({ updatedAt: T1, changed: ["sender_name"], merged: false });
  });

  it("pusty patch nie wychodzi do bazy", async () => {
    const result = await patchNewsletterSettings("popup", {
      base: row(),
      draft: row({ sender_name: "inna grupa" }),
      expectedUpdatedAt: T0,
    });
    expect(h.rpc).not.toHaveBeenCalled();
    expect(result).toEqual({ updatedAt: T0, changed: [], merged: false });
  });

  it("pierwszy zapis najemcy (brak wiersza) idzie z tokenem `null`", async () => {
    h.rpc.mockResolvedValue({ data: { updated_at: T1, changed: ["enabled"] }, error: null });
    const base = { ...defaultNewsletterSettings() };
    await patchNewsletterSettings("overview", {
      base,
      draft: { ...base, enabled: false },
      expectedUpdatedAt: null,
    });
    expect(h.rpc.mock.calls[0][1]).toMatchObject({ p_expected_updated_at: null });
  });

  it("błąd inny niż 40001 leci dalej bez odczytu świeżego wiersza; zły kształt odpowiedzi = błąd", async () => {
    h.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "column_not_in_group:x", code: "22023" },
    });
    await expect(
      patchNewsletterSettings("overview", {
        base: row(),
        draft: row({ enabled: false }),
        expectedUpdatedAt: T0,
      }),
    ).rejects.toMatchObject({ code: "22023" });
    expect(h.fresh).not.toHaveBeenCalled();

    h.rpc.mockResolvedValueOnce({ data: { updated_at: 5, changed: "x" }, error: null });
    await expect(
      patchNewsletterSettings("overview", {
        base: row(),
        draft: row({ enabled: false }),
        expectedUpdatedAt: T0,
      }),
    ).rejects.toThrow("invalid_rpc_shape");
  });
});

describe("D-S1-03: dwie karty, dwie grupy", () => {
  it("obie zmiany przetrwały: 40001 → świeży wiersz bez zmian w kolumnach patchu → jedno ponowienie", async () => {
    // Karta A zapisała `sender_name` (przegląd) - token wiersza jest już T1.
    // Karta B (popup) startowała z T0 i zmienia tylko tytuł popupu.
    h.rpc.mockResolvedValueOnce({ data: null, error: stale() });
    h.rpc.mockResolvedValueOnce({
      data: { updated_at: T2, changed: ["popup_title_pl"] },
      error: null,
    });
    h.fresh.mockResolvedValue(row({ sender_name: "Zmiana z karty A", updated_at: T1 }));

    const result = await patchNewsletterSettings("popup", {
      base: row(),
      draft: row({ popup_title_pl: "Nowy tytuł" }),
      expectedUpdatedAt: T0,
    });

    expect(h.rpc).toHaveBeenCalledTimes(2);
    expect(h.rpc.mock.calls[1][1]).toEqual({
      p_group: "popup",
      p_patch: { popup_title_pl: "Nowy tytuł" },
      p_expected_updated_at: T1,
    });
    // Patch B nie niesie `sender_name` - zmiana A zostaje nietknięta.
    expect(h.rpc.mock.calls[1][1].p_patch).not.toHaveProperty("sender_name");
    expect(result).toEqual({ updatedAt: T2, changed: ["popup_title_pl"], merged: true });
  });

  it("konflikt prawdziwy: ta sama kolumna zmieniona w innej karcie → 40001, bez ponowienia", async () => {
    h.rpc.mockResolvedValueOnce({ data: null, error: stale() });
    h.fresh.mockResolvedValue(row({ popup_title_pl: "Tytuł z karty A", updated_at: T1 }));

    const err = await patchNewsletterSettings("popup", {
      base: row(),
      draft: row({ popup_title_pl: "Tytuł z karty B" }),
      expectedUpdatedAt: T0,
    }).catch((e: unknown) => e);

    expect(isStaleWriteError(err)).toBe(true);
    expect((err as { code: string }).code).toBe(STALE_WRITE_CODE);
    expect(h.rpc).toHaveBeenCalledTimes(1);
  });

  it("ponowienie jest JEDNO - drugi 40001 trafia do ekranu", async () => {
    h.rpc.mockResolvedValue({ data: null, error: stale() });
    h.fresh.mockResolvedValue(row({ updated_at: T1 }));
    await expect(
      patchNewsletterSettings("inline", {
        base: row(),
        draft: row({ heading_en: "Hi" }),
        expectedUpdatedAt: T0,
      }),
    ).rejects.toMatchObject({ code: "40001" });
    expect(h.rpc).toHaveBeenCalledTimes(2);
  });

  it("świeży odczyt domyka lot sprzed konfliktu (dwa odczyty - drugi na pewno po nim)", async () => {
    h.rpc
      .mockResolvedValueOnce({ data: null, error: stale() })
      .mockResolvedValueOnce({ data: { updated_at: T2, changed: ["heading_en"] }, error: null });
    h.fresh
      .mockResolvedValueOnce(row({ heading_en: "lot sprzed konfliktu" }))
      .mockResolvedValueOnce(row({ updated_at: T1 }));
    const result = await patchNewsletterSettings("inline", {
      base: row(),
      draft: row({ heading_en: "Hi" }),
      expectedUpdatedAt: T0,
    });
    expect(h.fresh).toHaveBeenCalledTimes(2);
    expect(result.merged).toBe(true);
  });
});

/* ------------------------------------------------------------ haki i szew */

function eventOf(type: DomainEventType): DomainEventRow {
  return {
    id: "55555555-5555-4555-a555-555555555555",
    tenant_id: TENANT,
    aggregate_type: type.split(".")[0],
    aggregate_id: TENANT,
    event_type: type,
    payload: {} as DomainEventRow["payload"],
    correlation_id: null,
    actor_id: null,
    created_at: "2026-10-19T10:00:00.000Z",
  };
}

const sorted = (keys: readonly QueryKey[]) => keys.map((k) => JSON.stringify(k)).sort();

function harness() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const spy = vi.spyOn(qc, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);
  return { qc, spy, wrapper };
}

describe("unieważnianie = reguły szyny", () => {
  let unregister: () => void = () => {};
  beforeAll(() => {
    unregister = registerInvalidationExtension(ADMIN_HUB_INVALIDATION);
  });
  afterAll(() => unregister());

  it("ustawienia: `newsletter_settings.changed.v1` (rdzeń + panel)", () => {
    expect(sorted(newsletterSettingsInvalidationKeys(TENANT))).toEqual(
      sorted(invalidationKeysFor(eventOf("newsletter_settings.changed.v1"), { userId: undefined })),
    );
  });

  it.each([
    "newsletter_subscriber.subscribed.v1",
    "newsletter_subscriber.confirmed.v1",
    "newsletter_subscriber.unsubscribed.v1",
    "newsletter_subscriber.resubscribed.v1",
  ] as const)("odbiorcy (def. 17): %s - newsletter + CRM + lejek huba", (type) => {
    expect(sorted(audienceInvalidationKeys(TENANT))).toEqual(
      sorted(invalidationKeysFor(eventOf(type), { userId: undefined })),
    );
  });

  it("hak: nowy token od razu w pełnym wpisie cache, potem odświeżenie czytelników", async () => {
    h.rpc.mockResolvedValue({ data: { updated_at: T1, changed: ["sender_email"] }, error: null });
    const { qc, spy, wrapper } = harness();
    qc.setQueryData(newsletterKeys.settings(), row());
    const { result } = renderHook(() => usePatchNewsletterSettings("overview"), { wrapper });
    await result.current.mutateAsync({
      base: row(),
      draft: row({ sender_email: "news@example.com" }),
      expectedUpdatedAt: T0,
    });
    expect(qc.getQueryData(newsletterKeys.settings())).toMatchObject({
      sender_email: "news@example.com",
      updated_at: T1,
    });
    expect(sorted(spy.mock.calls.map(([f]) => (f as { queryKey: QueryKey }).queryKey))).toEqual(
      sorted(newsletterSettingsInvalidationKeys(TENANT)),
    );
  });
});

describe("szew zgodności `useSaveNewsletterSettings` (D-S1-04)", () => {
  it("plan grup: pola rejestracji jedną grupą `registration`, dokumenty - `builder`", () => {
    expect(planNewsletterSettingsGroups(["popup_fields"])).toEqual([
      ["registration", ["popup_fields"]],
    ]);
    expect(planNewsletterSettingsGroups(["popup_doc"])).toEqual([["builder", ["popup_doc"]]]);
    expect(planNewsletterSettingsGroups(["sender_name", "heading_pl", "popup_enabled"])).toEqual([
      ["overview", ["sender_name", "popup_enabled"]],
      ["inline", ["heading_pl"]],
    ]);
  });

  it("pełny wiersz z formularza rejestracji → JEDNO RPC grupy `registration` z tokenem z cache", async () => {
    const { qc } = harness();
    const cached = row();
    qc.setQueryData(newsletterKeys.settings(), cached);
    const nextFields = [...cached.popup_fields].reverse();
    h.rpc.mockResolvedValue({ data: { updated_at: T1, changed: ["popup_fields"] }, error: null });

    await saveNewsletterSettingsByGroups(qc, {
      ...cached,
      popup_fields: nextFields,
      tenant_id: "pole-spoza-grup",
    });

    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.rpc.mock.calls[0][1]).toEqual({
      p_group: "registration",
      p_patch: { popup_fields: nextFields },
      p_expected_updated_at: T0,
    });
    expect(qc.getQueryData(newsletterKeys.settings())).toMatchObject({ updated_at: T1 });
  });

  it("kilka grup: token z odpowiedzi poprzedniej grupy przechodzi do następnej", async () => {
    const { qc } = harness();
    qc.setQueryData(newsletterKeys.settings(), row());
    h.rpc
      .mockResolvedValueOnce({ data: { updated_at: T1, changed: ["sender_name"] }, error: null })
      .mockResolvedValueOnce({ data: { updated_at: T2, changed: ["heading_pl"] }, error: null });
    await saveNewsletterSettingsByGroups(qc, { sender_name: "A", heading_pl: "B" });
    expect(
      h.rpc.mock.calls.map(
        ([, args]) => (args as { p_expected_updated_at: string }).p_expected_updated_at,
      ),
    ).toEqual([T0, T1]);
  });

  it("bez zmian względem cache - zero zapytań", async () => {
    const { qc } = harness();
    qc.setQueryData(newsletterKeys.settings(), row());
    await saveNewsletterSettingsByGroups(qc, { ...row() });
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("hak `useSaveNewsletterSettings` zapisuje grupą `builder` z tokenem z cache i odświeża wiersz", async () => {
    // Hak mieszka w module panelu (nie w chunku wejściowym) - test idzie
    // przez prawdziwy zapis grupami, bez atrapy modułu.
    const { qc, wrapper } = harness();
    const cached = row();
    qc.setQueryData(newsletterKeys.settings(), cached);
    h.rpc.mockResolvedValue({ data: { updated_at: T1, changed: ["inline_doc"] }, error: null });
    const doc: NlDoc = { version: 1, variant: "inline", sections: [] };

    const { result } = renderHook(() => useSaveNewsletterSettings(), { wrapper });
    await result.current.mutateAsync({ inline_doc: doc });

    expect(h.rpc.mock.calls.map(([fn, args]) => [fn, args])).toEqual([
      [
        "admin_newsletter_settings_patch",
        { p_group: "builder", p_patch: { inline_doc: doc }, p_expected_updated_at: T0 },
      ],
    ]);
    expect(qc.getQueryData(newsletterKeys.settings())).toMatchObject({ updated_at: T1 });
  });
});
