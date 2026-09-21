// Predykaty odnośnika powiadomienia - reguła bezpieczeństwa nawigacji.
//
// PO CO TEN PLIK. `isInternalHref` decyduje, czy `href` przyniesiony
// Z BAZY trafi do `router.navigate({ href })`. Dopóki te trzy funkcje żyły
// w trzech kopiach wewnątrz komponentów, jedynym sposobem ich wywołania było
// wyrenderowanie całej skrzynki - i żadna z nich nie miała ani jednej
// asercji. Test jednostkowy przypina tu granicę „wewnętrzne / zewnętrzne"
// tak, żeby cofnięcie warunku `!href.startsWith("//")` (czyli otwarcie SPA
// na obcy host przez treść z bazy) było CZERWONE, a nie niezauważone.
import { describe, expect, it } from "vitest";
import type { MouseEvent as ReactMouseEvent } from "react";
import { isInternalHref, isPlainLeftClick, notificationActorId } from "../notificationLink";

/** UUID rozmówcy - stały, żeby asercja pokazywała dokładnie tę wartość. */
const ACTOR_ID = "0d1b8b1e-3f9a-4c1d-9a11-2f0e5c7b6a34";

type AnchorClick = ReactMouseEvent<HTMLAnchorElement>;

/**
 * Pełny, TYPOWANY literał zdarzenia kliknięcia kotwicy.
 *
 * Świadomie budowany w całości, a nie rzutowany z okrojonego obiektu:
 * `as unknown as React.MouseEvent<...>` przepuściłby literówkę w nazwie pola
 * (np. `metakey`), a wtedy test „modyfikator blokuje przechwycenie" byłby
 * zielony przy KAŻDEJ implementacji predykatu - łącznie z taką, która
 * modyfikatorów w ogóle nie czyta. Kompilator jest tu częścią asercji.
 */
function anchorClick(overrides: Partial<AnchorClick> = {}): AnchorClick {
  const anchor = document.createElement("a");
  const base: AnchorClick = {
    nativeEvent: new MouseEvent("click"),
    currentTarget: anchor,
    target: anchor,
    bubbles: true,
    cancelable: true,
    defaultPrevented: false,
    eventPhase: 2,
    isTrusted: true,
    preventDefault: () => undefined,
    isDefaultPrevented: () => false,
    stopPropagation: () => undefined,
    isPropagationStopped: () => false,
    persist: () => undefined,
    timeStamp: 0,
    type: "click",
    detail: 1,
    view: { styleMedia: { type: "screen", matchMedium: () => true }, document },
    altKey: false,
    button: 0,
    buttons: 1,
    clientX: 0,
    clientY: 0,
    ctrlKey: false,
    getModifierState: () => false,
    metaKey: false,
    movementX: 0,
    movementY: 0,
    pageX: 0,
    pageY: 0,
    relatedTarget: null,
    screenX: 0,
    screenY: 0,
    shiftKey: false,
  };
  return { ...base, ...overrides };
}

describe("isInternalHref", () => {
  it("uznaje ścieżkę bezwzględną tej aplikacji za wewnętrzną", () => {
    expect(isInternalHref("/messages")).toBe(true);
  });

  it("uznaje ścieżkę z query za wewnętrzną (parametry nie zmieniają hosta)", () => {
    expect(isInternalHref("/messages?c=x")).toBe(true);
  });

  it("ODRZUCA adres protocol-relative `//host` jako ZEWNĘTRZNY", () => {
    // To jest sedno reguły bezpieczeństwa. `//evil.example/x` zaczyna się od
    // ukośnika, więc naiwne `startsWith("/")` wpuściłoby go do
    // `router.navigate({ href })` - a przeglądarka rozwija taki adres na
    // `https://evil.example/x`. Wiersz powiadomienia pochodzi z bazy, czyli
    // sterowałby nawigacją SPA na obcy host.
    expect(isInternalHref("//evil.example/x")).toBe(false);
  });

  it("odrzuca pełny adres z protokołem", () => {
    expect(isInternalHref("https://example.com")).toBe(false);
  });

  it("odrzuca pusty napis (brak odnośnika to nie jest odnośnik wewnętrzny)", () => {
    expect(isInternalHref("")).toBe(false);
  });

  it("odrzuca ścieżkę względną bez wiodącego ukośnika", () => {
    // `messages` rozwinęłoby się względem BIEŻĄCEJ trasy, więc ten sam wiersz
    // prowadziłby gdzie indziej z każdego ekranu - to nie jest adres.
    expect(isInternalHref("messages")).toBe(false);
  });
});

describe("isPlainLeftClick", () => {
  it("przechwytuje niemodyfikowany klik lewym przyciskiem", () => {
    expect(isPlainLeftClick(anchorClick())).toBe(true);
  });

  it("NIE przechwytuje kliku z klawiszem meta (cmd - otwórz w nowej karcie)", () => {
    expect(isPlainLeftClick(anchorClick({ metaKey: true }))).toBe(false);
  });

  it("NIE przechwytuje kliku z klawiszem ctrl", () => {
    expect(isPlainLeftClick(anchorClick({ ctrlKey: true }))).toBe(false);
  });

  it("NIE przechwytuje kliku z klawiszem shift (otwórz w nowym oknie)", () => {
    expect(isPlainLeftClick(anchorClick({ shiftKey: true }))).toBe(false);
  });

  it("NIE przechwytuje kliku z klawiszem alt (pobierz cel odnośnika)", () => {
    expect(isPlainLeftClick(anchorClick({ altKey: true }))).toBe(false);
  });

  it("NIE przechwytuje środkowego przycisku (`button === 1`)", () => {
    // Środkowy przycisk to natywne „otwórz w nowej karcie". Przechwycenie go
    // przez `preventDefault` + `router.navigate` zabiera użytkownikowi jedyny
    // sposób otwarcia powiadomienia obok bieżącego widoku.
    expect(isPlainLeftClick(anchorClick({ button: 1 }))).toBe(false);
  });

  it("NIE przechwytuje zdarzenia już obsłużonego (`defaultPrevented`)", () => {
    // Drugi handler na tym samym drzewie mógł już zdecydować, co się dzieje.
    // Nadpisanie tej decyzji nawigacją SPA daje podwójne przejście.
    expect(isPlainLeftClick(anchorClick({ defaultPrevented: true }))).toBe(false);
  });

  it("nie przechwytuje przy KILKU modyfikatorach naraz", () => {
    expect(isPlainLeftClick(anchorClick({ ctrlKey: true, shiftKey: true }))).toBe(false);
  });
});

describe("notificationActorId", () => {
  it("wyjmuje id rozmowy z parametru `c`", () => {
    expect(notificationActorId(`/messages?c=${ACTOR_ID}`)).toBe(ACTOR_ID);
  });

  it("zwraca null, gdy trasa nie niesie parametru `c`", () => {
    expect(notificationActorId("/messages")).toBeNull();
  });

  it("zwraca null dla adresu zewnętrznego, nawet gdy ma parametr `c`", () => {
    // Profil aktora czytamy WYŁĄCZNIE dla własnych tras: adres obcego hosta
    // nie jest źródłem id, które wolno podstawić do zapytania o kontakty.
    expect(notificationActorId(`https://example.org/messages?c=${ACTOR_ID}`)).toBeNull();
  });

  it("zwraca null dla adresu protocol-relative z parametrem `c`", () => {
    // Ta sama granica co w `isInternalHref` - `//evil?c=x` jest zewnętrzny,
    // więc odpada PRZED parsowaniem, a nie po wyjęciu parametru.
    expect(notificationActorId("//evil?c=x")).toBeNull();
  });

  it("zwraca null dla braku odnośnika (null i undefined)", () => {
    // Kolumna `notifications.href` jest NULLABLE - powiadomienie systemowe
    // nie prowadzi nigdzie, więc to jest ścieżka produkcyjna, nie skrajność.
    expect(notificationActorId(null)).toBeNull();
    expect(notificationActorId(undefined)).toBeNull();
  });

  it("zwraca null dla pustego napisu", () => {
    expect(notificationActorId("")).toBeNull();
  });

  it("znajduje `c` wśród wielu parametrów, niezależnie od pozycji", () => {
    expect(notificationActorId(`/messages?tab=unread&c=${ACTOR_ID}&page=2`)).toBe(ACTOR_ID);
  });

  it("dekoduje wartość parametru zapisaną procentowo", () => {
    // `URLSearchParams` odkodowuje `%20`; gdyby ktoś zamienił parsowanie na
    // ręczne cięcie po `&` i `=`, id wróciłoby zakodowane i nie trafiłoby
    // w żaden `connection_id` z RPC.
    expect(notificationActorId("/messages?c=id%20ze%20spacja")).toBe("id ze spacja");
  });

  it("zwraca pusty napis dla `c=` bez wartości, a nie null", () => {
    // Parametr OBECNY, ale pusty, to inna sytuacja niż jego brak - i taki
    // wynik i tak nie trafi w żaden `connection_id`, więc filtr po stronie
    // `useNotificationActorProfiles` musi go przeżyć.
    expect(notificationActorId("/messages?c=")).toBe("");
  });
});
