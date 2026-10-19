// Trasa listy popupów `/admin/popups` - nagłówek sekcji i przełącznik
// wbudowanego popupu rejestracji.
//
// CO TU JEST DO ZEPSUCIA.
//   * Przełącznik aktywności popupu rejestracji pisał do `newsletter_settings`
//     `{ ...ustawienia, popup_enabled }` - CAŁE ustawienia newslettera z chwili
//     ostatniego odczytu. Kliknięcie cofało nadawcę, tryb albo treść popupu
//     zmienione w międzyczasie w innej karcie (S1 def. 9). Teraz wysyła
//     WYŁĄCZNIE `popup_enabled`, grupą `popup`, z tokenem `updated_at`.
//   * Trasa nie miała `head` - karta przeglądarki pokazywała tytuł ogólny
//     (AGENTS: sekcyjne `adminPageHead` na prywatnych ekranach, D14).
// Lista popupów buildera i edytor popupu rejestracji mają własne testy.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { supabaseFromStub, ok } from "@/test/supabaseChain";

const h = vi.hoisted(() => ({
  from: (_t: string): unknown => ({}),
  rpc: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => h.from(table),
    rpc: (fn: string, args: unknown) => h.rpc(fn, args),
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/builder/popups", () => ({
  usePopupsAdmin: () => ({
    items: [],
    loading: false,
    create: vi.fn(),
    duplicate: vi.fn(),
    remove: vi.fn(),
    setStatus: vi.fn(),
  }),
}));
vi.mock("@/components/admin/popups/SignupPopupContentSection", () => ({
  SignupPopupContentSection: () => <div data-testid="edytor-popupu-rejestracji" />,
}));

import i18n from "@/lib/i18n";
import { toast } from "sonner";
import { clearEdgeTtlCache } from "@/lib/ssrCache";
import { renderRoute } from "@/test/routeHarness";
import { Route } from "@/routes/admin.popups";
import { defaultNewsletterSettings, type NewsletterSettings } from "@/hooks/useNewsletterSettings";

const T0 = "2026-10-19T10:00:00.100001+00:00";
const T1 = "2026-10-19T10:00:05.200002+00:00";

let stub: ReturnType<typeof supabaseFromStub>;
let row: NewsletterSettings;

function patchCalls() {
  return h.rpc.mock.calls.filter(([fn]) => fn === "admin_newsletter_settings_patch");
}

async function renderList() {
  const utils = await renderRoute({
    route: Route,
    path: "/admin/popups",
    initialEntry: "/admin/popups",
  });
  await waitFor(() => expect(utils.queryClient.getQueryData(["newsletter-settings"])).toBeTruthy());
  await act(async () => {});
  return utils;
}

function signupToggle(container: HTMLElement): HTMLElement {
  // Pierwszy wiersz tabeli to wbudowany popup rejestracji.
  const toggle = container.querySelector("tbody tr button[role='switch']");
  expect(toggle, "brak przełącznika popupu rejestracji").toBeTruthy();
  return toggle as HTMLElement;
}

beforeEach(() => {
  stub = supabaseFromStub();
  h.from = stub.from;
  clearEdgeTtlCache();
  vi.clearAllMocks();
  row = {
    ...defaultNewsletterSettings(),
    tenant_id: "tenant-1",
    popup_enabled: false,
    sender_name: "Redakcja",
    updated_at: T0,
  };
  stub.setResponse("newsletter_settings", () => ok(row));
  h.rpc.mockReset();
  h.rpc.mockImplementation(async (_fn: string, args: Record<string, unknown>) => {
    if (args.p_expected_updated_at !== row.updated_at) {
      return { data: null, error: Object.assign(new Error("stale_write"), { code: "40001" }) };
    }
    const patch = args.p_patch as Partial<NewsletterSettings>;
    row = { ...row, ...patch, updated_at: T1 };
    return { data: { updated_at: T1, changed: Object.keys(patch).sort() }, error: null };
  });
});

afterEach(() => {
  cleanup();
});

describe("nagłówek trasy /admin/popups (D14)", () => {
  it("ma SEKCYJNY tytuł i jest wyłączony z indeksu", async () => {
    const { meta } = await renderList();

    expect(meta()).toContainEqual({ title: "Popupy | New European Strategies" });
    expect(meta()).toContainEqual({ name: "robots", content: "noindex, nofollow" });
    const description = meta().find((m) => m.name === "description")?.content;
    expect(String(description)).toMatch(/popup/i);
  });
});

describe("przełącznik popupu rejestracji (def. 9)", () => {
  it("wysyła WYŁĄCZNIE `popup_enabled` grupą `popup` z tokenem wiersza", async () => {
    const { container } = await renderList();

    fireEvent.click(signupToggle(container));

    await waitFor(() => expect(patchCalls()).toHaveLength(1));
    expect(patchCalls()[0]![1]).toEqual({
      p_group: "popup",
      p_patch: { popup_enabled: true },
      p_expected_updated_at: T0,
    });
    // Żadnego UPDATE pełnym wierszem z przeglądarki.
    expect(
      stub.chainsFor("newsletter_settings").some((c) => c.has("update") || c.has("insert")),
    ).toBe(false);
    expect(row).toMatchObject({ popup_enabled: true, sender_name: "Redakcja" });
  });

  it("cudza zmiana INNYCH kolumn w międzyczasie nie cofa się - scalenie", async () => {
    const { container } = await renderList();
    // Ktoś zmienił nadawcę w innej karcie - token wiersza jest już inny.
    row = { ...row, sender_name: "Nowa redakcja", updated_at: "2026-10-19T10:00:03.000001+00:00" };

    fireEvent.click(signupToggle(container));

    await waitFor(() => expect(row.popup_enabled).toBe(true));
    expect(row.sender_name).toBe("Nowa redakcja");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("ktoś przełączył popup w innej karcie - komunikat konfliktu, bez nadpisania", async () => {
    const { container } = await renderList();
    row = { ...row, popup_enabled: true, updated_at: "2026-10-19T10:00:03.000001+00:00" };

    // Karta widzi jeszcze „wyłączony" i próbuje włączyć - ten sam przełącznik.
    fireEvent.click(signupToggle(container));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        i18n.t("adminPaywall.sync.staleWrite"),
        expect.objectContaining({ action: expect.anything() }),
      ),
    );
    expect(patchCalls()).toHaveLength(1);
  });
});
