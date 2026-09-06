// STOS UNDO/REDO KANWY BLOKOW (`useBlocksHistory`) - hak, ktory decyduje o
// tym, czy redaktor moze odzyskac tresc po pomylce.
//
// DLACZEGO OSOBNY PLIK. Hak nie mial dotad zadnego bezposredniego testu.
// `useLocalizedBlocksHistory.test.tsx` (katalog obok) dowodzi WARSTWY WYZEJ:
// kiedy stos ma sie ZEROWAC przy zmianie jezyka i przy podmianie wartosci
// z gory. Tamten plik wola wylacznie `setDoc(doc, true)`, czyli sciezke
// NATYCHMIASTOWA - a caly mechanizm okna scalajacego (`debounceMs`), limit
// stosu (`limit`) i odmowy (`undo` na pustym stosie, `setDoc` tym samym
// dokumentem) zostawal bez dowodu. `undoAfterBackgroundSave.test.ts` z kolei
// dotyczy zapisu w tle, nie samego stosu.
//
// CO MA TU DOWOD
//   * ODMOWY: `setDoc` tym SAMYM dokumentem (identycznosc referencji) nie
//     tworzy kroku historii, `undo` na pustym stosie i `redo` na pustej
//     przyszlosci nie ruszaja dokumentu (bez nich kazde Ctrl+Z na swiezo
//     wczytanym wpisie mogloby podstawic `undefined` jako dokument),
//   * LIMIT stosu: przy przekroczeniu `limit` wypada NAJSTARSZY krok, a nie
//     najnowszy - inaczej dlugie pisanie kasowalo by mozliwosc cofniecia
//     ostatniej zmiany,
//   * OKNO SCALAJACE: kolejne edycje w obrebie `debounceMs` daja JEDEN krok
//     cofniecia (parytet z Wordem/Gutenbergiem), a odlozony commit dochodzi
//     po uplywie okna - takze wtedy, gdy trzeba przy nim przyciac stos,
//   * SPRZATANIE: odmontowanie kanwy w trakcie otwartego okna nie zostawia
//     wiszacego licznika, ktory strzelalby `setState` w odmontowany hak,
//   * `reset` czysci OBIE strony stosu (undo i redo).
//
// CZEGO TU NIE MA
//   * montazu kanwy. Hak nie dotyka DOM-u ani i18n, wiec `renderHook` jest
//     tu pelnym srodowiskiem - montaz `BlockCanvas` dodalby tylko szum,
//   * atrap zegara wlasnej roboty. Czas idzie przez `vi.useFakeTimers()`,
//     bo hak czyta `Date.now()` ORAZ `setTimeout` i oba musza plynac razem.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { BlocksDoc } from "@/lib/blocks/types";
import { useBlocksHistory } from "../useBlocksHistory";

/** Stala data - `Date.now()` haka musi byc powtarzalne miedzy przebiegami. */
const TERAZ = new Date("2026-03-01T10:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(TERAZ);
});

afterEach(() => {
  vi.useRealTimers();
});

function dokument(tekst: string): BlocksDoc {
  return {
    version: 1,
    blocks: [{ id: "b1", type: "paragraph", data: { html: `<p>${tekst}</p>` } }],
  };
}

/** Tresc pierwszego bloku - krotszy zapis asercji „gdzie stoi historia". */
function tresc(d: BlocksDoc): string {
  return String(d.blocks[0]?.data.html ?? "");
}

function zamontuj(initial: BlocksDoc, opts?: { debounceMs?: number; limit?: number }) {
  return renderHook(() => useBlocksHistory(initial, opts));
}

/** Przesuniecie czasu: rusza JEDNOCZESNIE `Date.now()` i liczniki. */
function przesunCzas(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe("useBlocksHistory - odmowy (stos nie ma z czego cofac)", () => {
  it("swiezy stos nie pozwala ani cofnac, ani ponowic", () => {
    const { result } = zamontuj(dokument("start"));
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it("undo na PUSTYM stosie zostawia dokument bez zmian", () => {
    const { result } = zamontuj(dokument("start"));
    const przed = result.current.doc;
    act(() => result.current.undo());
    expect(result.current.doc).toBe(przed);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it("redo bez wcześniejszego cofnięcia zostawia dokument bez zmian", () => {
    const { result } = zamontuj(dokument("start"));
    act(() => result.current.setDoc(dokument("edycja"), true));
    const przed = result.current.doc;
    act(() => result.current.redo());
    expect(result.current.doc).toBe(przed);
    expect(result.current.canRedo).toBe(false);
  });

  it("setDoc TYM SAMYM dokumentem nie tworzy kroku historii", () => {
    // Rodzic potrafi oddac w dół dokładnie ten obiekt, który hak sam wypchnął
    // (echo stanu formularza). Taki „powrót" nie jest edycją redaktora.
    const { result } = zamontuj(dokument("start"));
    const ten = result.current.doc;
    act(() => result.current.setDoc(ten));
    expect(result.current.canUndo).toBe(false);
    expect(result.current.doc).toBe(ten);
  });

  it("cofnięcie do końca zeruje możliwość dalszego cofania", () => {
    const { result } = zamontuj(dokument("start"));
    act(() => result.current.setDoc(dokument("edycja"), true));
    act(() => result.current.undo());
    expect(tresc(result.current.doc)).toBe("<p>start</p>");
    expect(result.current.canUndo).toBe(false);
    // Trzecie Ctrl+Z nie ma już czego zdjąć - dokument musi zostać na miejscu.
    act(() => result.current.undo());
    expect(tresc(result.current.doc)).toBe("<p>start</p>");
  });
});

describe("useBlocksHistory - limit stosu", () => {
  it("przy przekroczeniu limitu wypada NAJSTARSZY krok, nie najnowszy", () => {
    const { result } = zamontuj(dokument("k0"), { limit: 2 });
    for (const t of ["k1", "k2", "k3"]) {
      act(() => result.current.setDoc(dokument(t), true));
    }
    // Stos trzyma dwa kroki: k1 i k2. Punkt wyjscia (k0) wypadl.
    act(() => result.current.undo());
    expect(tresc(result.current.doc)).toBe("<p>k2</p>");
    act(() => result.current.undo());
    expect(tresc(result.current.doc)).toBe("<p>k1</p>");
    act(() => result.current.undo());
    expect(tresc(result.current.doc)).toBe("<p>k1</p>");
    expect(result.current.canUndo).toBe(false);
  });

  it("odłożony commit też przycina stos do limitu", () => {
    // Commit z okna scalającego dokłada krok POZA obsługą zdarzenia, więc ma
    // własne przycięcie - bez niego stos rósłby bez granicy przy pisaniu.
    const { result } = zamontuj(dokument("k0"), { limit: 1, debounceMs: 400 });
    act(() => result.current.setDoc(dokument("k1"), true));
    przesunCzas(100);
    act(() => result.current.setDoc(dokument("k2")));
    przesunCzas(400);
    // Limit 1: po odłożonym commicie zostaje wyłącznie krok „k1".
    act(() => result.current.undo());
    expect(tresc(result.current.doc)).toBe("<p>k1</p>");
    expect(result.current.canUndo).toBe(false);
  });
});

describe("useBlocksHistory - okno scalajace kolejne edycje", () => {
  it("druga edycja W OKNIE nie tworzy własnego kroku historii", () => {
    const { result } = zamontuj(dokument("k0"), { debounceMs: 400 });
    act(() => result.current.setDoc(dokument("k1"), true));
    przesunCzas(50);
    act(() => result.current.setDoc(dokument("k2")));
    // Dokument już widzi „k2", ale stos jeszcze nie dostał kroku.
    expect(tresc(result.current.doc)).toBe("<p>k2</p>");
    act(() => result.current.undo());
    expect(tresc(result.current.doc)).toBe("<p>k0</p>");
  });

  it("trzy edycje w jednym oknie planują JEDEN odłożony commit", () => {
    const { result } = zamontuj(dokument("k0"), { debounceMs: 400 });
    act(() => result.current.setDoc(dokument("k1"), true));
    przesunCzas(50);
    act(() => result.current.setDoc(dokument("k2")));
    przesunCzas(50);
    act(() => result.current.setDoc(dokument("k3")));
    przesunCzas(50);
    act(() => result.current.setDoc(dokument("k4")));
    przesunCzas(400);
    // Po zamknięciu okna stos ma dokładnie dwa kroki: k0 (natychmiastowy)
    // i k1 (odłożony), a nie jeden krok na każdą literę.
    act(() => result.current.undo());
    expect(tresc(result.current.doc)).toBe("<p>k1</p>");
    act(() => result.current.undo());
    expect(tresc(result.current.doc)).toBe("<p>k0</p>");
    expect(result.current.canUndo).toBe(false);
  });

  it("edycja PO wygaśnięciu okna commituje się od razu", () => {
    const { result } = zamontuj(dokument("k0"), { debounceMs: 400 });
    act(() => result.current.setDoc(dokument("k1"), true));
    przesunCzas(500);
    act(() => result.current.setDoc(dokument("k2")));
    // Bez czekania na licznik: krok jest w stosie natychmiast.
    expect(result.current.canUndo).toBe(true);
    act(() => result.current.undo());
    expect(tresc(result.current.doc)).toBe("<p>k1</p>");
  });

  it("odłożony commit kasuje przyszłość - po cofnięciu i nowej edycji nie ma czego ponawiać", () => {
    const { result } = zamontuj(dokument("k0"), { debounceMs: 400 });
    act(() => result.current.setDoc(dokument("k1"), true));
    act(() => result.current.undo());
    expect(result.current.canRedo).toBe(true);
    przesunCzas(500);
    act(() => result.current.setDoc(dokument("inna-galaz"), true));
    expect(result.current.canRedo).toBe(false);
  });
});

describe("useBlocksHistory - reset i sprzatanie", () => {
  it("reset czyści OBIE strony stosu", () => {
    const { result } = zamontuj(dokument("k0"));
    act(() => result.current.setDoc(dokument("k1"), true));
    act(() => result.current.undo());
    expect(result.current.canRedo).toBe(true);
    act(() => result.current.reset(dokument("wczytany-z-serwera")));
    expect(tresc(result.current.doc)).toBe("<p>wczytany-z-serwera</p>");
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it("reset otwiera nowe okno - pierwsza edycja po nim commituje się od razu", () => {
    const { result } = zamontuj(dokument("k0"), { debounceMs: 400 });
    act(() => result.current.setDoc(dokument("k1"), true));
    act(() => result.current.reset(dokument("r0")));
    act(() => result.current.setDoc(dokument("r1")));
    expect(result.current.canUndo).toBe(true);
    act(() => result.current.undo());
    expect(tresc(result.current.doc)).toBe("<p>r0</p>");
  });

  it("odmontowanie w trakcie otwartego okna nie zostawia wiszącego licznika", () => {
    // Licznik, który przetrwałby odmontowanie, strzelałby `setState` w
    // martwy hak - w konsoli React, a w kanwie osierocony krok historii.
    const { result, unmount } = zamontuj(dokument("k0"), { debounceMs: 400 });
    act(() => result.current.setDoc(dokument("k1"), true));
    przesunCzas(50);
    act(() => result.current.setDoc(dokument("k2")));
    unmount();
    expect(() => przesunCzas(400)).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reset kasuje odłożony commit z otwartego okna", () => {
    const { result } = zamontuj(dokument("k0"), { debounceMs: 400 });
    act(() => result.current.setDoc(dokument("k1"), true));
    przesunCzas(50);
    act(() => result.current.setDoc(dokument("k2")));
    act(() => result.current.reset(dokument("r0")));
    przesunCzas(400);
    // Licznik z poprzedniego dokumentu nie ma prawa dołożyć kroku do
    // ŚWIEŻO wczytanej treści.
    expect(result.current.canUndo).toBe(false);
    expect(tresc(result.current.doc)).toBe("<p>r0</p>");
  });
});

// ── DEFEKTY OKNA SCALAJACEGO ────────────────────────────────────────────────
// Oba dotycza tego samego zaniedbania: `flushPending()` (linie 36-41) jest
// wolane w `undo`, `redo` i `reset`, ale NIE w `setDoc` - a to `setDoc`
// decyduje o kolejnosci krokow w stosie.

// DEFEKT: NATYCHMIASTOWY COMMIT W OTWARTYM OKNIE MIESZA KOLEJNOSC HISTORII.
//
// WEJSCIE: redaktor pisze (edycja debounce'owana), a zaraz po niej wykonuje
//   gest JAWNY - przestawienie bloku, duplikat, wklejke. Kanwa wola wtedy
//   `onChange(doc, true)`, czyli `setDoc(next, immediate)` (BlockCanvas.tsx
//   emituje `immediate: true` dla kazdej operacji na ukladzie dokumentu).
// CO PSUJE: `setDoc` z `immediate` wchodzi w galaz `shouldCommit`
//   (useBlocksHistory.ts:50-55) i dokłada krok od razu, ale NIE gasi licznika
//   zaplanowanego przez poprzednia edycje (:57-68). Licznik dozywa swojego
//   okna i dokłada do stosu `snapshot` - dokument z PRZED tamtej edycji
//   (:58, :63). Stos przestaje byc ciagiem chronologicznym: najnowszy krok
//   opisuje stan STARSZY niz krok pod nim.
// KONSEKWENCJA: pierwsze Ctrl+Z przeskakuje o dwie zmiany w tyl, a drugie
//   Ctrl+Z wraca CZESCIOWO w przod. Redaktor traci orientacje w cofaniu i -
//   co gorsza - nie ma juz jak dojsc do stanu, ktory sam widzial: sciezka
//   przez stos go pomija.
// WYMAGANA POPRAWKA: galaz `shouldCommit` w `setDoc` musi najpierw skasowac
//   odlozony commit (`flushPending()`), bo jego `snapshot` jest juz nieaktualny.
it.fails(
  "DEFEKT: natychmiastowy commit w otwartym oknie NIE moze mieszac kolejnosci historii",
  () => {
    const { result } = zamontuj(dokument("k0"), { debounceMs: 400 });
    // Krok jawny: stos dostaje k0, dokument pokazuje k1.
    act(() => result.current.setDoc(dokument("k1"), true));
    // Pisanie w oknie: licznik trzyma snapshot „k1".
    przesunCzas(100);
    act(() => result.current.setDoc(dokument("k2")));
    // Gest jawny (np. duplikat bloku) NADAL w oknie tamtego licznika.
    act(() => result.current.setDoc(dokument("k3"), true));
    przesunCzas(400);

    // Oczekiwane: cofanie idzie wstecz po czasie - k2, potem k1, potem k0.
    act(() => result.current.undo());
    expect(tresc(result.current.doc)).toBe("<p>k2</p>");
    act(() => result.current.undo());
    expect(tresc(result.current.doc)).toBe("<p>k1</p>");
  },
);

// DEFEKT: COFNIECIE W OTWARTYM OKNIE ZJADA CALA JEDNA ZMIANE.
//
// WEJSCIE: redaktor wykonuje gest jawny (krok w stosie), zaczyna pisac
//   i - zanim okno `debounceMs` sie domknie - wciska Ctrl+Z.
// CO PSUJE: `undo` wola `flushPending()` (:76), ktore licznik wyłącznie
//   KASUJE (:37-40) zamiast domknac jego commit. Granica miedzy tekstem
//   sprzed pisania a tekstem po nim nigdy nie wchodzi do stosu, wiec `undo`
//   zdejmuje krok STARSZY.
// KONSEKWENCJA: jedno Ctrl+Z wycofuje dwie zmiany naraz, a stan pomiedzy nimi
//   staje sie NIEOSIAGALNY - `redo` prowadzi juz do tekstu po pisaniu.
//   Redaktor nie ma zadnej drogi (ani wstecz, ani w przod) do tresci, ktora
//   mial na ekranie sekunde wczesniej.
// WYMAGANA POPRAWKA: `flushPending` przed `undo`/`redo` musi DOMKNAC odlozony
//   commit (dopisac `snapshot` do stosu), a nie porzucic go.
it.fails("DEFEKT: Ctrl+Z w otwartym oknie nie moze cofac dwoch zmian naraz", () => {
  const { result } = zamontuj(dokument("k0"), { debounceMs: 400 });
  act(() => result.current.setDoc(dokument("k1"), true));
  przesunCzas(100);
  act(() => result.current.setDoc(dokument("k2")));
  act(() => result.current.undo());

  // Oczekiwane: pierwsze cofniecie wraca do tekstu sprzed pisania („k1").
  expect(tresc(result.current.doc)).toBe("<p>k1</p>");
});
