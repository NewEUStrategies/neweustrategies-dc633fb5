// Słownik publicznej sieci podcastów (/podcasts, /podcasts/$show, /podcast/$slug),
// PL/EN.
//
// STAN ZASTANY. Trzy trasy publiczne nie miały słownika w ogóle - 35 etykiet
// przechodziło przez ręczne `lang === "en" ? "..." : "..."`. To nie jest i18n,
// tylko dwa równoległe zestawy literałów: bramka parytetu ich nie widzi,
// brakującego tłumaczenia nie da się wykryć testem, a trzeci język wymagałby
// przepisania każdego wyrażenia warunkowego.
//
// CO ZOSTAJE PRZY `lang`. Rozróżnienie jest istotne i celowe:
//   * ETYKIETY INTERFEJSU idą przez `t()` z tego pliku;
//   * TREŚĆ z bliźniaczych kolumn (`excerpt_pl`/`excerpt_en`, notatki,
//     transkrypcja, tytuły rozdziałów, cytaty, etykiety źródeł) idzie przez
//     kanoniczny `pickLocalized`/`pickPair` - i to jest poprawka, nie tylko
//     przepisanie: ręczne `a_en || a_pl` traktowało ciąg z samych spacji jako
//     obecny, więc pusty w praktyce wpis renderował pustą sekcję zamiast sięgać
//     po drugi język;
//   * funkcje `head()` tras zostają przy `lang`, bo biegną POZA Reactem (SSR
//     składa metadane przed hydracją, `t()` nie jest tam dostępne). Są to
//     wyłącznie tytuły kanałów RSS i opisy Open Graph.
import i18n from "@/lib/i18n";

export const podcastsPl = {
  podcastNetwork: {
    subtitle: "Programy i odcinki",
    programsHeading: "Programy",
    latestHeading: "Najnowsze odcinki",
    emptyEpisodes: "Brak opublikowanych odcinków.",
    loadFailedIndex: "Nie udało się załadować listy",
    loadFailedPodcasts: "Nie udało się załadować podcastów",
    loadFailedShow: "Nie udało się załadować programu",

    // Liczebnik odcinków: polski ma trzy formy istotne dla liczb (1 / 2-4 / 5+),
    // a karta katalogu pokazywała skrót „odc." dla każdej liczby.
    episodeCount_one: "{{count}} odcinek",
    episodeCount_few: "{{count}} odcinki",
    episodeCount_many: "{{count}} odcinków",
    episodeCount_other: "{{count}} odcinków",

    // Strona programu.
    programEyebrow: "Program",
    hostsHeading: "Prowadzący",
    seasonHeading: "Sezon {{season}}",

    // Strona odcinka.
    peopleHeading: "Osoby",
    chaptersHeading: "Rozdziały",
    quotesHeading: "Cytaty do udostępnienia",
    copyQuote: "Kopiuj cytat",
    showNotesHeading: "Notatki",
    sourcesHeading: "Źródła",
    relatedHeading: "Materiały dodatkowe",
    transcriptHeading: "Transkrypcja",
    moreFromShowHeading: "Więcej z tego programu",
    episodeLoadFailed: "Nie udało się wczytać odcinka. Spróbuj ponownie później.",
    episodeNotFound: "Nie znaleziono odcinka.",
  },
};

// Bez `: typeof podcastsPl` - rodzina liczby mnogiej ma w polskim więcej form
// niż w angielskim, więc struktury NIE są identyczne w typie. Parytet pilnuje
// test, który (jak bramka rdzenia locale) normalizuje sufiksy liczby mnogiej
// przed porównaniem zbiorów kluczy.
export const podcastsEn = {
  podcastNetwork: {
    subtitle: "Programs & episodes",
    programsHeading: "Programs",
    latestHeading: "Latest episodes",
    emptyEpisodes: "No episodes published yet.",
    loadFailedIndex: "Couldn't load the list",
    loadFailedPodcasts: "Couldn't load podcasts",
    loadFailedShow: "Couldn't load this programme",

    episodeCount_one: "{{count}} episode",
    episodeCount_other: "{{count}} episodes",

    programEyebrow: "Program",
    hostsHeading: "Hosts",
    seasonHeading: "Season {{season}}",

    peopleHeading: "People",
    chaptersHeading: "Chapters",
    quotesHeading: "Quotes to share",
    copyQuote: "Copy quote",
    showNotesHeading: "Show notes",
    sourcesHeading: "Sources",
    relatedHeading: "Related materials",
    transcriptHeading: "Transcript",
    moreFromShowHeading: "More from this program",
    episodeLoadFailed: "Could not load the episode. Please try again later.",
    episodeNotFound: "Episode not found.",
  },
};

i18n.addResourceBundle("pl", "translation", podcastsPl, true, true);
i18n.addResourceBundle("en", "translation", podcastsEn, true, true);

/**
 * No-op wołany w komponencie trasy zamiast side-effectowego importu modułu.
 * Nazwane wiązanie pozwala splitterowi TanStacka przenieść cały bundle
 * tłumaczeń do chunka trasy - side-effectowy import w pliku trasy lądował
 * w eager-owym grafie wejściowym każdej strony. Rejestracja dzieje się przy
 * ewaluacji modułu (przed renderem komponentu), dokładnie jak wcześniej.
 */
export function ensureI18n(): void {}
