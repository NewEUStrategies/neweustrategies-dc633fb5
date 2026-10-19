// Publiczne widoki bloków konwersji: `step-list`, `comparison-table`,
// `banner-image`, `video-hero` (`ConversionViews.tsx`). Bramkę autoodtwarzania
// hero wideo trzyma `mediaMotionGate.test.tsx` - tu treść i kontrast.
//
// CO MA TU DOWÓD
//  * kroki: numeracja ciągła po pominięciu pozycji bez tytułu, w obu
//    orientacjach, opis z HTML-a jako czysty tekst,
//  * tabela porównawcza: nagłówki kolumn i wierszy z właściwym `scope`,
//    wartości „tak/nie" (PL/EN/symbole) jako ikony z nazwą dostępną,
//    brakujące wartości jako puste komórki, brak kolumn/wierszy = brak bloku,
//  * baner i hero: przyciemnienie przycięte do 0..90% (czytelność tekstu na
//    zdjęciu), kolor nakładki zgodny z motywem, CTA tylko z etykietą i
//    adresem, bez obrazu/wideo - plakat albo dekoracyjne tło.
//
// GRANICE. Bez atrap - widoki są prezentacyjne; `AppLink` bez routera
// renderuje zwykłe `<a>`.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { Json } from "@/lib/blocks/types";
// Napisy tabeli porównawczej idą przez słownik `i18n-public` - prawdziwe i18n.
import "@/test/i18nReal";

import {
  BannerImageView,
  ComparisonTableView,
  StepListView,
  VideoHeroView,
} from "@/components/blocks/ConversionViews";

afterEach(cleanup);

describe("StepListView", () => {
  const items: Json[] = [
    { title: "Rejestracja", description: "<p>Załóż <b>konto</b></p>" },
    { description: "bez tytułu" },
    { title: "Płatność" },
  ];
  /** [numer, reszta tekstu kroku] w kolejności listy (numer to pierwszy węzeł). */
  const steps = () =>
    within(screen.getByRole("list"))
      .getAllByRole("listitem")
      .map((li) => {
        const n = li.firstElementChild?.textContent ?? "";
        return [n, (li.textContent ?? "").slice(n.length)];
      });

  it.each(["vertical", "horizontal"] as const)(
    "%s: numeracja ciągła po pominięciu kroku bez tytułu, opis jako tekst",
    (orientation) => {
      const { container } = render(
        <StepListView title="Jak to działa" items={items} orientation={orientation} />,
      );
      expect(screen.getByRole("heading", { name: "Jak to działa" })).toBeInTheDocument();
      expect(steps()).toEqual([
        ["1", "RejestracjaZałóż konto"],
        ["2", "Płatność"],
      ]);
      expect(container.querySelector("b")).toBeNull();
      expect(screen.queryByText("bez tytułu")).toBeNull();
    },
  );

  it("styl numeru „plain” nie zmienia numeracji; brak kroków = brak bloku", () => {
    const { container, rerender } = render(<StepListView items={items} numberStyle="plain" />);
    expect(steps().map(([n]) => n)).toEqual(["1", "2"]);
    rerender(<StepListView title="Pusto" items={[{ description: "x" }]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("ComparisonTableView", () => {
  it("nagłówki z `scope`, wartości tak/nie jako ikony z nazwą, braki jako puste komórki", () => {
    render(
      <ComparisonTableView
        title="Porównanie"
        columns={["Basic", "Pro"]}
        rows={[
          { feature: "Raporty", values: ["✓", " Tak "] },
          { feature: "API", values: ["no", "FALSE"] },
          { feature: "Wsparcie", values: ["8/5"] },
        ]}
      />,
    );
    expect(screen.getByRole("heading", { name: "Porównanie" })).toBeInTheDocument();
    const cols = screen.getAllByRole("columnheader");
    expect(cols.map((c) => c.textContent)).toEqual(["Funkcja", "Basic", "Pro"]);
    expect(cols[1]).toHaveAttribute("scope", "col");
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows.map((r) => within(r).getByRole("rowheader").textContent)).toEqual([
      "Raporty",
      "API",
      "Wsparcie",
    ]);
    expect(within(rows[0]).getAllByLabelText("Tak")).toHaveLength(2);
    expect(within(rows[1]).getAllByLabelText("Nie")).toHaveLength(2);
    const support = within(rows[2]).getAllByRole("cell");
    expect(support.map((c) => c.textContent)).toEqual(["8/5", ""]);
  });

  it("strona EN: nagłówek kolumny cech i nazwy ikon tak/nie po angielsku", () => {
    // NAPRAWIONE 2026-10-19: „Funkcja” i „Tak”/„Nie” były zaszyte, więc
    // strona /en pokazywała polski nagłówek i czytała polskie nazwy ikon.
    render(
      <ComparisonTableView
        lang="en"
        columns={["Basic"]}
        rows={[
          { feature: "Reports", values: ["yes"] },
          { feature: "API", values: ["✗"] },
        ]}
      />,
    );
    expect(screen.getAllByRole("columnheader").map((c) => c.textContent)).toEqual([
      "Feature",
      "Basic",
    ]);
    expect(screen.getByLabelText("Yes")).toBeInTheDocument();
    expect(screen.getByLabelText("No")).toBeInTheDocument();
    expect(screen.queryByText("Funkcja")).toBeNull();
  });

  it("bez kolumn albo bez wierszy blok znika", () => {
    const noCols = render(<ComparisonTableView columns={[]} rows={[{ feature: "x" }]} />);
    expect(noCols.container).toBeEmptyDOMElement();
    const noRows = render(<ComparisonTableView columns={["A"]} />);
    expect(noRows.container).toBeEmptyDOMElement();
  });
});

describe("BannerImageView", () => {
  /** Kolor nakładki przyciemniającej (jedyny element z inline `background-color`). */
  const overlay = (root: HTMLElement) =>
    (root.querySelector("[style]") as HTMLElement).style.backgroundColor.replace(/\s/g, "");

  it("obraz z altem, tytuł, opis i CTA; nakładka domyślnie ciemna 35%", () => {
    const { container } = render(
      <BannerImageView
        image="https://cdn/b.jpg"
        alt="Panorama"
        title="Raport roczny"
        description="Najważniejsze liczby"
        ctaLabel="Pobierz"
        ctaHref="/raport"
      />,
    );
    expect(screen.getByRole("img", { name: "Panorama" })).toHaveAttribute(
      "src",
      "https://cdn/b.jpg",
    );
    expect(screen.getByRole("heading", { name: "Raport roczny" })).toBeInTheDocument();
    expect(screen.getByText("Najważniejsze liczby")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Pobierz" })).toHaveAttribute("href", "/raport");
    expect(overlay(container)).toBe("rgba(0,0,0,0.35)");
  });

  it("przyciemnienie przycięte do 0..90%, jasny motyw rozjaśnia; CTA bez adresu znika", () => {
    const strong = render(<BannerImageView overlay={150} ctaLabel="Bez adresu" />);
    expect(overlay(strong.container)).toBe("rgba(0,0,0,0.9)");
    expect(screen.queryByRole("link")).toBeNull();
    // Bez obrazu - dekoracyjne tło, żadnego `<img>` bez źródła.
    expect(screen.queryByRole("img")).toBeNull();
    strong.unmount();
    const light = render(<BannerImageView overlay={-10} theme="light" />);
    expect(overlay(light.container)).toBe("rgba(255,255,255,0)");
  });
});

describe("VideoHeroView - treść i tło", () => {
  /** Krycie czarnej nakładki (jedyny element z inline `opacity`). */
  const dim = (root: HTMLElement) => (root.querySelector("[style]") as HTMLElement).style.opacity;

  it("tytuł jako h1, podtytuł i CTA; przyciemnienie przycięte do 90%", () => {
    const { container } = render(
      <VideoHeroView
        src="https://cdn/v.mp4"
        title="Nowa Europa"
        subtitle="Analizy i strategie"
        ctaLabel="Dołącz"
        ctaHref="/dolacz"
        overlay={120}
        loop={false}
        autoplay={false}
      />,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Nowa Europa" })).toBeInTheDocument();
    expect(screen.getByText("Analizy i strategie")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Dołącz" })).toHaveAttribute("href", "/dolacz");
    expect(dim(container)).toBe("0.9");
    const video = container.querySelector("video") as HTMLVideoElement;
    expect(video.loop).toBe(false);
    expect(video.muted).toBe(true);
  });

  it("bez wideo: plakat jako dekoracyjny obraz, a bez plakatu - samo tło", () => {
    const withPoster = render(<VideoHeroView poster="https://cdn/p.jpg" overlay={-5} />);
    expect(withPoster.container.querySelector("video")).toBeNull();
    expect(withPoster.container.querySelector("img")).toHaveAttribute("src", "https://cdn/p.jpg");
    expect(withPoster.container.querySelector("img")).toHaveAttribute("alt", "");
    expect(dim(withPoster.container)).toBe("0");
    withPoster.unmount();
    const bare = render(<VideoHeroView title="Samo tło" ctaLabel="Bez adresu" />);
    expect(bare.container.querySelector("img, video")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
