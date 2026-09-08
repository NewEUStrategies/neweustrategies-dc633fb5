// INLINE-EDYCJA W KANWIE BUILDERA - molekuła `Editable`.
//
// `Editable` to jedyne miejsce, w którym redaktor pisze BEZPOŚREDNIO w podglądzie
// strony: polimorficzny element `contentEditable` (domyślnie `span`), w trybie
// prostym operujący na `textContent`, a w trybie `html` na `innerHTML`
// przepuszczonym przez `normalizeBuilderRichHtml`. Każde zatwierdzenie (blur albo
// mikrozadanie po poleceniu formatowania) oddaje wartość przez `onCommit`,
// w trybie bogatym po `sanitizeHtml`. Do tej pory plik nie miał ANI JEDNEGO
// własnego testu - był dotykany wyłącznie ubocznie, przez testy `WidgetView`,
// które dowodzą WIĄZANIA widget -> klucz treści, a nie zachowania edytora.
//
// CO TU JEST NAPRAWDĘ DO OBRONY
//
// 1. KTÓRE polecenie wysyła który skrót i który przycisk paska. Pomyłka
//    „bold” <-> „italic” nie rzuca wyjątku, nie psuje układu i jest niewidoczna
//    w code review - a redakcja widzi ją natychmiast. Dlatego mapowanie stoi
//    tabelą przypadków, wiersz po wierszu, osobno dla klawiatury i dla paska.
//
// 2. ODMOWY, czyli to, czego edytor robić NIE MOŻE: nie nadpisuje pola, w którym
//    ktoś właśnie pisze (inaczej karetka skacze na początek przy każdym znaku),
//    nie wysyła poleceń formatowania w polu zwykłotekstowym, nie przepuszcza
//    adresu spoza allow-listy protokołów i nie przeklikuje kliknięcia w tekst na
//    zaznaczenie widgetu w kanwie.
//
// 3. SANITYZACJA NA WYJŚCIU. Nagłówek modułu obiecuje, że „unsafe markup
//    produced by execCommand can never persist” - to zdanie musi mieć pokrycie
//    w teście, bo `execCommand` w prawdziwej przeglądarce potrafi wstawić
//    dowolny HTML z schowka.
//
// 4. NAPISY ZE SŁOWNIKA W OBU JĘZYKACH. Moduł ŚWIADOMIE nie importuje
//    `@/lib/i18n-builder` (komentarz w `Editable.tsx:21-30`, baseline
//    `src/lib/ci/i18nOverlayImports.ts`), bo siedzi w eagerowej ścieżce
//    publicznego chrome, a słownik buildera waży ~101 KB - napisy dostarcza
//    chunk kanwy. Skutek uboczny: bramka `builderI18nKeys` skanuje wyłącznie
//    `components/admin/builder` i `lib/builder`, więc DZIŚ nic nie pilnuje
//    kluczy `builder.editable.*` używanych przez ten plik. Ta luka jest tutaj
//    domknięta - dlatego atrapa `react-i18next` dostaje PRAWDZIWE `t`
//    (`@/test/i18nReal`), a plik testu sam robi side-effectowy
//    `import "@/lib/i18n-builder"`, którego moduł produkcyjny celowo nie ma.
//
// GRANICA DOWODU
//
//  * happy-dom nie ma silnika edycji: nie ma karetki, zaznaczenia ani
//    `document.execCommand`. Treści NIE DA SIĘ tu wpisać - podstawiamy ją
//    (`el.textContent = ...` / `el.innerHTML = ...`) i dopiero strzelamy
//    zdarzeniem. `document.execCommand` jest atrapą, więc dowodzimy WYWOŁAŃ
//    (jakie polecenie, z jakim argumentem), a nie efektu formatowania - to
//    jedyne API, którym ten moduł rozmawia z DOM-em, więc atrapa nie ukrywa
//    żadnej logiki produkcyjnej. Jeden przypadek celowo idzie BEZ atrapy, żeby
//    dowieść, że brak API nie wywraca edytora.
//  * Zapis po poleceniu leci przez `queueMicrotask`, czyli POZA turą Reacta -
//    stąd `await waitFor(...)` przy asercjach na `onCommit` po skrócie
//    klawiszowym. Synchroniczna asercja mierzyłaby stan sprzed mikrozadania.
//  * `sanitizeHtml` NIE jest tu podmieniany: `dompurify` jest przypięty do
//    3.4.7, a kanarek silnika (`src/lib/sanitizeEngineGuard.ts`) potwierdza, że
//    pod happy-dom ta wersja usuwa `<script>` i atrybuty `on*`. Test mierzy więc
//    prawdziwy sanitizer, a nie atrapę udającą bezpieczeństwo.
//  * Poza zasięgiem zostają WYŁĄCZNIE strażnice pustego `ref`: `if (!el) return`
//    w efekcie (`Editable.tsx:80`) i w `commit` (:92), `if (el)` w gałęzi Escape
//    (:124) oraz zapasowe `?? ""` przy `textContent` (:95). `ref` jest niepusty
//    przy każdym renderze, a `textContent` elementu nigdy nie jest `null`, więc
//    ich osiągnięcie wymagałoby atrapy `useRef` - czyli testowania Reacta
//    zamiast komponentu. Zmierzone: 100% linii, 100% funkcji (19/19),
//    94,59% gałęzi.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  /** Surowy kod języka, jaki komponent zobaczy w `i18n.language`. */
  language: "pl",
  /** Prawdziwy `getFixedT`, wstrzyknięty poniżej - fabryka nic nie importuje. */
  fixedT: null as null | typeof realT,
}));

// Fabryka jest SYNCHRONICZNA i bez importów. Udokumentowany skrót
// `async () => (await import("@/test/i18nReal")).reactI18nextMock(...)` zakleszcza
// ten plik: `@/test/i18nReal` -> `@/lib/i18n` -> `react-i18next`, czyli moduł
// właśnie mockowany (ten sam wniosek ma `community/__tests__/ReputationLevelChip`).
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: h.fixedT?.(h.language.startsWith("en") ? "en" : "pl"),
    i18n: { language: h.language },
    ready: true,
  }),
  initReactI18next: { type: "3rdParty" as const, init: () => {} },
}));

import type { ComponentProps } from "react";
import { axeViolations, summarize } from "@/test/axe";
import { realT } from "@/test/i18nReal";
import type { AppLang } from "@/lib/i18n/localePath";
// Nakładka rejestruje klucze `builder.editable.*` efektem ubocznym importu.
// Moduł produkcyjny celowo jej NIE importuje (waga chunka), więc robi to test.
import "@/lib/i18n-builder";
import { Editable } from "../Editable";

h.fixedT = realT;

const tPl = realT("pl");
const tEn = realT("en");
const klucz = (nazwa: string) => `builder.editable.${nazwa}`;

type EditableProps = ComponentProps<typeof Editable>;
type WlasnosciWejscia = Omit<Partial<EditableProps>, "onCommit">;

/**
 * Atrapa `document.execCommand`. happy-dom nie implementuje tego API - bez
 * podstawienia `exec()` wpada w `catch` i test przechodziłby „bo nic się nie
 * stało". Atrapa dodatkowo EMULUJE `insertLineBreak`, żeby przypadek Entera
 * w trybie wielowierszowym mierzył edytor, a nie brak API.
 */
const execCommand = vi.fn((cmd: string, _showUi?: boolean, _arg?: string) => {
  const aktywny = document.activeElement;
  if (cmd === "insertLineBreak" && aktywny instanceof HTMLElement) aktywny.innerHTML += "<br>";
  return true;
});

const oryginalnyExecCommand = Object.getOwnPropertyDescriptor(document, "execCommand");

function zainstalujExecCommand(): void {
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    writable: true,
    value: execCommand,
  });
}

/** Zdejmuje atrapę - przywraca środowisko BEZ `document.execCommand`. */
function usunExecCommand(): void {
  if (oryginalnyExecCommand) Object.defineProperty(document, "execCommand", oryginalnyExecCommand);
  // `Reflect.deleteProperty` zamiast `delete (document as unknown as ...)` -
  // repo trzyma zapadkę na rzutowania `as unknown as` (check:unknown-casts).
  else Reflect.deleteProperty(document, "execCommand");
}

beforeEach(() => {
  execCommand.mockClear();
  zainstalujExecCommand();
});

afterEach(() => {
  cleanup();
  usunExecCommand();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  h.language = "pl";
});

/** happy-dom nie ma `window.prompt` - podstawiamy atrapę okna dialogowego. */
function podstawPrompt(odpowiedz: string | null): ReturnType<typeof vi.fn> {
  const prompt = vi.fn(() => odpowiedz);
  vi.stubGlobal("prompt", prompt);
  return prompt;
}

function pole(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>('[contenteditable="true"]');
  if (!el) throw new Error("Editable nie wyrenderował pola contenteditable");
  return el;
}

function renderEditable(props: WlasnosciWejscia = {}) {
  const onCommit = vi.fn();
  const wszystkie: EditableProps = { value: "", onCommit, ...props };
  const view = render(<Editable {...wszystkie} />);
  return {
    onCommit,
    container: view.container,
    el: () => pole(view.container),
    pasek: () => view.container.querySelector<HTMLElement>('[role="toolbar"]'),
    przerenderuj: (zmiana: WlasnosciWejscia) =>
      view.rerender(<Editable {...wszystkie} {...zmiana} />),
  };
}

/** Fokus przez natywne `focus()` - tylko ono ustawia `document.activeElement`. */
function skupFokus(el: HTMLElement): void {
  act(() => el.focus());
}

function zdejmijFokus(el: HTMLElement): void {
  act(() => el.blur());
}

describe("Editable - tryb tekstowy", () => {
  it("domyślnie renderuje edytowalny <span> z wartością jako zwykłym tekstem", () => {
    const { el } = renderEditable({ value: "Nagłówek sekcji" });
    expect(el().tagName).toBe("SPAN");
    expect(el().getAttribute("contenteditable")).toBe("true");
    expect(el().textContent).toBe("Nagłówek sekcji");
    // Tryb prosty NIE interpretuje znaczników - inaczej treść pisana przez
    // redakcję zaczęłaby wykonywać się jako HTML.
    expect(el().innerHTML).not.toContain("<");
  });

  it("prop `as` zamienia znacznik na nagłówek i zachowuje edytowalność", () => {
    // Hierarchia nagłówków kanwy nie może znikać w trybie edycji: <h2> ma
    // zostać <h2>, a nie stać się <span>-em z klasą.
    const { el } = renderEditable({ as: "h2", value: "Tytuł" });
    expect(el().tagName).toBe("H2");
    expect(el().getAttribute("contenteditable")).toBe("true");
  });

  it("podany `placeholder` trafia w data-placeholder, a jego brak nie zostawia atrybutu", () => {
    const zPodpowiedzia = renderEditable({ placeholder: "Wpisz tekst" });
    expect(zPodpowiedzia.el().getAttribute("data-placeholder")).toBe("Wpisz tekst");

    const bezPodpowiedzi = renderEditable({ value: "x" });
    // Puste pole bierze podpowiedź z CSS-owego `content: attr(data-placeholder)`,
    // więc pusty atrybut wyrysowałby pustą pseudo-treść zamiast niczego.
    expect(bezPodpowiedzi.el().hasAttribute("data-placeholder")).toBe(false);
  });

  it("`className` i `style` z propów trafiają na element obok klas bazowych", () => {
    const zKlasa = renderEditable({
      value: "x",
      className: "text-2xl",
      style: { color: "rgb(1, 2, 3)" },
    });
    expect(zKlasa.el().className).toContain("text-2xl");
    expect(zKlasa.el().className).toContain("outline-none");
    expect(zKlasa.el().style.color).toBe("rgb(1, 2, 3)");

    const bezKlasy = renderEditable({ value: "x" });
    // Brak `className` nie może wypisać w atrybucie napisu „undefined”.
    expect(bezKlasy.el().className).not.toContain("undefined");
    expect(bezKlasy.el().className).toContain("cursor-text");
    expect(bezKlasy.el().getAttribute("style")).toBeNull();
  });

  it("utrata fokusu po zmianie tekstu oddaje nową treść przez onCommit", () => {
    const { el, onCommit } = renderEditable({ value: "stary tytuł" });
    const node = el();
    node.textContent = "nowy tytuł";
    fireEvent.blur(node);
    expect(onCommit).toHaveBeenCalledWith("nowy tytuł");
  });

  it("ODMOWA: utrata fokusu BEZ edycji nie zgłasza żadnego zapisu", () => {
    // Zapis nie może powstawać z samego kliknięcia w tekst: builder oznaczyłby
    // dokument jako brudny i odpalił autosave bez jednej zmiany redakcyjnej.
    const { el, onCommit } = renderEditable({ value: "stary tytuł" });
    skupFokus(el());
    zdejmijFokus(el());
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("nowa wartość z zewnątrz podmienia treść pola bez fokusu", () => {
    // Cofnięcie zmiany w panelu buildera musi dotrzeć do kanwy.
    const { el, przerenderuj } = renderEditable({ value: "pierwsza" });
    expect(el().textContent).toBe("pierwsza");
    przerenderuj({ value: "druga" });
    expect(el().textContent).toBe("druga");
  });

  it("ODMOWA: nowa wartość NIE nadpisuje pola, w którym ktoś właśnie pisze", () => {
    const { el, przerenderuj } = renderEditable({ value: "pierwsza" });
    const node = el();
    skupFokus(node);
    node.textContent = "redaktor pisze";
    przerenderuj({ value: "druga" });
    // Bez strażnicy `document.activeElement === el` karetka wracałaby na
    // początek pola przy każdym znaku.
    expect(node.textContent).toBe("redaktor pisze");
  });

  it("Enter w polu jednowierszowym blokuje domyślne zachowanie i kończy edycję", () => {
    const { el } = renderEditable({ value: "tytuł" });
    const node = el();
    skupFokus(node);
    // `fireEvent` zwraca false, gdy zdarzenie zostało anulowane - bez
    // `preventDefault` przeglądarka wstawiłaby łamanie wiersza w nagłówek.
    expect(fireEvent.keyDown(node, { key: "Enter" })).toBe(false);
    expect(document.activeElement).not.toBe(node);
  });

  it("ODMOWA: Shift+Enter w polu jednowierszowym nie kończy edycji", () => {
    const { el } = renderEditable({ value: "tytuł" });
    const node = el();
    skupFokus(node);
    expect(fireEvent.keyDown(node, { key: "Enter", shiftKey: true })).toBe(true);
    expect(document.activeElement).toBe(node);
  });

  it("Escape przywraca poprzedni tekst, kończy edycję i nic nie zapisuje", () => {
    const { el, onCommit } = renderEditable({ value: "oryginał" });
    const node = el();
    skupFokus(node);
    node.textContent = "bazgroły";
    expect(fireEvent.keyDown(node, { key: "Escape" })).toBe(false);
    expect(node.textContent).toBe("oryginał");
    expect(document.activeElement).not.toBe(node);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("ODMOWA: Ctrl+B w polu zwykłotekstowym nie wysyła żadnego polecenia", () => {
    // Formatowanie w polu bez `html` nie ma prawa zaistnieć: wynik i tak
    // wróciłby przez `textContent`, a w DOM-ie zostałby osierocony <b>.
    const { el } = renderEditable({ value: "tekst" });
    fireEvent.keyDown(el(), { key: "b", ctrlKey: true });
    expect(execCommand).not.toHaveBeenCalled();
  });

  it("title niesie podpowiedź „kliknij, aby edytować”, a po fokusie znika", () => {
    const { el } = renderEditable({ value: "tekst" });
    // Affordance odkrywalności: bez tego inline editing jest dla redaktora
    // niewidoczny. Po fokusie tooltip musi zniknąć, żeby nie zasłaniał tekstu.
    expect(el().getAttribute("title")).toBe(tPl(klucz("clickToEdit")));
    skupFokus(el());
    expect(el().hasAttribute("title")).toBe(false);
    zdejmijFokus(el());
    expect(el().getAttribute("title")).toBe(tPl(klucz("clickToEdit")));
  });

  it("klik i mousedown na polu nie docierają do rodzica", () => {
    // Klik w tekst nie może przeklikiwać się na zaznaczenie widgetu w kanwie -
    // inaczej każde postawienie karetki przestawiałoby panel właściwości.
    const rodzic = vi.fn();
    const { container } = render(
      <div onClick={rodzic} onMouseDown={rodzic}>
        <Editable value="tekst" onCommit={vi.fn()} />
      </div>,
    );
    const node = pole(container);
    fireEvent.click(node);
    fireEvent.mouseDown(node);
    expect(rodzic).not.toHaveBeenCalled();
  });
});

describe("Editable - tryb bogaty (html)", () => {
  it("wartość wchodzi do pola po normalizacji list, a nie surowa", () => {
    // Skorupa `<ul><li><ul><li>` powstaje z importu WordPressa i z dwukrotnego
    // kliknięcia „lista punktowana”. Kanwa musi pokazywać to, co zobaczy
    // czytelnik - normalizacja jest wspólna z rendererem publicznym.
    const { el } = renderEditable({ html: true, value: "<ul><li><ul><li>a</li></ul></li></ul>" });
    expect(el().innerHTML).toBe("<ul><li>a</li></ul>");
  });

  it("ODMOWA: wartość o identycznej postaci znormalizowanej nie przepisuje DOM-u", () => {
    const { el, przerenderuj } = renderEditable({ html: true, value: "<ul><li>a</li></ul>" });
    const node = el();
    const pozycja = node.querySelector("li");
    przerenderuj({ value: "<ul><li><ul><li>a</li></ul></li></ul>" });
    // Ta sama treść po normalizacji - `innerHTML` nie może zostać przypisany
    // ponownie, bo przypisanie niszczy węzły, a z nimi karetkę i zaznaczenie.
    expect(node.querySelector("li")).toBe(pozycja);
    expect(node.innerHTML).toBe("<ul><li>a</li></ul>");
  });

  it("zapis sanityzuje wyjście: <script> z pola nie trafia do onCommit", () => {
    // Nagłówek modułu obiecuje, że „unsafe markup produced by execCommand can
    // never persist" - w przeglądarce `execCommand` potrafi wstawić dowolny
    // HTML ze schowka, więc obietnica musi mieć pokrycie w teście.
    const { el, onCommit } = renderEditable({ html: true, value: "<p>a</p>" });
    const node = el();
    node.innerHTML = "<p>b</p><script>alert(1)</script>";
    fireEvent.blur(node);
    expect(onCommit).toHaveBeenCalledWith("<p>b</p>");
  });

  it("Escape w trybie bogatym przywraca znormalizowany HTML", () => {
    const { el } = renderEditable({ html: true, value: "<ul><li><ul><li>a</li></ul></li></ul>" });
    const node = el();
    skupFokus(node);
    node.innerHTML = "<p>bazgroły</p>";
    fireEvent.keyDown(node, { key: "Escape" });
    expect(node.innerHTML).toBe("<ul><li>a</li></ul>");
  });

  it.each([
    ["pogrubienie", "b", "bold"],
    ["kursywa", "i", "italic"],
    ["podkreślenie", "u", "underline"],
  ])("Ctrl+%s wysyła polecenie %s i domyka zapis", async (_opis, key, polecenie) => {
    const { el, onCommit } = renderEditable({ html: true, value: "<p>a</p>" });
    const node = el();
    skupFokus(node);
    node.innerHTML = "<p>b</p>";
    expect(fireEvent.keyDown(node, { key, ctrlKey: true })).toBe(false);
    expect(execCommand).toHaveBeenCalledWith(polecenie, false, undefined);
    // `execCommand` nie zawsze wywołuje `input`, więc pole samo domyka zapis
    // przez `queueMicrotask` - stąd `waitFor`, a nie asercja synchroniczna.
    await waitFor(() => expect(onCommit).toHaveBeenCalledWith("<p>b</p>"));
  });

  it("Cmd (macOS) działa tak samo jak Ctrl", () => {
    // Człon `e.metaKey` jest niedotykalny dla testu strzelającego samym Ctrl-em,
    // a to on obsługuje wszystkich redaktorów na macOS.
    const { el } = renderEditable({ html: true, value: "<p>a</p>" });
    fireEvent.keyDown(el(), { key: "b", metaKey: true });
    expect(execCommand).toHaveBeenCalledWith("bold", false, undefined);
  });

  it.each([
    ["Ctrl+\\", { key: "\\", ctrlKey: true }],
    ["Ctrl+Shift+M", { key: "M", ctrlKey: true, shiftKey: true }],
  ])("%s czyści formatowanie", (_opis, zdarzenie) => {
    const { el } = renderEditable({ html: true, value: "<p>a</p>" });
    fireEvent.keyDown(el(), zdarzenie);
    expect(execCommand).toHaveBeenCalledWith("removeFormat", false, undefined);
  });

  it("Ctrl+K pyta o adres napisem ze słownika i wstawia link", () => {
    const prompt = podstawPrompt("https://przyklad.example.com/artykul");
    const { el } = renderEditable({ html: true, value: "<p>a</p>" });
    fireEvent.keyDown(el(), { key: "k", ctrlKey: true });
    expect(prompt).toHaveBeenCalledWith(tPl(klucz("urlPrompt")), "https://");
    expect(execCommand).toHaveBeenCalledWith(
      "createLink",
      false,
      "https://przyklad.example.com/artykul",
    );
  });

  it.each([
    ["anulowanie okna", null],
    ["puste pole", ""],
  ])("ODMOWA: %s nie wstawia linku", (_opis, odpowiedz) => {
    podstawPrompt(odpowiedz);
    const { el } = renderEditable({ html: true, value: "<p>a</p>" });
    fireEvent.keyDown(el(), { key: "k", ctrlKey: true });
    expect(execCommand).not.toHaveBeenCalled();
  });

  it.each([
    ["pseudoprotokół javascript", "javascript:alert(1)"],
    ["ładunek data:", "data:text/html,x"],
    ["adres bez schematu", "example.com"],
    ["adres z wiodącą spacją", " https://example.com"],
  ])("ODMOWA: %s nie przechodzi przez allow-listę protokołów", (_opis, adres) => {
    podstawPrompt(adres);
    const { el } = renderEditable({ html: true, value: "<p>a</p>" });
    fireEvent.keyDown(el(), { key: "k", ctrlKey: true });
    expect(execCommand).not.toHaveBeenCalled();
  });

  it.each([
    ["https", "https://a.example.com"],
    ["http", "http://b.example.com"],
    ["mailto", "mailto:redakcja@example.com"],
    ["tel", "tel:+48123456789"],
    ["kotwica", "#sekcja"],
    ["ścieżka względna", "/o-nas"],
  ])("KONTROLA DODATNIA: adres %s przechodzi", (_opis, adres) => {
    // Bez tej tabeli allow-lista mogłaby być „zawsze na nie” i wszystkie
    // odmowy wyżej przechodziłyby z fałszywego powodu.
    podstawPrompt(adres);
    const { el } = renderEditable({ html: true, value: "<p>a</p>" });
    fireEvent.keyDown(el(), { key: "k", ctrlKey: true });
    expect(execCommand).toHaveBeenCalledWith("createLink", false, adres);
  });

  it("ODMOWA: skrót spoza mapy (Ctrl+Z) nie wysyła żadnego polecenia", () => {
    const { el } = renderEditable({ html: true, value: "<p>a</p>" });
    fireEvent.keyDown(el(), { key: "z", ctrlKey: true });
    expect(execCommand).not.toHaveBeenCalled();
  });

  it("Enter w polu wielowierszowym wstawia miękkie łamanie zamiast nowego bloku", async () => {
    const { el, onCommit } = renderEditable({
      html: true,
      multiline: true,
      value: "<p>a</p>",
    });
    const node = el();
    skupFokus(node);
    node.innerHTML = "<p>b</p>";
    expect(fireEvent.keyDown(node, { key: "Enter" })).toBe(false);
    expect(execCommand).toHaveBeenCalledWith("insertLineBreak");
    // Bez wymuszenia `<br>` przeglądarka rozbija akapit na nowy blok, a kanwa
    // dostaje kolumnę zamiast złamanego wiersza.
    await waitFor(() => expect(onCommit).toHaveBeenCalledWith("<p>b</p><br>"));
  });

  it("wielowierszowość działa też bez trybu bogatego", async () => {
    // Gałąź Entera zależy WYŁĄCZNIE od `multiline` - pole wielowierszowe bez
    // `html` też nie może rozbijać treści na bloki.
    const { el, onCommit } = renderEditable({ multiline: true, value: "a" });
    const node = el();
    skupFokus(node);
    node.textContent = "ab";
    fireEvent.keyDown(node, { key: "Enter" });
    expect(execCommand).toHaveBeenCalledWith("insertLineBreak");
    await waitFor(() => expect(onCommit).toHaveBeenCalledWith("ab"));
  });

  it("brak document.execCommand w środowisku nie wywraca edytora", async () => {
    // JEDYNY przypadek BEZ atrapy: `exec()` ma połknąć TypeError, a zapis ma
    // pójść mimo to. Bez tej gałęzi każdy silnik bez `execCommand` (starsze
    // WebView, przyszły runtime) zabijałby całą kanwę na jednym skrócie.
    usunExecCommand();
    const { el, onCommit } = renderEditable({ html: true, value: "<p>a</p>" });
    const node = el();
    skupFokus(node);
    node.innerHTML = "<p>b</p>";
    expect(() => fireEvent.keyDown(node, { key: "b", ctrlKey: true })).not.toThrow();
    await waitFor(() => expect(onCommit).toHaveBeenCalledWith("<p>b</p>"));
  });
});

describe("Editable - pasek formatowania", () => {
  const bogateWielowierszowe: WlasnosciWejscia = { html: true, multiline: true, value: "<p>a</p>" };

  it("pasek pojawia się po fokusie i znika po jego utracie", () => {
    const { el, pasek } = renderEditable(bogateWielowierszowe);
    expect(pasek()).toBeNull();
    skupFokus(el());
    expect(pasek()).not.toBeNull();
    expect(pasek()?.getAttribute("aria-label")).toBe(tPl(klucz("toolbar")));
    zdejmijFokus(el());
    // Pasek pływa nad treścią - zostawiony po utracie fokusu zasłaniałby
    // sąsiedni widget kanwy.
    expect(pasek()).toBeNull();
  });

  it.each([
    ["tryb bogaty bez wielowierszowości", { html: true, multiline: false }],
    ["wielowierszowość bez trybu bogatego", { html: false, multiline: true }],
    ["ani tryb bogaty, ani wielowierszowość", { html: false, multiline: false }],
  ])("ODMOWA: %s nie daje paska, a pole nadal działa", (_opis, tryb) => {
    const { el, pasek, onCommit } = renderEditable({ ...tryb, value: "a" });
    skupFokus(el());
    expect(pasek()).toBeNull();
    const node = el();
    if (tryb.html) node.innerHTML = "<p>b</p>";
    else node.textContent = "b";
    fireEvent.blur(node);
    expect(onCommit).toHaveBeenCalledWith(tryb.html ? "<p>b</p>" : "b");
  });

  it.each([
    ["pogrubienie", "bold", "bold"],
    ["kursywa", "italic", "italic"],
    ["podkreślenie", "underline", "underline"],
    ["lista punktowana", "bulletList", "insertUnorderedList"],
    ["lista numerowana", "orderedList", "insertOrderedList"],
    ["wstawienie linku", "insertLink", "createLink"],
    ["usunięcie linku", "unlink", "unlink"],
    ["wyczyszczenie formatowania", "clearFormat", "removeFormat"],
  ])("przycisk „%s” wysyła polecenie %s", (_opis, nazwaKlucza, polecenie) => {
    // Pomyłka „bold” <-> „italic” jest niewidoczna w kodzie i natychmiast
    // widoczna dla redakcji, więc każdy wiersz stoi osobno.
    if (nazwaKlucza === "insertLink") podstawPrompt("https://a.example.com");
    const { el } = renderEditable(bogateWielowierszowe);
    skupFokus(el());
    fireEvent.click(screen.getByLabelText(tPl(klucz(nazwaKlucza))));
    const [cmd] = execCommand.mock.calls[0] ?? [];
    expect(cmd).toBe(polecenie);
  });

  it("naciśnięcie paska nie zabiera fokusu polu", () => {
    const { el, pasek } = renderEditable(bogateWielowierszowe);
    skupFokus(el());
    const bar = pasek();
    if (!bar) throw new Error("Pasek nie wyrenderował się mimo fokusu");
    // `preventDefault` na `mousedown` to jedyny sposób, żeby klik w przycisk nie
    // zgubił zaznaczenia w polu - bez tego formatowanie leci w próżnię.
    expect(fireEvent.mouseDown(bar)).toBe(false);
  });

  it("pasek ma rolę i nazwę dla czytnika ekranu, a separatory są poza kolejnością czytania", () => {
    const { el, pasek } = renderEditable(bogateWielowierszowe);
    skupFokus(el());
    const bar = pasek();
    expect(bar?.getAttribute("role")).toBe("toolbar");
    expect(bar?.getAttribute("aria-label")).toBe(tPl(klucz("toolbar")));
    expect(bar?.querySelectorAll('[aria-hidden="true"]')).toHaveLength(2);
  });

  it("trzy pierwsze przyciski niosą swoje style, pozostałe pięć nie", () => {
    const { el } = renderEditable(bogateWielowierszowe);
    skupFokus(el());
    const przycisk = (nazwa: string) => screen.getByLabelText(tPl(klucz(nazwa)));
    // Etykieta „B” bez pogrubienia i „I” bez kursywy to pasek, którego nie da
    // się odczytać wzrokiem - ikonografia jest tu całą informacją.
    expect(przycisk("bold").className).toContain("font-bold");
    expect(przycisk("italic").className).toContain("italic");
    expect(przycisk("underline").className).toContain("underline underline-offset-2");
    for (const nazwa of ["bulletList", "orderedList", "insertLink", "unlink", "clearFormat"]) {
      expect(przycisk(nazwa).className).not.toMatch(/font-bold|italic|underline/);
    }
  });

  it("każdy przycisk paska ma nazwę dostępną - axe nie zgłasza naruszeń", async () => {
    const { el, container } = renderEditable(bogateWielowierszowe);
    skupFokus(el());
    const naruszenia = await axeViolations(container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });
});

describe("Editable - napisy pochodzą ze słownika buildera w obu językach", () => {
  it.each<[AppLang]>([["pl"], ["en"]])(
    "w języku %s podpowiedź i etykiety paska są tłumaczeniem, nie surowym kluczem",
    (lang) => {
      h.language = lang;
      const t = lang === "en" ? tEn : tPl;
      const { el } = renderEditable({ html: true, multiline: true, value: "<p>a</p>" });
      expect(el().getAttribute("title")).toBe(t(klucz("clickToEdit")));
      expect(el().getAttribute("title")).not.toBe(klucz("clickToEdit"));
      skupFokus(el());
      for (const nazwa of [
        "toolbar",
        "bold",
        "italic",
        "underline",
        "bulletList",
        "orderedList",
        "insertLink",
        "unlink",
        "clearFormat",
      ]) {
        const napis = t(klucz(nazwa));
        expect(napis).not.toBe(klucz(nazwa));
        // Moduł produkcyjny CELOWO nie importuje `@/lib/i18n-builder` (waga
        // chunka), a bramka `builderI18nKeys` nie skanuje tego katalogu - to
        // jedyne miejsce, które pilnuje kompletu kluczy `builder.editable.*`.
        expect(screen.getByLabelText(napis)).toBeInTheDocument();
      }
    },
  );

  it("polskie i angielskie napisy paska są RÓŻNE", () => {
    // Bez tego przypadku brakujący bundle EN przechodziłby niezauważony:
    // i18next spadłby na polski fallback, a obie asercje wyżej nadal byłyby
    // zielone.
    for (const nazwa of ["clickToEdit", "toolbar", "bulletList", "unlink"]) {
      expect(tEn(klucz(nazwa))).not.toBe(tPl(klucz(nazwa)));
    }
  });
});

describe("Editable - ZAREJESTROWANE DEFEKTY", () => {
  // DEFEKT: TREŚĆ Z BAZY WCHODZI DO DOM-U KANWY BEZ SANITYZACJI.
  //
  // WEJSCIE: widget „text” z `value` pochodzącym wprost z `builder_data`
  //   (import WordPressa albo pole edytowalne przez redakcję), zawierającym
  //   `<img onerror="alert(1)">`.
  // CO PSUJE: `Editable.tsx:82-84` (efekt synchronizujący) i `:125` (gałąź
  //   Escape) robią `el.innerHTML = normalizeBuilderRichHtml(value)`, a
  //   `normalizeBuilderRichHtml` (src/lib/builder/normalizeRichHtml.ts:26) NIE
  //   JEST sanitizerem - przy wejściu bez `<ul>`/`<ol>` zwraca je NIETKNIĘTE.
  //   Nagłówek modułu (linie 7-8) obiecuje sanityzację NA WYJŚCIU i tej
  //   obietnicy dotrzymuje; luka jest na WEJŚCIU i nikt jej nie zadeklarował.
  // KONSEKWENCJA: ta sama treść na ścieżce TYLKO DO ODCZYTU idzie przez
  //   `RichHtmlView`, który woła `sanitizeHtml` - czyli kanwa edytora jest DZIŚ
  //   mniej bezpieczna niż strona publiczna, a atakuje się w niej redaktora
  //   z sesją administracyjną.
  // WYMAGANA POPRAWKA: `el.innerHTML = sanitizeHtml(normalizeBuilderRichHtml(value))`
  //   w OBU miejscach; moduł importuje `sanitizeHtml` już dziś (linia 19), więc
  //   nie brakuje nawet zależności.
  it.fails("DEFEKT: wartość z bazy MUSI być sanityzowana, zanim trafi do DOM-u kanwy", () => {
    const { el } = renderEditable({
      html: true,
      value: '<p>ok</p><img alt="" onerror="alert(1)">',
    });
    expect(el().querySelector("img")?.hasAttribute("onerror")).toBe(false);
  });

  it("KONTROLA DODATNIA: dziś atrybut onerror JEST w DOM-ie kanwy", () => {
    const { el } = renderEditable({
      html: true,
      value: '<p>ok</p><img alt="" onerror="alert(1)">',
    });
    expect(el().querySelector("img")?.getAttribute("onerror")).toBe("alert(1)");
  });

  // DEFEKT: ESCAPE (ANULOWANIE) MIMO WSZYSTKO ZGŁASZA ZMIANĘ TREŚCI.
  //
  // WEJSCIE: pole `html` z wartością, którą normalizacja zmienia -
  //   `<ul><li><ul><li>a</li></ul></li></ul>`; redaktor coś wpisuje i naciska
  //   Escape.
  // CO PSUJE: gałąź Escape (`Editable.tsx:121-130`) przywraca wartość do DOM-u
  //   i woła `blur()`, a `onBlur` (:169-172) woła `commit()` BEZWARUNKOWO.
  //   `commit` porównuje `next` - czyli `sanitizeHtml(normalizeBuilderRichHtml(...))`
  //   - z SUROWYM propem `value`. Dla wartości nieznormalizowanej te dwa napisy
  //   nigdy się nie zrównają, więc `onCommit` leci.
  // KONSEKWENCJA: klawisz, którego jedynym sensem jest „nie zapisuj”, zapisuje.
  //   Redaktor cofa zmianę, a builder i tak oznacza dokument jako brudny
  //   i odpala autosave.
  // WYMAGANA POPRAWKA: Escape ustawia flagę anulowania honorowaną przez
  //   `commit` (albo zdejmuje handler `blur` na czas przywracania), tak żeby
  //   anulowanie NIGDY nie generowało zapisu.
  it.fails("DEFEKT: Escape MUSI anulować edycję bez zapisu", () => {
    const { el, onCommit } = renderEditable({
      html: true,
      value: "<ul><li><ul><li>a</li></ul></li></ul>",
    });
    const node = el();
    skupFokus(node);
    node.innerHTML = "<p>bazgroły</p>";
    fireEvent.keyDown(node, { key: "Escape" });
    fireEvent.blur(node);
    expect(onCommit).not.toHaveBeenCalled();
  });

  // DEFEKT: SAM FOKUS I BLUR, BEZ JEDNEJ EDYCJI, ZGŁASZAJĄ ZMIANĘ TREŚCI.
  //
  // WEJSCIE: pole `html` z wartością nieznormalizowaną w bazie (typowa po
  //   imporcie WordPressa), kliknięcie w akapit i kliknięcie obok.
  // CO PSUJE: ten sam mechanizm co wyżej - `commit` (`Editable.tsx:93-96`)
  //   porównuje przetworzone `next` z surowym `value`, a efekt (:82-84) wstawił
  //   do DOM-u postać JUŻ przetworzoną. Baseline porównania i zawartość pola
  //   pochodzą więc z dwóch różnych światów.
  // KONSEKWENCJA: samo przejrzenie strony w kanwie brudzi dokument i odpala
  //   autosave (ścieżkę pilnuje `scripts/check-editor-autosave.ts`). Redaktor
  //   dostaje historię wersji pełną zmian, których nie zrobił, a przy pracy
  //   dwóch osób - konflikty zapisu bez powodu.
  // WYMAGANA POPRAWKA: baseline liczony RAZ, z tej samej normalizacji, którą
  //   efekt wstawił do DOM-u (np. ref z ostatnio wstawioną wartością), żeby
  //   „brak edycji” dawał „brak zapisu” niezależnie od postaci wartości w bazie.
  it.fails("DEFEKT: fokus i blur bez edycji NIE MOGĄ zgłaszać zmiany treści", () => {
    const { el, onCommit } = renderEditable({
      html: true,
      value: "<ul><li><ul><li>a</li></ul></li></ul>",
    });
    skupFokus(el());
    zdejmijFokus(el());
    expect(onCommit).not.toHaveBeenCalled();
  });

  // DEFEKT: POLE EDYCYJNE NIE MA ANI ROLI, ANI NAZWY DOSTĘPNEJ.
  //
  // WEJSCIE: dowolne renderowanie `Editable` - czytnik ekranu wchodzi na pole
  //   inline-edycji w kanwie.
  // CO PSUJE: element z `Editable.tsx:162-183` dostaje `contentEditable`,
  //   `spellCheck` i `title`, ale NIE dostaje `role="textbox"`, `aria-multiline`
  //   ani `aria-label`. `title` nazwą dostępną tu nie jest, bo znika po
  //   fokusie (:180) - czyli dokładnie wtedy, gdy jest potrzebny.
  // KONSEKWENCJA: dla czytnika ekranu inline-edycja jest regionem bez nazwy
  //   i bez zapowiedzianej wielowierszowości. Bliźniaczy komponent tej samej
  //   rodziny, `RichHtmlField.tsx:204-206`, ma wszystkie trzy atrybuty - i to
  //   dlatego jego test sięga po `getByRole("textbox")`, a testy kanwy muszą
  //   sięgać po selektor `[contenteditable]`.
  // WYMAGANA POPRAWKA: `role="textbox"`, `aria-multiline={multiline}` i nazwa
  //   dostępna (`aria-label` z tłumaczenia albo `aria-labelledby` wskazujące
  //   etykietę widgetu).
  it.fails("DEFEKT: pole edycyjne MUSI mieć rolę textbox i nazwę dostępną", () => {
    renderEditable({ multiline: true, value: "tekst" });
    const node = screen.getByRole("textbox");
    expect(node.getAttribute("aria-multiline")).toBe("true");
    expect(node.getAttribute("aria-label")).toBeTruthy();
  });

  // DEFEKT: NAGŁÓWEK OBIECUJE PASEK DLA TRYBU BOGATEGO, KOD DAJE GO TYLKO
  // PRZY `html` I RÓWNOCZEŚNIE `multiline`.
  //
  // WEJSCIE: widget z `html` bez `multiline` (dziś nieużywany, ale dopuszczony
  //   przez sygnaturę), po fokusie w polu.
  // CO PSUJE: komentarz nagłówkowy (`Editable.tsx:4-6`) mówi wprost „Rich mode
  //   (`html`) exposes a lightweight floating toolbar”, natomiast `:161` to
  //   `const showToolbar = html && multiline`, a `:186` robi wczesny return bez
  //   paska. Strażnica skrótów klawiszowych (:131) sprawdza już tylko `html`.
  // KONSEKWENCJA: każdy nowy widget z `html` bez `multiline` dostaje PO CICHU
  //   edytor bogaty bez Bolda, Italica i wstawiania linku - przy działających
  //   skrótach klawiszowych. Dokumentacja i kod stoją po dwóch stronach, więc
  //   następny autor widgetu nie ma jak zgadnąć, która wersja obowiązuje.
  // WYMAGANA POPRAWKA: albo pasek zależy od samego `html` (zgodnie z nagłówkiem),
  //   albo nagłówek i sygnatura mówią jasno, że pasek wymaga `multiline`.
  it.fails("DEFEKT: tryb bogaty bez multiline też MUSI dawać pasek narzędzi", () => {
    const { el, pasek } = renderEditable({ html: true, value: "<p>a</p>" });
    skupFokus(el());
    expect(pasek()).not.toBeNull();
  });
});
