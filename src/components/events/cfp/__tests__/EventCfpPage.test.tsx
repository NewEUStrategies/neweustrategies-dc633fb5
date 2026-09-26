// Strona naboru prelegentów: faza z bazy, termin w strefie wydarzenia,
// przycisk zgłoszenia tylko przy otwartym naborze - i ZERO rozjazdu
// hydratacji (SSR i pierwszy render klienta rysują ten sam szkielet).
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW: każda z tych reguł, zgubiona, daje
// uczestnikowi albo organizatorowi zły ekran bez jednego błędu w konsoli.
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { freezeClock } from "@/test/time";
import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";

const h = vi.hoisted(() => ({
  openLogin: vi.fn(),
  rpc: null as SupabaseRpcStub | null,
  session: null as null | { user: { id: string; email: string } },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args?: Record<string, unknown>) => {
      if (h.rpc === null) throw new Error("test: brak atrapy RPC");
      return h.rpc.rpc(name, args);
    },
  },
}));
vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-event-cfp", () => ({ ensureEventCfpI18n: () => undefined }));
vi.mock("@/lib/loginPopupBus", () => ({ openLoginPopup: h.openLogin }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ session: h.session, loading: false }) }));
vi.mock("@tanstack/react-router", async () => ({
  Link: (await import("@/test/events/cfpStubs")).routerLinkWithSearchStub(await import("react")),
}));

const { EventCfpPage } = await import("@/components/events/cfp/organisms/EventCfpPage");

function stub(): SupabaseRpcStub {
  if (h.rpc === null) throw new Error("test");
  return h.rpc;
}

function cfp(overrides: Record<string, unknown> = {}) {
  return {
    event_id: "e1",
    event_slug: "kongres",
    timezone: "Europe/Warsaw",
    phase: "open",
    is_open: true,
    opens_at: "2026-09-01T08:00:00+00:00",
    closes_at: "2026-10-01T20:00:00+00:00",
    intro_pl: "Zapraszamy do zgłoszeń.",
    intro_en: "",
    guidelines_pl: "Zasady naboru",
    guidelines_en: "",
    formats: [{ key: "talk", label_pl: "Wykład", label_en: "Talk", duration_min: 30 }],
    tracks: [{ id: "t1", key: "e", name_pl: "Energia", name_en: "Energy" }],
    fields: [{ key: "exp", field_type: "text", label_pl: "Doświadczenie", label_en: "Experience" }],
    allow_co_speakers: true,
    max_per_submitter: 2,
    ...overrides,
  };
}

// Odliczanie liczy się od „teraz" - bez zamrożenia test otwartego naboru
// padłby po terminie z literału.
freezeClock("2026-09-15T10:00:00.000Z");

beforeEach(() => {
  h.rpc = supabaseRpcStub();
  h.session = null;
});
afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("EventCfpPage", () => {
  it("otwarty nabór: termin w strefie wydarzenia, formy, ścieżki, pytania i zaproszenie do logowania", async () => {
    stub().setData("event_cfp_public", cfp());
    renderWithQueryClient(<EventCfpPage slug="kongres" />);
    expect(await screen.findByText("Zapraszamy do zgłoszeń.")).toBeInTheDocument();
    expect(screen.getByText(/^eventCfp\.page\.phase\.open\(date=1 października 2026 22:00\)$/)).toBeInTheDocument();
    expect(screen.getByText(/^eventCfp\.page\.countdown\.toClose/)).toBeInTheDocument();
    expect(screen.getByText("Zasady naboru")).toBeInTheDocument();
    expect(screen.getByText(/Wykład/)).toBeInTheDocument();
    expect(screen.getByText("Energia")).toBeInTheDocument();
    expect(screen.getByText("Doświadczenie")).toBeInTheDocument();
    expect(screen.getByText("eventCfp.page.limit(count=2)")).toBeInTheDocument();
    expect(screen.getByText("eventCfp.page.coSpeakers")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "eventCfp.page.signInToSubmit" }));
    expect(h.openLogin).toHaveBeenCalledWith({
      mode: "signin",
      title: "eventCfp.submit.signInTitle",
      description: "eventCfp.submit.signInBody",
    });
    expect(stub().lastCall("event_cfp_public")?.arg("p_slug")).toBe("kongres");
  });

  it("zalogowany widzi zgłoszenie i swoje zgłoszenia; nabór bez terminu", async () => {
    h.session = { user: { id: "u1", email: "a@b.pl" } };
    stub().setData("event_cfp_public", cfp({ closes_at: null, formats: [], tracks: [], fields: [], allow_co_speakers: false, guidelines_pl: "", intro_pl: "" }));
    renderWithQueryClient(<EventCfpPage slug="kongres" />);
    expect(await screen.findByRole("link", { name: "eventCfp.page.submit" })).toHaveAttribute(
      "href",
      "/events/kongres/cfp-submit",
    );
    expect(screen.getByRole("link", { name: "eventCfp.page.mySubmissions" })).toHaveAttribute(
      "href",
      "/events/kongres/speaker",
    );
    expect(screen.getByText("eventCfp.page.phase.openNoDeadline")).toBeInTheDocument();
    expect(screen.queryByText("eventCfp.page.coSpeakers")).not.toBeInTheDocument();
    expect(screen.queryByText("eventCfp.page.formats")).not.toBeInTheDocument();
  });

  it("zaplanowany nabór odlicza do otwarcia i nie zaprasza do zgłoszeń", async () => {
    stub().setData("event_cfp_public", cfp({ phase: "scheduled", is_open: false, opens_at: "2099-01-01T00:00:00Z" }));
    renderWithQueryClient(<EventCfpPage slug="kongres" />);
    expect(await screen.findByText(/^eventCfp\.page\.phase\.scheduled/)).toBeInTheDocument();
    expect(screen.getByText(/^eventCfp\.page\.countdown\.toOpen/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "eventCfp.page.signInToSubmit" })).not.toBeInTheDocument();
  });

  it("zamknięty nabór dziękuje; brak naboru, brak wydarzenia i awaria mają własne zdania", async () => {
    stub().setData("event_cfp_public", cfp({ phase: "closed", is_open: false }));
    renderWithQueryClient(<EventCfpPage slug="kongres" />);
    expect(await screen.findByText("eventCfp.page.phase.closed")).toBeInTheDocument();
    cleanup();
    stub().setData("event_cfp_public", { phase: "none" });
    renderWithQueryClient(<EventCfpPage slug="kongres" />);
    expect(await screen.findByText("eventCfp.page.unavailable")).toBeInTheDocument();
    cleanup();
    stub().setData("event_cfp_public", null);
    renderWithQueryClient(<EventCfpPage slug="brak" />);
    expect(await screen.findByText("eventCfp.page.unavailable")).toBeInTheDocument();
    cleanup();
    stub().setError("event_cfp_public", "boom");
    renderWithQueryClient(<EventCfpPage slug="kongres" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("eventCfp.common.loadFailed");
  });
});

describe("EventCfpPage - SSR i hydratacja", () => {
  it("serwer i pierwszy render klienta są identyczne; treść pojawia się po montażu", async () => {
    stub().setData("event_cfp_public", cfp());
    const serverClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const host = document.createElement("div");
    host.innerHTML = renderToString(
      <QueryClientProvider client={serverClient}>
        <EventCfpPage slug="kongres" />
      </QueryClientProvider>,
    );
    document.body.append(host);
    const serverHtml = host.innerHTML;
    // SSR nie pyta bazy i nie wpisuje fazy naboru do HTML-a.
    expect(stub().callsFor("event_cfp_public")).toHaveLength(0);
    expect(serverHtml).not.toContain("Zapraszamy");
    expect(serverHtml).toContain('aria-busy="true"');

    const errors: unknown[] = [];
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let root!: ReturnType<typeof hydrateRoot>;
    await act(async () => {
      root = hydrateRoot(
        host,
        <QueryClientProvider client={client}>
          <EventCfpPage slug="kongres" />
        </QueryClientProvider>,
        { onRecoverableError: (error) => errors.push(error) },
      );
    });
    try {
      expect(errors).toEqual([]);
      await waitFor(() => expect(host.textContent).toContain("Zapraszamy do zgłoszeń."));
    } finally {
      await act(async () => root.unmount());
    }
  });
});
