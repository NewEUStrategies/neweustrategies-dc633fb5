// LISTA WYPUNKTOWANA, MENU UKOŚNIKA I SLOT OBRAZKA - trzy edytory, których
// logika nie daje się dosięgnąć ani polem formularza, ani propsem.
//
// PO CO OSOBNY PLIK. Przejazd tabeli (`blockEditMatrix.*`) rusza każdym
// `input`, `select` i przyciskiem, ale:
//  * pozycje listy to `contenteditable` (`InlineHtmlEditable`), a nie `input` -
//    cała klawiatura listy (Tab, Enter, Shift+Enter, Backspace) była poza
//    przejazdem, i to w niej siedzi ZMIANA LICZBY POZYCJI, czyli miejsce,
//    w którym redaktor może stracić punkt bez śladu,
//  * menu ukośnika w akapicie żyje w stanie komponentu i otwiera je KLAWISZ,
//    a nie pole,
//  * `image` ma dwie różne powierzchnie zależne od tego, czy `url` jest pusty,
//    i zapisuje wymiary obrazka z `onLoad` - zdarzenia, którego żadne pole
//    nie wywoła.
//
// CO MA TU DOWÓD (niezmienniki, nie kształt DOM-u)
//  * Enter na pozycji listy DODAJE pozycję DOKŁADNIE pod bieżącą i dziedziczy
//    jej poziom zagnieżdżenia - nie na końcu listy i nie na poziomie 1,
//  * Tab wcina pozycję, ale NIE GŁĘBIEJ niż o jeden poziom od poprzedniczki
//    (inaczej import z Worda robi listę, której nie da się wyrenderować),
//  * Backspace na PUSTEJ pozycji usuwa ją, a na pozycji z treścią - NIE
//    (to jest różnica między usunięciem punktu i usunięciem treści),
//  * numeracja listy uporządkowanej liczy się W OBRĘBIE POZIOMU (1., 1.1., 2.),
//  * ukośnik na PUSTYM akapicie otwiera menu, a Enter w otwartym menu
//    przekształca blok; Escape zamyka menu i NIE przekształca,
//  * `image` bez `url` daje pole adresu, a z `url` - podgląd z paskiem mediów,
//    i zapisuje wymiary naturalne obrazka po jego wczytaniu.
//
// GRANICE. Fabryki `vi.mock` niesie moduł wspólny tabeli (import PIERWSZY):
// `sonner`, Radix `Select`/`Switch`, `<Link>` routera, klient Supabase,
// kontekst najemcy, `fetch`. i18n PRAWDZIWE. Żadnej atrapy TipTapa,
// `InlineHtmlEditable` ani `@/lib/blocks/*` - to warstwy pod testem.
import { describe, expect, it, vi } from "vitest";
import { fireEvent } from "@testing-library/react";

import { renderEditor } from "./blockEditMatrix.shared";
import type { Block, Json } from "@/lib/blocks/types";
import { ListBlockEdit } from "../ListBlock";
import { ParagraphBlock } from "../Paragraph";
import { ImageBlock } from "../Image";

function lista(items: string[], extra: Record<string, Json> = {}): Block {
  return { id: "l1", type: "list", data: { items, ...extra } };
}

/** Pozycje listy - `contenteditable`, w które realnie pisze redaktor. */
function pozycje(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-field="list-item"]'));
}

function ostatniZapis(changes: Block[]): Block {
  expect(changes.length, "edytor nie zapisał niczego").toBeGreaterThan(0);
  return changes[changes.length - 1];
}

function itemsOf(block: Block): string[] {
  const raw = block.data.items;
  expect(Array.isArray(raw), "`items` musi zostać TABLICĄ").toBe(true);
  return (raw as Json[]).map((x) => String(x));
}

describe("lista - liczba pozycji i poziomy zagnieżdżenia", () => {
  it("puste dane dają JEDNĄ pustą pozycję, a nie listę bez pozycji", () => {
    // Lista bez pozycji nie ma gdzie przyjąć pierwszego znaku - redaktor
    // wstawia blok i nie może pisać.
    const { container } = renderEditor(ListBlockEdit, { id: "l1", type: "list", data: {} });
    expect(pozycje(container)).toHaveLength(1);
  });

  it("Enter dodaje pozycję DOKŁADNIE pod bieżącą", () => {
    const { container, changes } = renderEditor(ListBlockEdit, lista(["alfa", "beta", "gamma"]));
    fireEvent.keyDown(pozycje(container)[0], { key: "Enter" });
    expect(itemsOf(ostatniZapis(changes))).toEqual(["alfa", "", "beta", "gamma"]);
  });

  it("Enter na pozycji WCIĘTEJ dziedziczy jej poziom, a nie wraca na pierwszy", () => {
    const { container, changes } = renderEditor(
      ListBlockEdit,
      lista(["alfa", "beta"], { levels: [1, 2] }),
    );
    fireEvent.keyDown(pozycje(container)[1], { key: "Enter" });
    const next = ostatniZapis(changes);
    expect(itemsOf(next)).toEqual(["alfa", "beta", ""]);
    expect(next.data.levels).toEqual([1, 2, 2]);
  });

  it("Shift+Enter łamie wiersz WEWNĄTRZ pozycji, nie dodając nowej", () => {
    // `document.execCommand` to API PRZEGLĄDARKI, którego happy-dom nie
    // implementuje - bez podstawienia handler RZUCA, a test przechodziłby
    // „bo nic się nie stało". Podstawiamy więc minimalny odpowiednik
    // `insertLineBreak` (wstawia `<br>` do pola z fokusem) i dopiero wtedy
    // asercja mierzy edytor, a nie brak API. To granica środowiska, nie
    // warstwa aplikacji.
    const oryginal = (document as unknown as { execCommand?: unknown }).execCommand;
    const execCommand = vi.fn((cmd: string) => {
      const el = document.activeElement;
      if (cmd === "insertLineBreak" && el instanceof HTMLElement) el.innerHTML += "<br>";
      return true;
    });
    Object.defineProperty(document, "execCommand", { value: execCommand, configurable: true });
    try {
      const { container, changes } = renderEditor(ListBlockEdit, lista(["alfa", "beta"]));
      const pierwsza = pozycje(container)[0];
      pierwsza.focus();
      fireEvent.keyDown(pierwsza, { key: "Enter", shiftKey: true });
      expect(execCommand).toHaveBeenCalledWith("insertLineBreak");
      const next = ostatniZapis(changes);
      // Liczba POZYCJI bez zmian, a łamanie wiersza wchodzi w treść punktu.
      expect(itemsOf(next)).toHaveLength(2);
      expect(itemsOf(next)[0]).toContain("<br>");
    } finally {
      if (oryginal === undefined) {
        delete (document as unknown as { execCommand?: unknown }).execCommand;
      } else {
        Object.defineProperty(document, "execCommand", {
          value: oryginal,
          configurable: true,
        });
      }
    }
  });

  it("Tab wcina pozycję o jeden poziom", () => {
    const { container, changes } = renderEditor(ListBlockEdit, lista(["alfa", "beta"]));
    fireEvent.keyDown(pozycje(container)[1], { key: "Tab" });
    expect(ostatniZapis(changes).data.levels).toEqual([1, 2]);
  });

  it("Tab NIE wcina głębiej niż o jeden poziom od poprzedniczki", () => {
    // Bez tego limitu import z Worda produkuje listę z dziurą w poziomach
    // (1 -> 3), której renderer publiczny nie umie ułożyć.
    const { container, changes } = renderEditor(ListBlockEdit, lista(["alfa", "beta"]));
    const druga = pozycje(container)[1];
    fireEvent.keyDown(druga, { key: "Tab" });
    fireEvent.keyDown(druga, { key: "Tab" });
    fireEvent.keyDown(druga, { key: "Tab" });
    const levels = ostatniZapis(changes).data.levels as number[];
    expect(levels[1]).toBe(2);
  });

  it("Tab na PIERWSZEJ pozycji nie wcina jej wcale - nie ma pod co", () => {
    const { container, changes } = renderEditor(ListBlockEdit, lista(["alfa", "beta"]));
    fireEvent.keyDown(pozycje(container)[0], { key: "Tab" });
    // Poziom 1 jest domyślny, więc `levels` w ogóle nie musi wejść do danych.
    const zapis = changes.at(-1);
    if (zapis) expect(zapis.data.levels ?? [1, 1]).toEqual([1, 1]);
  });

  it("Shift+Tab wysuwa pozycję z powrotem na pierwszy poziom", () => {
    const { container, changes } = renderEditor(
      ListBlockEdit,
      lista(["alfa", "beta"], { levels: [1, 2] }),
    );
    fireEvent.keyDown(pozycje(container)[1], { key: "Tab", shiftKey: true });
    // Poziom wrócił do 1, więc klucz `levels` znika z danych - dokładnie tak
    // działa `commit` (nie trzyma tablicy samych jedynek).
    expect(ostatniZapis(changes).data.levels).toBeUndefined();
  });

  it("Backspace na PUSTEJ pozycji usuwa ją", () => {
    const { container, changes } = renderEditor(ListBlockEdit, lista(["alfa", "", "gamma"]));
    fireEvent.keyDown(pozycje(container)[1], { key: "Backspace" });
    expect(itemsOf(ostatniZapis(changes))).toEqual(["alfa", "gamma"]);
  });

  it("Backspace na pozycji Z TREŚCIĄ nie usuwa pozycji", () => {
    const { container, changes } = renderEditor(ListBlockEdit, lista(["alfa", "beta"]));
    fireEvent.keyDown(pozycje(container)[1], { key: "Backspace" });
    for (const zapis of changes) {
      expect(itemsOf(zapis)).toHaveLength(2);
    }
  });

  it("Backspace na JEDYNEJ pustej pozycji nie opróżnia listy do zera", () => {
    const { container, changes } = renderEditor(ListBlockEdit, lista([""]));
    fireEvent.keyDown(pozycje(container)[0], { key: "Backspace" });
    for (const zapis of changes) {
      expect(itemsOf(zapis).length).toBeGreaterThan(0);
    }
  });

  it("wpisanie treści w pozycję zapisuje ją pod właściwym indeksem", () => {
    const { container, changes } = renderEditor(ListBlockEdit, lista(["alfa", "beta"]));
    const druga = pozycje(container)[1];
    druga.innerHTML = "beta poprawiona";
    fireEvent.input(druga);
    expect(itemsOf(ostatniZapis(changes))).toEqual(["alfa", "beta poprawiona"]);
  });
});

describe("lista - numeracja uporządkowana liczy się w obrębie poziomu", () => {
  it("lista uporządkowana renderuje się jako `ol` i numeruje 1., 1.1., 2.", () => {
    const { container } = renderEditor(
      ListBlockEdit,
      lista(["pierwszy", "podpunkt", "drugi"], { ordered: true, levels: [1, 2, 1] }),
    );
    expect(container.querySelector("ol")).not.toBeNull();
    const numery = Array.from(container.querySelectorAll(".cms-list-number-text")).map(
      (el) => el.textContent,
    );
    // Podpunkt zaczyna WŁASNĄ numerację, a kolejny punkt pierwszego poziomu
    // liczy dalej od jedynki - to jest zachowanie importu wielopoziomowego.
    expect(numery).toEqual(["1", "1", "2"]);
  });

  it("lista nieuporządkowana renderuje się jako `ul` i nie ma numerów", () => {
    const { container } = renderEditor(ListBlockEdit, lista(["alfa", "beta"]));
    expect(container.querySelector("ul")).not.toBeNull();
    expect(container.querySelectorAll(".cms-list-number-text")).toHaveLength(0);
  });
});

describe("akapit - menu ukośnika", () => {
  function zamontujAkapit(html: string) {
    const onTransform = vi.fn();
    const view = renderEditor((props) => <ParagraphBlock {...props} onTransform={onTransform} />, {
      id: "p1",
      type: "paragraph",
      data: { html },
    });
    const el = view.container.querySelector('[contenteditable="true"]');
    if (!(el instanceof HTMLElement)) throw new Error("brak pola edycji akapitu");
    return { ...view, onTransform, pole: el };
  }

  it("ukośnik na PUSTYM akapicie otwiera menu z listą typów bloków", () => {
    const { pole, container } = zamontujAkapit("");
    fireEvent.keyDown(pole, { key: "/" });
    // Menu jest listą wyboru typu - musi pokazać co najmniej jedną pozycję.
    expect(
      container.querySelectorAll("[data-slash-item], [role='option'], button").length,
    ).toBeGreaterThan(0);
  });

  it("Enter w otwartym menu PRZEKSZTAŁCA blok w wybrany typ", () => {
    const { pole, onTransform } = zamontujAkapit("");
    fireEvent.keyDown(pole, { key: "/" });
    fireEvent.keyDown(pole, { key: "Enter" });
    expect(onTransform).toHaveBeenCalledTimes(1);
    const bloki = onTransform.mock.calls[0][0] as Block[];
    expect(bloki).toHaveLength(1);
    expect(typeof bloki[0].type).toBe("string");
    expect(bloki[0].id).toBeTruthy();
  });

  it("strzałki w otwartym menu przesuwają wybór, a Enter bierze WSKAZANY typ", () => {
    const pierwszy = (() => {
      const { pole, onTransform } = zamontujAkapit("");
      fireEvent.keyDown(pole, { key: "/" });
      fireEvent.keyDown(pole, { key: "Enter" });
      return (onTransform.mock.calls[0][0] as Block[])[0].type;
    })();
    const { pole, onTransform } = zamontujAkapit("");
    fireEvent.keyDown(pole, { key: "/" });
    fireEvent.keyDown(pole, { key: "ArrowDown" });
    fireEvent.keyDown(pole, { key: "Enter" });
    const drugi = (onTransform.mock.calls[0][0] as Block[])[0].type;
    expect(drugi).not.toBe(pierwszy);
  });

  it("strzałka w górę na pierwszej pozycji nie wychodzi z listy", () => {
    const { pole, onTransform } = zamontujAkapit("");
    fireEvent.keyDown(pole, { key: "/" });
    fireEvent.keyDown(pole, { key: "ArrowUp" });
    fireEvent.keyDown(pole, { key: "Enter" });
    expect(onTransform).toHaveBeenCalledTimes(1);
  });

  it("Escape zamyka menu i NIE przekształca bloku", () => {
    const { pole, onTransform } = zamontujAkapit("");
    fireEvent.keyDown(pole, { key: "/" });
    fireEvent.keyDown(pole, { key: "Escape" });
    fireEvent.keyDown(pole, { key: "Enter" });
    // Po zamknięciu menu Enter wraca do swojej normalnej roli (podział bloku),
    // więc przekształcenia nie ma.
    expect(onTransform).not.toHaveBeenCalled();
  });

  it("ukośnik w akapicie Z TREŚCIĄ nie otwiera menu", () => {
    const { pole, onTransform } = zamontujAkapit("<p>alfa</p>");
    fireEvent.keyDown(pole, { key: "/" });
    fireEvent.keyDown(pole, { key: "Enter" });
    expect(onTransform).not.toHaveBeenCalled();
  });
});

describe("obraz - dwie powierzchnie i zapis wymiarów", () => {
  it("bez adresu pokazuje POLE ADRESU, a nie pusty podgląd", () => {
    const { container } = renderEditor(ImageBlock, { id: "i1", type: "image", data: {} });
    expect(container.querySelector("input")).not.toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  it("wpisanie adresu w pustym slocie zapisuje `url`", () => {
    const { container, changes } = renderEditor(ImageBlock, { id: "i1", type: "image", data: {} });
    const pole = container.querySelector("input");
    fireEvent.change(pole as HTMLElement, {
      target: { value: "https://cdn.example.com/a.png" },
    });
    expect(ostatniZapis(changes).data.url).toBe("https://cdn.example.com/a.png");
  });

  it("z adresem pokazuje podgląd obrazka", () => {
    const { container } = renderEditor(ImageBlock, {
      id: "i1",
      type: "image",
      data: { url: "https://cdn.example.com/a.png", alt: "Opis" },
    });
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe("https://cdn.example.com/a.png");
    expect(img?.getAttribute("alt")).toBe("Opis");
  });

  it("wczytanie obrazka zapisuje jego NATURALNE wymiary do danych bloku", () => {
    // To jest jedyne miejsce, w którym wymiary obrazka wchodzą do dokumentu -
    // bez nich publiczny render nie zna proporcji i strona skacze przy
    // wczytywaniu (CLS).
    const { container, changes } = renderEditor(ImageBlock, {
      id: "i1",
      type: "image",
      data: { url: "https://cdn.example.com/a.png" },
    });
    const img = container.querySelector("img");
    Object.defineProperty(img, "naturalWidth", { value: 1200, configurable: true });
    Object.defineProperty(img, "naturalHeight", { value: 800, configurable: true });
    fireEvent.load(img as HTMLElement);
    const zapis = ostatniZapis(changes);
    expect(zapis.data.width).toBe(1200);
    expect(zapis.data.height).toBe(800);
  });

  it("powtórne wczytanie tych samych wymiarów NIE zapisuje po raz drugi", () => {
    // Zapis na każdym `onLoad` to pętla: zmiana danych przerysowuje `<img>`,
    // co znowu odpala `onLoad`.
    const { container, changes } = renderEditor(ImageBlock, {
      id: "i1",
      type: "image",
      data: { url: "https://cdn.example.com/a.png", width: 1200, height: 800 },
    });
    const img = container.querySelector("img");
    Object.defineProperty(img, "naturalWidth", { value: 1200, configurable: true });
    Object.defineProperty(img, "naturalHeight", { value: 800, configurable: true });
    fireEvent.load(img as HTMLElement);
    expect(changes).toEqual([]);
  });
});
