// Czyste reguły panelu podcastów: slug, payloady zapisu, kaskada ustawień,
// selektory listy.
//
// CO DOWODZI TEN PLIK. Te reguły decydują o TREŚCI wiersza zapisywanego do
// bazy, a do 02.09.2026 mieszkały wewnątrz komponentu trasy (2072 linie), więc
// nie miały ani jednego wykonania w testach. Konsekwencje pojedynczych
// pomyłek nie są kosmetyczne:
//   * `|| null` zamienione na `?? null` przy adresach platform zapisuje `""`,
//     a strona programu renderuje wtedy martwy przycisk „Słuchaj w Spotify";
//   * `?? ` zamienione na `||` w kaskadzie ustawień kasuje świadome wyłączenie
//     przełącznika (fałsz przegrywa z domyślnym prawdą);
//   * indeks uczestnika liczony PO odsianiu wierszy-widm przenumerowuje obsadę
//     odcinka przy każdym zapisie;
//   * `published_at` nadpisane bieżącą chwilą przy każdym zapisie przestawia
//     datę publikacji archiwalnego odcinka na dziś.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE: kontraktu zapytań (`queries.test.ts`),
// parserów warstw jsonb (`podcast/types` ma własne testy) ani renderu panelu.
import { describe, expect, it } from "vitest";
import {
  PODCAST_STATUS_FILTERS,
  appleMetaToSettingsPatch,
  buildEpisodePayload,
  buildEpisodePeopleRows,
  buildSettingsPayload,
  buildShowPayload,
  episodeListTitle,
  episodeSeasonLabel,
  filterPodcastRows,
  mergePodcastSettings,
  newEpisodeDraft,
  newShowDraft,
  podcastAdminStats,
  rowToPersonDraft,
  showListTitle,
  showTitleIndex,
  slugifyPodcast,
  type AdminPodcastRow,
  type EpisodeBundle,
} from "@/lib/podcast/shape";
import { DEFAULT_APPLE_CATEGORY } from "@/lib/seo/applePodcastCategories";
import type { PodcastSettings, PodcastShow } from "@/lib/podcast/types";

const NOW = "2026-09-02T10:00:00.000Z";
const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const EPISODE_ID = "22222222-2222-4222-8222-222222222222";

function bundle(overrides: Partial<EpisodeBundle["episode"]> = {}): EpisodeBundle {
  return {
    episode: { ...newEpisodeDraft(NOW), ...overrides },
    chapters: [],
    quotes: [],
    resources: [],
    people: [],
  };
}

function show(overrides: Partial<PodcastShow> = {}): PodcastShow {
  return { ...newShowDraft(0, NOW), ...overrides };
}

function row(overrides: Partial<AdminPodcastRow> = {}): AdminPodcastRow {
  return {
    id: "e1",
    slug: "odc-1",
    title_pl: "Odcinek pierwszy",
    title_en: "Episode one",
    status: "draft",
    duration_seconds: 60,
    episode_number: 1,
    season: 1,
    audio_url: "https://cdn.example.org/1.mp3",
    cover_image_url: null,
    show_id: null,
    published_at: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Slug
// ---------------------------------------------------------------------------

describe("slugifyPodcast", () => {
  it.each([
    ["z pola sluga", "Moj Odcinek", "ignorowany tytul", "moj-odcinek"],
    ["z tytulu, gdy pole puste", "", "Debata o budzecie", "debata-o-budzecie"],
    ["scina znaki interpunkcyjne", "Odcinek #12: (druga czesc)!", "", "odcinek-12-druga-czesc"],
    ["scina myslniki z brzegow", "---odcinek---", "", "odcinek"],
    ["scisza wielkie litery", "ODCINEK", "", "odcinek"],
    ["nie ma z czego zrobic sluga", "", "", ""],
    ["tytul z samych znakow specjalnych daje pustke", "", "###", ""],
  ])("%s", (_label, slug, title, expected) => {
    expect(slugifyPodcast(slug, title)).toBe(expected);
  });

  it("KONTROLA DODATNIA: polskie znaki dzis wypadaja ze sluga", () => {
    // To jest DZISIEJSZE zachowanie, nie postulat. Stoi tu, żeby przypięty
    // niżej defekt nie mógł „przejść" przez przypadkową zmianę wyrażenia.
    expect(slugifyPodcast("", "Sondaz na Baltyku")).toBe("sondaz-na-baltyku");
    expect(slugifyPodcast("", "Sondaż na Bałtyku")).toBe("sonda-na-ba-tyku");
  });

  it.fails("DEFEKT: polski tytul powinien dawac slug transliterowany, nie dziurawy", () => {
    // KONTRAKT, KTÓREGO DZIŚ NIE MA. `[^a-z0-9]+` traktuje „ż" i „ł" jak
    // interpunkcję, więc tytuł „Sondaż na Bałtyku" daje adres
    // /podcast/sonda-na-ba-tyku - nieczytelny dla człowieka i bezużyteczny
    // dla wyszukiwarki. Naprawa (transliteracja PL) to zmiana ZACHOWANIA
    // adresów, więc nie wchodzi razem z ekstrakcją warstwy danych: nowe
    // slugi rozjechałyby się z tymi, które są już opublikowane i zalinkowane.
    expect(slugifyPodcast("", "Sondaż na Bałtyku")).toBe("sondaz-na-baltyku");
  });
});

// ---------------------------------------------------------------------------
// Szkice
// ---------------------------------------------------------------------------

describe("newEpisodeDraft", () => {
  it("startuje jako SZKIC bez tenanta i bez daty publikacji", () => {
    // Szkic z `status: "published"` opublikowałby pusty odcinek jednym
    // kliknięciem „Zapisz".
    const draft = newEpisodeDraft(NOW);
    expect(draft.status).toBe("draft");
    expect(draft.published_at).toBeNull();
    expect(draft.tenant_id).toBe("");
    expect(draft.id).toBe("");
    expect(draft.created_at).toBe(NOW);
    expect(draft.updated_at).toBe(NOW);
  });

  it("ma domyslne pola Apple i puste warstwy jsonb", () => {
    const draft = newEpisodeDraft(NOW);
    expect(draft.episode_type).toBe("full");
    expect(draft.explicit).toBe(false);
    expect(draft.chapters).toEqual([]);
    expect(draft.quotes).toEqual([]);
    expect(draft.resources).toEqual([]);
  });
});

describe("newShowDraft", () => {
  it("wstawia nowy program NA KONIEC kolejnosci redakcyjnej", () => {
    expect(newShowDraft(0, NOW).sort_order).toBe(1);
    expect(newShowDraft(7, NOW).sort_order).toBe(8);
  });

  it("startuje jako szkic bez tenanta", () => {
    const draft = newShowDraft(3, NOW);
    expect(draft.status).toBe("draft");
    expect(draft.tenant_id).toBe("");
    expect(draft.id).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Payload odcinka
// ---------------------------------------------------------------------------

describe("buildEpisodePayload", () => {
  it("NIE niesie tenant_id ani id - te ustala warstwa zapisu", () => {
    // `tenant_id` w payloadzie UPDATE byłby próbą przeniesienia wiersza między
    // najemcami; `id` w payloadzie nadpisywałby klucz główny.
    const payload = buildEpisodePayload(bundle({ id: EPISODE_ID }), NOW);
    expect(payload).not.toHaveProperty("tenant_id");
    expect(payload).not.toHaveProperty("id");
  });

  it("publikacja BEZ daty dostaje date biezaca", () => {
    const payload = buildEpisodePayload(bundle({ status: "published" }), NOW);
    expect(payload.published_at).toBe(NOW);
  });

  it("publikacja Z data zachowuje date archiwalna", () => {
    // Nadpisanie tego pola przy każdym zapisie przestawiłoby archiwalny
    // odcinek na dzisiaj i wywróciło kolejność kanału RSS.
    const payload = buildEpisodePayload(
      bundle({ status: "published", published_at: "2024-03-01T08:00:00.000Z" }),
      NOW,
    );
    expect(payload.published_at).toBe("2024-03-01T08:00:00.000Z");
  });

  it("szkic NIE dostaje daty publikacji", () => {
    expect(buildEpisodePayload(bundle({ status: "draft" }), NOW).published_at).toBeNull();
    expect(
      buildEpisodePayload(
        bundle({ status: "archived", published_at: "2024-03-01T08:00:00.000Z" }),
        NOW,
      ).published_at,
    ).toBe("2024-03-01T08:00:00.000Z");
  });

  it("warstwy jsonb przechodza przez parsery - smieci nie jada do bazy", () => {
    const payload = buildEpisodePayload(
      {
        ...bundle(),
        chapters: [
          { start: 120, title_pl: "Druga czesc", title_en: "" },
          { start: 0, title_pl: "Wstep", title_en: "Intro" },
        ],
        // Cytat bez tresci w zadnym jezyku i zasob bez adresu sa odsiewane.
        quotes: [
          { text_pl: "", text_en: "", attribution: "gen. Skrzypczak" },
          { text_pl: "Cytat", text_en: "", attribution: "" },
        ],
        resources: [
          { label_pl: "Bez adresu", label_en: "", url: "", kind: "source" },
          { label_pl: "Raport", label_en: "Report", url: "https://example.org/r", kind: "related" },
        ],
      },
      NOW,
    );
    // Rozdzialy wracaja POSORTOWANE po czasie startu - inaczej spis tresci
    // odtwarzacza skakalby po odcinku.
    expect(payload.chapters.map((c) => c.start)).toEqual([0, 120]);
    expect(payload.quotes).toHaveLength(1);
    expect(payload.resources).toHaveLength(1);
    expect(payload.resources[0]?.kind).toBe("related");
  });

  it("przepisuje pola dwujezyczne bez zmian", () => {
    const payload = buildEpisodePayload(
      bundle({ title_en: "Episode", excerpt_pl: "Zapowiedz", transcript_en: "Transcript" }),
      NOW,
    );
    expect(payload.title_en).toBe("Episode");
    expect(payload.excerpt_pl).toBe("Zapowiedz");
    expect(payload.transcript_en).toBe("Transcript");
  });
});

// ---------------------------------------------------------------------------
// Payload programu
// ---------------------------------------------------------------------------

describe("buildShowPayload", () => {
  it("puste adresy platform ida jako NULL, nie jako pusty ciag", () => {
    // `""` w kolumnie adresu renderuje w katalogu martwy przycisk platformy.
    const payload = buildShowPayload(
      show({ spotify_url: "", apple_url: null, youtube_url: "https://youtube.example.org/c" }),
    );
    expect(payload.spotify_url).toBeNull();
    expect(payload.apple_url).toBeNull();
    expect(payload.youtube_url).toBe("https://youtube.example.org/c");
  });

  it("okladka przechodzi DOKLADNIE tak, jak ja wpisano (bez zamiany na NULL)", () => {
    // Asymetria wobec adresów platform jest dzisiejszym zachowaniem: pole
    // okładki czyści się w formularzu (`e.target.value || null`), więc warstwa
    // payloadu nie ma czego naprawiać.
    expect(buildShowPayload(show({ cover_image_url: "" })).cover_image_url).toBe("");
    expect(buildShowPayload(show({ cover_image_url: null })).cover_image_url).toBeNull();
  });

  it("slug programu powstaje z tytulu PL, gdy pole puste", () => {
    expect(buildShowPayload(show({ slug: "", title_pl: "Raport Baltycki" })).slug).toBe(
      "raport-baltycki",
    );
  });

  it("NIE niesie tenant_id ani id", () => {
    const payload = buildShowPayload(show({ id: "s1" }));
    expect(payload).not.toHaveProperty("tenant_id");
    expect(payload).not.toHaveProperty("id");
    expect(Object.keys(payload).sort()).toEqual([
      "apple_url",
      "cover_image_url",
      "description_en",
      "description_pl",
      "slug",
      "sort_order",
      "spotify_url",
      "status",
      "title_en",
      "title_pl",
      "youtube_url",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Payload ustawien
// ---------------------------------------------------------------------------

describe("buildSettingsPayload", () => {
  const merged = (patch: Partial<PodcastSettings> = {}): PodcastSettings => ({
    ...mergePodcastSettings({}, null, TENANT_ID),
    ...patch,
  });

  it("wpisuje tenant_id jako klucz singletonu", () => {
    expect(buildSettingsPayload(merged(), TENANT_ID).tenant_id).toBe(TENANT_ID);
  });

  it("kategoria Apple NIGDY nie idzie pusta", () => {
    // Kanał bez `<itunes:category>` jest odrzucany przez Apple Podcasts
    // Connect - dlatego to jedyne pole, które wraca do domyślnego, zamiast
    // lecieć jako NULL.
    expect(buildSettingsPayload(merged({ itunes_category: "" }), TENANT_ID).itunes_category).toBe(
      DEFAULT_APPLE_CATEGORY,
    );
  });

  it("pozostale puste pola tekstowe ida jako NULL", () => {
    const payload = buildSettingsPayload(
      merged({
        spotify_url: "",
        apple_url: "",
        google_url: "",
        rss_url: "",
        itunes_author: "",
        itunes_owner_name: "",
        itunes_owner_email: "",
        itunes_subcategory: "",
        itunes_image_url: "",
        itunes_copyright: "",
      }),
      TENANT_ID,
    );
    for (const value of [
      payload.spotify_url,
      payload.apple_url,
      payload.google_url,
      payload.rss_url,
      payload.itunes_author,
      payload.itunes_owner_name,
      payload.itunes_owner_email,
      payload.itunes_subcategory,
      payload.itunes_image_url,
      payload.itunes_copyright,
    ]) {
      expect(value).toBeNull();
    }
  });

  it("wartosci logiczne przechodza takze jako FALSZ", () => {
    // `|| null` na booleanie zamieniłby świadome „wyłączone" na brak wartości.
    const payload = buildSettingsPayload(
      merged({ show_speed_control: false, itunes_explicit: false, autoplay_next: false }),
      TENANT_ID,
    );
    expect(payload.show_speed_control).toBe(false);
    expect(payload.itunes_explicit).toBe(false);
    expect(payload.autoplay_next).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Uczestnicy
// ---------------------------------------------------------------------------

describe("buildEpisodePeopleRows", () => {
  it("przycina nazwisko, puste URL zamienia na NULL i nadaje kolejnosc", () => {
    const rows = buildEpisodePeopleRows(
      [
        { profile_id: null, display_name: "  Ewa Cis  ", role: "host", url: "   " },
        { profile_id: "p2", display_name: "", role: "guest", url: " https://example.org/x " },
      ],
      TENANT_ID,
      EPISODE_ID,
    );
    expect(rows).toEqual([
      {
        tenant_id: TENANT_ID,
        episode_id: EPISODE_ID,
        profile_id: null,
        display_name: "Ewa Cis",
        role: "host",
        url: null,
        sort_order: 0,
      },
      {
        tenant_id: TENANT_ID,
        episode_id: EPISODE_ID,
        profile_id: "p2",
        display_name: "",
        role: "guest",
        url: "https://example.org/x",
        sort_order: 1,
      },
    ]);
  });

  it("odsiewa wiersz bez profilu i bez nazwiska (odpowiednik CHECK w bazie)", () => {
    const rows = buildEpisodePeopleRows(
      [{ profile_id: null, display_name: "   ", role: "guest", url: "https://example.org/x" }],
      TENANT_ID,
      EPISODE_ID,
    );
    // Sam adres nie wystarcza - wiersz-widmo wywróciłby cały zapis na CHECK.
    expect(rows).toEqual([]);
  });

  it("kolejnosc liczy sie PRZED odsianiem, wiec po wierszu-widmie zostaje luka", () => {
    // To dzisiejsze zachowanie i jest nieszkodliwe: `sort_order` służy tylko
    // do sortowania, więc luka niczego nie psuje. Test stoi tu, żeby zmiana
    // na numerację ciągłą była decyzją, a nie skutkiem ubocznym refaktoru.
    const rows = buildEpisodePeopleRows(
      [
        { profile_id: null, display_name: "Pierwsza", role: "host", url: "" },
        { profile_id: null, display_name: "", role: "guest", url: "" },
        { profile_id: null, display_name: "Trzecia", role: "guest", url: "" },
      ],
      TENANT_ID,
      EPISODE_ID,
    );
    expect(rows.map((r) => r.sort_order)).toEqual([0, 2]);
  });

  it("pusta lista uczestnikow daje pusta tablice", () => {
    expect(buildEpisodePeopleRows([], TENANT_ID, EPISODE_ID)).toEqual([]);
  });
});

describe("rowToPersonDraft", () => {
  it("normalizuje role poza enumem do goscia", () => {
    // Selekt edytora ma dwie opcje; rola „moderator" z bazy nie może zostawić
    // pustego selecta, bo zapis wysłałby wtedy wartość, której nie ma w enumie.
    expect(
      rowToPersonDraft({
        id: "p1",
        profile_id: null,
        display_name: "Ewa Cis",
        role: "moderator",
        url: null,
        sort_order: 0,
      }),
    ).toEqual({ id: "p1", profile_id: null, display_name: "Ewa Cis", role: "guest", url: "" });
  });

  it("zachowuje role prowadzacego i adres", () => {
    expect(
      rowToPersonDraft({
        id: "p2",
        profile_id: "prof",
        display_name: "Igor Nowak",
        role: "host",
        url: "https://example.org/i",
        sort_order: 3,
      }),
    ).toEqual({
      id: "p2",
      profile_id: "prof",
      display_name: "Igor Nowak",
      role: "host",
      url: "https://example.org/i",
    });
  });
});

// ---------------------------------------------------------------------------
// Kaskada ustawien
// ---------------------------------------------------------------------------

describe("mergePodcastSettings", () => {
  const saved: PodcastSettings = {
    ...mergePodcastSettings({}, null, TENANT_ID),
    show_speed_control: true,
    spotify_url: "https://open.spotify.example.org/show/1",
    itunes_author: "Redakcja",
    itunes_explicit: true,
  };

  it("wersja robocza formularza wygrywa z zapisanym wierszem", () => {
    const merged = mergePodcastSettings({ itunes_author: "Nowa redakcja" }, saved, TENANT_ID);
    expect(merged.itunes_author).toBe("Nowa redakcja");
    expect(merged.spotify_url).toBe("https://open.spotify.example.org/show/1");
  });

  it("FALSZ z formularza wygrywa z zapisanym prawdą (kaskada na ?? , nie na ||)", () => {
    // To jest sedno tego bloku: `||` zjadłby świadome wyłączenie przełącznika
    // i panel wracałby do „włączone" przy każdym renderze.
    const merged = mergePodcastSettings(
      { show_speed_control: false, itunes_explicit: false },
      saved,
      TENANT_ID,
    );
    expect(merged.show_speed_control).toBe(false);
    expect(merged.itunes_explicit).toBe(false);
  });

  it("bez formularza i bez wiersza wchodza wartosci domyslne", () => {
    const merged = mergePodcastSettings({}, null, TENANT_ID);
    expect(merged.default_player_variant).toBe("full");
    expect(merged.show_speed_control).toBe(true);
    expect(merged.autoplay_next).toBe(false);
    expect(merged.itunes_type).toBe("episodic");
    expect(merged.itunes_category).toBe(DEFAULT_APPLE_CATEGORY);
    expect(merged.spotify_url).toBe("");
  });

  it("brak tenanta daje pusty tenant_id, a nie wyjatek", () => {
    // Panel musi się wyrenderować także wtedy, gdy `useAuth` jeszcze nie
    // rozwiązał tenanta; odmowa zapisu należy do warstwy zapisu, nie do
    // kształtowania formularza.
    expect(mergePodcastSettings({}, null, null).tenant_id).toBe("");
  });
});

describe("appleMetaToSettingsPatch", () => {
  it("przepisuje TYLKO pola obecne w latce", () => {
    // `undefined` w wyniku nadpisałoby zapisaną wartość pustką przy zapisie.
    expect(appleMetaToSettingsPatch({ author: "Redakcja" })).toEqual({
      itunes_author: "Redakcja",
    });
  });

  it("falsz i pusty ciag SA polami obecnymi", () => {
    expect(appleMetaToSettingsPatch({ explicit: false, copyright: "" })).toEqual({
      itunes_explicit: false,
      itunes_copyright: "",
    });
  });

  it("mapuje wszystkie dziewiec pol sekcji Apple", () => {
    expect(
      appleMetaToSettingsPatch({
        author: "a",
        ownerName: "b",
        ownerEmail: "c@example.org",
        category: "News",
        subcategory: "Politics",
        explicit: true,
        showType: "serial",
        imageUrl: "https://example.org/i.png",
        copyright: "(c) 2026",
      }),
    ).toEqual({
      itunes_author: "a",
      itunes_owner_name: "b",
      itunes_owner_email: "c@example.org",
      itunes_category: "News",
      itunes_subcategory: "Politics",
      itunes_explicit: true,
      itunes_type: "serial",
      itunes_image_url: "https://example.org/i.png",
      itunes_copyright: "(c) 2026",
    });
  });

  it("pusta latka nie zmienia niczego", () => {
    expect(appleMetaToSettingsPatch({})).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Selektory listy
// ---------------------------------------------------------------------------

describe("etykiety i indeks programow", () => {
  it("tytul programu spada z PL na EN, a na koncu na slug", () => {
    expect(showListTitle({ title_pl: "PL", title_en: "EN", slug: "s" })).toBe("PL");
    expect(showListTitle({ title_pl: "", title_en: "EN", slug: "s" })).toBe("EN");
    expect(showListTitle({ title_pl: "", title_en: "", slug: "s" })).toBe("s");
  });

  it("tytul odcinka spada tak samo", () => {
    expect(episodeListTitle({ title_pl: "", title_en: "", slug: "odc-1" })).toBe("odc-1");
  });

  it("indeks programow mapuje id na etykiete i znosi brak listy", () => {
    const index = showTitleIndex([show({ id: "s1", title_pl: "Raport" })]);
    expect(index.get("s1")).toBe("Raport");
    expect(showTitleIndex(undefined).size).toBe(0);
  });
});

describe("podcastAdminStats", () => {
  it("liczy tylko opublikowane i szkice, a czas sumuje z pominieciem zera", () => {
    const stats = podcastAdminStats([
      row({ id: "a", status: "published", duration_seconds: 600 }),
      row({ id: "b", status: "draft", duration_seconds: 0 }),
      row({ id: "c", status: "archived", duration_seconds: 300 }),
    ]);
    // Archiwum liczy się do `total` i do czasu, ale nie do dwóch kart
    // pośrodku - tak wyglądał pasek statystyk przed ekstrakcją.
    expect(stats).toEqual({ total: 3, published: 1, drafts: 1, totalSeconds: 900 });
  });

  it("brak listy to cztery zera, a nie wyjatek", () => {
    expect(podcastAdminStats(undefined)).toEqual({
      total: 0,
      published: 0,
      drafts: 0,
      totalSeconds: 0,
    });
  });
});

describe("filterPodcastRows", () => {
  const rows = [
    row({ id: "a", slug: "sondaz", title_pl: "Sondaz", title_en: "Poll", status: "published" }),
    row({ id: "b", slug: "budzet", title_pl: "Budzet", title_en: "Budget", status: "draft" }),
    row({ id: "c", slug: "archiwum", title_pl: "Stare", title_en: "Old", status: "archived" }),
  ];

  it("filtr `all` przepuszcza wszystko", () => {
    expect(filterPodcastRows(rows, "", "all").map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("filtr statusu odsiewa pozostale stany", () => {
    expect(filterPodcastRows(rows, "", "draft").map((r) => r.id)).toEqual(["b"]);
    expect(filterPodcastRows(rows, "", "archived").map((r) => r.id)).toEqual(["c"]);
  });

  it("szuka w tytule PL, tytule EN i slugu, bez wielkosci liter", () => {
    expect(filterPodcastRows(rows, "SONDA", "all").map((r) => r.id)).toEqual(["a"]);
    expect(filterPodcastRows(rows, "budget", "all").map((r) => r.id)).toEqual(["b"]);
    expect(filterPodcastRows(rows, "archiwum", "all").map((r) => r.id)).toEqual(["c"]);
  });

  it("fraza z samych spacji nie filtruje niczego", () => {
    expect(filterPodcastRows(rows, "   ", "all")).toHaveLength(3);
  });

  it("status ORAZ fraza dzialaja razem (koniunkcja, nie alternatywa)", () => {
    expect(filterPodcastRows(rows, "sonda", "draft")).toEqual([]);
    expect(filterPodcastRows(rows, "sonda", "published").map((r) => r.id)).toEqual(["a"]);
  });

  it("brak listy daje pusta tablice", () => {
    expect(filterPodcastRows(undefined, "cokolwiek", "all")).toEqual([]);
  });

  it("kolejnosc przyciskow filtra jest kontraktem paska nad lista", () => {
    expect([...PODCAST_STATUS_FILTERS]).toEqual(["all", "published", "draft", "archived"]);
  });
});

describe("episodeSeasonLabel", () => {
  it.each([
    ["sezon i numer", 2, 7, "S2 · E7"],
    ["tylko sezon", 3, null, "S3"],
    ["tylko numer", null, 12, "E12"],
    ["nic", null, null, ""],
    // Sezon zero jest dziś traktowany jak brak sezonu (test warunkowy na
    // prawdziwości, nie na `!= null`) - zapisane, żeby nie zmieniło się to
    // przypadkiem przy okazji innej pracy.
    ["sezon zerowy liczy sie jak brak", 0, 4, "E4"],
  ])("%s", (_label, season, episodeNumber, expected) => {
    expect(episodeSeasonLabel({ season, episode_number: episodeNumber })).toBe(expected);
  });
});
