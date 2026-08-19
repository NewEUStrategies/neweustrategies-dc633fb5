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
    vi.spyOn(window.sessionStorage, "getItem").mockImplementation(() => {
      throw new Error("brak dostepu");
    });

    expect(newsletterPopupSessionId()).toBe("no-storage");
  });

  it("awaria ZAPISU do magazynu też schodzi na wartość zastępczą", () => {
    vi.spyOn(window.sessionStorage, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });

    expect(newsletterPopupSessionId()).toBe("no-storage");
  });
});

describe("render po stronie serwera", () => {
  it("BEZ okna sesja schodzi na „ssr” - magazyn przeglądarki nie istnieje", () => {
    // Moduł jest importowany też w renderze serwerowym; dotknięcie
    // `sessionStorage` wywaliłoby cały render strony.
    vi.stubGlobal("window", undefined);
    try {
      expect(newsletterPopupSessionId()).toBe("ssr");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("BEZ okna zdarzenie NIE jest wysyłane", () => {
    // Serwer nie ma wizyty do policzenia - zdarzenie stąd zatruwałoby raport.
    vi.stubGlobal("window", undefined);
    try {
      trackNewsletterPopupEvent({ event: "impression", lang: "pl" });

      expect(h.calls).toHaveLength(0);
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
