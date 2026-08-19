// Atomy trackera: wejście do kanału RSS i szkielet ładowania indeksu.
//
// Oba były na zerze. Oba niosą reguły, których nie widać w przeglądzie kodu:
// link do feedu musi trzymać parytet językowy adresu (inaczej angielski
// czytelnik zapisuje sobie polski kanał), a szkielet musi być NIEWIDOCZNY dla
// technologii asystujących - inaczej czytnik ekranu ogłasza kilkanaście pustych
// pudełek przy każdej zimnej nawigacji.
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import i18n from "@/lib/i18n";
import { realT } from "@/test/i18nReal";
import { TrackerFeedLink } from "@/components/tracker/TrackerFeedLink";
import { TrackerIndexSkeleton } from "@/components/tracker/TrackerIndexSkeleton";

afterEach(async () => {
  await i18n.changeLanguage("pl");
});

describe("TrackerFeedLink", () => {
  it("prowadzi do kanału RSS trackera", async () => {
    await i18n.changeLanguage("pl");
    render(<TrackerFeedLink />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/tracker/rss.xml");
  });

  it("wersja angielska prowadzi do kanału Z PREFIKSEM języka", async () => {
    // Bez prefiksu angielski czytelnik zapisałby sobie w czytniku polski kanał
    // i dostawał polskie tytuły dossier do końca subskrypcji.
    await i18n.changeLanguage("en");
    render(<TrackerFeedLink />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/en/tracker/rss.xml");
  });

  it("deklaruje język i typ zasobu", async () => {
    await i18n.changeLanguage("en");
    render(<TrackerFeedLink />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("hrefLang", "en");
    expect(link).toHaveAttribute("type", "application/rss+xml");
  });

  it("etykieta i tytuł pochodzą ze słownika", async () => {
    await i18n.changeLanguage("pl");
    render(<TrackerFeedLink />);
    const t = realT("pl");
    expect(screen.getByRole("link")).toHaveAttribute("title", t("tracker.feed.title"));
    expect(screen.getByRole("link")).toHaveTextContent(String(t("tracker.feed.link")));
  });

  it("nieznany język traktuje jak polski", async () => {
    // `i18n.language` bywa czymś w rodzaju „de" (nagłówek przeglądarki przed
    // ustaleniem języka trasy). Adres musi wtedy zostać domyślny, a nie pusty.
    await i18n.changeLanguage("de");
    render(<TrackerFeedLink />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/tracker/rss.xml");
  });

  it("dokłada klasy wywołującego", async () => {
    await i18n.changeLanguage("pl");
    render(<TrackerFeedLink className="mt-4" />);
    expect(screen.getByRole("link")).toHaveClass("mt-4");
  });

  it("ikona jest ukryta przed czytnikiem ekranu", async () => {
    await i18n.changeLanguage("pl");
    const { container } = render(<TrackerFeedLink />);
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });
});

describe("TrackerIndexSkeleton", () => {
  it("jest CAŁY ukryty przed technologiami asystującymi", () => {
    // Szkielet to dekoracja; nawigację ogłasza RouteProgress. Bez `aria-hidden`
    // czytnik ekranu czyta kilkanaście pustych pudełek przy każdym wejściu.
    const { container } = render(<TrackerIndexSkeleton />);
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });

  it("nie wystawia ani jednego elementu w drzewie dostępności", () => {
    render(<TrackerIndexSkeleton />);
    expect(screen.queryAllByRole("heading")).toHaveLength(0);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("domyślnie rysuje sześć kart - tyle, ile mieści pierwszy ekran", () => {
    const { container } = render(<TrackerIndexSkeleton />);
    expect(container.querySelectorAll(".rounded-lg.border")).toHaveLength(6);
  });

  it("liczba kart jest sterowalna", () => {
    const { container } = render(<TrackerIndexSkeleton count={2} />);
    expect(container.querySelectorAll(".rounded-lg.border")).toHaveLength(2);
  });

  it("zero kart nie wywraca szkieletu", () => {
    const { container } = render(<TrackerIndexSkeleton count={0} />);
    expect(container.querySelectorAll(".rounded-lg.border")).toHaveLength(0);
    expect(container.firstElementChild).toBeInTheDocument();
  });

  it("trzyma szerokość i siatkę indeksu - inaczej treść skoczy po wczytaniu", () => {
    // Szkielet w innym kształcie niż strona to gorsze rozwiązanie niż jego brak:
    // użytkownik widzi układ, który zaraz się przestawia.
    const { container } = render(<TrackerIndexSkeleton />);
    expect(container.firstElementChild).toHaveClass("max-w-5xl");
    expect(container.querySelector(".grid")).toHaveClass("sm:grid-cols-2");
  });
});
