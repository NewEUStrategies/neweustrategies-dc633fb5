// Atom `PodcastPlayer` - DOSTĘPNOŚĆ TRANSPORTU I ZWROTNA INFORMACJA O POZYCJI.
//
// CO DOWODZI TEN PLIK I JAKA JEST KONSEKWENCJA DEFEKTU.
//
// Ten odtwarzacz renderuje SAME IKONY. `aria-label` jest więc jedyną rzeczą,
// jaką czytnik ekranu mówi o każdym z sześciu elementów sterujących - i jedyną
// rzeczą, po której da się je znaleźć nawigacją po nagłówkach i kontrolkach.
// Zgubiona etykieta nie psuje niczego, co widać: strona wygląda identycznie,
// a dla osoby korzystającej z czytnika odtwarzacz zamienia się w rząd
// nienazwanych przycisków.
//
// TRZY REGUŁY, KTÓRYCH ZŁAMANIE KOSZTUJE:
//
//   1. ETYKIETA NIESIE STAN, NIE TYLKO AKCJĘ. Przycisk, który zawsze mówi
//      „Odtwórz", kłamie od pierwszego kliknięcia; to samo dotyczy wyciszenia.
//      Osoba, która nie widzi ikony, nie ma innego źródła tej informacji.
//   2. ETYKIETY IDĄ ZE SŁOWNIKA I ISTNIEJĄ W OBU JĘZYKACH. Do dziś były
//      lokalną parą obiektów `pl`/`en` w komponencie (bramka parytetu PL/EN nie
//      miała czego porównać), a suwak pozycji nosił `aria-label="Seek"` -
//      NIEPRZETŁUMACZONY, czyli mówiący po angielsku do każdego czytelnika.
//   3. PRZEWINIĘCIE MA DROGĘ ZWROTNĄ, A LICZNIK NIE ZAGŁUSZA STRONY. To jedna
//      decyzja o dwóch stronach: `aria-live="polite"` na tykającym liczniku
//      zamieniłby czytnik ekranu w zegar czytany bez przerwy przez całą długość
//      odcinka, więc licznik jest `role="timer"` z `aria-live="off"`, a skutek
//      DZIAŁANIA czytelnika (przewinięcie, skok do rozdziału) ogłasza osobny
//      region `role="status"`. Test pilnuje OBU połówek, bo naprawa jednej bez
//      drugiej daje albo brak informacji, albo hałas.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - TRWAŁOŚCI POZYCJI I TEMPA (`localStorage`), ARBITRAŻU SZYNY ODTWARZANIA
//   i MEDIA SESSION API: to zachowania, nie dostępność, i mają własne moduły
//   (`lib/audio/playbackRate.ts`, `lib/audio/playbackBus.ts`).
// - TEGO, CO TRASA PODAJE ODTWARZACZOWI (wariant, `showSpeed`, `registerSeek`):
//   asercje przy trasie, w `src/routes/__tests__/podcastEpisodeRoute.test.tsx`.
// - PARYTETU SŁOWNIKA PL/EN: `src/lib/__tests__/i18nPodcastPlayer.test.ts`.
//
// UWAGA O ŚRODOWISKU. happy-dom nie implementuje `HTMLMediaElement.play()`,
// więc stanu „gra" NIE wywołujemy klikając przycisk - emitujemy zdarzenie
// `play` na elemencie `<audio>`. To jest zresztą wierniejsze produkcji:
// komponent świadomie napędza stan ZDARZENIAMI mediów, a nie własnym
// togglem, żeby pauza z systemu operacyjnego albo z innej karty też
// przestawiała ikonę.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import "@/test/i18nReal";
import { axeViolations, summarize } from "@/test/axe";
import { PodcastPlayer } from "@/components/atoms/PodcastPlayer";

const SRC = "https://audio.example.org/odcinek.mp3";

/** Element `<audio>` odtwarzacza - z twardym błędem, gdy go nie ma. */
function audioOf(container: HTMLElement): HTMLElement {
  const audio = container.querySelector("audio");
  if (!(audio instanceof HTMLElement)) throw new Error("test: odtwarzacz nie ma elementu <audio>");
  return audio;
}

/**
 * Region `aria-live`, który ogłasza skutek przewinięcia - z twardym błędem,
 * gdy go nie ma. Test „przechodzący" na brakującym regionie nie dowodzi niczego.
 */
function liveRegion(container: HTMLElement): HTMLElement {
  const node = container.querySelector('[role="status"][aria-live="polite"]');
  if (!(node instanceof HTMLElement)) {
    throw new Error('test: brak regionu role="status" aria-live="polite"');
  }
  return node;
}

/** Licznik czasu odtwarzania - z twardym błędem, gdy go nie ma. */
function timerNode(container: HTMLElement): HTMLElement {
  const node = container.querySelector('[role="timer"]');
  if (!(node instanceof HTMLElement)) throw new Error('test: brak role="timer" na czasie');
  return node;
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("PodcastPlayer - etykiety transportu po polsku", () => {
  it("wszystkie sześć elementów sterujących ma etykietę, nie tylko ikonę", async () => {
    // Odtwarzacz renderuje SAME ikony, więc to jedyne, co czytnik ekranu o nich
    // mówi. Brak etykiety = rząd nienazwanych przycisków przy identycznym
    // wyglądzie strony.
    render(<PodcastPlayer src={SRC} initialDuration={1830} title="Zima bez gazu" />);

    expect(screen.getByRole("button", { name: "Odtwórz" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cofnij o 15 sekund" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Przewiń o 15 sekund" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Wycisz" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Tempo odtwarzania" })).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "Pozycja odtwarzania" })).toBeInTheDocument();
  });

  it("etykieta przewijania jest ZDANIEM, a nie skrótem „-15s”", async () => {
    // Regresja z premedytacją: wcześniej etykietą było dosłownie „−15s”, co
    // czytnik ekranu czyta jako ciąg znaków bez znaczenia. Ikona nie ma tekstu,
    // więc etykieta musi sama powiedzieć, co ten przycisk robi.
    render(<PodcastPlayer src={SRC} initialDuration={1830} />);

    const rewind = screen.getByRole("button", { name: "Cofnij o 15 sekund" });
    expect(rewind.getAttribute("aria-label")).not.toMatch(/^[-+−]?15s$/);
  });

  it("etykieta odtwarzania NIESIE STAN: po starcie mówi „Pauza”", async () => {
    // Przycisk, który zawsze mówi „Odtwórz", kłamie od pierwszego użycia -
    // a osoba, która nie widzi ikony, nie ma innego źródła tej informacji.
    const { container } = render(<PodcastPlayer src={SRC} initialDuration={1830} />);
    expect(screen.getByRole("button", { name: "Odtwórz" })).toBeInTheDocument();

    fireEvent(audioOf(container), new Event("play"));

    expect(screen.getByRole("button", { name: "Pauza" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Odtwórz" })).toBeNull();
  });

  it("etykieta wyciszenia też niesie stan - po wyciszeniu mówi „Włącz dźwięk”", async () => {
    render(<PodcastPlayer src={SRC} initialDuration={1830} />);

    fireEvent.click(screen.getByRole("button", { name: "Wycisz" }));

    expect(screen.getByRole("button", { name: "Włącz dźwięk" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Wycisz" })).toBeNull();
  });

  it("region odtwarzacza ma nazwę także BEZ tytułu materiału", async () => {
    // `aria-label` regionu spadał wcześniej na literał „Podcast" - poza
    // słownikiem i jednojęzyczny. Bez nazwy region nie daje się znaleźć
    // nawigacją po landmarkach.
    render(<PodcastPlayer src={SRC} initialDuration={1830} />);

    expect(screen.getByRole("region", { name: "Odtwarzacz podcastu" })).toBeInTheDocument();
  });

  it("z tytułem materiału region nazywa się TYM tytułem", async () => {
    // Kontrola dodatnia dla poprzedniego przypadku: na stronie z kilkoma
    // odtwarzaczami (widget „najnowsze odcinki") wspólna nazwa regionu nie
    // pozwoliłaby ich rozróżnić.
    render(<PodcastPlayer src={SRC} initialDuration={1830} title="Zima bez gazu" />);

    expect(screen.getByRole("region", { name: "Zima bez gazu" })).toBeInTheDocument();
  });
});

describe("PodcastPlayer - etykiety transportu po angielsku", () => {
  it("prop `lang` przestawia WSZYSTKIE etykiety, nie tylko część", async () => {
    // Częściowe tłumaczenie jest gorsze niż brak: czytelnik EN dostaje
    // odtwarzacz, który mówi do niego dwoma językami naraz. Wcześniej dokładnie
    // tak było - suwak pozycji miał etykietę wpisaną po angielsku na sztywno,
    // więc w wersji POLSKIEJ mówił „Seek".
    render(<PodcastPlayer src={SRC} initialDuration={1830} lang="en" />);

    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rewind 15 seconds" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Forward 15 seconds" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mute" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Playback speed" })).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "Playback position" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Podcast player" })).toBeInTheDocument();
  });

  it("w wersji polskiej suwak NIE mówi po angielsku", async () => {
    // Bezpośrednia zapadka na defekcie, który tu był: `aria-label="Seek"`.
    render(<PodcastPlayer src={SRC} initialDuration={1830} lang="pl" />);

    expect(screen.queryByRole("slider", { name: "Seek" })).toBeNull();
  });
});

describe("PodcastPlayer - czas odtwarzania i aria-live", () => {
  it('licznik jest `role="timer"` z `aria-live="off"` - nie zagłusza strony', async () => {
    // Druga połowa jednej decyzji (pierwsza niżej). Tekst licznika zmienia się
    // raz na sekundę przez całą długość odcinka; region „polite" czytałby to
    // bez przerwy i zagłuszył resztę strony. To NIE jest brak dostępności -
    // to warunek jej użyteczności.
    const { container } = render(<PodcastPlayer src={SRC} initialDuration={1830} />);
    const timer = timerNode(container);

    expect(timer.getAttribute("aria-live")).toBe("off");
    expect(timer.getAttribute("aria-label")).toBe("Czas odtwarzania");
    expect(timer.textContent).toBe("0:00");
  });

  it("region `aria-live` startuje PUSTY - nie czyta się przy wejściu na stronę", async () => {
    // Region wypełniony przy pierwszym renderze byłby czytany od razu po
    // wejściu na stronę odcinka, zanim czytelnik cokolwiek zrobił.
    const { container } = render(<PodcastPlayer src={SRC} initialDuration={1830} />);

    expect(liveRegion(container).textContent).toBe("");
  });

  it("przewinięcie do przodu OGŁASZA nową pozycję w regionie `aria-live`", async () => {
    // Bez tego osoba, która nie widzi suwaka, nie ma ŻADNEJ informacji o tym,
    // czy przycisk „+15 s" cokolwiek zrobił - licznik jest celowo `off`.
    const { container } = render(<PodcastPlayer src={SRC} initialDuration={1830} />);

    fireEvent.click(screen.getByRole("button", { name: "Przewiń o 15 sekund" }));

    expect(liveRegion(container).textContent).toBe("Przewinięto do 0:15");
  });

  it("przeciągnięcie suwaka też ogłasza pozycję, i to w języku odtwarzacza", async () => {
    const { container } = render(<PodcastPlayer src={SRC} initialDuration={1830} lang="en" />);

    fireEvent.change(screen.getByRole("slider", { name: "Playback position" }), {
      target: { value: "615" },
    });

    expect(liveRegion(container).textContent).toBe("Skipped to 10:15");
  });

  it("suwak niesie `aria-valuetext` w formacie czasu, nie surowe sekundy", async () => {
    // Domyślnie czytnik ekranu czyta wartość suwaka jako liczbę („615"), co na
    // osi czasu nie znaczy nic. `aria-valuetext` zamienia to w „10:15".
    render(<PodcastPlayer src={SRC} initialDuration={1830} />);
    const slider = screen.getByRole("slider", { name: "Pozycja odtwarzania" });

    fireEvent.change(slider, { target: { value: "615" } });

    expect(slider).toHaveAttribute("aria-valuetext", "10:15");
  });

  it("skok do rozdziału (seek z zewnątrz) ogłasza się tak samo jak własne przewinięcie", async () => {
    // Lista rozdziałów na stronie odcinka steruje odtwarzaczem WYŁĄCZNIE przez
    // `registerSeek`. Gdyby ta droga pomijała region `aria-live`, kliknięcie
    // rozdziału byłoby dla czytnika ekranu bezgłośne.
    let seek: ((seconds: number) => void) | null = null;
    const { container } = render(
      <PodcastPlayer
        src={SRC}
        initialDuration={1830}
        registerSeek={(fn) => {
          seek = fn;
        }}
      />,
    );
    if (!seek) throw new Error("test: odtwarzacz nie zarejestrowal funkcji seek");
    const jumpToChapter = seek as (seconds: number) => void;

    // `act`, bo to wywołanie idzie SPOZA drzewa Reacta (tak samo jak klik na
    // liście rozdziałów w trasie) - bez niego aktualizacja stanu nie jest
    // wypłukana i test mierzyłby render sprzed skoku.
    act(() => jumpToChapter(732));

    expect(liveRegion(container).textContent).toBe("Przewinięto do 12:12");
  });
});

describe("PodcastPlayer - pamięć pozycji odtwarzania", () => {
  // TE FUNKCJE ŻYJĄ W TYM PLIKU, nie w `lib/audio/*`: `positionKey`,
  // `readStoredPosition`, `writeStoredPosition`, `clearStoredPosition`
  // i `isRestorablePosition` są lokalne dla atomu, więc nie ma ich kto pokryć
  // poza nim. Konsekwencja defektu jest prosta i bardzo widoczna dla
  // czytelnika: godzinny odcinek wraca po odświeżeniu na sekundę zero.

  it("wraca do zapisanej pozycji po wczytaniu metadanych", async () => {
    window.localStorage.setItem(`audio-pos:${SRC}`, "300");
    const { container } = render(<PodcastPlayer src={SRC} initialDuration={1830} />);

    fireEvent(audioOf(container), new Event("loadedmetadata"));

    expect(timerNode(container).textContent).toBe("5:00");
  });

  it("pozycji trywialnej (poniżej progu) NIE przywraca", async () => {
    // Kontrola dodatnia dla poprzedniego przypadku. Skok o dwie sekundy jest
    // gorszy niż jego brak: wygląda jak zgubiony start odtwarzania.
    window.localStorage.setItem(`audio-pos:${SRC}`, "2");
    const { container } = render(<PodcastPlayer src={SRC} initialDuration={1830} />);

    fireEvent(audioOf(container), new Event("loadedmetadata"));

    expect(timerNode(container).textContent).toBe("0:00");
  });

  it("pauza ZAPISUJE pozycję pod kluczem tego konkretnego materiału", async () => {
    // Klucz per `src` jest istotą tej pamięci: wspólny klucz przenosiłby
    // pozycję z jednego odcinka na drugi.
    const { container } = render(<PodcastPlayer src={SRC} initialDuration={1830} />);
    const audio = audioOf(container);
    if (!(audio instanceof HTMLMediaElement)) throw new Error("test: <audio> nie jest medium");
    audio.currentTime = 420;

    fireEvent(audio, new Event("pause"));

    expect(window.localStorage.getItem(`audio-pos:${SRC}`)).toBe("420");
    expect(window.localStorage.getItem("audio-pos:https://audio.example.org/inny.mp3")).toBeNull();
  });

  it("koniec materiału CZYŚCI pozycję - odcinek nie startuje od napisów końcowych", async () => {
    window.localStorage.setItem(`audio-pos:${SRC}`, "1800");
    const { container } = render(<PodcastPlayer src={SRC} initialDuration={1830} />);

    fireEvent(audioOf(container), new Event("ended"));

    expect(window.localStorage.getItem(`audio-pos:${SRC}`)).toBeNull();
    expect(screen.getByRole("button", { name: "Odtwórz" })).toBeInTheDocument();
  });

  it("tykanie odtwarzania aktualizuje licznik, ale nie region `aria-live`", async () => {
    // Domknięcie decyzji z bloku wyżej: licznik ma się zmieniać, a zapowiedź
    // NIE - inaczej czytnik ekranu czytałby pozycję przez cały odcinek.
    const { container } = render(<PodcastPlayer src={SRC} initialDuration={1830} />);
    const audio = audioOf(container);
    if (!(audio instanceof HTMLMediaElement)) throw new Error("test: <audio> nie jest medium");
    audio.currentTime = 65;

    fireEvent(audio, new Event("timeupdate"));

    expect(timerNode(container).textContent).toBe("1:05");
    expect(liveRegion(container).textContent).toBe("");
  });
});

describe("PodcastPlayer - wariant mini i dostępność całości", () => {
  it("wariant mini ukrywa transport wtórny, ale ZOSTAWIA nazwane odtwarzanie i suwak", async () => {
    // Skrócony pasek w widgecie listy nie może być tańszy dostępnościowo:
    // zostają dwie kontrolki i obie muszą mieć nazwę.
    render(<PodcastPlayer src={SRC} initialDuration={1830} variant="mini" />);

    expect(screen.getByRole("button", { name: "Odtwórz" })).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "Pozycja odtwarzania" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cofnij o 15 sekund" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Tempo odtwarzania" })).toBeNull();
  });

  it("wariant bez sterowania tempem nie zostawia osieroconej listy wyboru", async () => {
    render(<PodcastPlayer src={SRC} initialDuration={1830} showSpeed={false} />);

    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByRole("button", { name: "Odtwórz" })).toBeInTheDocument();
  });

  it("domyślnie NIE startuje sam - `autoplay` wymaga jawnego propsu", async () => {
    // To zachowanie pilnuje w axe reguła `no-autoplay-audio`, wyłączona
    // w przypadkach poniżej z powodów wydajnościowych (patrz komentarz tam).
    // Asercja strukturalna jest jej odpowiednikiem, który da się wykonać bez
    // silnika mediów: audio, które gra samo, jest wprost wadą dostępności.
    const { container } = render(<PodcastPlayer src={SRC} initialDuration={1830} />);

    expect(audioOf(container).hasAttribute("autoplay")).toBe(false);
  });

  it.each([["full"], ["mini"], ["sticky"]] as const)(
    "wariant %s nie zostawia wad dostępności",
    async (variant) => {
      const { container } = render(
        <PodcastPlayer src={SRC} initialDuration={1830} title="Zima bez gazu" variant={variant} />,
      );

      // `no-autoplay-audio` WYŁĄCZONE świadomie i z pomiarem: ta reguła każe
      // axe wczytać metadane każdego elementu <audio>, żeby poznać długość
      // materiału. happy-dom nie ma silnika mediów, więc `loadedmetadata`
      // nigdy nie nadchodzi i axe czeka do własnego limitu - ZMIERZONE 10 s na
      // KAŻDY przebieg (30 s na trzy warianty) przy zerowej wartości dowodu.
      // Samo zachowanie, którego pilnuje ta reguła, ma niżej własną asercję
      // strukturalną: odtwarzacz domyślnie NIE ma `autoplay`.
      const violations = await axeViolations(container, {
        "no-autoplay-audio": { enabled: false },
      });
      expect(violations, summarize(violations)).toEqual([]);
    },
  );
});
