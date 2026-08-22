// Checklista gotowości kanału podcastowego do zgłoszenia w Apple Podcasts
// Connect. Moduł jest wołany z PANELU (/admin/podcasts), żeby redakcja widziała
// braki ZANIM Apple odrzuci zgłoszenie i bez wciągania generatora RSS do bundla.
//
// Każda reguła ma tu własny wiersz tabeli - z osobnym sprawdzeniem wejść
// niepełnych (undefined / null / "" / same białe znaki / 0) - plus stan
// "wszystko gotowe" i stan "brak kilku rzeczy naraz".
import { describe, expect, it } from "vitest";
import {
  podcastFeedReadiness,
  summarizeEpisodes,
  type PodcastFeedReadinessInput,
} from "@/lib/seo/podcastFeedReadiness";

const KOMPLETNY: PodcastFeedReadinessInput = {
  title: "Brussels Brief",
  description: "Cotygodniowa analiza polityki europejskiej.",
  language: "pl",
  imageUrl: "https://cdn.example.org/cover.jpg",
  author: "New European Strategies",
  ownerName: "NES Media",
  ownerEmail: "podcast@example.org",
  copyright: "© 2026 New European Strategies",
  episodes: { total: 4, withoutByteLength: 0, withoutDuration: 0 },
};

describe("podcastFeedReadiness - kanał gotowy", () => {
  it("w pełni wypełniony kanał nie ma ani blokad, ani ostrzeżeń", () => {
    expect(podcastFeedReadiness(KOMPLETNY)).toEqual({
      ready: true,
      blocking: [],
      warnings: [],
    });
  });

  // Kontrakt z komentarza podcastFeedReadiness.ts:58-61: kategoria i explicit
  // NIE są tu sprawdzane, bo builder ma dla nich wartości domyślne. Gdyby ktoś
  // dodał je jako regułę, panel blokowałby zgłoszenie, którego Apple przyjmie.
  it("nie raportuje kategorii ani explicit - builder ma dla nich wartości domyślne", () => {
    const r = podcastFeedReadiness(KOMPLETNY);
    expect(r.blocking).not.toContain("category");
    expect(r.blocking).not.toContain("explicit");
    expect(r.warnings).not.toContain("category");
    expect(r.warnings).not.toContain("explicit");
  });
});

// Blokady: Apple odrzuci kanał albo nie da się potwierdzić własności.
// Każdy wiersz izoluje JEDNĄ regułę - `blocking` musi mieć dokładnie ten kod,
// żeby panel nie mieszał braków, których nie ma.
describe("podcastFeedReadiness - reguły blokujące", () => {
  it.each<[string, Partial<PodcastFeedReadinessInput>, string]>([
    ["title = pusty string", { title: "" }, "title"],
    ["title = same białe znaki", { title: "   " }, "title"],
    ["description = pusty string", { description: "" }, "description"],
    ["description = same białe znaki i nowe linie", { description: " \n\t " }, "description"],
    ["language = pusty string", { language: "" }, "language"],
    ["language = same białe znaki", { language: " " }, "language"],
    ["imageUrl = undefined", { imageUrl: undefined }, "image"],
    ["imageUrl = null", { imageUrl: null }, "image"],
    ["imageUrl = pusty string", { imageUrl: "" }, "image"],
    ["imageUrl = same białe znaki", { imageUrl: "  " }, "image"],
    ["ownerEmail = undefined", { ownerEmail: undefined }, "ownerEmail"],
    ["ownerEmail = null", { ownerEmail: null }, "ownerEmail"],
    ["ownerEmail = pusty string", { ownerEmail: "" }, "ownerEmail"],
    ["ownerEmail = same białe znaki", { ownerEmail: " " }, "ownerEmail"],
    [
      "episodes.total = 0",
      { episodes: { total: 0, withoutByteLength: 0, withoutDuration: 0 } },
      "episodes",
    ],
  ])("%s blokuje zgłoszenie kodem '%s' i niczym więcej", (_opis, brak, kod) => {
    const r = podcastFeedReadiness({ ...KOMPLETNY, ...brak });
    expect(r.ready).toBe(false);
    expect(r.blocking).toEqual([kod]);
    expect(r.warnings).toEqual([]);
  });
});

// Ostrzeżenia: kanał przejdzie walidację, ale wpis w katalogu będzie ubogi.
// Rozdział blocking/warnings jest tu istotą modułu - ostrzeżenie NIE MOŻE
// zatrzymać zgłoszenia, bo redakcja czekałaby na dane, których Apple nie wymaga.
describe("podcastFeedReadiness - ostrzeżenia bez blokady", () => {
  it.each<[string, Partial<PodcastFeedReadinessInput>, string]>([
    ["author = undefined", { author: undefined }, "author"],
    ["author = null", { author: null }, "author"],
    ["author = pusty string", { author: "" }, "author"],
    ["author = same białe znaki", { author: "   " }, "author"],
    ["ownerName = undefined", { ownerName: undefined }, "ownerName"],
    ["ownerName = null", { ownerName: null }, "ownerName"],
    ["ownerName = pusty string", { ownerName: "" }, "ownerName"],
    ["copyright = undefined", { copyright: undefined }, "copyright"],
    ["copyright = null", { copyright: null }, "copyright"],
    ["copyright = same białe znaki", { copyright: "  " }, "copyright"],
    [
      "jeden odcinek bez znanego rozmiaru pliku",
      { episodes: { total: 3, withoutByteLength: 1, withoutDuration: 0 } },
      "enclosureLength",
    ],
    [
      "jeden odcinek bez czasu trwania",
      { episodes: { total: 3, withoutByteLength: 0, withoutDuration: 1 } },
      "duration",
    ],
  ])("%s daje ostrzeżenie '%s' i nie blokuje zgłoszenia", (_opis, brak, kod) => {
    const r = podcastFeedReadiness({ ...KOMPLETNY, ...brak });
    expect(r.ready).toBe(true);
    expect(r.blocking).toEqual([]);
    expect(r.warnings).toEqual([kod]);
  });
});

describe("podcastFeedReadiness - brak kilku rzeczy naraz", () => {
  it("raportuje wszystkie braki jednocześnie, w kolejności reguł", () => {
    const r = podcastFeedReadiness({
      title: "",
      description: "   ",
      language: "",
      imageUrl: null,
      author: null,
      ownerName: "",
      ownerEmail: undefined,
      copyright: "  ",
      episodes: { total: 0, withoutByteLength: 2, withoutDuration: 3 },
    });
    expect(r.ready).toBe(false);
    expect(r.blocking).toEqual([
      "title",
      "description",
      "language",
      "image",
      "ownerEmail",
      "episodes",
    ]);
    expect(r.warnings).toEqual(["author", "ownerName", "copyright", "enclosureLength", "duration"]);
  });

  it("świeżo utworzony program (tylko tytuł) blokuje się na wszystkim poza tytułem", () => {
    const r = podcastFeedReadiness({
      title: "Nowy program",
      description: "",
      language: "",
      episodes: { total: 0, withoutByteLength: 0, withoutDuration: 0 },
    });
    expect(r.blocking).toEqual(["description", "language", "image", "ownerEmail", "episodes"]);
    expect(r.warnings).toEqual(["author", "ownerName", "copyright"]);
  });

  it("kanał z blokadą i ostrzeżeniem naraz nie jest gotowy", () => {
    const r = podcastFeedReadiness({
      ...KOMPLETNY,
      ownerEmail: null,
      episodes: { total: 2, withoutByteLength: 2, withoutDuration: 2 },
    });
    expect(r.ready).toBe(false);
    expect(r.blocking).toEqual(["ownerEmail"]);
    expect(r.warnings).toEqual(["enclosureLength", "duration"]);
  });
});

describe("summarizeEpisodes", () => {
  it("liczy odcinki bez prawdziwego rozmiaru pliku i bez czasu trwania", () => {
    expect(
      summarizeEpisodes([
        { audioBytes: 1000, durationSeconds: 60 },
        { audioBytes: null, durationSeconds: 0 },
        { audioBytes: 0, durationSeconds: 30 },
        { audioBytes: undefined, durationSeconds: -1 },
      ]),
    ).toEqual({ total: 4, withoutByteLength: 3, withoutDuration: 2 });
  });

  it("pusta lista odcinków daje zerowe podsumowanie, które blokuje zgłoszenie", () => {
    const summary = summarizeEpisodes([]);
    expect(summary).toEqual({ total: 0, withoutByteLength: 0, withoutDuration: 0 });
    expect(podcastFeedReadiness({ ...KOMPLETNY, episodes: summary }).blocking).toEqual([
      "episodes",
    ]);
  });
});
