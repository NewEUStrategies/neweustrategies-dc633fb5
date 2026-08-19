// Zwarta lista odcinków podcastu - używana na powierzchniach agregujących
// (profil eksperta, strona specjalizacji/kategorii).
//
// Kontrakt tego komponentu to „można go wstawić BEZ WARUNKU": przy braku
// danych i przy pustej liście renderuje pustkę, więc host nie musi powielać
// sprawdzenia. Ten kontrakt jest cały sens pliku i ma tu pierwsze asercje.
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Podcast } from "@/lib/podcast/types";

vi.mock("@tanstack/react-router", async () => {
  const { RouterLinkStub } = await import("@/test/routerLinkStub");
  return { Link: RouterLinkStub };
});

const { PodcastEpisodeStrip } = await import("@/components/podcast/PodcastEpisodeStrip");

function episode(overrides: Partial<Podcast> = {}): Podcast {
  return {
    id: "e1",
    tenant_id: "t1",
    slug: "odcinek-pierwszy",
    title_pl: "Odcinek pierwszy",
    title_en: "Episode one",
    excerpt_pl: "Streszczenie",
    excerpt_en: "Summary",
    show_notes_pl: "",
    show_notes_en: "",
    transcript_pl: "",
    transcript_en: "",
    audio_url: "https://cdn.example/a.mp3",
    duration_seconds: 3725,
    episode_number: 4,
    season: 2,
    cover_image_url: null,
    status: "published",
    published_at: "2026-08-01",
    author_id: null,
    show_id: null,
    category_id: null,
    explicit: false,
    episode_type: "full",
    chapters: [],
    quotes: [],
    resources: [],
    created_at: "2026-08-01",
    updated_at: "2026-08-01",
    ...overrides,
  } as Podcast;
}

describe("PodcastEpisodeStrip - kontrakt bezwarunkowego wstawienia", () => {
  it("brak danych renderuje pustkę", () => {
    const { container } = render(
      <PodcastEpisodeStrip episodes={undefined} lang="pl" title="Podcasty" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("pusta lista renderuje pustkę - bez osieroconego nagłówka", () => {
    // Gdyby nagłówek został, ekspert bez odcinków miałby na stronie sekcję
    // „Podcasty" bez ani jednej pozycji.
    const { container } = render(<PodcastEpisodeStrip episodes={[]} lang="pl" title="Podcasty" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("PodcastEpisodeStrip - treść odcinka", () => {
  it("pokazuje nagłówek sekcji podany przez hosta", () => {
    render(<PodcastEpisodeStrip episodes={[episode()]} lang="pl" title="Ostatnie odcinki" />);
    expect(screen.getByRole("heading", { name: "Ostatnie odcinki" })).toBeInTheDocument();
  });

  it("tytuł i streszczenie idą w języku strony", () => {
    const { rerender } = render(
      <PodcastEpisodeStrip episodes={[episode()]} lang="pl" title="Podcasty" />,
    );
    expect(screen.getByText("Odcinek pierwszy")).toBeInTheDocument();
    expect(screen.getByText("Streszczenie")).toBeInTheDocument();

    rerender(<PodcastEpisodeStrip episodes={[episode()]} lang="en" title="Podcasts" />);
    expect(screen.getByText("Episode one")).toBeInTheDocument();
    expect(screen.getByText("Summary")).toBeInTheDocument();
  });

  it("brak streszczenia w języku strony schodzi na drugi język", () => {
    render(
      <PodcastEpisodeStrip episodes={[episode({ excerpt_pl: "" })]} lang="pl" title="Podcasty" />,
    );
    expect(screen.getByText("Summary")).toBeInTheDocument();
  });

  it("odcinek bez żadnego streszczenia nie zostawia pustego akapitu", () => {
    const { container } = render(
      <PodcastEpisodeStrip
        episodes={[episode({ excerpt_pl: "", excerpt_en: "" })]}
        lang="pl"
        title="Podcasty"
      />,
    );
    expect(container.querySelector("p")).toBeNull();
  });

  it("pokazuje oznaczenie sezonu i numeru odcinka", () => {
    render(<PodcastEpisodeStrip episodes={[episode()]} lang="pl" title="Podcasty" />);
    expect(screen.getByText("Sezon 2 · Odc. 4")).toBeInTheDocument();
  });

  it("odcinek bez sezonu i numeru nie ma pustego nadtytułu", () => {
    render(
      <PodcastEpisodeStrip
        episodes={[episode({ season: null, episode_number: null })]}
        lang="pl"
        title="Podcasty"
      />,
    );
    expect(screen.queryByText("·")).not.toBeInTheDocument();
  });

  it("czas trwania jest sformatowany jako H:MM:SS", () => {
    render(<PodcastEpisodeStrip episodes={[episode()]} lang="pl" title="Podcasty" />);
    expect(screen.getByText("1:02:05")).toBeInTheDocument();
  });

  it("prowadzi do strony odcinka po jego slugu", () => {
    render(<PodcastEpisodeStrip episodes={[episode()]} lang="pl" title="Podcasty" />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/podcast/odcinek-pierwszy");
  });

  it("okładka ma PUSTY tekst alternatywny - tytuł stoi obok", () => {
    const { container } = render(
      <PodcastEpisodeStrip
        episodes={[episode({ cover_image_url: "https://cdn.example/ok.jpg" })]}
        lang="pl"
        title="Podcasty"
      />,
    );
    expect(container.querySelector("img")).toHaveAttribute("alt", "");
  });

  it("odcinek BEZ okładki dostaje zastępczą ikonę, nie pusty prostokąt", () => {
    const { container } = render(
      <PodcastEpisodeStrip episodes={[episode()]} lang="pl" title="Podcasty" />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("renderuje wszystkie odcinki listy", () => {
    render(
      <PodcastEpisodeStrip
        episodes={[episode(), episode({ id: "e2", slug: "drugi", title_pl: "Odcinek drugi" })]}
        lang="pl"
        title="Podcasty"
      />,
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("Odcinek drugi")).toBeInTheDocument();
  });
});
