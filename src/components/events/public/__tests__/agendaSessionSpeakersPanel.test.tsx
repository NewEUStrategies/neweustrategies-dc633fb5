// Obsada sesji w programie: prawa kolumna prelegentów i ich ścieżki.
//
// SPRAWDZAMY KONTRAKT, NIE WYGLĄD. i18n jest atrapą kluczy (`@/test/i18nStub`),
// więc asercje czytają klucze i parametry, a nie tłumaczenia. Tu pilnujemy:
// 1. prelegenci stoją w LIŚCIE z etykietą obok kolumny plakietek (dwie kolumny
//    jednej siatki), a sesja bez obsady nie ma ani listy, ani siatki,
// 2. „Pokaż szczegóły" istnieje także przy PUSTYM opisie, gdy jest obsada,
//    a `aria-controls` wskazuje wyłącznie regiony, które naprawdę są w DOM,
// 3. opis jest ukryty do rozwinięcia i stoi POD siatką na pełnej szerokości,
// 4. ścieżki przy nazwisku pojawiają się DOPIERO po rozwinięciu; z indeksem
//    programu prawdą jest indeks, bez indeksu - własna ścieżka sesji,
// 5. tablica programu liczy ścieżki z CAŁEGO programu - filtr ścieżki ani dnia
//    nie zmienia tego, w czym osoba występuje,
// 6. reszta bloku (sponsor, sala, kontrolka zapisu, strefa, harmonogram) - żeby
//    przebudowa układu niczego po drodze nie zgubiła,
// 7. HTML z serwera i pierwszy render klienta są identyczne także z obsadą:
//    identyfikatory w `aria-controls` pochodzą z `useId`, a ścieżki przy
//    nazwiskach dochodzą dopiero po kliknięciu - hydratacja nie ma czego
//    przerysowywać.
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import type { AgendaSession, AgendaSpeaker, AgendaTrack } from "@/lib/events/agendaSurface";
import type { SpeakerTrack } from "@/lib/events/speakerCard";

const h = vi.hoisted(() => ({ lang: "pl" }));

// Fabryka importuje `@/test/i18nStub` - moduł BEZ importów z produkcji
// (inaczej cykl inicjalizacji zawiesza plik). `t()` zwraca klucz, a parametry
// dokleja w nawiasie posortowane alfabetycznie.
vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.lang),
);

const { AgendaSessionCard } =
  await import("@/components/events/public/molecules/AgendaSessionCard");
const { EventAgendaBoardView } =
  await import("@/components/events/public/organisms/EventAgendaBoardView");
const { browserTimeZone } = await import("@/lib/events/timezone");
const { mediaRenderUrl } = await import("@/lib/media/publicUrl");

const SPEAKERS_LABEL = "eventFront.agenda.speakersLabel";
const TRACKS_LABEL = "eventFront.agenda.speakerTracksLabel:";
const OPEN = "eventFront.agenda.openDetails";
const CLOSE = "eventFront.agenda.closeDetails";

function track(over: Partial<AgendaTrack> & { id: string }): AgendaTrack {
  return {
    key: over.id,
    namePl: null,
    nameEn: null,
    accentColor: null,
    sponsor: null,
    ...over,
  };
}

const ENERGY = track({
  id: "t1",
  key: "energia",
  namePl: "Energia",
  nameEn: "Energy",
  accentColor: "#2563eb",
});
const WORK = track({ id: "t2", key: "praca", namePl: "Praca", nameEn: "Work" });

function speaker(over: Partial<AgendaSpeaker> & { userId: string }): AgendaSpeaker {
  return {
    slug: null,
    displayName: "Anna Zablocka",
    avatarUrl: null,
    headlinePl: null,
    headlineEn: null,
    role: "speaker",
    sortOrder: 0,
    ...over,
  };
}

function session(over: Partial<AgendaSession>): AgendaSession {
  return {
    id: "s1",
    eventId: "e1",
    parentSessionId: null,
    titlePl: "Sesja otwarcia",
    titleEn: "Opening",
    descriptionPl: null,
    descriptionEn: null,
    startsAt: "2026-09-01T08:00:00Z",
    endsAt: "2026-09-01T09:00:00Z",
    timezone: "Europe/Warsaw",
    format: "onsite",
    status: "published",
    sortOrder: 1,
    chathamHouse: false,
    minTierRank: 0,
    requiresSignup: true,
    capacity: 40,
    registeredCount: 10,
    seatsLeft: 30,
    track: null,
    room: null,
    hasStream: false,
    hasRecording: false,
    mySignupStatus: null,
    accessState: "signup_required",
    speakers: [],
    ...over,
    affiliationPl: over.affiliationPl ?? null,
    affiliationEn: over.affiliationEn ?? null,
    sponsor: over.sponsor ?? null,
  };
}

function renderCard(
  value: AgendaSession,
  extra: {
    pending?: boolean;
    signedIn?: boolean;
    onSignup?: (item: AgendaSession) => void;
    onCancel?: (item: AgendaSession) => void;
    speakerTracks?: ReadonlyMap<string, readonly SpeakerTrack[]>;
  } = {},
) {
  return render(
    <AgendaSessionCard
      session={value}
      pending={extra.pending ?? false}
      signedIn={extra.signedIn ?? true}
      onSignup={extra.onSignup ?? vi.fn()}
      onCancel={extra.onCancel ?? vi.fn()}
      speakerTracks={extra.speakerTracks}
    />,
  );
}

/** Kolumna plakietek, formatu i „Pokaż szczegóły" - liczona od plakietki stanu. */
function stateColumn(stateKey = "eventFront.agenda.states.signupRequired"): HTMLElement {
  const column = screen.getByText(stateKey).closest<HTMLElement>("div.min-w-0.space-y-4");
  if (column === null) throw new Error("brak kolumny stanu sesji");
  return column;
}

function speakerRow(name: string): HTMLElement {
  const row = screen.getByText(name).closest("li");
  if (row === null) throw new Error(`brak wiersza prelegenta ${name}`);
  return row;
}

function trackOf(value: AgendaTrack, sessionsCount = 1): SpeakerTrack {
  return {
    id: value.id,
    key: value.key,
    namePl: value.namePl,
    nameEn: value.nameEn,
    accentColor: value.accentColor,
    sessionsCount,
  };
}

beforeEach(() => {
  h.lang = "pl";
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AgendaSessionCard - uklad obsady", () => {
  it("prelegenci stoja w liscie z etykieta, w drugiej kolumnie siatki obok plakietek", () => {
    renderCard(
      session({
        descriptionPl: "Opis panelu",
        speakers: [
          speaker({ userId: "u1", displayName: "Anna Zablocka" }),
          speaker({ userId: "u2", displayName: "Jan Nowak" }),
        ],
      }),
    );

    const list = screen.getByRole("list", { name: SPEAKERS_LABEL });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);

    // Lista i kolumna plakietek sa DZIECMI tej samej siatki, w tej kolejnosci:
    // najpierw stan sesji i przycisk, potem obsada po prawej.
    const column = stateColumn();
    const grid = column.parentElement as HTMLElement;
    expect(grid).toHaveClass("grid");
    expect(list.parentElement).toBe(grid);
    expect(Array.from(grid.children)).toEqual([column, list]);
    expect(column).toContainElement(screen.getByRole("button", { name: OPEN }));

    // Opis idzie POD obiema kolumnami, a nie do waskiej kolumny plakietek.
    const description = screen.getByText("Opis panelu");
    expect(grid).not.toContainElement(description);
    expect(grid.parentElement).toContainElement(description);
    expect(
      grid.compareDocumentPosition(description) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("sesja bez obsady nie ma listy prelegentow ani siatki dwoch kolumn", () => {
    renderCard(session({ descriptionPl: "Opis panelu", speakers: [] }));

    expect(screen.queryByRole("list", { name: SPEAKERS_LABEL })).toBeNull();
    const wrapper = stateColumn().parentElement as HTMLElement;
    expect(wrapper).not.toHaveClass("grid");
    expect(wrapper.children).toHaveLength(1);
  });

  it("prelegent bez nazwy nie dostaje wiersza, a sam nie buduje listy ani przelacznika", () => {
    renderCard(session({ speakers: [speaker({ userId: "u1", displayName: "" })] }));

    expect(screen.queryByRole("list", { name: SPEAKERS_LABEL })).toBeNull();
    expect(screen.queryByRole("button", { name: OPEN })).toBeNull();
    expect(stateColumn().parentElement).not.toHaveClass("grid");
  });

  it("wiersz prelegenta ma awatar rozmiaru md, role i organizacje z pelnym napisem w title", () => {
    renderCard(
      session({
        speakers: [
          speaker({
            userId: "u1",
            displayName: "Anna Zablocka",
            headlinePl: "Glowna ekonomistka, PwC",
          }),
          speaker({ userId: "u2", displayName: "Jan Nowak", headlinePl: null }),
        ],
      }),
    );

    const row = speakerRow("Anna Zablocka");
    // Awatar bez zdjecia to inicjaly - rozmiar md to kwadrat 40 px.
    const avatar = within(row).getByText("AZ");
    expect(avatar).toHaveClass("h-10", "w-10");
    expect(within(row).getByText("eventFront.agenda.speakerRole.speaker")).toBeInTheDocument();
    expect(within(row).getByTitle("Glowna ekonomistka, PwC")).toHaveTextContent(
      "Glowna ekonomistka, PwC",
    );

    // Brak organizacji nie zostawia pustej linii z `title=""`.
    const bare = speakerRow("Jan Nowak");
    expect(bare.querySelector("[title]")).toBeNull();
  });

  it.each([
    ["moderator", "eventFront.agenda.speakerRole.moderator"],
    ["panelist", "eventFront.agenda.speakerRole.panelist"],
    ["host", "eventFront.agenda.speakerRole.host"],
    ["keynote", "eventFront.agenda.speakerRole.speaker"],
    [null, "eventFront.agenda.speakerRole.speaker"],
  ])("rola %s dostaje klucz %s", (role, key) => {
    renderCard(session({ speakers: [speaker({ userId: "u1", role })] }));
    expect(within(speakerRow("Anna Zablocka")).getByText(key)).toBeInTheDocument();
  });
});

describe("AgendaSessionCard - przelacznik szczegolow", () => {
  it("obsada ze sciezka, bez opisu: przelacznik wskazuje wylacznie liste prelegentow", () => {
    renderCard(
      session({ descriptionPl: null, track: WORK, speakers: [speaker({ userId: "u1" })] }),
    );

    const toggle = screen.getByRole("button", { name: OPEN });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    const list = screen.getByRole("list", { name: SPEAKERS_LABEL });
    expect(list.id).not.toBe("");
    expect(toggle.getAttribute("aria-controls")).toBe(list.id);
  });

  it("obsada bez sciezek i bez opisu nie ma przelacznika - rozwiniecie nie mialoby co pokazac", () => {
    // Obsada jest widoczna zawsze; rozwiniecie dokladaloby tylko sciezki. Program
    // bez sciezek (albo sesja plenarna) nie dostaje martwego przycisku.
    renderCard(
      session({ descriptionPl: null, track: null, speakers: [speaker({ userId: "u1" })] }),
    );
    expect(screen.queryByRole("button", { name: OPEN })).toBeNull();
    expect(screen.getByRole("list", { name: SPEAKERS_LABEL })).toBeInTheDocument();

    // To samo z indeksem programu, w ktorym osoba nie ma zadnej sciezki.
    cleanup();
    renderCard(
      session({ descriptionPl: null, track: WORK, speakers: [speaker({ userId: "u1" })] }),
      {
        speakerTracks: new Map(),
      },
    );
    expect(screen.queryByRole("button", { name: OPEN })).toBeNull();
  });

  it("sciezka bez nazwy w zadnym jezyku nie liczy sie jako cos do pokazania", () => {
    const unnamed: SpeakerTrack = { ...trackOf(WORK), namePl: null, nameEn: null };
    renderCard(session({ descriptionPl: null, speakers: [speaker({ userId: "u1" })] }), {
      speakerTracks: new Map([["u1", [unnamed]]]),
    });
    expect(screen.queryByRole("button", { name: OPEN })).toBeNull();
  });

  it("opis i obsada: aria-controls wymienia oba regiony, a kazdy z nich jest w DOM", () => {
    renderCard(
      session({
        descriptionPl: "Opis panelu",
        track: WORK,
        speakers: [speaker({ userId: "u1" })],
      }),
    );

    const toggle = screen.getByRole("button", { name: OPEN });
    const ids = (toggle.getAttribute("aria-controls") ?? "").split(" ");
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    const description = screen.getByText("Opis panelu");
    const list = screen.getByRole("list", { name: SPEAKERS_LABEL });
    expect(ids).toEqual([description.id, list.id]);
    for (const id of ids) expect(document.getElementById(id)).not.toBeNull();
  });

  it("sam opis bez obsady: aria-controls wskazuje tylko opis", () => {
    renderCard(session({ descriptionPl: "Opis panelu", speakers: [] }));

    const toggle = screen.getByRole("button", { name: OPEN });
    expect(toggle.getAttribute("aria-controls")).toBe(screen.getByText("Opis panelu").id);
  });

  it("sesja bez opisu i bez obsady nie ma przelacznika", () => {
    renderCard(session({ descriptionPl: null, speakers: [] }));
    expect(screen.queryByRole("button", { name: OPEN })).toBeNull();
  });

  it("opis jest ukryty do rozwiniecia, a przelacznik wraca do stanu zamknietego", () => {
    renderCard(session({ descriptionPl: "Opis panelu", speakers: [speaker({ userId: "u1" })] }));

    const description = screen.getByText("Opis panelu");
    expect(description).not.toBeVisible();
    expect(description).toHaveAttribute("hidden");

    fireEvent.click(screen.getByRole("button", { name: OPEN }));
    const toggle = screen.getByRole("button", { name: CLOSE });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(description).not.toHaveAttribute("hidden");
    expect(description).toBeVisible();

    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: OPEN })).toHaveAttribute("aria-expanded", "false");
    expect(description).toHaveAttribute("hidden");
  });
});

describe("AgendaSessionCard - sciezki prelegenta", () => {
  it("sciezki z indeksu programu stoja przy nazwisku DOPIERO po rozwinieciu", () => {
    const index = new Map([["u1", [trackOf(ENERGY), trackOf(WORK, 2)]]]);
    renderCard(session({ track: ENERGY, speakers: [speaker({ userId: "u1" })] }), {
      speakerTracks: index,
    });

    const row = speakerRow("Anna Zablocka");
    expect(within(row).queryByText(TRACKS_LABEL)).toBeNull();
    expect(within(row).queryByTitle("Energia")).toBeNull();
    expect(within(row).queryByTitle("Praca")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: OPEN }));

    const opened = speakerRow("Anna Zablocka");
    expect(within(opened).getByText(TRACKS_LABEL)).toBeInTheDocument();
    expect(within(opened).getByTitle("Energia")).toBeInTheDocument();
    expect(within(opened).getByTitle("Praca")).toBeInTheDocument();

    // Zwiniecie chowa sciezki z powrotem.
    fireEvent.click(screen.getByRole("button", { name: CLOSE }));
    expect(within(speakerRow("Anna Zablocka")).queryByText(TRACKS_LABEL)).toBeNull();
  });

  it("karta bez indeksu programu pokazuje wlasna sciezke sesji", () => {
    renderCard(session({ track: WORK, speakers: [speaker({ userId: "u1" })] }));

    fireEvent.click(screen.getByRole("button", { name: OPEN }));
    const row = speakerRow("Anna Zablocka");
    expect(within(row).getByText(TRACKS_LABEL)).toBeInTheDocument();
    expect(within(row).getByTitle("Praca")).toBeInTheDocument();
  });

  it("karta bez indeksu i bez sciezki sesji nie rysuje pustego rzedu sciezek", () => {
    renderCard(
      session({ descriptionPl: "Opis panelu", track: null, speakers: [speaker({ userId: "u1" })] }),
    );

    const toggle = screen.getByRole("button", { name: OPEN });
    // Przelacznik jest - dla opisu - ale nie obiecuje listy prelegentow.
    expect(toggle.getAttribute("aria-controls")).toBe(screen.getByText("Opis panelu").id);
    fireEvent.click(toggle);
    expect(within(speakerRow("Anna Zablocka")).queryByText(TRACKS_LABEL)).toBeNull();
  });

  it("z indeksem programu osoba, ktorej w nim nie ma, nie dostaje sciezki sesji", () => {
    // Indeks jest prawda: osoby nie ma w nim, bo wystepuje wylacznie w sesjach
    // odwolanych albo bez sciezki - wlasna sciezka sesji to zapas TYLKO dla
    // karty bez indeksu.
    const index = new Map([["u9", [trackOf(ENERGY)]]]);
    renderCard(
      session({ descriptionPl: "Opis panelu", track: WORK, speakers: [speaker({ userId: "u1" })] }),
      { speakerTracks: index },
    );

    fireEvent.click(screen.getByRole("button", { name: OPEN }));
    const row = speakerRow("Anna Zablocka");
    expect(within(row).queryByText(TRACKS_LABEL)).toBeNull();
    expect(within(row).queryByTitle("Praca")).toBeNull();
  });

  it("interfejs angielski czyta nazwy sciezek i tytul po angielsku", () => {
    h.lang = "en";
    renderCard(session({ track: ENERGY, speakers: [speaker({ userId: "u1" })] }));

    expect(screen.getByRole("heading", { name: "Opening" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: OPEN }));
    expect(within(speakerRow("Anna Zablocka")).getByTitle("Energy")).toBeInTheDocument();
  });
});

describe("AgendaSessionCard - reszta bloku po przebudowie", () => {
  it("nurt daje akcent koloru i podpis, a sesja bez nurtu ma przezroczysty akcent", () => {
    const view = renderCard(session({ track: ENERGY }));
    const label = screen.getByText("Energia");
    expect(label.parentElement).toHaveStyle({ borderLeftColor: "#2563eb" });
    view.unmount();

    renderCard(session({ track: null }));
    const time = document.querySelector("article time") as HTMLElement;
    expect(time.parentElement).toHaveStyle({ borderLeftColor: "transparent" });
  });

  it("przedzial czasu tego samego dnia podaje sama godzine konca", () => {
    renderCard(session({}));
    expect(screen.getByText(/^eventFront\.agenda\.timeRange\(/)).toHaveTextContent(
      /end=11:00(,|\))/,
    );
  });

  it("sesja przez polnoc dostaje w koncowce pelna date, a nie sama godzine", () => {
    renderCard(session({ startsAt: "2026-09-01T21:00:00Z", endsAt: "2026-09-01T23:30:00Z" }));
    const range = screen.getByText(/^eventFront\.agenda\.timeRange\(/);
    expect(range).toHaveTextContent(/start=23:00/);
    expect(range).toHaveTextContent(/end=[^)]*2026[^)]*01:30/);
  });

  it("afiliacja ma podpis dla czytnika, a sala z pietrem i transmisja stoja w metadanych", () => {
    renderCard(
      session({
        affiliationPl: "Rada Programowa",
        room: { id: "r1", name: "Sala Kolumnowa", floor: "1 pietro" },
        hasStream: true,
        chathamHouse: true,
      }),
    );
    expect(screen.getByText("Rada Programowa")).toBeInTheDocument();
    expect(screen.getByText(/eventFront\.agenda\.affiliationLabel/)).toHaveClass("sr-only");
    expect(screen.getByText("Sala Kolumnowa (1 pietro)")).toBeInTheDocument();
    expect(screen.getAllByText("eventFront.agenda.streamAvailable")).toHaveLength(2);
    expect(screen.getByText("eventFront.agenda.chathamHouse")).toBeInTheDocument();
  });

  it("sala bez nazwy, ale z pietrem, nie rysuje napisu null", () => {
    renderCard(session({ room: { id: "r1", name: null, floor: "parter" } }));
    expect(screen.getByText("(parter)")).toBeInTheDocument();
    expect(screen.queryByText(/null/)).toBeNull();
  });

  it("sala bez pietra nie dostaje pustego nawiasu", () => {
    renderCard(session({ room: { id: "r1", name: "Sala Blekitna", floor: null } }));
    expect(screen.getByText("Sala Blekitna")).toHaveTextContent(/^Sala Blekitna$/);
  });

  it("sponsor sesji z logo i rola partnera", () => {
    renderCard(
      session({
        sponsor: { id: "sp1", name: "Orlen", logoUrl: "logos/orlen.png", role: "partner" },
      }),
    );
    expect(screen.getByText("eventFront.sponsors.roles.partner")).toBeInTheDocument();
    expect(screen.getByTitle("Orlen")).toHaveTextContent("Orlen");
    const logo = document.querySelector("article img") as HTMLImageElement;
    expect(logo.getAttribute("src")).toBe(mediaRenderUrl("logos/orlen.png"));
    expect(logo).toHaveAttribute("alt", "");
  });

  it("brak sponsora sesji bierze sponsora nurtu, a bez roli - ogolny podpis", () => {
    renderCard(
      session({
        track: track({
          id: "t3",
          namePl: "Obrona",
          sponsor: { id: "sp2", name: "PGZ", logoUrl: null, role: null },
        }),
      }),
    );
    expect(screen.getByText("eventFront.agenda.sponsorLabel")).toBeInTheDocument();
    expect(screen.getByTitle("PGZ")).toBeInTheDocument();
    expect(document.querySelector("article img")).toBeNull();
  });

  it.each([
    ["sponsor", "eventFront.sponsors.roles.sponsor"],
    ["media_partner", "eventFront.sponsors.roles.mediaPartner"],
    ["exhibitor", "eventFront.sponsors.roles.exhibitor"],
    ["inne", "eventFront.agenda.sponsorLabel"],
  ])("rola sponsora %s dostaje klucz %s", (role, key) => {
    renderCard(session({ sponsor: { id: "sp1", name: "Firma", logoUrl: null, role } }));
    expect(screen.getByText(key)).toBeInTheDocument();
  });

  it.each([null, ""])("sponsor z nazwa %j nie rysuje pustej ramki", (name) => {
    renderCard(session({ sponsor: { id: "sp1", name, logoUrl: null, role: "partner" } }));
    expect(screen.queryByText("eventFront.sponsors.roles.partner")).toBeNull();
  });

  it("zapis: liczba wolnych miejsc i klik przekazuje sesje do onSignup", () => {
    const onSignup = vi.fn();
    const value = session({ id: "s9" });
    renderCard(value, { onSignup });
    expect(screen.getByText("eventFront.agenda.seatsLeft(count=30)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "eventFront.agenda.actions.signup" }));
    expect(onSignup).toHaveBeenCalledWith(value);
  });

  it("zapisany widzi rezygnacje, a klik idzie do onCancel", () => {
    const onCancel = vi.fn();
    const onSignup = vi.fn();
    const value = session({ mySignupStatus: "registered", accessState: "signed_up" });
    renderCard(value, { onCancel, onSignup });
    fireEvent.click(screen.getByRole("button", { name: "eventFront.agenda.actions.cancel" }));
    expect(onCancel).toHaveBeenCalledWith(value);
    expect(onSignup).not.toHaveBeenCalled();
  });

  it("gosc widzi zaproszenie do logowania, a zapis w locie blokuje przycisk", () => {
    const view = renderCard(session({}), { signedIn: false });
    expect(screen.getByRole("button", { name: "eventFront.agenda.actions.signIn" })).toBeEnabled();
    view.unmount();

    renderCard(session({}), { pending: true });
    expect(
      screen.getByRole("button", { name: "eventFront.agenda.actions.working" }),
    ).toBeDisabled();
  });

  it("sesja bez limitu mowi o miejscach bez limitu", () => {
    renderCard(session({ capacity: null, seatsLeft: null }));
    expect(screen.getByText("eventFront.agenda.seatsUnlimited")).toBeInTheDocument();
  });

  it("sesja bez zapisow nie ma kontrolki ani licznika miejsc", () => {
    renderCard(session({ requiresSignup: false, accessState: "open" }));
    expect(screen.queryByText(/seatsLeft|seatsUnlimited/)).toBeNull();
    expect(screen.queryByRole("button", { name: /eventFront\.agenda\.actions/ })).toBeNull();
  });

  it("odwolana sesja jest przygaszona i nie ma kontrolki ani licznika", () => {
    renderCard(session({ status: "cancelled", accessState: "cancelled" }));
    expect(document.querySelector("article")).toHaveClass("opacity-70");
    expect(screen.queryByText(/seatsLeft|seatsUnlimited/)).toBeNull();
    expect(screen.queryByRole("button", { name: /eventFront\.agenda\.actions/ })).toBeNull();
  });

  it("odwolana sesja bez limitu tez nie obiecuje miejsc", () => {
    renderCard(
      session({ status: "cancelled", accessState: "cancelled", capacity: null, seatsLeft: null }),
    );
    expect(screen.queryByText("eventFront.agenda.seatsUnlimited")).toBeNull();
  });
});

describe("EventAgendaBoardView - sciezki prelegenta z calego programu", () => {
  const shared = speaker({ userId: "u1", displayName: "Anna Zablocka" });

  it("filtr sciezki nie zmienia sciezek, w ktorych wystepuje prelegent", () => {
    render(
      <EventAgendaBoardView
        sessions={[
          session({ id: "a", titlePl: "Panel energetyczny", track: ENERGY, speakers: [shared] }),
          session({
            id: "b",
            titlePl: "Panel pracy",
            startsAt: "2026-09-01T10:00:00Z",
            endsAt: "2026-09-01T11:00:00Z",
            track: WORK,
            speakers: [shared],
          }),
        ]}
        lang="pl"
        signedIn
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Energia/ }));
    expect(screen.queryByText("Panel pracy")).toBeNull();
    const article = document.getElementById("event-session-a") as HTMLElement;
    expect(article).not.toBeNull();

    fireEvent.click(within(article).getByRole("button", { name: OPEN }));
    const row = within(article).getByText("Anna Zablocka").closest("li") as HTMLElement;
    expect(within(row).getByText(TRACKS_LABEL)).toBeInTheDocument();
    expect(within(row).getByTitle("Energia")).toBeInTheDocument();
    expect(within(row).getByTitle("Praca")).toBeInTheDocument();
  });

  it("sciezka z sesji innego dnia stoi przy nazwisku, a sesja odwolana jej nie dopisuje", () => {
    const defence = track({ id: "t3", key: "obrona", namePl: "Obrona" });
    render(
      <EventAgendaBoardView
        sessions={[
          session({ id: "a", titlePl: "Dzien pierwszy", track: ENERGY, speakers: [shared] }),
          session({
            id: "b",
            titlePl: "Dzien drugi",
            startsAt: "2026-09-02T08:00:00Z",
            endsAt: "2026-09-02T09:00:00Z",
            track: WORK,
            speakers: [shared],
          }),
          session({
            id: "c",
            titlePl: "Odwolany panel",
            status: "cancelled",
            accessState: "cancelled",
            startsAt: "2026-09-01T12:00:00Z",
            endsAt: "2026-09-01T13:00:00Z",
            track: defence,
            speakers: [shared],
          }),
        ]}
        lang="pl"
        signedIn
      />,
    );

    expect(screen.queryByText("Dzien drugi")).toBeNull();
    const article = document.getElementById("event-session-a") as HTMLElement;
    fireEvent.click(within(article).getByRole("button", { name: OPEN }));
    const row = within(article).getByText("Anna Zablocka").closest("li") as HTMLElement;
    expect(within(row).getByTitle("Energia")).toBeInTheDocument();
    expect(within(row).getByTitle("Praca")).toBeInTheDocument();
    expect(within(row).queryByTitle("Obrona")).toBeNull();
  });
});

describe("EventAgendaBoardView - filtry, harmonogram i akcje", () => {
  it("pusty program nie rysuje niczego", () => {
    const { container } = render(<EventAgendaBoardView sessions={[]} lang="pl" signedIn />);
    expect(container).toBeEmptyDOMElement();
  });

  it("zakladki dni przelaczaja program i zaznaczaja aktywny dzien", () => {
    render(
      <EventAgendaBoardView
        sessions={[
          session({ id: "a", titlePl: "Dzien pierwszy" }),
          session({
            id: "b",
            titlePl: "Dzien drugi",
            startsAt: "2026-09-02T08:00:00Z",
            endsAt: "2026-09-02T09:00:00Z",
          }),
        ]}
        lang="pl"
        signedIn
      />,
    );
    const tabs = screen.getAllByRole("tab");
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs[0]).toHaveTextContent("eventFront.agenda.dayLabel(index=1)");

    fireEvent.click(tabs[1]);
    expect(screen.getAllByRole("tab")[1]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Dzien drugi")).toBeInTheDocument();
    expect(screen.queryByText("Dzien pierwszy")).toBeNull();
  });

  it("pusty wynik mowi, ktory filtr oproznil liste", () => {
    render(
      <EventAgendaBoardView
        sessions={[
          session({ id: "a", titlePl: "Panel energetyczny", track: ENERGY }),
          session({
            id: "b",
            titlePl: "Panel pracy",
            startsAt: "2026-09-02T08:00:00Z",
            endsAt: "2026-09-02T09:00:00Z",
            track: WORK,
            mySignupStatus: "registered",
            accessState: "signed_up",
          }),
        ]}
        lang="pl"
        signedIn
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Praca/ }));
    expect(screen.getByText("eventFront.agenda.emptyFiltered")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "eventFront.agenda.allTracks" }));
    expect(screen.getByText("Panel energetyczny")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("switch"));
    expect(screen.getByText("eventFront.agenda.emptyMine")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch"));

    fireEvent.change(screen.getByPlaceholderText("eventFront.agenda.search"), {
      target: { value: "nie ma takiej sesji" },
    });
    expect(screen.getByText("eventFront.agenda.emptyQuery")).toBeInTheDocument();
  });

  it("wiersz harmonogramu odslania sesje innego dnia i przewija do niej", () => {
    const scroll = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
    render(
      <EventAgendaBoardView
        sessions={[
          session({ id: "a", titlePl: "Panel otwarcia" }),
          ...["1", "2", "3", "4"].map((nr, index) =>
            session({
              id: `m${nr}`,
              titlePl: `Moja sesja ${nr}`,
              startsAt: `2026-09-02T0${index + 5}:00:00Z`,
              endsAt: `2026-09-02T0${index + 5}:30:00Z`,
              mySignupStatus: "registered",
              accessState: "signed_up",
            }),
          ),
        ]}
        lang="pl"
        signedIn
      />,
    );

    const card = screen.getByText("eventFront.agenda.myScheduleTitle").closest("section");
    if (card === null) throw new Error("brak karty harmonogramu");
    expect(within(card).queryByText("Moja sesja 4")).toBeNull();
    fireEvent.click(within(card).getByText("eventFront.agenda.myScheduleShowAll"));
    expect(within(card).getByText("Moja sesja 4")).toBeInTheDocument();
    expect(within(card).queryByText("eventFront.agenda.myScheduleShowAll")).toBeNull();

    const field = screen.getByPlaceholderText("eventFront.agenda.search");
    fireEvent.change(field, { target: { value: "nic" } });
    fireEvent.click(within(card).getByText("Moja sesja 4"));

    expect(field).toHaveValue("");
    const target = document.getElementById("event-session-m4");
    expect(target).not.toBeNull();
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll.mock.contexts[0]).toBe(target);
    expect(scroll).toHaveBeenCalledWith({ block: "start" });
  });

  it("przegladarka bez scrollIntoView nie wywraca odslaniania sesji", () => {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value: undefined,
    });
    try {
      render(
        <EventAgendaBoardView
          sessions={[
            session({ id: "a", titlePl: "Panel otwarcia" }),
            session({
              id: "b",
              titlePl: "Moja sesja",
              startsAt: "2026-09-02T08:00:00Z",
              endsAt: "2026-09-02T09:00:00Z",
              mySignupStatus: "registered",
              accessState: "signed_up",
            }),
          ]}
          lang="pl"
          signedIn
        />,
      );
      const card = screen.getByText("eventFront.agenda.myScheduleTitle").closest("section");
      fireEvent.click(within(card as HTMLElement).getByText("Moja sesja"));
      expect(document.getElementById("event-session-b")).not.toBeNull();
    } finally {
      delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  it("obca strefa czasowa dostaje dopisek, a wlasna go nie dostaje", () => {
    const foreign = browserTimeZone() === "Pacific/Auckland" ? "Europe/Warsaw" : "Pacific/Auckland";
    const view = render(
      <EventAgendaBoardView sessions={[session({ timezone: foreign })]} lang="pl" signedIn />,
    );
    expect(screen.getByText("eventFront.agenda.timezoneForeign")).toBeInTheDocument();
    view.unmount();

    render(
      <EventAgendaBoardView
        sessions={[session({ timezone: browserTimeZone() })]}
        lang="pl"
        signedIn
      />,
    );
    expect(screen.queryByText("eventFront.agenda.timezoneForeign")).toBeNull();
  });

  it("uchwyty zapisu i rezygnacji dostaja sesje, a zapis w locie dotyczy tylko jednej", () => {
    const onSignup = vi.fn();
    const onCancel = vi.fn();
    const first = session({ id: "a", titlePl: "Panel A" });
    const mine = session({
      id: "b",
      titlePl: "Panel B",
      startsAt: "2026-09-01T10:00:00Z",
      endsAt: "2026-09-01T11:00:00Z",
      mySignupStatus: "registered",
      accessState: "signed_up",
    });
    const pendingOne = session({
      id: "c",
      titlePl: "Panel C",
      startsAt: "2026-09-01T12:00:00Z",
      endsAt: "2026-09-01T13:00:00Z",
    });
    render(
      <EventAgendaBoardView
        sessions={[first, mine, pendingOne]}
        lang="pl"
        signedIn
        pendingId="c"
        onSignup={onSignup}
        onCancel={onCancel}
      />,
    );

    const a = document.getElementById("event-session-a") as HTMLElement;
    fireEvent.click(within(a).getByRole("button", { name: "eventFront.agenda.actions.signup" }));
    expect(onSignup).toHaveBeenCalledWith(first);

    const b = document.getElementById("event-session-b") as HTMLElement;
    fireEvent.click(within(b).getByRole("button", { name: "eventFront.agenda.actions.cancel" }));
    expect(onCancel).toHaveBeenCalledWith(mine);

    const c = document.getElementById("event-session-c") as HTMLElement;
    expect(
      within(c).getByRole("button", { name: "eventFront.agenda.actions.working" }),
    ).toBeDisabled();
  });

  it("widok bez uchwytow (podglad studia) nie wywraca sie na kliknieciu", () => {
    render(
      <EventAgendaBoardView
        sessions={[
          session({ id: "a" }),
          session({
            id: "b",
            startsAt: "2026-09-01T10:00:00Z",
            endsAt: "2026-09-01T11:00:00Z",
            mySignupStatus: "registered",
            accessState: "signed_up",
          }),
        ]}
        lang="pl"
        signedIn={false}
      />,
    );
    const a = document.getElementById("event-session-a") as HTMLElement;
    fireEvent.click(within(a).getByRole("button", { name: "eventFront.agenda.actions.signIn" }));
    const b = document.getElementById("event-session-b") as HTMLElement;
    fireEvent.click(within(b).getByRole("button", { name: "eventFront.agenda.actions.signIn" }));
    expect(screen.getAllByRole("article")).toHaveLength(2);
  });
});

describe("EventAgendaBoardView - SSR i hydratacja z obsada", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("serwer i klient daja ten sam HTML, a aria-controls wskazuje istniejace regiony", async () => {
    const shared = speaker({ userId: "u1", displayName: "Anna Zablocka" });
    const view = (
      <EventAgendaBoardView
        sessions={[
          session({
            id: "a",
            titlePl: "Panel energetyczny",
            descriptionPl: "Opis panelu",
            track: ENERGY,
            speakers: [shared],
          }),
          session({
            id: "b",
            titlePl: "Panel pracy",
            startsAt: "2026-09-01T10:00:00Z",
            endsAt: "2026-09-01T11:00:00Z",
            track: WORK,
            speakers: [shared],
          }),
        ]}
        lang="pl"
        signedIn={false}
      />
    );
    const host = document.createElement("div");
    host.innerHTML = renderToString(view);
    document.body.append(host);
    const serverHtml = host.innerHTML;
    // Serwer nie rysuje sciezek przy nazwisku - szczegoly sa zwiniete.
    expect(serverHtml).not.toContain("eventFront.agenda.speakerTracksLabel");

    const errors: unknown[] = [];
    let root!: ReturnType<typeof hydrateRoot>;
    await act(async () => {
      root = hydrateRoot(host, view, { onRecoverableError: (error) => errors.push(error) });
    });
    try {
      expect(errors).toEqual([]);
      const article = document.getElementById("event-session-a") as HTMLElement;
      const toggle = within(article).getByRole("button", { name: OPEN });
      const ids = (toggle.getAttribute("aria-controls") ?? "").split(" ");
      expect(ids).toHaveLength(2);
      for (const id of ids) expect(document.getElementById(id)).not.toBeNull();

      // Po hydratacji przelacznik zyje: opis sie odslania, a przy nazwisku
      // staja obie sciezki z calego programu.
      await act(async () => {
        fireEvent.click(toggle);
      });
      expect(within(article).getByText("Opis panelu")).toBeVisible();
      const row = within(article).getByText("Anna Zablocka").closest("li") as HTMLElement;
      expect(within(row).getByTitle("Energia")).toBeInTheDocument();
      expect(within(row).getByTitle("Praca")).toBeInTheDocument();
    } finally {
      await act(async () => root.unmount());
    }
  });
});
