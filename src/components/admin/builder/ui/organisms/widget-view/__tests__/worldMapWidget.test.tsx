// Renderowanie widgetu „Mapa świata": i18n treści, sterowanie kolorami z panelu,
// zaokrąglenie 6px na dymku, kanał dostępności oraz - najważniejsze - podpięcie
// końców łuków pod publiczne profile platformy (żywa etykieta + link do huba
// eksperta zamiast wpisanej ręcznie kopii).
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import type { WidgetContent } from "@/lib/builder/types";
import { WorldMapWidgetView } from "../WorldMapWidget";

const speakerRows = vi.hoisted(() => ({
  value: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: vi.fn(async () => ({ data: speakerRows.value, error: null })),
  },
}));

function renderWidget(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const baseContent = {
  title_pl: "Nasza sieć",
  title_en: "Our network",
  subtitle_pl: "Łączymy instytucje w całej Europie.",
  subtitle_en: "We connect institutions across Europe.",
  source: "manual",
  connections: [
    {
      id: "c1",
      startLabel_pl: "Bruksela",
      startLabel_en: "Brussels",
      startLat: 50.85,
      startLng: 4.35,
      startUserId: "",
      endLabel_pl: "Warszawa",
      endLabel_en: "Warsaw",
      endLat: 52.23,
      endLng: 21.01,
      endUserId: "",
      href: "",
    },
  ],
} as unknown as WidgetContent;

afterEach(() => {
  cleanup();
  speakerRows.value = [];
});

describe("WorldMapWidgetView", () => {
  it("renderuje polski nagłówek, etykiety punktów i listę połączeń dla czytnika", () => {
    const { container } = renderWidget(<WorldMapWidgetView c={baseContent} lang="pl" />);
    expect(screen.getByText("Nasza sieć")).toBeTruthy();
    expect(screen.getByText("Łączymy instytucje w całej Europie.")).toBeTruthy();
    // Etykiety to warstwa HTML nad SVG (jak w pierwowzorze), nie tekst SVG.
    expect(container.querySelectorAll(".nes-world-map__chip").length).toBe(2);
    expect(container.textContent).toContain("Bruksela");
    expect(container.textContent).toContain("Warszawa");
    // Kanał dostępności: pełne połączenie tekstem, nie tylko grafika.
    expect(container.querySelector("ul.sr-only")?.textContent).toContain("Bruksela");
  });

  it("renderuje treść i etykietę mapy po angielsku", () => {
    renderWidget(<WorldMapWidgetView c={baseContent} lang="en" />);
    expect(screen.getByText("Our network")).toBeTruthy();
    expect(
      screen.getByRole("group", { name: "World map with highlighted connections" }),
    ).toBeTruthy();
    expect(screen.getByText("Warsaw")).toBeTruthy();
  });

  it("rysuje jeden łuk na połączenie i pomija współrzędne poza zakresem", () => {
    const c = {
      ...baseContent,
      connections: [
        ...(baseContent.connections as unknown[]),
        {
          id: "c2",
          startLabel_pl: "X",
          startLat: 999,
          startLng: 0,
          endLabel_pl: "Y",
          endLat: 0,
          endLng: 0,
        },
      ],
    } as unknown as WidgetContent;
    const { container } = renderWidget(<WorldMapWidgetView c={c} lang="pl" />);
    // Jeden łuk = poświata + rdzeń + iskra; liczymy iskry, bo jest ich dokładnie
    // po jednej na połączenie.
    expect(container.querySelectorAll(".nes-world-map__spark").length).toBe(1);
  });

  it("kolory z panelu trafiają do znaczników i do zmiennej warstwy kropek", () => {
    const c = {
      ...baseContent,
      lineColor: "#0ea5e9",
      pointColor: "#f59e0b",
      dotColor: "#123456",
      bgColor: "#ffffff",
    } as unknown as WidgetContent;
    const { container } = renderWidget(<WorldMapWidgetView c={c} lang="pl" />);
    const root = container.querySelector(".nes-world-map") as HTMLElement;
    expect(root.style.background).toBeTruthy();
    // Kropki lądu to prostokąt pod maską - to on niesie kolor z panelu.
    expect(container.querySelector("rect[mask]")?.getAttribute("fill")).toBe("#123456");
    expect(container.querySelector(".nes-world-map__core")?.getAttribute("fill")).toBe("#f59e0b");
    expect(container.querySelector("stop[offset='6%']")?.getAttribute("stop-color")).toBe(
      "#0ea5e9",
    );
  });

  it("pusta lista połączeń pokazuje komunikat zamiast pustej ramki", () => {
    const c = { ...baseContent, connections: [] } as unknown as WidgetContent;
    renderWidget(<WorldMapWidgetView c={c} lang="pl" />);
    expect(screen.getByText("Brak połączeń do pokazania na mapie.")).toBeTruthy();
  });

  it("wyłączona animacja nie wstawia klatek kluczowych ani pulsu", () => {
    const c = { ...baseContent, animate: false } as unknown as WidgetContent;
    const { container } = renderWidget(<WorldMapWidgetView c={c} lang="pl" />);
    expect(container.querySelector("style")).toBeNull();
    // Bez animacji nie ma czego pulsować ani po czym biec - te warstwy w ogóle
    // nie trafiają do DOM-u, zamiast siedzieć w nim ukryte.
    expect(container.querySelector(".nes-world-map__pulse")).toBeNull();
    expect(container.querySelector(".nes-world-map__spark")).toBeNull();
  });

  it("włączona animacja generuje jedną regułę @keyframes na łuk", () => {
    const { container } = renderWidget(<WorldMapWidgetView c={baseContent} lang="pl" />);
    const css = container.querySelector("style")?.textContent ?? "";
    expect(css).toContain("@keyframes");
    // Nazwa reguły nie może nieść dwukropków z useId() - byłaby nielegalna w CSS.
    expect(css).not.toContain(":r");
  });

  it("tryb ekspercki bierze nazwisko i link z żywego profilu platformy", async () => {
    speakerRows.value = [
      { user_id: "u-1", display_name: "Anna Nowak", slug: "anna-nowak", avatar_url: null },
    ];
    const c = {
      ...baseContent,
      source: "experts",
      connections: [
        {
          ...(baseContent.connections as Array<Record<string, unknown>>)[0],
          endUserId: "u-1",
          endLabel_pl: "Kopia nazwiska",
        },
      ],
    } as unknown as WidgetContent;
    const { container } = renderWidget(<WorldMapWidgetView c={c} lang="pl" />);
    expect(await screen.findByText("Anna Nowak")).toBeTruthy();
    expect(container.textContent).not.toContain("Kopia nazwiska");
    expect(container.querySelector("a[href='/author/anna-nowak']")).toBeTruthy();
  });

  it("etykieta eksperta niesie zdjęcie i rolę z profilu, nie sam napis", async () => {
    speakerRows.value = [
      {
        user_id: "u-1",
        display_name: "Anna Nowak",
        slug: "anna-nowak",
        avatar_url: "https://example.org/anna.jpg",
        headline_pl: "Analityczka polityki energetycznej",
        job_title: "Senior Fellow",
      },
    ];
    const c = {
      ...baseContent,
      source: "experts",
      connections: [
        {
          ...(baseContent.connections as Array<Record<string, unknown>>)[0],
          endUserId: "u-1",
        },
      ],
    } as unknown as WidgetContent;
    const { container } = renderWidget(<WorldMapWidgetView c={c} lang="pl" />);
    expect(await screen.findByText("Analityczka polityki energetycznej")).toBeTruthy();
    expect(container.querySelector(".nes-world-map__chip--rich img")?.getAttribute("src")).toBe(
      "https://example.org/anna.jpg",
    );
  });

  it("kadr `world` pokazuje całe płótno, a domyślny przybliża do połączeń", () => {
    const world = renderWidget(
      <WorldMapWidgetView
        c={{ ...baseContent, fit: "world" } as unknown as WidgetContent}
        lang="pl"
      />,
    );
    expect(world.container.querySelector("svg")?.getAttribute("viewBox")).toBe(
      "0.0 0.0 800.0 400.0",
    );
    cleanup();
    const auto = renderWidget(<WorldMapWidgetView c={baseContent} lang="pl" />);
    const box = auto.container.querySelector("svg")?.getAttribute("viewBox") ?? "";
    expect(box).not.toBe("0.0 0.0 800.0 400.0");
    expect(Number(box.split(" ")[2])).toBeLessThan(800);
  });

  it("tryb ręczny nie odpytuje platformy o profile", () => {
    const c = {
      ...baseContent,
      connections: [
        {
          ...(baseContent.connections as Array<Record<string, unknown>>)[0],
          endUserId: "u-1",
        },
      ],
    } as unknown as WidgetContent;
    const { container } = renderWidget(<WorldMapWidgetView c={c} lang="pl" />);
    expect(container.textContent).toContain("Warszawa");
    expect(container.querySelector("a[href^='/author/']")).toBeNull();
  });
});
