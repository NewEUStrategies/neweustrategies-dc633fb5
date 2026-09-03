// Słownik ODTWARZACZA podcastu (atom `PodcastPlayer`), PL/EN.
//
// DLACZEGO OSOBNA NAKŁADKA, A NIE `i18n-podcasts`. Ten atom montuje się na
// TRZECH niezależnych powierzchniach: publiczna strona odcinka (`/podcast/
// $slug`), panel redakcyjny (podgląd odcinka w edytorze) i widget kreatora
// stron (`PodcastLatestView`). „Słownik publicznej sieci podcastów" nie jest
// więc jego miejscem - nakładka trasy nie jest zarejestrowana tam, gdzie
// odtwarzacz montuje się poza trasą.
//
// STAN ZASTANY. Etykiety transportu były w komponencie jako lokalna para
// obiektów `pl`/`en` wybierana ręcznym `lang === "en" ? en : pl` - czyli dwa
// równoległe zestawy literałów: bramka parytetu PL/EN nie miała czego
// porównać, a `aria-label="Seek"` na suwaku pozycji NIE BYŁ przetłumaczony
// wcale i mówił po angielsku do każdego czytelnika.
//
// ETYKIETY TRANSPORTU SĄ TREŚCIĄ DOSTĘPNOŚCI, NIE OZDOBĄ. Przyciski
// odtwarzacza renderują wyłącznie ikony, więc `aria-label` jest JEDYNĄ rzeczą,
// jaką czytnik ekranu o nich mówi. Etykieta „-15s" (tak było) czytana na głos
// nie znaczy nic; „Cofnij o 15 sekund" znaczy.
import i18n from "./i18n";

export const podcastPlayerPl = {
  podcastPlayer: {
    /** Etykieta całego regionu, gdy odtwarzacz nie dostał tytułu materiału. */
    region: "Odtwarzacz podcastu",
    play: "Odtwórz",
    pause: "Pauza",
    // Pełne zdania zamiast „-15s": ikona nie ma tekstu, więc to jedyna
    // informacja, jaką czytnik ekranu przekazuje o tym przycisku.
    rewind: "Cofnij o 15 sekund",
    forward: "Przewiń o 15 sekund",
    speed: "Tempo odtwarzania",
    mute: "Wycisz",
    // Stan MUSI być w etykiecie: przycisk, który zawsze mówi „Wycisz", kłamie
    // po pierwszym użyciu.
    unmute: "Włącz dźwięk",
    seek: "Pozycja odtwarzania",
    elapsed: "Czas odtwarzania",
    total: "Długość materiału",
    /** Komunikat regionu `aria-live` po przewinięciu - JEDYNA droga zwrotna. */
    seekedTo: "Przewinięto do {{time}}",
  },
};

export const podcastPlayerEn = {
  podcastPlayer: {
    region: "Podcast player",
    play: "Play",
    pause: "Pause",
    rewind: "Rewind 15 seconds",
    forward: "Forward 15 seconds",
    speed: "Playback speed",
    mute: "Mute",
    unmute: "Unmute",
    seek: "Playback position",
    elapsed: "Elapsed time",
    total: "Total length",
    seekedTo: "Skipped to {{time}}",
  },
};

i18n.addResourceBundle("pl", "translation", podcastPlayerPl, true, true);
i18n.addResourceBundle("en", "translation", podcastPlayerEn, true, true);

/**
 * No-op wołany w komponencie zamiast side-effectowego importu modułu. Nazwane
 * wiązanie pozwala bundlerowi trzymać ten słownik w chunku odtwarzacza, a nie
 * w eager-owym grafie wejściowym każdej strony. Rejestracja dzieje się przy
 * ewaluacji modułu (przed renderem), dokładnie jak przy pozostałych nakładkach.
 */
export function ensureI18n(): void {}
