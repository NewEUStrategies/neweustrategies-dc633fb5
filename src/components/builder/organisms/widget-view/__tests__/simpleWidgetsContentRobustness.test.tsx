// Odporność prostych widgetów (SimpleWidgets) na treść spoza kontraktu panelu.
//
// Co udowadniamy i dlaczego:
//   * POLE „ADRES" PUSTE ALBO NIEBEZPIECZNE NIE DAJE MARTWEGO ODNOŚNIKA. `safeUrl`
//     ma domyślny fallback "#", więc wywołanie bez drugiego argumentu zamieniało
//     pusty adres w <a href="#"> - czytelnik dostawał fokusowalny link, który
//     przewija stronę na górę, a gałąź „bez linku" była nieosiągalna. Dotyczyło
//     paska „hot topic", chmury logo i autora wpisu na osi czasu.
//   * WARTOŚCI SPOZA ZBIORU OPCJI WRACAJĄ DO DOMYŚLNYCH: znacznik nagłówka
//     („tag") szedł prosto do React.createElement, więc literówka albo stara
//     wartość typu "h2 " wywracała hydratację (InvalidCharacterError), a "script"
//     renderował element skryptu z treścią widgetu.
//   * USZKODZONY WPIS W TABLICY (null, liczba) NIE ZABIJA CAŁEGO WIDGETU: oś
//     czasu, chmura logo i ręczny cennik czytały `entry.x` bez sprawdzenia, że
//     wpis jest obiektem, więc jeden `null` z importu kasował wszystkie wpisy.
//   * Chmura logo: druga (dekoracyjna) kopia toru marquee jest `aria-hidden`,
//     więc jej odnośniki nie mogą być w kolejności tabulacji (axe:
//     aria-hidden-focus) - klawiatura nie może trafiać w niewidoczne duplikaty.
//
// Granice: renderujemy przez prawdziwy WidgetView jak widgetBehavior.test.tsx;
// rejestr leniwych widgetów -> lustro eager (@/test/eagerWidgetChunks), klient
// Supabase -> pusty łańcuch (globalne linki social), react-i18next -> echo
// `defaultValue`. Asercje patrzą na role, nazwy dostępne i atrybuty linków.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { WidgetView } from "@/components/builder/organisms/WidgetView";
import type { WidgetNode, WidgetType, WidgetContent } from "@/lib/builder/types";

vi.mock(
  "@/components/builder/organisms/widget-view/lazyWidgets",
  () => import("@/test/eagerWidgetChunks"),
);

vi.mock("@/integrations/supabase/client", () => {
  type Builder = Record<string, unknown> & { then: (r: (v: unknown) => unknown) => unknown };
  const builder = {} as Builder;
  for (const m of ["select", "eq", "in", "order", "limit", "maybeSingle"]) {
    (builder as Record<string, unknown>)[m] = vi.fn(() => builder);
  }
  builder.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null });
  return {
    supabase: { from: vi.fn(() => builder), rpc: vi.fn(async () => ({ data: [], error: null })) },
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
    i18n: { language: "pl" },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

let nextId = 0;
function renderNode(type: WidgetType, content: Record<string, unknown>, lang: "pl" | "en" = "pl") {
  const node: WidgetNode = {
    id: `w-robust-${nextId++}`,
    kind: "widget",
    type,
    content: content as WidgetContent,
  };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <WidgetView node={node} lang={lang} device="desktop" editable={false} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
});

describe("hot-topic-bar: adres paska", () => {
  it("bez adresu pasek NIE jest odnośnikiem (wcześniej <a href='#'>)", () => {
    const { container } = renderNode("hot-topic-bar", { title_pl: "Temat dnia" });
    expect(screen.getByText("Temat dnia")).toBeTruthy();
    expect(container.querySelector("a")).toBeNull();
    // Etykieta domyślna, gdy panel nie podał własnej.
    expect(container.textContent).toContain("Hot topic");
  });

  it("adres javascript: jest odrzucany zamiast stać się linkiem", () => {
    const { container } = renderNode("hot-topic-bar", {
      title_pl: "Temat",
      href: "javascript:alert(1)",
    });
    expect(container.querySelector("a")).toBeNull();
  });

  it("bezpieczny adres zostaje odnośnikiem z tytułem; wersja EN spada na PL", () => {
    renderNode("hot-topic-bar", { title_pl: "Temat PL", badge_pl: "Pilne", href: "/news" }, "en");
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/news");
    expect(link.textContent).toContain("Temat PL");
    expect(link.textContent).toContain("Pilne");
  });
});

describe("logo-cloud: wpisy, adresy i duplikat toru", () => {
  it("logo bez adresu nie jest linkiem; uszkodzone wpisy są pomijane", () => {
    const { container } = renderNode("logo-cloud", {
      heading_pl: "Zaufali nam",
      logos: [null, 7, { label: "Acme" }, { src: "https://cdn.example/b.png", alt: "Beta" }],
    });
    expect(screen.getByRole("heading", { name: "Zaufali nam" })).toBeTruthy();
    expect(container.querySelector("a")).toBeNull();
    // Dwa poprawne wpisy x dwie kopie toru.
    expect(screen.getAllByText("Acme")).toHaveLength(2);
    expect(container.querySelectorAll('img[alt="Beta"]')).toHaveLength(2);
  });

  it("odnośniki w dekoracyjnej kopii toru są poza kolejnością tabulacji", () => {
    const { container } = renderNode("logo-cloud", {
      logos: [
        { label: "Acme", href: "https://acme.example" },
        { label: "Zła", href: "javascript:alert(1)" },
      ],
    });
    const links = [...container.querySelectorAll("a")];
    // Tylko wpis z bezpiecznym adresem staje się linkiem (w obu kopiach).
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "https://acme.example",
      "https://acme.example",
    ]);
    const [visible, duplicate] = links;
    expect(visible.closest("[aria-hidden='true']")).toBeNull();
    expect(visible.getAttribute("tabindex")).toBeNull();
    expect(duplicate.closest("[aria-hidden='true']")).not.toBeNull();
    expect(duplicate.getAttribute("tabindex")).toBe("-1");
    // Dostępna nazwa linku pochodzi z etykiety logo.
    expect(screen.getByRole("link", { name: "Acme" })).toBe(visible);
  });

  it("brak poprawnych logo pokazuje wskazówkę dla redaktora zamiast pustego toru", () => {
    renderNode("logo-cloud", { logos: [{ src: "javascript:x" }] }, "en");
    expect(screen.getByText("Add logos in the properties panel.")).toBeTruthy();
  });
});

describe("timeline: wpisy osi czasu", () => {
  it("uszkodzony wpis nie kasuje pozostałych; nagłówek bez daty jest pomijany", () => {
    renderNode("timeline", {
      entries: [
        null,
        { type: "heading", date_pl: "" },
        { type: "heading", date_pl: "Październik 2026" },
        { title_pl: "Premiera", desc_pl: "Opis premiery", initials: "anna" },
      ],
    });
    expect(screen.getByRole("heading", { name: "Październik 2026" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Premiera" })).toBeTruthy();
    expect(screen.getByText("Opis premiery")).toBeTruthy();
    // Inicjały przycięte do dwóch znaków i wielkimi literami.
    expect(screen.getByText("AN")).toBeTruthy();
  });

  it("autor wpisu bez adresu NIE jest linkiem; z bezpiecznym adresem - jest", () => {
    renderNode("timeline", {
      entries: [
        { title_pl: "A", actorName: "Bez linku" },
        { title_pl: "B", actorName: "Zły link", actorHref: "javascript:alert(1)" },
        { title_pl: "C", actorName: "Z linkiem", actorHref: "/author/ola" },
      ],
    });
    expect(screen.queryByRole("link", { name: /Bez linku/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Zły link/ })).toBeNull();
    expect(screen.getByRole("link", { name: /Z linkiem/ }).getAttribute("href")).toBe(
      "/author/ola",
    );
  });
});

describe("pricing (ręczny): plany z uszkodzonej treści", () => {
  it("pomija wpisy niebędące obiektem i pokazuje cenę liczbową bez wywracania widgetu", () => {
    renderNode("pricing", {
      plans: [null, { name_pl: "Pro", price: 49, currency: "PLN", features_pl: ["A", 3] }],
    });
    const card = screen.getByRole("heading", { name: "Pro" }).parentElement as HTMLElement;
    expect(within(card).getByText("49")).toBeTruthy();
    expect(within(card).getAllByRole("listitem")).toHaveLength(1);
    // Domyślne CTA i bezpieczny fallback adresu.
    expect(within(card).getByRole("link", { name: "Wybierz" }).getAttribute("href")).toBe("#");
  });

  it("pola niebędące tekstem (obiekty) nie trafiają do DOM jako '[object Object]'", () => {
    const { container } = renderNode("pricing", {
      plans: [{ name_pl: { x: 1 }, price: { amount: 1 }, cta_pl: ["Kup"], href: "/kup" }],
    });
    expect(container.textContent).not.toContain("[object Object]");
    expect(screen.getByRole("link", { name: "Wybierz" }).getAttribute("href")).toBe("/kup");
  });
});

describe("slider (ręczny): wpisy z uszkodzonej treści", () => {
  it("wpis null obok slajdu ze zdjęciem jest pomijany - renderuje się tylko poprawny slajd", async () => {
    const { container } = renderNode("slider", {
      variant: "editorial-hero",
      autoplay: false,
      items: [null, { image: "https://cdn.example.com/s1.jpg", title_pl: "Slajd 1" }],
    });
    await waitFor(() => expect(container.querySelector("img.eh-img")).not.toBeNull());
    expect(container.querySelectorAll("img.eh-img")).toHaveLength(1);
    expect(container.textContent).toContain("Slajd 1");
  });
});

describe("tag nagłówka spoza zbioru opcji", () => {
  it("text-rotate: nieznany tag spada na h2, poprawny jest respektowany", () => {
    const bad = renderNode("text-rotate", { tag: "script", texts_pl: "Raz\nDwa" });
    expect(bad.container.querySelector("script")).toBeNull();
    const h2 = bad.container.querySelector("h2");
    expect(h2?.textContent).toContain("Raz");
    cleanup();

    const ok = renderNode("text-rotate", {
      tag: "h4",
      texts_pl: ["Alfa", 5, "Beta"],
      before_pl: "Przed",
      after_pl: "Po",
    });
    const h4 = ok.container.querySelector("h4");
    expect(h4?.textContent).toContain("Przed");
    expect(h4?.textContent).toContain("Alfa");
    expect(h4?.textContent).toContain("Po");
  });

  it("text-rotate: tag z białym znakiem nie wywraca renderu (InvalidCharacterError)", () => {
    const { container } = renderNode("text-rotate", { tag: "h3 onclick", texts_pl: ["X"] });
    expect(container.querySelector("h2")?.textContent).toContain("X");
  });

  it("animated-heading: nieznany tag spada na h2", () => {
    const { container } = renderNode("animated-heading", {
      tag: "h2 onmouseover",
      highlight_pl: "Wyróżnienie",
    });
    expect(container.querySelector("h2")?.textContent).toContain("Wyróżnienie");
  });
});

describe("video: adres spoza dozwolonych", () => {
  it("javascript:/ftp: nie trafia do odtwarzacza - widz dostaje komunikat zamiast ramki", () => {
    for (const url of ["javascript:alert(1)", "ftp://files.example/clip.mp4"]) {
      const { container } = renderNode("video", { url });
      expect(container.querySelector("video, iframe")).toBeNull();
      expect(container.textContent).toContain("niedozwolony URL");
      cleanup();
    }
  });

  it("YouTube z pętlą i bez kontrolek: playlist = ten sam film, controls=0", () => {
    // HTML z serwera, nie DOM: happy-dom ładowałby ramkę (prawdziwe żądanie).
    const node: WidgetNode = {
      id: "w-yt-loop",
      kind: "widget",
      type: "video",
      content: { url: "https://youtu.be/abc123", loop: "on", controls: "off" } as WidgetContent,
    };
    const html = renderToString(
      <QueryClientProvider client={new QueryClient()}>
        <WidgetView node={node} lang="pl" device="desktop" editable={false} />
      </QueryClientProvider>,
    );
    const host = document.createElement("template");
    host.innerHTML = html;
    const src = new URL(host.content.querySelector("iframe")?.getAttribute("src") ?? "");
    expect(src.pathname).toBe("/embed/abc123");
    expect(src.searchParams.get("loop")).toBe("1");
    expect(src.searchParams.get("playlist")).toBe("abc123");
    expect(src.searchParams.get("controls")).toBe("0");
  });
});

describe("animated-heading: słowa rotacji jako tekst wieloliniowy", () => {
  it("dzieli tekst po liniach i pomija puste - pierwsze słowo jest widoczne", () => {
    const { container } = renderNode("animated-heading", {
      mode: "rotate",
      textBefore_pl: "Pracujemy",
      rotateWords_pl: "  szybko \n\n  dokładnie ",
    });
    const h2 = container.querySelector("h2");
    expect(h2?.textContent).toContain("Pracujemy");
    expect(h2?.textContent).toContain("szybko");
    expect(h2?.textContent).not.toContain("  szybko ");
  });
});
