// Czyste pomocniki panelu reklam: szkic slotu, szkic pozycji i klasa chipa.
//
// PO CO TEN PLIK ISTNIEJE. `emptySlot()` i `emptyPlacement()` to nie „puste
// obiekty" - to KONTRAKT DOMYSLNYCH USTAWIEN, ktory trafia prosto do bazy jako
// ladunek `insert`. Trzy wartosci w tym kontrakcie niosa realne ryzyko:
//   * `requires_consent: true` - slot zalozony przez redakcje ma NIE emitowac
//     sie czytelnikowi bez zgody marketingowej. Przestawienie tego domyslnie na
//     `false` (albo zgubienie pola przy refaktorze) to nie usterka kosmetyczna,
//     tylko emisja reklamy bez podstawy z RODO - i nikt tego nie zauwazy, bo
//     panel wyglada tak samo.
//   * `status: "active"` / `active: true` - nowy wpis dziala OD RAZU. Test
//     przybija to jawnie, zeby zmiana na „szkic" byla swiadoma decyzja,
//     a nie skutkiem ubocznym.
//   * `page_id: null` i `config: {}` - `undefined` w tych polach ginie w
//     JSON-ie zadania PostgREST i kolumna dostaje wartosc domyslna bazy zamiast
//     jawnego „bez ograniczenia". Dlatego sprawdzamy OBECNOSC kluczy, a nie
//     tylko ich wartosci.
//
// `chipClass` ma obie galezie sprawdzone osobno, bo to jedyny sygnal wizualny
// „ta kategoria jest wybrana" w edytorze targetingu - a chip bez stanu
// wybranego zamienia targetowanie w zgadywanie.
import { describe, expect, it } from "vitest";
import { chipClass, emptyPlacement, emptySlot } from "../model";

describe("emptySlot", () => {
  it("wymaga zgody marketingowej dla nowego slotu (domyslka RODO)", () => {
    expect(emptySlot().requires_consent).toBe(true);
  });

  it("zaklada slot HTML w stanie aktywnym", () => {
    const slot = emptySlot();
    expect(slot.kind).toBe("html");
    expect(slot.status).toBe("active");
  });

  it("wypelnia wszystkie pola tresci pustym napisem, nie undefined", () => {
    // `undefined` znika z ladunku PostgREST - kolumna dostaje wtedy wartosc
    // domyslna bazy zamiast tego, co widzi redaktor w formularzu.
    const slot = emptySlot();
    expect(slot.name).toBe("");
    expect(slot.html).toBe("");
    expect(slot.script).toBe("");
    expect(slot.image_url).toBe("");
    expect(slot.image_link).toBe("");
    expect(slot.image_alt).toBe("");
    expect(slot.notes).toBe("");
  });

  it("zeruje wymiary jawnym nullem", () => {
    const slot = emptySlot();
    expect(slot.width).toBeNull();
    expect(slot.height).toBeNull();
  });

  it("nie niesie identyfikatora - szkic zawsze jest wstawieniem, nie edycja", () => {
    // Panel rozpoznaje tryb edycji po `draft.id`. Gdyby szkic mial id, przycisk
    // „Anuluj" i galaz `update` odpalalyby sie dla nowego, nieistniejacego
    // wiersza, a zapis konczyl sie cicha aktualizacja zera wierszy.
    expect(emptySlot().id).toBeUndefined();
  });

  it("zwraca NOWY obiekt przy kazdym wywolaniu", () => {
    // Wspoldzielona referencja oznaczalaby, ze „Anuluj" w jednym formularzu
    // czysci szkic w drugim - i ze mutacja pola w edycji przecieka do domyslek.
    const a = emptySlot();
    const b = emptySlot();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

describe("emptyPlacement", () => {
  it("zaklada pozycje aktywna, na gorze wpisu, dla typu strony `post`", () => {
    const placement = emptyPlacement();
    expect(placement.active).toBe(true);
    expect(placement.position).toBe("top_of_post");
    expect(placement.page_type).toBe("post");
  });

  it("nie wskazuje zadnego slotu - wybor nalezy do redaktora", () => {
    // Pusty `slot_id` jest tym, co blokuje zapis w `PlacementsPanel`. Gdyby
    // szkic wskazywal pierwszy lepszy slot, przypadkowe klikniecie „Dodaj"
    // opublikowaloby kreacje w losowym miejscu strony.
    expect(emptyPlacement().slot_id).toBe("");
  });

  it("ma JAWNE `page_id: null` i pusty `config`", () => {
    const placement = emptyPlacement();
    expect(Object.keys(placement)).toContain("page_id");
    expect(placement.page_id).toBeNull();
    expect(placement.config).toEqual({});
  });

  it("zaczyna sortowanie od zera", () => {
    expect(emptyPlacement().sort_order).toBe(0);
  });

  it("nie niesie identyfikatora", () => {
    expect(emptyPlacement().id).toBeUndefined();
  });

  it("zwraca NOWY obiekt (w tym nowy `config`) przy kazdym wywolaniu", () => {
    // `config` jest mutowany przez `setCfg` w panelu pozycji. Wspoldzielony
    // literal oznaczalby, ze ustawienie `paragraph` dla jednej pozycji wycieka
    // do domyslki nastepnej.
    const a = emptyPlacement();
    const b = emptyPlacement();
    expect(a.config).not.toBe(b.config);
  });
});

describe("chipClass", () => {
  it("chip WYBRANY dostaje wypelnienie akcentem", () => {
    const cls = chipClass(true);
    expect(cls).toContain("border-primary");
    expect(cls).toContain("bg-primary");
    expect(cls).toContain("text-primary-foreground");
  });

  it("chip NIEWYBRANY dostaje neutralne tlo i podswietlenie na hover", () => {
    const cls = chipClass(false);
    expect(cls).toContain("border-border");
    expect(cls).toContain("bg-background");
    expect(cls).toContain("hover:bg-muted");
  });

  it("obie galezie dziela ten sam ksztalt bazowy", () => {
    // Rozjazd ksztaltu miedzy stanami znaczylby, ze chipy „skacza" przy
    // klikaniu - lista kategorii przestaje sie ukladac w stabilna siatke.
    for (const active of [true, false]) {
      expect(chipClass(active)).toContain("rounded-full border px-2.5 py-1 text-xs transition ");
    }
  });

  it("stany sa ROZROZNIALNE - wybrany nie moze wygladac jak niewybrany", () => {
    expect(chipClass(true)).not.toBe(chipClass(false));
  });
});
