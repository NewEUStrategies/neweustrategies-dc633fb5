// Sekcje marketingowe: hero, CTA, karuzela obrazów i mapa (MarketingViews).
//
// Wszystkie cztery biorą wartości wprost z panelu, a trzy z nich wkładają je
// w miejsca, gdzie wartość nie jest tekstem: tło hero idzie do CSS, slajdy
// karuzeli do `src`/`alt`, współrzędne mapy do adresu ramki. Dowodzimy więc:
//   * tło hero przechodzi przez filtr schematu obrazu i zostaje JEDNĄ wartością
//     `url(...)` - także w HTML z serwera, gdzie przeglądarka nie odrzuci
//     doklejonej deklaracji (`;position:fixed`),
//   * karuzela: nawigacja strzałkami/kropkami z zawijaniem, stan ARIA slajdów,
//     pauza automatu pod kursorem, brak „[object Object]" z importu; interwał
//     spoza zakresu edytora domknięty do 1,5-20 s (nie-liczba = 5 s); strzałki
//     to wspólny kąt sliderów (`AngleChevron`) z kontrastem >= 3:1 na zdjęciu,
//   * mapa: ramka OSM wycentrowana na punkcie, zoom i wysokość w granicach.
//
// Granice: router (AppLink) przez wspólną atrapę Link, punkt ciszy bramki
// ruchu (otwierany ręcznie jak w mediaMotionGate) oraz `DeferredFrame` -
// prawdziwa ramka w happy-dom POBIERA adres z sieci, a kontraktem mapy są
// właśnie parametry przekazane ramce (adres, tytuł, wysokość).
// Napisy interfejsu widoków idą przez słownik `i18n-public` - prawdziwe i18n.
import "@/test/i18nReal";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent, act } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { __openMotionGateForTests, __resetMotionGateForTests } from "@/lib/performance/motionGate";
import type { Json } from "@/lib/blocks/types";

vi.mock("@tanstack/react-router", async () => {
  const { RouterLinkStub } = await import("@/test/routerLinkStub");
  return { Link: RouterLinkStub, useRouter: () => ({ navigate: () => undefined }) };
});
vi.mock("@/lib/performance/whenQuiescent", () => ({ onQuiescent: () => () => {} }));
vi.mock("@/components/atoms/DeferredFrame", () => ({
  DeferredFrame: (p: { src: string; title: string; style?: { height?: string } }) => (
    <div data-testid="map-frame" data-src={p.src} title={p.title} style={p.style} />
  ),
}));

import { HeroView, CtaSectionView, ImageCarouselView, MapView } from "../MarketingViews";
import { AngleChevron } from "@/lib/builder/sectionLabelVariants";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  __resetMotionGateForTests();
});

/** Atrybut `style` elementu z HTML-a serwera (przed hydratacją). */
function serverStyle(html: string, selector: string): string {
  const host = document.createElement("div");
  host.innerHTML = html;
  return host.querySelector(selector)?.getAttribute("style") ?? "";
}

/**
 * Nazwy deklaracji w atrybucie `style` tak, jak tnie je CSS: średnik w
 * cudzysłowie albo w nawiasie NIE kończy deklaracji. (Parser stylu happy-dom
 * tnie po każdym średniku, więc nie nadaje się do oceny cytowanego `url()`.)
 */
function declarationNames(style: string): string[] {
  const names: string[] = [];
  let quote = "";
  let depth = 0;
  let current = "";
  for (const ch of style) {
    if (quote) {
      if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(") depth += 1;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (ch === ";" && depth === 0) {
      names.push(current.split(":")[0].trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) names.push(current.split(":")[0].trim());
  return names;
}

describe("HeroView", () => {
  it("tytuł, nadtytuł, podtytuł i dwa przyciski z panelu", () => {
    render(
      <HeroView
        eyebrow="Nowość"
        title="Raport roczny"
        subtitle="Podsumowanie roku"
        ctaLabel="Czytaj"
        ctaHref="/raport"
        secondaryLabel="Pobierz"
        secondaryHref="/raport.pdf"
      />,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Raport roczny");
    expect(screen.getByText("Nowość")).toBeTruthy();
    expect(screen.getByText("Podsumowanie roku")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Czytaj" })).toHaveAttribute("href", "/raport");
    expect(screen.getByRole("link", { name: "Pobierz" })).toHaveAttribute("href", "/raport.pdf");
  });

  it("przycisk bez adresu nie powstaje; bez tytułu nie ma pustego h1", () => {
    render(<HeroView ctaLabel="Czytaj" secondaryLabel="Pobierz" secondaryHref="/x" />);
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.getAllByRole("link").map((a) => a.textContent)).toEqual(["Pobierz"]);
  });

  it.each([
    [40, "0.4"],
    [150, "0.9"],
    [-10, "0"],
  ])("przyciemnienie %i trafia na nakładkę przycięte do 0-90%% (%s)", (overlay, opacity) => {
    const { container } = render(<HeroView title="T" bgImage="/img/tlo.jpg" overlay={overlay} />);
    const section = container.querySelector("section") as HTMLElement;
    expect(section.style.backgroundImage).toContain("/img/tlo.jpg");
    const shade = section.querySelector<HTMLElement>("[aria-hidden]");
    expect(shade?.style.opacity).toBe(opacity);
  });

  it("BEZ tła nie ma nakładki ani stylu tła", () => {
    const { container } = render(<HeroView title="T" />);
    const section = container.querySelector("section") as HTMLElement;
    expect(section.getAttribute("style")).toBeNull();
    expect(section.querySelector("[aria-hidden]")).toBeNull();
  });

  // NAPRAWIONE 2026-10-18: tło hero szło do CSS surowo i bez cudzysłowu
  // (`url(${bgImage})`). W HTML z serwera wartość
  // `https://x/a.jpg);position:fixed;inset:0` stawała się DRUGĄ deklaracją
  // stylu sekcji (nakładka na całą stronę przed hydratacją), a schemat nie był
  // filtrowany. Teraz tło przechodzi przez `safeImageUrl` i jest cytowane - jak
  // w bloku `cover` renderera.
  it.each([
    "https://cdn.test/a.jpg);position:fixed;inset:0",
    'https://cdn.test/a.jpg");position:fixed;inset:0;("',
  ])("tło %s zostaje JEDNĄ deklaracją url() w HTML z serwera", (bgImage) => {
    const style = serverStyle(renderToString(<HeroView title="T" bgImage={bgImage} />), "section");
    expect(declarationNames(style)).toEqual(["background-image"]);
    expect(style).toContain('url("https://cdn.test/a.jpg');
  });

  it.each(["javascript:alert(1)", "data:text/html,x", "ftp://x.test/a.jpg"])(
    "tło o niedozwolonym schemacie %s jest pomijane (gradient zamiast obrazu)",
    (bgImage) => {
      const { container } = render(<HeroView title="T" bgImage={bgImage} />);
      const section = container.querySelector("section") as HTMLElement;
      expect(section.getAttribute("style")).toBeNull();
      expect(section.querySelector("[aria-hidden]")).toBeNull();
    },
  );
});

describe("CtaSectionView", () => {
  it("nagłówek, opis i przycisk z panelu", () => {
    render(<CtaSectionView title="Dołącz" description="Opis" ctaLabel="Zapisz się" ctaHref="/z" />);
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Dołącz");
    expect(screen.getByText("Opis")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Zapisz się" })).toHaveAttribute("href", "/z");
  });

  it("bez adresu przycisk nie powstaje, bez tytułu i opisu nie ma pustych elementów", () => {
    const { container } = render(<CtaSectionView ctaLabel="Zapisz się" variant="outline" />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(container.querySelector("h2, p")).toBeNull();
  });
});

describe("ImageCarouselView", () => {
  const slides: Json[] = [
    { url: "https://cdn.test/1.jpg", alt: "Kadr 1", caption: "Podpis 1" },
    { url: "https://cdn.test/2.jpg", alt: "Kadr 2", href: "/galeria/2" },
    { url: "https://cdn.test/3.jpg", alt: "Kadr 3" },
  ];

  /** Indeks slajdu widocznego dla czytnika ekranu (reszta ma aria-hidden). */
  const visibleIndex = (container: HTMLElement) =>
    Array.from(container.querySelectorAll("[aria-hidden]")).findIndex(
      (el) => el.getAttribute("aria-hidden") === "false",
    );
  const currentDot = () =>
    screen
      .getAllByRole("button", { name: /^Slajd \d$/ })
      .findIndex((b) => b.getAttribute("aria-current") === "true");

  it("strzałki przewijają slajdy z zawijaniem w obie strony; kropki niosą aria-current", () => {
    const { container } = render(<ImageCarouselView items={slides} />);
    expect(screen.getByRole("region")).toHaveAttribute("aria-roledescription", "karuzela");
    expect(visibleIndex(container)).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Poprzedni slajd" }));
    expect(visibleIndex(container)).toBe(2);
    expect(currentDot()).toBe(2);
    fireEvent.click(screen.getByRole("button", { name: "Następny slajd" }));
    expect(visibleIndex(container)).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Slajd 2" }));
    expect(visibleIndex(container)).toBe(1);
    expect(currentDot()).toBe(1);
  });

  it("slajd z adresem jest odnośnikiem, podpis jest widoczny, slajd bez url jest pomijany", () => {
    const { container } = render(
      <ImageCarouselView items={[...slides, { url: "", alt: "Pusty" }, null]} />,
    );
    expect(container.querySelectorAll("img")).toHaveLength(3);
    expect(screen.getAllByRole("button", { name: /^Slajd/ })).toHaveLength(3);
    expect(container.querySelector('a[href="/galeria/2"] img')?.getAttribute("alt")).toBe("Kadr 2");
    expect(container.textContent).toContain("Podpis 1");
  });

  it("jeden slajd nie dostaje strzałek ani kropek; brak slajdów nie renderuje niczego", () => {
    render(<ImageCarouselView items={[slides[0]]} />);
    expect(screen.queryByRole("button")).toBeNull();
    cleanup();
    const { container } = render(<ImageCarouselView items={[]} />);
    expect(container.innerHTML).toBe("");
    const notList = render(<ImageCarouselView items={undefined} />);
    expect(notList.container.innerHTML).toBe("");
  });

  // NAPRAWIONE 2026-10-18: pola slajdu szły przez `String(...)`, więc obiekt
  // z importu stawał się „[object Object]" w `alt`/podpisie (a url-obiekt
  // tworzył slajd z `src="[object Object]"`). Teraz tylko napisy (i liczby)
  // są wartością pola - reszta to brak wartości.
  it("pola slajdu niebędące tekstem nie wyciekają jako [object Object]", () => {
    const { container } = render(
      <ImageCarouselView
        items={[
          { url: "https://cdn.test/1.jpg", alt: { pl: "x" }, caption: ["a"] },
          { url: { src: "https://cdn.test/2.jpg" }, alt: "Zły url" },
          { url: "https://cdn.test/3.jpg", alt: 2026 },
        ]}
      />,
    );
    expect(container.innerHTML).not.toContain("[object Object]");
    expect(Array.from(container.querySelectorAll("img")).map((i) => i.getAttribute("alt"))).toEqual(
      ["", "2026"],
    );
  });

  // NAPRAWIONE 2026-10-18: po usunięciu slajdów (podgląd na żywo w builderze)
  // indeks bieżącego slajdu zostawał poza listą i karuzela robiła się pusta -
  // żaden slajd nie był widoczny aż do kliknięcia.
  it("skrócenie listy slajdów nie zostawia karuzeli bez widocznego slajdu", () => {
    const { container, rerender } = render(<ImageCarouselView items={slides} />);
    fireEvent.click(screen.getByRole("button", { name: "Slajd 3" }));
    rerender(<ImageCarouselView items={slides.slice(0, 2)} />);
    expect(visibleIndex(container)).toBeGreaterThanOrEqual(0);
    expect(currentDot()).toBe(visibleIndex(container));
  });

  it("automat przewija po otwarciu bramki ruchu i staje pod kursorem", () => {
    vi.useFakeTimers();
    const { container } = render(<ImageCarouselView items={slides} autoplay interval={100} />);
    act(() => __openMotionGateForTests());
    // Interwał poniżej 1,5 s jest podnoszony do 1,5 s (zbyt szybkie przewijanie).
    act(() => {
      vi.advanceTimersByTime(1499);
    });
    expect(visibleIndex(container)).toBe(0);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(visibleIndex(container)).toBe(1);
    fireEvent.mouseEnter(screen.getByRole("region"));
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(visibleIndex(container)).toBe(1);
    fireEvent.mouseLeave(screen.getByRole("region"));
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(visibleIndex(container)).toBe(2);
  });

  // NAPRAWIONE 2026-10-19: interwał był domykany tylko od dołu
  // (`Math.max(1500, interval)`). Edytor trzyma pole w 20 000 ms, ale import
  // i API go omijają, a przeglądarka odpala `setInterval` z opóźnieniem
  // ponad 2^31-1 ms NATYCHMIAST - karuzela przeskakiwała w pętli co klatkę.
  it("interwał ponad 2^31-1 ms nie przeskakuje w pętli - automat przewija po 20 s", () => {
    vi.useFakeTimers();
    const { container } = render(<ImageCarouselView items={slides} autoplay interval={2 ** 31} />);
    act(() => __openMotionGateForTests());
    act(() => {
      vi.advanceTimersByTime(19_999);
    });
    expect(visibleIndex(container)).toBe(0);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(visibleIndex(container)).toBe(1);
  });

  // NAPRAWIONE 2026-10-19: `Math.max(1500, NaN)` to `NaN`, a `setInterval`
  // z `NaN`/`Infinity` rusza bez opóźnienia - autoplay gubił rytm.
  it("interwał NaN albo Infinity = domyślne 5 s", () => {
    for (const broken of [Number.NaN, Number.POSITIVE_INFINITY]) {
      vi.useFakeTimers();
      const { container } = render(<ImageCarouselView items={slides} autoplay interval={broken} />);
      act(() => __openMotionGateForTests());
      act(() => {
        vi.advanceTimersByTime(4999);
      });
      expect(visibleIndex(container), `interval=${broken}`).toBe(0);
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(visibleIndex(container), `interval=${broken}`).toBe(1);
      cleanup();
      vi.useRealTimers();
      __resetMotionGateForTests();
    }
  });

  // NAPRAWIONE 2026-10-19: karuzela miała własne strzałki (lucide
  // ChevronLeft/Right w czarnym kółku) wbrew zasadzie „Share eh-slider-arrow
  // and AngleChevron across sliders" - inny znak niż w sliderach buildera.
  it("strzałki to wspólny kąt sliderów, z etykietą w języku treści", () => {
    const angle = (side: "left" | "right") => {
      const { container: host, unmount } = render(<AngleChevron side={side} isSm={false} />);
      const html = host.innerHTML;
      unmount();
      return html;
    };
    const left = angle("left");
    const right = angle("right");

    const { container } = render(<ImageCarouselView items={slides} lang="en" />);
    const prev = screen.getByRole("button", { name: "Previous slide" });
    const next = screen.getByRole("button", { name: "Next slide" });
    expect(prev.innerHTML).toBe(left);
    expect(next.innerHTML).toBe(right);
    expect(prev.textContent).toBe("");
    prev.focus();
    expect(prev).toHaveFocus();
    fireEvent.click(prev);
    expect(visibleIndex(container)).toBe(2);
    fireEvent.click(next);
    expect(visibleIndex(container)).toBe(0);
  });

  // Strzałka leży na ZDJĘCIU dowolnej jasności, więc kontrast liczymy dla
  // najgorszego tła: kąt (ink) i jego podkład (półprzezroczysty scrim) po
  // nałożeniu na każdy kolor zdjęcia - z przezroczystością całego przycisku.
  // WCAG 1.4.11 (element nietekstowy) wymaga co najmniej 3:1. Kolory tła
  // strony (tryb jasny/ciemny) nie biorą w tym udziału - pod strzałką jest
  // zdjęcie, a nie powierzchnia motywu.
  it("strzałka na zdjęciu ma kontrast >= 3:1 nad zdjęciem dowolnego koloru", () => {
    render(<ImageCarouselView items={slides} />);
    const prev = screen.getByRole("button", { name: "Poprzedni slajd" });
    const style = getComputedStyle(prev);
    const ink = parseColor(style.getPropertyValue("--slider-arrow-ink"));
    const scrim = parseColor(style.getPropertyValue("--slider-arrow-bg"));
    const opacity = Number(style.getPropertyValue("--slider-arrow-opacity").trim() || "1");
    expect(scrim[3], "podkład musi przyciemniać zdjęcie").toBeGreaterThan(0);

    const steps = [0, 0.25, 0.5, 0.75, 1];
    let worst = Number.POSITIVE_INFINITY;
    for (const r of steps) {
      for (const g of steps) {
        for (const b of steps) {
          const photo = [r, g, b];
          // Podkład: scrim nad zdjęciem, potem przezroczystość grupy (przycisk).
          const discAlpha = scrim[3] * opacity;
          const disc = photo.map((c, i) => discAlpha * scrim[i] + (1 - discAlpha) * c);
          const stroke = photo.map((c, i) => opacity * ink[i] + (1 - opacity) * c);
          worst = Math.min(worst, contrast(stroke, disc));
        }
      }
    }
    expect(worst).toBeGreaterThanOrEqual(3);
  });
});

/** Kolor CSS „#rrggbb" albo „rgb(r g b / a)" -> [r, g, b, a], kanały 0-1. */
function parseColor(css: string): [number, number, number, number] {
  const value = css.trim();
  const hex = value.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (hex) {
    const [r, g, b] = [hex[1], hex[2], hex[3]].map((h) => parseInt(h, 16) / 255);
    return [r, g, b, 1];
  }
  const rgb = value.match(
    /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[/,]\s*([\d.]+))?\s*\)$/,
  );
  if (rgb) {
    return [Number(rgb[1]) / 255, Number(rgb[2]) / 255, Number(rgb[3]) / 255, Number(rgb[4] ?? 1)];
  }
  throw new Error(`nieobsługiwany kolor „${css}"`);
}

/** Luminancja względna WCAG 2.x koloru sRGB (kanały 0-1). */
function luminance(rgb: number[]): number {
  const [r, g, b] = rgb.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Współczynnik kontrastu WCAG dwóch kolorów sRGB. */
function contrast(a: number[], b: number[]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("MapView", () => {
  function renderMap(props: Parameters<typeof MapView>[0]) {
    const utils = render(<MapView {...props} />);
    const frame = screen.getByTestId("map-frame");
    const url = new URL(frame.getAttribute("data-src") as string);
    const [minLng, minLat, maxLng, maxLat] = (url.searchParams.get("bbox") ?? "")
      .split(",")
      .map(Number);
    return { ...utils, frame, url, minLng, minLat, maxLng, maxLat };
  }

  it("ramka OSM jest wycentrowana na punkcie, ma znacznik i tytuł z etykiety", () => {
    const m = renderMap({ lat: 50.0614, lng: 19.9366, zoom: 13, label: "Kraków" });
    expect(m.url.origin + m.url.pathname).toBe("https://www.openstreetmap.org/export/embed.html");
    expect(m.url.searchParams.get("marker")).toBe("50.0614,19.9366");
    expect((m.minLng + m.maxLng) / 2).toBeCloseTo(19.9366, 4);
    expect((m.minLat + m.maxLat) / 2).toBeCloseTo(50.0614, 4);
    expect(m.frame).toHaveAttribute("title", "Kraków");
    expect(screen.getByRole("link", { name: "Otwórz w OpenStreetMap" })).toHaveAttribute(
      "href",
      "https://www.openstreetmap.org/?mlat=50.0614&mlon=19.9366#map=13/50.0614/19.9366",
    );
  });

  it("większy zoom to węższy wycinek; zoom powyżej 18 nie zawęża już dalej", () => {
    const wide = renderMap({ zoom: 5 });
    const wideSpan = wide.maxLng - wide.minLng;
    cleanup();
    const close = renderMap({ zoom: 18 });
    const closeSpan = close.maxLng - close.minLng;
    cleanup();
    const beyond = renderMap({ zoom: 40 });
    expect(closeSpan).toBeLessThan(wideSpan);
    expect(beyond.maxLng - beyond.minLng).toBeCloseTo(closeSpan, 6);
  });

  it.each([
    [50, "160px"],
    [360, "360px"],
    [5000, "800px"],
  ])("wysokość %i jest przycinana do 160-800 px (%s)", (height, px) => {
    const m = renderMap({ height });
    expect(m.frame.style.height).toBe(px);
  });

  it("BEZ etykiety podpis pokazuje współrzędne, a ramka ma tytuł domyślny", () => {
    const m = renderMap({});
    expect(m.container.querySelector("figcaption")?.textContent).toContain("52.2297, 21.0122");
    expect(m.frame).toHaveAttribute("title", "Mapa");
  });
});
