// Legacy blok galerii (`GalleryBlock`): lightbox `yet-another-react-lightbox` ładuje się
// LENIWIE, przy pierwszym otwarciu.
//
// Statyczny import trzymał bibliotekę (~12,8 KB gzip) w chunku `BlocksRenderer` z serii
// bootu każdej strony `/$`, a jej arkusz - w `css` manifestu dziewięciu tras, czyli jako
// blokujący render `<link rel="stylesheet">` także w artykułach bez galerii. Suita pilnuje
// trzech rzeczy: render serwera i pierwszy render klienta nie dotykają modułu lightboxa,
// najechanie/fokus rozgrzewa chunk, kliknięcie montuje lightbox na właściwym zdjęciu
// i zostawia go zamontowanego po zamknięciu (animacja wyjścia). Strażnik źródeł na końcu
// łapie powrót statycznego importu z dowolnego pliku.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const lightbox = vi.hoisted(() => ({
  loads: 0,
  props: [] as Array<{ open: boolean; index: number; slides: Array<{ src: string }> }>,
}));

vi.mock("@/components/Lightbox", () => {
  lightbox.loads += 1;
  return {
    ImageLightbox: (props: {
      open: boolean;
      index: number;
      slides: Array<{ src: string }>;
      onClose: () => void;
    }) => {
      lightbox.props.push(props);
      return props.open ? (
        <div role="dialog" aria-label="lightbox" data-index={props.index}>
          <button type="button" onClick={props.onClose}>
            zamknij
          </button>
        </div>
      ) : null;
    },
  };
});

vi.mock("@/components/atoms/OptimizedImage", () => ({
  OptimizedImage: ({ alt }: { alt: string }) => <img alt={alt} />,
}));

const { GalleryBlock } = await import("../GalleryBlock");

const IMAGES = [
  { url: "https://cdn.example.com/a.jpg", alt: "Pierwsze" },
  { url: "https://cdn.example.com/b.jpg", alt: "Drugie" },
];

/** `React.lazy` rozwiązuje się po mikrozadaniach importu - przepłucz je w `act`. */
async function flushLazy(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
}

afterEach(() => {
  cleanup();
});

describe("GalleryBlock - lightbox poza serią bootu", () => {
  // Kolejność ma znaczenie: licznik ładowań modułu jest globalny dla pliku, a moduł
  // ładuje się raz. Pierwsze dwa testy dowodzą, że do kliknięcia/najechania nic go nie ładuje.
  it("render serwera: kafle bez lightboxa i bez ładowania jego modułu", () => {
    const html = renderToString(<GalleryBlock images={IMAGES} />);

    expect(html).toContain('aria-label="Pierwsze"');
    expect(html).not.toContain("lightbox");
    expect(lightbox.loads).toBe(0);
  });

  it("pierwszy render klienta też nie ładuje modułu (hydratacja bez zmian)", async () => {
    render(<GalleryBlock images={IMAGES} />);
    await flushLazy();

    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(lightbox.loads).toBe(0);
  });

  it("najechanie na miniaturę rozgrzewa chunk, zanim padnie kliknięcie", async () => {
    render(<GalleryBlock images={IMAGES} />);
    fireEvent.pointerEnter(screen.getByRole("button", { name: "Drugie" }));
    await flushLazy();

    expect(lightbox.loads).toBe(1);
    // Rozgrzanie nie montuje lightboxa.
    expect(lightbox.props).toHaveLength(0);
  });

  it("kliknięcie montuje lightbox na klikniętym zdjęciu, zamknięcie zostawia go zamontowanego", async () => {
    render(<GalleryBlock images={IMAGES} />);
    fireEvent.click(screen.getByRole("button", { name: "Drugie" }));
    await flushLazy();

    const dialog = screen.getByRole("dialog", { name: "lightbox" });
    expect(dialog.getAttribute("data-index")).toBe("1");
    expect(lightbox.props.at(-1)?.slides.map((slide) => slide.src)).toEqual(
      IMAGES.map((image) => image.url),
    );

    fireEvent.click(screen.getByRole("button", { name: "zamknij" }));
    await flushLazy();

    expect(screen.queryByRole("dialog")).toBeNull();
    // Ostatni render dostał `open: false` - biblioteka odgrywa wtedy animację wyjścia.
    expect(lightbox.props.at(-1)?.open).toBe(false);
  });

  it("pusta galeria nie renderuje niczego", () => {
    const { container } = render(<GalleryBlock images={[]} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("strażnik źródeł: `components/Lightbox` tylko przez `import()`", () => {
  it("żaden moduł aplikacji nie importuje lightboxa statycznie", () => {
    const root = join(process.cwd(), "src");
    const files = readdirSync(root, { recursive: true, encoding: "utf8" }).filter(
      (file) => /\.tsx?$/.test(file) && !/(^|\/)__tests__\//.test(file),
    );
    const offenders = files.filter((file) => {
      const source = readFileSync(join(root, file), "utf8");
      return (
        /^\s*import\s[^;]*from\s+["'](?:@\/components\/Lightbox|(?:\.\.?\/)+(?:components\/)?Lightbox)["']/m.test(
          source,
        ) || /^\s*import\s(?:[^;]*?from\s+)?["']yet-another-react-lightbox/m.test(source)
      );
    });
    // Jedyny dopuszczalny import biblioteki i jej arkusza jest w samym wrapperze.
    expect(offenders).toEqual(["components/Lightbox.tsx"]);
  });
});
