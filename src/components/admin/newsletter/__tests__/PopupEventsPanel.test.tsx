// Raport zdarzeń popupu (wyświetlenia / otwarcia / wysłania / sukcesy / błędy).
//
// PO CO. To jedyne miejsce, w którym widać, czy popup w ogóle DZIAŁA. Sam
// przełącznik „popup włączony" nie mówi nic: popup może się wyświetlać i mieć
// zerową skuteczność, albo mieć 100% błędów zapisu. Pomyłka panelu jest cicha,
// bo panel zawsze pokazuje jakieś liczby.
//
// Testy sprawdzają TREŚĆ (które liczby przy których etykietach), zakres w
// zapytaniu i to, że okres bez zdarzeń mówi o tym wprost.
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";

const env = vi.hoisted(() => ({
  stats: null as unknown,
  fail: false,
  calls: [] as Record<string, unknown>[],
}));

vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: () => async (input: { data: Record<string, unknown> }) => {
    env.calls.push(input.data);
    if (env.fail) throw new Error("rpc padl");
    return env.stats;
  },
}));
vi.mock("@/lib/newsletter-popup-events.functions", () => ({
  getNewsletterPopupEventStats: {},
}));

import i18n from "@/lib/i18n";
import { PopupEventsPanel } from "@/components/admin/newsletter/PopupEventsPanel";
import type { NewsletterPopupEventStats } from "@/lib/newsletter-popup-events.functions";

const E = (key: string) => i18n.t(`adminNewsletter.popupEvents.${key}`);

function stats(overrides: Partial<NewsletterPopupEventStats> = {}): NewsletterPopupEventStats {
  return {
    totals: { impression: 1000, open: 400, submit: 200, success: 180, error: 20 },
    submitRate: 0.2,
    successRate: 0.9,
    errorRate: 0.1,
    days: [
      {
        day: "2026-08-01",
        counts: { impression: 600, open: 250, submit: 120, success: 110, error: 10 },
      },
      {
        day: "2026-08-02",
        counts: { impression: 400, open: 150, submit: 80, success: 70, error: 10 },
      },
    ],
    ...overrides,
  } as NewsletterPopupEventStats;
}

async function mount(data: NewsletterPopupEventStats | null = stats()) {
  env.stats = data;
  const utils = renderWithQueryClient(<PopupEventsPanel />);
  // Wskaźnik pojawia się WYŁĄCZNIE z danymi - liczby powtarzają się w tabeli
  // dziennej, więc nie nadają się na punkt zaczepienia.
  if (data) await screen.findByText(E("ratioSubmit"));
  return utils;
}

/**
 * Etykiety zdarzeń stoją i na kartach liczników, i w nagłówkach tabeli dziennej,
 * więc szukamy karty, a nie samego tekstu.
 */
function licznikLabel(key: string): HTMLElement {
  const label = screen.getAllByText(E(`events.${key}`)).find((el) => !el.closest("table"));
  expect(label, `brak karty licznika ${key}`).toBeTruthy();
  return label as HTMLElement;
}

/** Wartość na karcie licznika (etykieta i wartość są rodzeństwem w karcie). */
function licznik(key: string): string {
  const card = licznikLabel(key).parentElement!;
  return card.lastElementChild?.textContent?.trim() ?? "";
}

beforeAll(async () => {
  await i18n.changeLanguage("pl");
});

beforeEach(() => {
  env.stats = stats();
  env.fail = false;
  env.calls = [];
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("liczniki zdarzeń", () => {
  it("pokazuje wszystkie PIĘĆ zdarzeń z etykietami", async () => {
    await mount();

    for (const key of ["impression", "open", "submit", "success", "error"]) {
      expect(licznikLabel(key)).toBeTruthy();
    }
    expect(screen.getByText(E("title"))).toBeTruthy();
  });

  it("liczby są z raportu, nie zerowe zaślepki", async () => {
    await mount();

    expect(licznik("impression")).toBe("1000");
    expect(licznik("open")).toBe("400");
    expect(licznik("error")).toBe("20");
  });

  it("BŁĘDY mają swój licznik - bez niego awaria zapisu jest niewidoczna", async () => {
    // Popup może wyświetlać się tysiąc razy i nie zapisać nikogo.
    await mount(
      stats({
        totals: { impression: 500, open: 200, submit: 100, success: 0, error: 100 },
        successRate: 0,
        errorRate: 1,
      }),
    );

    expect(licznik("error")).toBe("100");
    expect(licznik("success")).toBe("0");
    expect(screen.getByText("100.0%")).toBeTruthy();
  });
});

describe("wskaźniki procentowe", () => {
  it("trzy wskaźniki: wysłania/wyświetlenia, skuteczność i udział błędów", async () => {
    await mount();

    expect(screen.getByText(E("ratioSubmit"))).toBeTruthy();
    expect(screen.getByText(E("ratioSuccess"))).toBeTruthy();
    expect(screen.getByText(E("ratioError"))).toBeTruthy();
  });

  it("współczynnik jest pokazany jako PROCENT z jedną cyfrą", async () => {
    await mount();

    expect(screen.getByText("20.0%")).toBeTruthy();
    expect(screen.getByText("90.0%")).toBeTruthy();
    expect(screen.queryByText("0.2")).toBeNull();
  });

  it("zero jest pokazane jawnie jako 0,0%", async () => {
    await mount(stats({ submitRate: 0, successRate: 0, errorRate: 0 }));

    expect(screen.getAllByText("0.0%")).toHaveLength(3);
  });
});

describe("tabela dzienna", () => {
  it("każdy dzień ma wiersz z pełnym rozbiciem", async () => {
    await mount();

    expect(screen.getByText("2026-08-01")).toBeTruthy();
    expect(screen.getByText("600")).toBeTruthy();
    expect(screen.getByText(E("colDay"))).toBeTruthy();
  });

  it("okres BEZ zdarzeń mówi to wprost, zamiast pokazywać pustą tabelę", async () => {
    await mount(
      stats({
        days: [],
        totals: { impression: 0, open: 0, submit: 0, success: 0, error: 0 },
        submitRate: 0,
        successRate: 0,
        errorRate: 0,
      }),
    );

    expect(screen.getByText(E("empty"))).toBeTruthy();
    expect(screen.queryByText(E("colDay"))).toBeNull();
  });
});

describe("zakres czasu", () => {
  it("startuje na 30 dniach", async () => {
    await mount();

    expect(env.calls[0]?.days).toBe(30);
  });

  it("oferuje trzy zakresy", async () => {
    await mount();

    for (const days of [7, 30, 90]) {
      expect(screen.getByText(E2(days))).toBeTruthy();
    }
  });

  it("zmiana zakresu trafia do ZAPYTANIA, nie tylko do przycisku", async () => {
    await mount();

    fireEvent.click(screen.getByText(E2(90)));

    await waitFor(() => expect(env.calls.at(-1)?.days).toBe(90));
  });

  it("powrót na krótszy zakres też pyta serwer", async () => {
    await mount();
    fireEvent.click(screen.getByText(E2(90)));
    await waitFor(() => expect(env.calls.at(-1)?.days).toBe(90));

    fireEvent.click(screen.getByText(E2(7)));

    await waitFor(() => expect(env.calls.at(-1)?.days).toBe(7));
  });
});

describe("stany brzegowe", () => {
  it("dopóki dane nie doszły, panel mówi że się ładuje", () => {
    renderWithQueryClient(<PopupEventsPanel />);

    expect(screen.getByText(E("loading"))).toBeTruthy();
    expect(screen.queryByText(E("colDay"))).toBeNull();
  });

  it("awaria zapytania pokazuje komunikat błędu", async () => {
    env.fail = true;
    renderWithQueryClient(<PopupEventsPanel />);

    expect(await screen.findByText(E("error"))).toBeTruthy();
    expect(screen.queryByText(E("colDay"))).toBeNull();
  });

  it("etykiety idą za językiem interfejsu", async () => {
    await i18n.changeLanguage("en");
    try {
      await mount();

      expect(screen.getByText(i18n.t("adminNewsletter.popupEvents.title"))).toBeTruthy();
      expect(licznikLabel("impression")).toBeTruthy();
    } finally {
      await i18n.changeLanguage("pl");
    }
  });
});

/** Etykieta zakresu - klucz bierze liczbę dni jako parametr. */
function E2(days: number): string {
  return i18n.t("adminNewsletter.popupEvents.rangeDays", { days });
}
