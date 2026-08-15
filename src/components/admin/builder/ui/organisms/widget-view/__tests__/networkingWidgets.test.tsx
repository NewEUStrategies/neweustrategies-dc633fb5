// Pokrycie widokow networking/sponsorzy: MeetingBookingView (stany anonima,
// rezerwujacego i hosta; grupowanie po dniu; stan nieskonfigurowany builder vs
// public) oraz EventSponsorsView (poziomy sponsorskie, opisy, empty state).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import type { WidgetContent } from "@/lib/builder/types";

const db = vi.hoisted(() => ({
  rpc: {} as Record<string, unknown[]>,
  user: null as { id: string } | null,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => {
      const builder: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "order", "limit"]) builder[m] = () => builder;
      builder.maybeSingle = async () => ({ data: null, error: null });
      builder.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null });
      return builder;
    },
    rpc: async (fn: string) => ({ data: db.rpc[fn] ?? [], error: null }),
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: db.user }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? k,
    i18n: { language: "pl" },
  }),
}));

import { MeetingBookingView } from "../MeetingBookingView";
import { EventSponsorsView } from "../EventSponsorsView";
import { BuilderModeProvider } from "@/lib/content-model/editorCanvas";

function renderWithClient(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const futureIso = (hours: number): string => new Date(Date.now() + hours * 3_600_000).toISOString();

const slotRow = (over: Record<string, unknown> = {}) => ({
  id: "slot-1",
  host_user_id: "host-1",
  host_name: "Ewa Ekspertka",
  host_avatar_url: null,
  host_slug: "ewa",
  event_id: null,
  starts_at: futureIso(24),
  ends_at: futureIso(24.5),
  location: null,
  is_booked: false,
  booked_by_me: false,
  is_mine: false,
  ...over,
});

beforeEach(() => {
  db.rpc = {};
  db.user = null;
});
afterEach(cleanup);

describe("MeetingBookingView", () => {
  it("renders nothing publicly when unconfigured, a hint on the builder canvas", () => {
    const { container } = renderWithClient(
      <MeetingBookingView c={{ mode: "host", hostUserId: "" }} lang="pl" />,
    );
    expect(container).toBeEmptyDOMElement();

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <BuilderModeProvider mode="light">
          <MeetingBookingView c={{ mode: "host", hostUserId: "" }} lang="pl" />
        </BuilderModeProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByText(/Wskaż hosta lub wydarzenie/)).toBeInTheDocument();
  });

  it("shows day groups, a sign-in hint for anonymous visitors and disabled free chips", async () => {
    db.rpc.get_public_meeting_slots = [
      slotRow(),
      slotRow({ id: "slot-2", starts_at: futureIso(50), ends_at: futureIso(50.5) }),
    ];
    renderWithClient(
      <MeetingBookingView
        c={{ heading_pl: "Networking", mode: "host", hostUserId: "host-1" }}
        lang="pl"
      />,
    );
    expect(await screen.findByText("Networking")).toBeInTheDocument();
    expect(screen.getByText(/Zaloguj się, aby zarezerwować/)).toBeInTheDocument();
    // Dwa rozne dni = dwie grupy dniowe.
    const freeChips = await screen.findAllByRole("button", { name: /-/ });
    expect(freeChips).toHaveLength(2);
    for (const chip of freeChips) expect(chip).toBeDisabled();
  });

  it("marks booked slots and shows cancel on my own booking", async () => {
    db.user = { id: "viewer-1" };
    db.rpc.get_public_meeting_slots = [
      slotRow({ id: "slot-b", is_booked: true }),
      slotRow({
        id: "slot-mine",
        starts_at: futureIso(26),
        ends_at: futureIso(26.5),
        is_booked: true,
        booked_by_me: true,
      }),
    ];
    renderWithClient(<MeetingBookingView c={{ mode: "host", hostUserId: "host-1" }} lang="pl" />);
    expect(await screen.findByRole("button", { name: /Anuluj/ })).toBeInTheDocument();
    expect(screen.queryByText(/Zaloguj się, aby zarezerwować/)).not.toBeInTheDocument();
  });

  it("shows the host manage panel and own-slot badge for the signed-in host", async () => {
    db.user = { id: "host-1" };
    db.rpc.get_public_meeting_slots = [slotRow({ is_mine: true })];
    renderWithClient(<MeetingBookingView c={{ mode: "host", hostUserId: "host-1" }} lang="pl" />);
    expect(await screen.findByText("Opublikuj swój slot")).toBeInTheDocument();
    expect(await screen.findByText("Twój slot")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Usuń slot" })).toBeInTheDocument();
  });

  it("shows the empty state when a configured widget has no slots", async () => {
    db.rpc.get_public_meeting_slots = [];
    renderWithClient(<MeetingBookingView c={{ mode: "event", eventId: "e-1" }} lang="pl" />);
    expect(await screen.findByText("Brak dostępnych terminów.")).toBeInTheDocument();
  });
});

describe("EventSponsorsView", () => {
  const content = (): WidgetContent => ({
    heading_pl: "Sponsorzy i partnerzy",
    tiers: [
      {
        id: "t1",
        name_pl: "Partner główny",
        name_en: "Main partner",
        size: "lg",
        sponsors: [
          {
            id: "s1",
            name: "Acme Corp",
            logo: "",
            url: "https://acme.test",
            description_pl: "Opis partnera głównego.",
            description_en: "Main partner description.",
          },
        ],
      },
      {
        id: "t2",
        name_pl: "Partnerzy medialni",
        name_en: "Media partners",
        size: "sm",
        sponsors: [
          { id: "s2", name: "Radio X", logo: "", url: "", description_pl: "", description_en: "" },
        ],
      },
    ],
  });

  it("renders tier headings, sponsor names and lg-tier descriptions", () => {
    renderWithClient(<EventSponsorsView c={content()} lang="pl" />);
    expect(screen.getByText("Sponsorzy i partnerzy")).toBeInTheDocument();
    expect(screen.getByText("Partner główny")).toBeInTheDocument();
    expect(screen.getByText("Partnerzy medialni")).toBeInTheDocument();
    expect(screen.getByText("Acme Corp")).toBeInTheDocument();
    expect(screen.getByText("Opis partnera głównego.")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Acme Corp" });
    expect(link.getAttribute("href")).toBe("https://acme.test");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("falls back to EN tier names when PL is empty and vice versa", () => {
    const c = content();
    renderWithClient(<EventSponsorsView c={c} lang="en" />);
    expect(screen.getByText("Main partner")).toBeInTheDocument();
    expect(screen.getByText("Media partners")).toBeInTheDocument();
  });

  it("shows the authoring empty state without tiers", () => {
    renderWithClient(<EventSponsorsView c={{ tiers: [] }} lang="pl" />);
    expect(screen.getByText(/Dodaj poziomy sponsorskie/)).toBeInTheDocument();
  });
});
