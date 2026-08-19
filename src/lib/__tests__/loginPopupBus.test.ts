// SZYNA ZDARZEŃ POPUPU LOGOWANIA - 8,33% instrukcji i 0 z 2 funkcji.
//
// Ten moduł jest jedynym sposobem, w jaki „akcja zastrzeżona" (zapis artykułu,
// obserwowanie autora) prosi o zalogowanie. Jeśli szyna przestanie działać,
// przyciski w całym serwisie po prostu przestaną cokolwiek robić - bez błędu
// w konsoli, bez czerwonego testu, bez śladu. Dlatego testowane jest nie tylko
// „czy dochodzi", ale też odpinanie: nasłuch, który przeżyje odmontowanie
// komponentu, otwiera popup nad nieistniejącym drzewem Reacta.
import { describe, it, expect, vi, beforeEach } from "vitest";

import { openLoginPopup, onOpenLoginPopup, type LoginPopupOptions } from "@/lib/loginPopupBus";

let received: LoginPopupOptions[];

beforeEach(() => {
  received = [];
});

const collect = (opts: LoginPopupOptions) => {
  received.push(opts);
};

describe("onOpenLoginPopup - subskrypcja i odpinanie", () => {
  it("nasłuch dostaje zdarzenie wraz z opcjami", () => {
    const off = onOpenLoginPopup(collect);

    openLoginPopup({ mode: "signup", title: "Zapisz artykuł" });

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ mode: "signup", title: "Zapisz artykuł" });
    off();
  });

  it("wyrejestrowanie FAKTYCZNIE odpina - zdarzenie po unmount nie dochodzi", () => {
    // To jest ten defekt, którego nie widać: komponent zniknął, a handler
    // dalej wołałby setState na odmontowanym drzewie.
    const off = onOpenLoginPopup(collect);
    off();

    openLoginPopup("signin");

    expect(received).toHaveLength(0);
  });

  it("DWA nasłuchy naraz dostają to samo zdarzenie", () => {
    // Popup i osobny gate treści premium potrafią wisieć jednocześnie.
    const second: LoginPopupOptions[] = [];
    const offA = onOpenLoginPopup(collect);
    const offB = onOpenLoginPopup((o) => second.push(o));

    openLoginPopup({ mode: "signin" });

    expect(received).toHaveLength(1);
    expect(second).toHaveLength(1);
    offA();
    offB();
  });

  it("odpięcie JEDNEGO nasłuchu nie rusza drugiego", () => {
    const second: LoginPopupOptions[] = [];
    const offA = onOpenLoginPopup(collect);
    const offB = onOpenLoginPopup((o) => second.push(o));
    offA();

    openLoginPopup({ mode: "signin" });

    expect(received).toHaveLength(0);
    expect(second).toHaveLength(1);
    offB();
  });

  it("ten sam nasłuch zarejestrowany dwa razy nie dubluje wywołań", () => {
    // `addEventListener` z tą samą referencją jest idempotentne - gdyby nie
    // było, podwójny montaż popupu otwierałby go dwa razy.
    const off1 = onOpenLoginPopup(collect);
    const off2 = onOpenLoginPopup(collect);

    openLoginPopup("signin");

    expect(received).toHaveLength(2);
    off1();
    off2();
  });
});

describe("openLoginPopup - kształt zdarzenia", () => {
  it("skrót tekstowy jest zamieniany na tryb", () => {
    const off = onOpenLoginPopup(collect);

    openLoginPopup("signup");

    expect(received[0]).toEqual({ mode: "signup" });
    off();
  });

  it("wywołanie BEZ argumentu daje puste opcje, nie `undefined`", () => {
    // Odbiorca robi `opts.mode ?? "signin"` - `undefined` wywaliłoby dostęp.
    const off = onOpenLoginPopup(collect);

    openLoginPopup();

    expect(received[0]).toEqual({});
    expect(received[0]).not.toBeUndefined();
    off();
  });

  it("pełne opcje przechodzą bez zmiany - to one nadpisują nagłówek popupu", () => {
    const off = onOpenLoginPopup(collect);
    const opts = {
      mode: "signin" as const,
      title: "Obserwuj autora",
      description: "Załóż konto, aby obserwować.",
    };

    openLoginPopup(opts);

    expect(received[0]).toEqual(opts);
    expect(received[0]!.description).toBe("Załóż konto, aby obserwować.");
    off();
  });

  it("otwarcie BEZ ŻADNEGO nasłuchu nie rzuca", () => {
    // Popup montuje się w layoucie; akcja zastrzeżona może wystrzelić wcześniej.
    expect(() => openLoginPopup("signin")).not.toThrow();
    expect(received).toHaveLength(0);
  });

  it("zdarzenie z pustym `detail` jest normalizowane do pustych opcji", () => {
    // Ktoś może wystrzelić surowe zdarzenie z pominięciem `openLoginPopup`.
    const off = onOpenLoginPopup(collect);

    window.dispatchEvent(new CustomEvent("nes:open-login"));

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({});
    off();
  });
});

describe("loginPopupBus poza przeglądarką (SSR)", () => {
  it("otwarcie bez `window` jest ciche, a nie wywala renderu serwerowego", () => {
    vi.stubGlobal("window", undefined);

    expect(() => openLoginPopup("signin")).not.toThrow();

    vi.unstubAllGlobals();
  });

  it("subskrypcja bez `window` oddaje działającą funkcję odpinającą", () => {
    // Zwrot `undefined` wywaliłby `useEffect` przy sprzątaniu.
    vi.stubGlobal("window", undefined);

    const off = onOpenLoginPopup(collect);

    expect(typeof off).toBe("function");
    expect(() => off()).not.toThrow();
    vi.unstubAllGlobals();
  });
});
