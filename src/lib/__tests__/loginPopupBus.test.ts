// Magistrala otwierania popupu logowania: jedyny sposób, w jaki „kliknij
// zakładkę / obserwuj / zapisz artykuł" dogaduje się z globalnym `LoginPopup`,
// bez przewlekania propsów przez cały layout. Modułowa stała `EVENT` NIE jest
// eksportowana, więc nazwa zdarzenia jest w praktyce niewidzialnym kontraktem
// między nadawcą i odbiorcą - jeśli rozjedzie się w jednej z dwóch funkcji,
// klik w CTA przestaje cokolwiek robić i nikt tego nie zauważy, bo nic nie
// rzuca. Dlatego testy tu dowodzą trzech rzeczy: kształtu `detail`, wspólnej
// nazwy zdarzenia oraz strażników SSR (te ostatnie chronią przed BIAŁYM
// EKRANEM przy renderowaniu na serwerze, gdzie `window` nie istnieje).
import { afterEach, describe, expect, it, vi } from "vitest";
import { onOpenLoginPopup, openLoginPopup, type LoginPopupOptions } from "@/lib/loginPopupBus";

const EVENT_NAME = "nes:open-login";

// Nasłuch przez publiczne API magistrali: to, co zobaczy prawdziwy
// `LoginPopup`, czyli `detail` już po zabezpieczeniu `?? {}` w listenerze.
function recordViaBus() {
  const received: LoginPopupOptions[] = [];
  const off = onOpenLoginPopup((opts) => {
    received.push(opts);
  });
  return { received, off };
}

// Surowy nasłuch na DOM - potrzebny tylko tam, gdzie asercja dotyczy tego, co
// NADAWCA włożył do `detail` (listener magistrali podmienia brak na `{}`, więc
// przez niego nie da się odróżnić `detail: {}` od `detail: undefined`).
// `detail` trzymamy jako `unknown`, żeby nie wciągać `any` z lib.dom.
function recordRawDetails() {
  const details: unknown[] = [];
  const listener = (event: Event) => {
    if (event instanceof CustomEvent) {
      const detail: unknown = event.detail;
      details.push(detail);
    }
  };
  window.addEventListener(EVENT_NAME, listener);
  return { details, off: () => window.removeEventListener(EVENT_NAME, listener) };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("openLoginPopup - skrót łańcuchowy", () => {
  it('łańcuch "signup" trafia do detail.mode (formularz rejestracji)', () => {
    const { received, off } = recordViaBus();
    openLoginPopup("signup");
    expect(received).toEqual([{ mode: "signup" }]);
    off();
  });

  it('łańcuch "signin" trafia do detail.mode (formularz logowania)', () => {
    const { received, off } = recordViaBus();
    openLoginPopup("signin");
    expect(received).toEqual([{ mode: "signin" }]);
    off();
  });
});

describe("openLoginPopup - pełne opcje", () => {
  it("przenosi WSZYSTKIE TRZY pola: mode, title i description", () => {
    const { received, off } = recordViaBus();
    // Kontekst „akcja zastrzeżona": popup ma pokazać własny nagłówek
    // („Zapisz artykuł"), a nie generyczne „Zaloguj się".
    openLoginPopup({
      mode: "signup",
      title: "authForms.restrictedTitle",
      description: "authForms.restrictedDescription",
    });
    expect(received).toEqual([
      {
        mode: "signup",
        title: "authForms.restrictedTitle",
        description: "authForms.restrictedDescription",
      },
    ]);
    off();
  });

  it("obiekt bez mode przechodzi jak jest - popup decyduje o domyślnej zakładce", () => {
    const { received, off } = recordViaBus();
    openLoginPopup({ title: "authForms.restrictedTitle" });
    expect(received).toEqual([{ title: "authForms.restrictedTitle" }]);
    off();
  });
});

describe("openLoginPopup - brak argumentu", () => {
  it("wywołanie bez argumentu daje detail === {}, NIE undefined", () => {
    const raw = recordRawDetails();
    openLoginPopup();
    // Gałąź `arg ?? {}`. Gdyby przeszło `undefined`, odbiorcy sięgający po
    // `detail.mode` bez zabezpieczenia dostaliby wyjątek w listenerze.
    expect(raw.details).toEqual([{}]);
    raw.off();
  });

  it("jawne undefined zachowuje się identycznie jak brak argumentu", () => {
    const raw = recordRawDetails();
    openLoginPopup(undefined);
    expect(raw.details).toEqual([{}]);
    raw.off();
  });

  it("odbiorca magistrali widzi wtedy pusty obiekt opcji", () => {
    const { received, off } = recordViaBus();
    openLoginPopup();
    expect(received).toEqual([{}]);
    off();
  });
});

describe("onOpenLoginPopup - odporność na zdarzenie bez detail", () => {
  it("zwykły Event (bez detail) daje handlerowi {}, nie undefined", () => {
    const handler = vi.fn();
    const off = onOpenLoginPopup(handler);
    // Tak wygląda zdarzenie wysłane „z ręki" przez kod, który nie zna
    // magistrali - np. skrypt zewnętrzny albo starszy komponent.
    window.dispatchEvent(new Event(EVENT_NAME));
    expect(handler).toHaveBeenCalledWith({});
    off();
  });

  it("CustomEvent bez detail również ląduje jako {} (gałąź ?? {})", () => {
    const handler = vi.fn();
    const off = onOpenLoginPopup(handler);
    window.dispatchEvent(new CustomEvent(EVENT_NAME));
    expect(handler).toHaveBeenCalledWith({});
    off();
  });

  it("detail: null też jest zamieniane na {}", () => {
    const handler = vi.fn();
    const off = onOpenLoginPopup(handler);
    window.dispatchEvent(new CustomEvent<LoginPopupOptions | null>(EVENT_NAME, { detail: null }));
    expect(handler).toHaveBeenCalledWith({});
    off();
  });
});

describe("onOpenLoginPopup - cykl życia nasłuchu", () => {
  it("każdy zamontowany odbiorca dostaje to samo żądanie", () => {
    const first = vi.fn();
    const second = vi.fn();
    const offFirst = onOpenLoginPopup(first);
    const offSecond = onOpenLoginPopup(second);

    openLoginPopup("signin");

    expect(first).toHaveBeenCalledWith({ mode: "signin" });
    expect(second).toHaveBeenCalledWith({ mode: "signin" });
    offFirst();
    offSecond();
  });

  it("zwrócona funkcja FAKTYCZNIE odsubskrybowuje", () => {
    // To jest wyciek, którego nie widać, dopóki ktoś nie zamontuje popupu
    // dwadzieścia razy: gdyby cleanup nie zdejmował listenera, każdy kolejny
    // mount dokładałby handler i jeden klik otwierałby popup wielokrotnie,
    // a stare handlery trzymałyby w pamięci odmontowane drzewa Reacta.
    const handler = vi.fn();
    const off = onOpenLoginPopup(handler);
    off();

    openLoginPopup("signup");

    expect(handler).not.toHaveBeenCalled();
  });

  it("odsubskrybowanie jednego odbiorcy nie zdejmuje pozostałych", () => {
    const staying = vi.fn();
    const leaving = vi.fn();
    const offStaying = onOpenLoginPopup(staying);
    const offLeaving = onOpenLoginPopup(leaving);
    offLeaving();

    openLoginPopup("signin");

    expect(staying).toHaveBeenCalledTimes(1);
    expect(leaving).not.toHaveBeenCalled();
    offStaying();
  });

  it("wielokrotne wywołanie cleanupu jest bezpieczne", () => {
    const handler = vi.fn();
    const off = onOpenLoginPopup(handler);
    off();
    expect(() => off()).not.toThrow();
    openLoginPopup("signin");
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("wspólna nazwa zdarzenia", () => {
  it("nasłuch z onOpenLoginPopup słyszy emisję z openLoginPopup", () => {
    // Jedyna rzecz, która trzyma tę magistralę razem: stała EVENT nie jest
    // eksportowana, więc rozjazd nazwy w jednej z funkcji jest niewidoczny
    // dla typów i nic nie rzuca - klik po prostu przestaje działać.
    const { received, off } = recordViaBus();
    openLoginPopup({ mode: "signup", title: "authForms.noAccount" });
    expect(received).toHaveLength(1);
    off();
  });

  it('emisja pod literalną nazwą "nes:open-login" dochodzi do odbiorcy', () => {
    const { received, off } = recordViaBus();
    window.dispatchEvent(
      new CustomEvent<LoginPopupOptions>(EVENT_NAME, { detail: { mode: "signin" } }),
    );
    expect(received).toEqual([{ mode: "signin" }]);
    off();
  });

  it("openLoginPopup emituje POD TĄ nazwą i pod żadną inną", () => {
    // Podglądamy REALNY typ wysłanego zdarzenia, a nie brak reakcji jednego
    // strażnika-atrapy: nasłuch na zmyśloną nazwę broniłby wyłącznie przed
    // dispatchem dokładnie pod tą zmyśloną nazwą, więc przy `"nes:login"`
    // czy `"nes:open-login2"` w produkcji nadal byłby zielony - a nazwa testu
    // obiecuje „i pod żadną inną".
    // `vi.restoreAllMocks()` w `afterEach` zdejmuje ten szpieg.
    const spy = vi.spyOn(window, "dispatchEvent");

    openLoginPopup("signup");

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0].type).toBe(EVENT_NAME);
  });
});

describe("strażniki SSR (brak window)", () => {
  // Pod happy-dom `window` jest globalne, więc podmieniamy je na undefined -
  // `typeof window === "undefined"` staje się wtedy prawdziwe w module,
  // dokładnie jak podczas renderowania na serwerze. Do stubGlobal przekazujemy
  // po prostu `undefined` (bez rzutowań), a afterEach przywraca prawdziwe okno.
  it("openLoginPopup wychodzi cicho, bez wyjątku", () => {
    vi.stubGlobal("window", undefined);
    expect(typeof window).toBe("undefined");
    // Nieprzetestowany strażnik = wyjątek w renderze serwerowym, czyli BIAŁY
    // EKRAN dla użytkownika, a nie tylko niedziałający popup.
    expect(() => openLoginPopup("signup")).not.toThrow();
    expect(() => openLoginPopup()).not.toThrow();
    expect(() => openLoginPopup({ mode: "signin", title: "authForms.noAccount" })).not.toThrow();
  });

  it("onOpenLoginPopup zwraca WYWOŁYWALNY cleanup zamiast undefined", () => {
    vi.stubGlobal("window", undefined);
    // Strażnik symetryczny do testu wyżej i NIEZBĘDNY: gdyby `stubGlobal`
    // przestało działać, `onOpenLoginPopup` zarejestrowałoby prawdziwy nasłuch,
    // `typeof cleanup` nadal byłoby "function", `cleanup()` nadal by nie
    // rzuciło - i test przeszedłby na zielono, NIE badając strażnika SSR
    // w ogóle. Bez tej linii nie wiadomo, czy testujemy tę gałąź, co trzeba.
    expect(typeof window).toBe("undefined");
    const handler = vi.fn();
    const cleanup = onOpenLoginPopup(handler);
    expect(typeof cleanup).toBe("function");
    // useEffect wywoła to przy odmontowaniu - `undefined()` wysypałoby aplikację.
    expect(() => cleanup()).not.toThrow();
  });

  it("po przywróceniu window magistrala znów działa (stub nie jest trwały)", () => {
    const { received, off } = recordViaBus();
    openLoginPopup("signin");
    expect(received).toEqual([{ mode: "signin" }]);
    off();
  });
});
