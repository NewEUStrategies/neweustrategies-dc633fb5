// Organizm: cala strona panelu prezentow (naglowek, statystyki, zakladki).
// Trasa `src/routes/admin.gifting.tsx` jest juz tylko `component: GiftingAdmin`,
// wiec to jest efektywnie test CALEGO ekranu.
//
// PO CO TEN PLIK ISTNIEJE. Rozbicie trasy na organizmy przenioslo z niej trzy
// obowiazki, ktorych zaden panel z osobna juz nie pilnuje:
//
//   1. ZAKLADKI MONTUJA SIE WYMIENNIE. Renderowanie warunkowe
//      (`tab === "links" && <LinksPanel/>`) znaczy, ze zakladka nieaktywna
//      NIE ISTNIEJE w drzewie - a to jest wlasnie ta wlasciwosc, ktora chroni
//      panel przed odpytywaniem trzech server fn naraz przy kazdym wejsciu.
//      Zamiana na `hidden` wygladalaby identycznie i cicho potroila ruch.
//   2. SEMANTYKA ARIA. `role="tablist"` + `role="tab"` + `aria-selected` to
//      jedyne, co mowi czytnikowi ekranu, ze te trzy przyciski sa jednym
//      przelacznikiem, a nie trzema niezaleznymi akcjami.
//   3. JEZYK -> LOKALIZACJA DAT. `uiLocale(lang)` jest liczone RAZ i podawane
//      obu tabelom jako props. Zgubienie tego przekazania daje daty w locale
//      przegladarki, czyli inne u kazdego admina.
//
// ATRAPY: wylacznie GRANICE - server fn wszystkich czterech paneli, i18n
// (stub + nakladka slownika). Panele potomne biegna PRAWDZIWE: to sasiedzi,
// a caly sens tego pliku to STYK miedzy nimi.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { axeViolations, summarize } from "@/test/axe";
import type { GiftAdminSettingsRow } from "@/lib/gifting-admin.functions";

const h = vi.hoisted(() => ({
  lang: "pl",
  ensureI18n: vi.fn(),
  getSettings: vi.fn(),
  getStats: vi.fn(),
  listLinks: vi.fn(),
  listEvents: vi.fn(),
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.lang),
);

// Nakladka slownika to granica i18n - rejestruje zasoby efektem ubocznym
// importu, wiec w tescie zastepuje ja no-op o tym samym ksztalcie.
vi.mock("@/lib/i18n-gifting-admin", () => ({ ensureI18n: () => h.ensureI18n() }));

vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-start")>();
  return { ...actual, useServerFn: (fn: unknown) => fn };
});

vi.mock("@/lib/gifting-admin.functions", () => ({
  getGiftAdminSettings: (...args: unknown[]) => h.getSettings(...args),
  updateGiftAdminSettings: vi.fn(),
  getGiftAdminStats: (...args: unknown[]) => h.getStats(...args),
  listGiftLinksAdmin: (...args: unknown[]) => h.listLinks(...args),
  revokeGiftLinkAdmin: vi.fn(),
  listGiftEventsAdmin: (...args: unknown[]) => h.listEvents(...args),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { GiftingAdmin } = await import("@/components/admin/gifting/organisms/GiftingAdmin");

const SETTINGS: GiftAdminSettingsRow = {
  enabled: true,
  monthly_limit: 10,
  link_ttl_days: 30,
  max_redemptions_per_link: 5,
  eligibility: "registered",
  updated_at: null,
  updated_by: null,
  persisted: true,
};

function tab(name: "settings" | "links" | "audit"): HTMLElement {
  return screen.getByRole("tab", { name: `giftingAdmin.tabs.${name}` });
}

beforeEach(() => {
  h.lang = "pl";
  h.ensureI18n.mockReset();
  h.getSettings.mockReset().mockResolvedValue(SETTINGS);
  h.getStats.mockReset().mockResolvedValue({
    active_links: 1,
    revoked_links: 0,
    expired_links: 0,
    exhausted_links: 0,
    total_created: 1,
    total_redeemed: 0,
    created_this_month: 1,
    redeemed_this_month: 0,
    unique_gifters: 1,
    unique_recipients: 0,
  });
  h.listLinks.mockReset().mockResolvedValue({ rows: [], total: 0 });
  h.listEvents.mockReset().mockResolvedValue({ rows: [], total: 0 });
});

describe("GiftingAdmin - naglowek i slownik", () => {
  it("rejestruje slownik zakladki w chunku KOMPONENTU, nie w entry", () => {
    // `ensureI18n()` jest no-opem, ktorego jedynym zadaniem jest zatrzymanie
    // importu slownika w chunku trasy. Zniknieciu tego wywolania nie
    // towarzyszy zaden objaw wizualny - panel po prostu pokazuje gole klucze
    // po wdrozeniu z podzialem kodu.
    renderWithQueryClient(<GiftingAdmin />);
    expect(h.ensureI18n).toHaveBeenCalled();
  });

  it("ma jeden naglowek pierwszego poziomu z tytulem panelu", () => {
    renderWithQueryClient(<GiftingAdmin />);
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0].textContent).toContain("giftingAdmin.title");
  });

  it("pokazuje podtytul", () => {
    renderWithQueryClient(<GiftingAdmin />);
    expect(screen.getByText("giftingAdmin.subtitle")).toBeTruthy();
  });

  it("statystyki sa POZA zakladkami - widoczne niezaleznie od wyboru", async () => {
    renderWithQueryClient(<GiftingAdmin />);
    await waitFor(() => expect(screen.getByText("giftingAdmin.stats.active")).toBeTruthy());
    fireEvent.click(tab("audit"));
    expect(screen.getByText("giftingAdmin.stats.active")).toBeTruthy();
  });
});

describe("GiftingAdmin - atrybuty ARIA zakladek", () => {
  it("przyciski zakladek stoja w jednym `tablist`", () => {
    renderWithQueryClient(<GiftingAdmin />);
    const tablist = screen.getByRole("tablist");
    expect(tablist).toBeTruthy();
    expect(screen.getAllByRole("tab")).toHaveLength(3);
  });

  it("startowo wybrana jest zakladka Ustawienia", () => {
    renderWithQueryClient(<GiftingAdmin />);
    expect(tab("settings").getAttribute("aria-selected")).toBe("true");
    expect(tab("links").getAttribute("aria-selected")).toBe("false");
    expect(tab("audit").getAttribute("aria-selected")).toBe("false");
  });

  it.each(["links", "audit", "settings"] as const)(
    "po przelaczeniu na %s tylko ta zakladka ma aria-selected=true",
    async (target) => {
      renderWithQueryClient(<GiftingAdmin />);
      fireEvent.click(tab(target));
      await waitFor(() => expect(tab(target).getAttribute("aria-selected")).toBe("true"));
      const selected = screen
        .getAllByRole("tab")
        .filter((node) => node.getAttribute("aria-selected") === "true");
      expect(selected).toHaveLength(1);
    },
  );

  it("kazdy przycisk zakladki jest typu button (nie submituje formularza)", () => {
    // Zakladki stoja nad formularzem ustawien - `type` inny niz "button"
    // wysylalby formularz przy kazdej zmianie zakladki.
    renderWithQueryClient(<GiftingAdmin />);
    for (const node of screen.getAllByRole("tab")) {
      expect((node as HTMLButtonElement).type).toBe("button");
    }
  });

  it("aktywna zakladka jest wyrozniona takze wizualnie", () => {
    renderWithQueryClient(<GiftingAdmin />);
    expect(tab("settings").className).toContain("border-brand");
    fireEvent.click(tab("audit"));
    expect(tab("audit").className).toContain("border-brand");
    expect(tab("settings").className).not.toContain("border-brand");
  });
});

describe("GiftingAdmin - przelaczanie zakladek montuje panele wymiennie", () => {
  it("Ustawienia sa zamontowane na starcie, Linki i Audyt NIE", async () => {
    renderWithQueryClient(<GiftingAdmin />);
    await waitFor(() => expect(h.getSettings).toHaveBeenCalled());
    expect(h.listLinks).not.toHaveBeenCalled();
    expect(h.listEvents).not.toHaveBeenCalled();
  });

  it("przejscie na Linki montuje tabele linkow", async () => {
    renderWithQueryClient(<GiftingAdmin />);
    fireEvent.click(tab("links"));
    await waitFor(() => expect(h.listLinks).toHaveBeenCalled());
    expect(screen.getByText("giftingAdmin.links.filterAll")).toBeTruthy();
  });

  it("przejscie na Audyt montuje log zdarzen", async () => {
    renderWithQueryClient(<GiftingAdmin />);
    fireEvent.click(tab("audit"));
    await waitFor(() => expect(h.listEvents).toHaveBeenCalled());
    expect(screen.getByText("giftingAdmin.audit.filterAll")).toBeTruthy();
  });

  it("zakladka nieaktywna ZNIKA z drzewa (nie jest tylko ukryta)", async () => {
    // Gdyby panele zostawaly zamontowane, kazde wejscie na strone odpalaloby
    // trzy server fn zamiast jednej - i kazda zmiana zakladki odswiezalaby
    // wszystkie trzy.
    renderWithQueryClient(<GiftingAdmin />);
    fireEvent.click(tab("links"));
    await waitFor(() => expect(screen.getByText("giftingAdmin.links.filterAll")).toBeTruthy());
    expect(screen.queryByText("giftingAdmin.settings.save")).toBeNull();

    fireEvent.click(tab("audit"));
    await waitFor(() => expect(screen.getByText("giftingAdmin.audit.filterAll")).toBeTruthy());
    expect(screen.queryByText("giftingAdmin.links.filterActive")).toBeNull();
  });

  it("powrot na Ustawienia przywraca formularz", async () => {
    renderWithQueryClient(<GiftingAdmin />);
    fireEvent.click(tab("links"));
    await waitFor(() => expect(screen.getByText("giftingAdmin.links.filterAll")).toBeTruthy());
    fireEvent.click(tab("settings"));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "giftingAdmin.settings.save" })).toBeTruthy(),
    );
  });

  it("Ustawienia i Linki dziela JEDNO zapytanie ustawien", async () => {
    // Wspolny klucz `["gift-admin","settings"]` jest cala umowa miedzy tymi
    // dwiema zakladkami - patrz `components/admin/gifting/__tests__/hooks.test.tsx`.
    renderWithQueryClient(<GiftingAdmin />);
    await waitFor(() => expect(h.getSettings).toHaveBeenCalledTimes(1));
    fireEvent.click(tab("links"));
    await waitFor(() => expect(h.listLinks).toHaveBeenCalled());
    expect(h.getSettings).toHaveBeenCalledTimes(1);
  });
});

describe("GiftingAdmin - jezyk interfejsu", () => {
  it("polski interfejs formatuje daty tabel po polsku", async () => {
    h.lang = "pl";
    h.listEvents.mockResolvedValue({
      rows: [
        {
          id: "00000000-0000-4000-8000-00000000ee01",
          event_type: "created",
          post_id: null,
          post_title: "Wpis testowy",
          actor_id: null,
          actor_name: null,
          actor_email: null,
          code: "abcDEF123_-xyz",
          created_at: "2026-08-01T10:30:00.000Z",
          total_count: 1,
        },
      ],
      total: 1,
    });
    renderWithQueryClient(<GiftingAdmin />);
    fireEvent.click(tab("audit"));
    await waitFor(() => expect(screen.getByText("Wpis testowy")).toBeTruthy());
    const cell = screen.getAllByRole("row")[1].textContent ?? "";
    expect(cell).toContain("1.08.2026");
  });

  it("angielski interfejs formatuje te sama date inaczej (en-GB)", async () => {
    h.lang = "en";
    h.listEvents.mockResolvedValue({
      rows: [
        {
          id: "00000000-0000-4000-8000-00000000ee01",
          event_type: "created",
          post_id: null,
          post_title: "Wpis testowy",
          actor_id: null,
          actor_name: null,
          actor_email: null,
          code: "abcDEF123_-xyz",
          created_at: "2026-08-01T10:30:00.000Z",
          total_count: 1,
        },
      ],
      total: 1,
    });
    renderWithQueryClient(<GiftingAdmin />);
    fireEvent.click(tab("audit"));
    await waitFor(() => expect(screen.getByText("Wpis testowy")).toBeTruthy());
    const cell = screen.getAllByRole("row")[1].textContent ?? "";
    expect(cell).toContain("01/08/2026");
  });
});

describe("GiftingAdmin - dostepnosc", () => {
  /** Napis, ktory pojawia sie dopiero PO odpowiedzi serwera danej zakladki. */
  const SETTLED: Record<"settings" | "links" | "audit", string> = {
    settings: "giftingAdmin.settings.save",
    links: "giftingAdmin.links.empty",
    audit: "giftingAdmin.audit.empty",
  };

  it.each(["settings", "links", "audit"] as const)(
    "zakladka %s nie wnosi naruszen dostepnosci",
    async (target) => {
      const { container } = renderWithQueryClient(<GiftingAdmin />);
      fireEvent.click(tab(target));
      // Skan uruchamiamy dopiero na USTABILIZOWANYM drzewie: kafelki statystyk
      // i tabela dojezdzaja asynchronicznie, a axe na polowie drzewa
      // dowodzilby mniej, niz obiecuje.
      await waitFor(() => expect(screen.getByText("giftingAdmin.stats.active")).toBeTruthy());
      await waitFor(() => expect(screen.getByText(SETTLED[target])).toBeTruthy());
      const violations = await axeViolations(container);
      expect(violations, summarize(violations)).toEqual([]);
    },
  );
});
