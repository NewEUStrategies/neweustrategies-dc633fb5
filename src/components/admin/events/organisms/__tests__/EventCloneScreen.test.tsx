// Ekran klonu edycji - bramka, stany wczytania, zapis, idempotencja, powrót.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. REDAKTOR WYPEŁNIA FORMULARZ, KTÓRY I TAK ODMÓWI. Bez roli administratora
//      ekran ma powiedzieć to od razu - i NIE pytać bazy.
//   2. DWA KLIKNIĘCIA = DWIE EDYCJE. Klucz idempotencji ma powstać RAZ na ekran
//      i jechać z każdym zapisem; nowy klucz przy każdym kliknięciu tworzyłby
//      drugą kopię po zerwanym połączeniu.
//   3. PO ZAPISIE LĄDUJEMY NIE TAM. Klon kończy się na pulpicie NOWEJ edycji
//      (tam czeka podsumowanie), a nie na liście.
//   4. BRAK ŹRÓDŁA WYGLĄDA JAK WIECZNE WCZYTYWANIE. `not_found` ma dać zdanie
//      i drogę do kreatora od zera.
//   5. RAIL KŁAMIE. Nagłówek ramy ma pokazywać tytuł i termin WPISYWANE
//      w formularzu, w języku panelu.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import { freezeClock } from "@/test/time";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase";
import { CLONE_NEW_ID, CLONE_SOURCE_ID } from "@/test/events/eventCloneFixtures";
import type { EventCloneInput, EventClonePreview } from "@/lib/events/eventCloneApi";
import type { EventCloneDraft } from "@/lib/events/eventCloneDraft";

const h = vi.hoisted(() => ({
  rpc: null as SupabaseRpcStub | null,
  lang: "pl",
  navigate: [] as unknown[],
  toastOk: [] as string[],
  toastErr: [] as string[],
  rail: [] as { title: string; date: string }[],
  source: null as EventClonePreview | null,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (name: string, args?: Record<string, unknown>) => h.rpc!.rpc(name, args) },
}));
vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub(() => h.lang));
vi.mock("sonner", () => ({
  toast: {
    success: (message: string) => void h.toastOk.push(message),
    error: (message: string) => void h.toastErr.push(message),
  },
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
  useNavigate: () => (options: unknown) => {
    h.navigate.push(options);
    return Promise.resolve();
  },
}));
vi.mock("@/components/admin/events/studio/EventStudioCreateShell", () => ({
  EventStudioCreateShell: ({
    eventTitle,
    startsAtLabel,
    children,
  }: {
    eventTitle: string;
    startsAtLabel: string;
    children: ReactNode;
  }) => {
    h.rail.push({ title: eventTitle, date: startsAtLabel });
    return <div data-testid="rama">{children}</div>;
  },
}));
// Formularz ma własny plik testowy - tutaj jest WYZWALACZEM trzech zdarzeń.
vi.mock("@/components/admin/events/organisms/EventCloneForm", () => ({
  EventCloneForm: ({
    source,
    isSaving,
    onCancel,
    onSubmit,
    onDraftChange,
  }: {
    source: EventClonePreview;
    isSaving: boolean;
    onCancel: () => void;
    onSubmit: (input: EventCloneInput) => void;
    onDraftChange?: (draft: EventCloneDraft) => void;
  }) => {
    h.source = source;
    return (
      <div data-testid="formularz" data-saving={String(isSaving)}>
        <button
          type="button"
          onClick={() =>
            onDraftChange?.({
              titlePl: "Kongres 2027",
              titleEn: "Congress 2027",
              startsAt: "2100-03-20T08:00:00.000Z",
              timezone: "Europe/Warsaw",
            } as EventCloneDraft)
          }
        >
          raportuj
        </button>
        <button
          type="button"
          onClick={() =>
            onSubmit({ sourceEventId: CLONE_SOURCE_ID, titlePl: "Kongres 2027", titleEn: "Congress 2027" })
          }
        >
          zapisz
        </button>
        <button type="button" onClick={onCancel}>
          anuluj
        </button>
      </div>
    );
  },
}));

const { EventCloneScreen } = await import("@/components/admin/events/organisms/EventCloneScreen");

freezeClock();

beforeEach(() => {
  h.rpc = supabaseRpcStub();
  h.lang = "pl";
  h.navigate = [];
  h.toastOk = [];
  h.toastErr = [];
  h.rail = [];
  h.source = null;
});
afterEach(() => cleanup());

async function ready() {
  h.rpc!.setData("admin_event_clone_preview", { source: { id: CLONE_SOURCE_ID, slug: "kongres-2026" } });
  const utils = renderWithQueryClient(<EventCloneScreen sourceId={CLONE_SOURCE_ID} canClone />);
  await screen.findByTestId("formularz");
  return utils;
}

describe("EventCloneScreen", () => {
  it("bez roli administratora: zdanie zamiast formularza i ZERO zapytań", () => {
    renderWithQueryClient(<EventCloneScreen sourceId={CLONE_SOURCE_ID} canClone={false} />);
    expect(screen.getByText("adminEventClone.screen.adminOnly")).toBeInTheDocument();
    expect(screen.queryByTestId("rama")).toBeNull();
    expect(h.rpc!.calls).toEqual([]);
  });

  it("wczytywanie źródła, potem formularz z podglądem źródła", async () => {
    await ready();
    expect(h.source?.source.slug).toBe("kongres-2026");
    expect(h.rpc!.lastCall("admin_event_clone_preview")?.arg("p_payload")).toEqual({
      source_event_id: CLONE_SOURCE_ID,
    });
  });

  it("pokazuje „wczytuję” zanim przyjdzie źródło", () => {
    h.rpc!.setResponse("admin_event_clone_preview", () => new Promise(() => {}) as never);
    renderWithQueryClient(<EventCloneScreen sourceId={CLONE_SOURCE_ID} canClone />);
    expect(screen.getByRole("status")).toHaveTextContent("adminEventClone.screen.loading");
  });

  it("brak źródła: zdanie z mapy błędów i droga do kreatora od zera", async () => {
    h.rpc!.setError("admin_event_clone_preview", "not_found: source event does not exist in this tenant");
    renderWithQueryClient(<EventCloneScreen sourceId={CLONE_SOURCE_ID} canClone />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Nie ma takiego wydarzenia w tej organizacji.");
    expect(screen.getByRole("link", { name: "adminEventClone.screen.startFromScratch" })).toHaveAttribute(
      "href",
      "/admin/events/new",
    );
  });

  it("rail pokazuje tytuł wpisywany w formularzu w języku panelu", async () => {
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "raportuj" }));
    await waitFor(() => expect(h.rail.at(-1)?.title).toBe("Kongres 2027"));
    expect(h.rail.at(-1)?.date).not.toBe("");
    cleanup();
    h.lang = "en";
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "raportuj" }));
    await waitFor(() => expect(h.rail.at(-1)?.title).toBe("Congress 2027"));
  });

  it("zapis: ten sam klucz idempotencji przy każdym zapisie, toast, pulpit NOWEJ edycji", async () => {
    h.rpc!.setData("admin_event_clone", { event_id: CLONE_NEW_ID, source_event_id: CLONE_SOURCE_ID });
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "zapisz" }));
    await waitFor(() => expect(h.navigate).toHaveLength(1));
    expect(h.navigate[0]).toEqual({ to: "/admin/events/$eventId/overview", params: { eventId: CLONE_NEW_ID } });
    expect(h.toastOk).toEqual(["adminEventClone.toasts.created(title=Kongres 2027)"]);

    h.rpc!.setData("admin_event_clone", { event_id: CLONE_NEW_ID, replayed: true });
    fireEvent.click(screen.getByRole("button", { name: "zapisz" }));
    await waitFor(() => expect(h.toastOk).toHaveLength(2));
    expect(h.toastOk[1]).toBe("adminEventClone.toasts.replayed");
    const keys = h.rpc!.callsFor("admin_event_clone").map(
      (call) => (call.arg("p_payload") as { idempotency_key: string }).idempotency_key,
    );
    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatch(/^event\.clone:/);
    expect(keys[1]).toBe(keys[0]);
  });

  it("odmowa zapisu: toast ze zdaniem z mapy, bez nawigacji", async () => {
    h.rpc!.setError("admin_event_clone", "slug_taken: another event already uses this address");
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "zapisz" }));
    await waitFor(() => expect(h.toastErr).toEqual(["Inne wydarzenie w organizacji używa już tego adresu."]));
    expect(h.navigate).toEqual([]);
  });

  it("zapis w toku jest przekazany formularzowi; Anuluj wraca na listę", async () => {
    h.rpc!.setResponse("admin_event_clone", () => new Promise(() => {}) as never);
    await ready();
    expect(screen.getByTestId("formularz")).toHaveAttribute("data-saving", "false");
    act(() => fireEvent.click(screen.getByRole("button", { name: "zapisz" })));
    await waitFor(() => expect(screen.getByTestId("formularz")).toHaveAttribute("data-saving", "true"));
    fireEvent.click(screen.getByRole("button", { name: "anuluj" }));
    expect(h.navigate).toEqual([{ to: "/admin/events/list" }]);
  });
});
