// Wrapper `ImageLightbox` (yet-another-react-lightbox): konfiguracja i kontrakt zamknięcia.
//
// Moduł ładuje się tylko leniwie (`GalleryBlock`, dowód w `galleryBlockLazyLightbox.test.tsx`),
// więc tamta suita go mockuje - tu render z prawdziwą biblioteką: otwarty pokazuje slajd
// w portalu, zamknięty nie renderuje nic, Esc woła `onClose`, a zmiana slajdu `onIndexChange`.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ImageLightbox } from "../Lightbox";

const SLIDES = [
  { src: "https://cdn.example.com/a.jpg", alt: "Pierwsze" },
  { src: "https://cdn.example.com/b.jpg", alt: "Drugie" },
];

afterEach(() => {
  cleanup();
});

describe("ImageLightbox", () => {
  it("zamknięty nie renderuje portalu", () => {
    render(<ImageLightbox open={false} index={0} slides={SLIDES} onClose={() => {}} />);
    expect(document.querySelector(".yarl__portal")).toBeNull();
  });

  it("otwarty pokazuje slajd o podanym indeksie, a Esc woła `onClose`", async () => {
    const onClose = vi.fn();
    render(<ImageLightbox open index={1} slides={SLIDES} onClose={onClose} />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(document.querySelector(".yarl__portal")).not.toBeNull();
    expect(screen.getAllByRole("img").some((img) => img.getAttribute("alt") === "Drugie")).toBe(
      true,
    );
    fireEvent.keyDown(document.querySelector(".yarl__container") ?? window, { key: "Escape" });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("strzałka w prawo przechodzi do następnego slajdu i raportuje indeks", async () => {
    const onIndexChange = vi.fn();
    render(
      <ImageLightbox
        open
        index={0}
        slides={SLIDES}
        onClose={() => {}}
        onIndexChange={onIndexChange}
      />,
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    fireEvent.keyDown(document.querySelector(".yarl__container") ?? window, { key: "ArrowRight" });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    expect(onIndexChange).toHaveBeenCalledWith(1);
  });
});
