// Lightbox galerii: ustawienie `lightbox` istniało w schemacie, ale nic go nie
// czytało - przełącznik nie robił NIC. Ten plik pilnuje, że dowieziona funkcja
// naprawdę działa i jest dostępna z klawiatury.
//
// Zakres: otwarcie z kafla, zamknięcie (Esc / krzyżyk / tło), nawigacja
// strzałkami z zawijaniem, pułapka focusu + powrót focusu na kafel,
// aria-modal / aria-label, prefers-reduced-motion, blokada scrolla tła oraz
// twardy audyt axe.
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { GalleryLightbox, GalleryLightboxZone } from "../GalleryLightbox";
import { axeViolations, summarize } from "@/test/axe";
import type { Lang } from "../frame";

const IMAGES = [
  "https://cdn.example.com/a.jpg",
  "https://cdn.example.com/b.jpg",
  "https://cdn.example.com/c.jpg",
];

/** Odpowiednik użycia w rendererze galerii: kafle owinięte `trigger`. */
function renderGallery(enabled: boolean, lang: Lang = "pl", images: readonly string[] = IMAGES) {
  return render(
    <GalleryLightboxZone images={images} enabled={enabled} lang={lang}>
      {(trigger) => (
        <div data-widget-grid>
          {images.map((src, i) => trigger(i, <span key={i} data-tile={i} data-src={src} />))}
        </div>
      )}
    </GalleryLightboxZone>,
  );
}

function openTile(index: number): HTMLElement {
  const tiles = screen.getAllByRole("button");
  const tile = tiles[index];
  tile.focus();
  fireEvent.click(tile);
  return tile;
}

/** Wymusza odpowiedź media-query dla prefers-reduced-motion. */
function stubReducedMotion(reduced: boolean): void {
  vi.spyOn(window, "matchMedia").mockImplementation((query: string) => ({
    matches: query.includes("prefers-reduced-motion") ? reduced : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}

beforeEach(() => {
  document.body.style.overflow = "";
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  document.body.style.overflow = "";
});

describe("GalleryLightboxZone - integracja z kaflami galerii", () => {
  it("leaves tiles untouched when the setting is off", () => {
    renderGallery(false);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(document.querySelectorAll("[data-tile]")).toHaveLength(3);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps layout classes on a wrapper even when the setting is off", () => {
    // Karuzela trzyma `flex-[0_0_80%]` na kaflu; wrapper musi przenieść je w
    // OBU trybach, inaczej włączenie lightboxa przestawia geometrię.
    render(
      <GalleryLightboxZone images={IMAGES} enabled={false} lang="pl">
        {(trigger) => <div>{trigger(0, <span data-tile="0" />, "flex-[0_0_80%]")}</div>}
      </GalleryLightboxZone>,
    );
    const wrapper = document.querySelector("[data-tile]")?.parentElement;
    expect(wrapper?.tagName).toBe("SPAN");
    expect(wrapper?.className).toContain("flex-[0_0_80%]");
  });

  it("turns each tile into a labelled button when the setting is on", () => {
    renderGallery(true);
    const tiles = screen.getAllByRole("button");
    expect(tiles).toHaveLength(3);
    expect(tiles[1]).toHaveAttribute("aria-label", "Powiększ zdjęcie 2 z 3");
    expect(tiles[0].className).toContain("cursor-zoom-in");
  });

  it("speaks English in the English preview, tiles and dialog alike", () => {
    renderGallery(true, "en");
    expect(screen.getAllByRole("button")[0]).toHaveAttribute("aria-label", "Enlarge photo 1 of 3");
    openTile(0);
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-label", "Photo preview");
    expect(screen.getByRole("img")).toHaveAttribute("alt", "Photo 1 of 3");
    expect(screen.getByRole("button", { name: "Close preview" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next photo" })).toBeInTheDocument();
  });

  it("opens the clicked photo, not the first one", () => {
    renderGallery(true);
    openTile(2);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("3 / 3")).toBeInTheDocument();
    expect(screen.getByRole("img")).toHaveAttribute("alt", "Zdjęcie 3 z 3");
  });
});

describe("GalleryLightbox - zamykanie i focus", () => {
  it("exposes a labelled modal dialog", () => {
    renderGallery(true);
    openTile(0);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-label", "Podgląd zdjęcia");
  });

  it("moves focus into the dialog and back to the tile on close", () => {
    renderGallery(true);
    const tile = openTile(1);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Zamknij podgląd" }));

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(tile);
  });

  it("traps Tab inside the dialog", () => {
    renderGallery(true);
    openTile(0);
    const dialog = screen.getByRole("dialog");
    const close = screen.getByRole("button", { name: "Zamknij podgląd" });
    const next = screen.getByRole("button", { name: "Następne zdjęcie" });

    // Focus startuje na krzyżyku (pierwszy focusowalny) - Shift+Tab zawija na
    // ostatni, a Tab z ostatniego wraca na pierwszy. Kafle galerii pozostają
    // poza cyklem.
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(next);
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(close);
  });

  it("closes on the close button and on a backdrop click", () => {
    renderGallery(true);
    openTile(0);
    fireEvent.click(screen.getByRole("button", { name: "Zamknij podgląd" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    openTile(0);
    fireEvent.click(screen.getByRole("dialog"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps the dialog open when the photo itself is clicked", () => {
    renderGallery(true);
    openTile(0);
    fireEvent.click(screen.getByRole("img"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("locks background scrolling while open and restores it on close", () => {
    document.body.style.overflow = "auto";
    renderGallery(true);
    openTile(0);
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(document.body.style.overflow).toBe("auto");
  });
});

describe("GalleryLightbox - nawigacja", () => {
  it("walks forward and wraps around with the arrow keys", () => {
    renderGallery(true);
    openTile(2);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByText("1 / 3")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(screen.getByText("3 / 3")).toBeInTheDocument();
  });

  it("walks with the on-screen arrows too", () => {
    renderGallery(true);
    openTile(0);
    fireEvent.click(screen.getByRole("button", { name: "Następne zdjęcie" }));
    expect(screen.getByText("2 / 3")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Poprzednie zdjęcie" }));
    expect(screen.getByText("1 / 3")).toBeInTheDocument();
  });

  it("hides the arrows and ignores arrow keys for a single photo", () => {
    renderGallery(true, "pl", [IMAGES[0]]);
    openTile(0);
    expect(screen.queryByRole("button", { name: "Następne zdjęcie" })).toBeNull();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByText("1 / 1")).toBeInTheDocument();
  });

  it("ignores unrelated keys", () => {
    renderGallery(true);
    openTile(0);
    fireEvent.keyDown(window, { key: "a" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("1 / 3")).toBeInTheDocument();
  });
});

describe("GalleryLightbox - stan sterowany i odporność", () => {
  const noop = () => {};

  it("renders nothing when closed or when the index is out of range", () => {
    const { rerender } = render(
      <GalleryLightbox
        images={IMAGES}
        index={null}
        lang="pl"
        onClose={noop}
        onIndexChange={noop}
      />,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    rerender(
      <GalleryLightbox images={IMAGES} index={9} lang="pl" onClose={noop} onIndexChange={noop} />,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    rerender(
      <GalleryLightbox images={[]} index={0} lang="pl" onClose={noop} onIndexChange={noop} />,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("refuses to paint a rejected image URL", () => {
    render(
      <GalleryLightbox
        images={["javascript:alert(1)"]}
        index={0}
        lang="pl"
        onClose={noop}
        onIndexChange={noop}
      />,
    );
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("Zdjęcie 1 z 1")).toBeInTheDocument();
  });
});

describe("GalleryLightbox - prefers-reduced-motion", () => {
  it("drops the transition classes when the user asks for less motion", () => {
    stubReducedMotion(true);
    renderGallery(true);
    openTile(0);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("data-reduced-motion", "true");
    expect(dialog.className).not.toContain("transition-opacity");
    expect(screen.getByRole("img").className).not.toContain("transition-transform");
  });

  it("keeps the transitions (with a motion-reduce escape hatch) otherwise", () => {
    stubReducedMotion(false);
    renderGallery(true);
    openTile(0);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("data-reduced-motion", "false");
    expect(dialog.className).toContain("transition-opacity");
    expect(dialog.className).toContain("motion-reduce:transition-none");
  });
});

describe("GalleryLightbox - audyt dostępności", () => {
  it("has no axe violations with the dialog open", async () => {
    renderGallery(true);
    openTile(0);
    const violations = await act(async () => axeViolations(document.body));
    expect(violations, summarize(violations)).toEqual([]);
  });
});
