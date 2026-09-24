// Sciezki prelegenta (`SpeakerTrackChips`) i ich miejsce w zapowiedzi
// (`EventSpeakersSection`).
//
// SPRAWDZAMY KONTRAKT, KTORY WIDZI UCZESTNIK I CZYTNIK EKRANU:
// 1. pusta lista albo same sciezki bez nazwy = NIC (zadnej etykiety bez tresci),
// 2. wariant `chips` pokazuje nazwy, a czytnik slyszy przed nimi etykiete,
// 3. wariant `compact` rysuje same kwadraty koloru (`aria-hidden`), a pelne
//    zdanie „Sciezki: A, B" idzie w `sr-only` i w `title` - kolor bez nazwy
//    nie jest informacja,
// 4. kolor akcentu ze sciezki trafia do `backgroundColor`; brak koloru daje
//    klase zastepcza, a nie pusty `style`,
// 5. jezyk nazwy wybiera `speakerTrackName` (jezyk karty, potem drugi jezyk),
// 6. zapowiedz na przegladzie dokleja kwadraty do chipu prelegenta DOKLADNIE
//    wtedy, gdy wiersz ma sciezki - i nie dokleja pozycji listy.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SpeakerTrack } from "@/lib/events/speakerCard";

const h = vi.hoisted(() => ({
  speakers: [] as Array<Record<string, unknown>>,
}));

// Fabryka importuje `@/test/i18nStub` - modul BEZ importow z produkcji
// (inaczej cykl inicjalizacji zawiesza plik). `t()` zwraca klucz.
vi.mock("react-i18next", async () => {
  const { reactI18nextStub } = await import("@/test/i18nStub");
  return reactI18nextStub();
});

vi.mock("@/lib/builder/speakersQuery", () => ({
  speakersQueryOptions: (input: unknown, lang: unknown) => ({
    queryKey: ["speakers", JSON.stringify(input), lang],
    queryFn: () => h.speakers,
  }),
}));

// Dialog profilu ma wlasne testy; tu wystarczy, ze da sie go otworzyc,
// zamknac PELNA sciezka `onOpenChange(false)` i zobaczyc dane awaryjne.
// `onOpenChange(true)` (Radix potwierdza otwarcie) nie moze go zamykac.
vi.mock("@/components/events/SpeakerProfileDialog", () => ({
  SpeakerProfileDialog: ({
    userId,
    onOpenChange,
    fallback,
  }: {
    userId: string;
    onOpenChange: (open: boolean) => void;
    fallback: { name: string; role: string; photo?: string };
  }) => (
    <div
      data-testid="dialog-prelegenta"
      data-fallback-name={fallback.name}
      data-fallback-role={fallback.role}
      data-fallback-photo={fallback.photo ?? "brak"}
    >
      {userId}
      <button type="button" onClick={() => onOpenChange(true)}>
        Potwierdz otwarcie
      </button>
      <button type="button" onClick={() => onOpenChange(false)}>
        Zamknij profil
      </button>
    </div>
  ),
}));

const { SpeakerTrackChips } = await import("@/components/events/SpeakerTrackChips");
const { EventSpeakersSection } = await import("@/components/events/EventSpeakersSection");

const LABEL = "eventFront.speakers.card.tracksLabel";
/** Naglowek idzie w JEZYKU KARTY (props `lang`), wiec stub dokleja `lng`. */
const labelIn = (lang: "pl" | "en"): string => `${LABEL}(lng=${lang})`;

function track(over: Partial<SpeakerTrack> = {}): SpeakerTrack {
  return {
    id: "t1",
    key: "energia",
    namePl: "Energetyka",
    nameEn: "Energy",
    accentColor: "#aa3300",
    sessionsCount: 2,
    ...over,
  };
}

const SECOND = track({
  id: "t2",
  key: "cyber",
  namePl: "Cyberbezpieczenstwo",
  nameEn: "Cybersecurity",
  accentColor: null,
});

/** Kolor z atrybutu `style` bez zgadywania, jak happy-dom go zapisze. */
function backgroundOf(node: Element): string {
  return (node as HTMLElement).style.backgroundColor;
}

const swatchesOf = (root: ParentNode): HTMLElement[] =>
  Array.from(root.querySelectorAll<HTMLElement>('span[aria-hidden="true"]'));

/** Jasna klasa zastepcza na zdjeciu - odcien bieli to decyzja wygladu, nie faktu. */
const INVERSE_FALLBACK = /(^|\s)bg-white\/\d+(\s|$)/;

describe("SpeakerTrackChips - brak tresci = brak elementu", () => {
  it("pusta lista sciezek nie rysuje niczego", () => {
    const { container } = render(<SpeakerTrackChips tracks={[]} lang="pl" />);
    expect(container.innerHTML).toBe("");
  });

  it("sciezki bez nazwy w zadnym jezyku tez nie rysuja etykiety", () => {
    // Sama etykieta „Sciezki:" bez ani jednej nazwy to dla czytnika ekranu
    // obietnica listy, ktorej nie ma.
    const { container } = render(
      <SpeakerTrackChips
        tracks={[track({ namePl: null, nameEn: null })]}
        lang="pl"
        variant="compact"
      />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("sciezka bez nazwy wypada, a nazwana zostaje - bez pustego kwadratu", () => {
    const { container } = render(
      <SpeakerTrackChips
        tracks={[track({ id: "pusta", namePl: null, nameEn: null }), SECOND]}
        lang="pl"
        variant="compact"
      />,
    );
    expect(swatchesOf(container)).toHaveLength(1);
    expect(container.textContent).toBe(`${labelIn("pl")}: Cyberbezpieczenstwo`);
  });
});

describe("SpeakerTrackChips - wariant chips (karta w siatce)", () => {
  it("pokazuje nazwy, a pelna nazwa zostaje w title chipu", () => {
    render(<SpeakerTrackChips tracks={[track(), SECOND]} lang="pl" />);

    const energy = screen.getByText("Energetyka");
    const cyber = screen.getByText("Cyberbezpieczenstwo");
    expect(energy.closest("[title]")?.getAttribute("title")).toBe("Energetyka");
    expect(cyber.closest("[title]")?.getAttribute("title")).toBe("Cyberbezpieczenstwo");
  });

  it("czytnik ekranu slyszy etykiete PRZED nazwami (sr-only), a kolor jest ukryty", () => {
    const { container } = render(<SpeakerTrackChips tracks={[track(), SECOND]} lang="pl" />);

    const heading = container.querySelector(".sr-only");
    expect(heading?.textContent).toBe(`${labelIn("pl")}: `);
    // Etykieta stoi jako PIERWSZA - czytnik ma uslyszec, czym sa nazwy obok.
    expect(container.firstElementChild?.firstElementChild).toBe(heading);
    expect(container.textContent).toBe(`${labelIn("pl")}: EnergetykaCyberbezpieczenstwo`);
    expect(swatchesOf(container)).toHaveLength(2);
  });

  it("wlasna etykieta zastepuje domyslna", () => {
    const { container } = render(
      <SpeakerTrackChips tracks={[track()]} lang="pl" label="Pasma programu" />,
    );
    expect(container.querySelector(".sr-only")?.textContent).toBe("Pasma programu: ");
    expect(container.textContent).not.toContain(LABEL);
  });

  it("kolor akcentu sciezki trafia do backgroundColor kwadratu", () => {
    const { container } = render(<SpeakerTrackChips tracks={[track()]} lang="pl" />);
    const [swatch] = swatchesOf(container);
    const expected = document.createElement("span");
    expected.style.backgroundColor = "#aa3300";
    expect(backgroundOf(swatch as HTMLElement)).toBe(expected.style.backgroundColor);
    expect(backgroundOf(swatch as HTMLElement)).not.toBe("");
    // Kolor z danych wygrywa - klasa zastepcza nie moze go przykrywac.
    expect(swatch?.className).not.toContain("bg-muted-foreground/60");
  });

  it("brak koloru daje klase zastepcza, a nie pusty style", () => {
    const { container } = render(<SpeakerTrackChips tracks={[SECOND]} lang="pl" />);
    const [swatch] = swatchesOf(container);
    expect(swatch?.getAttribute("style")).toBeNull();
    expect(swatch?.className).toContain("bg-muted-foreground/60");
  });

  it("inverse (napis na zdjeciu) przelacza chip na jasny tekst na ciemnym tle", () => {
    const { container } = render(<SpeakerTrackChips tracks={[SECOND]} lang="pl" inverse />);
    const chip = screen.getByText("Cyberbezpieczenstwo").parentElement as HTMLElement;
    expect(chip.className).toContain("bg-black/40");
    expect(chip.className).toContain("text-white");
    expect(chip.className).not.toContain("bg-background");
    const [swatch] = swatchesOf(container);
    expect(swatch?.className).toMatch(INVERSE_FALLBACK);
    expect(swatch?.className).not.toContain("bg-muted-foreground/60");
  });

  it("bez inverse chip stoi na tle strony", () => {
    render(<SpeakerTrackChips tracks={[SECOND]} lang="pl" />);
    const chip = screen.getByText("Cyberbezpieczenstwo").parentElement as HTMLElement;
    expect(chip.className).toContain("bg-background");
    expect(chip.className).not.toContain("bg-black/40");
  });

  it("inverse z kolorem akcentu: kolor zostaje, klasa zastepcza nie wchodzi", () => {
    const { container } = render(<SpeakerTrackChips tracks={[track()]} lang="pl" inverse />);
    const [swatch] = swatchesOf(container);
    expect(backgroundOf(swatch as HTMLElement)).not.toBe("");
    expect(swatch?.className).not.toMatch(INVERSE_FALLBACK);
  });

  it("dokleja klasy wywolujacego do korzenia", () => {
    const { container } = render(
      <SpeakerTrackChips tracks={[track()]} lang="pl" className="mt-3" />,
    );
    expect(container.firstElementChild?.className).toContain("mt-3");
  });

  it("nie rysuje pozycji listy - karta jest juz pozycja listy siatki", () => {
    const { container } = render(<SpeakerTrackChips tracks={[track(), SECOND]} lang="pl" />);
    expect(container.querySelectorAll("li, ul, ol")).toHaveLength(0);
  });
});

describe("SpeakerTrackChips - wariant compact (chip zapowiedzi)", () => {
  it("rysuje same kwadraty ukryte przed czytnikiem, jeden na sciezke", () => {
    const { container } = render(
      <SpeakerTrackChips tracks={[track(), SECOND]} lang="pl" variant="compact" />,
    );
    const swatches = swatchesOf(container);
    expect(swatches).toHaveLength(2);
    swatches.forEach((swatch) => expect(swatch.textContent).toBe(""));
    // Nazwa nie stoi jako widoczny tekst - tylko w zdaniu dla czytnika.
    expect(screen.queryByText("Energetyka")).toBeNull();
  });

  it("czytnik ekranu dostaje JEDNO zdanie z nazwami, a to samo zdanie stoi w title", () => {
    const { container } = render(
      <SpeakerTrackChips tracks={[track(), SECOND]} lang="pl" variant="compact" />,
    );
    const sentence = `${labelIn("pl")}: Energetyka, Cyberbezpieczenstwo`;
    const root = container.firstElementChild as HTMLElement;
    expect(root.getAttribute("title")).toBe(sentence);
    expect(root.querySelector(".sr-only")?.textContent).toBe(sentence);
    expect(root.textContent).toBe(sentence);
  });

  it("wlasna etykieta wchodzi do zdania i do title", () => {
    const { container } = render(
      <SpeakerTrackChips tracks={[track()]} lang="pl" variant="compact" label="Pasma" />,
    );
    expect(container.firstElementChild?.getAttribute("title")).toBe("Pasma: Energetyka");
  });

  it("kolor akcentu trafia do kwadratu; brak koloru zostawia klase bez style", () => {
    const { container } = render(
      <SpeakerTrackChips tracks={[track(), SECOND]} lang="pl" variant="compact" />,
    );
    const [colored, plain] = swatchesOf(container);
    expect(backgroundOf(colored as HTMLElement)).not.toBe("");
    expect(plain?.getAttribute("style")).toBeNull();
    expect(plain?.className).toContain("bg-muted");
  });

  it("dokleja klasy wywolujacego do korzenia", () => {
    const { container } = render(
      <SpeakerTrackChips tracks={[track()]} lang="pl" variant="compact" className="ml-1" />,
    );
    expect(container.firstElementChild?.className).toContain("ml-1");
  });
});

describe("SpeakerTrackChips - jezyk nazwy", () => {
  it("wersja angielska bierze nazwe angielska", () => {
    render(<SpeakerTrackChips tracks={[track()]} lang="en" />);
    expect(screen.getByText("Energy")).toBeTruthy();
    expect(screen.queryByText("Energetyka")).toBeNull();
  });

  it("brak nazwy w jezyku karty spada na drugi jezyk (w obie strony)", () => {
    const { unmount } = render(
      <SpeakerTrackChips tracks={[track({ nameEn: null })]} lang="en" variant="compact" />,
    );
    expect(document.body.textContent).toBe(`${labelIn("en")}: Energetyka`);
    unmount();

    render(<SpeakerTrackChips tracks={[track({ namePl: null })]} lang="pl" />);
    expect(screen.getByText("Energy")).toBeTruthy();
  });
});

describe("EventSpeakersSection - sciezki w chipie zapowiedzi", () => {
  function wrapper({ children }: { children: ReactNode }) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }

  function speaker(overrides: Record<string, unknown> = {}) {
    return {
      user_id: "u1",
      display_name: "Anna Kowalska",
      avatar_url: null,
      headline_pl: "Analityczka",
      headline_en: "Analyst",
      job_title: "Ekspertka",
      company: "NASK",
      bio_pl: null,
      bio_en: null,
      topics_pl: [],
      topics_en: [],
      languages: [],
      talks_count: 0,
      rating: 0,
      reviews_count: 0,
      is_expert: false,
      ...overrides,
    };
  }

  beforeEach(() => {
    h.speakers = [];
  });

  it("wiersz ze sciezkami dostaje kwadraty i zdanie dla czytnika w chipie", async () => {
    h.speakers = [speaker({ tracks: [track(), SECOND] })];
    const { container } = render(<EventSpeakersSection eventId="e1" lang="pl" />, { wrapper });

    const chip = await screen.findByRole("button", { name: /Anna Kowalska/ });
    const sentence = `${labelIn("pl")}: Energetyka, Cyberbezpieczenstwo`;
    expect(chip.querySelector(`[title="${sentence}"]`)).not.toBeNull();
    expect(chip.textContent).toContain(sentence);
    // Kwadraty to ozdoba; nazwy niesie zdanie wyzej.
    const compact = chip.querySelector(`[title="${sentence}"]`) as HTMLElement;
    expect(swatchesOf(compact)).toHaveLength(2);
    // Sciezki nie dokladaja pozycji listy - jedna osoba, jedno `li`.
    expect(container.querySelectorAll("li")).toHaveLength(1);
  });

  it("jezyk nazwy sciezki idzie za propsem `lang` sekcji", async () => {
    h.speakers = [speaker({ tracks: [track()] })];
    render(<EventSpeakersSection eventId="e1" lang="en" />, { wrapper });
    const chip = await screen.findByRole("button", { name: /Anna Kowalska/ });
    expect(chip.textContent).toContain(`${labelIn("en")}: Energy`);
    expect(chip.textContent).not.toContain("Energetyka");
  });

  it("wiersz bez sciezek i bez eksperta nie ma zadnego dodatku po prawej", async () => {
    h.speakers = [speaker({ tracks: [] })];
    render(<EventSpeakersSection eventId="e1" lang="pl" />, { wrapper });
    const chip = await screen.findByRole("button", { name: /Anna Kowalska/ });
    expect(chip.textContent).not.toContain(LABEL);
    expect(chip.querySelector("[title]")?.getAttribute("title")).toBe("NASK");
    expect(chip.querySelector("svg")).toBeNull();
  });

  it("wiersz BEZ pola tracks (stary cache) traktuje je jak pusta liste", async () => {
    h.speakers = [speaker()];
    render(<EventSpeakersSection eventId="e1" lang="pl" />, { wrapper });
    const chip = await screen.findByRole("button", { name: /Anna Kowalska/ });
    expect(chip.textContent).not.toContain(LABEL);
  });

  it("ekspert ze sciezkami ma plakietke I kwadraty obok siebie", async () => {
    h.speakers = [speaker({ is_expert: true, tracks: [track()] })];
    render(<EventSpeakersSection eventId="e1" lang="pl" />, { wrapper });
    const chip = await screen.findByRole("button", { name: /Anna Kowalska/ });
    expect(chip.textContent).toContain("eventFront.speakers.expertBadge");
    expect(chip.textContent).toContain(`${labelIn("pl")}: Energetyka`);
  });

  it("ekspert bez sciezek ma sama plakietke, bez pustej etykiety sciezek", async () => {
    h.speakers = [speaker({ is_expert: true, tracks: [] })];
    render(<EventSpeakersSection eventId="e1" lang="pl" />, { wrapper });
    const chip = await screen.findByRole("button", { name: /Anna Kowalska/ });
    expect(chip.textContent).toContain("eventFront.speakers.expertBadge");
    expect(chip.textContent).not.toContain(LABEL);
  });

  it("sciezki bez nazwy nie zostawiaja etykiety w chipie", async () => {
    h.speakers = [speaker({ tracks: [track({ namePl: null, nameEn: null })] })];
    render(<EventSpeakersSection eventId="e1" lang="pl" />, { wrapper });
    const chip = await screen.findByRole("button", { name: /Anna Kowalska/ });
    expect(chip.textContent).not.toContain(LABEL);
  });

  it("osoba bez konta i bez tresci profilu jest martwym wpisem - sciezki zostaja", async () => {
    h.speakers = [speaker({ user_id: "", person_id: "p1", tracks: [track()] })];
    const { container } = render(<EventSpeakersSection eventId="e1" lang="pl" />, { wrapper });
    await screen.findByText("Anna Kowalska");
    expect(screen.queryByRole("button")).toBeNull();
    expect(container.querySelector("li")?.textContent).toContain(`${labelIn("pl")}: Energetyka`);
  });

  it("klik w chip ze sciezkami otwiera profil, a zamkniecie go czysci", async () => {
    h.speakers = [speaker({ tracks: [track()] })];
    render(<EventSpeakersSection eventId="e1" lang="pl" />, { wrapper });
    fireEvent.click(await screen.findByRole("button", { name: /Anna Kowalska/ }));
    const dialog = screen.getByTestId("dialog-prelegenta");
    expect(dialog).toHaveTextContent("u1");
    expect(dialog.getAttribute("data-fallback-name")).toBe("Anna Kowalska");
    expect(dialog.getAttribute("data-fallback-role")).toBe("Analityczka");

    // Potwierdzenie otwarcia nie jest zamknieciem.
    fireEvent.click(screen.getByRole("button", { name: "Potwierdz otwarcie" }));
    expect(screen.getByTestId("dialog-prelegenta")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Zamknij profil" }));
    await waitFor(() => expect(screen.queryByTestId("dialog-prelegenta")).toBeNull());
  });

  it("ekspert z wierszem bez pola tracks, nazwiska, stanowiska i firmy nie wywraca chipu", async () => {
    // Stary wpis cache sprzed kolumny `tracks` i wiersz z pustymi polami:
    // plakietka zostaje, etykiety sciezek nie ma, a dialog dostaje puste
    // dane awaryjne zamiast `null`.
    h.speakers = [
      speaker({
        is_expert: true,
        display_name: null,
        job_title: null,
        headline_pl: null,
        headline_en: null,
        company: null,
        avatar_url: "https://cdn.example/a.jpg",
      }),
    ];
    const { container } = render(<EventSpeakersSection eventId="e1" lang="pl" />, { wrapper });
    const chip = await waitFor(() => {
      const button = container.querySelector("li button");
      expect(button).not.toBeNull();
      return button as HTMLElement;
    });
    expect(chip.textContent).toContain("eventFront.speakers.expertBadge");
    expect(chip.textContent).not.toContain(LABEL);
    expect(chip.querySelector('[title="NASK"]')).toBeNull();

    fireEvent.click(chip);
    const dialog = screen.getByTestId("dialog-prelegenta");
    expect(dialog.getAttribute("data-fallback-name")).toBe("");
    expect(dialog.getAttribute("data-fallback-role")).toBe("");
    expect(dialog.getAttribute("data-fallback-photo")).toBe("https://cdn.example/a.jpg");
  });

  it("bez prelegentow sekcja znika", async () => {
    const { container } = render(<EventSpeakersSection eventId="e1" lang="pl" />, { wrapper });
    await waitFor(() => expect(container.querySelector("section")).toBeNull());
  });
});
