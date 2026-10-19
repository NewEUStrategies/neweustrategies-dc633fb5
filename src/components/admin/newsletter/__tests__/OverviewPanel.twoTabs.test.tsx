// „Dwie karty, dwie grupy - obie zmiany przetrwały" (S1 def. 9, D-S1-03) na
// poziomie KOMPONENTÓW: przegląd newslettera (grupa `overview`) i edytor popupu
// rejestracji (grupa `popup`) otwarte w dwóch kartach na tym samym wierszu
// `newsletter_settings`.
//
// PO CO. Wiersz ma JEDEN token `updated_at`, więc karta zapisująca jako druga
// zawsze dostaje 40001, choć nie dotyka kolumn pierwszej. Dawniej oba edytory
// wysyłały CAŁY wiersz bez tokenu - druga karta po cichu cofała zmianę
// pierwszej (nadawca znikał po zapisie treści popupu). Ten test składa oba
// edytory z PRAWDZIWYM mutatorem i atrapą serwera, która robi CAS dokładnie
// jak `admin_newsletter_settings_patch`, i sprawdza stan BAZY po obu zapisach.
// Każda karta ma własny `QueryClient` - jak dwie zakładki przeglądarki.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
vi.mock("@/hooks/useUnsavedChangesGuard", () => ({ useUnsavedChangesGuard: () => {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/components/NewsletterForm", () => ({ NewsletterForm: () => null }));
vi.mock("@/components/admin/newsletter/PopupPreview", () => ({ PopupPreview: () => null }));
vi.mock("@/components/admin/newsletter/PopupEventsPanel", () => ({ PopupEventsPanel: () => null }));
// Edytor popupu ma własne testy - tu wystarczy jedna kontrolka tytułu.
vi.mock("@/components/admin/popups/signup/SignupPopupEditor", () => ({
  SignupPopupEditor: ({ onChange }: { onChange: (patch: Record<string, unknown>) => void }) => (
    <button type="button" onClick={() => onChange({ popup_title_pl: "Tytuł z karty B" })}>
      zmien-tytul
    </button>
  ),
}));

import i18n from "@/lib/i18n";
import { toast } from "sonner";
import { clearEdgeTtlCache } from "@/lib/ssrCache";
import { OverviewPanel } from "@/components/admin/newsletter/OverviewPanel";
import { SignupPopupContentSection } from "@/components/admin/popups/SignupPopupContentSection";
import { defaultNewsletterSettings, type NewsletterSettings } from "@/hooks/useNewsletterSettings";

const T0 = "2026-10-19T10:00:00.100001+00:00";
const T1 = "2026-10-19T10:00:05.200002+00:00";
const T2 = "2026-10-19T10:00:09.300003+00:00";

interface PatchArgs {
  p_group: string;
  p_patch: Record<string, unknown>;
  p_expected_updated_at: string | null;
}

let stub: ReturnType<typeof supabaseFromStub>;
let row: NewsletterSettings;
let tokens: string[];

function patchCalls(): PatchArgs[] {
  return h.rpc.mock.calls
    .filter(([fn]) => fn === "admin_newsletter_settings_patch")
    .map(([, args]) => args as PatchArgs);
}

/** Karta przeglądarki = osobny cache zapytań. */
function tab(testId: string, ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <div data-testid={testId}>{ui}</div>
    </QueryClientProvider>,
  );
  return client;
}

beforeEach(() => {
  stub = supabaseFromStub();
  h.from = stub.from;
  clearEdgeTtlCache();
  vi.clearAllMocks();
  row = {
    ...defaultNewsletterSettings(),
    tenant_id: "tenant-1",
    sender_name: "Stary nadawca",
    popup_title_pl: "Stary tytuł",
    updated_at: T0,
  };
  tokens = [T1, T2];
  stub.setResponse("newsletter_settings", () => ok(row));
  h.rpc.mockReset();
  h.rpc.mockImplementation(async (_fn: string, args: PatchArgs) => {
    if (args.p_expected_updated_at !== row.updated_at) {
      return { data: null, error: Object.assign(new Error("stale_write"), { code: "40001" }) };
    }
    const token = tokens.shift()!;
    row = { ...row, ...args.p_patch, updated_at: token };
    return { data: { updated_at: token, changed: Object.keys(args.p_patch).sort() }, error: null };
  });
});

afterEach(() => {
  cleanup();
});

describe("dwie karty, dwie grupy (def. 9, D-S1-03)", () => {
  it("przegląd i edytor popupu zapisują po kolei - OBIE zmiany są w bazie", async () => {
    const clientA = tab("karta-a", <OverviewPanel />);
    const clientB = tab("karta-b", <SignupPopupContentSection />);
    await waitFor(() => {
      expect(clientA.getQueryData(["newsletter-settings"])).toBeTruthy();
      expect(clientB.getQueryData(["newsletter-settings"])).toBeTruthy();
    });
    await act(async () => {});
    const a = within(screen.getByTestId("karta-a"));
    const b = within(screen.getByTestId("karta-b"));

    // Obie karty zaczynają edycję od tego samego wiersza (token T0).
    fireEvent.change(a.getByDisplayValue("Stary nadawca"), {
      target: { value: "Nowy nadawca" },
    });
    fireEvent.click(b.getByText("zmien-tytul"));

    // Karta A zapisuje pierwsza - zwykły zapis z T0.
    fireEvent.click(a.getByText("Zapisz ustawienia"));
    await waitFor(() => expect(row.updated_at).toBe(T1));

    // Karta B ma w ręku STARY token: serwer odpowiada 40001, mutator czyta
    // świeży wiersz, widzi, że tytułu nikt nie ruszył, i ponawia z T1.
    await act(async () => {
      fireEvent.click(b.getByText(i18n.t("adminPopupSignup.save")));
    });

    await waitFor(() => expect(row.updated_at).toBe(T2));
    expect(row).toMatchObject({
      sender_name: "Nowy nadawca",
      popup_title_pl: "Tytuł z karty B",
    });
    expect(patchCalls()).toEqual([
      { p_group: "overview", p_patch: { sender_name: "Nowy nadawca" }, p_expected_updated_at: T0 },
      {
        p_group: "popup",
        p_patch: { popup_title_pl: "Tytuł z karty B" },
        p_expected_updated_at: T0,
      },
      {
        p_group: "popup",
        p_patch: { popup_title_pl: "Tytuł z karty B" },
        p_expected_updated_at: T1,
      },
    ]);
    // Karta B mówi operatorowi, że zapis przeszedł PO scaleniu - nie konflikt.
    expect(toast.success).toHaveBeenCalledWith(i18n.t("adminPaywall.sync.merged"));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("odwrotna kolejność - popup pierwszy, przegląd drugi - też niczego nie cofa", async () => {
    const clientA = tab("karta-a", <OverviewPanel />);
    const clientB = tab("karta-b", <SignupPopupContentSection />);
    await waitFor(() => {
      expect(clientA.getQueryData(["newsletter-settings"])).toBeTruthy();
      expect(clientB.getQueryData(["newsletter-settings"])).toBeTruthy();
    });
    await act(async () => {});
    const a = within(screen.getByTestId("karta-a"));
    const b = within(screen.getByTestId("karta-b"));

    fireEvent.change(a.getByDisplayValue("Stary nadawca"), {
      target: { value: "Nowy nadawca" },
    });
    fireEvent.click(b.getByText("zmien-tytul"));

    await act(async () => {
      fireEvent.click(b.getByText(i18n.t("adminPopupSignup.save")));
    });
    await waitFor(() => expect(row.updated_at).toBe(T1));
    fireEvent.click(a.getByText("Zapisz ustawienia"));

    await waitFor(() => expect(row.updated_at).toBe(T2));
    expect(row).toMatchObject({
      sender_name: "Nowy nadawca",
      popup_title_pl: "Tytuł z karty B",
    });
    expect(toast.error).not.toHaveBeenCalled();
  });
});
