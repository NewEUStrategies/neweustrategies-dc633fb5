// CELE EDYCJI ROZMIARU - warstwa czysta i warstwa POMIARU DOM-u.
//
// `editTargets.ts` jest jedynym zrodlem prawdy dla dwoch powierzchni edycji
// (plywajaca belka `InlineSizeToolbar` na kanwie oraz steppery "Rozmiary
// elementow formularza (px)" w `WidgetProperties`). Katalog i listy pol maja
// juz dowod w `src/components/admin/builder/__tests__/inlineSizeToolbar.test.tsx`
// ("editTargets metadata"). Czego tam NIE MA - i co ten plik dokłada:
//
// 1. ODMOWY. Kazda z czterech funkcji ma sciezke "nie da sie": klucz spoza
//    katalogu, brak `CSS.escape`, brak `document`, brak `window`, brak elementu,
//    prostokat o zerowych wymiarach, nieparsowalny `font-size`. To wlasnie te
//    galezie decyduja, czy uzytkownik zobaczy wartosc zastepcza (`fallbackPx`),
//    czy belke z `NaN`.
// 2. DWA TRYBY POMIARU. Cel ikonowy jest wezlem `<svg>` i mierzy sie GO
//    PROSTOKATEM, a nie `font-size` - bo rozmiar czcionki nie mowi nic o tym,
//    jak duza jest ikona. Warunek rozgalezia sie na `instanceof SVGElement`
//    ORAZ na nazwe znacznika, wiec obie polowy sa tu sprawdzane osobno.
//
// GRANICA DOWODU: `escapeAttrSelector` jest wstawiany do selektora atrybutu
// W CUDZYSLOWIU (`[data-widget-id="..."]`), a nie w pozycji identyfikatora.
// Test przypina, ze obie galezie (natywny `CSS.escape` i zapasowa podmiana
// regexem) zwracaja lancuch, ktorym da sie odpytac DOM - nie rozstrzyga
// natomiast zgodnosci z pelna gramatyka CSS, bo produkcja tego nie potrzebuje.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EDIT_TARGET_META,
  FOCUS_SIZE_FIELD_EVENT,
  clampEditTarget,
  escapeAttrSelector,
  findEditTargetElement,
  isEditTargetKey,
  measureEditTargetPx,
} from "@/lib/builder/editTargets";

const WIDGET_ID = "w-formularz";

/** Buduje kanwe: [data-visual-canvas] > [data-widget-id] > [data-edit-target]. */
function mountCanvas(
  key: string,
  tag = "p",
  widgetId: string = WIDGET_ID,
): { canvas: HTMLElement; target: HTMLElement } {
  const canvas = document.createElement("div");
  canvas.setAttribute("data-visual-canvas", "");
  const widget = document.createElement("div");
  widget.setAttribute("data-widget-id", widgetId);
  const target = document.createElement(tag);
  target.setAttribute("data-edit-target", key);
  widget.appendChild(target);
  canvas.appendChild(widget);
  document.body.appendChild(canvas);
  return { canvas, target };
}

/** Nadpisuje prostokat elementu - happy-dom zwraca same zera. */
function setRect(el: Element, width: number, height: number): void {
  el.getBoundingClientRect = () =>
    ({
      top: 0,
      left: 0,
      right: width,
      bottom: height,
      width,
      height,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("isEditTargetKey - rozpoznanie klucza", () => {
  it("przyjmuje klucz z katalogu, odrzuca pusty, null i undefined", () => {
    expect(isEditTargetKey("titleSize")).toBe(true);
    expect(isEditTargetKey("")).toBe(false);
    expect(isEditTargetKey(null)).toBe(false);
    expect(isEditTargetKey(undefined)).toBe(false);
  });

  it("odrzuca pola ODZIEDZICZONE po Object.prototype", () => {
    // Klucz przychodzi z atrybutu `data-edit-target`, czyli ze stringa z DOM-u.
    // Gdyby sprawdzenie bylo zwyklym `EDIT_TARGET_META[key]`, "constructor"
    // i "toString" udawalyby wpisy katalogu. `hasOwnProperty` to blokuje.
    expect(isEditTargetKey("constructor")).toBe(false);
    expect(isEditTargetKey("toString")).toBe(false);
    expect(isEditTargetKey("__proto__")).toBe(false);
  });
});

describe("clampEditTarget - przyciecie do zakresu", () => {
  it("przycina do min i max klucza oraz zaokragla wartosc ulamkowa", () => {
    expect(clampEditTarget("titleSize", 5)).toBe(EDIT_TARGET_META.titleSize.min);
    expect(clampEditTarget("titleSize", 500)).toBe(EDIT_TARGET_META.titleSize.max);
    expect(clampEditTarget("titleSize", 23.6)).toBe(24);
  });

  it("STAN FAKTYCZNY: klucz spoza katalogu tylko zaokragla, NIE przycina", () => {
    // Brak metadanych = brak zakresu, wiec funkcja przepuszcza dowolna liczbe.
    // Przypiete jako stan faktyczny, bo to jedyna galaz `if (!meta)` i to ona
    // decyduje, co sie stanie, gdy listy pol rozjada sie z katalogiem.
    expect(clampEditTarget("rozmiarKtoregoNieMa", 4000)).toBe(4000);
    expect(clampEditTarget("rozmiarKtoregoNieMa", -12.4)).toBe(-12);
  });

  // DEFEKT: "PRZYTNIJ" ZWRACA NaN DLA KLUCZA ODZIEDZICZONEGO PO PROTOTYPIE.
  //
  // WEJSCIE: `clampEditTarget("constructor", 20)`.
  // CO PSUJE: `editTargets.ts:133` siega po metadane zwyklym indeksowaniem
  //   (`EDIT_TARGET_META[key]`), a nie tym samym sprawdzeniem, ktore ma tuz
  //   obok `isEditTargetKey` (`hasOwnProperty`, :129-130). Dla "constructor",
  //   "toString" czy "valueOf" indeksowanie zwraca skladnik `Object.prototype`
  //   - wartosc PRAWDZIWA - wiec galaz `if (!meta)` sie nie wykonuje,
  //   a `meta.min` i `meta.max` sa `undefined`. `Math.max(undefined, ...)`
  //   daje `NaN`.
  // KONSEKWENCJA: do `content[key]` trafia `NaN`. Zapisany dokument niesie
  //   wtedy `null` (JSON nie zna `NaN`), stepper pokazuje pusto, a wygenerowany
  //   `font-size: NaNpx` jest odrzucany przez przegladarke, wiec tekst wraca do
  //   rozmiaru domyslnego mimo ustawionej wartosci.
  //   UCZCIWIE O ZASIEGU: dzis nie da sie tu dojsc z produkcji - jedyne
  //   wywolanie (`InlineSizeToolbar.tsx:236`) jest za bramka `isEditTargetKey`
  //   (:115), a druga powierzchnia bierze klucze z zaszytej listy
  //   `FORM_SIZE_FIELDS`. Szkoda jest wiec UTAJONA: rozbroi ja pierwsze trzecie
  //   wywolanie tej eksportowanej funkcji bez wlasnej bramki. Funkcja nazwana
  //   "przytnij" nigdy nie powinna zwracac `NaN` niezaleznie od wolajacego.
  // WYMAGANA POPRAWKA: `clampEditTarget` musi pobierac metadane przez to samo
  //   sprawdzenie wlasnosci wlasnej, ktorego uzywa `isEditTargetKey` (np.
  //   `const meta = isEditTargetKey(key) ? EDIT_TARGET_META[key] : undefined`),
  //   zeby klucz odziedziczony spadal na galaz "brak metadanych".
  it.fails("DEFEKT: clampEditTarget dla klucza z prototypu NIE moze zwracac NaN", () => {
    expect(clampEditTarget("constructor", 20)).toBe(20);
  });
});

describe("escapeAttrSelector - obie galezie ucieczki", () => {
  it("uzywa natywnego CSS.escape, gdy jest dostepny", () => {
    expect(typeof CSS.escape).toBe("function");

    expect(escapeAttrSelector("a b")).toBe(CSS.escape("a b"));
  });

  it("spada na podmiane regexem, gdy CSS w ogole nie ma", () => {
    // Sciezka serwerowa i starsze silniki: `CSS` nie istnieje jako globalna.
    // Zapasowa podmiana poprzedza odwrotnym ukosnikiem KAZDY znak spoza
    // [A-Za-z0-9_-], wiec cudzyslow konczacy selektor atrybutu i dwukropek
    // sa neutralizowane, a lacznik zostaje bez zmian.
    vi.stubGlobal("CSS", undefined);

    expect(escapeAttrSelector('w 1:2"-a')).toBe('w\\ 1\\:2\\"-a');
  });

  it("spada na podmiane regexem, gdy CSS istnieje, ale bez metody escape", () => {
    vi.stubGlobal("CSS", {});

    expect(escapeAttrSelector("a b")).toBe("a\\ b");
  });

  it("zostawia znaki bezpieczne bez zmiany na obu galeziach", () => {
    const bezpieczny = "widget-1_abc";
    expect(escapeAttrSelector(bezpieczny)).toBe(bezpieczny);

    vi.stubGlobal("CSS", undefined);
    expect(escapeAttrSelector(bezpieczny)).toBe(bezpieczny);
  });
});

describe("findEditTargetElement - szukanie elementu na kanwie", () => {
  it("znajduje element ostemplowany kluczem wewnatrz wlasciwego widgetu", () => {
    const { target } = mountCanvas("titleSize");

    expect(findEditTargetElement(WIDGET_ID, "titleSize")).toBe(target);
  });

  it("nie wychodzi poza kanwe - identyczny element poza [data-visual-canvas] nie liczy sie", () => {
    // Podglad publiczny renderuje te same stemple. Gdyby selektor nie zaczynal
    // sie od `[data-visual-canvas]`, belka edycji mierzylaby element spoza
    // edytowanej kanwy.
    const pozaKanwa = document.createElement("div");
    pozaKanwa.setAttribute("data-widget-id", WIDGET_ID);
    const target = document.createElement("p");
    target.setAttribute("data-edit-target", "titleSize");
    pozaKanwa.appendChild(target);
    document.body.appendChild(pozaKanwa);

    expect(findEditTargetElement(WIDGET_ID, "titleSize")).toBeNull();
  });

  it("zwraca null, gdy widgetu o tym identyfikatorze nie ma na kanwie", () => {
    mountCanvas("titleSize");

    expect(findEditTargetElement("w-innego-widgetu", "titleSize")).toBeNull();
  });

  it("zwraca null, gdy widget jest, ale nie ma w nim stempla o tym kluczu", () => {
    mountCanvas("titleSize");

    expect(findEditTargetElement(WIDGET_ID, "consentSize")).toBeNull();
  });

  it("zwraca null BEZ dotykania DOM-u, gdy nie ma obiektu document (render serwerowy)", () => {
    mountCanvas("titleSize");
    vi.stubGlobal("document", undefined);

    expect(findEditTargetElement(WIDGET_ID, "titleSize")).toBeNull();
  });

  it("radzi sobie z identyfikatorem widgetu wymagajacym ucieczki", () => {
    // Identyfikatory wezlow sa generowane, ale dokument moze przyjsc z importu
    // i niesc znaki specjalne. Nieoescapowany selektor rzuciłby wyjatkiem
    // skladniowym z `querySelector`, zamiast zwrocic null.
    const { target } = mountCanvas("titleSize", "p", "w:1.2");

    expect(findEditTargetElement("w:1.2", "titleSize")).toBe(target);
  });
});

describe("measureEditTargetPx - pomiar rozmiaru celu", () => {
  it("czyta wyliczony font-size elementu tekstowego i zaokragla go", () => {
    const { target } = mountCanvas("descriptionSize");
    target.style.fontSize = "18.4px";

    expect(measureEditTargetPx(WIDGET_ID, "descriptionSize")).toBe(18);
  });

  it("zwraca null, gdy elementu nie ma - wolajacy pokazuje wtedy fallbackPx", () => {
    mountCanvas("titleSize");

    expect(measureEditTargetPx(WIDGET_ID, "consentSize")).toBeNull();
  });

  it("zwraca null, gdy nie ma obiektu window, choc element istnieje", () => {
    // Element da sie znalezc (document zyje), ale `getComputedStyle` nalezy do
    // `window`. Bez tej galezi pomiar rzucalby ReferenceError przy renderze
    // serwerowym z podstawionym DOM-em.
    mountCanvas("titleSize");
    vi.stubGlobal("window", undefined);

    expect(measureEditTargetPx(WIDGET_ID, "titleSize")).toBeNull();
  });

  it("mierzy cel ikonowy PROSTOKATEM, nie rozmiarem czcionki", () => {
    // `<svg>` z rodziny SVGElement: font-size nic nie mowi o tym, jak duza jest
    // ikona, wiec liczy sie dluzszy bok prostokata.
    const canvas = document.createElement("div");
    canvas.setAttribute("data-visual-canvas", "");
    const widget = document.createElement("div");
    widget.setAttribute("data-widget-id", WIDGET_ID);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("data-edit-target", "iconSize");
    widget.appendChild(svg);
    canvas.appendChild(widget);
    document.body.appendChild(canvas);
    setRect(svg, 20, 31.6);

    expect(svg instanceof SVGElement).toBe(true);
    expect(measureEditTargetPx(WIDGET_ID, "iconSize")).toBe(32);
  });

  it("mierzy prostokatem takze element o nazwie svg spoza przestrzeni nazw SVG", () => {
    // Druga polowa warunku (`tagName.toLowerCase() === "svg"`) lapie wezel
    // zbudowany przez `createElement("svg")` - taki nie jest instancja
    // SVGElement, a mimo to jest ikona i nie wolno go mierzyc czcionka.
    const { target } = mountCanvas("iconSize", "svg");
    expect(target instanceof SVGElement).toBe(false);
    setRect(target, 48, 12);

    expect(measureEditTargetPx(WIDGET_ID, "iconSize")).toBe(48);
  });

  it("zwraca null dla ikony o ZEROWYCH wymiarach zamiast podawac 0 px", () => {
    // Ikona jeszcze niezlozona (display:none, obraz w trakcie ladowania) ma
    // prostokat 0x0. Zero jest wartoscia NIEUZYTECZNA dla steppera, wiec
    // funkcja musi powiedziec "nie zmierzone", a nie "zero pikseli".
    const { target } = mountCanvas("iconSize", "svg");
    setRect(target, 0, 0);

    expect(measureEditTargetPx(WIDGET_ID, "iconSize")).toBeNull();
  });

  it("zwraca null, gdy wyliczony font-size nie da sie sparsowac na liczbe", () => {
    const { target } = mountCanvas("labelSize");
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      fontSize: "inherit",
    } as unknown as CSSStyleDeclaration);

    expect(target.getAttribute("data-edit-target")).toBe("labelSize");
    expect(measureEditTargetPx(WIDGET_ID, "labelSize")).toBeNull();
  });
});

describe("nazwa zdarzenia laczaca belke z panelem", () => {
  it("jest stala - obie powierzchnie nasluchuja tego samego lancucha", () => {
    expect(FOCUS_SIZE_FIELD_EVENT).toBe("cms:focus-size-field");
  });
});
