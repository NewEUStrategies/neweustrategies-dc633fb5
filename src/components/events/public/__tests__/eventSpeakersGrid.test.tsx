import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PublicSpeakerRow } from "@/lib/builder/speakersQuery";

const h = vi.hoisted(() => ({
  rows: [] as unknown[],
  calls: [] as Array<{ input: unknown; lang: unknown }>,
  /** Ile razy zapytanie o prelegentów NAPRAWDĘ poszło do bazy. */
  fetches: 0,
  language: "pl",
  error: null as Error | null,
  /** Flagi `enabled` zapytań wzbogacających katalog - render po renderze. */
  agendaEnabled: [] as boolean[],
  sponsorsEnabled: [] as boolean[],
  agenda: [] as unknown[],
  noSponsors: [] as unknown[],
}));

vi.mock("react-i18next", async () => {
  const { translateKey } = await import("@/test/i18nStub");
  return {
    useTranslation: () => ({
      t: translateKey,
      i18n: { language: h.language, exists: () => true, changeLanguage: () => Promise.resolve() },
    }),
    initReactI18next: { type: "3rdParty", init: () => undefined },
  };
});

vi.mock("@/lib/builder/speakersQuery", () => ({
  speakersQueryOptions: (input: unknown, lang: unknown) => {
    h.calls.push({ input, lang });
    return {
      queryKey: ["speakers", JSON.stringify(input), lang],
      queryFn: () => {
        h.fetches += 1;
        if (h.error !== null) throw h.error;
        return h.rows;
      },
    };
  },
  // Okno osoby z kontem dociąga jej inne wystąpienia - tu bez wyników.
  speakerEngagementsQueryOptions: (userId: string) => ({
    queryKey: ["engagements", userId],
    queryFn: () => [],
  }),
}));

// Migawka wydarzenia po slugu - ten sam klucz, który grzeje powłoka trasy.
vi.mock("@/lib/community/publicQueries", () => ({
  publicEventBySlugQueryOptions: (slug: string) => ({
    queryKey: ["event", slug],
    queryFn: () => ({ id: "e1", slug }),
  }),
}));

// Źródła wzbogacające katalog: zapisujemy `enabled`, żeby zmierzyć, że śpią
// do pierwszego sygnału zamiaru.
vi.mock("@/lib/events/usePublicEvent", () => ({
  useEventAgenda: (_slug: string, enabled = true) => {
    h.agendaEnabled.push(enabled);
    return { data: enabled ? h.agenda : undefined };
  },
  usePublicEventSponsors: (_slug: string, enabled = true) => {
    h.sponsorsEnabled.push(enabled);
    return { data: enabled ? h.noSponsors : undefined };
  },
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));

const { EventSpeakersGrid } =
  await import("@/components/events/public/organisms/EventSpeakersGrid");
const { publicEventErrorMessage } = await import("@/lib/events/publicEventErrors");

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function speaker(overrides: Partial<PublicSpeakerRow> = {}): PublicSpeakerRow {
  return {
    user_id: "u1",
    slug: "anna-kowalska",
    display_name: "Anna Kowalska",
    avatar_url: null,
    job_title: "Dyrektor",
    company: "NASK",
    headline_pl: "Prezes",
    headline_en: "President",
    bio_pl: null,
    bio_en: null,
    topics_pl: [],
    topics_en: [],
    languages: [],
    talks_count: 0,
    rating: 0,
    reviews_count: 0,
    is_expert: false,
    has_speaker_profile: true,
    sort_order: 0,
    ...overrides,
  };
}

describe("EventSpeakersGrid", () => {
  beforeEach(() => {
    h.rows = [];
    h.calls = [];
    h.fetches = 0;
    h.language = "pl";
    h.error = null;
    h.agendaEnabled = [];
    h.sponsorsEnabled = [];
    h.agenda = [];
  });

  it("pyta o prelegentów właściwego wydarzenia", async () => {
    h.rows = [speaker()];
    render(<EventSpeakersGrid eventId="e1" limit={12} />, { wrapper });
    await screen.findByText("Anna Kowalska");
    expect(h.calls[0]?.input).toEqual({ source: "event", eventId: "e1", limit: 12 });
  });

  it("pusta lista nie rysuje pustej sekcji", async () => {
    const { container } = render(<EventSpeakersGrid eventId="e1" />, { wrapper });
    await waitFor(() => expect(container.innerHTML).toBe(""));
  });

  it("pokazuje pełne wartości stanowiska i instytucji", async () => {
    h.rows = [
      speaker({
        display_name: "Lech Kurkliński",
        headline_pl: "Profesor",
        company: "Szkoła Główna Handlowa w Warszawie",
      }),
    ];
    render(<EventSpeakersGrid eventId="e1" />, { wrapper });
    expect((await screen.findByText("Lech Kurkliński")).textContent).toBe("Lech Kurkliński");
    // Pełna wartość stoi w treści - karta łamie linie zamiast ucinać wielokropkiem.
    const position = screen.getByText("Profesor");
    const institution = screen.getByText("Szkoła Główna Handlowa w Warszawie");
    for (const node of [position, institution]) {
      expect(node.className).not.toMatch(/truncate|line-clamp/);
    }
  });

  it("bez zdjęcia pokazuje inicjały", async () => {
    h.rows = [speaker()];
    const { container } = render(<EventSpeakersGrid eventId="e1" />, { wrapper });
    await screen.findByText("Anna Kowalska");
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("AK")).toBeTruthy();
  });

  it("klik w interaktywną kartę przekazuje cały wiersz", async () => {
    const row = speaker();
    h.rows = [row];
    const onSelect = vi.fn();
    render(<EventSpeakersGrid eventId="e1" onSelect={onSelect} />, { wrapper });
    fireEvent.click(
      await screen.findByRole("button", {
        name: "eventFront.speakers.card.openProfile(lng=pl,name=Anna Kowalska)",
      }),
    );
    expect(onSelect).toHaveBeenCalledWith(row);
  });

  it("zmienia treść zgodnie z językiem interfejsu", async () => {
    h.language = "en";
    h.rows = [speaker()];
    render(<EventSpeakersGrid eventId="e1" />, { wrapper });
    expect(await screen.findByText("President")).toBeTruthy();
    expect(screen.queryByText("Prezes")).toBeNull();
    expect(h.calls[0]?.lang).toBe("en");
  });

  it("podczas wczytywania zachowuje stabilne miejsce na portrety", () => {
    const { container } = render(<EventSpeakersGrid eventId="e1" enabled={false} />, { wrapper });
    const busy = screen.getByLabelText("eventFront.speakers.loading");
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect(container.querySelectorAll('[aria-busy="true"] > div')).toHaveLength(8);
    // Kadr zastępczy ma proporcję portretu karty - wysokość nie skacze.
    expect(container.querySelector('[class*="aspect-[4/5]"]')).not.toBeNull();
  });

  it("błąd danych pokazuje bezpieczny komunikat", async () => {
    h.error = new Error("violates check constraint");
    const { container } = render(<EventSpeakersGrid eventId="e1" />, { wrapper });
    expect(await screen.findByText(publicEventErrorMessage(h.error))).toBeTruthy();
    expect(container.textContent).not.toContain("violates check constraint");
  });

  it("portrety pierwszego wiersza ładują się od razu, dalsze leniwie", async () => {
    // Kadr 4:5 bywa największym obrazem ekranu - `lazy` opóźniałby LCP.
    h.rows = Array.from({ length: 7 }, (_, index) =>
      speaker({
        user_id: `u${index}`,
        display_name: `Osoba ${index}`,
        avatar_url: `https://proj.supabase.co/storage/v1/object/public/avatars/${index}.jpg`,
      }),
    );
    const { container } = render(<EventSpeakersGrid eventId="e1" />, { wrapper });
    await screen.findByText("Osoba 6");
    const loading = [...container.querySelectorAll("li img")].map((img) =>
      img.getAttribute("loading"),
    );
    expect(loading).toEqual(["eager", "eager", "eager", "eager", "lazy", "lazy", "lazy"]);
  });

  it("bez slugu nie składa katalogu okien i nie pyta o migawkę wydarzenia", async () => {
    h.rows = [speaker()];
    render(<EventSpeakersGrid eventId="e1" />, { wrapper });
    await screen.findByText("Anna Kowalska");
    expect(h.agendaEnabled).toEqual([]);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

const OPEN_ANNA = "eventFront.speakers.card.openProfile(lng=pl,name=Anna Kowalska)";
const OPEN_NASK = "eventFront.directory.openCompany(lng=pl,name=NASK)";
/** Okno jest leniwym chunkiem - pierwsze pobranie w teście trwa dłużej niż 1 s. */
const DIALOG_WAIT = { timeout: 5000 };

function agendaSession(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: "s1",
    titlePl: "Panel otwarcia",
    titleEn: "Opening panel",
    affiliationPl: null,
    affiliationEn: null,
    startsAt: "2026-11-12T09:00:00Z",
    endsAt: "2026-11-12T10:00:00Z",
    timezone: "Europe/Warsaw",
    room: null,
    status: "scheduled",
    sponsor: null,
    track: null,
    speakers: [
      {
        userId: "u1",
        slug: "anna-kowalska",
        displayName: "Anna Kowalska",
        avatarUrl: null,
        headlinePl: "Prezes",
        headlineEn: "President",
        role: "moderator",
        sortOrder: 0,
      },
    ],
    ...overrides,
  };
}

describe("EventSpeakersGrid - okna profilu na zakładce (slug)", () => {
  beforeEach(() => {
    h.rows = [];
    h.calls = [];
    h.fetches = 0;
    h.language = "pl";
    h.error = null;
    h.agendaEnabled = [];
    h.sponsorsEnabled = [];
    h.agenda = [];
  });

  it("klik w kartę otwiera okno osoby z faktami z wiersza, bez drugiego zapytania", async () => {
    h.rows = [speaker({ bio_pl: "Biogram Anny Kowalskiej" })];
    render(<EventSpeakersGrid eventId="e1" slug="szczyt" />, { wrapper });

    const card = await screen.findByRole("button", { name: OPEN_ANNA });
    expect(card.getAttribute("aria-haspopup")).toBe("dialog");
    fireEvent.click(card);

    const dialog = await screen.findByRole("dialog", {}, DIALOG_WAIT);
    expect(within(dialog).getByRole("heading", { level: 2, name: "Anna Kowalska" })).toBeTruthy();
    expect(within(dialog).getByText("Biogram Anny Kowalskiej")).toBeTruthy();
    // Katalog dostał wiersze siatki (`own.speakers`) - lista nie poszła drugi raz.
    expect(h.fetches).toBe(1);
  });

  it("program i partnerzy śpią do pierwszego sygnału zamiaru, potem okno ma sesje osoby", async () => {
    h.rows = [speaker()];
    h.agenda = [agendaSession()];
    render(<EventSpeakersGrid eventId="e1" slug="szczyt" />, { wrapper });

    const card = await screen.findByRole("button", { name: OPEN_ANNA });
    // Wejście na zakładkę nie płaci za program ani partnerów.
    expect(h.agendaEnabled.length).toBeGreaterThan(0);
    expect(h.agendaEnabled.every((enabled) => !enabled)).toBe(true);
    expect(h.sponsorsEnabled.every((enabled) => !enabled)).toBe(true);

    fireEvent.focus(card);
    await waitFor(() => expect(h.agendaEnabled.at(-1)).toBe(true));
    expect(h.sponsorsEnabled.at(-1)).toBe(true);

    fireEvent.click(card);
    const dialog = await screen.findByRole("dialog", {}, DIALOG_WAIT);
    expect(await within(dialog).findByText("Panel otwarcia")).toBeTruthy();
  });

  it("klik w instytucję otwiera okno instytucji z osobami z tej instytucji", async () => {
    h.rows = [speaker(), speaker({ user_id: "u2", slug: "jan-nowak", display_name: "Jan Nowak" })];
    render(<EventSpeakersGrid eventId="e1" slug="szczyt" />, { wrapper });

    const companies = await screen.findAllByRole("button", { name: OPEN_NASK });
    expect(companies).toHaveLength(2);
    fireEvent.click(companies[0]);

    const dialog = await screen.findByRole("dialog", {}, DIALOG_WAIT);
    expect(within(dialog).getByRole("heading", { level: 2, name: "NASK" })).toBeTruthy();
    expect(
      within(dialog).getByRole("button", {
        name: "eventFront.directory.openPerson(name=Anna Kowalska)",
      }),
    ).toBeTruthy();
    expect(
      within(dialog).getByRole("button", {
        name: "eventFront.directory.openPerson(name=Jan Nowak)",
      }),
    ).toBeTruthy();
  });

  it("osoba bez konta i bez faktów ponad kartę nie jest przyciskiem; jedno `li` na osobę", async () => {
    h.rows = [
      speaker({
        user_id: "",
        person_id: "p-maria",
        speaker_profile_id: "sp-maria",
        slug: null,
        display_name: "Maria Sucha",
        headline_pl: null,
        headline_en: null,
        job_title: "Rzeczniczka",
        company: "Ministerstwo Cyfryzacji",
      }),
      speaker(),
    ];
    const { container } = render(<EventSpeakersGrid eventId="e1" slug="szczyt" />, { wrapper });

    await screen.findByRole("button", { name: OPEN_ANNA });
    expect(screen.queryByRole("button", { name: /Maria Sucha/ })).toBeNull();
    // Instytucja zostaje przyciskiem - okno instytucji ma co pokazać.
    expect(
      screen.getByRole("button", {
        name: "eventFront.directory.openCompany(lng=pl,name=Ministerstwo Cyfryzacji)",
      }),
    ).toBeTruthy();
    // Przyciski okien nie zagnieżdżają list: dwie osoby = dwie pozycje.
    expect(container.querySelectorAll("li")).toHaveLength(2);
  });
});
