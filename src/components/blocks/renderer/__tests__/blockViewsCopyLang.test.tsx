// Napisy interfejsu publicznych widoków bloków w języku TREŚCI (`lang`
// dyspozytora), a nie zaszyta polszczyzna.
//
// CO MA TU DOWÓD
//  * opinie, cennik, zespół, siatka funkcji, alert, akordeon, zakładki,
//    karuzela i mapa biorą etykiety i nazwy dostępne ze słownika `i18n-public`
//    (PL+EN) w języku bloku - wcześniej strona /en pokazywała „Poprzednia",
//    „Polecane", „Zamknij alert", a ARIA karuzeli mówiła „karuzela";
//  * język wybiera `lang` renderera, nie język interfejsu i18next (ten stoi
//    tu na „pl"): podgląd wpisu EN w panelu po polsku pokazuje te same napisy
//    co strona publiczna;
//  * ocena w opinii jest nazwanym obrazem - sam `aria-label` na `<div>` bez
//    roli czytniki pomijają.
//
// GRANICE. Prawdziwy dyspozytor `BlockView`, prawdziwe widoki i prawdziwe
// i18n. Atrapa tylko `DeferredFrame` - happy-dom ładowałby ramkę OSM
// prawdziwym żądaniem sieciowym.
import "@/test/i18nReal";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { Block, Json } from "@/lib/blocks/types";

vi.mock("@/components/atoms/DeferredFrame", () => ({
  DeferredFrame: (p: { title: string }) => <div data-testid="map-frame" title={p.title} />,
}));

import { BlockView } from "../registry";

afterEach(cleanup);

type Lang = "pl" | "en";

function draw(type: string, data: Record<string, Json>, lang: Lang) {
  const block = { id: "b1", type, data } as Block;
  return render(<BlockView block={block} fnHtml={new Map()} lang={lang} allBlocks={[block]} />);
}

const COPY: Record<Lang, Record<string, string>> = {
  pl: {
    previous: "Poprzednia",
    next: "Następna",
    rating: "Ocena: 4/5",
    featured: "Polecane",
    profile: "Profil",
    learnMore: "Dowiedz się więcej →",
    dismiss: "Zamknij alert",
    section: "Sekcja 1",
    tab: "Zakładka 1",
    carousel: "karuzela",
    previousSlide: "Poprzedni slajd",
    nextSlide: "Następny slajd",
    slide: "Slajd 2",
    openMap: "Otwórz w OpenStreetMap",
    map: "Mapa",
  },
  en: {
    previous: "Previous",
    next: "Next",
    rating: "Rating: 4/5",
    featured: "Recommended",
    profile: "Profile",
    learnMore: "Learn more →",
    dismiss: "Close alert",
    section: "Section 1",
    tab: "Tab 1",
    carousel: "carousel",
    previousSlide: "Previous slide",
    nextSlide: "Next slide",
    slide: "Slide 2",
    openMap: "Open in OpenStreetMap",
    map: "Map",
  },
};

describe.each(["pl", "en"] as const)("blok z lang=%s", (lang) => {
  const c = COPY[lang];

  it("opinie: strzałki slidera i ocena jako nazwany obraz", () => {
    draw(
      "testimonials",
      {
        layout: "slider",
        items: [
          { quote: "Świetnie", author: "Anna", rating: 4 },
          { quote: "Dobrze", author: "Jan" },
        ],
      },
      lang,
    );
    expect(screen.getByRole("button", { name: c.previous })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: c.next })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: c.rating })).toBeInTheDocument();
  });

  it("cennik: znacznik planu polecanego", () => {
    draw("pricing-table", { plans: [{ name: "Pro", price: "99", featured: true }] }, lang);
    expect(screen.getByText(c.featured)).toBeInTheDocument();
  });

  it("zespół: link profilu społecznościowego", () => {
    draw("team-grid", { items: [{ name: "Anna", social: "https://linkedin.com/in/anna" }] }, lang);
    expect(screen.getByRole("link", { name: c.profile })).toHaveAttribute(
      "href",
      "https://linkedin.com/in/anna",
    );
  });

  it("siatka funkcji: zachęta w karcie z adresem", () => {
    draw("feature-grid", { items: [{ title: "Raporty", href: "/raporty" }] }, lang);
    expect(within(screen.getByRole("link")).getByText(c.learnMore)).toBeInTheDocument();
  });

  it("alert: przycisk zamknięcia", () => {
    draw("alert-banner", { title: "Info", dismissible: true }, lang);
    expect(screen.getByRole("button", { name: c.dismiss })).toBeInTheDocument();
  });

  it("akordeon i zakładki: numer zastępczy dla pustego tytułu", () => {
    draw("accordion", { items: [{ body: "<p>Treść</p>" }] }, lang);
    expect(screen.getByRole("button", { name: c.section })).toBeInTheDocument();
    cleanup();
    draw("tabs", { items: [{ body: "<p>Treść</p>" }] }, lang);
    expect(screen.getByRole("tab", { name: c.tab })).toBeInTheDocument();
  });

  it("karuzela: opis roli, strzałki i kropki slajdów", () => {
    draw(
      "image-carousel",
      { items: [{ url: "https://cdn.example/a.jpg" }, { url: "https://cdn.example/b.jpg" }] },
      lang,
    );
    expect(screen.getByRole("region")).toHaveAttribute("aria-roledescription", c.carousel);
    expect(screen.getByRole("button", { name: c.previousSlide })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: c.nextSlide })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: c.slide })).toBeInTheDocument();
  });

  it("mapa: link do OpenStreetMap i domyślny tytuł ramki", () => {
    draw("map", { lat: 50.06, lng: 19.94 }, lang);
    expect(screen.getByRole("link", { name: c.openMap })).toHaveAttribute("target", "_blank");
    expect(screen.getByTestId("map-frame")).toHaveAttribute("title", c.map);
  });
});
