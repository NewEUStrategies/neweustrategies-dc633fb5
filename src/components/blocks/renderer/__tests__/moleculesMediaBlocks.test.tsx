// Bloki mediów renderera (obraz, embed, wideo, audio, okładka, plik,
// media+tekst, galeria) - kontrakt między danymi bloku a tym, co dostaje
// czytelnik i przeglądarka.
//
// Co dowodzimy i dlaczego:
//   * KAŻDY adres z danych przechodzi przez filtr schematu (`safeUrl` /
//     `safeImageUrl`) - autor CMS nie przemyci `javascript:` ani `data:text/html`
//     do `src` / `href` / linku „Pobierz" (audio było jedynym wyjątkiem: naprawione);
//   * blok bez poprawnego adresu znika w całości, zamiast zostawiać pustą ramkę;
//   * wartości liczbowe (przyciemnienie okładki, wysokość, wymiary obrazu) są
//     przycinane do zakresów, a niepełne wymiary nie trafiają do `<img>`;
//   * linia „Źródło" ma etykietę z i18n (wcześniej polski napis także na /en).
//
// Granice: publiczny `BlocksRenderer` z prawdziwym i18n. Embed z iframe
// sprawdzamy w znacznikach SSR (`renderToStaticMarkup`), bo happy-dom ładuje
// stronę osadzonej ramki prawdziwym żądaniem sieciowym.
import { afterEach, describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import i18n from "@/lib/i18n";
import type { Block, BlocksDoc } from "@/lib/blocks/types";
import { BlocksRenderer } from "../../BlocksRenderer";

const doc = (blocks: Block[]): BlocksDoc => ({ version: 1, blocks });
const draw = (blocks: Block[]) => render(<BlocksRenderer doc={doc(blocks)} lang="pl" />);
const IMG = "https://cdn.example.com/a.jpg";

afterEach(async () => {
  await i18n.changeLanguage("pl");
});

describe("obraz", () => {
  it("bez bezpiecznego adresu nie renderuje niczego", () => {
    const { container } = draw([
      { id: "a", type: "image", data: { url: "javascript:alert(1)", caption: "Podpis" } },
      { id: "b", type: "image", data: { caption: "Brak adresu" } },
    ]);
    expect(container.querySelector("figure")).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("linkuje obraz tylko pod bezpieczny adres i otwiera go w nowej karcie", () => {
    const { container } = draw([
      { id: "a", type: "image", data: { url: IMG, alt: "Mapa", href: "https://x.example/" } },
      { id: "b", type: "image", data: { url: IMG, alt: "Bez linku", href: "javascript:x()" } },
    ]);
    const [linked, plain] = Array.from(container.querySelectorAll("figure"));
    const a = linked.querySelector("a");
    expect(a?.getAttribute("href")).toBe("https://x.example/");
    expect(a?.getAttribute("target")).toBe("_blank");
    expect(a?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(plain.querySelector("a")).toBeNull();
    expect(plain.querySelector("img")?.getAttribute("alt")).toBe("Bez linku");
  });

  it("przekazuje wymiary tylko, gdy oba są dodatnie (zaokrąglone), inaczej żadnego", () => {
    const { container } = draw([
      { id: "a", type: "image", data: { url: IMG, width: 799.6, height: "450" } },
      { id: "b", type: "image", data: { url: IMG, width: 800, height: 0 } },
      { id: "c", type: "image", data: { url: IMG, width: "szeroki" } },
    ]);
    const imgs = Array.from(container.querySelectorAll("img"));
    expect(imgs.map((i) => [i.getAttribute("width"), i.getAttribute("height")])).toEqual([
      ["800", "450"],
      [null, null],
      [null, null],
    ]);
  });

  it("pokazuje podpis i źródło; link źródła ma nofollow, a etykieta idzie za językiem", async () => {
    const block: Block = {
      id: "a",
      type: "image",
      data: { url: IMG, caption: "Wykres", source: "Eurostat", sourceUrl: "https://ec.europa.eu" },
    };
    const { container, getByRole, unmount } = draw([block]);
    expect(container.querySelector("figcaption")?.textContent).toBe("Wykres");
    const src = getByRole("link", { name: "Eurostat" });
    expect(src.getAttribute("rel")).toBe("noopener noreferrer nofollow");
    expect(src.parentElement?.textContent).toBe("Źródło:Eurostat");
    unmount();

    // NAPRAWIONE 2026-10-18: etykieta była wpisana po polsku, więc wersja /en
    // artykułu pokazywała „Źródło:" obok angielskiej treści.
    await i18n.changeLanguage("en");
    const en = render(<BlocksRenderer doc={doc([block])} lang="en" />);
    expect(en.getByRole("link", { name: "Eurostat" }).parentElement?.textContent).toBe(
      "Source:Eurostat",
    );
  });

  it("źródło bez bezpiecznego adresu zostaje zwykłym tekstem", () => {
    const { container } = draw([
      { id: "a", type: "image", data: { url: IMG, source: "GUS", sourceUrl: "javascript:x()" } },
    ]);
    expect(container.querySelector("figure a")).toBeNull();
    expect(container.textContent).toContain("GUS");
  });
});

describe("embed", () => {
  it("rozpoznanego dostawcę osadza w iframe z nazwą dostawcy jako tytułem (SSR)", () => {
    const html = renderToStaticMarkup(
      <BlocksRenderer
        doc={doc([
          { id: "e", type: "embed", data: { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" } },
        ])}
      />,
    );
    expect(html).toContain('src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"');
    expect(html).toContain('title="youtube"');
    expect(html).toContain('loading="lazy"');
  });

  it("nieznany adres staje się zwykłym linkiem, a niebezpieczny znika", () => {
    const { container, getByRole } = draw([
      { id: "a", type: "embed", data: { url: "https://raport.example.org/pdf" } },
      { id: "b", type: "embed", data: { url: "javascript:alert(1)" } },
    ]);
    const link = getByRole("link", { name: "https://raport.example.org/pdf" });
    expect(link.getAttribute("target")).toBe("_blank");
    expect(container.querySelectorAll("a")).toHaveLength(1);
    expect(container.querySelector("iframe")).toBeNull();
  });
});

describe("wideo i audio", () => {
  it("wideo: bez adresu znika; z adresem ma kontrolki, napisy i flagi odtwarzania", () => {
    const { container } = draw([
      { id: "a", type: "video", data: { url: "javascript:x()" } },
      {
        id: "b",
        type: "video",
        data: {
          url: "https://cdn.example.com/v.mp4",
          poster: "javascript:x()",
          captionsUrl: "/napisy.vtt",
          autoplay: true,
          muted: true,
          aspect: "9:16",
          caption: "Wywiad",
          source: "TVP",
        },
      },
    ]);
    const videos = container.querySelectorAll("video");
    expect(videos).toHaveLength(1);
    const v = videos[0];
    expect(v.getAttribute("src")).toBe("https://cdn.example.com/v.mp4");
    expect(v.hasAttribute("poster")).toBe(false);
    expect(v.hasAttribute("controls")).toBe(true);
    expect(v.autoplay).toBe(true);
    expect(v.muted).toBe(true);
    expect(v.loop).toBe(false);
    expect(v.querySelector("track")?.getAttribute("src")).toBe("/napisy.vtt");
    expect(v.querySelector("track")?.getAttribute("kind")).toBe("captions");
    expect(container.querySelector("figcaption")?.textContent).toBe("Wywiad");
    expect(container.textContent).toContain("Źródło:TVP");
  });

  it("NAPRAWIONE 2026-10-18: audio z niebezpiecznym adresem nie renderuje ani odtwarzacza, ani linku „Pobierz”", () => {
    // WEJŚCIE: url `javascript:…` / `data:text/html…`. Przed poprawką trafiał
    // surowo do `<audio src>` i do `<a href download>`.
    const { container } = draw([
      { id: "a", type: "audio", data: { url: "javascript:alert(1)", download: true } },
      {
        id: "b",
        type: "audio",
        data: { url: "data:text/html,<script>x()</script>", download: true },
      },
    ]);
    expect(container.querySelector("audio")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
  });

  it("audio z adresem pokazuje okładkę, podpis i przetłumaczony link pobierania", () => {
    const { container, getByRole } = draw([
      {
        id: "a",
        type: "audio",
        data: {
          url: "https://cdn.example.com/p.mp3",
          cover: IMG,
          caption: "Podcast",
          download: true,
          loop: true,
        },
      },
    ]);
    const audio = container.querySelector("audio");
    expect(audio?.getAttribute("src")).toBe("https://cdn.example.com/p.mp3");
    expect(audio?.loop).toBe(true);
    expect(container.querySelector("img")?.getAttribute("src")).toBe(IMG);
    const dl = getByRole("link", { name: /Pobierz plik/ });
    expect(dl.getAttribute("href")).toBe("https://cdn.example.com/p.mp3");
    expect(dl.hasAttribute("download")).toBe(true);
    expect(container.querySelector("figcaption")?.textContent).toBe("Podcast");
  });

  it("audio bez flagi pobierania nie ma linku", () => {
    const { container } = draw([
      { id: "a", type: "audio", data: { url: "https://cdn.example.com/p.mp3" } },
    ]);
    expect(container.querySelector("audio")).not.toBeNull();
    expect(container.querySelector("a")).toBeNull();
  });
});

describe("okładka, plik, media+tekst, galeria", () => {
  it("okładka przycina przyciemnienie i wysokość oraz cytuje adres tła", () => {
    const { container, getByRole } = draw([
      { id: "a", type: "cover", data: { url: IMG, title: "Szczyt", overlay: 150, minHeight: 5 } },
      { id: "b", type: "cover", data: { url: IMG, overlay: -10, minHeight: 5000 } },
      { id: "c", type: "cover", data: { url: "javascript:x()", title: "Nic" } },
    ]);
    expect(getByRole("heading", { name: "Szczyt" })).toBeTruthy();
    const covers = Array.from(
      container.querySelectorAll<HTMLElement>("article > div[style*='background-image']"),
    );
    expect(covers).toHaveLength(2);
    expect(covers.map((c) => c.style.minHeight)).toEqual(["120px", "800px"]);
    expect(covers[0].style.backgroundImage).toContain(IMG);
    const overlays = covers.map((c) => (c.firstElementChild as HTMLElement).style.opacity);
    expect(overlays).toEqual(["1", "0"]);
    expect(container.textContent).not.toContain("Nic");
  });

  it("plik: bez adresu znika; etykieta domyślna z i18n; przycisk pobierania opcjonalny", () => {
    const { container, getAllByRole } = draw([
      { id: "a", type: "file", data: { url: "javascript:x()", label: "Zły" } },
      { id: "b", type: "file", data: { url: "/raport.pdf" } },
      { id: "c", type: "file", data: { url: "/aneks.pdf", label: "Aneks", showButton: false } },
    ]);
    const links = getAllByRole("link");
    expect(
      links.map((l) => [l.textContent, l.getAttribute("href"), l.hasAttribute("download")]),
    ).toEqual([
      ["Pobierz plik", "/raport.pdf", false],
      ["Pobierz", "/raport.pdf", true],
      ["Aneks", "/aneks.pdf", false],
    ]);
    expect(container.textContent).not.toContain("Zły");
  });

  it("media+tekst pokazuje obraz tylko dla bezpiecznego adresu, a tekst zawsze", () => {
    const { container } = draw([
      {
        id: "a",
        type: "media-text",
        data: { url: IMG, text: "Opis\nlinia", mediaPosition: "right" },
      },
      { id: "b", type: "media-text", data: { url: "javascript:x()", text: "Sam tekst" } },
    ]);
    expect(container.querySelectorAll("img")).toHaveLength(1);
    expect(container.textContent).toContain("Opis\nlinia");
    expect(container.textContent).toContain("Sam tekst");
  });

  it("galeria pomija pozycje bez adresu i nie-obiekty", () => {
    const { container } = draw([
      {
        id: "g",
        type: "gallery",
        data: {
          images: [{ url: IMG, alt: "Jeden" }, { alt: "Pusty" }, "zdjecie.jpg", { url: IMG }],
        },
      },
    ]);
    const imgs = Array.from(container.querySelectorAll("img"));
    expect(imgs).toHaveLength(2);
    expect(imgs[0].getAttribute("alt")).toBe("Jeden");
  });
});
