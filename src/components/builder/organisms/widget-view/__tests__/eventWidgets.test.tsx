// Pokrycie widokow ekosystemu wydarzen: EventsListView (karty/lista/pusty
// stan/liczniki RSVP), EventCountdownView (custom/event/done/hint),
// EventScheduleView (zakladki dni, sesje, przerwa ze sponsorami, prelegent
// inline i profilowy + dialog profilu) oraz SpeakersWidget w trybach zrodla
// (manual/directory) z dialogiem profilu prelegenta. Warstwa danych jest
// stubowana per-tabela + per-RPC, wiec cwiczymy realne sciezki renderu.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import type { WidgetContent, WidgetNode } from "@/lib/builder/types";

const db = vi.hoisted(() => ({
  tables: {} as Record<string, unknown[]>,
  rpc: {} as Record<string, unknown[]>,
}));

// Szpieg RPC: pozwala twierdzic, ze tryb manual NIE dotyka get_public_speakers.
const rpcSpy = vi.hoisted(() =>
  vi.fn(async (fn: string) => ({ data: db.rpc[fn] ?? [], error: null })),
);

vi.mock("@/integrations/supabase/client", () => {
  const makeBuilder = (table: string) => {
    const builder: Record<string, unknown> = {};
    const methods = [
      "select",
      "eq",
      "neq",
      "is",
      "in",
      "not",
      "gte",
      "lte",
      "gt",
      "lt",
      "order",
      "range",
      "limit",
      "or",
      "filter",
      "ilike",
      "match",
      "contains",
    ];
    for (const m of methods) builder[m] = () => builder;
    builder.single = async () => ({ data: (db.tables[table] ?? [])[0] ?? null, error: null });
    builder.maybeSingle = async () => ({
      data: (db.tables[table] ?? [])[0] ?? null,
      error: null,
    });
    builder.then = (resolve: (v: unknown) => unknown) =>
      resolve({ data: db.tables[table] ?? [], error: null });
    return builder;
  };
  return {
    supabase: {
      from: (t: string) => makeBuilder(t),
      rpc: rpcSpy,
    },
  };
});

// `initReactI18next` MUSI byc w atrapie, choc zaden widget go nie wola wprost.
// `EventScheduleView` importuje `SpeakerProfileDialog`, ten od commita `145ed72`
// wspolna plakietke eksperta, a ta - nakladke `i18n-event-front`, ktora przy
// zaladowaniu modulu robi `i18n.use(initReactI18next)`. Bez tej linii CALA suita
// nie wstaje ("No initReactI18next export is defined on the react-i18next mock"),
// czyli zielony przebieg oznaczalby zero uruchomionych testow.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? k,
    i18n: { language: "pl" },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("@tanstack/react-router", async (orig) => {
  const actual = await orig<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({
      to,
      children,
      ...rest
    }: { to?: unknown; children?: unknown } & Record<string, unknown>) => (
      <a href={typeof to === "string" ? to : "#"} {...rest}>
        {children as never}
      </a>
    ),
  };
});

import { EventsListView } from "../EventsListView";
import { EventCountdownView } from "../EventCountdownView";
import { EventScheduleView } from "../EventScheduleView";
import { SpeakersWidget } from "../SpeakersWidget";
import { BuilderModeProvider } from "@/lib/content-model/editorCanvas";

function renderWithClient(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

/** Render w kontekscie kanwy buildera (useBuilderMode() != null). */
function renderInBuilder(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <BuilderModeProvider mode="light">{ui}</BuilderModeProvider>
    </QueryClientProvider>,
  );
}

const futureIso = (days: number): string => new Date(Date.now() + days * 86_400_000).toISOString();

const eventRow = (over: Record<string, unknown> = {}) => ({
  id: "e-1",
  slug: "cyber-summit",
  title_pl: "Szczyt Cyber",
  title_en: "Cyber Summit",
  description_pl: "Opis PL",
  description_en: "Description EN",
  starts_at: futureIso(10),
  ends_at: null,
  timezone: "Europe/Warsaw",
  location: "Warszawa",
  kind: "in_person",
  capacity: null,
  cover_url: null,
  visibility: "public",
  ...over,
});

const speakerRpcRow = (over: Record<string, unknown> = {}) => ({
  user_id: "u-1",
  slug: "jan-kowalski",
  display_name: "Jan Kowalski",
  avatar_url: null,
  job_title: "Director",
  company: "NES",
  headline_pl: "Dyrektor programu Cyber",
  headline_en: "Cyber programme director",
  bio_pl: "Bio PL",
  bio_en: "Bio EN",
  topics_pl: ["cyberbezpieczenstwo"],
  topics_en: ["cybersecurity"],
  languages: ["pl", "en"],
  talks_count: 12,
  rating: 4.5,
  reviews_count: 8,
  is_expert: true,
  has_speaker_profile: true,
  sort_order: 0,
  ...over,
});

beforeEach(() => {
  db.tables = {};
  db.rpc = {};
  rpcSpy.mockClear();
});
afterEach(cleanup);

describe("EventsListView", () => {
  it("renders event cards with kind badge, countdown chip and event link", async () => {
    db.tables.events = [eventRow()];
    renderWithClient(
      <EventsListView
        c={{ heading_pl: "Wydarzenia", scope: "upcoming", variant: "cards", columns: 3 }}
        lang="pl"
      />,
    );
    expect(await screen.findByText("Szczyt Cyber")).toBeInTheDocument();
    expect(screen.getByText("Wydarzenia")).toBeInTheDocument();
    expect(screen.getByText("Stacjonarne")).toBeInTheDocument();
    expect(screen.getByText(/Za \d+ dni/)).toBeInTheDocument();
    expect(screen.getByText("Warszawa")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Szczyt Cyber" });
    expect(link.getAttribute("href")).toBe("/events/cyber-summit");
  });

  it("renders the compact list variant with a date block", async () => {
    db.tables.events = [eventRow({ starts_at: "2026-10-12T09:00:00Z" })];
    renderWithClient(
      <EventsListView c={{ scope: "all", variant: "list", showCountdown: false }} lang="en" />,
    );
    expect(await screen.findByText("Cyber Summit")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("In person")).toBeInTheDocument();
  });

  it("shows the localized empty state when no events match", async () => {
    db.tables.events = [];
    renderWithClient(
      <EventsListView
        c={{ emptyText_pl: "Nic tu nie ma.", emptyText_en: "Nothing here." }}
        lang="pl"
      />,
    );
    expect(await screen.findByText("Nic tu nie ma.")).toBeInTheDocument();
  });

  it("applies the columns setting even when the panel stored it as a string", async () => {
    db.tables.events = [eventRow()];
    const { container } = renderWithClient(
      <EventsListView c={{ variant: "cards", columns: "4" }} lang="pl" />,
    );
    await screen.findByText("Szczyt Cyber");
    expect(container.querySelector(".lg\\:grid-cols-4")).not.toBeNull();
  });

  it("shows RSVP counts when enabled", async () => {
    db.tables.events = [eventRow()];
    db.rpc.get_event_rsvp_counts = [{ event_id: "e-1", going: 42, interested: 3 }];
    renderWithClient(<EventsListView c={{ showRsvpCount: true }} lang="pl" />);
    expect(await screen.findByText(/42 zapisanych/)).toBeInTheDocument();
  });
});

describe("EventCountdownView", () => {
  it("prompts for configuration on the builder canvas when no target is set", () => {
    renderInBuilder(<EventCountdownView c={{}} lang="pl" />);
    expect(screen.getByText(/Ustaw datę odliczania/)).toBeInTheDocument();
  });

  it("renders nothing publicly when unconfigured (no editor hint for readers)", () => {
    const { container } = renderWithClient(<EventCountdownView c={{}} lang="pl" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders countdown tiles for a future custom target", async () => {
    renderWithClient(
      <EventCountdownView
        c={{ mode: "custom", targetAt: futureIso(3), title_pl: "Do startu" }}
        lang="pl"
      />,
    );
    expect(screen.getByText("Do startu")).toBeInTheDocument();
    expect(await screen.findByText("dni")).toBeInTheDocument();
    expect(screen.getByText("godz.")).toBeInTheDocument();
    expect(screen.getByText("sek.")).toBeInTheDocument();
    expect(screen.getByRole("timer")).toBeInTheDocument();
  });

  it("hides seconds when disabled and supports EN labels", async () => {
    renderWithClient(
      <EventCountdownView
        c={{ mode: "custom", targetAt: futureIso(3), showSeconds: false }}
        lang="en"
      />,
    );
    expect(await screen.findByText("days")).toBeInTheDocument();
    expect(screen.queryByText("sec")).not.toBeInTheDocument();
  });

  it("shows the finished state for past targets", async () => {
    renderWithClient(
      <EventCountdownView
        c={{ mode: "custom", targetAt: "2020-01-01T00:00:00Z", doneText_pl: "Trwa!" }}
        lang="pl"
      />,
    );
    expect(await screen.findByText("Trwa!")).toBeInTheDocument();
  });

  it("event mode pulls the start date and links to the event page", async () => {
    db.tables.events = [eventRow()];
    renderWithClient(
      <EventCountdownView
        c={{ mode: "event", eventId: "e-1", ctaLabel_pl: "Zapisz sie" }}
        lang="pl"
      />,
    );
    // Tytul spada na tytul wydarzenia, CTA linkuje do strony wydarzenia.
    expect(await screen.findByText("Szczyt Cyber")).toBeInTheDocument();
    const cta = await screen.findByRole("link", { name: /Zapisz sie/ });
    expect(cta.getAttribute("href")).toBe("/events/cyber-summit");
  });
});

const scheduleContent = (): WidgetContent => ({
  heading_pl: "Agenda",
  heading_en: "Schedule",
  intro_pl: "Dwa dni rozmow.",
  columns: 2,
  days: [
    {
      id: "day-1",
      label_pl: "Dzien 1",
      label_en: "Day 1",
      date: "2026-10-12",
      sessions: [
        {
          id: "ses-1",
          timeStart: "09:00",
          timeEnd: "10:00",
          kind: "session",
          title_pl: "Otwarcie",
          title_en: "Opening remarks",
          description_pl: "Sesja otwierajaca.",
          room: "Sala A",
          speakers: [
            { id: "sp-inline", name: "Anna Nowak", role_pl: "CTO", role_en: "CTO" },
            { id: "sp-prof", userId: "u-1", name: "Jan (fallback)", role_pl: "", role_en: "" },
          ],
          sponsors: [],
        },
        {
          id: "ses-2",
          timeStart: "10:00",
          timeEnd: "10:30",
          kind: "break",
          title_pl: "Kawa i networking",
          title_en: "Coffee & networking",
          speakers: [],
          sponsors: [{ id: "spn-1", name: "Acme", logo: "", url: "https://acme.test" }],
        },
      ],
    },
    {
      id: "day-2",
      label_pl: "Dzien 2",
      label_en: "Day 2",
      date: "2026-10-13",
      sessions: [
        {
          id: "ses-3",
          timeStart: "11:00",
          timeEnd: "12:00",
          kind: "session",
          title_pl: "Panel drugi",
          title_en: "Second panel",
          speakers: [],
          sponsors: [],
        },
      ],
    },
  ],
});

describe("EventScheduleView", () => {
  it("renders day tabs, time badges, rooms and sessions of the active day", async () => {
    db.rpc.get_public_speakers = [speakerRpcRow()];
    renderWithClient(<EventScheduleView c={scheduleContent()} lang="pl" />);
    expect(screen.getByText("Agenda")).toBeInTheDocument();
    expect(screen.getByText("Dwa dni rozmow.")).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    expect(screen.getByText("Otwarcie")).toBeInTheDocument();
    expect(screen.getByText("09:00 - 10:00")).toBeInTheDocument();
    expect(screen.getByText("Sala A")).toBeInTheDocument();
    // Sesja drugiego dnia jest ukryta do czasu przelaczenia zakladki.
    expect(screen.queryByText("Panel drugi")).not.toBeInTheDocument();
  });

  it("switches days via tabs", () => {
    renderWithClient(<EventScheduleView c={scheduleContent()} lang="pl" />);
    fireEvent.click(screen.getByRole("tab", { name: /Dzien 2/ }));
    expect(screen.getByText("Panel drugi")).toBeInTheDocument();
    expect(screen.queryByText("Otwarcie")).not.toBeInTheDocument();
  });

  it("renders break sponsors", () => {
    renderWithClient(<EventScheduleView c={scheduleContent()} lang="pl" />);
    expect(screen.getByText("Sponsorzy:")).toBeInTheDocument();
    expect(screen.getByText("Acme")).toBeInTheDocument();
  });

  it("resolves profile-linked speakers from the RPC and opens the profile dialog", async () => {
    db.rpc.get_public_speakers = [speakerRpcRow()];
    renderWithClient(<EventScheduleView c={scheduleContent()} lang="pl" />);
    // Wpis reczny renderuje sie od razu; profilowy po odpowiedzi RPC
    // (imie z profilu wygrywa nad fallbackiem z tresci).
    expect(screen.getByText("Anna Nowak")).toBeInTheDocument();
    const profileButton = await screen.findByRole("button", { name: /Jan Kowalski/ });
    expect(screen.getByText("Dyrektor programu Cyber")).toBeInTheDocument();

    fireEvent.click(profileButton);
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
    // Dialog profilu: bio + tematy + link do pelnego profilu eksperta.
    expect(await screen.findByText("Bio PL")).toBeInTheDocument();
    expect(screen.getByText("cyberbezpieczenstwo")).toBeInTheDocument();
    const fullProfile = await screen.findByRole("link", { name: /Zobacz pełny profil/ });
    expect(fullProfile.getAttribute("href")).toBe("/author/jan-kowalski");
  });

  it("shows an authoring hint when the schedule is empty", () => {
    renderWithClient(<EventScheduleView c={{ days: [] }} lang="pl" />);
    expect(screen.getByText(/Dodaj dni i sesje agendy/)).toBeInTheDocument();
  });

  it("stacks every day with its own header when day tabs are disabled", () => {
    renderWithClient(
      <EventScheduleView c={{ ...scheduleContent(), showDayTabs: false }} lang="pl" />,
    );
    // Bez zakladek zaden dzien nie moze byc nieosiagalny - oba dni na stronie.
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(screen.getByText("Otwarcie")).toBeInTheDocument();
    expect(screen.getByText("Panel drugi")).toBeInTheDocument();
    expect(screen.getByText("Dzien 1")).toBeInTheDocument();
    expect(screen.getByText("Dzien 2")).toBeInTheDocument();
  });
});

const speakersNode = (content: WidgetContent): WidgetNode => ({
  id: "w-speakers",
  kind: "widget",
  type: "speakers",
  content,
});

describe("SpeakersWidget - data sources", () => {
  it("manual source renders authored entries without touching the RPC", () => {
    renderWithClient(
      <SpeakersWidget
        node={speakersNode({
          heading_pl: "Prelegenci",
          speakers: [
            {
              id: "m-1",
              name: "Maria Test",
              role_pl: "Analityczka",
              role_en: "Analyst",
              organization: "Fundacja Testowa",
              gigs: 3,
              rating: 0,
              reviews: 0,
            },
          ],
        })}
        lang="pl"
      />,
    );
    expect(screen.getByText("Maria Test")).toBeInTheDocument();
    expect(screen.getByText(/Analityczka/)).toBeInTheDocument();
    // ORGANIZACJA wpisu RECZNEGO idzie z pola edytora studia. Ten fakt stal
    // wczesniej wylacznie na stronie wydarzenia (`company` z RPC), a model
    // tresci widgetu nie mial dla niego kolumny w ogole.
    expect(screen.getByText("Fundacja Testowa")).toBeInTheDocument();
    expect(rpcSpy).not.toHaveBeenCalledWith("get_public_speakers", expect.anything());
  });

  it("manual entry WITHOUT an organization renders no empty affiliation line", () => {
    // Puste pole nie ma prawa zostawic wiersza bez tresci pod nazwiskiem -
    // to wyglada jak brakujace dane, a nie jak brak afiliacji.
    const { container } = renderWithClient(
      <SpeakersWidget
        node={speakersNode({
          speakers: [{ id: "m-1", name: "Maria Test", role_pl: "Analityczka" }],
        })}
        lang="pl"
      />,
    );
    expect(screen.getByText("Maria Test")).toBeInTheDocument();
    // Zawezone do KARTY: `cms-meta` nosi tez licznik wynikow nad siatka.
    expect(container.querySelectorAll("article p.cms-meta")).toHaveLength(1);
  });

  it("directory source renders CRM-backed speaker profiles with the expert badge", async () => {
    db.rpc.get_public_speakers = [speakerRpcRow()];
    renderWithClient(
      <SpeakersWidget node={speakersNode({ source: "directory", limit: 24 })} lang="pl" />,
    );
    expect(await screen.findByText("Jan Kowalski")).toBeInTheDocument();
    expect(screen.getByText("Ekspert")).toBeInTheDocument();
    expect(screen.getByText(/Dyrektor programu Cyber/)).toBeInTheDocument();
    // AFILIACJA Z KOLUMNY `company` tego samego wiersza RPC, ktory niesie
    // `is_expert`. Karta pokazywala tytul eksperta bez organizacji, wiec ta
    // sama osoba miala w widgecie mniej faktow niz na stronie wydarzenia.
    expect(screen.getByText("NES")).toBeInTheDocument();
  });

  it("event source renders the organization from the same RPC row", async () => {
    // Zrodlo „prelegenci wydarzenia" idzie WLASNA projekcja
    // (`event_speakers_public`), bo katalog zlacza rejestr z `profiles` przez
    // INNER JOIN i gubi prelegenta BEZ konta. Afiliacja ma jednak wygladac tak
    // samo, jak w katalogu - mapowanie wiersza jest wspolne.
    db.rpc.event_speakers_public = [
      speakerRpcRow({ company: "Kancelaria Brukselska", person_id: "p-1" }),
    ];
    renderWithClient(
      <SpeakersWidget node={speakersNode({ source: "event", eventId: "e-1" })} lang="pl" />,
    );
    expect(await screen.findByText("Jan Kowalski")).toBeInTheDocument();
    expect(screen.getByText("Kancelaria Brukselska")).toBeInTheDocument();
  });


  it("row without a company renders no empty affiliation line", async () => {
    db.rpc.get_public_speakers = [speakerRpcRow({ company: null })];
    const { container } = renderWithClient(
      <SpeakersWidget node={speakersNode({ source: "directory" })} lang="pl" />,
    );
    expect(await screen.findByText("Jan Kowalski")).toBeInTheDocument();
    // Zostaje sam wiersz roli (`cms-meta`) i opis - bez trzeciego, pustego.
    expect([...container.querySelectorAll("article p.cms-meta")].map((n) => n.textContent)).toEqual(
      ["Dyrektor programu Cyber · 12 wystąpień", "Bio PL"],
    );
  });

  it("directory source opens the speaker profile dialog on card click", async () => {
    db.rpc.get_public_speakers = [speakerRpcRow()];
    renderWithClient(<SpeakersWidget node={speakersNode({ source: "directory" })} lang="pl" />);
    const card = await screen.findByRole("button", { name: "Jan Kowalski" });
    fireEvent.click(card);
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
    // Bio pojawia sie i na karcie, i w dialogu - zawezamy do dialogu.
    const dialog = screen.getByRole("dialog");
    expect(await within(dialog).findByText("Bio PL")).toBeInTheDocument();
  });

  it("directory source shows a dedicated empty state", async () => {
    db.rpc.get_public_speakers = [];
    renderWithClient(<SpeakersWidget node={speakersNode({ source: "directory" })} lang="pl" />);
    expect(await screen.findByText("Brak publicznych profili prelegentów.")).toBeInTheDocument();
  });

  it("event source without a picked event renders the empty state, not the directory", async () => {
    // Katalog jest niepusty - gdyby p_event_id=null przeszlo do RPC,
    // widget pokazalby caly katalog zamiast stanu nieskonfigurowanego.
    db.rpc.get_public_speakers = [speakerRpcRow()];
    renderWithClient(
      <SpeakersWidget node={speakersNode({ source: "event", eventId: "" })} lang="pl" />,
    );
    expect(await screen.findByText("Brak publicznych profili prelegentów.")).toBeInTheDocument();
    expect(screen.queryByText("Jan Kowalski")).not.toBeInTheDocument();
    expect(rpcSpy).not.toHaveBeenCalledWith("get_public_speakers", expect.anything());
  });
});

const manualRoster = (): WidgetContent => ({
  speakers: [
    {
      id: "m-1",
      name: "Alfa Pierwsza",
      role_pl: "Analityczka",
      role_en: "Analyst",
      organization: "Instytut Alfa",
      category_pl: "Cyber",
      category_en: "Cyber",
      gigs: 10,
      rating: 5,
      reviews: 20,
      description_pl: "Opis alfa",
      description_en: "Alpha description",
    },
    {
      id: "m-2",
      name: "Beta Druga",
      role_pl: "Ekonomista",
      role_en: "Economist",
      organization: "Fundacja Beta",
      category_pl: "Ekonomia",
      category_en: "Economy",
      gigs: 2,
      rating: 3,
      reviews: 5,
      description_pl: "Opis beta",
      description_en: "Beta description",
    },
  ],
});

describe("SpeakersWidget - behaviors (filter/search/sort/pagination)", () => {
  it("filters by category chips", () => {
    renderWithClient(<SpeakersWidget node={speakersNode(manualRoster())} lang="pl" />);
    expect(screen.getByText("Alfa Pierwsza")).toBeInTheDocument();
    expect(screen.getByText("Beta Druga")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /Cyber/ }));
    expect(screen.getByText("Alfa Pierwsza")).toBeInTheDocument();
    expect(screen.queryByText("Beta Druga")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /Wszyscy/ }));
    expect(screen.getByText("Beta Druga")).toBeInTheDocument();
  });

  it("searches across name, role and description", () => {
    renderWithClient(<SpeakersWidget node={speakersNode(manualRoster())} lang="pl" />);
    const input = screen.getByRole("searchbox");
    fireEvent.change(input, { target: { value: "ekonom" } });
    expect(screen.getByText("Beta Druga")).toBeInTheDocument();
    expect(screen.queryByText("Alfa Pierwsza")).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: "brak-takiego" } });
    expect(screen.getByText("Brak wyników wyszukiwania.")).toBeInTheDocument();
  });

  it("searches across the ORGANIZATION shown on the card", () => {
    // Pole szukania, ktore nie widzi napisu stojacego pod nazwiskiem, odpowiada
    // „brak wynikow" na fraze, ktora czytelnik ma przed oczami - dlatego
    // organizacja weszla do worka razem z rysunkiem na karcie.
    renderWithClient(<SpeakersWidget node={speakersNode(manualRoster())} lang="pl" />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "instytut" } });
    expect(screen.getByText("Alfa Pierwsza")).toBeInTheDocument();
    expect(screen.queryByText("Beta Druga")).not.toBeInTheDocument();
  });

  it("sorts by rating when selected", () => {
    renderWithClient(<SpeakersWidget node={speakersNode(manualRoster())} lang="pl" />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "rating" } });
    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(["Alfa Pierwsza", "Beta Druga"]);
  });

  it("paginates with the load-more button", () => {
    renderWithClient(
      <SpeakersWidget node={speakersNode({ ...manualRoster(), pageSize: 1 })} lang="pl" />,
    );
    expect(screen.getByText("Alfa Pierwsza")).toBeInTheDocument();
    expect(screen.queryByText("Beta Druga")).not.toBeInTheDocument();
    const loadMore = screen.getByRole("button", { name: /Pokaż więcej/ });
    expect(loadMore).toHaveTextContent("(1/2)");
    fireEvent.click(loadMore);
    expect(screen.getByText("Beta Druga")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Pokaż więcej/ })).not.toBeInTheDocument();
  });

  it("renders the scroll-mode sentinel when pageMode is scroll", () => {
    renderWithClient(
      <SpeakersWidget
        node={speakersNode({ ...manualRoster(), pageSize: 1, pageMode: "scroll" })}
        lang="pl"
      />,
    );
    expect(screen.getByText(/Wczytywanie/)).toBeInTheDocument();
  });
});
