// Kupon rabatowy (CouponWidgetView) i licznik subskrybentów (useSubscriberCount).
//
// DWA WIDGETY, KTÓRE SIĘGAJĄ POZA DOKUMENT - i dlatego mieszkają w osobnym
// pliku: kupon rozmawia ze SCHOWKIEM przeglądarki, a społeczny dowód z BAZĄ.
// Oba mają własne atrapy i własny zegar, więc trzymanie ich razem z czystym
// renderem widgetów zamieniłoby tamten plik w plik o atrapach.
//
// MAILA NIE DA SIĘ WYCOFAĆ, WIĘC LICZBA W MAILU JEST OBIETNICĄ. „Już 12 345
// osób czyta" wysłane do dwudziestu tysięcy skrzynek zostaje w nich na zawsze -
// także wtedy, gdy liczba wzięła się z nieudanego odczytu. Stąd osobny dowód
// na to, co widget pokazuje, gdy baza milczy, gdy odmawia i gdy naprawdę
// nikogo jeszcze nie ma.
//
// SCHOWEK JEST ATRAPĄ. Żaden test nie dotyka prawdziwego schowka maszyny CI,
// a odmowa zapisu (starsza przeglądarka, brak uprawnień) nie ma prawa wywalić
// widgetu ani skłamać, że kod został skopiowany.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

import type { NlDoc, NlLang, NlWidget } from "@/lib/newsletter-builder/types";
import type { NewsletterSettings } from "@/hooks/useNewsletterSettings";

const h = vi.hoisted(() => ({
  /** Odpowiedź zliczania subskrybentów: `count` + błąd RLS. */
  count: null as number | null,
  countError: null as { message: string } | null,
  /** Gdy ustawione, zapytanie do bazy ODRZUCA (awaria sieci, nie polityka). */
  countRejects: null as Error | null,
  /** Ile razy renderer sięgnął do bazy - dowód, że zapytanie jest warunkowe. */
  fromCalls: [] as string[],
  /** Surowy HTML, który renderer oddał do oczyszczenia. */
  sanitized: [] as string[],
}));

vi.mock("@/integrations/supabase/client", () => {
  interface CountChain extends PromiseLike<{
    count: number | null;
    error: { message: string } | null;
  }> {
    select: () => CountChain;
    eq: () => CountChain;
  }
  const chain: CountChain = {
    select: () => chain,
    eq: () => chain,
    then: (onFulfilled, onRejected) =>
      (h.countRejects !== null
        ? Promise.reject(h.countRejects)
        : Promise.resolve({ count: h.count, error: h.countError })
      ).then(onFulfilled, onRejected),
  };
  return {
    supabase: {
      from: (table: string) => {
        h.fromCalls.push(table);
        return chain;
      },
    },
  };
});

// Atrapa oczyszczania HTML zapisuje WEJŚCIE - inaczej nie da się odróżnić
// „renderer przepuścił HTML przez sanitizer" od „HTML był akurat nieszkodliwy".
vi.mock("@/lib/sanitize", () => ({
  sanitizeHtml: (dirty: string) => {
    h.sanitized.push(dirty);
    return dirty.replace(/<script[\s\S]*?<\/script>/gi, "");
  },
}));

vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: (fn: unknown) => fn,
}));

vi.mock("@/lib/newsletter.functions", () => ({
  subscribeToNewsletter: () => Promise.resolve({ ok: true, status: "pending" }),
}));

import { NewsletterDocRenderer } from "@/components/newsletter/NewsletterDocRenderer";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import {
  makeCoupon,
  makeHeading,
  makeSettings,
  makeSingleSectionDoc,
  makeSocialProof,
  resetDocIds,
} from "./docFixtures";

const NOW = new Date("2026-08-22T10:00:00.000Z");

const clipboard = vi.hoisted(() => ({ writeText: vi.fn<(text: string) => Promise<void>>() }));

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
  resetDocIds();
  h.count = null;
  h.countError = null;
  h.countRejects = null;
  h.fromCalls = [];
  h.sanitized = [];
  clipboard.writeText.mockReset();
  clipboard.writeText.mockResolvedValue(undefined);
  // ŻADNEGO PRAWDZIWEGO SCHOWKA: happy-dom nie ma uprawnień przeglądarki,
  // a test, który sięga po systemowy schowek, kradnie zawartość maszyny CI.
  Object.defineProperty(navigator, "clipboard", { value: clipboard, configurable: true });
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

function mount(
  widgets: NlWidget[],
  opts: { lang?: NlLang; settings?: NewsletterSettings; doc?: NlDoc } = {},
) {
  return renderWithQueryClient(
    <NewsletterDocRenderer
      doc={opts.doc ?? makeSingleSectionDoc(widgets)}
      settings={opts.settings ?? makeSettings()}
      lang={opts.lang ?? "pl"}
    />,
  );
}

function el(selector: string): HTMLElement {
  const node = document.querySelector(selector);
  if (!(node instanceof HTMLElement)) throw new Error(`test: brak elementu ${selector}`);
  return node;
}

// ---------------------------------------------------------------------------
// Kupon (CouponWidgetView)
// ---------------------------------------------------------------------------

describe("kupon rabatowy", () => {
  // UWAGA DO ZAKRESU: `NlCouponWidget` nie ma pola terminu ważności (kod,
  // etykieta, etykieta po skopiowaniu, styl, akcent). Kupon „wygasły" nie da
  // się więc wyrazić w dokumencie i nie ma czego tu dowodzić - wygasanie musi
  // być pilnowane po stronie kodu rabatowego, nie renderera.
  const copyButton = (): HTMLElement => {
    const button = [...document.querySelectorAll("button")].find(
      (b) => b.textContent === "Kopiuj" || b.textContent === "Skopiowano",
    );
    if (!button) throw new Error("test: brak przycisku kopiowania");
    return button;
  };

  it("kod i etykieta z panelu są widoczne w mailu", () => {
    mount([makeCoupon({ code: "BRUKSELA20", label: { pl: "Twoj kod", en: "Your code" } })]);

    expect(screen.getByText("BRUKSELA20")).toBeInTheDocument();
    expect(screen.getByText("Twoj kod")).toBeInTheDocument();
  });

  it("kliknięcie „Kopiuj” wkłada do schowka DOKŁADNIE kod kuponu", () => {
    mount([makeCoupon({ code: "BRUKSELA20" })]);

    fireEvent.click(copyButton());

    expect(clipboard.writeText).toHaveBeenCalledTimes(1);
    expect(clipboard.writeText).toHaveBeenCalledWith("BRUKSELA20");
  });

  it("po skopiowaniu przycisk potwierdza to słowem - bez tego nie wiadomo, czy zadziałało", async () => {
    mount([makeCoupon({ copiedLabel: { pl: "Skopiowano", en: "Copied" } })]);

    fireEvent.click(copyButton());

    await waitFor(() => expect(copyButton().textContent).toBe("Skopiowano"));
  });

  it("potwierdzenie znika po dwóch sekundach, więc kod da się skopiować drugi raz", async () => {
    mount([makeCoupon()]);
    fireEvent.click(copyButton());
    await waitFor(() => expect(copyButton().textContent).toBe("Skopiowano"));

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(copyButton().textContent).toBe("Kopiuj");
  });

  it("potwierdzenie NIE znika przed czasem - sekunda to za mało na przeczytanie", async () => {
    mount([makeCoupon()]);
    fireEvent.click(copyButton());
    await waitFor(() => expect(copyButton().textContent).toBe("Skopiowano"));

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(copyButton().textContent).toBe("Skopiowano");
  });

  it("odmowa zapisu do schowka nie wywala widgetu ani nie kłamie, że skopiowano", async () => {
    clipboard.writeText.mockRejectedValue(new Error("NotAllowedError"));
    mount([makeCoupon({ code: "BRUKSELA20" })]);

    fireEvent.click(copyButton());
    await act(async () => {});

    expect(screen.getByText("BRUKSELA20")).toBeInTheDocument();
    expect(copyButton().textContent).toBe("Kopiuj");
  });

  it("angielska wersja kuponu potwierdza kopiowanie po angielsku", async () => {
    mount([makeCoupon()], { lang: "en" });
    const button = [...document.querySelectorAll("button")].find((b) => b.textContent === "Copy");
    expect(button).toBeDefined();

    fireEvent.click(button!);

    await waitFor(() => expect(button!.textContent).toBe("Copied"));
  });

  it("styl „boxed” ma ramkę ciągłą, a domyślny przerywaną - to widoczna różnica w mailu", () => {
    mount([makeCoupon({ style: "boxed", accent: "#ff00ff" })]);
    const boxed = el(".rounded-lg");
    expect(boxed.className).not.toContain("border-dashed");
    expect(boxed.style.borderColor).toBe("#ff00ff");

    cleanup();
    mount([makeCoupon({ style: "dashed" })]);
    expect(el(".rounded-lg").className).toContain("border-dashed");
    expect(el(".rounded-lg").style.borderColor).toBe("var(--primary)");
  });

  it("kupon bez kodu kopiuje pustkę - przycisk nie udaje, że coś dał", () => {
    // STAN FAKTYCZNY: renderer nie ukrywa kuponu bez kodu ani nie blokuje
    // przycisku. KONSEKWENCJA: odbiorca klika „Kopiuj”, dostaje potwierdzenie
    // i wkleja pusty ciąg w koszyku. Walidacja musi stać w panelu.
    mount([makeCoupon({ code: "" })]);

    fireEvent.click(copyButton());

    expect(clipboard.writeText).toHaveBeenCalledWith("");
  });
});

// ---------------------------------------------------------------------------
// Licznik subskrybentów (useSubscriberCount) przez widget social-proof
// ---------------------------------------------------------------------------

describe("licznik subskrybentów", () => {
  it("dokument bez widgetu społecznego dowodu w ogóle nie pyta bazy o liczbę zapisanych", async () => {
    mount([makeHeading()]);

    await act(async () => {});

    expect(h.fromCalls).toEqual([]);
  });

  it("liczba z bazy zastępuje `{count}` w treści widgetu", async () => {
    h.count = 12345;
    mount([makeSocialProof({ text: { pl: "Juz {count} osob czyta", en: "{count} readers" } })]);

    await waitFor(() => expect(screen.getByText(/12/)).toBeInTheDocument());
    expect(el(".text-muted-foreground").textContent).toMatch(
      /^Juz 12[\s\u00a0\u202f]345 osob czyta$/,
    );
    expect(h.fromCalls).toEqual(["newsletter_subscribers"]);
  });

  it("liczba jest formatowana po angielsku na angielskiej wersji dokumentu", async () => {
    h.count = 12345;
    mount([makeSocialProof({ text: { pl: "{count} czyta", en: "{count} readers" } })], {
      lang: "en",
    });

    await waitFor(() => expect(el(".text-muted-foreground").textContent).toBe("12,345 readers"));
  });

  it("dopóki baza nie odpowie, widget pokazuje liczbę zapasową z panelu, a nie zero", () => {
    h.count = 999;
    mount([makeSocialProof({ fallbackCount: 2500, text: { pl: "{count} osob", en: "{count}" } })]);

    expect(el(".text-muted-foreground").textContent).toBe("2500 osob");
  });

  it("widget bez liczby zapasowej pokazuje zero, zanim baza odpowie", () => {
    mount([makeSocialProof({ text: { pl: "{count} osob", en: "{count}" } })]);

    expect(el(".text-muted-foreground").textContent).toBe("0 osob");
  });

  it("dwa widgety społecznego dowodu pytają bazę raz - jedna wysyłka to jedno zapytanie", async () => {
    h.count = 7;
    mount([makeSocialProof(), makeSocialProof()]);

    await waitFor(() => expect(h.fromCalls.length).toBeGreaterThan(0));
    await act(async () => {});

    expect(h.fromCalls).toEqual(["newsletter_subscribers"]);
  });

  it("wyrównanie z panelu decyduje o pozycji tekstu, domyślnie wyśrodkowanego", () => {
    mount([makeSocialProof({ align: "right" }), makeSocialProof()]);

    const teksty = document.querySelectorAll(".text-muted-foreground");
    expect(teksty[0].getAttribute("style")).toContain("right");
    expect(teksty[1].getAttribute("style")).toContain("center");
  });

  it("awaria sieci przy zliczaniu zostawia liczbę zapasową z panelu - mail nie pokazuje zera", async () => {
    h.countRejects = new Error("network down");
    mount([makeSocialProof({ fallbackCount: 2500, text: { pl: "{count} osob", en: "{count}" } })]);

    await waitFor(() => expect(h.fromCalls.length).toBeGreaterThan(0));
    await act(async () => {});

    expect(el(".text-muted-foreground").textContent).toBe("2500 osob");
  });

  it.fails(
    "zablokowany odczyt liczby POWINIEN dać inną treść niż prawdziwe zero subskrybentów",
    async () => {
      // DEFEKT, NIE BRAK TESTU. `useSubscriberCount` czyta `count` z odpowiedzi
      // i robi `count ?? 0`, a błąd polityki RLS przychodzi jako `count: null`
      // Z POPRAWNĄ odpowiedzią - nie jako wyjątek. Zliczanie zablokowane przez
      // RLS jest więc nieodróżnialne od stanu „nikt się jeszcze nie zapisał".
      // KONSEKWENCJA: w mailu do dwudziestu tysięcy skrzynek staje zdanie
      // „Już 0 osób czyta" - i nie da się go wycofać. Naprawa wymaga
      // przekazania stanu błędu z hooka do widgetu (zmiana kodu produkcyjnego).
      h.count = 0;
      mount([makeSocialProof({ text: { pl: "Juz {count} osob czyta", en: "{count}" } })]);
      await waitFor(() => expect(h.fromCalls.length).toBeGreaterThan(0));
      await act(async () => {});
      const prawdziweZero = el(".text-muted-foreground").textContent;

      cleanup();
      h.count = null;
      h.countError = { message: "permission denied for table newsletter_subscribers" };
      mount([makeSocialProof({ text: { pl: "Juz {count} osob czyta", en: "{count}" } })]);
      await waitFor(() => expect(h.fromCalls.length).toBeGreaterThan(1));
      await act(async () => {});
      const odczytZablokowany = el(".text-muted-foreground").textContent;

      expect(odczytZablokowany).not.toBe(prawdziweZero);
    },
  );

  it("prawdziwe zero subskrybentów renderuje się jako zero, a nie jako liczba zapasowa", async () => {
    h.count = 0;
    mount([
      makeSocialProof({ fallbackCount: 2500, text: { pl: "Juz {count} osob", en: "{count}" } }),
    ]);

    await waitFor(() => expect(el(".text-muted-foreground").textContent).toBe("Juz 0 osob"));
  });
});
