// EventCountdownCardView: karta wydarzenia z odliczaniem. Testujemy tryb
// custom (ręczna data/obraz/uczestnicy), tryb event (dane + RSVP z modułu
// events, link /events/$slug), stany odliczania (przyszłość, "Już wkrótce!",
// zakończone), przełączniki sekcji (sekundy, uczestnicy, lokalizacja,
// countdown), CTA (własne vs domyślne per stan) oraz podpowiedź w builderze
// przy braku daty.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

const db = vi.hoisted(() => ({
  event: null as unknown,
  rsvp: [] as unknown[],
}));

vi.mock("@/integrations/supabase/client", () => {
  const makeBuilder = () => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "is", "order", "limit", "range"]) b[m] = () => b;
    b.maybeSingle = async () => ({ data: db.event, error: null });
    b.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null });
    return b;
  };
  return {
    supabase: {
      from: () => makeBuilder(),
      rpc: async (fn: string) => ({
        data: fn === "get_event_rsvp_counts" ? db.rsvp : [],
        error: null,
      }),
    },
  };
});

import { EventCountdownCardView } from "../EventCountdownCardView";
import { BuilderModeProvider } from "@/lib/content-model/editorCanvas";
import type { WidgetContent } from "@/lib/builder/types";

function wrap(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

function renderCard(c: WidgetContent, lang: "pl" | "en" = "pl") {
  return wrap(<EventCountdownCardView c={c} lang={lang} />);
}

const isoIn = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();

beforeEach(() => {
  db.event = null;
  db.rsvp = [];
});
afterEach(cleanup);

describe("EventCountdownCardView - tryb custom", () => {
  it("renders the countdown grid with seconds, meta and image for a future date", () => {
    const { container } = renderCard({
      targetAt: isoIn(50.02), // > 24h -> bez badge "Już wkrótce!" (bufor ~1 min na czas testu)
      title_pl: "Forum Bezpieczeństwa",
      image: "https://cdn.example.com/cover.jpg",
      attendees: 128,
      location_pl: "Warszawa",
      accentColor: "#ff5500",
      href: "https://example.com/rsvp",
      ctaLabel_pl: "Zapisz się",
    });

    expect(screen.getByText("Forum Bezpieczeństwa")).toBeInTheDocument();
    expect(screen.getByText("128 uczestników")).toBeInTheDocument();
    expect(screen.getByText("Warszawa")).toBeInTheDocument();
    expect(screen.getByText("Start za:")).toBeInTheDocument();

    // Pełna siatka: dni / godziny / minuty / sekundy.
    const timer = screen.getByRole("timer");
    expect(timer.style.gridTemplateColumns).toBe("repeat(4, minmax(0, 1fr))");
    expect(screen.getByText("dni")).toBeInTheDocument();
    expect(screen.getByText("sek.")).toBeInTheDocument();
    // 50h -> 2 dni i 2 godziny.
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("02")).toBeInTheDocument();

    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "https://cdn.example.com/cover.jpg",
    );
    expect(screen.queryByText("Już wkrótce!")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Zapisz się/ })).toHaveAttribute(
      "href",
      "https://example.com/rsvp",
    );
    // Akcent wpięty przez zmienną CSS.
    const section = container.querySelector("section") as HTMLElement;
    expect(section.getAttribute("style")).toContain("--ecc-accent: #ff5500");
  });

  it("shows the 'starts soon' badge under 24h and the default reserve CTA", () => {
    renderCard({
      targetAt: isoIn(2),
      image: "https://cdn.example.com/c.jpg",
      href: "/wydarzenie",
    });
    expect(screen.getByText("Już wkrótce!")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Zarezerwuj miejsce/ })).toBeInTheDocument();
  });

  it("renders the done state with custom texts and the EN join CTA", () => {
    const first = renderCard(
      {
        targetAt: new Date(Date.now() - 3_600_000).toISOString(),
        doneText_pl: "Trwamy!",
        doneHint_pl: "Wbijaj na salę",
        href: "/join",
      },
      "pl",
    );
    expect(screen.getByRole("status")).toHaveTextContent("Trwamy!");
    expect(screen.getByText("Wbijaj na salę")).toBeInTheDocument();
    first.unmount();

    renderCard({ targetAt: new Date(Date.now() - 1000).toISOString(), href: "/join" }, "en");
    expect(screen.getByText("Event started!")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Join event/ })).toBeInTheDocument();
  });

  it("honors the section switches (seconds, countdown, attendees, location)", () => {
    const noSeconds = renderCard({ targetAt: isoIn(50), showSeconds: "0", attendees: 5 });
    // Bez sekund siatka ma 3 kolumny.
    expect(screen.getByRole("timer").style.gridTemplateColumns).toBe("repeat(3, minmax(0, 1fr))");
    expect(screen.queryByText("sek.")).not.toBeInTheDocument();
    noSeconds.unmount();

    renderCard({
      targetAt: isoIn(50),
      showCountdown: "0",
      showAttendees: "0",
      showLocation: "0",
      attendees: 5,
      location_pl: "Kraków",
      enableAnimations: "0",
    });
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();
    expect(screen.queryByText("Start za:")).not.toBeInTheDocument();
    expect(screen.queryByText("5 uczestników")).not.toBeInTheDocument();
    expect(screen.queryByText("Kraków")).not.toBeInTheDocument();
  });
});

describe("EventCountdownCardView - tryb event", () => {
  it("pulls title, cover, location, RSVP count and links to /events/$slug", async () => {
    db.event = {
      id: "ev-1",
      slug: "forum-2026",
      title_pl: "Forum PL",
      title_en: "Forum EN",
      starts_at: isoIn(72),
      cover_url: "https://cdn.example.com/ev.jpg",
      location: "Bruksela",
    };
    db.rsvp = [{ event_id: "ev-1", going: 42, interested: 7 }];
    renderCard({ mode: "event", eventId: "ev-1" }, "en");

    expect(await screen.findByText("Forum EN")).toBeInTheDocument();
    expect(await screen.findByText("42 attending")).toBeInTheDocument();
    expect(screen.getByText("Bruksela")).toBeInTheDocument();
    expect(screen.getByText("Event starts in:")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Reserve your spot/ })).toHaveAttribute(
      "href",
      "/events/forum-2026",
    );
  });

  it("falls back to the PL title when EN is empty", async () => {
    db.event = {
      id: "ev-2",
      slug: "tylko-pl",
      title_pl: "Tylko polski tytuł",
      title_en: "",
      starts_at: isoIn(72),
      cover_url: null,
      location: null,
    };
    renderCard({ mode: "event", eventId: "ev-2" }, "en");
    expect(await screen.findByText("Tylko polski tytuł")).toBeInTheDocument();
  });
});

describe("EventCountdownCardView - brak celu odliczania", () => {
  it("renders nothing publicly and a hint on the builder canvas", () => {
    const pub = renderCard({ targetAt: "nie-data" });
    expect(pub.container).toBeEmptyDOMElement();
    pub.unmount();

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <BuilderModeProvider mode="light">
          <EventCountdownCardView c={{}} lang="en" />
        </BuilderModeProvider>
      </QueryClientProvider>,
    );
    expect(
      screen.getByText("Set the countdown date (or pick an event) in the widget panel."),
    ).toBeInTheDocument();
  });
});
