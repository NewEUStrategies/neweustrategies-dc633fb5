import { describe, expect, it } from "vitest";
import {
  buildPodcastRssXml,
  enclosureMimeType,
  type PodcastRssChannelInput,
  type PodcastRssItem,
} from "@/lib/seo/podcastRss";

const baseItem: PodcastRssItem = {
  url: "https://example.org/podcast/odc-1",
  title: "Odcinek 1",
  description: "Opis",
  publishedAt: "2026-07-01T10:00:00Z",
  audioUrl: "https://cdn.example.org/audio/odc-1.mp3",
  durationSeconds: 125,
};

function build(items: PodcastRssItem[], channel: Partial<PodcastRssChannelInput> = {}): string {
  return buildPodcastRssXml({
    title: "Feed",
    description: "Desc",
    siteUrl: "https://example.org/podcasts",
    feedUrl: "https://example.org/podcast/rss.xml",
    language: "pl",
    items,
    ...channel,
  });
}

describe("podcast RSS enclosure", () => {
  it("emits the real byte length and stored MIME when the media library knows them", () => {
    const xml = build([{ ...baseItem, audioBytes: 12_345_678, audioMime: "audio/mpeg" }]);
    expect(xml).toContain(
      '<enclosure url="https://cdn.example.org/audio/odc-1.mp3" length="12345678" type="audio/mpeg"/>',
    );
  });

  it("falls back to length=0 and extension-derived MIME for external URLs", () => {
    const xml = build([{ ...baseItem, audioUrl: "https://ext.example.com/e.m4a" }]);
    expect(xml).toContain(
      '<enclosure url="https://ext.example.com/e.m4a" length="0" type="audio/mp4"/>',
    );
  });

  it("ignores non-positive byte counts", () => {
    const xml = build([{ ...baseItem, audioBytes: 0 }]);
    expect(xml).toContain('length="0"');
  });

  it("keeps itunes:duration in H:MM:SS/MM:SS form", () => {
    const xml = build([baseItem]);
    expect(xml).toContain("<itunes:duration>02:05</itunes:duration>");
  });
});

describe("enclosureMimeType", () => {
  it("maps common podcast extensions", () => {
    expect(enclosureMimeType("https://x/a.mp3")).toBe("audio/mpeg");
    expect(enclosureMimeType("https://x/a.m4a?v=1")).toBe("audio/mp4");
    expect(enclosureMimeType("https://x/a.wav#t")).toBe("audio/wav");
    expect(enclosureMimeType("https://x/a.ogg")).toBe("audio/ogg");
    expect(enclosureMimeType("https://x/bez-rozszerzenia")).toBe("audio/mpeg");
  });
});

// ── Wymagania Apple Podcasts Connect ────────────────────────────────────────
// Kanal bez tych tagow nie zostanie przyjety - a wersja sprzed 2026-07-25
// emitowala z nich tylko <title>/<description>/<language>.
describe("Apple Podcasts Connect channel requirements", () => {
  it("always emits itunes:category, even with no configuration", () => {
    const xml = build([baseItem]);
    expect(xml).toContain('<itunes:category text="News">');
    expect(xml).toContain('<itunes:category text="Politics"/>');
  });

  it("always emits itunes:explicit and itunes:type", () => {
    const xml = build([baseItem]);
    expect(xml).toContain("<itunes:explicit>no</itunes:explicit>");
    expect(xml).toContain("<itunes:type>episodic</itunes:type>");
  });

  it("marks an explicit channel as such", () => {
    const xml = build([baseItem], { explicit: true });
    expect(xml).toContain("<itunes:explicit>yes</itunes:explicit>");
  });

  it("degrades an unknown category to the default instead of emitting it verbatim", () => {
    const xml = build([baseItem], { category: "Geopolityka", subcategory: "UE" });
    expect(xml).not.toContain("Geopolityka");
    expect(xml).toContain('<itunes:category text="News">');
  });

  it("drops a subcategory that does not belong to its category", () => {
    const xml = build([baseItem], { category: "Government", subcategory: "Politics" });
    expect(xml).toContain('<itunes:category text="Government"/>');
    expect(xml).not.toContain('text="Politics"');
  });

  it("falls back to an episode cover when no channel artwork is configured", () => {
    // <itunes:image> jest wymagany - feed nie moze wyjsc bez niego.
    const xml = build([{ ...baseItem, imageUrl: "https://cdn.example.org/cover.jpg" }]);
    expect(xml).toContain('<itunes:image href="https://cdn.example.org/cover.jpg"/>');
  });

  it("emits itunes:owner with the verification e-mail", () => {
    const xml = build([baseItem], {
      ownerName: "New European Strategies",
      ownerEmail: "podcast@example.org",
    });
    expect(xml).toContain("<itunes:owner>");
    expect(xml).toContain("<itunes:name>New European Strategies</itunes:name>");
    expect(xml).toContain("<itunes:email>podcast@example.org</itunes:email>");
    expect(xml).toContain("<managingEditor>podcast@example.org (New European Strategies)");
  });

  it("uses the author as the owner name when only the author is set", () => {
    const xml = build([baseItem], { author: "NES", ownerEmail: "a@b.c" });
    expect(xml).toContain("<itunes:author>NES</itunes:author>");
    expect(xml).toContain("<itunes:name>NES</itunes:name>");
  });

  it("emits itunes:complete only for a finished show", () => {
    expect(build([baseItem])).not.toContain("<itunes:complete>");
    expect(build([baseItem], { complete: true })).toContain(
      "<itunes:complete>yes</itunes:complete>",
    );
  });

  it("escapes channel metadata into valid XML", () => {
    const xml = build([baseItem], { author: 'Ampersand & "quotes" <tag>' });
    expect(xml).toContain("<itunes:author>Ampersand &amp; ");
    expect(xml).not.toContain("<itunes:author>Ampersand & ");
  });
});

describe("Apple Podcasts Connect item requirements", () => {
  it("emits itunes:episodeType and itunes:explicit on every item", () => {
    const xml = build([baseItem]);
    expect(xml).toContain("<itunes:episodeType>full</itunes:episodeType>");
    // Odcinek bez wlasnej wartosci dziedziczy explicit kanalu.
    expect(xml.match(/<itunes:explicit>no<\/itunes:explicit>/g)?.length).toBe(2);
  });

  it("honours a per-episode explicit override and episode type", () => {
    const xml = build([{ ...baseItem, explicit: true, episodeType: "trailer" }], {
      explicit: false,
    });
    expect(xml).toContain("<itunes:episodeType>trailer</itunes:episodeType>");
    expect(xml).toContain("<itunes:explicit>yes</itunes:explicit>");
  });

  it("emits itunes:title alongside the RSS title", () => {
    const xml = build([baseItem]);
    expect(xml).toContain("<itunes:title>Odcinek 1</itunes:title>");
  });
});

// Gotowość kanału (`podcastFeedReadiness`) i `summarizeEpisodes` mają własną,
// pełną powierzchnię w `podcastFeedReadiness.test.ts` - regula po regule.

describe("podcast RSS guid", () => {
  it("uses the language-neutral guid for both language channels", () => {
    // Ten sam odcinek w kanale PL i EN musi mieć JEDNĄ tożsamość - inaczej
    // agregator, który zassał oba kanały, pokazuje podwójny katalog.
    const pl = build([
      {
        ...baseItem,
        url: "https://example.org/podcast/odc-1",
        guid: "https://example.org/podcast/odc-1",
      },
    ]);
    const en = build([
      {
        ...baseItem,
        url: "https://example.org/en/podcast/odc-1",
        guid: "https://example.org/podcast/odc-1",
      },
    ]);
    const guid = '<guid isPermaLink="false">https://example.org/podcast/odc-1</guid>';
    expect(pl).toContain(guid);
    expect(en).toContain(guid);
    // <link> zostaje zlokalizowany - czytelnik EN trafia na wersję EN.
    expect(en).toContain("<link>https://example.org/en/podcast/odc-1</link>");
  });

  it("marks a shared guid as a non-permalink", () => {
    const xml = build([{ ...baseItem, guid: "https://example.org/podcast/odc-1" }]);
    expect(xml).not.toContain('<guid isPermaLink="true">');
  });

  it("falls back to the permalink guid when no shared guid is supplied", () => {
    const xml = build([baseItem]);
    expect(xml).toContain('<guid isPermaLink="true">https://example.org/podcast/odc-1</guid>');
  });
});

// Normalizacja pary (kategoria, podkategoria) ma własną powierzchnię w
// `applePodcastCategories.test.ts` - tam też wejścia niepełne i defekty.

// ── Odcinek z NIEPEŁNYMI danymi ─────────────────────────────────────────────
// Kanał to kontrakt z Apple Podcasts i Spotify: brakujące pole musi ZNIKNĄĆ
// z dokumentu, a nie wyjść jako pusty tag - pusty <pubDate> albo
// <itunes:duration> to dla walidatora Apple błąd całego kanału, nie odcinka.
describe("odcinek z brakującymi polami", () => {
  it.each<[string, Partial<PodcastRssItem>]>([
    ["description = null", { description: null }],
    ["description = pusty string", { description: "" }],
    ["description = same białe znaki", { description: "   " }],
    ["description = znaczniki HTML bez tekstu", { description: "<p></p><br/>" }],
  ])("%s -> <item> bez <description> i <itunes:summary>", (_opis, brak) => {
    const xml = build([{ ...baseItem, ...brak }]);
    // Kanał ma WŁASNY <description>/<itunes:summary> (wymagane przez Apple),
    // więc liczymy wystąpienia: dokładnie jedno = tylko kanał.
    expect(xml.match(/<description>/g)).toHaveLength(1);
    expect(xml.match(/<itunes:summary>/g)).toHaveLength(1);
    // Odcinek nadal jest w kanale - brak opisu go nie usuwa z katalogu.
    expect(xml).toContain("<itunes:title>Odcinek 1</itunes:title>");
  });

  it.each<[string, Partial<PodcastRssItem>]>([
    ["publishedAt = null", { publishedAt: null }],
    ["publishedAt = pusty string", { publishedAt: "" }],
    ["publishedAt = data nieparsowalna", { publishedAt: "kiedyś w lipcu" }],
  ])("%s -> ani <pubDate> odcinka, ani <lastBuildDate> kanału", (_opis, brak) => {
    const xml = build([{ ...baseItem, ...brak }]);
    expect(xml).not.toContain("<pubDate>");
    // `newest` bierze pierwszą PARSOWALNĄ datę z listy - gdy jej nie ma, kanał
    // nie może udawać, że został zbudowany o godzinie zero.
    expect(xml).not.toContain("<lastBuildDate>");
    expect(xml).toContain("<itunes:title>Odcinek 1</itunes:title>");
  });

  it("odcinek bez czasu trwania nie emituje <itunes:duration>", () => {
    const xml = build([{ ...baseItem, durationSeconds: 0 }]);
    expect(xml).not.toContain("<itunes:duration>");
    expect(xml).toContain("<enclosure ");
  });

  it("odcinek bez okładki nie emituje <itunes:image>, a kanał degraduje do braku", () => {
    // Feed BEZ okładki kanału jest w Podcasts Connect nieprzyjmowany - ten stan
    // raportuje `podcastFeedReadiness` (kod "image") jeszcze w panelu.
    const xml = build([{ ...baseItem, imageUrl: null }]);
    expect(xml).not.toContain("<itunes:image");
  });

  it.each<[string, Partial<PodcastRssItem>]>([
    ["audioUrl bez rozszerzenia", { audioUrl: "https://cdn.example.org/strumien" }],
    ["audioMime = null", { audioMime: null }],
    ["audioMime = same białe znaki", { audioMime: "   " }],
  ])("%s -> MIME z rozszerzenia, length=0", (_opis, brak) => {
    const xml = build([{ ...baseItem, ...brak }]);
    expect(xml).toContain('length="0" type="audio/mpeg"/>');
  });

  it("odcinek bez pliku audio emituje <enclosure> z pustym url zamiast pomijać tag", () => {
    // PRZYPIĘTY STAN: builder nie waliduje audioUrl - RSS 2.0 wymaga
    // <enclosure> w każdym <item>, więc odcinek bez pliku wychodzi jako pusty
    // enclosure. Trasa NIE POWINNA podawać takich odcinków (filtruje je
    // zapytanie), a panel widzi je jako brak "enclosureLength".
    const xml = build([{ ...baseItem, audioUrl: "" }]);
    expect(xml).toContain('<enclosure url="" length="0" type="audio/mpeg"/>');
  });
});

describe("numeracja odcinka i typ", () => {
  it("emituje <itunes:season> i <itunes:episode>, gdy odcinek ma numerację", () => {
    const xml = build([{ ...baseItem, season: 2, episodeNumber: 14 }]);
    expect(xml).toContain("<itunes:season>2</itunes:season>");
    expect(xml).toContain("<itunes:episode>14</itunes:episode>");
  });

  it("sezon 0 i odcinek 0 też wychodzą - to numeracja, nie brak wartości", () => {
    // Reguła to `!= null`, nie prawdziwość: sezon 0 (materiał przedpremierowy)
    // musi trafić do kanału, inaczej Apple ustawi go poza serią.
    const xml = build([{ ...baseItem, season: 0, episodeNumber: 0 }]);
    expect(xml).toContain("<itunes:season>0</itunes:season>");
    expect(xml).toContain("<itunes:episode>0</itunes:episode>");
  });

  it.each<[string, Partial<PodcastRssItem>]>([
    ["oba pola undefined", {}],
    ["oba pola null", { season: null, episodeNumber: null }],
  ])("odcinek bez numeracji (%s) nie emituje pustych tagów", (_opis, brak) => {
    const xml = build([{ ...baseItem, ...brak }]);
    expect(xml).not.toContain("<itunes:season>");
    expect(xml).not.toContain("<itunes:episode>");
  });

  // Apple przyjmuje w <itunes:episodeType> WYŁĄCZNIE te trzy wartości.
  it.each<["full" | "trailer" | "bonus"]>([["full"], ["trailer"], ["bonus"]])(
    "episodeType '%s' wychodzi verbatim",
    (typ) => {
      const xml = build([{ ...baseItem, episodeType: typ }]);
      expect(xml).toContain(`<itunes:episodeType>${typ}</itunes:episodeType>`);
    },
  );

  it.each<[string, Partial<PodcastRssItem>]>([
    ["undefined", {}],
    ["null", { episodeType: null }],
  ])("episodeType %s degraduje do 'full'", (_opis, brak) => {
    const xml = build([{ ...baseItem, ...brak }]);
    expect(xml).toContain("<itunes:episodeType>full</itunes:episodeType>");
  });

  it.each<[boolean, boolean, string]>([
    [true, false, "yes"],
    [false, true, "no"],
  ])("explicit odcinka (%s) wygrywa z explicit kanału (%s)", (odcinek, kanal, oczekiwane) => {
    const xml = build([{ ...baseItem, explicit: odcinek }], { explicit: kanal });
    expect(xml).toContain(`      <itunes:explicit>${oczekiwane}</itunes:explicit>`);
  });

  it("explicit = null na odcinku dziedziczy wartość kanału", () => {
    const xml = build([{ ...baseItem, explicit: null }], { explicit: true });
    expect(xml.match(/<itunes:explicit>yes<\/itunes:explicit>/g)).toHaveLength(2);
  });
});

describe("itunes:duration ponad godzinę", () => {
  it.each<[number, string]>([
    [3725, "1:02:05"],
    [3600, "1:00:00"],
    [86_399, "23:59:59"],
    [59, "00:59"],
    [60, "01:00"],
  ])("%i s -> %s", (sekundy, oczekiwane) => {
    const xml = build([{ ...baseItem, durationSeconds: sekundy }]);
    expect(xml).toContain(`<itunes:duration>${oczekiwane}</itunes:duration>`);
  });
});

describe("enclosureMimeType - pełna tablica rozszerzeń", () => {
  it.each<[string, string]>([
    ["https://cdn/a.webm", "audio/webm"],
    ["https://cdn/a.oga", "audio/ogg"],
    ["https://cdn/a.mp4", "audio/mp4"],
    ["https://cdn/a.aac", "audio/mp4"],
    ["https://cdn/a.M4A?token=1", "audio/mp4"],
    ["https://cdn/a.WEBM#t=0", "audio/webm"],
    ["https://cdn/a.flac", "audio/mpeg"],
    ["https://cdn/a", "audio/mpeg"],
    ["", "audio/mpeg"],
  ])("%s -> %s", (url, mime) => {
    expect(enclosureMimeType(url)).toBe(mime);
  });
});

// ── Kanał z niepełną konfiguracją właściciela ───────────────────────────────
describe("itunes:owner przy niepełnych danych", () => {
  it("bez autora i bez nazwy właściciela emituje owner z samym e-mailem", () => {
    // Weryfikacja własności w Podcasts Connect potrzebuje TYLKO <itunes:email>;
    // pusty <itunes:name> byłby błędem walidacji, a "e-mail ()" w
    // <managingEditor> - śmieciem w katalogach czytających RSS 2.0.
    const xml = build([baseItem], {
      author: null,
      ownerName: "   ",
      ownerEmail: "podcast@example.org",
    });
    expect(xml).toContain("<itunes:owner>");
    expect(xml).toContain("<itunes:email>podcast@example.org</itunes:email>");
    expect(xml).not.toContain("<itunes:name>");
    expect(xml).toContain("<managingEditor>podcast@example.org</managingEditor>");
    expect(xml).not.toContain("<itunes:author>");
  });

  it.each<[string, Partial<PodcastRssChannelInput>]>([
    ["wszystko puste", { author: null, ownerName: null, ownerEmail: null }],
    ["same białe znaki", { author: " ", ownerName: " ", ownerEmail: " " }],
  ])("%s -> brak bloku <itunes:owner> i brak <managingEditor>", (_opis, kanal) => {
    const xml = build([baseItem], kanal);
    expect(xml).not.toContain("<itunes:owner>");
    expect(xml).not.toContain("<managingEditor>");
  });

  it("nazwa właściciela bez e-maila nadal daje blok owner (bez managingEditor)", () => {
    const xml = build([baseItem], { ownerName: "NES Media", ownerEmail: null });
    expect(xml).toContain("<itunes:name>NES Media</itunes:name>");
    expect(xml).not.toContain("<itunes:email>");
    expect(xml).not.toContain("<managingEditor>");
  });
});

describe("copyright kanału", () => {
  it("emituje <copyright>, gdy tenant ma ustawioną notę prawną", () => {
    const xml = build([baseItem], { copyright: "© 2026 New European Strategies" });
    expect(xml).toContain("<copyright>© 2026 New European Strategies</copyright>");
  });

  it.each<[string, Partial<PodcastRssChannelInput>]>([
    ["undefined", {}],
    ["null", { copyright: null }],
    ["pusty string", { copyright: "" }],
  ])("copyright %s -> brak tagu <copyright>", (_opis, kanal) => {
    const xml = build([baseItem], kanal);
    expect(xml).not.toContain("<copyright>");
  });
});

describe("kanał bez odcinków", () => {
  it("emituje poprawny, pusty kanał z wymaganymi tagami Apple", () => {
    // Program założony w panelu, jeszcze bez publikacji: feed MUSI się
    // zwalidować, żeby redakcja mogła zgłosić kanał przed pierwszym odcinkiem.
    const xml = build([]);
    expect(xml).toContain("<itunes:explicit>no</itunes:explicit>");
    expect(xml).toContain('<itunes:category text="News">');
    expect(xml).not.toContain("<item>");
    expect(xml).not.toContain("<lastBuildDate>");
    expect(xml).toContain("</channel>");
  });
});
