// PromoCardView: karta promocyjna. Testujemy tryb ręcznego adresu, tryb
// wydarzenia (dane z modułu wydarzeń: tytuł, okładka, termin, adres
// /events/$slug), kadr zdjęcia (proporcje vs stała wysokość, dopasowanie,
// punkt kadrowania), prezentację (nakładka, zaokrąglenie, wyrównanie, kolory)
// oraz - osobno i wprost - OBIETNICĘ BRAKU PRZESUNIĘĆ: ani karta, ani jej
// treść nie dostają `transform` w żadnym wariancie reakcji na kursor.
//
// Ta ostatnia grupa nie jest kosmetyką: cały widget powstał dlatego, że
// pierwowzór obracał kafelek pod kursorem (framer-motion), a to wyklucza SSR,
// psuje CLS i jest nieosiągalne z klawiatury.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

const db = vi.hoisted(() => ({ event: null as unknown }));

// Atrapa Supabase ODTWARZA FILTR PUBLIKACJI, bo na nim stoi różnica między
// stroną a kanwą: zapytanie publiczne dokłada `.eq("status", "published")`
// i wtedy szkic ma NIE wrócić, a zapytanie kanwy tego filtra nie ma.
// Atrapa przepuszczająca wszystko udowodniłaby dokładnie nic.
vi.mock("@/integrations/supabase/client", () => {
  const makeBuilder = () => {
    const filters: Record<string, unknown> = {};
    const b: Record<string, unknown> = {};
    for (const m of ["select", "in", "is", "order", "limit", "range"]) b[m] = () => b;
    b.eq = (column: string, value: unknown) => {
      filters[column] = value;
      return b;
    };
    b.maybeSingle = async () => {
      const row = db.event as { status?: string } | null;
      const wanted = filters.status;
      if (row && wanted !== undefined && row.status !== wanted) return { data: null, error: null };
      return { data: row, error: null };
    };
    b.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null });
    return b;
  };
  return { supabase: { from: () => makeBuilder(), rpc: async () => ({ data: [], error: null }) } };
});

import { PromoCardView } from "../PromoCardView";
import { BuilderModeProvider } from "@/lib/content-model/editorCanvas";
import type { WidgetContent } from "@/lib/builder/types";
import { pl } from "@/lib/locale/pl";
import { en } from "@/lib/locale/en";

const base: WidgetContent = {
  title_pl: "Raport o bezpieczeństwie",
  title_en: "Security report",
  subtitle_pl: "Premiera 12 marca",
  subtitle_en: "Out on 12 March",
  image: "https://images.example.org/promo.jpg",
  imageAlt_pl: "Okładka raportu",
  imageAlt_en: "Report cover",
  mode: "link",
  href: "https://example.org/raport",
  buttonText_pl: "Pobierz raport",
  buttonText_en: "Download the report",
};

function wrap(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const renderCard = (c: WidgetContent, lang: "pl" | "en" = "pl") =>
  wrap(<PromoCardView c={c} lang={lang} />);

const card = (): HTMLElement => {
  const el = document.querySelector<HTMLElement>("[data-promo-card]");
  if (!el) throw new Error("test: brak karty w DOM-ie");
  return el;
};

beforeEach(() => {
  db.event = null;
});
afterEach(cleanup);

describe("PromoCardView - treść i język", () => {
  it("renderuje treść w języku widoku (PL)", () => {
    renderCard(base, "pl");
    expect(screen.getByRole("heading", { name: "Raport o bezpieczeństwie" })).toBeInTheDocument();
    expect(screen.getByText("Premiera 12 marca")).toBeInTheDocument();
    expect(screen.getByAltText("Okładka raportu")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Pobierz raport" })).toHaveAttribute(
      "href",
      "https://example.org/raport",
    );
  });

  it("renderuje treść w języku widoku (EN)", () => {
    renderCard(base, "en");
    expect(screen.getByRole("heading", { name: "Security report" })).toBeInTheDocument();
    expect(screen.getByText("Out on 12 March")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download the report" })).toBeInTheDocument();
  });

  it("okładka bez tekstu alternatywnego znika z drzewa dostępności", () => {
    renderCard({ ...base, imageAlt_pl: "", imageAlt_en: "" }, "pl");
    expect(card().querySelector("img")).toHaveAttribute("aria-hidden", "true");
  });

  it("pusta etykieta przycisku dostaje domyślną w języku widoku", () => {
    renderCard({ ...base, buttonText_pl: "", buttonText_en: "" }, "pl");
    expect(screen.getByRole("link", { name: "Dowiedz się więcej" })).toBeInTheDocument();
  });

  it("niebezpieczny adres nie staje się przyciskiem", () => {
    renderCard({ ...base, href: "javascript:alert(1)" }, "pl");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("nowa karta dostaje rel=noopener - bez tego otwarta strona steruje naszą zakładką", () => {
    renderCard({ ...base, newTab: true }, "pl");
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("publicznie karta bez tytułu i okładki nie renderuje pustego prostokąta", () => {
    const { container } = renderCard({ mode: "link" }, "pl");
    expect(container.innerHTML).toBe("");
  });

  it("w kanwie buildera pusta karta mówi redakcji, czego brakuje", () => {
    wrap(
      <BuilderModeProvider mode="light">
        <PromoCardView c={{ mode: "link" }} lang="pl" />
      </BuilderModeProvider>,
    );
    // W teście i18next nie ma wgranych zasobów, więc `t()` zwraca KLUCZ - i to
    // jest tu asercja właściwa: podpowiedź ma iść słownikiem, a nie warunkiem
    // po języku wpisanym w komponent (taki warunek omija bramkę parytetu PL/EN).
    expect(screen.getByText("promoCard.builderEmpty")).toBeInTheDocument();
  });

  it("klucz podpowiedzi istnieje w OBU słownikach - klucz bez tłumaczenia to pusty ekran", () => {
    expect(pl.promoCard.builderEmpty).toBeTruthy();
    expect(en.promoCard.builderEmpty).toBeTruthy();
    expect(en.promoCard.builderEmpty).not.toBe(pl.promoCard.builderEmpty);
  });
});

describe("PromoCardView - tryb wydarzenia", () => {
  const eventRow = {
    id: "ev-1",
    slug: "forum-2026",
    title_pl: "Forum Bezpieczeństwa 2026",
    title_en: "Security Forum 2026",
    starts_at: "2026-03-12T09:00:00Z",
    ends_at: null,
    timezone: "Europe/Warsaw",
    location: "Warszawa",
    kind: "in_person",
    capacity: null,
    cover_url: "https://cdn.example.org/event.jpg",
    visibility: "public",
    description_pl: null,
    description_en: null,
    status: "published",
  };

  it("bierze z wydarzenia tytuł, okładkę, termin i adres strony", async () => {
    db.event = eventRow;
    renderCard({ mode: "event", eventId: "ev-1", showEventMeta: true }, "pl");

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Forum Bezpieczeństwa 2026" }),
      ).toBeInTheDocument(),
    );
    expect(card().querySelector("img")).toHaveAttribute("src", "https://cdn.example.org/event.jpg");
    expect(screen.getByRole("link", { name: "Zobacz wydarzenie" })).toHaveAttribute(
      "href",
      "/events/forum-2026",
    );
    // Termin w STREFIE WYDARZENIA: 09:00 UTC to wciąż 12 marca w Warszawie.
    expect(screen.getByText(/12/)).toBeInTheDocument();
    expect(screen.getByText(/Warszawa/)).toBeInTheDocument();
  });

  it("własny tytuł i własny adres mają pierwszeństwo nad danymi wydarzenia", async () => {
    db.event = eventRow;
    renderCard(
      {
        mode: "event",
        eventId: "ev-1",
        title_pl: "Nasza własna zajawka",
        href: "https://rejestracja.example/x",
      },
      "pl",
    );
    await waitFor(() =>
      expect(screen.getByRole("link")).toHaveAttribute("href", "https://rejestracja.example/x"),
    );
    expect(screen.getByRole("heading", { name: "Nasza własna zajawka" })).toBeInTheDocument();
  });

  it("wyłączony wiersz meta chowa termin i miejsce, zostawiając resztę", async () => {
    db.event = eventRow;
    renderCard({ mode: "event", eventId: "ev-1", showEventMeta: false }, "pl");
    await waitFor(() => expect(screen.getByRole("heading")).toBeInTheDocument());
    expect(screen.queryByText(/Warszawa/)).not.toBeInTheDocument();
  });

  it("tryb ręczny nie czyta wydarzenia, nawet gdy id zostało w treści", () => {
    db.event = eventRow;
    renderCard({ ...base, mode: "link", eventId: "ev-1" }, "pl");
    expect(screen.getByRole("heading", { name: "Raport o bezpieczeństwie" })).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", "https://example.org/raport");
  });

  // Picker celowo pokazuje szkice - redakcja podpina widget PRZED publikacją
  // wydarzenia. Kanwa musi wtedy pokazać, co właśnie podpięto; strona publiczna
  // nie ma prawa pokazać niczego, dopóki wydarzenie nie jest opublikowane.
  const draft = { ...eventRow, status: "draft", title_pl: "Szkic: Forum 2027" };

  it("szkic wydarzenia JEST widoczny w kanwie buildera", async () => {
    db.event = draft;
    wrap(
      <BuilderModeProvider mode="light">
        <PromoCardView c={{ mode: "event", eventId: "ev-1" }} lang="pl" />
      </BuilderModeProvider>,
    );
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Szkic: Forum 2027" })).toBeInTheDocument(),
    );
  });

  it("ten sam szkic NIE wychodzi na stronę publiczną", async () => {
    db.event = draft;
    const { container } = renderCard({ mode: "event", eventId: "ev-1" }, "pl");
    await waitFor(() => expect(container.innerHTML).toBe(""));
    expect(screen.queryByText("Szkic: Forum 2027")).not.toBeInTheDocument();
  });
});

describe("PromoCardView - kadr zdjęcia", () => {
  const spacer = (): HTMLElement => {
    const el = card().querySelector<HTMLElement>(".pcx-ratio");
    if (!el) throw new Error("test: brak rozpieracza kadru");
    return el;
  };

  it("proporcje kadru rezerwują miejsce zanim okładka się wczyta", () => {
    renderCard({ ...base, ratio: "1:1" }, "pl");
    expect(spacer().style.aspectRatio).toBe("1 / 1");
    expect(spacer().style.height).toBe("");
    // Wysokość NIE siedzi na ramce - inaczej dłuższy tytuł zostałby przycięty.
    expect(card().style.aspectRatio).toBe("");
  });

  it("kadr o stałej wysokości bierze liczbę z panelu zamiast proporcji", () => {
    renderCard({ ...base, ratio: "auto", heightPx: 420 }, "pl");
    expect(spacer().style.height).toBe("420px");
    expect(spacer().style.aspectRatio).toBe("");
  });

  it("maksymalna szerokość ogranicza kartę i steruje atrybutem sizes okładki", () => {
    renderCard({ ...base, maxWidth: 640 }, "pl");
    expect(card().style.maxWidth).toBe("640px");
    expect(card().querySelector("img")?.getAttribute("sizes")).toBe(
      "(max-width: 640px) 100vw, 640px",
    );
  });

  it("zero = pełna szerokość kolumny (bez limitu w stylu)", () => {
    renderCard({ ...base, maxWidth: 0 }, "pl");
    expect(card().style.maxWidth).toBe("");
  });

  it("dopasowanie i punkt kadrowania trafiają na obrazek", () => {
    renderCard({ ...base, fit: "contain", imagePosition: "top" }, "pl");
    const img = card().querySelector("img") as HTMLElement;
    expect(img.className).toContain("object-contain");
    expect(img.style.objectPosition).toBe("top");
  });
});

describe("PromoCardView - prezentacja", () => {
  it("nakładka, zaokrąglenie i wyrównanie idą z panelu", () => {
    const { container } = renderCard(
      {
        ...base,
        overlayColor: "#123456",
        overlayAlphaTop: 0.2,
        overlayAlphaBottom: 0.9,
        radius: 18,
        align: "center",
      },
      "pl",
    );
    const style = card().getAttribute("style") ?? "";
    expect(style).toContain("--pcx-overlay-color: #123456");
    expect(style).toContain("--pcx-overlay-top: 20%");
    expect(style).toContain("--pcx-overlay-bottom: 90%");
    expect(card().style.borderRadius).toBe("18px");
    expect(container.querySelector(".text-center")).toBeTruthy();
  });

  it("kolor tekstu i kolory przycisku nadpisują wartości motywu", () => {
    renderCard({ ...base, textColor: "#101010", buttonBg: "#ff5500", buttonTextColor: "#ffffff" });
    const link = screen.getByRole("link");
    expect(link.style.background).toBe("#ff5500");
    expect(link.style.color).toBe("#ffffff");
    expect(card().querySelector<HTMLElement>("[style*='color']")).toBeTruthy();
  });

  it("wstrzyknięty kolor nie dojeżdża do atrybutu style", () => {
    renderCard({ ...base, overlayColor: "red; background:url(javascript:alert(1))" }, "pl");
    expect(card().getAttribute("style") ?? "").not.toContain("javascript");
  });
});

describe("PromoCardView - obietnica braku przesunięć", () => {
  const HOVERS = ["none", "fade", "zoom-in", "zoom-out", "shadow"];

  it("żaden wariant reakcji na kursor nie ustawia transformacji karty", () => {
    for (const hover of HOVERS) {
      renderCard({ ...base, hover }, "pl");
      const el = card();
      expect(el.dataset.hover, `wariant ${hover}`).toBe(hover);
      // Ani `transform`, ani perspektywa 3D pierwowzoru - karta stoi w miejscu,
      // a ruch (jeśli w ogóle) dotyczy WYŁĄCZNIE okładki wewnątrz kadru.
      expect(el.style.transform, `wariant ${hover}`).toBe("");
      expect(el.style.perspective, `wariant ${hover}`).toBe("");
      expect(el.className).toContain("overflow-hidden");
      cleanup();
    }
  });

  it("treść karty nie jest wypychana w trzecim wymiarze (translateZ wzorca)", () => {
    const { container } = renderCard(base, "pl");
    for (const el of Array.from(container.querySelectorAll<HTMLElement>("*"))) {
      expect(el.style.transform).toBe("");
    }
  });

  it("wariant animacji wejścia jedzie deklaratywnie do arkusza, nie do stylu w JS", () => {
    renderCard({ ...base, entrance: "zoom" }, "pl");
    expect(card().dataset.entrance).toBe("zoom");
    expect(card().style.animation).toBe("");
  });

  it("nieznany wariant spada do wartości domyślnej, a nie do pustego atrybutu", () => {
    renderCard({ ...base, hover: "tilt-3d", entrance: "spin" }, "pl");
    expect(card().dataset.hover).toBe("zoom-in");
    expect(card().dataset.entrance).toBe("fade");
  });
});
