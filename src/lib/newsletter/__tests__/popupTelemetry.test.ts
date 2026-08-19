// Klient telemetrii popupu newslettera.
//
// PO CO. Ten moduł odpowiada za dwie rzeczy, których pomyłka jest cicha:
//   1. IDENTYFIKATOR SESJI spina zdarzenia jednej wizyty (wyświetlenie ->
//      wysłanie -> sukces). Nowy identyfikator przy każdym zdarzeniu rozsypuje
//      raport: skuteczność zapisu spada do zera, choć popup działa. Sesja żyje w
//      `sessionStorage`, bez cookie i bez identyfikatora osoby.
//   2. FIRE-AND-FORGET. Żaden błąd telemetrii nie może zablokować ani opóźnić
//      ZAPISU DO NEWSLETTERA - wyjątek z wysyłki zdarzenia zabrałby
//      odwiedzającemu subskrypcję, dla której przyszedł.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({
  calls: [] as Array<Record<string, unknown>>,
  reject: false,
}));

vi.mock("@/lib/newsletter-popup-events.functions", () => ({
  NEWSLETTER_POPUP_EVENTS: ["impression", "open", "submit", "success", "error"],
  logNewsletterPopupEvent: (input: { data: Record<string, unknown> }) => {
    h.calls.push(input.data);
    return h.reject ? Promise.reject(new Error("telemetria padla")) : Promise.resolve({ ok: true });
  },
}));

import {
  newsletterPopupSessionId,
  trackNewsletterPopupEvent,
} from "@/lib/newsletter/popupTelemetry";

const SESSION_KEY = "nes:nl-popup-session";

/**
 * Podmienia `window.sessionStorage` na atrapę na czas jednego przypadku.
 *
 * `vi.spyOn(window.sessionStorage, ...)` nie daje się tu odkręcić - magazyn
 * happy-dom jest Proxy i `restoreAllMocks()` zostawia atrapę na miejscu, więc
 * jeden test zatruwał następny (i przechodził z niewłaściwego powodu).
 */
function withStorage(fake: Partial<Storage>, body: () => void): void {
  const original = Object.getOwnPropertyDescriptor(window, "sessionStorage");
  Object.defineProperty(window, "sessionStorage", {
    value: { getItem: () => null, setItem: () => {}, clear: () => {}, ...fake },
    configurable: true,
  });
  try {
    body();
  } finally {
    if (original) Object.defineProperty(window, "sessionStorage", original);
    else delete (window as unknown as Record<string, unknown>).sessionStorage;
  }
}

beforeEach(() => {
  h.calls = [];
  h.reject = false;
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => {
  window.sessionStorage.clear();
});

// ---------------------------------------------------------------------------
describe("identyfikator sesji", () => {
  it("jest STABILNY w obrębie wizyty", () => {
    // Nowy identyfikator przy każdym zdarzeniu rozsypuje raport: wysłania nie
    // dają się połączyć z wyświetleniami, a skuteczność spada do zera.
    const first = newsletterPopupSessionId();
    const second = newsletterPopupSessionId();

    expect(first).toBe(second);
    expect(first.length).toBeGreaterThan(4);
  });

  it("jest zapisany w sessionStorage, nie w cookie", () => {
    // Cookie wymagałoby zgody na ciasteczka, a telemetria popupu nie identyfikuje
    // osoby - liczy zdarzenia jednej wizyty.
    const id = newsletterPopupSessionId();

    expect(window.sessionStorage.getItem(SESSION_KEY)).toBe(id);
    expect(document.cookie).not.toContain(id);
  });

  it("istniejąca sesja jest ODCZYTYWANA, nie nadpisywana", () => {
    window.sessionStorage.setItem(SESSION_KEY, "sesja-z-wczesniej");

    expect(newsletterPopupSessionId()).toBe("sesja-z-wczesniej");
    // ...a w magazynie nadal stoi ta sama wartość, nie świeżo wygenerowana.
    expect(window.sessionStorage.getItem(SESSION_KEY)).toBe("sesja-z-wczesniej");
  });

  it("bez `crypto.randomUUID` nadal daje identyfikator", () => {
    // W kontekście bez HTTPS `randomUUID` NIE ISTNIEJE - podmieniamy więc cały
    // obiekt `crypto` bez tej metody, a nie samą wartość na `undefined`
    // (własność nadal by istniała i warunek `"randomUUID" in crypto` przepuścił
    // wywołanie, czyli test sprawdzałby zupełnie inną ścieżkę).
    vi.stubGlobal("crypto", {});
    try {
      const id = newsletterPopupSessionId();

      expect(id).toMatch(/^s-\d+-/);
      expect(window.sessionStorage.getItem(SESSION_KEY)).toBe(id);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("ZABLOKOWANY sessionStorage nie wywala się - oddaje wartość zastępczą", () => {
    // Prywatny tryb przeglądarki i polityki firmowe potrafią rzucić na sam
    // dostęp do magazynu; wyjątek tutaj przewróciłby cały popup.
    const proby: string[] = [];
    withStorage(
      {
        getItem: () => {
          proby.push("getItem");
          throw new Error("brak dostepu");
        },
      },
      () => {
        expect(newsletterPopupSessionId()).toBe("no-storage");
        // Wartość zastępcza jest STAŁA - inaczej każde zdarzenie jednej wizyty
        // miałoby inną sesję i raport rozsypałby się tak samo jak bez magazynu.
        expect(newsletterPopupSessionId()).toBe("no-storage");
        expect(proby).toEqual(["getItem", "getItem"]);
      },
    );
  });

  it("awaria ZAPISU do magazynu też schodzi na wartość zastępczą", () => {
    // Odczyt DZIAŁA, wywraca się dopiero zapis - inaczej test przechodziłby,
    // nawet gdyby moduł w ogóle nie próbował nic zapisać.
    const zapisy: string[] = [];
    withStorage(
      {
        getItem: () => null,
        setItem: (key: string) => {
          zapisy.push(key);
          throw new Error("quota");
        },
      },
      () => {
        expect(newsletterPopupSessionId()).toBe("no-storage");
        expect(zapisy).toEqual([SESSION_KEY]);
      },
    );
  });
});

describe("render po stronie serwera", () => {
  it("BEZ okna sesja schodzi na „ssr” - magazyn przeglądarki nie istnieje", () => {
    // Moduł jest importowany też w renderze serwerowym; dotknięcie
    // `sessionStorage` wywaliłoby cały render strony.
    vi.stubGlobal("window", undefined);
    try {
      expect(newsletterPopupSessionId()).toBe("ssr");
      // „ssr" to nie to samo co „no-storage" - rozróżnienie widać w raporcie.
      expect(newsletterPopupSessionId()).not.toBe("no-storage");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("BEZ okna zdarzenie NIE jest wysyłane", () => {
    // Serwer nie ma wizyty do policzenia - zdarzenie stąd zatruwałoby raport.
    vi.stubGlobal("window", undefined);
    try {
      trackNewsletterPopupEvent({ event: "impression", lang: "pl" });
      trackNewsletterPopupEvent({ event: "success", lang: "pl" });

      expect(h.calls).toHaveLength(0);
      expect(h.calls).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

// ---------------------------------------------------------------------------
describe("wysyłka zdarzenia", () => {
  it("dokłada identyfikator sesji do ładunku", () => {
    trackNewsletterPopupEvent({ event: "impression", lang: "pl" });

    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]!.sessionId).toBe(newsletterPopupSessionId());
  });

  it("przekazuje WSZYSTKIE pola zdarzenia bez zmian", () => {
    trackNewsletterPopupEvent({
      event: "error",
      lang: "en",
      layout: "showcase",
      source: "footer",
      variant: "b",
      errorCode: "rate-limited",
      meta: { plan: "pro" },
    });

    expect(h.calls[0]).toMatchObject({
      event: "error",
      lang: "en",
      layout: "showcase",
      source: "footer",
      variant: "b",
      errorCode: "rate-limited",
      meta: { plan: "pro" },
    });
    // Identyfikator sesji jest DOKŁADANY przez moduł, nie przez wywołującego.
    expect(h.calls[0]!.sessionId).toBe(newsletterPopupSessionId());
  });

  it("kolejne zdarzenia jednej wizyty mają TĘ SAMĄ sesję", () => {
    // Na tym stoi cały raport: wyświetlenie, wysłanie i sukces muszą dać się
    // policzyć jako jedna ścieżka.
    trackNewsletterPopupEvent({ event: "impression", lang: "pl" });
    trackNewsletterPopupEvent({ event: "submit", lang: "pl" });
    trackNewsletterPopupEvent({ event: "success", lang: "pl" });

    const sesje = new Set(h.calls.map((c) => c.sessionId));
    expect(h.calls).toHaveLength(3);
    expect(sesje.size).toBe(1);
  });

  it("AWARIA wysyłki nie rzuca wyjątkiem - zapis do newslettera nie może paść", async () => {
    // To jest sedno: wyjątek stąd zabrałby odwiedzającemu subskrypcję, po którą
    // przyszedł.
    h.reject = true;

    expect(() => trackNewsletterPopupEvent({ event: "submit", lang: "pl" })).not.toThrow();
    await Promise.resolve();
    expect(h.calls).toHaveLength(1);
  });

  it("awaria jednego zdarzenia nie blokuje następnych", async () => {
    h.reject = true;
    trackNewsletterPopupEvent({ event: "submit", lang: "pl" });
    await Promise.resolve();

    h.reject = false;
    trackNewsletterPopupEvent({ event: "success", lang: "pl" });

    expect(h.calls).toHaveLength(2);
    expect(h.calls[1]!.event).toBe("success");
  });
});
